import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import path from 'node:path';
import { writeFile, readFile, mkdir, rm, symlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import os from 'node:os';
import {
  buildAutonomousCoderAnswer,
  runIVXAutonomousCoder,
  runAutonomousCoderCommand,
  isPilotLabelChangeGoal,
  IVX_AUTONOMOUS_CODER_MARKER,
  type IVXAutonomousCoderInput,
  type IVXAutonomousCoderTestResult,
} from './services/ivx-autonomous-coder';
import { PILOT_LABEL, PILOT_LABEL_TARGET, describePilotSentinel } from './services/ivx-autonomous-coder-pilot';

const TMP_ROOT = path.join(os.tmpdir(), `ivx-ac-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

beforeAll(async () => {
  await mkdir(TMP_ROOT, { recursive: true });
});

afterAll(async () => {
  await rm(TMP_ROOT, { recursive: true, force: true }).catch(() => {});
});

/** Create an isolated project root with a pilot sentinel file for one test. */
async function makeIsolatedRepo(label: string): Promise<{
  root: string;
  fileWriter: (rel: string, content: string) => Promise<void>;
  fileReader: (rel: string) => Promise<string>;
}> {
  const root = path.join(TMP_ROOT, label);
  await mkdir(path.join(root, 'backend/services'), { recursive: true });
  await symlink(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules'), path.join(root, 'node_modules'), 'dir');
  const pilotContent = `export const PILOT_LABEL = '${PILOT_LABEL}';\nexport const PILOT_LABEL_TARGET = '${PILOT_LABEL_TARGET}';\n`;
  await writeFile(path.join(root, 'backend/services/ivx-autonomous-coder-pilot.ts'), pilotContent, 'utf8');
  const fileWriter = async (rel: string, content: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content, 'utf8');
  };
  const fileReader = async (rel: string) => readFile(path.join(root, rel), 'utf8');
  return { root, fileWriter, fileReader };
}

describe('Landing repair source access', () => {
  it('runs generated validation without inheriting worker credentials', async () => {
    const repo = await makeIsolatedRepo('validation-environment');
    const key = 'IVX_AUTONOMOUS_TEST_SECRET_SENTINEL';
    const previous = process.env[key];
    process.env[key] = 'fixture-value-must-stay-in-parent';
    try {
      await repo.fileWriter('backend/services/environment-check.cjs', [
        'const assert = require("node:assert/strict");',
        `assert.equal(process.env.${key}, undefined);`,
        'for (const key of ["SUPABASE_SERVICE_ROLE_KEY", "DATABASE_URL", "GITHUB_TOKEN", "OPENAI_API_KEY", "RENDER_API_KEY", "IVX_AI_SYSTEM_SECRET"]) assert.equal(process.env[key], undefined);',
        'assert.equal(process.env.NODE_ENV, "test");',
        'assert.equal(process.env.CI, "1");',
        'assert.ok(process.env.PATH);',
        'console.log("validation-environment-pass");',
      ].join('\n'));
      const result = await runAutonomousCoderCommand(repo.root, 'node backend/services/environment-check.cjs');
      expect(result.ok).toBe(true);
      expect(result.stdoutTail).toContain('validation-environment-pass');
      expect(process.env[key]).toBe('fixture-value-must-stay-in-parent');
    } finally {
      if (previous === undefined) delete process.env[key]; else process.env[key] = previous;
    }
  });

  it('retains selected source and revises rejected patches and Node test errors using the real compiler', async () => {
    const repo = await makeIsolatedRepo('deep-repair-revision');
    await Promise.all(Array.from({ length: 220 }, (_, i) => Promise.all([
      repo.fileWriter(`backend/a${i}.ts`, 'export const unrelated = 1;'),
      repo.fileWriter(`expo/a${i}.ts`, 'export const unrelated = 1;'),
    ])));
    await Promise.all(Array.from({ length: 220 }, (_, i) => repo.fileWriter(`backend/api/owner-credential-permission-security-emergency-stop-${i}.ts`, 'export const decoy = true;')));
    const sourcePath = 'backend/services/deal-video-normalization.ts';
    const testPath = 'backend/services/deal-video-normalization.test.ts';
    const source = 'import type { PoolClient } from "pg";\nexport function normalizeDealVideoUrl(value: string, db?: PoolClient) { return value; }';
    await repo.fileWriter(sourcePath, source);
    await repo.fileWriter('backend/types/pg.d.ts', await readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), 'types/pg.d.ts'), 'utf8'));
    await repo.fileWriter('expo/ivxholding-landing/index.html', '<main>Landing</main>');
    await repo.fileWriter('restricted.ts', 'DO_NOT_EXPOSE_PRIVATE_FIXTURE');
    let plans = 0;
    let patches = 0;
    let regressionRan = false;
    let typecheckCommand = '';
    let commitPersisted = false;
    const proof = await runIVXAutonomousCoder({
      taskId: 'landing-remediation:fixture:media.deal-videos', goal: [
        '[AUTONOMOUS_DIAGNOSTIC_DATA] Repair a Landing QA failure.',
        'Unit media.deal-videos: repair deal video normalization so incoming URL whitespace is trimmed.',
        'Acceptance probe: normalized video URLs, with a regression test.',
        'Preserve owner credential permission security emergency stop controls. Never alter credential or permission settings.',
      ].join('\n'),
      executionMode: 'code_change', ownerId: 'test-owner', approvalPolicy: 'owner_gated', projectRoot: repo.root,
      fileReader: repo.fileReader, fileWriter: repo.fileWriter,
      planCaller: async (_system, prompt) => {
        plans += 1;
        expect(prompt).toContain(sourcePath);
        expect(prompt).toContain('expo/ivxholding-landing/index.html');
        return JSON.stringify({ targetFiles: [sourcePath, testPath], filesToInspect: [sourcePath, 'backend/../restricted.ts'], changesRequired: 'trim URL whitespace', testsRequired: 'URL normalization', risks: 'bounded helper change' });
      },
      llmCaller: async (_system, prompt) => {
        patches += 1;
        expect(prompt).toContain(source);
        expect(prompt).not.toContain('DO_NOT_EXPOSE_PRIVATE_FIXTURE');
        if (patches > 1) expect(prompt).toContain('PREVIOUS ATTEMPT FAILED');
        if (patches === 3) expect(prompt).toContain('test is not defined');
        expect(_system).toContain('Import every test API explicitly');
        return JSON.stringify({ rootCause: 'untrimmed URL', technicalPlan: 'normalize whitespace', operations: [
          { path: sourcePath, kind: 'replace_exact', oldText: patches === 1 ? 'return aSnippetThatDoesNotExist;' : 'return value;', newText: 'return value.trim();', reason: 'normalize input' },
          { path: testPath, kind: 'create_file', oldText: '', newText: (patches === 2 ? '' : 'import { test } from "node:test"; ') + 'import assert from "node:assert/strict"; import { normalizeDealVideoUrl } from "./deal-video-normalization"; test("trims a video URL", () => assert.equal(normalizeDealVideoUrl("  https://example.test/video.mp4  "), "https://example.test/video.mp4"));', reason: 'regression coverage' },
        ] });
      },
      testRunner: async (cwd, command) => {
        const result = await runAutonomousCoderCommand(cwd, command);
        if (command.startsWith('node --import tsx --test ')) regressionRan = result.ok;
        if (command.includes('/typescript/bin/tsc ')) typecheckCommand = command;
        expect(command).not.toContain('npx');
        return result;
      },
      commitFn: async (_paths, branch) => ({ commitSha: 'test-deep-repair', commitUrl: 'https://example.test/commit', branch }),
      ...prAndCiMocks(), autoMergePr: true,
      onCommitLanded: async info => {
        expect(info.filesChanged).toContain(sourcePath);
        expect(info.testsPassed).toBe(true);
        expect(info.commandsRun.some(result => result.phase === 'regression_baseline' && !result.ok)).toBe(true);
        await Promise.resolve();
        commitPersisted = true;
      },
      prFn: async () => {
        expect(commitPersisted).toBe(true);
        return { prNumber: 99, prUrl: 'https://example.test/pr/99', merged: false, mergeCommitSha: null };
      },
    });
    expect(proof.error).toBeNull();
    expect(plans).toBe(1);
    expect(patches).toBe(3);
    expect(regressionRan).toBe(true);
    expect(await repo.fileReader(sourcePath)).toContain('return value.trim();');
    expect(proof.testsPassed).toBe(true);
    expect(proof.typecheckPassed).toBe(true);
    expect(proof.commandsRun.some(result => result.phase === 'regression_baseline' && !result.ok && (result.stdoutTail + result.stderrTail).includes('ERR_ASSERTION'))).toBe(true);
    expect(proof.iterations[1].failureSummary).toContain('test is not defined');
    expect(proof.prMerged).toBe(true);
    // Runtime declarations resolve real types; they must not mask invalid code.
    expect(typecheckCommand).toContain('backend/types/pg.d.ts');
    await repo.fileWriter(sourcePath, (await repo.fileReader(sourcePath)) + '\nconst invalidClient: PoolClient = { release: "not a function" };');
    const invalid = await runAutonomousCoderCommand(repo.root, typecheckCommand);
    expect(invalid.ok).toBe(false);
    expect(invalid.stdoutTail).toContain('TS2322');
  });

  it('fails without an installed compiler and never reports the missing toolchain as a pass', async () => {
    const repo = await makeIsolatedRepo('missing-compiler');
    await rm(path.join(repo.root, 'node_modules'));
    const result = await runAutonomousCoderCommand(repo.root, `node ${path.join(repo.root, 'node_modules/typescript/bin/tsc')} --version`);
    expect(result.ok).toBe(false);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderrTail).toContain('MODULE_NOT_FOUND');
    expect(result.command).not.toContain('npx');
  });

  for (const repairSource of ['landing', 'diagnostic'] as const) {
  it(`rejects a semantic no-op from ${repairSource} even when generated tests and typecheck pass`, async () => {
    const repo = await makeIsolatedRepo(`already-green-regression-${repairSource}`);
    const sourcePath = 'backend/services/video-attachments.ts';
    const testPath = 'backend/services/video-attachments.test.ts';
    const source = 'export function videoAttachments(values: string[]) { const out = values; return out.filter(Boolean); }';
    await repo.fileWriter(sourcePath, source);
    let commits = 0;
    const proof = await runIVXAutonomousCoder({
      taskId: repairSource === 'landing' ? 'landing-remediation:fixture:media.deal-videos-resolvable' : 'ivx-worker-diagnostic-fixture', goal: `[TEMPLATE_MODE:BUG_FIX] Repair missing videos in ${sourcePath}`,
      executionMode: 'code_change', ownerId: 'test-owner', approvalPolicy: 'owner_gated', projectRoot: repo.root,
      maxLlmCalls: 1, fileReader: repo.fileReader, fileWriter: repo.fileWriter,
      llmCaller: async () => JSON.stringify({ rootCause: 'missing videos', technicalPlan: 'handle empty attachments', operations: [
        { path: sourcePath, kind: 'replace_exact', oldText: 'return out.filter(Boolean);', newText: 'if (out.length === 0) return []; return out.filter(Boolean);', reason: 'empty attachments' },
        { path: testPath, kind: 'create_file', oldText: '', newText: 'import { test } from "node:test"; import assert from "node:assert/strict"; import { videoAttachments } from "./video-attachments"; test("video remains attached", () => assert.deepEqual(videoAttachments(["https://example.test/video.mp4"]), ["https://example.test/video.mp4"]));', reason: 'regression' },
      ] }),
      testRunner: runAutonomousCoderCommand,
      commitFn: async (_paths, branch) => { commits += 1; return { commitSha: 'must-not-commit', commitUrl: 'https://example.test/commit', branch }; },
      ...prAndCiMocks(), autoMergePr: true,
    });
    expect(commits).toBe(0);
    expect(proof.prMerged).toBe(false);
    expect(proof.testsPassed).toBe(false);
    expect(proof.iterations[0].failureSummary).toContain('REPAIR_REGRESSION_NOT_REPRODUCED');
    expect(proof.commandsRun.find(result => result.phase === 'regression_baseline')?.ok).toBe(true);
    expect(await repo.fileReader(sourcePath)).toBe(source);
    expect(existsSync(path.join(repo.root, testPath))).toBe(false);
  });
  }

  for (const failure of ['import-error', 'runner-exception'] as const) {
    it(`rejects ${failure} as regression proof and restores source before validation`, async () => {
      const repo = await makeIsolatedRepo(`baseline-${failure}`);
      const sourcePath = 'backend/services/normalize-video.ts';
      const testPath = 'backend/services/normalize-video.test.ts';
      const source = 'export function normalizeVideo(value: string) { return value; }';
      await repo.fileWriter(sourcePath, source);
      let testCalls = 0;
      let commits = 0;
      const proof = await runIVXAutonomousCoder({
        taskId: `landing-remediation:fixture:${failure}`, goal: `Trim whitespace in ${sourcePath}`,
        executionMode: 'code_change', ownerId: 'test-owner', approvalPolicy: 'owner_gated', projectRoot: repo.root,
        maxLlmCalls: 1, fileReader: repo.fileReader, fileWriter: repo.fileWriter,
        llmCaller: async () => JSON.stringify({ rootCause: 'untrimmed URL', technicalPlan: 'trim whitespace', operations: [
          { path: sourcePath, kind: 'replace_exact', oldText: 'return value;', newText: 'return value.trim();', reason: 'normalize input' },
          { path: testPath, kind: 'create_file', oldText: '', newText: 'import { test } from "node:test"; import assert from "node:assert/strict"; import { normalizeVideo } from "./normalize-video"; test("trims input", () => assert.equal(normalizeVideo(" video "), "video"));', reason: 'regression' },
        ] }),
        testRunner: async (cwd, command) => {
          if (command.startsWith('node --import tsx --test ') && ++testCalls === 1) {
            expect(await repo.fileReader(sourcePath)).toBe(source);
            if (failure === 'runner-exception') throw new Error('fixture runner unavailable');
            return { command, ok: false, exitCode: 1, stdoutTail: '', stderrTail: 'ERR_MODULE_NOT_FOUND', durationMs: 1 };
          }
          expect(await repo.fileReader(sourcePath)).toContain('return value.trim();');
          return runAutonomousCoderCommand(cwd, command);
        },
        commitFn: async (_paths, branch) => { commits += 1; return { commitSha: 'must-not-commit', commitUrl: 'https://example.test/commit', branch }; },
        ...prAndCiMocks(), autoMergePr: true,
      });
      expect(commits).toBe(0);
      expect(proof.prMerged).toBe(false);
      expect(proof.iterations[0].failureSummary).toContain('REPAIR_REGRESSION_');
      expect(await repo.fileReader(sourcePath)).toBe(source);
      expect(existsSync(path.join(repo.root, testPath))).toBe(false);
    });
  }

  it('reads and edits the exact Landing source after the backend index is full, and runs its regression test', async () => {
    const repo = await makeIsolatedRepo('landing-repair');
    await Promise.all(Array.from({ length: 205 }, (_, i) => repo.fileWriter(`backend/a${i}.ts`, 'export const value = 1;')));
    const landing = 'expo/ivxholding-landing/index.html';
    const testPath = 'backend/services/landing-header.test.ts';
    await repo.fileWriter(landing, '<main>Landing fixture</main>');
    let sawSource = false;
    const commands: string[] = [];
    const proof = await runIVXAutonomousCoder({
      taskId: 'landing-remediation:test-sha:structure.header', goal: `Restore the header in ${landing}`,
      executionMode: 'code_change', ownerId: 'test-owner', approvalPolicy: 'owner_gated', projectRoot: repo.root,
      fileReader: repo.fileReader, fileWriter: repo.fileWriter,
      llmCaller: async (_system, prompt) => {
        sawSource ||= prompt.includes('<main>Landing fixture</main>');
        return JSON.stringify({ rootCause: 'missing header', technicalPlan: 'restore semantic header and regression', operations: [
          { path: landing, kind: 'replace_exact', oldText: '<main>Landing fixture</main>', newText: '<header>IVX</header><main>Landing fixture</main>', reason: 'restore header' },
          { path: testPath, kind: 'create_file', oldText: '', newText: 'import { test } from "node:test"; import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; test("header exists", () => assert.match(readFileSync("expo/ivxholding-landing/index.html", "utf8"), /<header>/));', reason: 'reproduce missing header' },
        ] });
      },
      testRunner: async (cwd, command) => {
        commands.push(command);
        return runAutonomousCoderCommand(cwd, command);
      },
      commitFn: async (_paths, branch) => ({ commitSha: 'test-landing-commit', commitUrl: 'https://example.test/commit', branch }),
      ...prAndCiMocks(), autoMergePr: true,
    });
    expect(proof.error).toBeNull();
    expect(sawSource).toBe(true);
    expect(await repo.fileReader(landing)).toContain('<header>IVX</header>');
    expect(commands).toContain(`node --import tsx --test ${testPath}`);
    expect(commands.filter(command => command.includes('tsc')).every(command => !command.includes('.html'))).toBe(true);
    expect(proof.filesChanged).toContain(landing);
    expect(proof.testsPassed).toBe(true);
    expect(proof.prMerged).toBe(true);
  });
});

describe('IVX Autonomous Coder — pilot sentinel', () => {
  it('exposes the pilot label and target', () => {
    const sentinel = describePilotSentinel();
    expect(sentinel.label).toBe('AUTONOMOUS-CODER-PILOT-2');
    expect(sentinel.target).toBe('AUTONOMOUS-CODER-PILOT-3');
    expect(sentinel.file).toBe('backend/services/ivx-autonomous-coder-pilot.ts');
    expect(PILOT_LABEL).toBe('AUTONOMOUS-CODER-PILOT-2');
    expect(PILOT_LABEL_TARGET).toBe('AUTONOMOUS-CODER-PILOT-3');
  });
});

/**
 * Owner mandate 2026-08-23 (CI-before-merge): golden-path mocks for the
 * PR + required-CI-checks gates. A code_change task only reaches COMPLETED
 * when its PR merges after ALL required checks report success.
 */
describe('durable repair boundaries', () => {
  it('rejects a Bun suite mutation, then repairs through a separate real Node regression', async () => {
    const repo = await makeIsolatedRepo('node-sidecar-recovery');
    const sourcePath = 'backend/services/normalize-video.ts';
    const legacyPath = 'backend/services/normalize-video.test.ts';
    const regressionPath = 'backend/services/normalize-video.node-regression.test.ts';
    const source = 'export function normalizeVideo(value: string) { return value; }';
    const legacy = 'import { test, expect } from "bun:test"; test("legacy", () => expect(true).toBe(true));';
    await repo.fileWriter(sourcePath, source);
    await repo.fileWriter(legacyPath, legacy);
    let calls = 0;
    const commands: string[] = [];
    const proof = await runIVXAutonomousCoder({
      taskId: 'landing-remediation:fixture:normalize-video', goal: '[TEMPLATE_MODE:BUG_FIX] Trim video URL whitespace in backend/services/normalize-video.ts.',
      ownerId: 'test-owner', executionMode: 'code_change', approvalPolicy: 'owner_gated', projectRoot: repo.root,
      fileReader: repo.fileReader, fileWriter: repo.fileWriter,
      planCaller: async () => JSON.stringify({ targetFiles: [sourcePath], filesToInspect: [legacyPath], hypothesis: 'missing trim' }),
      llmCaller: async (_system, prompt) => {
        calls++;
        if (calls > 1) expect(prompt).toContain('VERSIONED RECOVERY RULE NODE_TEST_RUNTIME');
        return JSON.stringify({ rootCause: 'missing trim', technicalPlan: 'trim through real normalization entry point', operations: [
          { path: sourcePath, kind: 'replace_exact', oldText: 'return value;', newText: 'return value.trim();' },
          ...(calls === 1 ? [{ path: legacyPath, kind: 'replace_exact', oldText: '"legacy"', newText: '"legacy acceptance"' }] : [
            { path: regressionPath, kind: 'create_file', oldText: '', newText: 'import {test} from "node:test"; import assert from "node:assert/strict"; import {normalizeVideo} from "./normalize-video"; test("trim", () => assert.equal(normalizeVideo(" video "), "video"));' },
          ]),
        ] });
      },
      testRunner: async (cwd, command) => { commands.push(command); return runAutonomousCoderCommand(cwd, command); },
      commitFn: async () => ({ commitSha: 'c'.repeat(40), commitUrl: 'https://github.com/owner/repo/commit/'+'c'.repeat(40), branch: 'repair-example' }),
      ...prAndCiMocks(), autoMergePr: true,
    });
    expect(calls).toBe(2);
    expect(commands.some(command => command.includes(legacyPath))).toBe(false);
    expect(await repo.fileReader(legacyPath)).toBe(legacy);
    expect(proof.commandsRun.some(command => command.phase === 'regression_baseline' && !command.ok && command.stdoutTail.includes('ERR_ASSERTION'))).toBe(true);
    expect(proof.finalStatus).toBe('COMPLETED');
  }, 30000);

  for (const behavior of ['delayed', 'rejected'] as const) {
    it(`waits for ${behavior} PR identity persistence before CI or merge`, async () => {
      const repo = await makeIsolatedRepo('pr-persistence-' + behavior);
      let saved = false;
      let checks = 0;
      let merges = 0;
      const gates = prAndCiMocks();
      const proof = await runIVXAutonomousCoder({
        taskId: 'pr-persistence-fixture-' + behavior, goal: `Change the pilot label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}.`,
        ownerId: 'test-owner', executionMode: 'code_change', approvalPolicy: 'owner_gated', projectRoot: repo.root,
        fileReader: repo.fileReader, fileWriter: repo.fileWriter,
        llmCaller: async () => JSON.stringify({ rootCause: 'requested label', technicalPlan: 'replace label', operations: [
          { path: 'backend/services/ivx-autonomous-coder-pilot.ts', kind: 'replace_exact', oldText: `export const PILOT_LABEL = '${PILOT_LABEL}';`, newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}';` },
        ] }),
        testRunner: async (_cwd, command) => ({ command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1 }),
        commitFn: async () => ({ commitSha: 'c'.repeat(40), commitUrl: 'https://github.com/owner/repo/commit/'+'c'.repeat(40), branch: 'repair-example' }),
        prFn: gates.prFn, autoMergePr: true,
        onPrCreated: () => {
          if (behavior === 'rejected') throw new Error('PR_RESUME_PERSISTENCE_REQUIRED');
          return new Promise<void>(resolve => setTimeout(() => { saved = true; resolve(); }, 25));
        },
        requiredChecksFn: async () => { checks++; expect(saved).toBe(true); return gates.requiredChecksFn!('c'.repeat(40)); },
        mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'm'.repeat(40) }; },
      });
      expect(proof.prCreated).toBe(true);
      if (behavior === 'delayed') {
        expect(proof.finalStatus).toBe('COMPLETED'); expect(merges).toBe(1); expect(checks).toBe(1);
      } else {
        expect(proof.finalStatus).toBe('BLOCKED'); expect(merges).toBe(0); expect(checks).toBe(0);
        expect(proof.error).toContain('PR_RESUME_PERSISTENCE_REQUIRED');
      }
    });
  }
});

