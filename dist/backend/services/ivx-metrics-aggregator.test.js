import { describe, expect, it, beforeEach } from 'bun:test';
import { recordMetricSample, clearMetricsForTest, readMetricSamples } from './ivx-metrics-store';
import { buildMetricsSnapshot } from './ivx-metrics-aggregator';
describe('ivx-metrics-store + aggregator', () => {
    beforeEach(() => {
        clearMetricsForTest();
    });
    it('records latency + outcome samples into the ring', async () => {
        recordMetricSample({ kind: 'api_request', latencyMs: 120, success: true, statusCode: 200 });
        recordMetricSample({ kind: 'openai_request', latencyMs: 900, success: true });
        const samples = await readMetricSamples();
        expect(samples.length).toBe(2);
        expect(samples[0].kind).toBe('api_request');
        expect(samples[0].latencyMs).toBe(120);
    });
    it('clamps negative/invalid latency to null and rounds floats', async () => {
        recordMetricSample({ kind: 'supabase_query', latencyMs: -5, success: false });
        recordMetricSample({ kind: 'supabase_query', latencyMs: 12.7, success: true });
        const samples = await readMetricSamples();
        expect(samples[0].latencyMs).toBeNull();
        expect(samples[1].latencyMs).toBe(13);
    });
    it('computes latency stats (avg/p50/p95/max/min) per metric', async () => {
        for (const ms of [100, 200, 300, 400, 500]) {
            recordMetricSample({ kind: 'api_request', latencyMs: ms, success: true, statusCode: 200 });
        }
        const snap = await buildMetricsSnapshot();
        expect(snap.apiLatency.lifetime.count).toBe(5);
        expect(snap.apiLatency.lifetime.avgMs).toBe(300);
        expect(snap.apiLatency.lifetime.minMs).toBe(100);
        expect(snap.apiLatency.lifetime.maxMs).toBe(500);
        expect(snap.apiLatency.lifetime.p50Ms).toBe(300);
    });
    it('computes owner-route + deliverable success rates honestly', async () => {
        recordMetricSample({ kind: 'owner_route', success: true, statusCode: 200 });
        recordMetricSample({ kind: 'owner_route', success: true, statusCode: 200 });
        recordMetricSample({ kind: 'owner_route', success: false, statusCode: 401 });
        recordMetricSample({ kind: 'deliverable', success: true });
        const snap = await buildMetricsSnapshot();
        expect(snap.ownerRouteSuccessRate.lifetime.total).toBe(3);
        expect(snap.ownerRouteSuccessRate.lifetime.success).toBe(2);
        expect(snap.ownerRouteSuccessRate.lifetime.successRate).toBeCloseTo(66.7, 1);
        expect(snap.deliverableSuccessRate.lifetime.successRate).toBe(100);
    });
    it('returns null stats (never invented zeros) when a window has no samples', async () => {
        const snap = await buildMetricsSnapshot();
        expect(snap.apiLatency.lifetime.count).toBe(0);
        expect(snap.apiLatency.lifetime.avgMs).toBeNull();
        expect(snap.ownerRouteSuccessRate.lifetime.successRate).toBeNull();
        expect(snap.crashCounter.lifetime.count).toBeGreaterThanOrEqual(0);
    });
    it('separates the 24h window from lifetime', async () => {
        recordMetricSample({ kind: 'openai_request', latencyMs: 800, success: true });
        const snap = await buildMetricsSnapshot();
        // The just-recorded sample is within both windows.
        expect(snap.openaiRequestLatency.last24h.count).toBe(1);
        expect(snap.openaiRequestLatency.lifetime.count).toBe(1);
        expect(snap.totalSamples).toBe(1);
    });
});
