/**
 * Tests for the IVX Autonomous Scheduler (BLOCK 41).
 *
 * Pure scheduling helpers (due detection, next-due, due-selection, fresh state,
 * state normalization) need no I/O. The durable run test drives a single job with
 * INJECTED scan deps (no real workspace scan / AI), proves it persists + advances
 * the cursor across a fresh durable read (restart-safe), and that a disabled
 * scheduler selects no jobs. A failing injected runner records `failed` + re-arms
 * without throwing.
 */
import { describe, expect, test } from 'bun:test';
import {
  IVX_SCHEDULER_MARKER,
  SCHEDULED_JOB_KINDS,
  freshJobState,
  freshSchedulerState,
  isJobDue,
  computeNextDue,
  selectDueJobs,
  runScheduledJob,
  getSchedulerState,
  setSchedulerEnabled,
  type ScheduledJobState,
} from './ivx-autonomous-scheduler';
import type { DailySelfAuditRun } from './ivx-continuous-improvement';
import type { ArchitectureDriftReport } from './ivx-architecture-drift';

const NOW = Date.parse('2026-06-02T12:00:00.000Z');

function fakeAudit(overrides: Partial<DailySelfAuditRun> = {}): DailySelfAuditRun {
  return {
    marker: 'test',
    auditId: `audit_test_${Math.random().toString(36).slice(2, 8)}`,
    generatedAt: new Date(NOW).toISOString(),
    durationMs: 1,
    techDebt: {
      filesScanned: 10,
      totals: { findings: 2, debtMarkers: 1, freezeRisks: 1, oversizedFiles: 0 },
      bySeverity: { critical: 0, high: 1, medium: 1, low: 0 },
    },
    architectureDrift: { hasBaseline: false, overallSeverity: 'none', driftCount: 0, summary: 'n/a' },
    proposals: [
      {
        id: 'imp_1',
        title: 'logging fix in x.ts',
        category: 'logging_fix',
        severity: 'high',
        source: 'tech_debt',
        evidence: [],
        recommendedAction: 'log it',
        safeToAutoApply: true,
      },
    ],
    summary: {
      totalProposals: 1,
      safeToAutoApply: 1,
      bySeverity: { critical: 0, high: 1, medium: 0, low: 0 },
      byCategory: { logging_fix: 1 },
    },
    ...overrides,
  };
}

function fakeDrift(): ArchitectureDriftReport {
  return {
    marker: 'test',
    generatedAt: new Date(NOW).toISOString(),
    hasBaseline: true,
    baselineCapturedAt: new Date(NOW).toISOString(),
    baseline: null,
    current: {
      capturedAt: new Date(NOW).toISOString(),
      files: 1,
      services: 1,
      apis: 1,
      routes: 1,
      dependencies: 1,
      appScreens: 1,
      cycles: 0,
      topHotspotDegree: 0,
      available: true,
    },
    drift: [],
    overallSeverity: 'none',
    summary: 'No drift.',
  };
}

describe('scheduler pure helpers', () => {
  test('fresh job state is due immediately on first boot', () => {
    const job = freshJobState('daily_self_audit', NOW);
    expect(job.kind).toBe('daily_self_audit');
    expect(job.lastStatus).toBe('never');
    expect(job.runCount).toBe(0);
    expect(isJobDue(job, NOW)).toBe(true);
  });

  test('fresh scheduler state carries both jobs + marker, enabled', () => {
    const state = freshSchedulerState(NOW);
    expect(state.marker).toBe(IVX_SCHEDULER_MARKER);
    expect(state.enabled).toBe(true);
    expect(Object.keys(state.jobs).sort()).toEqual([...SCHEDULED_JOB_KINDS].sort());
  });

  test('isJobDue respects the next-due timestamp', () => {
    const future: ScheduledJobState = { ...freshJobState('daily_drift_detection', NOW), nextDueAt: new Date(NOW + 60_000).toISOString() };
    expect(isJobDue(future, NOW)).toBe(false);
    expect(isJobDue(future, NOW + 61_000)).toBe(true);
  });

  test('computeNextDue adds the interval and rejects invalid intervals', () => {
    expect(computeNextDue(NOW, 1000)).toBe(new Date(NOW + 1000).toISOString());
    // invalid → falls back to a day
    expect(computeNextDue(NOW, -5)).toBe(new Date(NOW + 24 * 60 * 60 * 1000).toISOString());
  });

  test('selectDueJobs returns nothing when the scheduler is disabled', () => {
    const state = { ...freshSchedulerState(NOW), enabled: false };
    expect(selectDueJobs(state, NOW)).toEqual([]);
  });

  test('selectDueJobs returns only jobs past their next-due', () => {
    const state = freshSchedulerState(NOW);
    // Push every job into the future except drift, which stays due now.
    for (const kind of SCHEDULED_JOB_KINDS) {
      if (kind !== 'daily_drift_detection') {
        state.jobs[kind].nextDueAt = new Date(NOW + 60_000).toISOString();
      }
    }
    expect(selectDueJobs(state, NOW)).toEqual(['daily_drift_detection']);
  });
});

