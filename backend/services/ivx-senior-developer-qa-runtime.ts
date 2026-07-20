/**
 * IVX Senior-Developer QA-ONLY Runtime
 *
 * FINAL CERTIFICATION FIX (owner 2026-07-20):
 *   QA-only requests ("Run QA on the IVX Chat module without modifying code")
 *   created a persistent worker job but did NOT execute relevant module tests.
 *
 * This runtime runs the SAME persistent worker-job infrastructure as the
 * developer_executor, but in a strictly QA-ONLY mode:
 *
 *   PERMITTED:  inspect repository files, identify relevant test files,
 *               run targeted `bun test` for the matched module, run scoped
 *               typecheck, run lint when applicable, capture exit codes +
 *               pass/fail/skip counts + duration, return structured evidence.
 *
 *   BLOCKED:    editing files, committing, pushing, deploying, applying
 *               migrations, changing production data.
 *
 * Output format (owner-mandated):
 *
 *   TASK ID / MODE: QA_ONLY / FILES INSPECTED / TESTS SELECTED / COMMANDS RUN /
 *   EXIT CODES / PASSED / FAILED / SKIPPED / TYPECHECK / LINT / FINDINGS / STATUS
 *
 * When the target module cannot be identified, returns:
 *   STATUS: BLOCKED / ERROR CODE: QA_TARGET_NOT_FOUND
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const IVX_QA_ONLY_MARKER = 'ivx-senior-developer-qa-only-2026-07-20';

/** QA-only execution mode flag carried on the worker job input. */
export type IVXQAOnlyExecutionMode = 'qa_only';

/** A command executed during the QA run. */
export type IVXQACommand = {
  command: string;
  /** "run_tests" | "typecheck" | "lint" | "stat" */
  kind: 'run_tests' | 'typecheck' | 'lint' | 'stat';
  ok: boolean;
  exitCode: number | null;
  outputPreview: string;
  error: string | null;
  durationMs: number;
};

/** A test file selected for the QA run. */
export type IVXQATestFile = {
  path: string;
  bytes: number;
};

/** A file inspected during the QA run. */
export type IVXQAInspectedFile = {
  path: string;
  bytes: number;
  preview: string;
};

export type IVXQAOnlyProof = {
  marker: typeof IVX_QA_ONLY_MARKER;
  jobId: string;
  goal: string;
  mode: IVXQAOnlyExecutionMode;
  finalStatus: 'COMPLETED' | 'BLOCKED' | 'FAILED';
  patchApplied: boolean;
  commitCreated: boolean;
  deployed: boolean;
  changedFiles: string[];
  filesInspected: IVXQAInspectedFile[];
  testsSelected: IVXQATestFile[];
  commandsRun: IVXQACommand[];
  passed: number;
  failed: number;
  skipped: number;
  typecheckOk: boolean | null;
  lintOk: boolean | null;
  findings: string;
  errorCode: string | null;
  error: string | null;
  generatedAt: string;
  secretValuesReturned: false;
};

export type IVXQAOnlyPhase =
  | 'queued'
  | 'module_identified'
  | 'files_inspected'
  | 'tests_selected'
  | 'tests_executed'
  | 'typecheck_run'
  | 'lint_run'
  | 'completed'
  | 'blocked'
  | 'failed';

export type IVXQAOnlyRunInput = {
  goal: string;
  onPhase?: (phase: IVXQAOnlyPhase, detail: string) => void;
};

/** Dirs to search for test files. */
const QA_TEST_ROOTS = ['backend', 'expo/__tests__'];

/** Dirs never searched. */
const QA_IGNORED_DIRS = new Set([
  '.git', '.rork', 'node_modules', '.expo', 'dist', 'build', 'coverage',
  'logs', 'tmp', '__mocks__', 'mocks',
]);

const MAX_INSPECTED_FILES = 16;
const MAX_TEST_FILES = 12;
const FILE_PREVIEW_CHARS = 160;
const COMMAND_OUTPUT_PREVIEW_CHARS = 1200;
const COMMAND_TIMEOUT_MS = 50_000;

