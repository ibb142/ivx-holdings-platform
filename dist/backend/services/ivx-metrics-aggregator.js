/**
 * IVX operational metrics aggregator (owner-only).
 *
 * Reduces the durable metric-sample store + the durable incident store into the
 * six metrics the in-app Diagnostics screen surfaces, each computed over TWO
 * windows — the last 24 hours and lifetime (every retained sample):
 *
 *   1. crashCounter             count of error/critical incidents
 *   2. apiLatency               owner-AI HTTP round-trip latency (avg/p50/p95/max)
 *   3. supabaseQueryLatency     live Supabase REST query latency
 *   4. openaiRequestLatency     AI provider call latency
 *   5. ownerRouteSuccessRate    owner-gated route success % (2xx / total)
 *   6. deliverableSuccessRate   artifact pipeline success % (complete / attempts)
 *
 * Pure derivation over already-recorded real data — no AI, no network. Latency
 * stats are honest: when a window has no samples the values are null (never 0,
 * never invented), and success rates are null until at least one attempt exists.
 */
import { listIncidents } from './ivx-incident-store';
import { readMetricSamples, IVX_METRICS_STORE_MARKER } from './ivx-metrics-store';
export const IVX_METRICS_AGGREGATOR_MARKER = 'ivx-metrics-aggregator-2026-06-01';
const DAY_MS = 24 * 60 * 60 * 1000;
function percentile(sortedAsc, p) {
    if (sortedAsc.length === 0)
        return null;
    if (sortedAsc.length === 1)
        return sortedAsc[0];
    const rank = (p / 100) * (sortedAsc.length - 1);
    const low = Math.floor(rank);
    const high = Math.ceil(rank);
    if (low === high)
        return sortedAsc[low];
    const weight = rank - low;
    return Math.round(sortedAsc[low] * (1 - weight) + sortedAsc[high] * weight);
}
function computeLatency(samples) {
    const values = samples
        .map((s) => s.latencyMs)
        .filter((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0)
        .sort((a, b) => a - b);
    if (values.length === 0) {
        return { count: 0, avgMs: null, p50Ms: null, p95Ms: null, maxMs: null, minMs: null };
    }
    const sum = values.reduce((a, b) => a + b, 0);
    return {
        count: values.length,
        avgMs: Math.round(sum / values.length),
        p50Ms: percentile(values, 50),
        p95Ms: percentile(values, 95),
        maxMs: values[values.length - 1],
        minMs: values[0],
    };
}
function computeSuccess(samples) {
    const total = samples.length;
    const success = samples.filter((s) => s.success).length;
    const failure = total - success;
    return {
        total,
        success,
        failure,
        successRate: total > 0 ? Math.round((success / total) * 1000) / 10 : null,
    };
}
function withinWindow(at, now, windowMs) {
    if (windowMs === null)
        return true;
    const t = Date.parse(at);
    if (!Number.isFinite(t))
        return false;
    return now - t <= windowMs;
}
function ofKind(samples, kind) {
    return samples.filter((s) => s.kind === kind);
}
function latencyWindowed(samples, kind, now) {
    const kindSamples = ofKind(samples, kind);
    return {
        last24h: computeLatency(kindSamples.filter((s) => withinWindow(s.at, now, DAY_MS))),
        lifetime: computeLatency(kindSamples),
    };
}
function successWindowed(samples, kind, now) {
    const kindSamples = ofKind(samples, kind);
    return {
        last24h: computeSuccess(kindSamples.filter((s) => withinWindow(s.at, now, DAY_MS))),
        lifetime: computeSuccess(kindSamples),
    };
}
const CRASH_SEVERITIES = ['error', 'critical'];
/**
 * Build the full metrics snapshot. Crash counts come from the durable incident
 * store (error/critical severities); latency + success metrics come from the
 * durable metric-sample store. Read-only.
 */
export async function buildMetricsSnapshot() {
    const now = Date.now();
    const samples = await readMetricSamples();
    // Crash counter from the incident store (durable, severity error|critical).
    const incidents = listIncidents(500);
    const crashes = incidents.filter((i) => CRASH_SEVERITIES.includes(i.severity));
    const crash24h = crashes.filter((i) => withinWindow(i.createdAt, now, DAY_MS)).length;
    // Lifetime coverage start = oldest retained signal (sample or crash).
    const sampleStart = samples.length > 0 ? samples[0].at : null;
    const crashStart = crashes.length > 0 ? crashes[crashes.length - 1].createdAt : null;
    const coverageStart = [sampleStart, crashStart]
        .filter((v) => Boolean(v))
        .sort()[0] ?? null;
    return {
        marker: IVX_METRICS_AGGREGATOR_MARKER,
        storeMarker: IVX_METRICS_STORE_MARKER,
        generatedAt: new Date(now).toISOString(),
        coverageStart,
        totalSamples: samples.length,
        crashCounter: {
            last24h: { count: crash24h },
            lifetime: { count: crashes.length },
        },
        apiLatency: latencyWindowed(samples, 'api_request', now),
        supabaseQueryLatency: latencyWindowed(samples, 'supabase_query', now),
        openaiRequestLatency: latencyWindowed(samples, 'openai_request', now),
        ownerRouteSuccessRate: successWindowed(samples, 'owner_route', now),
        deliverableSuccessRate: successWindowed(samples, 'deliverable', now),
    };
}