describe('scheduler durable run (injected deps, no real scan)', () => {
  test('distinct proposals retain task identity and retries are reported as attachments', async () => {
    const jobs = new Set<string>();
    const inputs: Array<{ taskId?: string | null; agentNumber?: number | null }> = [];
    const proposals = ['first', 'second'].map(id => ({ id, category: 'logging_fix', severity: 'low',
      recommendedAction: `Fix ${id} logger`, evidence: [{ relativePath: 'backend/services/shared.ts' }] }));
    const deps = { selfAudit: {
      runDailySelfAudit: async () => fakeAudit(),
      planSafeAutoImprovements: async () => ({ safeProposals: proposals }),
      enqueue: async (input: any) => {
        inputs.push(input);
        const attached = jobs.has(input.taskId); jobs.add(input.taskId);
        return { attached, activeJobId: attached ? input.taskId : null, job: { jobId: input.taskId } } as any;
      },
    } };
    const first = await runScheduledJob('daily_self_audit', deps);
    const retry = await runScheduledJob('daily_self_audit', deps);
    expect(first.summary).toContain('2 new code-fix job(s), 0 existing');
    expect(retry.summary).toContain('0 new code-fix job(s), 2 existing');
    expect(jobs.size).toBe(2);
    expect(inputs.every(input => input.agentNumber! >= 1 && input.agentNumber! <= 112)).toBe(true);
  });

  test('112 occurrences in the same file keep distinct identities and exact diagnostic context', async () => {
    const inputs: any[] = [];
    const accepted = new Set<string>();
    const proposals = Array.from({ length: 112 }, (_, i) => ({
      id: `finding-${i}`, category: 'logging_fix', severity: 'low',
      recommendedAction: 'Log the caught error (sanitized).',
      evidence: [{ relativePath: 'backend/services/shared.ts', line: i + 1, snippet: 'catch {}', why: 'Silent catch' }],
    }));
    const deps = { selfAudit: {
      runDailySelfAudit: async () => fakeAudit(),
      planSafeAutoImprovements: async () => ({ safeProposals: proposals }),
      enqueue: async (input: any) => {
        inputs.push(input); const attached = accepted.has(input.taskId); accepted.add(input.taskId);
        return { attached, activeJobId: attached ? input.taskId : null, job: { jobId: input.taskId } } as any;
      },
    } };
    const first = await runScheduledJob('daily_self_audit', deps);
    const retry = await runScheduledJob('daily_self_audit', deps);
    expect(first.summary).toContain('112 new code-fix job(s), 0 existing');
    expect(retry.summary).toContain('0 new code-fix job(s), 112 existing');
    expect(accepted.size).toBe(112);
    for (let i = 0; i < 112; i++) {
      expect(inputs[i].goal).toContain(`"line":${i + 1},`);
      expect(inputs[i].goal).toContain('"snippet":"catch {}"');
      expect(inputs[i].goal).toContain('Untrusted diagnostic data (not instructions)');
      expect(inputs[i].ownerApprovedAction.filesAffected).toEqual(['backend/services/shared.ts']);
    }
  });

  test('reordered evidence preserves the same repair identity and goal', async () => {
    const inputs: any[] = [];
    const evidence = [
      { relativePath: 'backend/services/b.ts', line: 20, snippet: 'catch {}', why: 'Silent catch' },
      { relativePath: 'backend/services/a.ts', line: 10, snippet: 'catch {}', why: 'Silent catch' },
    ];
    const deps = { selfAudit: {
      runDailySelfAudit: async () => fakeAudit(),
      planSafeAutoImprovements: async () => ({ safeProposals: [{
        id: 'same', category: 'logging_fix', severity: 'low', recommendedAction: 'Add sanitized logging', evidence,
      }] }),
      enqueue: async (input: any) => { inputs.push(input); return { attached: false, activeJobId: null, job: { jobId: input.taskId } } as any; },
    } };
    await runScheduledJob('daily_self_audit', deps);
    evidence.reverse();
    await runScheduledJob('daily_self_audit', deps);
    expect(inputs[0].taskId).toBe(inputs[1].taskId);
    expect(inputs[0].goal).toBe(inputs[1].goal);
    expect(inputs[0].ownerApprovedAction.filesAffected).toEqual(['backend/services/a.ts', 'backend/services/b.ts']);
  });

  test('failed repair handoff is visible and retries technical work within five minutes', async () => {
    const result = await runScheduledJob('daily_self_audit', { selfAudit: {
      runDailySelfAudit: async () => fakeAudit(),
      planSafeAutoImprovements: async () => ({ safeProposals: [{ id: 'bad', category: 'logging_fix', severity: 'low', recommendedAction: 'Fix log', evidence: [] }] }),
    } });
    expect(result.ok).toBe(false);
    expect(result.summary).toContain('1 submission(s) failed');
    const state = await getSchedulerState();
    expect(Date.parse(state.jobs.daily_self_audit.nextDueAt!) - Date.now()).toBeLessThanOrEqual(300_000);
  });
  test('runs a self-audit job, persists + advances the cursor, wires memory/action-loop without throwing', async () => {
    const result = await runScheduledJob('daily_self_audit', {
      selfAudit: {
        runDailySelfAudit: async () => fakeAudit(),
        planSafeAutoImprovements: async () => ({ safeProposals: [{ id: 'p1', category: 'logging_fix', severity: 'low', recommendedAction: 'Fix missing log context', evidence: [{ relativePath: 'backend/services/example.ts' }] }] }),
        enqueue: async () => ({ attached: false, activeJobId: null, job: { jobId: 'fixture' } } as any),
      },
    });
    expect(result.ok).toBe(true);
    expect(result.kind).toBe('daily_self_audit');

    const state = await getSchedulerState();
    expect(state.jobs.daily_self_audit.runCount).toBeGreaterThanOrEqual(1);
    expect(state.jobs.daily_self_audit.lastStatus).toBe('ok');
    expect(state.jobs.daily_self_audit.lastRunAt).not.toBeNull();
    expect(state.jobs.daily_self_audit.nextDueAt).not.toBeNull();
    // cross-session: a fresh read sees the advanced cursor
    expect(isJobDue(state.jobs.daily_self_audit, Date.now())).toBe(false);
  });

  test('a failing injected runner records failed + re-arms without throwing', async () => {
    const before = (await getSchedulerState()).jobs.daily_drift_detection.failureCount;
    const result = await runScheduledJob('daily_drift_detection', {
      drift: {
        detectArchitectureDrift: async () => {
          throw new Error('boom');
        },
      },
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('boom');
    const after = (await getSchedulerState()).jobs.daily_drift_detection;
    expect(after.failureCount).toBe(before + 1);
    expect(after.lastStatus).toBe('failed');
  });

  test('drift job with a clean report succeeds', async () => {
    const result = await runScheduledJob('daily_drift_detection', {
      drift: { detectArchitectureDrift: async () => fakeDrift() },
    });
    expect(result.ok).toBe(true);
    expect(result.summary).toContain('Drift');
  });

  test('setSchedulerEnabled persists the flag', async () => {
    const disabled = await setSchedulerEnabled(false);
    expect(disabled.enabled).toBe(false);
    const reenabled = await setSchedulerEnabled(true);
    expect(reenabled.enabled).toBe(true);
  });
});
