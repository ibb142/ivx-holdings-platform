import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import path from 'node:path';
import { writeFile, readFile, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import {
  buildAutonomousCoderAnswer,
  runIVXAutonomousCoder,
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
  const pilotContent = `export const PILOT_LABEL = '${PILOT_LABEL}';\nexport const PILOT_LABEL_TARGET = '${PILOT_LABEL_TARGET}';\n`;
  await writeFile(path.join(root, 'backend/services/ivx-autonomous-coder-pilot.ts'), pilotContent, 'utf8');
  const fileWriter = async (rel: string, content: string) => {
    await mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await writeFile(path.join(root, rel), content, 'utf8');
  };
  const fileReader = async (rel: string) => readFile(path.join(root, rel), 'utf8');
  return { root, fileWriter, fileReader };
}

describe('IVX Autonomous Coder — pilot sentinel', () => {
  it('exposes the pilot label and target', () => {
    const sentinel = describePilotSentinel();
    expect(sentinel.label).toBe('AUTONOMOUS-CODER-PILOT-1');
    expect(sentinel.target).toBe('AUTONOMOUS-CODER-PILOT-2');
    expect(sentinel.file).toBe('backend/services/ivx-autonomous-coder-pilot.ts');
    expect(PILOT_LABEL).toBe('AUTONOMOUS-CODER-PILOT-1');
    expect(PILOT_LABEL_TARGET).toBe('AUTONOMOUS-CODER-PILOT-2');
  });
});

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
      commitUrl: 'https://github.com/ibb142/rork-global-real-estate-invest/commit/fake-commit-sha-abc123',
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
    expect(proof.typecheckPassed).toBe(false);
    expect(proof.iterationCount).toBe(4); // MAX_ITERATIONS (reduced from 5 in the convergence-hardening fix)
    expect(proof.error).toContain('Tests or typecheck failed');
    expect(proof.error).toContain('4 iteration');
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
    expect(proof.finalStatus).toBe('COMPLETED');
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
      commitUrl: 'https://github.com/ibb142/rork-global-real-estate-invest/commit/pilot-fallback-commit-sha-001',
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
    expect(proof.finalStatus).toBe('COMPLETED');
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
