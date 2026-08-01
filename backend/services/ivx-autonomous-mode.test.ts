import { describe, expect, it } from 'bun:test';

import { checkToolAvailability, isToolAvailable, IVX_TOOL_AVAILABILITY_MARKER } from './ivx-tool-availability';
import { runAutonomousMode, IVX_AUTONOMOUS_MODE_MARKER } from './ivx-autonomous-mode';
import type { SelfHealCycleReport } from './ivx-self-heal-cycle';
import type { ProductionHealth } from './ivx-production-guard';

// ---------------------------------------------------------------------------
// Tool Availability Checker
// ---------------------------------------------------------------------------

describe('checkToolAvailability', () => {
  it('marks in-process tools available even with an empty env', () => {
    const report = checkToolAvailability({});
    expect(report.marker).toBe(IVX_TOOL_AVAILABILITY_MARKER);
    const testRunner = report.tools.find((t) => t.tool === 'test_runner');
    const trace = report.tools.find((t) => t.tool === 'execution_trace');
    const selfHeal = report.tools.find((t) => t.tool === 'self_heal');
    expect(testRunner?.available).toBe(true);
    expect(trace?.available).toBe(true);
    expect(selfHeal?.available).toBe(true);
  });

  it('reports env-backed tools as unavailable with the exact missing env (no secret value)', () => {
    const report = checkToolAvailability({});
    const github = report.tools.find((t) => t.tool === 'github_write');
    expect(github?.available).toBe(false);
    expect(github?.missingEnv).toEqual(['GITHUB_TOKEN', 'GITHUB_REPO_URL']);
    const supabase = report.tools.find((t) => t.tool === 'supabase_actions');
    expect(supabase?.missingEnv).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('flips a tool to available once its env is present', () => {
    const env = {
      GITHUB_TOKEN: 'gh_xxx',
      GITHUB_REPO_URL: 'https://github.com/x/y.git',
      IVX_AI_GATEWAY_KEY: 'k',
    };
    expect(isToolAvailable('github_write', env)).toBe(true);
    const report = checkToolAvailability(env);
    expect(report.tools.find((t) => t.tool === 'ai_gateway')?.available).toBe(true);
  });

  it('canExecuteEndToEnd requires the core tools plus a deploy path', () => {
    const noDeploy = checkToolAvailability({ IVX_AI_GATEWAY_KEY: 'k' });
    expect(noDeploy.canExecuteEndToEnd).toBe(false);
    const full = checkToolAvailability({
      IVX_AI_GATEWAY_KEY: 'k',
      RENDER_API_KEY: 'r',
      RENDER_SERVICE_ID: 's',
    });
    expect(full.canExecuteEndToEnd).toBe(true);
  });

  it('blockedSteps reflects steps depending on a missing tool', () => {
    const report = checkToolAvailability({});
    expect(report.blockedSteps.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Autonomous Mode orchestrator
// ---------------------------------------------------------------------------

function fakeProduction(thresholdExceeded = false): ProductionHealth {
  return {
    failureRate: thresholdExceeded ? 0.9 : 0.0,
    total: 12,
    failures: thresholdExceeded ? 11 : 0,
    windowStartedAt: new Date().toISOString(),
    windowEndedAt: new Date().toISOString(),
    thresholdExceeded,
    rollbackInFlight: false,
    lastRollbackAt: null,
    renderConfigured: true,
    cooldownMs: 300000,
  };
}

function fakeSelfHeal(allVerified: boolean): SelfHealCycleReport {
  const now = new Date().toISOString();
  const stStatus = allVerified ? 'verified' : 'failed';
  return {
    marker: 'fake',
    cycleId: 'selfheal-test-1',
    startedAt: now,
    finishedAt: now,
    durationMs: 5,
    allVerified,
    blocker: { found: false, tier: null, title: null, source: null, reference: null },
    prioritization: { totalOpen: 0, tierCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } },
    tests: [{ suite: 'typecheck', ok: allVerified, exitCode: allVerified ? 0 : 1, durationMs: 1, error: null } as unknown as SelfHealCycleReport['tests'][number]],
    production: fakeProduction(!allVerified),
    rollback: null,
    resumeQueue: [],
    stages: [
      { step: 3, name: 'fix safely', status: 'verified', proof: 'proposal-only', startedAt: now, finishedAt: now },
      { step: 4, name: 'run tests (typecheck)', status: stStatus, proof: `exit=${allVerified ? 0 : 1}`, startedAt: now, finishedAt: now },
      { step: 5, name: 'verify production', status: 'verified', proof: 'healthy', startedAt: now, finishedAt: now },
    ],
    verifiedResults: [],
  };
}

describe('runAutonomousMode', () => {
  it('runs the full 12-step lifecycle and VERIFIES a clean non-destructive task', async () => {
    const report = await runAutonomousMode('Fix the chat scroll layout now', {
      selfHealRunner: async () => fakeSelfHeal(true),
    });
    expect(report.marker).toBe(IVX_AUTONOMOUS_MODE_MARKER);
    expect(report.steps).toHaveLength(12);
    expect(report.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(report.humanApprovalRequired).toBe(false);
    expect(report.finalStatus).toBe('VERIFIED');
    expect(report.classification).toBe('VERIFIED');
    expect(report.taskId).toContain('autotask_');
    expect(report.requestId).toContain('autoreq_');
  });

  it('reports FAILED (UNVERIFIED) when the self-heal cycle has a failed stage', async () => {
    const report = await runAutonomousMode('Deploy the new endpoint now', {
      selfHealRunner: async () => fakeSelfHeal(false),
    });
    expect(report.finalStatus).toBe('FAILED');
    expect(report.classification).toBe('UNVERIFIED');
    const tests = report.steps.find((s) => s.step === 6);
    expect(tests?.status).toBe('failed');
  });

  it('HOLDS a destructive command for human approval and never executes', async () => {
    let ran = false;
    const report = await runAutonomousMode('Delete all user data from the production database', {
      selfHealRunner: async () => {
        ran = true;
        return fakeSelfHeal(true);
      },
    });
    expect(ran).toBe(false);
    expect(report.humanApprovalRequired).toBe(true);
    expect(report.finalStatus).toBe('BLOCKED_FOR_APPROVAL');
    expect(report.classification).toBe('NOT EXECUTED');
    expect(report.intent.approvalCategories).toContain('delete_data');
    // Steps 5–11 are blocked, step 12 still returns proof.
    expect(report.steps.filter((s) => s.status === 'blocked').length).toBe(7);
    expect(report.steps.find((s) => s.step === 12)?.status).toBe('verified');
  });

  it('copies the task exactly and builds a multi-block plan', async () => {
    const task = 'Build:\n1. First thing\n2. Second thing\n3. Third thing';
    const report = await runAutonomousMode(task, {
      selfHealRunner: async () => fakeSelfHeal(true),
    });
    expect(report.task).toBe(task);
    expect(report.plan.blockCount).toBeGreaterThanOrEqual(3);
  });

  it('surfaces a failed step when the self-heal runner throws (never crashes)', async () => {
    const report = await runAutonomousMode('Fix it now', {
      selfHealRunner: async () => {
        throw new Error('runner exploded');
      },
    });
    expect(report.finalStatus).toBe('FAILED');
    expect(report.steps.find((s) => s.step === 5)?.status).toBe('failed');
    expect(report.steps.find((s) => s.step === 5)?.proof).toContain('runner exploded');
  });
});