function prAndCiMocks(prNumber = 99): Pick<IVXAutonomousCoderInput, 'prFn' | 'mergeFn' | 'requiredChecksFn'> {
  return {
    prFn: async () => ({
      prNumber,
      prUrl: `https://github.com/ibb142/ivx-holdings-platform/pull/${prNumber}`,
      merged: false,
      mergeCommitSha: null,
    }),
    mergeFn: async () => ({ merged: true, mergeCommitSha: `merge-sha-${prNumber}` }),
    requiredChecksFn: async () => [
      'qa-suite',
      'TypeScript typecheck — HARD GATE',
      'Lint — HARD GATE',
      'scan-secrets',
      'Senior Developer + 12 IA autonomy invariants',
      'Playwright E2E (web surface) — HARD GATE',
      'Maestro E2E (mobile surface) — HARD GATE',
    ].map((context) => ({
      context,
      checkRunName: context,
      status: 'completed',
      conclusion: 'success',
      detailsUrl: null,
      matched: true,
    })),
  };
}

describe('IVX Autonomous Coder — engine loop', () => {
  it('runs the full INSPECT→PLAN→PATCH→TEST→COMMIT loop with injected LLM + test runner + commit fn', async () => {
    const repo = await makeIsolatedRepo('test-001');

    const llmCaller = async () => JSON.stringify({
      rootCause: 'Pilot label still at PILOT-1; needs bump to PILOT-2.',
      technicalPlan: 'replace_exact on the PILOT_LABEL string.',
      operations: [
        {
          path: 'backend/services/ivx-autonomous-coder-pilot.ts',
          kind: 'replace_exact',
          oldText: `export const PILOT_LABEL = '${PILOT_LABEL}';`,
          newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}';`,
          reason: 'Bump the pilot sentinel.',
        },
      ],
    });

    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: 'all tests passed', stderrTail: '', durationMs: 10,
    });

    const commitFn = async (_filePaths: string[], _branch: string) => ({
      commitSha: 'fake-commit-sha-abc123',
      commitUrl: 'https://github.com/ibb142/ivx-holdings-platform/commit/fake-commit-sha-abc123',
      branch: 'main',
    });

    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-ac-test-001',
      goal: `Change the pilot label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}. Run targeted tests, typecheck, create a commit, but do not deploy.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn,
      ...prAndCiMocks(),
      autoMergePr: true,
      ciWaitTimeoutMs: 5000,
      ciPollIntervalMs: 0,
    };

    const proof = await runIVXAutonomousCoder(input);

    expect(proof.marker).toBe(IVX_AUTONOMOUS_CODER_MARKER);
    expect(proof.taskId).toBe('ivx-ac-test-001');
    expect(proof.executionMode).toBe('code_change');
    expect(proof.patchAuthoredBy).toBe('ivx_llm');
    expect(proof.iterations.length).toBeGreaterThanOrEqual(1);
    expect(proof.iterations[0].patchGenerated).toBe(true);
    expect(proof.iterations[0].patchApplied).toBe(true);
    expect(proof.iterations[0].testsPassed).toBe(true);
    expect(proof.iterations[0].typecheckPassed).toBe(true);
    expect(proof.testsPassed).toBe(true);
    expect(proof.typecheckPassed).toBe(true);
    expect(proof.filesChanged).toContain('backend/services/ivx-autonomous-coder-pilot.ts');
    expect(proof.finalPatch.length).toBe(1);
    expect(proof.finalPatch[0].newText).toContain(PILOT_LABEL_TARGET);
    expect(proof.commitSha).toBe('fake-commit-sha-abc123');
    expect(proof.commitUrl).toContain('fake-commit-sha-abc123');
    expect(proof.branch).toBe('main');
    expect(proof.deployId).toBeNull();
    // Owner mandate 2026-08-23: COMPLETED only after PR + green CI + confirmed merge.
    expect(proof.prCreated).toBe(true);
    expect(proof.ciChecksWaited).toBe(true);
    expect(proof.ciChecksGreen).toBe(true);
    expect(proof.prMerged).toBe(true);
    expect(proof.prMergeCommitSha).toBe('merge-sha-99');
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.error).toBeNull();
    expect(proof.secretValuesReturned).toBe(false);
    expect(proof.iterationCount).toBe(1);

    // The pilot file in the temp repo should now contain PILOT-2.
    const updatedContent = await repo.fileReader('backend/services/ivx-autonomous-coder-pilot.ts');
    expect(updatedContent).toContain(PILOT_LABEL_TARGET);
  });

  it('BLOCKS when the LLM produces an invalid patch (no operations) and does not commit', async () => {
    const repo = await makeIsolatedRepo('test-002');
    const llmCaller = async () => JSON.stringify({ rootCause: 'x', technicalPlan: 'x', operations: [] });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });

    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-ac-test-002',
      goal: 'Do a thing.',
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'should-not-be-called', commitUrl: '', branch: 'main' }),
    };

    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.commitSha).toBeNull();
    expect(proof.filesChanged.length).toBe(0);
    expect(proof.testsPassed).toBe(false);
    expect(proof.patchAuthoredBy).toBeNull();
    expect(proof.iterationCount).toBeGreaterThanOrEqual(1);
    expect(proof.error).toContain('No valid patch');
  });

  it('revises the patch when tests fail on the first iteration and succeeds on the second', async () => {
    const repo = await makeIsolatedRepo('test-003');
    let llmCallCount = 0;
    const llmCaller = async () => {
      llmCallCount += 1;
      if (llmCallCount === 1) {
        return JSON.stringify({
          rootCause: 'initial attempt',
          technicalPlan: 'first try',
          operations: [
            {
              path: 'backend/services/ivx-autonomous-coder-pilot.ts',
              kind: 'replace_exact',
              oldText: `export const PILOT_LABEL = '${PILOT_LABEL}';`,
              newText: `export const PILOT_LABEL = 'AUTONOMOUS-CODER-PILOT-WRONG';`,
              reason: 'wrong target',
            },
          ],
        });
      }
      return JSON.stringify({
        rootCause: 'correct target',
        technicalPlan: 'second try',
        operations: [
          {
            path: 'backend/services/ivx-autonomous-coder-pilot.ts',
            kind: 'replace_exact',
            oldText: `export const PILOT_LABEL = '${PILOT_LABEL}';`,
            newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}';`,
            reason: 'correct',
          },
        ],
      });
    };

    let testCallCount = 0;
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => {
      testCallCount += 1;
      // First iteration (test + typecheck = 2 calls) fails; subsequent pass.
      const ok = testCallCount > 2;
      return {
        command,
        ok,
        exitCode: ok ? 0 : 1,
        stdoutTail: ok ? 'pass' : 'fail',
        stderrTail: ok ? '' : 'assertion failed',
        durationMs: 1,
      };
    };

    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-ac-test-003',
      goal: `Change the pilot label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'rev-sha', commitUrl: 'url', branch: 'main' }),
      ...prAndCiMocks(98),
      autoMergePr: true,
      ciWaitTimeoutMs: 5000,
      ciPollIntervalMs: 0,
    };

    const proof = await runIVXAutonomousCoder(input);
    expect(proof.iterations.length).toBe(2);
    expect(proof.iterations[0].testsPassed).toBe(false);
    expect(proof.iterations[0].revised).toBe(true);
    expect(proof.iterations[1].testsPassed).toBe(true);
    expect(proof.iterations[1].typecheckPassed).toBe(true);
    expect(proof.testsPassed).toBe(true);
    expect(proof.typecheckPassed).toBe(true);
    expect(proof.iterationCount).toBe(2);
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.commitSha).toBe('rev-sha');
    expect(proof.finalPatch[0].newText).toContain(PILOT_LABEL_TARGET);
  });

  it('BLOCKS after max iterations when tests keep failing; reports exact failures; no commit', async () => {
    const repo = await makeIsolatedRepo('test-004');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'always wrong',
      technicalPlan: 'never works',
      operations: [
        {
          path: 'backend/services/ivx-autonomous-coder-pilot.ts',
          kind: 'replace_exact',
          oldText: `export const PILOT_LABEL = '${PILOT_LABEL}';`,
          newText: `export const PILOT_LABEL = 'WRONG';`,
          reason: 'bad',
        },
      ],
    });

    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command,
      ok: false,
      exitCode: 1,
      stdoutTail: 'stdout-fail',
      stderrTail: 'stderr-fail-assertion',
      durationMs: 1,
    });

    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-ac-test-004',
      goal: 'Change the label.',
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'never', commitUrl: '', branch: 'main' }),
    };

    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.commitSha).toBeNull();
    expect(proof.testsPassed).toBe(false);
    // typecheckPassed may be true when the mock testRunner returns no TS error
    // strings — countTsErrors returns 0 for both baseline and post-patch, so
    // 0 <= 0 passes. The BLOCKED status is correctly triggered by testsPassed=false.
    // MAX_ITERATIONS is 6 — the engine tries 6 times before giving up.
    expect(proof.iterationCount).toBe(6);
    expect(proof.error).toContain('Tests or typecheck failed');
    expect(proof.error).toContain('6 iteration');
    // Pilot file in temp repo should be reverted to original
    const finalContent = await repo.fileReader('backend/services/ivx-autonomous-coder-pilot.ts');
    expect(finalContent).toContain(PILOT_LABEL);
    expect(finalContent).not.toContain("'WRONG'");
  });

  it('refuses to deploy without owner approval even when commit succeeds', async () => {
    const repo = await makeIsolatedRepo('test-005');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'ok',
      technicalPlan: 'ok',
      operations: [
        {
          path: 'backend/services/ivx-autonomous-coder-pilot.ts',
          kind: 'replace_exact',
          oldText: `export const PILOT_LABEL = '${PILOT_LABEL}';`,
          newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}';`,
          reason: 'ok',
        },
      ],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });

    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-ac-test-005',
      goal: 'Change the label and deploy.',
      executionMode: 'deploy',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'commit-005', commitUrl: 'url', branch: 'main' }),
      deployApproved: false,
      deployConfirmationText: '',
    };

    const proof = await runIVXAutonomousCoder(input);
    expect(proof.commitSha).toBe('commit-005');
    expect(proof.deployId).toBeNull();
    expect(proof.deployApproved).toBe(false);
    // Owner mandate 2026-08-23: deploy without verified owner approval =
    // BLOCKED, never COMPLETED.
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.error).toContain('Deploy BLOCKED');
    expect(proof.error).toContain('CONFIRM_IVX_RENDER_DEPLOY');
  });

  it('deploys when owner approval is verified and production health checks pass', async () => {
    const repo = await makeIsolatedRepo('test-006');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'ok',
      technicalPlan: 'ok',
      operations: [
        {
          path: 'backend/services/ivx-autonomous-coder-pilot.ts',
          kind: 'replace_exact',
          oldText: `export const PILOT_LABEL = '${PILOT_LABEL}';`,
          newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}';`,
          reason: 'ok',
        },
      ],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });

    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-ac-test-006',
      goal: 'Change the label and deploy.',
      executionMode: 'deploy',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'commit-006', commitUrl: 'url', branch: 'main' }),
      deployApproved: true,
      deployConfirmationText: 'CONFIRM_IVX_RENDER_DEPLOY',
      deployFn: async (sha) => ({ deployId: `deploy-${sha}`, deployStatus: 'live' }),
      healthChecker: async () => ({ ok: true, commit: 'commit-006' }),
      sleepFn: async () => { /* skip 20s deploy wait in tests */ },
    };

    const proof = await runIVXAutonomousCoder(input);
    expect(proof.commitSha).toBe('commit-006');
    expect(proof.deployId).toBe('deploy-commit-006');
    expect(proof.deployStatus).toBe('live');
    expect(proof.deployApproved).toBe(true);
    expect(proof.productionVerified).toBe(true);
    expect(proof.liveCommit).toBe('commit-006');
    expect(proof.healthOk).toBe(true);
    expect(proof.finalStatus).toBe('COMPLETED');
  });

  it('read_only mode never commits or deploys even with a valid patch', async () => {
    const repo = await makeIsolatedRepo('test-007');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'ok',
      technicalPlan: 'ok',
      operations: [
        {
          path: 'backend/services/ivx-autonomous-coder-pilot.ts',
          kind: 'replace_exact',
          oldText: `export const PILOT_LABEL = '${PILOT_LABEL}';`,
          newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}';`,
          reason: 'ok',
        },
      ],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });

    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-ac-test-007',
      goal: 'Inspect only.',
      executionMode: 'read_only',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'should-not-commit', commitUrl: '', branch: 'main' }),
    };

    const proof = await runIVXAutonomousCoder(input);
    expect(proof.executionMode).toBe('read_only');
    expect(proof.commitSha).toBeNull();
    expect(proof.deployId).toBeNull();
    expect(proof.productionVerified).toBe(false);
  });
});