function nowIso(): string {
  return new Date().toISOString();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Unknown QA runtime error.';
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

/**
 * Extract module keywords from the goal. Converts natural-language module
 * references ("IVX Chat module", "senior developer module", "factory engine")
 * into kebab-case keywords for test-file path matching.
 */
function extractModuleKeywords(goal: string): string[] {
  const normalized = goal.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = normalized.split(' ').filter((w) => w.length >= 3);

  // Filter out common non-module words
  const stopWords = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'please',
    'report', 'change', 'deploy', 'anything', 'current', 'status', 'without',
    'modifying', 'code', 'module', 'run', 'regression', 'sweep', 'check',
    'verify', 'verification', 'test', 'tests', 'suite', 'typecheck', 'tsc',
    'lint', 'pass', 'fail', 'skipped', 'low', 'risk', 'defect', 'one',
    'prepare', 'commit', 'but', 'not', 'all', 'end', 'make', 'sure',
    'working', 'enterprise', 'business', 'give', 'me', 'show', 'proof',
    'evidence', 'live', 'now', 'need', 'want', 'you', 'can', 'are',
    'yes', 'fix', 'inspect', 'only', 'just', 'pre', 'post', 'submission',
    'flight', 'smoke', 'quality', 'assurance', 'about', 'tell', 'about',
  ]);

  const keywords = words.filter((w) => !stopWords.has(w));

  // Also add compound kebab-case keywords for multi-word module names
  const compoundMap: Record<string, string> = {
    'ivx chat': 'chat',
    'chat ordering': 'chat',
    'chat message': 'chat',
    'senior developer': 'senior-developer',
    'factory engine': 'factory',
    'autonomous coder': 'autonomous-coder',
    'execution mode': 'execution-mode',
    'reliability gate': 'reliability-gate',
    'owner ai': 'owner-ai',
    'completion validator': 'completion-validator',
    'task state': 'task-state',
    'context pipeline': 'context-pipeline',
    'duplicate worker': 'duplicate-worker',
    'chat pagination': 'chat-pagination',
    'real data': 'real-data',
    'engineering os': 'engineering-os',
    'executive layer': 'executive-layer',
    'capital pipeline': 'capital-pipeline',
    'deal tracking': 'deal-tracking',
    'investor crm': 'investor-crm',
  };
  for (const [phrase, keyword] of Object.entries(compoundMap)) {
    if (normalized.includes(phrase)) {
      keywords.push(keyword);
    }
  }

  return Array.from(new Set(keywords));
}

/**
 * Walk test file directories and return all .test.ts files.
 */
