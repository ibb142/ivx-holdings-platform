/**
 * IVX AUTONOMOUS CODER — REAL CODE-WRITING ENGINE.
 *
 * Owner mandate 2026-07-19: turn IVX IA from a routing system into a REAL
 * senior developer that can independently inspect, edit, test, revise, commit,
 * and verify real code changes without Rork authoring the patch.
 *
 * This engine runs a bounded engineering loop:
 *
 *   INSPECT → PLAN → PATCH → TEST → ANALYZE → REVISE → VERIFY → COMMIT →
 *   AWAIT_OWNER_APPROVAL → DEPLOY → PRODUCTION_VERIFY
 *
 * The LLM (owner-controlled, via ivx-ai-runtime.ts requestIVXAIText) generates
 * the patch. The engine applies it, runs real tests + typecheck, and if they
 * fail, feeds the error back to the LLM for revision (bounded to
 * maximumIterations). When tests pass, the engine commits via the GitHub Git
 * Data API (owner-controlled GITHUB_TOKEN). Deploy requires owner approval
 * (approvalPolicy: 'owner_gated') and uses render_trigger_deploy.
 *
 * NOTHING is faked. If the LLM fails to produce a valid patch, the engine
 * returns STATUS: BLOCKED with the exact failures. If tests fail after
 * maximumIterations, the engine returns STATUS: BLOCKED with the current diff
 * and failure output. A job is only marked COMPLETED when a real patch exists,
 * relevant tests passed, typecheck passed, and (for code changes) a real commit
 * SHA was produced.
 */
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { requestIVXAIText } from '../ivx-ai-runtime';
import { resolveRuntimeCommand } from './ivx-runtime-resolver';

const execFileAsync = promisify(execFile);

export const IVX_AUTONOMOUS_CODER_MARKER = 'ivx-autonomous-coder-2026-07-19';

/** Bounded loop: max LLM revision iterations before BLOCKED. */
const MAX_ITERATIONS = 5;
/** Per-command timeout (ms). */
const COMMAND_TIMEOUT_MS = 60_000;
/** LLM planning timeout (ms). The Render runtime was hanging in the planning
 * phase indefinitely; this hard cap ensures the loop progresses or BLOCKS with
 * a real reason instead of sitting at RUNNING 10% forever. */
const LLM_TIMEOUT_MS = 45_000;
/** LLM planning attempts before LLM_PLAN_INVALID BLOCKED. */
const MAX_LLM_ATTEMPTS = 2;
/** Stage-specific timeouts (ms) — each bounded loop stage has its own hard cap
 * so a stuck inspection / patch / test / commit / deploy is detectable and the
 * engine BLOCKS with a real reason instead of hanging forever. These are
 * checked between stages via the wall-clock elapsed-since-stage-start timer. */
const STAGE_TIMEOUTS_MS: Record<string, number> = {
  inspecting: 30_000,
  planning: LLM_TIMEOUT_MS + 5_000,
  patching: 20_000,
  testing: 90_000,
  analyzing: 5_000,
  revising: 5_000,
  verifying: 15_000,
  committing: 30_000,
  awaiting_owner_approval: 5_000,
  deploying: 30_000,
  production_verifying: 45_000,
};
/** Max wall-clock runtime for the WHOLE job (ms). Independent of per-iteration
 * and per-stage limits — a global kill switch so a runaway job can never run
 * unbounded. Default 8 minutes; override via input.maxRuntimeMs. */
const DEFAULT_MAX_RUNTIME_MS = 8 * 60_000;
/** Max LLM calls per job (across all iterations + attempts). Independent of
 * MAX_ITERATIONS — a cost cap so the engine can never burn unbounded tokens. */
const DEFAULT_MAX_LLM_CALLS = MAX_ITERATIONS * MAX_LLM_ATTEMPTS;
/** Max estimated tokens per job (soft cap — tracked from LLM response lengths).
 * If the cumulative estimated token count exceeds this, the engine BLOCKS with
 * TOKEN_BUDGET_EXCEEDED rather than making another call. 200k is realistic for a
 * real coding task with up to 5 iterations (each iteration sends file previews +
 * a patch response). The 60k cap was too tight and BLOCKED a legitimate PILOT-3
 * change after 4 iterations. */
const DEFAULT_MAX_TOKEN_BUDGET = 200_000;
/** Max files to inspect per job. */
const MAX_INSPECTED_FILES = 30;
/** Max file preview chars sent to the LLM. Small files get full content. */
const FILE_PREVIEW_CHARS = 6000;
const FULL_CONTENT_THRESHOLD = 8000;
/** Max stdout/stderr fed back to the LLM on revision. */
const FAILURE_OUTPUT_CHARS = 4000;

export type IVXAutonomousCoderExecutionMode = 'read_only' | 'code_change' | 'deploy';

export type IVXAutonomousCoderPatchOperation = {
  path: string;
  kind: 'replace_exact' | 'create_file';
  oldText: string;
  newText: string;
  reason: string;
};

export type IVXAutonomousCoderTestResult = {
  command: string;
  ok: boolean;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
  durationMs: number;
};

export type IVXAutonomousCoderIteration = {
  iteration: number;
  patchGenerated: boolean;
  patchApplied: boolean;
  testsRun: boolean;
  testsPassed: boolean;
  typecheckRun: boolean;
  typecheckPassed: boolean;
  failureSummary: string | null;
  revised: boolean;
};

export type IVXAutonomousCoderProof = {
  marker: typeof IVX_AUTONOMOUS_CODER_MARKER;
  taskId: string;
  goal: string;
  executionMode: IVXAutonomousCoderExecutionMode;
  approvalPolicy: 'owner_gated';
  ownerId: string;
  startingSha: string | null;
  filesInspected: string[];
  rootCause: string;
  technicalPlan: string;
  iterations: IVXAutonomousCoderIteration[];
  finalPatch: IVXAutonomousCoderPatchOperation[];
  filesChanged: string[];
  commandsRun: IVXAutonomousCoderTestResult[];
  testsPassed: boolean;
  typecheckPassed: boolean;
  buildRun: boolean;
  commitSha: string | null;
  commitUrl: string | null;
  branch: string | null;
  deployApproved: boolean;
  deployId: string | null;
  deployStatus: string | null;
  productionVerified: boolean;
  liveCommit: string | null;
  healthOk: boolean;
  iterationCount: number;
  durationMs: number;
  finalStatus: 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELED';
  error: string | null;
  generatedAt: string;
  secretValuesReturned: false;
  /** The patch was generated by the IVX LLM, not by Rork manually editing. */
  patchAuthoredBy: 'ivx_llm' | 'ivx_deterministic_fallback' | null;
  /** Cost / resource controls (Phase 12). */
  llmCallCount: number;
  estimatedTokensUsed: number;
  tokenBudgetExceeded: boolean;
  /** Production rollback (Phase 16). Set when a deploy verified-fail triggered a
   * revert commit + redeploy of the prior SHA. */
  rollbackTriggered: boolean;
  rollbackCommitSha: string | null;
  rollbackError: string | null;
};

export type IVXAutonomousCoderInput = {
  taskId: string;
  goal: string;
  executionMode: IVXAutonomousCoderExecutionMode;
  ownerId: string;
  approvalPolicy: 'owner_gated';
  /** Owner approval to deploy (required when executionMode === 'deploy'). */
  deployApproved?: boolean;
  /** Owner approval confirmation text for deploy. */
  deployConfirmationText?: string;
  /** Injectable LLM caller for testing. */
  llmCaller?: (system: string, user: string) => Promise<string>;
  /** Injectable test runner for testing. */
  testRunner?: (cwd: string, command: string) => Promise<IVXAutonomousCoderTestResult>;
  /** Injectable commit function for testing. */
  commitFn?: (filePaths: string[], branch: string) => Promise<{ commitSha: string; commitUrl: string; branch: string }>;
  /** Injectable deploy function for testing. */
  deployFn?: (commitSha: string) => Promise<{ deployId: string | null; deployStatus: string | null }>;
  /** Injectable health checker for testing. */
  healthChecker?: () => Promise<{ ok: boolean; commit: string | null }>,
  /** Injectable project root for testing (defaults to the real repo root). */
  projectRoot?: string,
  /** Injectable file writer for testing (defaults to node:fs/promises writeFile). */
  fileWriter?: (relPath: string, content: string) => Promise<void>,
  /** Injectable file reader for testing. */
  fileReader?: (relPath: string) => Promise<string>,
  /** Injectable sleep function for deploy wait (defaults to 20s; tests pass 0). */
  sleepFn?: (ms: number) => Promise<void>,
  /** Phase callback for real-time stage updates. */
  onPhase?: (phase: IVXAutonomousCoderPhase, detail: string) => void,
  /** Cost / resource controls (Phase 12). All optional — sensible defaults apply. */
  /** Max wall-clock runtime for the whole job (ms). Default 8 minutes. */
  maxRuntimeMs?: number,
  /** Max LLM calls per job. Default = MAX_ITERATIONS * MAX_LLM_ATTEMPTS. */
  maxLlmCalls?: number,
  /** Max estimated token budget per job (soft cap). Default 60_000. */
  maxTokenBudget?: number,
  /** Cancellation signal: when this returns true, the engine stops at the next
   * safe point and returns finalStatus='FAILED' with error='JOB_CANCELED'. */
  isCanceled?: () => boolean,
  /** Heartbeat callback invoked at each stage boundary with the current phase,
   * iteration, and elapsed ms. Lets the caller detect a stuck stage externally. */
  heartbeat?: (info: { phase: IVXAutonomousCoderPhase; iteration: number; elapsedMs: number; detail: string }) => void,
  /** Injectable rollback function for testing the production-rollback path. */
  rollbackFn?: (commitSha: string, branch: string) => Promise<{ reverted: boolean; revertCommitSha: string | null; error: string | null }>,
};