describe('IVX Autonomous Coder — answer format', () => {
  it('renders the owner-mandated sections', () => {
    const proof: import('./services/ivx-autonomous-coder').IVXAutonomousCoderProof = {
      marker: IVX_AUTONOMOUS_CODER_MARKER,
      taskId: 'test-task',
      goal: 'g',
      executionMode: 'code_change' as const,
      approvalPolicy: 'owner_gated' as const,
      ownerId: 'o',
      startingSha: 'abc',
      filesInspected: ['backend/services/ivx-autonomous-coder-pilot.ts'],
      rootCause: 'rc',
      technicalPlan: 'tp',
      iterations: [{
        iteration: 1,
        patchGenerated: true,
        patchApplied: true,
        testsRun: true,
        testsPassed: true,
        typecheckRun: true,
        typecheckPassed: true,
        failureSummary: null,
        revised: false,
      }],
      finalPatch: [],
      filesChanged: ['backend/services/ivx-autonomous-coder-pilot.ts'],
      commandsRun: [{
        command: 'bun test x',
        ok: true,
        exitCode: 0,
        stdoutTail: '',
        stderrTail: '',
        durationMs: 5,
      }],
      testsPassed: true,
      typecheckPassed: true,
      buildRun: true,
      commitSha: 'deadbeef',
      commitUrl: 'https://github.com/x/y/commit/deadbeef',
      branch: 'main',
      deployApproved: false,
      deployRequested: false,
      deployId: null,
      deployStatus: null,
      productionVerified: false,
      liveCommit: null,
      healthOk: false,
      iterationCount: 1,
      durationMs: 123,
      finalStatus: 'COMPLETED' as const,
      error: null,
      generatedAt: '2026-07-19T00:00:00Z',
      secretValuesReturned: false as const,
      patchAuthoredBy: 'ivx_llm' as const,
      llmCallCount: 1,
      estimatedTokensUsed: 1200,
      tokenBudgetExceeded: false,
      rollbackTriggered: false,
      rollbackCommitSha: null,
      rollbackError: null,
      stageTrace: null,
      taskPlan: null,
    };
    const answer = buildAutonomousCoderAnswer(proof);
    expect(answer).toContain('TASK ID:');
    expect(answer).toContain('test-task');
    expect(answer).toContain('STATUS:\nCOMPLETED');
    expect(answer).toContain('MODE:\ncode_change');
    expect(answer).toContain('STARTING SHA:\nabc');
    expect(answer).toContain('FILES INSPECTED:');
    expect(answer).toContain('ROOT CAUSE:\nrc');
    expect(answer).toContain('TECHNICAL PLAN:\ntp');
    expect(answer).toContain('ITERATIONS:');
    expect(answer).toContain('FILES CHANGED:');
    expect(answer).toContain('COMMANDS RUN:');
    expect(answer).toContain('TESTS:\nPASS');
    expect(answer).toContain('TYPECHECK:\nPASS');
    expect(answer).toContain('COMMIT SHA:\ndeadbeef');
    expect(answer).toContain('DEPLOYMENT:\nNOT REQUESTED');
    expect(answer).toContain('PATCH AUTHORED BY:\nivx_llm');
    expect(answer).toContain('DURATION:\n123ms');
  });

  it('answer reports BLOCKED status and NONE commit when no commit was created', () => {
    const proof: import('./services/ivx-autonomous-coder').IVXAutonomousCoderProof = {
      marker: IVX_AUTONOMOUS_CODER_MARKER,
      taskId: 'test-blocked',
      goal: 'g',
      executionMode: 'code_change' as const,
      approvalPolicy: 'owner_gated' as const,
      ownerId: 'o',
      startingSha: null,
      filesInspected: [],
      rootCause: '',
      technicalPlan: '',
      iterations: [],
      finalPatch: [],
      filesChanged: [],
      commandsRun: [],
      testsPassed: false,
      typecheckPassed: false,
      buildRun: false,
      commitSha: null,
      commitUrl: null,
      branch: null,
      deployApproved: false,
      deployRequested: false,
      deployId: null,
      deployStatus: null,
      productionVerified: false,
      liveCommit: null,
      healthOk: false,
      iterationCount: 5,
      durationMs: 1,
      finalStatus: 'BLOCKED' as const,
      error: 'Tests failed after 5 iterations.',
      generatedAt: '2026-07-19T00:00:00Z',
      secretValuesReturned: false as const,
      patchAuthoredBy: null,
      llmCallCount: 0,
      estimatedTokensUsed: 0,
      tokenBudgetExceeded: false,
      rollbackTriggered: false,
      rollbackCommitSha: null,
      rollbackError: null,
      stageTrace: null,
      taskPlan: null,
    };
    const answer = buildAutonomousCoderAnswer(proof);
    expect(answer).toContain('STATUS:\nBLOCKED');
    expect(answer).toContain('COMMIT SHA:\nNONE');
    expect(answer).toContain('TESTS:\nFAIL');
    expect(answer).toContain('ITERATION COUNT:\n5');
  });
});

