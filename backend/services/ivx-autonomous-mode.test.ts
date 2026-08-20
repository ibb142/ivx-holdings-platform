import { describe, expect, it } from 'bun:test';

import { checkToolAvailability, isToolAvailable, IVX_TOOL_AVAILABILITY_MARKER } from './ivx-tool-availability';
import { runAutonomousMode, IVX_AUTONOMOUS_MODE_MARKER } from './ivx-autonomous-mode';
import type { SelfHealCycleReport } from './ivx-self-heal-cycle';
import type { ProductionHealth } from './ivx-production-guard';

const allowMutation = async () => ({ ok: true });

describe('checkToolAvailability', () => {
  it('marks in-process tools available even with an empty env', () => {
    const report = checkToolAvailability({});
    expect(report.marker).toBe(IVX_TOOL_AVAILABILITY_MARKER);
    expect(report.tools.find((t) => t.tool === 'test_runner')?.available).toBe(true);
    expect(report.tools.find((t) => t.tool === 'execution_trace')?.available).toBe(true);
    expect(report.tools.find((t) => t.tool === 'self_heal')?.available).toBe(true);
  });

  it('reports env-backed tools as unavailable with the exact missing env (no secret value)', () => {
    const report = checkToolAvailability({});
    expect(report.tools.find((t) => t.tool === 'github_write')?.available).toBe(false);
    expect(report.tools.find((t) => t.tool === 'github_write')?.missingEnv).toEqual(['GITHUB_TOKEN', 'GITHUB_REPO_URL']);
    expect(report.tools.find((t) => t.tool === 'supabase_actions')?.missingEnv).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('flips a tool to available once its env is present', () => {
    const env = { GITHUB_TOKEN: 'gh_xxx', GITHUB_REPO_URL: 'https://github.com/x/y.git', IVX_AI_GATEWAY_KEY: 'k' };
    expect(isToolAvailable('github_write', env)).toBe(true);
    expect(checkToolAvailability(env).tools.find((t) => t.tool === 'ai_gateway')?.available).toBe(true);
  });

  it('canExecuteEndToEnd requires the core tools plus a deploy path', () => {
    expect(checkToolAvailability({ IVX_AI_GATEWAY_KEY: 'k' }).canExecuteEndToEnd).toBe(false);
    expect(checkToolAvailability({ IVX_AI_GATEWAY_KEY: 'k', RENDER_API_KEY: 'r', RENDER_SERVICE_ID: 's' }).canExecuteEndToEnd).toBe(true);
  });
});

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
  it('runs the full 12-step lifecycle and VERIFIES a clean low-risk task', async () => {
    const report = await runAutonomousMode('Fix the chat scroll layout now', {
      mutationGate: allowMutation,
      selfHealRunner: async () => fakeSelfHeal(true),
    });
    expect(report.marker).toBe(IVX_AUTONOMOUS_MODE_MARKER);
    expect(report.steps).toHaveLength(12);
    expect(report.steps.map((s) => s.step)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(report.humanApprovalRequired).toBe(false);
    expect(report.ownerStopChecked).toBe(true);
    expect(report.ownerStopVerifiedInactive).toBe(true);
    expect(report.finalStatus).toBe('VERIFIED');
    expect(report.classification).toBe('VERIFIED');
  });

  it('reports FAILED (UNVERIFIED) when the self-heal cycle has a failed stage', async () => {
    const report = await runAutonomousMode('Deploy the new endpoint now', {
      mutationGate: allowMutation,
      selfHealRunner: async () => fakeSelfHeal(false),
    });
    expect(report.finalStatus).toBe('FAILED');
    expect(report.classification).toBe('UNVERIFIED');
    expect(report.steps.find((s) => s.step === 6)?.status).toBe('failed');
  });

  it('HOLDS a destructive command at Owner Gate and never executes', async () => {
    let ran = false;
    let stopChecked = false;
    const report = await runAutonomousMode('Delete all user data from the production database', {
      mutationGate: async () => { stopChecked = true; },
      selfHealRunner: async () => {
        ran = true;
        return fakeSelfHeal(true);
      },
    });
    expect(ran).toBe(false);
    expect(stopChecked).toBe(false);
    expect(report.humanApprovalRequired).toBe(true);
    expect(report.finalStatus).toBe('BLOCKED_FOR_APPROVAL');
    expect(report.classification).toBe('NOT EXECUTED');
    expect(report.intent.approvalCategories).toContain('delete_data');
    expect(report.steps.filter((s) => s.status === 'blocked').length).toBe(7);
  });

  it('STOPPED_BY_OWNER prevents self-heal/deploy before any mutation', async () => {
    let ran = false;
    const report = await runAutonomousMode('Fix the chat scroll layout now', {
      mutationGate: async () => {
        throw new Error('EMERGENCY_STOP_ACTIVE: owner stop engaged');
      },
      selfHealRunner: async () => {
        ran = true;
        return fakeSelfHeal(true);
      },
    });
    expect(ran).toBe(false);
    expect(report.finalStatus).toBe('STOPPED_BY_OWNER');
    expect(report.classification).toBe('NOT EXECUTED');
    expect(report.ownerStopChecked).toBe(true);
    expect(report.ownerStopVerifiedInactive).toBe(false);
    expect(report.steps.filter((s) => s.status === 'blocked').length).toBe(7);
    expect(report.approvalReason).toContain('EMERGENCY_STOP_ACTIVE');
  });

  it('also stops mutation when emergency-stop state is unverified', async () => {
    const report = await runAutonomousMode('Fix it now', {
      mutationGate: async () => {
        throw new Error('EMERGENCY_STOP_UNVERIFIED: control plane unavailable');
      },
      selfHealRunner: async () => fakeSelfHeal(true),
    });
    expect(report.finalStatus).toBe('STOPPED_BY_OWNER');
    expect(report.ownerStopVerifiedInactive).toBe(false);
    expect(report.steps.find((s) => s.step === 5)?.proof).toContain('UNVERIFIED');
  });

  it('copies the task exactly and builds a multi-block plan', async () => {
    const task = 'Build:\n1. First thing\n2. Second thing\n3. Third thing';
    const report = await runAutonomousMode(task, {
      mutationGate: allowMutation,
      selfHealRunner: async () => fakeSelfHeal(true),
    });
    expect(report.task).toBe(task);
    expect(report.plan.blockCount).toBeGreaterThanOrEqual(3);
  });

  it('surfaces a failed step when the self-heal runner throws (never crashes)', async () => {
    const report = await runAutonomousMode('Fix it now', {
      mutationGate: allowMutation,
      selfHealRunner: async () => {
        throw new Error('runner exploded');
      },
    });
    expect(report.finalStatus).toBe('FAILED');
    expect(report.steps.find((s) => s.step === 5)?.status).toBe('failed');
    expect(report.steps.find((s) => s.step === 5)?.proof).toContain('runner exploded');
  });
});
