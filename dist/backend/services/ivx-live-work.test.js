/**
 * Tests for the Live Work layer:
 *   - the staged Supabase check honest failure path when unconfigured
 *   - the agent activity store begin/complete/list lifecycle
 *   - the live-work snapshot defensive aggregation
 *
 * These avoid network/AI so they run anywhere.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { runSupabaseCheck } from './ivx-supabase-check';
import { beginAgentRun, completeAgentRun, failAgentRun, listAgentRuns, withAgentRun } from './ivx-agent-activity-store';
import { buildLiveWorkSnapshot } from './ivx-live-work';
describe('runSupabaseCheck (unconfigured)', () => {
    const prevUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
    const prevKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const prevKey2 = process.env.SUPABASE_SERVICE_KEY;
    beforeEach(() => {
        delete process.env.EXPO_PUBLIC_SUPABASE_URL;
        delete process.env.SUPABASE_SERVICE_ROLE_KEY;
        delete process.env.SUPABASE_SERVICE_KEY;
    });
    afterEach(() => {
        if (prevUrl !== undefined)
            process.env.EXPO_PUBLIC_SUPABASE_URL = prevUrl;
        if (prevKey !== undefined)
            process.env.SUPABASE_SERVICE_ROLE_KEY = prevKey;
        if (prevKey2 !== undefined)
            process.env.SUPABASE_SERVICE_KEY = prevKey2;
    });
    test('returns all six stages with an honest connection failure and never throws', async () => {
        const result = await runSupabaseCheck();
        expect(result.ok).toBe(false);
        const names = result.stages.map((s) => s.name);
        expect(names).toEqual(['connection', 'authentication', 'query', 'response', 'verification', 'completion']);
        expect(result.stages[0].status).toBe('failed');
        expect(result.stages[0].detail).toContain('EXPO_PUBLIC_SUPABASE_URL');
        // downstream data stages are skipped honestly, completion fails
        expect(result.stages[1].status).toBe('skipped');
        expect(result.stages[5].status).toBe('failed');
        // every stage carries timing evidence
        for (const stage of result.stages) {
            expect(typeof stage.startedAt).toBe('string');
            expect(typeof stage.finishedAt).toBe('string');
            expect(stage.durationMs).toBeGreaterThanOrEqual(0);
        }
    });
});
describe('agent activity store', () => {
    test('begin → complete persists a completed run with proof', async () => {
        const id = await beginAgentRun({ kind: 'qa_scan', label: 'QA scan', why: 'unit test' });
        expect(id).toContain('run_');
        await completeAgentRun(id, 'proof-123');
        const runs = await listAgentRuns(50);
        const found = runs.find((r) => r.id === id);
        expect(found).toBeTruthy();
        expect(found?.status).toBe('completed');
        expect(found?.proof).toBe('proof-123');
        expect(found?.durationMs ?? -1).toBeGreaterThanOrEqual(0);
    });
    test('begin → fail records an honest error', async () => {
        const id = await beginAgentRun({ kind: 'learning_cycle', label: 'Learning cycle', why: 'unit test' });
        await failAgentRun(id, 'boom');
        const runs = await listAgentRuns(50);
        const found = runs.find((r) => r.id === id);
        expect(found?.status).toBe('failed');
        expect(found?.error).toBe('boom');
    });
    test('withAgentRun propagates the result and records completion', async () => {
        const value = await withAgentRun({ kind: 'other', label: 'Wrapped', why: 'unit test', proofOf: (n) => `n=${n}` }, async () => 42);
        expect(value).toBe(42);
        const runs = await listAgentRuns(50);
        const completed = runs.find((r) => r.label === 'Wrapped' && r.status === 'completed');
        expect(completed?.proof).toBe('n=42');
    });
    test('withAgentRun rethrows and records a failed run', async () => {
        await expect(withAgentRun({ kind: 'other', label: 'WrappedFail', why: 'unit test' }, async () => {
            throw new Error('nope');
        })).rejects.toThrow('nope');
        const runs = await listAgentRuns(50);
        const failed = runs.find((r) => r.label === 'WrappedFail' && r.status === 'failed');
        expect(failed?.error).toContain('nope');
    });
});
describe('buildLiveWorkSnapshot', () => {
    test('returns a well-formed snapshot with the marker and defensive sections', async () => {
        await beginAgentRun({ kind: 'opportunity_scan', label: 'Opportunity scan', why: 'snapshot test' });
        const snapshot = await buildLiveWorkSnapshot(40);
        expect(snapshot.marker).toBe('ivx-live-work-2026-05-31');
        expect(Array.isArray(snapshot.activeAgents)).toBe(true);
        expect(Array.isArray(snapshot.recentAgents)).toBe(true);
        expect(Array.isArray(snapshot.liveLogs)).toBe(true);
        expect(Array.isArray(snapshot.recentCompletedTasks)).toBe(true);
        expect(typeof snapshot.summary).toBe('string');
        expect(snapshot.counts.activeAgents).toBeGreaterThanOrEqual(1);
    });
});
