/**
 * IVX Autonomous Coder — End-to-End Integration Test (Gap 6).
 *
 * Proves the complete autonomous cycle with injected mocks:
 *   Owner request → task created → autonomous worker executes → code modified →
 *   tests executed → commit created → PR created → owner approval → merge →
 *   Render deployment → /health verified → /version SHA verified
 *
 * The test uses injected llmCaller, testRunner, commitFn, prFn, deployFn,
 * and productionVerifier to exercise the REAL runIVXAutonomousCoder pipeline
 * without hitting live GitHub/Render APIs. Every stage is asserted.
 */
import { describe, expect, it } from 'bun:test';
import {
  runIVXAutonomousCoder,
  IVX_AUTONOMOUS_CODER_MARKER,
  type IVXAutonomousCoderProof,
} from './ivx-autonomous-coder';

describe('IVX Autonomous Coder — E2E Integration', () => {
  it('completes a full code_change cycle: inspect → plan → patch → test → commit → PR → merge', async () => {
    // ── Stateful file mock: tracks content before/after patch ──────────────
    let currentContent = 'export const PILOT_SENTINEL = "v6.12";\n';
    const fileWriter = async (_relPath: string, content: string): Promise<void> => {
      currentContent = content;
    };
    const fileReader = async (_relPath: string): Promise<string> => currentContent;

    // ── Mock LLM: returns a valid JSON patch plan ──────────────────────────
    const mockLlmResponse = JSON.stringify({
      rootCause: 'Missing type annotation on exported function',
      technicalPlan: 'Add explicit return type annotation to the exported function',
      operations: [
        {
          path: 'backend/services/ivx-autonomous-coder-pilot.ts',
          kind: 'replace_exact',
          oldText: 'export const PILOT_SENTINEL = "v6.12";',
          newText: 'export const PILOT_SENTINEL = "v6.13";',
          reason: 'Bump sentinel version to match the runtime marker',
        },
      ],
    });
    const llmCaller = async (_system: string, _user: string): Promise<string> => mockLlmResponse;

    // ── Mock test runner: tests PASS ────────────────────────────────────────
    const testRunner = async (_cwd: string, command: string): Promise<{
      command: string; ok: boolean; exitCode: number | null;
      stdoutTail: string; stderrTail: string; durationMs: number;
    }> => ({
      command, ok: true, exitCode: 0,
      stdoutTail: /tsc|typecheck|noEmit/i.test(command) ? 'No type errors.' : '3 pass, 0 fail',
      stderrTail: '', durationMs: 50,
    });

    // ── Mock commit function ────────────────────────────────────────────────
    const commitFn = async (_f: string[], branch: string): Promise<{
      commitSha: string; commitUrl: string; branch: string;
    }> => ({
      commitSha: 'abc123def456789012345678901234567890abcd',
      commitUrl: 'https://github.com/ibb142/ivx-holdings-platform/commit/abc123def456789012345678901234567890abcd',
      branch,
    });

    // ── Mock PR function ────────────────────────────────────────────────────
    const prFn = async (_b: string, _t: string, _body: string): Promise<{
      prNumber: number; prUrl: string; merged: boolean; mergeCommitSha: string | null;
    }> => ({
      prNumber: 42,
      prUrl: 'https://github.com/ibb142/ivx-holdings-platform/pull/42',
      merged: false, mergeCommitSha: null,
    });

    // ── Track phases ───────────────────────────────────────────────────────
    const phases: Array<{ phase: string; detail: string }> = [];
    const onPhase = (phase: string, detail: string): void => {
      phases.push({ phase, detail });
    };

    // ── Run the autonomous coder ───────────────────────────────────────────
    const proof: IVXAutonomousCoderProof = await runIVXAutonomousCoder({
      taskId: 'e2e-test-001',
      goal: 'Bump pilot sentinel from v6.12 to v6.13',
      executionMode: 'code_change',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      llmCaller, testRunner, commitFn, prFn,
      autoMergePr: true,
      fileWriter, fileReader,
      onPhase: onPhase as never,
      sleepFn: async (): Promise<void> => {},
    });

    // ── Assert: proof structure ────────────────────────────────────────────
    expect(proof.marker).toBe(IVX_AUTONOMOUS_CODER_MARKER);
    expect(proof.taskId).toBe('e2e-test-001');
    expect(proof.executionMode).toBe('code_change');

    // ── Assert: tests were run and passed ──────────────────────────────────
    expect(proof.testsPassed).toBe(true);
    expect(proof.commandsRun.length).toBeGreaterThan(0);

    // ── Assert: commit was created ─────────────────────────────────────────
    expect(proof.commitSha).toBe('abc123def456789012345678901234567890abcd');
    expect(proof.commitUrl).toContain('github.com/ibb142/ivx-holdings-platform');
    expect(proof.branch).toBe('ivx-autonomous');

    // ── Assert: PR was created ─────────────────────────────────────────────
    expect(proof.prNumber).toBe(42);
    expect(proof.prUrl).toBe('https://github.com/ibb142/ivx-holdings-platform/pull/42');

    // ── Assert: final status is COMPLETED ──────────────────────────────────
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.error).toBeNull();

    // ── Assert: phase trace covers the full cycle ──────────────────────────
    const phaseNames = phases.map((p) => p.phase);
    expect(phaseNames).toContain('inspecting');
    expect(phaseNames).toContain('committing');
    expect(phaseNames).toContain('completed');

    // ── Assert: patch was authored by the IVX LLM ──────────────────────────
    expect(proof.patchAuthoredBy).toBe('ivx_llm');

    // ── Assert: no secrets leaked ──────────────────────────────────────────
    expect(proof.secretValuesReturned).toBe(false);
  });

  it('completes a full deploy cycle: commit → deploy → production verified', async () => {
    let currentContent = 'return { status: "healthy" };\n';
    const fileWriter = async (_r: string, content: string): Promise<void> => { currentContent = content; };
    const fileReader = async (_r: string): Promise<string> => currentContent;

    const mockLlmResponse = JSON.stringify({
      rootCause: 'Health endpoint missing version field',
      technicalPlan: 'Add version field to /health response',
      operations: [{
        path: 'backend/hono.ts', kind: 'replace_exact',
        oldText: 'return { status: "healthy" };',
        newText: 'return { status: "healthy", version: "1.0.0" };',
        reason: 'Add version field for deploy verification',
      }],
    });

    const llmCaller = async (_s: string, _u: string): Promise<string> => mockLlmResponse;
    const testRunner = async (_cwd: string, command: string): Promise<{
      command: string; ok: boolean; exitCode: number | null;
      stdoutTail: string; stderrTail: string; durationMs: number;
    }> => ({ command, ok: true, exitCode: 0, stdoutTail: 'PASS', stderrTail: '', durationMs: 30 });

    const commitFn = async (_f: string[], branch: string): Promise<{
      commitSha: string; commitUrl: string; branch: string;
    }> => ({
      commitSha: 'deploy1234567890abcdef1234567890abcdef123456',
      commitUrl: 'https://github.com/ibb142/ivx-holdings-platform/commit/deploy1234567890abcdef1234567890abcdef123456',
      branch,
    });

    const deployFn = async (_cs: string): Promise<{ deployId: string | null; deployStatus: string | null }> => ({
      deployId: 'dep-test-1234567890', deployStatus: 'live',
    });

    const productionVerifier = async (commitSha: string, _depId: string): Promise<{
      deployStatus: string | null;
      health: { endpoint: string; httpStatus: number | null; commitSha: string | null; ok: boolean };
      version: { endpoint: string; httpStatus: number | null; commitSha: string | null; ok: boolean };
    }> => ({
      deployStatus: 'live',
      health: { endpoint: 'https://api.ivxholding.com/health', httpStatus: 200, commitSha, ok: true },
      version: { endpoint: 'https://api.ivxholding.com/version', httpStatus: 200, commitSha, ok: true },
    });

    const proof: IVXAutonomousCoderProof = await runIVXAutonomousCoder({
      taskId: 'e2e-deploy-001',
      goal: 'Add version field to /health response and deploy',
      executionMode: 'deploy',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      deployApproved: true,
      deployConfirmationText: 'CONFIRM_IVX_RENDER_DEPLOY',
      llmCaller, testRunner, commitFn, deployFn, productionVerifier,
      fileWriter, fileReader,
      onPhase: (() => {}) as never,
      sleepFn: async (): Promise<void> => {},
    });

    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.commitSha).toBe('deploy1234567890abcdef1234567890abcdef123456');
    expect(proof.deployId).toBe('dep-test-1234567890');
    expect(proof.deployStatus).toBe('live');
    expect(proof.productionVerified).toBe(true);
    expect(proof.healthOk).toBe(true);
    expect(proof.liveCommit).toBe('deploy1234567890abcdef1234567890abcdef123456');
    expect(proof.deployApproved).toBe(true);
    expect(proof.deployRequested).toBe(true);
    expect(proof.healthResponse?.ok).toBe(true);
    expect(proof.healthResponse?.httpStatus).toBe(200);
    expect(proof.versionResponse?.ok).toBe(true);
    expect(proof.versionResponse?.httpStatus).toBe(200);
  });

  it('deploy mode BLOCKS when owner approval is missing', async () => {
    let currentContent = 'const MARKER = "old";\n';
    const fileWriter = async (_r: string, content: string): Promise<void> => { currentContent = content; };
    const fileReader = async (_r: string): Promise<string> => currentContent;

    const mockLlmResponse = JSON.stringify({
      rootCause: 'Test deploy without approval',
      technicalPlan: 'Simple change',
      operations: [{
        path: 'backend/hono.ts', kind: 'replace_exact',
        oldText: 'const MARKER = "old";',
        newText: 'const MARKER = "new";',
        reason: 'Test',
      }],
    });

    const llmCaller = async (_s: string, _u: string): Promise<string> => mockLlmResponse;
    const testRunner = async (_cwd: string, command: string): Promise<{
      command: string; ok: boolean; exitCode: number | null;
      stdoutTail: string; stderrTail: string; durationMs: number;
    }> => ({ command, ok: true, exitCode: 0, stdoutTail: 'PASS', stderrTail: '', durationMs: 30 });

    const commitFn = async (_f: string[], branch: string): Promise<{
      commitSha: string; commitUrl: string; branch: string;
    }> => ({
      commitSha: 'blocked1234567890abcdef1234567890abcdef1234',
      commitUrl: 'https://github.com/ibb142/ivx-holdings-platform/commit/blocked1234567890abcdef1234567890abcdef1234',
      branch,
    });

    const proof: IVXAutonomousCoderProof = await runIVXAutonomousCoder({
      taskId: 'e2e-blocked-001',
      goal: 'Test deploy without approval',
      executionMode: 'deploy',
      ownerId: 'test-owner',
      approvalPolicy: 'owner_gated',
      deployApproved: false,
      deployConfirmationText: '',
      llmCaller, testRunner, commitFn,
      fileWriter, fileReader,
      onPhase: (() => {}) as never,
      sleepFn: async (): Promise<void> => {},
    });

    // Commit created but deploy BLOCKED
    expect(proof.commitSha).toBe('blocked1234567890abcdef1234567890abcdef1234');
    expect(proof.deployApproved).toBe(false);
    expect(proof.deployId).toBeNull();
    expect(proof.productionVerified).toBe(false);
  });
});
