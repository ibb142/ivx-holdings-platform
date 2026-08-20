import { describe, expect, it } from 'bun:test';

import { certifyAutonomousQuality } from './ivx-autonomous-quality-controller';
import type { SelfHealCycleReport } from './ivx-self-heal-cycle';
import type { ProductionHealth } from './ivx-production-guard';

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

function report(suites: Array<'typecheck' | 'lint' | 'smoke'>): SelfHealCycleReport {
  const now = new Date().toISOString();
  const tests = suites.map((suite) => ({
    suite,
    ok: true,
    exitCode: 0,
    durationMs: 1,
    startedAt: now,
    finishedAt: now,
    stdoutHead: '',
    stderrHead: '',
    marker: 'test',
  }));
  return {
    marker: 'test',
    cycleId: 'quality-test',
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
    allVerified: true,
    blocker: { found: false, tier: null, title: null, source: null, reference: null },
    prioritization: { totalOpen: 0, tierCounts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } },
    tests,
    production: production(),
    rollback: null,
    resumeQueue: [],
    stages: [
      { step: 4, name: 'run tests', status: 'verified', proof: 'pass', startedAt: now, finishedAt: now },
      { step: 5, name: 'verify production', status: 'verified', proof: 'healthy', startedAt: now, finishedAt: now },
    ],
    verifiedResults: [],
  } as SelfHealCycleReport;
}

const lowRisk = { requiresApproval: false, approvalCategories: [] };

describe('certifyAutonomousQuality', () => {
  it('CERTIFIES only when required independent evidence exists', () => {
    const decision = certifyAutonomousQuality({
      ownerStopVerifiedInactive: true,
      decision: lowRisk,
      selfHeal: report(['typecheck', 'lint', 'smoke']),
    });
    expect(decision.level).toBe('CERTIFIED');
    expect(decision.releaseAllowed).toBe(true);
    expect(decision.score).toBe(100);
  });

  it('fails closed when lint evidence is missing', () => {
    const decision = certifyAutonomousQuality({
      ownerStopVerifiedInactive: true,
      decision: lowRisk,
      selfHeal: report(['typecheck']),
    });
    expect(decision.level).toBe('BLOCKED');
    expect(decision.releaseAllowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('lint');
  });

  it('fails closed when owner stop state is unverified', () => {
    const decision = certifyAutonomousQuality({
      ownerStopVerifiedInactive: false,
      decision: lowRisk,
      selfHeal: report(['typecheck', 'lint']),
    });
    expect(decision.level).toBe('BLOCKED');
    expect(decision.releaseAllowed).toBe(false);
    expect(decision.reasons.join(' ')).toContain('owner_control');
  });

  it('requires owner approval for guarded operations', () => {
    const decision = certifyAutonomousQuality({
      ownerStopVerifiedInactive: true,
      decision: { requiresApproval: true, approvalCategories: ['modify_auth_permissions'] },
      selfHeal: report(['typecheck', 'lint']),
    });
    expect(decision.level).toBe('OWNER_APPROVAL');
    expect(decision.ownerApprovalRequired).toBe(true);
    expect(decision.releaseAllowed).toBe(false);
  });

  it('fails closed when production health is missing', () => {
    const broken = report(['typecheck', 'lint']);
    broken.production = null;
    const decision = certifyAutonomousQuality({
      ownerStopVerifiedInactive: true,
      decision: lowRisk,
      selfHeal: broken,
    });
    expect(decision.level).toBe('BLOCKED');
    expect(decision.reasons.join(' ')).toContain('production_health');
  });
});