async function walkTestFiles(projectRoot: string): Promise<string[]> {
  const results: string[] = [];
  async function visit(relDir: string): Promise<void> {
    if (results.length >= 200) return;
    const absDir = path.join(projectRoot, relDir);
    let entries: string[];
    try {
      entries = await readdir(absDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const relEntry = relDir ? `${relDir}/${entry}` : entry;
      const absEntry = path.join(absDir, entry);
      let info;
      try {
        info = await stat(absEntry);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        if (QA_IGNORED_DIRS.has(entry)) continue;
        // Only descend into backend/ and expo/__tests__/
        if (relDir === '' && entry !== 'backend' && entry !== 'expo') continue;
        if (relDir === 'expo' && entry !== '__tests__') continue;
        await visit(relEntry);
      } else if (info.isFile() && entry.endsWith('.test.ts')) {
        results.push(relEntry);
      }
    }
  }
  for (const root of QA_TEST_ROOTS) {
    await visit(root);
  }
  return results;
}

/**
 * Match test files against the module keywords. Returns the test files
 * whose paths contain any of the kebab-case keywords.
 */
function selectTestFiles(keywords: string[], allTestFiles: string[]): IVXQATestFile[] {
  if (keywords.length === 0) return [];
  const kebabKeywords = keywords.map((k) => k.replace(/\s+/g, '-'));
  const matched = allTestFiles.filter((file) => {
    const lower = file.toLowerCase();
    return kebabKeywords.some((kw) => lower.includes(kw));
  });
  return matched.slice(0, MAX_TEST_FILES).map((file) => ({
    path: file,
    bytes: 0, // filled lazily during inspection
  }));
}

/**
 * Inspect source files related to the module (non-test files matching keywords).
 */
async function inspectSourceFiles(
  projectRoot: string,
  keywords: string[],
  allTestFiles: string[],
): Promise<IVXQAInspectedFile[]> {
  const kebabKeywords = keywords.map((k) => k.replace(/\s+/g, '-'));
  const inspected: IVXQAInspectedFile[] = [];

  // Walk backend/ and expo/ for .ts/.tsx source files matching keywords
  const sourceFiles: string[] = [];
  async function visit(relDir: string): Promise<void> {
    if (sourceFiles.length >= 100) return;
    const absDir = path.join(projectRoot, relDir);
    let entries: string[];
    try {
      entries = await readdir(absDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      const relEntry = relDir ? `${relDir}/${entry}` : entry;
      const absEntry = path.join(absDir, entry);
      let info;
      try {
        info = await stat(absEntry);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        if (QA_IGNORED_DIRS.has(entry)) continue;
        if (relDir === '' && entry !== 'backend' && entry !== 'expo') continue;
        await visit(relEntry);
      } else if (info.isFile() && (entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.endsWith('.test.ts')) {
        const lower = relEntry.toLowerCase();
        if (kebabKeywords.some((kw) => lower.includes(kw))) {
          sourceFiles.push(relEntry);
        }
      }
    }
  }
  await visit('backend');
  await visit('expo');

  for (const file of sourceFiles.slice(0, MAX_INSPECTED_FILES)) {
    try {
      const absPath = path.join(projectRoot, file);
      const content = await readFile(absPath, 'utf8');
      inspected.push({
        path: file,
        bytes: Buffer.byteLength(content, 'utf8'),
        preview: truncate(content.replace(/\r/g, '').trimStart(), FILE_PREVIEW_CHARS),
      });
    } catch {
      // skip unreadable files
    }
  }
  return inspected;
}

/**
 * Run a shell command and capture stdout/stderr/exitCode.
 */
async function runCommand(
  projectRoot: string,
  command: string,
  kind: IVXQACommand['kind'],
): Promise<IVXQACommand> {
  const startedAt = Date.now();
  try {
    const { spawn } = await import('node:child_process') as typeof import('node:child_process');
    const parts = command.split(' ');
    const child = spawn(parts[0], parts.slice(1), {
      cwd: projectRoot,
      env: { ...process.env, CI: 'true', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: COMMAND_TIMEOUT_MS,
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 8192) stdout = stdout.slice(-8192);
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 4096) stderr = stderr.slice(-4096);
    });
    const exitCode = await new Promise<number>((resolve) => {
      child.on('close', (code) => resolve(typeof code === 'number' ? code : 0));
      child.on('error', () => resolve(1));
    });
    const preview = truncate(
      (stdout + (stderr ? `\n[stderr]\n${stderr}` : '')).trim(),
      COMMAND_OUTPUT_PREVIEW_CHARS,
    );
    return {
      command,
      kind,
      ok: exitCode === 0,
      exitCode,
      outputPreview: preview,
      error: exitCode === 0 ? null : `exit ${exitCode}`,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      command,
      kind,
      ok: false,
      exitCode: null,
      outputPreview: '',
      error: safeErrorMessage(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

/**
 * Parse bun test output for pass/fail/skip counts.
 * Bun test output format: "  1698 pass\n  0 fail\n  6190 expect() calls\nRan 1698 tests across 122 files. [2.83s]"
 */
function parseTestCounts(output: string): { passed: number; failed: number; skipped: number } {
  const passMatch = output.match(/(\d+)\s+pass/i);
  const failMatch = output.match(/(\d+)\s+fail/i);
  const skipMatch = output.match(/(\d+)\s+(?:skip|skipped|todo)/i);
  return {
    passed: passMatch ? parseInt(passMatch[1], 10) : 0,
    failed: failMatch ? parseInt(failMatch[1], 10) : 0,
    skipped: skipMatch ? parseInt(skipMatch[1], 10) : 0,
  };
}

/**
 * Run a QA-only inspection through the persistent worker pipeline. Returns
 * a structured proof the worker writes to the durable ledger. NEVER edits,
 * commits, pushes, deploys, or applies migrations.
 */
export async function runIVXQAOnly(
  input: IVXQAOnlyRunInput,
): Promise<IVXQAOnlyProof> {
  const goal = input.goal.trim();
  if (!goal) throw new Error('A QA-only goal is required.');

  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const jobId = `ivx-qa-${createHash('sha1').update(`${goal}:${Date.now()}`).digest('hex').slice(0, 12)}`;
  const onPhase = input.onPhase;
  const commandsRun: IVXQACommand[] = [];

  onPhase?.('queued', 'QA-only run queued.');

  // Step 1: Extract module keywords from the goal
  const keywords = extractModuleKeywords(goal);
  onPhase?.('module_identified', `Module keywords: ${keywords.join(', ') || '(none)'}`);

  // Step 2: Walk all test files
  const allTestFiles = await walkTestFiles(projectRoot);

  // Step 3: Select test files matching the module keywords
  const testFiles = selectTestFiles(keywords, allTestFiles);

  if (testFiles.length === 0) {
    // No test files matched — return BLOCKED with QA_TARGET_NOT_FOUND
    onPhase?.('blocked', 'No test files matched the module keywords.');
    const proof: IVXQAOnlyProof = {
      marker: IVX_QA_ONLY_MARKER,
      jobId,
      goal,
      mode: 'qa_only',
      finalStatus: 'BLOCKED',
      patchApplied: false,
      commitCreated: false,
      deployed: false,
      changedFiles: [],
      filesInspected: [],
      testsSelected: [],
      commandsRun: [],
      passed: 0,
      failed: 0,
      skipped: 0,
      typecheckOk: null,
      lintOk: null,
      findings: `No test files could be identified for the requested module. Keywords extracted: ${keywords.join(', ') || '(none)'}. Available test files: ${allTestFiles.length}.`,
      errorCode: 'QA_TARGET_NOT_FOUND',
      error: null,
      generatedAt: nowIso(),
      secretValuesReturned: false,
    };
    onPhase?.('blocked', 'QA_TARGET_NOT_FOUND — no test files matched.');
    return proof;
  }

  onPhase?.('tests_selected', `Selected ${testFiles.length} test file(s): ${testFiles.map((t) => t.path).join(', ')}`);

  // Step 4: Inspect source files related to the module
  const filesInspected = await inspectSourceFiles(projectRoot, keywords, allTestFiles);
  onPhase?.('files_inspected', `Inspected ${filesInspected.length} source file(s).`);

  // Step 5: Run targeted tests
  const testFilePaths = testFiles.map((t) => t.path).join(' ');
  const testCommand = `bun test ${testFilePaths}`;
  const testResult = await runCommand(projectRoot, testCommand, 'run_tests');
  commandsRun.push(testResult);
  const counts = parseTestCounts(testResult.outputPreview);
  onPhase?.('tests_executed', `Tests executed: ${counts.passed} pass, ${counts.failed} fail, ${counts.skipped} skip (exit ${testResult.exitCode}).`);

  // Step 6: Run scoped typecheck
  const typecheckCommand = 'bun x tsc --noEmit --skipLibCheck';
  const typecheckResult = await runCommand(projectRoot, typecheckCommand, 'typecheck');
  commandsRun.push(typecheckResult);
  onPhase?.('typecheck_run', `Typecheck: exit ${typecheckResult.exitCode}.`);

  // Step 7: Run lint (if eslint config exists, skip gracefully if not)
  let lintResult: IVXQACommand | null = null;
  try {
    const eslintConfig = await stat(path.join(projectRoot, '.eslintrc.cjs')).catch(() =>
      stat(path.join(projectRoot, '.eslintrc.js')).catch(() => null),
    );
    if (eslintConfig) {
      lintResult = await runCommand(projectRoot, 'bun x eslint --max-warnings 0 backend/services/ backend/api/', 'lint');
      commandsRun.push(lintResult);
      onPhase?.('lint_run', `Lint: exit ${lintResult.exitCode}.`);
    } else {
      onPhase?.('lint_run', 'Lint: skipped (no eslint config found).');
    }
  } catch {
    onPhase?.('lint_run', 'Lint: skipped (no eslint config found).');
  }

  // Step 8: Build findings
  const findings = [
    `Module keywords: ${keywords.join(', ')}`,
    `Test files selected: ${testFiles.length} (${testFiles.map((t) => t.path).join(', ')})`,
    `Tests: ${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped (exit code ${testResult.exitCode})`,
    `Typecheck: ${typecheckResult.ok ? 'PASS' : 'FAIL'} (exit code ${typecheckResult.exitCode})`,
    lintResult ? `Lint: ${lintResult.ok ? 'PASS' : 'FAIL'} (exit code ${lintResult.exitCode})` : 'Lint: not run (no eslint config)',
    `Source files inspected: ${filesInspected.length}`,
    `Files changed: 0 (QA-only mode never modifies code)`,
    `Commit: not requested (QA-only mode never commits)`,
    `Deploy: not requested (QA-only mode never deploys)`,
  ].join('\n');

  const finalStatus: IVXQAOnlyProof['finalStatus'] = testResult.ok ? 'COMPLETED' : 'FAILED';

  const proof: IVXQAOnlyProof = {
    marker: IVX_QA_ONLY_MARKER,
    jobId,
    goal,
    mode: 'qa_only',
    finalStatus,
    patchApplied: false,
    commitCreated: false,
    deployed: false,
    changedFiles: [],
    filesInspected,
    testsSelected: testFiles,
    commandsRun,
    passed: counts.passed,
    failed: counts.failed,
    skipped: counts.skipped,
    typecheckOk: typecheckResult.ok,
    lintOk: lintResult ? lintResult.ok : null,
    findings,
    errorCode: null,
    error: null,
    generatedAt: nowIso(),
    secretValuesReturned: false,
  };

  onPhase?.('completed', `QA-only run completed. ${counts.passed} pass / ${counts.failed} fail / ${counts.skipped} skip.`);
  return proof;
}

/**
 * Render the owner-mandated strict QA-only format.
 *
 *   TASK ID / MODE: QA_ONLY / FILES INSPECTED / TESTS SELECTED / COMMANDS RUN /
 *   EXIT CODES / PASSED / FAILED / SKIPPED / TYPECHECK / LINT / FINDINGS / STATUS
 */
export function buildQAOnlyAnswer(proof: IVXQAOnlyProof): string {
  if (proof.errorCode === 'QA_TARGET_NOT_FOUND') {
    return [
      `TASK ID:\n${proof.jobId}`,
      'MODE:\nQA_ONLY',
      'FILES INSPECTED:\nNONE — no module could be identified.',
      'TESTS SELECTED:\nNONE — no test files matched the requested module.',
      'COMMANDS RUN:\nNONE',
      'EXIT CODES:\nN/A',
      'PASSED:\n0',
      'FAILED:\n0',
      'SKIPPED:\n0',
      'TYPECHECK:\nNOT RUN',
      'LINT:\nNOT RUN',
      `FINDINGS:\n${proof.findings}`,
      'STATUS:\nBLOCKED',
      'ERROR CODE:\nQA_TARGET_NOT_FOUND',
    ].join('\n\n');
  }

  const filesList = proof.filesInspected.length > 0
    ? proof.filesInspected.map((f) => `${f.path} (${f.bytes} bytes)`).join('\n')
    : 'NONE';

  const testsList = proof.testsSelected.length > 0
    ? proof.testsSelected.map((t) => t.path).join('\n')
    : 'NONE';

  const commandsList = proof.commandsRun.length > 0
    ? proof.commandsRun.map((cmd) => {
        const status = cmd.ok ? 'OK' : (cmd.error ?? `exit ${cmd.exitCode ?? '?'}`);
        const preview = cmd.outputPreview ? `\n  ${cmd.outputPreview.split('\n').slice(0, 6).join('\n  ')}` : '';
        return `$ ${cmd.command} → ${status}${preview}`;
      }).join('\n')
    : 'NONE';

  const exitCodesList = proof.commandsRun.length > 0
    ? proof.commandsRun.map((cmd) => `${cmd.kind}: ${cmd.exitCode ?? 'N/A'}`).join(', ')
    : 'N/A';

  return [
    `TASK ID:\n${proof.jobId}`,
    'MODE:\nQA_ONLY',
    `FILES INSPECTED:\n${filesList}`,
    `TESTS SELECTED:\n${testsList}`,
    `COMMANDS RUN:\n${commandsList}`,
    `EXIT CODES:\n${exitCodesList}`,
    `PASSED:\n${proof.passed}`,
    `FAILED:\n${proof.failed}`,
    `SKIPPED:\n${proof.skipped}`,
    `TYPECHECK:\n${proof.typecheckOk === null ? 'NOT RUN' : proof.typecheckOk ? 'PASS' : 'FAIL'}`,
    `LINT:\n${proof.lintOk === null ? 'NOT RUN' : proof.lintOk ? 'PASS' : 'FAIL'}`,
    `FINDINGS:\n${proof.findings}`,
    `STATUS:\n${proof.finalStatus}`,
  ].join('\n\n');
}
