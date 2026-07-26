/**
 * IVX provider telemetry — captures per-call AI gateway metrics so the owner AI
 * runtime is observable without depending on external dashboards.
 *
 * Recorded per call:
 *  - traceId / module / model / endpoint
 *  - prompt char length, estimated prompt tokens
 *  - completion tokens (when usage is returned)
 *  - gateway latency (ms)
 *  - retry count (across baseURL candidates)
 *  - status: 'ok' | 'timeout' | 'failed'
 *  - failureReason (sanitized; never bearers)
 *
 * Storage: in-memory ring (500) + JSONL persistence under logs/audit/.
 */
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const TELEMETRY_RING_SIZE = 500;
const TELEMETRY_LOG_PATH = path.join(process.cwd(), 'logs', 'audit', 'ivx-provider-telemetry.jsonl');
const ring = [];
function sanitizeReason(value) {
    return value
        .replace(/\bBearer\s+[A-Za-z0-9._~+/-]{16,}/gi, 'Bearer [redacted]')
        .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, '[redacted-jwt]')
        .slice(0, 600);
}
function nowIso() {
    return new Date().toISOString();
}
function createId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `tel-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
export function estimatePromptTokens(promptChars) {
    // ~4 chars per token is the well-known OpenAI heuristic.
    return Math.ceil(promptChars / 4);
}
export function recordProviderTelemetry(input) {
    const record = {
        id: createId(),
        createdAt: nowIso(),
        ...input,
        failureReason: input.failureReason ? sanitizeReason(input.failureReason) : null,
    };
    ring.push(record);
    if (ring.length > TELEMETRY_RING_SIZE) {
        ring.splice(0, ring.length - TELEMETRY_RING_SIZE);
    }
    void persistRecord(record);
    return record;
}
async function persistRecord(record) {
    try {
        await mkdir(path.dirname(TELEMETRY_LOG_PATH), { recursive: true });
        await appendFile(TELEMETRY_LOG_PATH, `${JSON.stringify(record)}\n`, 'utf8');
    }
    catch (error) {
        console.log('[IVXProviderTelemetry] persistence skipped:', error instanceof Error ? error.message : 'unknown');
    }
}
export function listProviderTelemetry(limit = 50) {
    const clamped = Math.min(Math.max(limit, 1), TELEMETRY_RING_SIZE);
    return ring.slice(-clamped).reverse();
}
export function summarizeProviderTelemetry(window = 100) {
    const slice = ring.slice(-window);
    if (slice.length === 0) {
        return {
            totalCalls: 0,
            okCalls: 0,
            timeoutCalls: 0,
            failedCalls: 0,
            averageLatencyMs: 0,
            p95LatencyMs: 0,
            averagePromptTokens: 0,
            averageCompletionTokens: 0,
            averageRetryCount: 0,
            lastFailureReason: null,
        };
    }
    const okCalls = slice.filter((r) => r.status === 'ok').length;
    const timeoutCalls = slice.filter((r) => r.status === 'timeout').length;
    const failedCalls = slice.filter((r) => r.status === 'failed').length;
    const latencies = slice.map((r) => r.latencyMs).sort((a, b) => a - b);
    const p95Index = Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95));
    const completionTokens = slice
        .map((r) => r.completionTokens)
        .filter((value) => typeof value === 'number');
    const lastFailure = [...slice].reverse().find((r) => r.status !== 'ok' && r.failureReason);
    return {
        totalCalls: slice.length,
        okCalls,
        timeoutCalls,
        failedCalls,
        averageLatencyMs: Math.round(slice.reduce((sum, r) => sum + r.latencyMs, 0) / slice.length),
        p95LatencyMs: latencies[p95Index] ?? 0,
        averagePromptTokens: Math.round(slice.reduce((sum, r) => sum + r.promptTokensEstimated, 0) / slice.length),
        averageCompletionTokens: completionTokens.length > 0
            ? Math.round(completionTokens.reduce((sum, value) => sum + value, 0) / completionTokens.length)
            : 0,
        averageRetryCount: Math.round((slice.reduce((sum, r) => sum + r.retryCount, 0) / slice.length) * 100) / 100,
        lastFailureReason: lastFailure?.failureReason ?? null,
    };
}