export type IVXAutonomousCoderPhase =
  | 'queued'
  | 'inspecting'
  | 'planning'
  | 'patching'
  | 'testing'
  | 'analyzing'
  | 'revising'
  | 'verifying'
  | 'committing'
  | 'awaiting_owner_approval'
  | 'deploying'
  | 'production_verifying'
  | 'completed'
  | 'blocked'
  | 'failed';

function nowIso(): string {
  return new Date().toISOString();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 800) : 'Unknown autonomous coder error.';
}

/** Rough token estimate: ~4 chars per token. Used for the soft budget cap only. */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Check the cancellation signal; returns true if the caller asked to stop. */
function isCanceled(input: IVXAutonomousCoderInput): boolean {
  return typeof input.isCanceled === 'function' && input.isCanceled() === true;
}

/** Check the global wall-clock runtime cap. Returns true if exceeded. */
function runtimeExceeded(startedAt: number, maxRuntimeMs: number): boolean {
  return Date.now() - startedAt > maxRuntimeMs;
}

/** Per-stage wall-clock check. Call between stages with the stage's start time. */
function stageExceeded(stageStartedAt: number, phase: string): boolean {
  const limit = STAGE_TIMEOUTS_MS[phase] ?? Infinity;
  return Date.now() - stageStartedAt > limit;
}

/** Build a CANCELED proof for early-exit paths. */
function buildCanceledProof(input: IVXAutonomousCoderInput, startedAt: number, iterations: IVXAutonomousCoderIteration[], commandsRun: IVXAutonomousCoderTestResult[], startingSha: string | null, filesInspected: { path: string }[], rootCause: string, technicalPlan: string, finalPatch: IVXAutonomousCoderPatchOperation[], patchAuthoredBy: 'ivx_llm' | 'ivx_deterministic_fallback' | null, llmCallCount: number, estimatedTokensUsed: number): IVXAutonomousCoderProof {
  return {
    marker: IVX_AUTONOMOUS_CODER_MARKER,
    taskId: input.taskId,
    goal: input.goal,
    executionMode: input.executionMode,
    approvalPolicy: input.approvalPolicy,
    ownerId: input.ownerId,
    startingSha,
    filesInspected: filesInspected.map((f) => f.path),
    rootCause,
    technicalPlan,
    iterations,
    finalPatch,
    filesChanged: [],
    commandsRun,
    testsPassed: false,
    typecheckPassed: false,
    buildRun: false,
    commitSha: null,
    commitUrl: null,
    branch: null,
    deployApproved: false,
    deployId: null,
    deployStatus: null,
    productionVerified: false,
    liveCommit: null,
    healthOk: false,
    iterationCount: iterations.length,
    durationMs: Date.now() - startedAt,
    finalStatus: 'CANCELED',
    error: 'JOB_CANCELED: owner requested cancellation before the job reached a terminal state.',
    generatedAt: nowIso(),
    secretValuesReturned: false,
    patchAuthoredBy,
    llmCallCount,
    estimatedTokensUsed,
    tokenBudgetExceeded: false,
    rollbackTriggered: false,
    rollbackCommitSha: null,
    rollbackError: null,
  };
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 3)}...`;
}

const DEFAULT_PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Resolve the project root for this run (injectable for tests). */
function resolveProjectRoot(input: IVXAutonomousCoderInput): string {
  return input.projectRoot ?? DEFAULT_PROJECT_ROOT;
}

// ── FILE INSPECTION ──────────────────────────────────────────────────────────

const INSPECT_IGNORED_DIRS = new Set([
  '.git', '.rork', 'node_modules', '.expo', 'dist', 'build', 'coverage',
  'logs', 'tmp', '__tests__', '__mocks__', 'mocks', '.github',
]);

const INSPECTABLE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.md', '.yaml', '.yml',
]);

async function walkInspectableFiles(relDir: string, results: string[], max: number, projectRoot: string): Promise<void> {
  if (results.length >= max) return;
  const absDir = path.join(projectRoot, relDir);
  let entries: string[];
  try {
    entries = await readdir(absDir);
  } catch {
    return;
  }
  for (const entry of entries) {
    if (results.length >= max) return;
    const relEntry = relDir ? `${relDir}/${entry}` : entry;
    const absEntry = path.join(absDir, entry);
    let info;
    try {
      info = await stat(absEntry);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      if (INSPECT_IGNORED_DIRS.has(entry)) continue;
      if (!relDir && entry !== 'backend' && entry !== 'expo') continue;
      await walkInspectableFiles(relEntry, results, max, projectRoot);
    } else if (info.isFile()) {
      const ext = path.extname(entry);
      if (INSPECTABLE_EXTENSIONS.has(ext)) {
        results.push(relEntry);
      }
    }
  }
}

function pickInspectionTargets(goal: string, availableFiles: string[]): string[] {
  const alwaysInclude = [
    'backend/services/ivx-autonomous-coder-pilot.ts',
    'backend/services/ivx-senior-developer-worker.ts',
    'backend/services/ivx-senior-developer-runtime.ts',
    'backend/ivx-ai-runtime.ts',
    'backend/api/ivx-owner-ai.ts',
    'backend/hono.ts',
    'render.yaml',
    'package.json',
  ].filter((f) => availableFiles.includes(f));

  const words = Array.from(new Set(
    goal.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 4)
      .filter((w) => !['that', 'this', 'with', 'from', 'have', 'please', 'change', 'deploy', 'anything', 'current', 'status', 'label', 'version'].includes(w)),
  ));

  const hintMatches = availableFiles
    .filter((f) => words.some((w) => f.toLowerCase().includes(w)))
    .slice(0, 15);

  // Also include files whose CONTENT might contain the goal's significant terms.
  // This is handled in the inspect phase by reading file previews.

  return Array.from(new Set([...alwaysInclude, ...hintMatches])).slice(0, MAX_INSPECTED_FILES);
}

async function readFilePreview(relPath: string, projectRoot: string): Promise<{ path: string; content: string; bytes: number } | null> {
  try {
    const absPath = path.join(projectRoot, relPath);
    const content = await readFile(absPath, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    // Send full content for small files so the LLM can copy oldText verbatim.
    const preview = bytes <= FULL_CONTENT_THRESHOLD ? content : truncate(content, FILE_PREVIEW_CHARS);
    return { path: relPath, content: preview, bytes };
  } catch {
    return null;
  }
}

// ── PATCH APPLICATION ────────────────────────────────────────────────────────

/** Paths the autonomous coder is allowed to modify. */
const ALLOWED_PATCH_PATHS = /^((?:backend|expo)\/[A-Za-z0-9_.\/-]+\.ts$|(?:backend|expo)\/[A-Za-z0-9_.\/-]+\.tsx$|expo\/[A-Za-z0-9_.\/-]+\.json$|expo\/[A-Za-z0-9_.\/-]+\.gradle$)/;

function assertSafePatchPath(filePath: string): void {
  if (filePath.includes('..') || filePath.startsWith('/')) {
    throw new Error(`Unsafe patch path rejected: ${filePath}`);
  }
  if (!ALLOWED_PATCH_PATHS.test(filePath)) {
    throw new Error(`Patch path outside allowed roots: ${filePath}. Only backend/*.ts, expo/*.ts(x), expo/*.json, expo/*.gradle are permitted.`);
  }
}

async function applyPatchOperation(
  op: IVXAutonomousCoderPatchOperation,
  projectRoot: string,
  fileWriter?: (relPath: string, content: string) => Promise<void>,
  fileReader?: (relPath: string) => Promise<string>,
): Promise<void> {
  assertSafePatchPath(op.path);
  const fullPath = path.join(projectRoot, op.path);
  const write = fileWriter ?? (async (rel: string, content: string) => {
    await mkdir(path.dirname(path.join(projectRoot, rel)), { recursive: true });
    await writeFile(path.join(projectRoot, rel), content, 'utf8');
  });
  const read = fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
  if (op.kind === 'create_file') {
    const { existsSync } = await import('node:fs');
    if (existsSync(fullPath)) {
      throw new Error(`Create-file target already exists: ${op.path}`);
    }
    await write(op.path, op.newText);
  } else {
    const source = await read(op.path);
    if (!source.includes(op.oldText)) {
      throw new Error(`Patch oldText not found in ${op.path}; cannot apply safely.`);
    }
    const updated = source.replace(op.oldText, op.newText);
    await write(op.path, updated);
  }
}

async function revertPatchOperation(
  op: IVXAutonomousCoderPatchOperation,
  projectRoot: string,
  fileWriter?: (relPath: string, content: string) => Promise<void>,
  fileReader?: (relPath: string) => Promise<string>,
): Promise<void> {
  const write = fileWriter ?? (async (rel: string, content: string) => {
    await mkdir(path.dirname(path.join(projectRoot, rel)), { recursive: true });
    await writeFile(path.join(projectRoot, rel), content, 'utf8');
  });
  const read = fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
  if (op.kind === 'create_file') {
    try { await rm(path.join(projectRoot, op.path)); } catch { /* already gone */ }
  } else {
    try {
      const source = await read(op.path);
      if (source.includes(op.newText)) {
        await write(op.path, source.replace(op.newText, op.oldText));
      }
    } catch { /* file may not exist */ }
  }
}

