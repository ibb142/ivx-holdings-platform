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
import { IVX_SCHEDULER_MARKER, SCHEDULED_JOB_KINDS, freshJobState, freshSchedulerState, isJobDue, computeNextDue, selectDueJobs, runScheduledJob, getSchedulerState, setSchedulerEnabled, } from './ivx-autonomous-scheduler';
const NOW = Date.parse('2026-06-02T12:00:00.000Z');
function fakeAudit(overrides = {}) {
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
function fakeDrift() {
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
        const future = { ...freshJobState('daily_drift_detection', NOW), nextDueAt: new Date(NOW + 60_000).toISOString() };
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
    test('runs a self-audit job, persists + advances the cursor, wires memory/action-loop without throwing', async () => {
        const result = await runScheduledJob('daily_self_audit', {
            selfAudit: {
                runDailySelfAudit: async () => fakeAudit(),
                planSafeAutoImprovements: async () => ({ safeProposals: [{}] }),
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