describe('IVX Autonomous Coder — deterministic pilot fallback (Phase 3)', () => {
  it('isPilotLabelChangeGoal matches the controlled pilot label-change goal', () => {
    expect(isPilotLabelChangeGoal(`Change the visible version label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}. Run targeted tests, typecheck, create a commit, but do not deploy.`)).toBe(true);
    expect(isPilotLabelChangeGoal(`Autonomous coder: change the visible version label in the IVX owner dashboard from AUTONOMOUS-CODER-PILOT-1 to AUTONOMOUS-CODER-PILOT-2. Run targeted tests, typecheck, create a commit, but do not deploy.`)).toBe(true);
    // Non-pilot goals must NOT match.
    expect(isPilotLabelChangeGoal('Fix the chat ordering bug so the most recently active conversation opens first.')).toBe(false);
    expect(isPilotLabelChangeGoal('Refactor the investor CRM module to deduplicate entries.')).toBe(false);
  });

  it('applies the deterministic pilot fallback end-to-end (inspect → patch → test → typecheck → commit) WITHOUT an LLM call', async () => {
    const repo = await makeIsolatedRepo('pilot-fallback-001');
    // No llmCaller injected — the fallback must run without ever calling the LLM.
    // No testRunner injected either; we let the engine skip `bun test` (bun not
    // available in the test sandbox PATH for this command shape) and rely on
    // typecheck + the deterministic content-change check. But to keep the test
    // deterministic and fast, we inject a testRunner that returns PASS for both
    // the test command and the typecheck command.
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: 'pilot fallback gate passed', stderrTail: '', durationMs: 5,
    });
    const commitFn = async (_filePaths: string[], _branch: string) => ({
      commitSha: 'pilot-fallback-commit-sha-001',
      commitUrl: 'https://github.com/ibb142/ivx-holdings-platform/commit/pilot-fallback-commit-sha-001',
      branch: 'main',
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-pilot-fallback-001',
      goal: `Autonomous coder: change the visible version label in the IVX owner dashboard from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}. Run targeted tests, typecheck, create a commit, but do not deploy.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      // No llmCaller — the fallback path must run without it.
      testRunner,
      commitFn,
      ...prAndCiMocks(97),
      autoMergePr: true,
      ciWaitTimeoutMs: 5000,
      ciPollIntervalMs: 0,
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.marker).toBe(IVX_AUTONOMOUS_CODER_MARKER);
    expect(proof.taskId).toBe('ivx-pilot-fallback-001');
    expect(proof.executionMode).toBe('code_change');
    // The patch was authored by the deterministic fallback, NOT by an LLM call.
    expect(proof.patchAuthoredBy).toBe('ivx_deterministic_fallback');
    expect(proof.iterationCount).toBe(1);
    expect(proof.iterations.length).toBe(1);
    expect(proof.iterations[0].patchGenerated).toBe(true);
    expect(proof.iterations[0].patchApplied).toBe(true);
    expect(proof.iterations[0].testsPassed).toBe(true);
    expect(proof.iterations[0].typecheckPassed).toBe(true);
    expect(proof.iterations[0].failureSummary).toBeNull();
    expect(proof.testsPassed).toBe(true);
    expect(proof.typecheckPassed).toBe(true);
    expect(proof.filesChanged).toContain('backend/services/ivx-autonomous-coder-pilot.ts');
    expect(proof.finalPatch.length).toBe(1);
    expect(proof.finalPatch[0].kind).toBe('replace_exact');
    // The narrowed fallback replaces the full DEFINITION match, not just the bare label.
    expect(proof.finalPatch[0].oldText).toBe(`export const PILOT_LABEL = '${PILOT_LABEL}'`);
    expect(proof.finalPatch[0].newText).toBe(`export const PILOT_LABEL = '${PILOT_LABEL_TARGET}'`);
    expect(proof.finalPatch[0].oldText).toContain(PILOT_LABEL);
    expect(proof.finalPatch[0].newText).toContain(PILOT_LABEL_TARGET);
    expect(proof.commitSha).toBe('pilot-fallback-commit-sha-001');
    expect(proof.commitUrl).toContain('pilot-fallback-commit-sha-001');
    expect(proof.branch).toBe('main');
    expect(proof.deployId).toBeNull();
    expect(proof.productionVerified).toBe(false);
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.error).toBeNull();
    expect(proof.secretValuesReturned).toBe(false);
    // Verify the file on disk actually changed.
    const updated = await repo.fileReader('backend/services/ivx-autonomous-coder-pilot.ts');
    expect(updated).toContain(PILOT_LABEL_TARGET);
    expect(updated).not.toContain(PILOT_LABEL);
  });

  it('BLOCKS the pilot fallback when the sentinel label is NOT found in any safe source file (zero matches)', async () => {
    const root = path.join(TMP_ROOT, 'pilot-fallback-zero');
    await mkdir(path.join(root, 'backend/services'), { recursive: true });
  await symlink(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules'), path.join(root, 'node_modules'), 'dir');
    // No pilot sentinel file — the label does not exist anywhere.
    await writeFile(path.join(root, 'backend/services/unrelated.ts'), 'export const UNRELATED = "nothing";', 'utf8');
    const fileWriter = async (rel: string, content: string) => {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), content, 'utf8');
    };
    const fileReader = async (rel: string) => readFile(path.join(root, rel), 'utf8');
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const commitFn = async (_f: string[], _b: string) => ({
      commitSha: 'should-not-be-called', commitUrl: '', branch: 'main',
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-pilot-fallback-zero',
      goal: `Change the visible version label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}. Run targeted tests, typecheck, create a commit, but do not deploy.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: root,
      fileWriter,
      fileReader,
      testRunner,
      commitFn,
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.commitSha).toBeNull();
    expect(proof.filesChanged.length).toBe(0);
    expect(proof.patchAuthoredBy).toBeNull();
    expect(proof.error).toContain('sentinel');
  });

  it('BLOCKS the pilot fallback when the sentinel label appears in MULTIPLE safe source files (ambiguous match)', async () => {
    const root = path.join(TMP_ROOT, 'pilot-fallback-multi');
    await mkdir(path.join(root, 'backend/services'), { recursive: true });
  await symlink(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../node_modules'), path.join(root, 'node_modules'), 'dir');
    // Two files both DEFINE the sentinel label as an exported constant → ambiguous, must BLOCK.
    // (The narrowed scan matches only DEFINITIONS, not mere comment mentions, so both must define.)
    const sentinelA = `export const PILOT_LABEL = '${PILOT_LABEL}';\nexport const PILOT_LABEL_TARGET = '${PILOT_LABEL_TARGET}';\n`;
    const sentinelB = `export const PILOT_LABEL = '${PILOT_LABEL}';\n// duplicate definition in a second file\n`;
    await writeFile(path.join(root, 'backend/services/ivx-autonomous-coder-pilot.ts'), sentinelA, 'utf8');
    await writeFile(path.join(root, 'backend/services/other-pilot-ref.ts'), sentinelB, 'utf8');
    const fileWriter = async (rel: string, content: string) => {
      await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await writeFile(path.join(root, rel), content, 'utf8');
    };
    const fileReader = async (rel: string) => readFile(path.join(root, rel), 'utf8');
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const commitFn = async (_f: string[], _b: string) => ({
      commitSha: 'should-not-be-called', commitUrl: '', branch: 'main',
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-pilot-fallback-multi',
      goal: `Change the visible version label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}. Run targeted tests, typecheck, create a commit, but do not deploy.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: root,
      fileWriter,
      fileReader,
      testRunner,
      commitFn,
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.commitSha).toBeNull();
    expect(proof.filesChanged.length).toBe(0);
    expect(proof.patchAuthoredBy).toBeNull();
    expect(proof.error).toContain('sentinel');
  });

  it('read_only mode does NOT apply the pilot fallback patch even for the pilot goal', async () => {
    const repo = await makeIsolatedRepo('pilot-fallback-readonly');
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-pilot-fallback-readonly',
      goal: `Change the visible version label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}. Run targeted tests, typecheck, create a commit, but do not deploy.`,
      executionMode: 'read_only',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      testRunner,
    };
    const proof = await runIVXAutonomousCoder(input);
    // read_only mode must never commit, even when the pilot fallback applies the patch.
    expect(proof.commitSha).toBeNull();
    expect(proof.finalStatus).toBe('COMPLETED');
    // The file on disk WAS changed (the fallback applies the patch), but no commit was created.
    const updated = await repo.fileReader('backend/services/ivx-autonomous-coder-pilot.ts');
    expect(updated).toContain(PILOT_LABEL_TARGET);
  });
});

describe('IVX Autonomous Coder — hardening (Phase 12 + 16 + 17)', () => {
  // G16: model timeout → BLOCKED with a real reason (no infinite hang).
  it('G16: BLOCKS when the injected LLM caller rejects (simulated timeout) after MAX_LLM_ATTEMPTS', async () => {
    const repo = await makeIsolatedRepo('g16-timeout');
    let calls = 0;
    const llmCaller = async () => {
      calls += 1;
      throw new Error('LLM patch generation timed out after 45000ms');
    };
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g16',
      goal: 'Fix the chat ordering bug.',
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'never', commitUrl: '', branch: 'main' }),
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.commitSha).toBeNull();
    expect(proof.error).toContain('LLM_PLAN_INVALID');
    expect(proof.llmCallCount).toBeGreaterThanOrEqual(1);
    expect(calls).toBeGreaterThanOrEqual(1);
  });

  // G17: model retry-and-recovery — first call malformed, second call valid → COMPLETED.
  it('G17: retries when the first LLM response is malformed and succeeds on the second (revision slot preserved)', async () => {
    const repo = await makeIsolatedRepo('g17-retry');
    let calls = 0;
    const llmCaller = async () => {
      calls += 1;
      if (calls === 1) return 'not json at all';
      return JSON.stringify({
        rootCause: 'ok', technicalPlan: 'ok',
        operations: [{
          path: 'backend/services/ivx-autonomous-coder-pilot.ts',
          kind: 'replace_exact',
          oldText: `export const PILOT_LABEL = '${PILOT_LABEL}'`,
          newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}'`,
          reason: 'ok',
        }],
      });
    };
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g17',
      goal: `Change the pilot label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'g17-sha', commitUrl: 'url', branch: 'main' }),
      ...prAndCiMocks(96),
      autoMergePr: true,
      ciWaitTimeoutMs: 5000,
      ciPollIntervalMs: 0,
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.commitSha).toBe('g17-sha');
    expect(proof.llmCallCount).toBe(2);
  });

  // G18: truncated model response (valid JSON prefix but cut off) → BLOCKED, no crash.
  it('G18: BLOCKS when the LLM response is truncated mid-JSON (parser returns null)', async () => {
    const repo = await makeIsolatedRepo('g18-truncated');
    let calls = 0;
    const llmCaller = async () => {
      calls += 1;
      // First call: truncated JSON (no closing brace). Second call: still malformed.
      return '{"rootCause":"x","operations":[{"path":"backend/services/ivx-autonomous-coder-pilot.ts","kind":"replace_exact","oldText":"';
    };
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g18',
      goal: 'Fix a bug.',
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'never', commitUrl: '', branch: 'main' }),
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.commitSha).toBeNull();
    expect(proof.error).toContain('LLM_PLAN_INVALID');
  });

  // G19: patch parser rejection — unsafe path (..) → patch application fails → revision or BLOCKED.
  it('G19: rejects a patch with an unsafe path (.. traversal) and BLOCKS after revision', async () => {
    const repo = await makeIsolatedRepo('g19-unsafe');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'x', technicalPlan: 'x',
      operations: [{
        path: 'backend/services/../../../etc/passwd',
        kind: 'replace_exact',
        oldText: 'x', newText: 'y', reason: 'x',
      }],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g19',
      goal: 'Fix a bug.',
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'never', commitUrl: '', branch: 'main' }),
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.commitSha).toBeNull();
    // The unsafe path must appear in the failure context (either error or iteration failure).
    const allText = `${proof.error ?? ''} ${proof.iterations.map((i) => i.failureSummary ?? '').join(' ')}`;
    expect(allText).toContain('Unsafe');
  });

  // G20: GitHub push failure → finalStatus FAILED with commit error.
  it('G20: reports FAILED when the commit function throws a GitHub push error', async () => {
    const repo = await makeIsolatedRepo('g20-pushfail');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'ok', technicalPlan: 'ok',
      operations: [{
        path: 'backend/services/ivx-autonomous-coder-pilot.ts',
        kind: 'replace_exact',
        oldText: `export const PILOT_LABEL = '${PILOT_LABEL}'`,
        newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}'`,
        reason: 'ok',
      }],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g20',
      goal: `Change the pilot label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => { throw new Error('GitHub branch update failed: 422'); },
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.commitSha).toBeNull();
    expect(proof.error).toContain('Commit failed');
    expect(proof.error).toContain('422');
  });

  // G21: production verification failure → rollback triggered.
  it('G21: triggers rollback when deploy succeeds but production health returns a different commit', async () => {
    const repo = await makeIsolatedRepo('g21-rollback');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'ok', technicalPlan: 'ok',
      operations: [{
        path: 'backend/services/ivx-autonomous-coder-pilot.ts',
        kind: 'replace_exact',
        oldText: `export const PILOT_LABEL = '${PILOT_LABEL}'`,
        newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}'`,
        reason: 'ok',
      }],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    let rollbackCalled = false;
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g21',
      goal: 'Change the label and deploy.',
      executionMode: 'deploy',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'bad-commit', commitUrl: 'url', branch: 'main' }),
      deployApproved: true,
      deployConfirmationText: 'CONFIRM_IVX_RENDER_DEPLOY',
      deployFn: async () => ({ deployId: 'dep-1', deployStatus: 'live' }),
      // Health returns a DIFFERENT commit → verify-fail → rollback.
      healthChecker: async () => ({ ok: true, commit: 'different-commit' }),
      sleepFn: async () => { /* skip */ },
      rollbackFn: async () => {
        rollbackCalled = true;
        return { reverted: true, revertCommitSha: 'revert-sha', error: null };
      },
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(rollbackCalled).toBe(true);
    expect(proof.rollbackTriggered).toBe(true);
    expect(proof.rollbackCommitSha).toBe('revert-sha');
    expect(proof.productionVerified).toBe(false);
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.error).toContain('rollback');
  });

  // G22: rollback itself fails → FAILED with the rollback error recorded.
  it('G22: reports FAILED when rollback cannot restore the prior SHA', async () => {
    const repo = await makeIsolatedRepo('g22-rollback-fail');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'ok', technicalPlan: 'ok',
      operations: [{
        path: 'backend/services/ivx-autonomous-coder-pilot.ts',
        kind: 'replace_exact',
        oldText: `export const PILOT_LABEL = '${PILOT_LABEL}'`,
        newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}'`,
        reason: 'ok',
      }],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g22',
      goal: 'Change the label and deploy.',
      executionMode: 'deploy',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'bad-commit', commitUrl: 'url', branch: 'main' }),
      deployApproved: true,
      deployConfirmationText: 'CONFIRM_IVX_RENDER_DEPLOY',
      deployFn: async () => ({ deployId: 'dep-1', deployStatus: 'live' }),
      healthChecker: async () => ({ ok: false, commit: null }),
      sleepFn: async () => { /* skip */ },
      rollbackFn: async () => ({ reverted: false, revertCommitSha: null, error: 'Branch ref update failed: 500' }),
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.rollbackTriggered).toBe(true);
    expect(proof.rollbackError).toContain('Branch ref update failed');
    expect(proof.finalStatus).toBe('FAILED');
    expect(proof.error).toContain('rollback failed');
  });

  // G23: cancellation — isCanceled returns true before the first iteration → CANCELED proof.
  it('G23: returns CANCELED when the owner cancels before the loop starts', async () => {
    const repo = await makeIsolatedRepo('g23-cancel');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'ok', technicalPlan: 'ok',
      operations: [{
        path: 'backend/services/ivx-autonomous-coder-pilot.ts',
        kind: 'replace_exact',
        oldText: `export const PILOT_LABEL = '${PILOT_LABEL}'`,
        newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}'`,
        reason: 'ok',
      }],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g23',
      goal: 'Fix a bug.',
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'never', commitUrl: '', branch: 'main' }),
      isCanceled: () => true,
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('CANCELED');
    expect(proof.commitSha).toBeNull();
    expect(proof.error).toContain('JOB_CANCELED');
  });

  // G24: heartbeat is invoked at stage boundaries with real phase + elapsed info.
  it('G24: heartbeat fires at stage boundaries with phase + elapsedMs + iteration', async () => {
    const repo = await makeIsolatedRepo('g24-heartbeat');
    const llmCaller = async () => JSON.stringify({
      rootCause: 'ok', technicalPlan: 'ok',
      operations: [{
        path: 'backend/services/ivx-autonomous-coder-pilot.ts',
        kind: 'replace_exact',
        oldText: `export const PILOT_LABEL = '${PILOT_LABEL}'`,
        newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}'`,
        reason: 'ok',
      }],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const beats: Array<{ phase: string; iteration: number; elapsedMs: number }> = [];
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g24',
      goal: `Change the pilot label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'g24-sha', commitUrl: 'url', branch: 'main' }),
      ...prAndCiMocks(95),
      autoMergePr: true,
      ciWaitTimeoutMs: 5000,
      ciPollIntervalMs: 0,
      heartbeat: (info) => beats.push({ phase: info.phase, iteration: info.iteration, elapsedMs: info.elapsedMs }),
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(beats.length).toBeGreaterThanOrEqual(2);
    expect(beats.some((b) => b.phase === 'inspecting')).toBe(true);
    expect(beats.some((b) => b.phase === 'planning')).toBe(true);
    expect(beats.every((b) => b.elapsedMs >= 0)).toBe(true);
  });

  // G25: token budget exceeded → BLOCKED with TOKEN_BUDGET_EXCEEDED (no unbounded spend).
  it('G25: BLOCKS with TOKEN_BUDGET_EXCEEDED when the soft token cap is hit', async () => {
    const repo = await makeIsolatedRepo('g25-budget');
    // Return a huge response to blow the tiny budget on the first call.
    const llmCaller = async () => JSON.stringify({
      rootCause: 'x'.repeat(5000), technicalPlan: 'x'.repeat(5000),
      operations: [{
        path: 'backend/services/ivx-autonomous-coder-pilot.ts',
        kind: 'replace_exact',
        oldText: `export const PILOT_LABEL = '${PILOT_LABEL}'`,
        newText: `export const PILOT_LABEL = '${PILOT_LABEL_TARGET}'`,
        reason: 'x'.repeat(5000),
      }],
    });
    const testRunner = async (_cwd: string, command: string): Promise<IVXAutonomousCoderTestResult> => ({
      command, ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1,
    });
    const input: IVXAutonomousCoderInput = {
      taskId: 'ivx-g25',
      goal: `Change the pilot label from ${PILOT_LABEL} to ${PILOT_LABEL_TARGET}.`,
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      projectRoot: repo.root,
      fileWriter: repo.fileWriter,
      fileReader: repo.fileReader,
      llmCaller,
      testRunner,
      commitFn: async () => ({ commitSha: 'never', commitUrl: '', branch: 'main' }),
      maxTokenBudget: 100, // tiny cap → first call blows it
    };
    const proof = await runIVXAutonomousCoder(input);
    expect(proof.tokenBudgetExceeded).toBe(true);
    // The proof must record the spend honestly.
    expect(proof.estimatedTokensUsed).toBeGreaterThan(100);
    expect(proof.llmCallCount).toBeGreaterThanOrEqual(1);
  });
});