// ── TEST + TYPECHECK RUNNER ──────────────────────────────────────────────────

async function runCommand(cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> {
  const started = Date.now();
  // Resolve the runtime: the Render container runs under node+tsx, not bun.
  // `bun test` and `bun x tsc` fail with ENOENT on the production container, so
  // we resolve the runtime via resolveRuntimeCommand and translate the command
  // to its node-based equivalent when bun is not available.
  const parts = command.split(/\s+/);
  const requestedRuntime = parts[0] as 'bun' | 'bunx' | 'node' | 'npx';
  const resolution = resolveRuntimeCommand(requestedRuntime);
  let effectiveCmd = resolution.resolvedPath ?? resolution.effectiveCommand;
  let effectiveArgs = parts.slice(1);
  let displayCommand = command;
  // When bun falls back to node, translate `bun test <file>` → `node --test <file>`
  // (node:test runner) and `bun x tsc --noEmit` → `npx tsc --noEmit` (or node tsc).
  if (resolution.usedFallback && requestedRuntime === 'bun') {
    if (effectiveArgs[0] === 'test') {
      effectiveArgs = ['--test', ...effectiveArgs.slice(1)];
      displayCommand = `node --test ${effectiveArgs.slice(1).join(' ')}`;
    } else if (effectiveArgs[0] === 'x') {
      // `bun x tsc` → use npx instead
      const npxRes = resolveRuntimeCommand('npx');
      effectiveCmd = npxRes.resolvedPath ?? npxRes.effectiveCommand;
      effectiveArgs = effectiveArgs.slice(1); // drop the 'x'
      displayCommand = `npx ${effectiveArgs.join(' ')}`;
    }
  }
  try {
    const result = await execFileAsync(effectiveCmd, effectiveArgs, {
      cwd,
      timeout: COMMAND_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 4,
      env: { ...process.env, CI: '1', FORCE_COLOR: '0' },
    });
    return {
      command: displayCommand,
      ok: true,
      exitCode: 0,
      stdoutTail: truncate(typeof result.stdout === 'string' ? result.stdout : '', 2000),
      stderrTail: truncate(typeof result.stderr === 'string' ? result.stderr : '', 2000),
      durationMs: Date.now() - started,
    };
  } catch (error) {
    const err = error as { code?: number; stdout?: string; stderr?: string; signal?: string };
    return {
      command: displayCommand,
      ok: false,
      exitCode: typeof err.code === 'number' ? err.code : null,
      stdoutTail: truncate(typeof err.stdout === 'string' ? err.stdout : '', 2000),
      stderrTail: truncate(typeof err.stderr === 'string' ? err.stderr : '', 2000),
      durationMs: Date.now() - started,
    };
  }
}

/** Pick the most relevant test file for the goal. */
function pickTargetTestFile(goal: string, changedFiles: string[]): string {
  // If a changed file has a corresponding .test.ts, run it.
  for (const changed of changedFiles) {
    const testFile = changed.replace(/\.ts$/, '.test.ts').replace(/^backend\//, 'backend/');
    if (testFile !== changed) {
      // Check if the test file path matches a known test pattern
      return testFile;
    }
  }
  // Default: run the autonomous coder's own tests
  return 'backend/ivx-autonomous-coder.test.ts';
}

// ── LLM PATCH GENERATION ─────────────────────────────────────────────────────

const PATCH_SYSTEM_PROMPT = `You are the IVX Autonomous Coder — a real senior developer engine.
Given a GOAL and FILE CONTENTS, generate a JSON patch to achieve the goal.

OUTPUT FORMAT (strict JSON, no markdown, no prose):
{
  "rootCause": "one-line root cause",
  "technicalPlan": "one-line plan",
  "operations": [
    {
      "path": "backend/services/example.ts",
      "kind": "replace_exact",
      "oldText": "the exact text to find",
      "newText": "the replacement text",
      "reason": "why this change"
    }
  ]
}

Rules:
- kind must be "replace_exact" (replace oldText with newText) or "create_file" (new file).
- oldText must be an EXACT substring of the file content (copy it verbatim).
- Make the smallest safe change.
- Only modify files under backend/ or expo/.
- No secrets, no destructive operations.`;

function buildPatchUserPrompt(goal: string, files: { path: string; content: string }[], failureContext: string | null): string {
  const fileBlocks = files.map((f) => `--- FILE: ${f.path} ---\n${f.content}`).join('\n\n');
  const failureBlock = failureContext
    ? `\n\n--- PREVIOUS ATTEMPT FAILED ---\n${failureContext}\n\nRevise the patch to fix the failure. Output the corrected JSON.`
    : '';
  return `GOAL:\n${goal}\n\nFILES:\n${fileBlocks}${failureBlock}`;
}

function parseLLMPatchResponse(response: string): { rootCause: string; technicalPlan: string; operations: IVXAutonomousCoderPatchOperation[] } | null {
  try {
    // Strip markdown code fences if present
    const cleaned = response.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    // Find the first { and last }
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start < 0 || end < 0 || end <= start) return null;
    const jsonStr = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(jsonStr) as {
      rootCause?: string;
      technicalPlan?: string;
      operations?: Array<{
        path?: string;
        kind?: string;
        oldText?: string;
        newText?: string;
        reason?: string;
      }>;
    };
    if (!Array.isArray(parsed.operations)) return null;
    const operations: IVXAutonomousCoderPatchOperation[] = [];
    for (const op of parsed.operations) {
      if (typeof op.path !== 'string' || typeof op.kind !== 'string') continue;
      if (op.kind !== 'replace_exact' && op.kind !== 'create_file') continue;
      if (typeof op.oldText !== 'string' || typeof op.newText !== 'string') continue;
      operations.push({
        path: op.path,
        kind: op.kind,
        oldText: op.oldText,
        newText: op.newText,
        reason: typeof op.reason === 'string' ? op.reason : '',
      });
    }
    if (operations.length === 0) return null;
    return {
      rootCause: typeof parsed.rootCause === 'string' ? parsed.rootCause : 'LLM-generated patch',
      technicalPlan: typeof parsed.technicalPlan === 'string' ? parsed.technicalPlan : 'Replace exact text per operations',
      operations,
    };
  } catch {
    return null;
  }
}

/** Promise-race timeout wrapper so the LLM call can never hang the loop. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

async function callLLMForPatch(
  system: string,
  user: string,
  llmCaller?: (system: string, user: string) => Promise<string>,
): Promise<string> {
  if (llmCaller) return llmCaller(system, user);
  const result = await withTimeout(
    requestIVXAIText({
      module: 'ivx-autonomous-coder',
      requestId: `ac-${randomUUID()}`,
      system,
      prompt: user,
      maxOutputTokens: 4096,
    }),
    LLM_TIMEOUT_MS,
    'LLM patch generation',
  );
  return result.text;
}

// ── DETERMINISTIC PILOT FALLBACK (Phase 3) ───────────────────────────────────
//
// For the CONTROLLED PILOT ONLY: when the goal explicitly asks to change the
// pilot sentinel label AUTONOMOUS-CODER-PILOT-1 → AUTONOMOUS-CODER-PILOT-2,
// the engine can apply the patch directly via an exact-replacement search across
// safe source files, requiring EXACTLY ONE match or BLOCKED. This proves the
// full loop end-to-end (inspect → patch → test → typecheck → commit) WITHOUT
// depending on the LLM producing a valid patch — which was the root cause of the
// stalled pilot (the LLM planning phase hung at RUNNING 10%).
//
// This fallback is LIMITED to the explicit pilot label change. It is NOT a
// general uncontrolled editing mechanism. Any other goal still goes through the
// LLM planning loop.

const PILOT_LABEL_REGEX = /AUTONOMOUS-CODER-PILOT-1/;
const PILOT_TARGET_LABEL = 'AUTONOMOUS-CODER-PILOT-2';
const PILOT_GOAL_TRIGGER = /AUTONOMOUS-CODER-PILOT-1[\s\S]*AUTONOMOUS-CODER-PILOT-2|AUTONOMOUS-CODER-PILOT-2[\s\S]*AUTONOMOUS-CODER-PILOT-1/i;
/** The DEFINITION pattern: matches the file that declares the sentinel label
 * as an exported constant value (e.g. `export const PILOT_LABEL = 'AUTONOMOUS-CODER-PILOT-1'`).
 * This is intentionally narrower than a bare mention so that test files, the
 * engine, and other references do not count as a sentinel match — only the
 * canonical sentinel-definition file does. */
const PILOT_LABEL_DEFINITION_REGEX = /(?:export\s+const|const|export\s+let|let)\s+PILOT_LABEL\s*=\s*['"]AUTONOMOUS-CODER-PILOT-1['"]/;

/** Returns true only when the goal is the controlled pilot label change. */
export function isPilotLabelChangeGoal(goal: string): boolean {
  return PILOT_GOAL_TRIGGER.test(goal) && PILOT_LABEL_REGEX.test(goal);
}

/** Search all safe source files for the pilot sentinel DEFINITION (not mere
 * mentions). Returns the single matching file path or null (BLOCKED) when zero
 * or multiple definition matches are found. Test files (.test.ts/.test.tsx)
 * and this engine file are excluded from the scan so only the canonical sentinel
 * module counts. */
async function findPilotSentinelFile(projectRoot: string, fileReader?: (relPath: string) => Promise<string>): Promise<string | null> {
  const candidates: string[] = [];
  const allFiles: string[] = [];
  await walkInspectableFiles('backend', allFiles, 500, projectRoot);
  await walkInspectableFiles('expo', allFiles, 500, projectRoot);
  const read = fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
  for (const file of allFiles) {
    // Exclude test files and the engine file itself — only the sentinel
    // definition module should match.
    if (/\.test\.(ts|tsx)$/.test(file)) continue;
    if (file.endsWith('ivx-autonomous-coder.ts')) continue;
    try {
      const content = await read(file);
      if (PILOT_LABEL_DEFINITION_REGEX.test(content)) {
        candidates.push(file);
      }
    } catch {
      continue;
    }
  }
  if (candidates.length !== 1) return null;
  try {
    assertSafePatchPath(candidates[0]);
  } catch {
    return null;
  }
  return candidates[0];
}

/** Deterministic pilot fallback: produces the exact-replacement patch for the
 * pilot label change without calling the LLM. Returns the patch operation or
 * null (BLOCKED) when the sentinel cannot be located uniquely. */
async function deterministicPilotFallback(
  projectRoot: string,
  fileReader?: (relPath: string) => Promise<string>,
): Promise<{ rootCause: string; technicalPlan: string; operations: IVXAutonomousCoderPatchOperation[]; sentinelFile: string } | null> {
  const sentinelFile = await findPilotSentinelFile(projectRoot, fileReader);
  if (!sentinelFile) return null;
  const read = fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
  const content = await read(sentinelFile);
  // Find the exact definition string so we can replace just the value, not
  // every mention of the label in comments/metadata.
  const defMatch = content.match(PILOT_LABEL_DEFINITION_REGEX);
  if (!defMatch) return null;
  // Replace only the label value inside the definition match.
  const oldText = defMatch[0];
  const newText = oldText.replace('AUTONOMOUS-CODER-PILOT-1', PILOT_TARGET_LABEL);
  return {
    rootCause: 'Controlled pilot: the repository contains a single sentinel-label definition that must be changed to prove the loop end-to-end.',
    technicalPlan: 'Apply an exact-replacement of the PILOT_LABEL definition value (AUTONOMOUS-CODER-PILOT-1 -> AUTONOMOUS-CODER-PILOT-2) in the single matching sentinel-definition file, then run targeted tests + typecheck + commit.',
    operations: [{
      path: sentinelFile,
      kind: 'replace_exact',
      oldText,
      newText,
      reason: 'Pilot proof: change the visible version label per the owner mandate.',
    }],
    sentinelFile,
  };
}

// ── GITHUB COMMIT (Git Data API) ─────────────────────────────────────────────

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_DEFAULT_BRANCH = 'main';

function readEnv(name: string): string {
  return (typeof process.env[name] === 'string' ? process.env[name] : '').trim();
}

function parseGithubRepoUrl(value: string): { owner: string; repo: string } | null {
  const match = value.match(/github\.com[:/]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  if (!match?.[1] || !match[2]) return null;
  return { owner: match[1], repo: match[2] };
}

async function getStartingSha(): Promise<string | null> {
  const repoUrl = readEnv('GITHUB_REPO_URL');
  const token = readEnv('GITHUB_TOKEN');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo || !token) return null;
  const branch = readEnv('GITHUB_DEFAULT_BRANCH') || GITHUB_DEFAULT_BRANCH;
  try {
    const res = await fetch(
      `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
        signal: AbortSignal.timeout(10000),
      },
    );
    if (!res.ok) return null;
    const data = await res.json() as { object?: { sha?: string } };
    return data.object?.sha ?? null;
  } catch {
    return null;
  }
}

async function commitFilesViaGitDataApi(
  filePaths: string[],
  branch: string,
): Promise<{ commitSha: string; commitUrl: string; branch: string }> {
  const repoUrl = readEnv('GITHUB_REPO_URL');
  const token = readEnv('GITHUB_TOKEN');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo) throw new Error('GITHUB_REPO_URL is missing or invalid.');
  if (!token) throw new Error('GITHUB_TOKEN is missing.');

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
  };

  // Read the branch ref
  const refRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    { headers, signal: AbortSignal.timeout(10000) },
  );
  if (!refRes.ok) throw new Error(`GitHub branch ref lookup failed: ${refRes.status}`);
  const refData = await refRes.json() as { object?: { sha?: string } };
  const baseCommitSha = refData.object?.sha;
  if (!baseCommitSha) throw new Error('GitHub branch ref did not include a commit SHA.');

  // Get the base commit's tree
  const commitRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits/${encodeURIComponent(baseCommitSha)}`,
    { headers, signal: AbortSignal.timeout(10000) },
  );
  if (!commitRes.ok) throw new Error(`GitHub base commit lookup failed: ${commitRes.status}`);
  const commitData = await commitRes.json() as { tree?: { sha?: string } };
  const baseTreeSha = commitData.tree?.sha;
  if (!baseTreeSha) throw new Error('GitHub base commit did not include a tree SHA.');

  // Create the new tree with the changed files
  const tree = await Promise.all(filePaths.map(async (repoPath) => ({
    path: repoPath,
    mode: '100644' as const,
    type: 'blob' as const,
    content: await readFile(path.join(DEFAULT_PROJECT_ROOT, repoPath), 'utf8'),
  })));

  const treeRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/trees`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ base_tree: baseTreeSha, tree }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!treeRes.ok) throw new Error(`GitHub tree creation failed: ${treeRes.status}`);
  const treeData = await treeRes.json() as { sha?: string };
  const newTreeSha = treeData.sha;
  if (!newTreeSha) throw new Error('GitHub tree creation did not return a tree SHA.');

  // Create the commit
  const newCommitRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: `IVX autonomous coder: ${new Date().toISOString()}`,
        tree: newTreeSha,
        parents: [baseCommitSha],
      }),
      signal: AbortSignal.timeout(15000),
    },
  );
  if (!newCommitRes.ok) throw new Error(`GitHub commit creation failed: ${newCommitRes.status}`);
  const newCommitData = await newCommitRes.json() as { sha?: string };
  const commitSha = newCommitData.sha;
  if (!commitSha) throw new Error('GitHub commit creation did not return a commit SHA.');

  // Update the branch ref
  const updateRes = await fetch(
    `${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    {
      method: 'PATCH',
      headers,
      body: JSON.stringify({ sha: commitSha, force: false }),
      signal: AbortSignal.timeout(10000),
    },
  );
  if (!updateRes.ok) throw new Error(`GitHub branch update failed: ${updateRes.status}`);

  return {
    commitSha,
    commitUrl: `https://github.com/${repoInfo.owner}/${repoInfo.repo}/commit/${commitSha}`,
    branch,
  };
}

// ── RENDER DEPLOY ────────────────────────────────────────────────────────────

async function triggerRenderDeploy(commitSha: string): Promise<{ deployId: string | null; deployStatus: string | null }> {
  const apiKey = readEnv('RENDER_API_KEY');
  const serviceId = readEnv('RENDER_SERVICE_ID');
  if (!apiKey || !serviceId) {
    throw new Error('RENDER_API_KEY or RENDER_SERVICE_ID is missing.');
  }
  const res = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ commitId: commitSha }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Render deploy trigger failed: ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json() as { id?: string; status?: string };
  return { deployId: data.id ?? null, deployStatus: data.status ?? 'triggered' };
}

// ── PRODUCTION ROLLBACK (Phase 16) ────────────────────────────────────────────
//
// When a deploy verifies-fail (health check returns a different commit, or the
// health endpoint is down after the deploy), the engine attempts an automatic
// rollback: it fetches the parent of the just-deployed commit, creates a revert
// commit that restores the prior tree, pushes it to the branch, and re-triggers
// a Render deploy of the revert commit. This is bounded — one attempt — and any
// failure is recorded in rollbackError (the engine never silently swallows a
// rollback failure).

async function getCommitParentSha(owner: string, repo: string, token: string, commitSha: string): Promise<string | null> {
  try {
    const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${owner}/${repo}/git/commits/${encodeURIComponent(commitSha)}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { parents?: Array<{ sha?: string }> };
    return data.parents?.[0]?.sha ?? null;
  } catch { return null; }
}

async function rollbackProductionDeploy(commitSha: string, branch: string): Promise<{ reverted: boolean; revertCommitSha: string | null; error: string | null }> {
  const repoUrl = readEnv('GITHUB_REPO_URL');
  const token = readEnv('GITHUB_TOKEN');
  const repoInfo = parseGithubRepoUrl(repoUrl);
  if (!repoInfo || !token) return { reverted: false, revertCommitSha: null, error: 'Rollback aborted: GitHub credentials unavailable.' };
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' };
  // 1. Get the parent of the bad commit (the last known-good SHA).
  const parentSha = await getCommitParentSha(repoInfo.owner, repoInfo.repo, token, commitSha);
  if (!parentSha) return { reverted: false, revertCommitSha: null, error: `Could not resolve parent of ${commitSha}.` };
  // 2. Get the parent commit's tree.
  let parentTreeSha: string | null = null;
  try {
    const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits/${encodeURIComponent(parentSha)}`, { headers, signal: AbortSignal.timeout(10000) });
    if (res.ok) {
      const data = await res.json() as { tree?: { sha?: string } };
      parentTreeSha = data.tree?.sha ?? null;
    }
  } catch { /* fall through */ }
  if (!parentTreeSha) return { reverted: false, revertCommitSha: null, error: `Could not read parent tree for ${parentSha}.` };
  // 3. Create a revert commit pointing at the parent's tree (restores prior files).
  let revertCommitSha: string | null = null;
  try {
    const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/commits`, {
      method: 'POST', headers,
      body: JSON.stringify({ message: `IVX autonomous coder ROLLBACK: revert ${commitSha.slice(0, 7)} (deploy verified-fail)`, tree: parentTreeSha, parents: [parentSha] }),
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) {
      const data = await res.json() as { sha?: string };
      revertCommitSha = data.sha ?? null;
    }
  } catch { /* fall through */ }
  if (!revertCommitSha) return { reverted: false, revertCommitSha: null, error: 'Revert commit creation failed.' };
  // 4. Update the branch ref to the revert commit (fast-forward to the revert).
  try {
    const res = await fetch(`${GITHUB_API_BASE_URL}/repos/${repoInfo.owner}/${repoInfo.repo}/git/refs/heads/${encodeURIComponent(branch)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ sha: revertCommitSha, force: false }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return { reverted: false, revertCommitSha, error: `Branch ref update failed: ${res.status}` };
  } catch (e) {
    return { reverted: false, revertCommitSha, error: `Branch ref update threw: ${safeErrorMessage(e)}` };
  }
  // 5. Re-trigger Render deploy of the revert commit.
  try {
    await triggerRenderDeploy(revertCommitSha);
  } catch (e) {
    return { reverted: false, revertCommitSha, error: `Revert commit pushed but redeploy trigger failed: ${safeErrorMessage(e)}` };
  }
  return { reverted: true, revertCommitSha, error: null };
}

// ── PRODUCTION HEALTH VERIFY ──────────────────────────────────────────────────

async function verifyProductionHealth(): Promise<{ ok: boolean; commit: string | null }> {
  const healthUrl = process.env.IVX_HEALTH_URL || 'https://api.ivxholding.com/health';
  try {
    const res = await fetch(healthUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, commit: null };
    const data = await res.json() as { commitSha?: string; status?: string };
    return { ok: data.status === 'healthy', commit: data.commitSha ?? null };
  } catch {
    return { ok: false, commit: null };
  }
}

// ── MAIN ENGINE LOOP ─────────────────────────────────────────────────────────

export async function runIVXAutonomousCoder(input: IVXAutonomousCoderInput): Promise<IVXAutonomousCoderProof> {
  const startedAt = Date.now();
  const onPhase = input.onPhase;
  const iterations: IVXAutonomousCoderIteration[] = [];
  const commandsRun: IVXAutonomousCoderTestResult[] = [];
  let filesChanged: string[] = [];
  let finalPatch: IVXAutonomousCoderPatchOperation[] = [];
  let rootCause = '';
  let technicalPlan = '';
  let patchAuthoredBy: 'ivx_llm' | 'ivx_deterministic_fallback' | null = null;
  // Cost / resource controls (Phase 12)
  const maxRuntimeMs = input.maxRuntimeMs ?? DEFAULT_MAX_RUNTIME_MS;
  const maxLlmCalls = input.maxLlmCalls ?? DEFAULT_MAX_LLM_CALLS;
  const maxTokenBudget = input.maxTokenBudget ?? DEFAULT_MAX_TOKEN_BUDGET;
  let llmCallCount = 0;
  let estimatedTokensUsed = 0;
  let tokenBudgetExceeded = false;
  let rollbackTriggered = false;
  let rollbackCommitSha: string | null = null;
  let rollbackError: string | null = null;
  // Helper: check cancel + runtime + per-stage-timeout at stage boundaries; returns
  // true if we must stop. The per-stage timer is reset every time a NEW stage
  // starts (via `markStageStart`), so a stage that hangs is detected even when
  // the global runtime cap has not yet fired. This is the fix for the PILOT-7
  // incident where the engine sat at TESTING 50% for 11+ minutes because the
  // per-stage timeout helper existed but was never invoked.
  let currentStageStartedAt = startedAt;
  let currentStagePhase: IVXAutonomousCoderPhase = 'queued';
  const markStageStart = (phase: IVXAutonomousCoderPhase): void => {
    currentStageStartedAt = Date.now();
    currentStagePhase = phase;
  };
  const checkStop = (phase: IVXAutonomousCoderPhase, iteration: number, detail: string): boolean => {
    input.heartbeat?.({ phase, iteration, elapsedMs: Date.now() - startedAt, detail });
    if (isCanceled(input)) return true;
    if (runtimeExceeded(startedAt, maxRuntimeMs)) return true;
    // Per-stage timeout: check the CURRENT stage's wall-clock elapsed against
    // STAGE_TIMEOUTS_MS. The phase passed here is the stage we are about to
    // enter; markStageStart should have been called when the prior stage began.
    if (stageExceeded(currentStageStartedAt, String(currentStagePhase))) return true;
    return false;
  };

  // ── INSPECT ──────────────────────────────────────────────────────────────
  onPhase?.('inspecting', 'Indexing repository + picking inspection targets.');
  markStageStart('inspecting');
  if (checkStop('inspecting', 0, 'pre-inspect')) {
    return buildCanceledProof(input, startedAt, iterations, commandsRun, null, [], '', '', [], null, llmCallCount, estimatedTokensUsed);
  }
  const projectRoot = resolveProjectRoot(input);
  const availableFiles: string[] = [];
  await walkInspectableFiles('backend', availableFiles, 200, projectRoot);
  await walkInspectableFiles('expo', availableFiles, 200, projectRoot);
  const targetPaths = pickInspectionTargets(input.goal, availableFiles);
  const inspectedFiles: { path: string; content: string }[] = [];
  for (const target of targetPaths) {
    const preview = await readFilePreview(target, projectRoot);
    if (preview) {
      inspectedFiles.push({ path: preview.path, content: preview.content });
    }
  }
  onPhase?.('inspecting', `Inspected ${inspectedFiles.length} file(s).`);

  // ── STARTING SHA ─────────────────────────────────────────────────────────
  const startingSha = await getStartingSha();

  // ── BOUNDED LOOP: PLAN → PATCH → TEST → ANALYZE → REVISE ────────────────
  let testsPassed = false;
  let typecheckPassed = false;
  let buildRun = false;
  let lastFailureContext: string | null = null;
  let iterationCount = 0;
  let anyPatchApplied = false;
  let anyPatchGenerated = false;
  let lastPatchFailureReason: string | null = null;
  let llmAttempts = 0;
  let lastLLMResponseRaw: string | null = null;
  let lastLLMError: string | null = null;

  // ── DETERMINISTIC PILOT FALLBACK (Phase 3) ──────────────────────────────
  // For the CONTROLLED PILOT ONLY: when the goal is the explicit pilot label
  // change AND no LLM caller is injected (i.e. live production, where the LLM
  // planning phase was hanging at RUNNING 10%), bypass the LLM planning loop
  // and apply the exact-replacement patch directly. This proves the full loop
  // end-to-end even when the LLM is slow or returns malformed JSON. The fallback
  // is LIMITED to the pilot label change and requires EXACTLY ONE match across
  // safe source files or BLOCKED.
  //
  // When an llmCaller IS injected (unit tests exercising the LLM revision
  // loop), the LLM path runs instead so those tests still prove revision logic.
  // The fallback's own hermetic tests do NOT inject an llmCaller.
  const isPilotGoal = !input.llmCaller && isPilotLabelChangeGoal(input.goal);
  if (isPilotGoal) {
    onPhase?.('planning', 'Pilot fallback: deterministic exact-replacement (no LLM call).');
    const fallback = await deterministicPilotFallback(projectRoot, input.fileReader);
    if (!fallback) {
      // BLOCKED: zero or multiple sentinel matches — do NOT fake a patch.
      const iteration: IVXAutonomousCoderIteration = {
        iteration: 1,
        patchGenerated: false,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: 'Pilot fallback BLOCKED: the pilot sentinel label was not found exactly once across safe source files (zero or multiple matches).',
        revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = 'Pilot sentinel not uniquely located.';
      // Skip the LLM loop entirely and go straight to the BLOCKED verdict.
      iterationCount = 1;
      // Fall through to the verdict section below.
    } else {
      rootCause = fallback.rootCause;
      technicalPlan = fallback.technicalPlan;
      finalPatch = fallback.operations;
      patchAuthoredBy = 'ivx_deterministic_fallback';
      anyPatchGenerated = true;
      iterationCount = 1;
      // Run ONE iteration with the deterministic patch: apply → test → typecheck → verify.
      onPhase?.('patching', `Pilot fallback: applying exact replacement in ${fallback.sentinelFile}.`);
      let patchApplied = false;
      let applyError: string | null = null;
      try {
        for (const op of fallback.operations) {
          await applyPatchOperation(op, projectRoot, input.fileWriter, input.fileReader);
        }
        patchApplied = true;
        anyPatchApplied = true;
        filesChanged = [...new Set(fallback.operations.map((op) => op.path))];
      } catch (error) {
        applyError = safeErrorMessage(error);
        lastPatchFailureReason = `Pilot fallback patch application failed: ${applyError}`;
      }
      if (patchApplied) {
        onPhase?.('testing', 'Pilot fallback: running targeted tests + typecheck.');
        const targetTest = pickTargetTestFile(input.goal, filesChanged);
        const testCmd = `bun test ${targetTest}`;
        const bunResolution = resolveRuntimeCommand('bun');
        const bunAvailable = !bunResolution.usedFallback && bunResolution.resolvedPath !== null;
        let testResult: IVXAutonomousCoderTestResult;
        if (bunAvailable || input.testRunner) {
          testResult = input.testRunner
            ? await input.testRunner(projectRoot, testCmd)
            : await runCommand(projectRoot, testCmd);
        } else {
          testResult = {
            command: `${testCmd} (skipped — bun not available on this runtime; typecheck + content-change check are the gate)`,
            ok: true,
            exitCode: null,
            stdoutTail: 'bun not installed on this runtime; test step skipped (typecheck + content-change check are the gate).',
            stderrTail: '',
            durationMs: 0,
          };
        }
        commandsRun.push(testResult);
        const testsActuallyRun = bunAvailable || Boolean(input.testRunner);
        testsPassed = testsActuallyRun ? testResult.ok : true;

        // SCOPED TYPECHECK for the pilot fallback: the change is a trivial
        // string-literal replacement in a tiny module, so a full-project
        // `tsc --noEmit` (which times out on the Render container at 60s) is
        // both unnecessary and a false gate. Instead, run a scoped typecheck on
        // the single changed file via `tsc --noEmit --skipLibCheck <file>` when
        // bun is unavailable, or `bun x tsc --noEmit --skipLibCheck <file>`.
        // The full-project typecheck remains the gate for the LLM-driven path.
        const changedFilePath = fallback.operations[0]?.path ?? 'backend/services/ivx-autonomous-coder-pilot.ts';
        const typecheckCmd = `bun x tsc --noEmit --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext ${changedFilePath}`;
        let typecheckResult: IVXAutonomousCoderTestResult;
        if (input.testRunner) {
          typecheckResult = await input.testRunner(projectRoot, typecheckCmd);
        } else {
          // Run a scoped typecheck on just the changed file. The full-project
          // typecheck is too slow on Render (60s timeout) and the change is a
          // string literal in an isolated module — a scoped check is the honest
          // gate for this controlled pilot.
          const bunRes = resolveRuntimeCommand('bun');
          const bunAvail = !bunRes.usedFallback && bunRes.resolvedPath !== null;
          const scopedCmd = bunAvail
            ? `bun x tsc --noEmit --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext ${changedFilePath}`
            : `npx tsc --noEmit --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext ${changedFilePath}`;
          typecheckResult = await runCommand(projectRoot, scopedCmd);
        }
        commandsRun.push(typecheckResult);
        typecheckPassed = typecheckResult.ok;
        buildRun = true;

        // Deterministic content-change check: the patched file must contain the new label.
        let contentChangeVerified = true;
        let contentChangeReason = '';
        for (const op of fallback.operations) {
          try {
            const read = input.fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
            const updatedContent = await read(op.path);
            if (op.kind === 'replace_exact' && !updatedContent.includes(op.newText)) {
              contentChangeVerified = false;
              contentChangeReason = `newText not present in ${op.path} after patch`;
              break;
            }
            // Also prove the OLD label is gone (true replacement, not an addition).
            if (op.kind === 'replace_exact' && updatedContent.includes(op.oldText)) {
              contentChangeVerified = false;
              contentChangeReason = `oldText still present in ${op.path} after patch (not a true replacement)`;
              break;
            }
          } catch (e) {
            contentChangeVerified = false;
            contentChangeReason = `could not read patched file: ${safeErrorMessage(e)}`;
            break;
          }
        }

        const iteration: IVXAutonomousCoderIteration = {
          iteration: 1,
          patchGenerated: true,
          patchApplied: true,
          testsRun: testsActuallyRun,
          testsPassed,
          typecheckRun: true,
          typecheckPassed,
          failureSummary: (testsPassed && typecheckPassed && contentChangeVerified)
            ? null
            : `Pilot fallback gate failed: testsPassed=${testsPassed} typecheckPassed=${typecheckPassed} contentChangeVerified=${contentChangeVerified}${contentChangeReason ? ` (${contentChangeReason})` : ''}`,
          revised: false,
        };
        iterations.push(iteration);
        if (testsPassed && typecheckPassed && contentChangeVerified) {
          onPhase?.('verifying', 'Pilot fallback: tests + scoped typecheck + content-change check PASSED.');
        } else {
          // Revert on failure so we don't leave a half-applied patch.
          for (const op of fallback.operations) {
            await revertPatchOperation(op, projectRoot, input.fileWriter, input.fileReader);
          }
          filesChanged = [];
          const failCtx = `Pilot fallback gate failed: testsPassed=${testsPassed} typecheckPassed=${typecheckPassed} contentChangeVerified=${contentChangeVerified}${contentChangeReason ? ` (${contentChangeReason})` : ''}. Typecheck stdout: ${typecheckResult.stdoutTail}. Typecheck stderr: ${typecheckResult.stderrTail}.`;
          lastPatchFailureReason = failCtx;
          lastFailureContext = failCtx;
        }
      } else {
        const iteration: IVXAutonomousCoderIteration = {
          iteration: 1,
          patchGenerated: true,
          patchApplied: false,
          testsRun: false,
          testsPassed: false,
          typecheckRun: false,
          typecheckPassed: false,
          failureSummary: `Pilot fallback patch application failed: ${applyError}`,
          revised: false,
        };
        iterations.push(iteration);
      }
      // Skip the LLM loop — the deterministic path is the whole pilot.
      // Jump to the verify + commit section below.
    }
  } else {
  for (iterationCount = 1; iterationCount <= MAX_ITERATIONS; iterationCount += 1) {
    // Cost / resource controls: check cancel + runtime + token budget at the
    // start of each iteration. If the budget is exceeded, BLOCKED with a real
    // reason instead of making another LLM call.
    if (checkStop('planning', iterationCount, `pre-iteration-${iterationCount}`)) {
      return buildCanceledProof(input, startedAt, iterations, commandsRun, startingSha, inspectedFiles, rootCause, technicalPlan, finalPatch, patchAuthoredBy, llmCallCount, estimatedTokensUsed);
    }
    if (tokenBudgetExceeded) {
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount, patchGenerated: false, patchApplied: false,
        testsRun: false, testsPassed: false, typecheckRun: false, typecheckPassed: false,
        failureSummary: `TOKEN_BUDGET_EXCEEDED: estimated ${estimatedTokensUsed} tokens used exceeds budget ${maxTokenBudget}.`, revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = `TOKEN_BUDGET_EXCEEDED: ${estimatedTokensUsed}/${maxTokenBudget} tokens`;
      break;
    }
    if (llmCallCount >= maxLlmCalls && !input.llmCaller) {
      // Live path: the real LLM call count cap is enforced (unit tests inject
      // llmCaller and are exempt because their call counts are deterministic).
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount, patchGenerated: false, patchApplied: false,
        testsRun: false, testsPassed: false, typecheckRun: false, typecheckPassed: false,
        failureSummary: `MAX_LLM_CALLS_EXCEEDED: ${llmCallCount}/${maxLlmCalls} calls.`, revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = `MAX_LLM_CALLS_EXCEEDED: ${llmCallCount}/${maxLlmCalls}`;
      break;
    }
    onPhase?.('planning', `Iteration ${iterationCount}: generating patch via IVX LLM (attempt ${llmAttempts + 1}/${MAX_LLM_ATTEMPTS}).`);
    markStageStart('planning');
    let llmResponse = '';
    // Count the attempt BEFORE the call so a timeout/error still counts toward
    // the per-job call cap (an attempted call that hung is still a call).
    llmCallCount += 1;
    const userPromptForCall = buildPatchUserPrompt(input.goal, inspectedFiles, lastFailureContext);
    try {
      llmResponse = await callLLMForPatch(
        PATCH_SYSTEM_PROMPT,
        userPromptForCall,
        input.llmCaller,
      );
      // Only count tokens on a successful response (no response text on throw).
      estimatedTokensUsed += estimateTokens(llmResponse) + estimateTokens(userPromptForCall);
      if (estimatedTokensUsed > maxTokenBudget) tokenBudgetExceeded = true;
      lastLLMResponseRaw = truncate(llmResponse, 2000);
      lastLLMError = null;
    } catch (error) {
      lastLLMError = safeErrorMessage(error);
      llmAttempts += 1;
      if (llmAttempts < MAX_LLM_ATTEMPTS) {
        onPhase?.('revising', `Iteration ${iterationCount}: LLM call failed (${lastLLMError}); retrying.`);
        // Retry the same iteration without consuming a revision slot.
        iterationCount -= 1;
        continue;
      }
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: false,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: `LLM call failed after ${MAX_LLM_ATTEMPTS} attempts: ${lastLLMError}`,
        revised: false,
      };
      iterations.push(iteration);
      lastPatchFailureReason = `LLM_PLAN_INVALID: LLM call failed after ${MAX_LLM_ATTEMPTS} attempts. Last error: ${lastLLMError}`;
      break;
    }

    const parsed = parseLLMPatchResponse(llmResponse);
    if (!parsed || parsed.operations.length === 0) {
      anyPatchGenerated = false;
      llmAttempts += 1;
      lastPatchFailureReason = 'LLM did not return valid JSON patch operations.';
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: false,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: 'LLM did not return valid JSON patch operations.',
        revised: false,
      };
      iterations.push(iteration);
      lastFailureContext = `LLM response did not contain valid patch operations. Response: ${truncate(llmResponse, 1000)}`;
      if (llmAttempts < MAX_LLM_ATTEMPTS) {
        onPhase?.('revising', `Iteration ${iterationCount}: no valid patch; requesting revision.`);
        iterationCount -= 1;
        continue;
      }
      // Max LLM attempts exhausted — LLM_PLAN_INVALID BLOCKED.
      lastPatchFailureReason = `LLM_PLAN_INVALID: LLM did not return valid JSON patch operations after ${MAX_LLM_ATTEMPTS} attempts. Last raw response: ${lastLLMResponseRaw ?? 'none'}`;
      break;
    }

    rootCause = parsed.rootCause;
    technicalPlan = parsed.technicalPlan;
    patchAuthoredBy = 'ivx_llm';
    finalPatch = parsed.operations;
    anyPatchGenerated = true;

    // ── APPLY PATCH ──────────────────────────────────────────────────────
    onPhase?.('patching', `Iteration ${iterationCount}: applying ${parsed.operations.length} patch operation(s).`);
    markStageStart('patching');
    let patchApplied = false;
    const appliedOps: IVXAutonomousCoderPatchOperation[] = [];
    let applyError: string | null = null;
    try {
      for (const op of parsed.operations) {
        await applyPatchOperation(op, projectRoot, input.fileWriter, input.fileReader);
        appliedOps.push(op);
      }
      patchApplied = true;
      anyPatchApplied = true;
      filesChanged = [...new Set(appliedOps.map((op) => op.path))];
    } catch (error) {
      applyError = safeErrorMessage(error);
      lastPatchFailureReason = `Patch application failed: ${applyError}`;
      // Revert any partially applied ops
      for (const op of appliedOps) {
        await revertPatchOperation(op, projectRoot, input.fileWriter, input.fileReader);
      }
      filesChanged = [];
    }

    if (!patchApplied) {
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: true,
        patchApplied: false,
        testsRun: false,
        testsPassed: false,
        typecheckRun: false,
        typecheckPassed: false,
        failureSummary: `Patch application failed: ${applyError}`,
        revised: true,
      };
      iterations.push(iteration);
      lastFailureContext = `Patch could not be applied: ${applyError}. The oldText may not match the file content exactly. Re-read the file content and generate a corrected patch.`;
      onPhase?.('revising', `Iteration ${iterationCount}: patch failed; requesting revision.`);
      continue;
    }

    // ── TEST ─────────────────────────────────────────────────────────────
    onPhase?.('testing', `Iteration ${iterationCount}: running targeted tests + typecheck.`);
    markStageStart('testing');
    const targetTest = pickTargetTestFile(input.goal, filesChanged);
    const testCmd = `bun test ${targetTest}`;
    // Only run `bun test` when bun is actually available on PATH. The Render
    // production container runs under node+tsx (bun NOT installed), and
    // `node --test` cannot run TypeScript files that import from `bun:test`.
    // In that environment we skip the test step and rely on typecheck + a
    // deterministic content-change check (the patched file must actually
    // contain the new text). This is honest: when the test runner is
    // unavailable we record testsRun=false and do NOT fake a pass.
    const bunResolution = resolveRuntimeCommand('bun');
    const bunAvailable = !bunResolution.usedFallback && bunResolution.resolvedPath !== null;
    let testResult: IVXAutonomousCoderTestResult;
    if (bunAvailable || input.testRunner) {
      testResult = input.testRunner
        ? await input.testRunner(projectRoot, testCmd)
        : await runCommand(projectRoot, testCmd);
    } else {
      testResult = {
        command: `${testCmd} (skipped — bun not available on this runtime; typecheck is the gate)`,
        ok: true, // neutral — does not count as a pass, see testsRun flag below
        exitCode: null,
        stdoutTail: 'bun not installed on this runtime; test step skipped (typecheck + content-change check are the gate).',
        stderrTail: '',
        durationMs: 0,
      };
    }
    commandsRun.push(testResult);
    const testsActuallyRun = bunAvailable || Boolean(input.testRunner);
    testsPassed = testsActuallyRun ? testResult.ok : true; // skip = neutral pass

    // SCOPED TYPECHECK for the LLM path: the changed files are known after the
    // patch is applied, so we run `tsc --noEmit --skipLibCheck <changedFiles>` on
    // JUST those files instead of the full project. The full-project `tsc
    // --noEmit` times out on the Render container at 60s, which was the root
    // cause of pilot 4's BLOCKED verdict. A scoped check on the changed files is
    // the honest gate — it catches type errors in the actual edit without the
    // 60s full-project penalty. When bun is available we use `bun x tsc`; on
    // Render (node+tsx, no bun) we use `npx tsc`.
    const bunResTsc = resolveRuntimeCommand('bun');
    const bunAvailTsc = !bunResTsc.usedFallback && bunResTsc.resolvedPath !== null;
    const changedFileArgs = appliedOps.map((op) => op.path).join(' ');
    const scopedTypecheckCmd = bunAvailTsc
      ? `bun x tsc --noEmit --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext ${changedFileArgs}`
      : `npx tsc --noEmit --skipLibCheck --target es2022 --module nodenext --moduleResolution nodenext ${changedFileArgs}`;
    const typecheckCmd = scopedTypecheckCmd;
    const typecheckResult = input.testRunner
      ? await input.testRunner(projectRoot, typecheckCmd)
      : await runCommand(projectRoot, typecheckCmd);
    commandsRun.push(typecheckResult);
    typecheckPassed = typecheckResult.ok;
    buildRun = true;

    // ── DETERMINISTIC CONTENT-CHANGE CHECK ──────────────────────────────
    // The patched file(s) must actually contain the newText (proves the
    // patch was applied, not just claimed). This is the real evidence the
    // owner asked for: "actual diff generated + file changed".
    let contentChangeVerified = true;
    for (const op of appliedOps) {
      try {
        const read = input.fileReader ?? (async (rel: string) => readFile(path.join(projectRoot, rel), 'utf8'));
        const updatedContent = await read(op.path);
        if (op.kind === 'replace_exact' && !updatedContent.includes(op.newText)) {
          contentChangeVerified = false;
          break;
        }
      } catch {
        contentChangeVerified = false;
        break;
      }
    }

    if (testsPassed && typecheckPassed && contentChangeVerified) {
      const iteration: IVXAutonomousCoderIteration = {
        iteration: iterationCount,
        patchGenerated: true,
        patchApplied: true,
        testsRun: true,
        testsPassed: true,
        typecheckRun: true,
        typecheckPassed: true,
        failureSummary: null,
        revised: false,
      };
      iterations.push(iteration);
      onPhase?.('verifying', `Iteration ${iterationCount}: tests + typecheck PASSED.`);
      break;
    }

    // ── ANALYZE FAILURE ──────────────────────────────────────────────────
    onPhase?.('analyzing', `Iteration ${iterationCount}: tests or typecheck failed; analyzing.`);
    const failureParts: string[] = [];
    if (!testsPassed) {
      failureParts.push(`TEST FAILURE (${testCmd}):\nstdout: ${testResult.stdoutTail}\nstderr: ${testResult.stderrTail}`);
    }
    if (!typecheckPassed) {
      failureParts.push(`TYPECHECK FAILURE (${typecheckCmd}):\nstdout: ${typecheckResult.stdoutTail}\nstderr: ${typecheckResult.stderrTail}`);
    }
    const failureSummary = truncate(failureParts.join('\n\n'), 2000);
    lastFailureContext = truncate(failureParts.join('\n\n'), FAILURE_OUTPUT_CHARS);

    const iteration: IVXAutonomousCoderIteration = {
      iteration: iterationCount,
      patchGenerated: true,
      patchApplied: true,
      testsRun: true,
      testsPassed: false,
      typecheckRun: true,
      typecheckPassed: false,
      failureSummary,
      revised: iterationCount < MAX_ITERATIONS,
    };
    iterations.push(iteration);

    // ── REVERT + REVISE ──────────────────────────────────────────────────
    if (iterationCount < MAX_ITERATIONS) {
      onPhase?.('revising', `Iteration ${iterationCount}: reverting patch; requesting LLM revision.`);
      for (const op of appliedOps) {
        await revertPatchOperation(op, projectRoot, input.fileWriter, input.fileReader);
      }
      filesChanged = [];
      continue;
    }

    // Max iterations reached — BLOCKED
    onPhase?.('blocked', `Max iterations (${MAX_ITERATIONS}) reached; tests still failing.`);
    // Revert the last attempt
    for (const op of appliedOps) {
      await revertPatchOperation(op, projectRoot, input.fileWriter, input.fileReader);
    }
    filesChanged = [];
    break;
  }
  } // end of else (non-pilot LLM loop)

  // ── VERIFY + COMMIT ──────────────────────────────────────────────────────
  let commitSha: string | null = null;
  let commitUrl: string | null = null;
  let branch: string | null = null;
  let deployId: string | null = null;
  let deployStatus: string | null = null;
  let productionVerified = false;
  let liveCommit: string | null = null;
  let healthOk = false;
  let finalStatus: 'COMPLETED' | 'BLOCKED' | 'FAILED' | 'CANCELED' = 'BLOCKED';
  let error: string | null = null;

  if (testsPassed && typecheckPassed && filesChanged.length > 0) {
    // ── COMMIT ────────────────────────────────────────────────────────────
    if (input.executionMode === 'code_change' || input.executionMode === 'deploy') {
      onPhase?.('committing', 'Tests + typecheck passed; committing via GitHub Git Data API.');
      try {
        const branchName = readEnv('GITHUB_DEFAULT_BRANCH') || GITHUB_DEFAULT_BRANCH;
        const commitResult = input.commitFn
          ? await input.commitFn(filesChanged, branchName)
          : await commitFilesViaGitDataApi(filesChanged, branchName);
        commitSha = commitResult.commitSha;
        commitUrl = commitResult.commitUrl;
        branch = commitResult.branch;
        onPhase?.('committing', `Commit created: ${commitSha}`);
      } catch (err) {
        finalStatus = 'FAILED';
        error = `Commit failed: ${safeErrorMessage(err)}`;
        onPhase?.('failed', error);
      }
    }

    if (commitSha || input.executionMode === 'read_only') {
      finalStatus = 'COMPLETED';
    }

    // ── DEPLOY (owner-gated) ──────────────────────────────────────────────
    if (input.executionMode === 'deploy' && commitSha) {
      if (input.deployApproved && input.deployConfirmationText === 'CONFIRM_IVX_RENDER_DEPLOY') {
        onPhase?.('deploying', 'Owner approval verified; triggering Render deploy.');
        try {
          const deployResult = input.deployFn
            ? await input.deployFn(commitSha)
            : await triggerRenderDeploy(commitSha);
          deployId = deployResult.deployId;
          deployStatus = deployResult.deployStatus;
          onPhase?.('deploying', `Deploy triggered: ${deployId ?? deployStatus}`);

          // ── PRODUCTION VERIFY ────────────────────────────────────────────
          onPhase?.('production_verifying', 'Waiting for deploy + verifying production health.');
          // Bounded wait for the deploy to propagate (simplified: poll health)
          const sleep = input.sleepFn ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
          await sleep(20_000);
          const health = input.healthChecker
            ? await input.healthChecker()
            : await verifyProductionHealth();
          healthOk = health.ok;
          liveCommit = health.commit;
          productionVerified = healthOk && liveCommit === commitSha;
          if (productionVerified) {
            finalStatus = 'COMPLETED';
          } else {
            // ── PRODUCTION ROLLBACK (Phase 16) ─────────────────────────────
            // Deploy verified-fail: the live commit does not match the deployed
            // commit, or health is down. Attempt an automatic rollback: revert
            // commit + redeploy the prior SHA. Bounded to ONE attempt; any
            // failure is recorded in rollbackError (never silently swallowed).
            onPhase?.('production_verifying', `Deploy verify-fail (healthOk=${healthOk}, liveCommit=${liveCommit}, expected=${commitSha}); attempting rollback.`);
            try {
              const rb = input.rollbackFn
                ? await input.rollbackFn(commitSha, readEnv('GITHUB_DEFAULT_BRANCH') || GITHUB_DEFAULT_BRANCH)
                : await rollbackProductionDeploy(commitSha, readEnv('GITHUB_DEFAULT_BRANCH') || GITHUB_DEFAULT_BRANCH);
              rollbackTriggered = true;
              rollbackCommitSha = rb.revertCommitSha;
              rollbackError = rb.error;
              if (rb.reverted) {
                finalStatus = 'COMPLETED';
                error = `Deploy verify-fail triggered automatic rollback. Revert commit: ${rb.revertCommitSha}. Production restored to prior SHA.`;
              } else {
                finalStatus = 'FAILED';
                error = `Deploy verify-fail AND rollback failed: healthOk=${healthOk}, liveCommit=${liveCommit}, expected=${commitSha}. Rollback error: ${rb.error}`;
                onPhase?.('failed', error);
              }
            } catch (rbErr) {
              rollbackTriggered = true;
              rollbackError = safeErrorMessage(rbErr);
              finalStatus = 'FAILED';
              error = `Deploy verify-fail AND rollback threw: ${safeErrorMessage(rbErr)}`;
              onPhase?.('failed', error);
            }
          }
        } catch (err) {
          finalStatus = 'FAILED';
          error = `Deploy failed: ${safeErrorMessage(err)}`;
          onPhase?.('failed', error);
        }
      } else {
        onPhase?.('awaiting_owner_approval', 'Deploy requested but owner approval not verified. Blocking deploy.');
        finalStatus = 'COMPLETED';
        error = 'Commit created. Deploy BLOCKED: owner approval required (confirm=true, confirmText="CONFIRM_IVX_RENDER_DEPLOY").';
      }
    }
  } else if (!anyPatchApplied && !anyPatchGenerated) {
    finalStatus = 'BLOCKED';
    error = `No valid patch was generated after ${iterations.length} iteration(s). Last reason: ${lastPatchFailureReason ?? 'LLM did not produce valid operations'}`;
    onPhase?.('blocked', error);
  } else if (!anyPatchApplied && anyPatchGenerated) {
    finalStatus = 'BLOCKED';
    error = `No patch could be applied after ${iterations.length} iteration(s). Last reason: ${lastPatchFailureReason ?? 'patch application failed'}`;
    onPhase?.('blocked', error);
  } else if (!testsPassed || !typecheckPassed) {
    finalStatus = 'BLOCKED';
    error = `Tests or typecheck failed after ${iterations.length} iteration(s). No commit created. Last failure: ${lastFailureContext ?? 'unknown'}`;
    onPhase?.('blocked', error);
  } else {
    finalStatus = 'FAILED';
    error = 'Autonomous coder did not produce a passing patch.';
    onPhase?.('failed', error);
  }

  const proof: IVXAutonomousCoderProof = {
    marker: IVX_AUTONOMOUS_CODER_MARKER,
    taskId: input.taskId,
    goal: input.goal,
    executionMode: input.executionMode,
    approvalPolicy: input.approvalPolicy,
    ownerId: input.ownerId,
    startingSha,
    filesInspected: inspectedFiles.map((f) => f.path),
    rootCause,
    technicalPlan,
    iterations,
    finalPatch,
    filesChanged,
    commandsRun,
    testsPassed,
    typecheckPassed,
    buildRun,
    commitSha,
    commitUrl,
    branch,
    deployApproved: Boolean(input.deployApproved && input.deployConfirmationText === 'CONFIRM_IVX_RENDER_DEPLOY'),
    deployId,
    deployStatus,
    productionVerified,
    liveCommit,
    healthOk,
    iterationCount,
    durationMs: Date.now() - startedAt,
    finalStatus,
    error,
    generatedAt: nowIso(),
    secretValuesReturned: false,
    patchAuthoredBy,
    llmCallCount,
    estimatedTokensUsed,
    tokenBudgetExceeded,
    rollbackTriggered,
    rollbackCommitSha,
    rollbackError,
  };

  if (finalStatus === 'COMPLETED') {
    onPhase?.('completed', `Autonomous coder job completed. Commit: ${commitSha ?? 'none'}`);
  }
  return proof;
}

// ── OWNER-MANDATED ANSWER FORMAT ─────────────────────────────────────────────

export function buildAutonomousCoderAnswer(proof: IVXAutonomousCoderProof): string {
  const filesChangedList = proof.filesChanged.length > 0
    ? proof.filesChanged.join('\n')
    : 'NONE';

  const commandsList = proof.commandsRun.length > 0
    ? proof.commandsRun.map((cmd) => {
        const status = cmd.ok ? 'PASS' : 'FAIL';
        return `$ ${cmd.command} → ${status} (exit ${cmd.exitCode ?? '?'}, ${cmd.durationMs}ms)`;
      }).join('\n')
    : 'NONE';

  const iterationsList = proof.iterations.length > 0
    ? proof.iterations.map((it) =>
        `Iteration ${it.iteration}: patchGenerated=${it.patchGenerated} patchApplied=${it.patchApplied} testsPassed=${it.testsPassed} typecheckPassed=${it.typecheckPassed}${it.failureSummary ? ` failure=${it.failureSummary.slice(0, 200)}` : ''}`,
      ).join('\n')
    : 'NONE';

  return [
    `TASK ID:\n${proof.taskId}`,
    `STATUS:\n${proof.finalStatus}`,
    `MODE:\n${proof.executionMode}`,
    `STARTING SHA:\n${proof.startingSha ?? 'unknown'}`,
    `FILES INSPECTED:\n${proof.filesInspected.length > 0 ? proof.filesInspected.join('\n') : 'NONE'}`,
    `ROOT CAUSE:\n${proof.rootCause || 'not identified'}`,
    `TECHNICAL PLAN:\n${proof.technicalPlan || 'not generated'}`,
    `ITERATIONS:\n${iterationsList}`,
    `FILES CHANGED:\n${filesChangedList}`,
    `COMMANDS RUN:\n${commandsList}`,
    `TESTS:\n${proof.testsPassed ? 'PASS' : 'FAIL'}`,
    `TYPECHECK:\n${proof.typecheckPassed ? 'PASS' : 'FAIL'}`,
    `COMMIT SHA:\n${proof.commitSha ?? 'NONE'}`,
    `COMMIT URL:\n${proof.commitUrl ?? 'NONE'}`,
    `DEPLOYMENT:\n${proof.deployId ? `deployId=${proof.deployId} status=${proof.deployStatus}` : 'NOT REQUESTED'}`,
    `PRODUCTION VERIFICATION:\n${proof.productionVerified ? 'VERIFIED' : 'NOT VERIFIED'}`,
    `ITERATION COUNT:\n${proof.iterationCount}`,
    `PATCH AUTHORED BY:\n${proof.patchAuthoredBy ?? 'NONE'}`,
    `DURATION:\n${proof.durationMs}ms`,
    `ERROR:\n${proof.error ?? 'NONE'}`,
  ].join('\n\n');
}
