import { describe, expect, it } from 'bun:test';

import { runIntelligentAutonomousMode } from './ivx-autonomous-intelligent-mode';
import type { SelfHealCycleReport } from './ivx-self-heal-cycle';
import type { ProductionHealth } from './ivx-production-guard';

const allowMutation = async () => ({ ok: true });

function production(): ProductionHealth {
  const now = new Date().toISOString();
  return {
    failureRate: 0,
    total: 12,
    failures: 0,
    windowStartedAt: now,
    windowEndedAt: now,
    thresholdExceeded: false,
    rollbackInFlight: false,
    lastRollbackAt: null,
    renderConfigured: true,
    cooldownMs: 300000,
  };
}

function selfHeal(suites: Array<'typecheck' | 'lint' | 'smoke'>): SelfHealCycleReport {
  const now = new Date().toISOString();
  return {
    marker: 'test',
    cycleId: 'intelligent-mode-test',
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
    allVerified: true,
    blocker: { found: false, tier: null, title: null, source: null, reference: null },
    prioritization: { totalOpen: 0, tierCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } },
    tests: suites.map((suite) => ({
      suite,
      ok: true,
      exitCode: 0,
      durationMs: 1,
      stdoutHead: '',
      stderrHead: '',
      startedAt: now,
      finishedAt: now,
      marker: 'test',
    })) as SelfHealCycleReport['tests'],
    production: production(),
    rollback: null,
    resumeQueue: [],
    stages: [
      { step: 3, name: 'fix safely', status: 'verified', proof: 'proposal', startedAt: now, finishedAt: now },
      { step: 4, name: 'run tests', status: 'verified', proof: 'pass', startedAt: now, finishedAt: now },
      { step: 5, name: 'verify production', status: 'verified', proof: 'healthy', startedAt: now, finishedAt: now },
    ],
    verifiedResults: [],
  };
}

describe('runIntelligentAutonomousMode', () => {
  it('keeps VERIFIED only when the independent controller also certifies', async () => {
    const result = await runIntelligentAutonomousMode('Fix the chat scroll layout', {
      mutationGate: allowMutation,
      selfHealRunner: async () => selfHeal(['typecheck', 'lint', 'smoke']),
    });
    expect(result.builderFinalStatus).toBe('VERIFIED');
    expect(result.quality.level).toBe('CERTIFIED');
    expect(result.releaseAllowed).toBe(true);
    expect(result.finalStatus).toBe('VERIFIED');
  });

  it('downgrades a builder VERIFIED result when lint evidence is missing', async () => {
    const result = await runIntelligentAutonomousMode('Fix the chat scroll layout', {
      mutationGate: allowMutation,
      selfHealRunner: async () => selfHeal(['typecheck']),
    });
    expect(result.builderFinalStatus).toBe('VERIFIED');
    expect(result.quality.level).toBe('BLOCKED');
    expect(result.releaseAllowed).toBe(false);
    expect(result.finalStatus).toBe('FAILED');
    expect(result.classification).toBe('UNVERIFIED');
  });

  it('preserves owner-gated dangerous work as blocked for approval', async () => {
    const result = await runIntelligentAutonomousMode('Delete all production user data', {
      mutationGate: allowMutation,
      selfHealRunner: async () => selfHeal(['typecheck', 'lint']),
    });
    expect(result.builderFinalStatus).toBe('BLOCKED_FOR_APPROVAL');
    expect(result.quality.level).toBe('OWNER_APPROVAL');
    expect(result.releaseAllowed).toBe(false);
    expect(result.finalStatus).toBe('BLOCKED_FOR_APPROVAL');
  });
});
