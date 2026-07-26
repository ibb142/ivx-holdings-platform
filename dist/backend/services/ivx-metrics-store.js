/**
 * IVX runtime metrics sample store (owner-only).
 *
 * Durable, append-only record of latency + outcome samples for the operational
 * metrics surfaced on the in-app Diagnostics screen:
 *   - api_request     overall owner-AI HTTP round-trip latency + 2xx outcome
 *   - openai_request  AI provider (OpenAI/gpt-4o-mini) call latency + success
 *   - supabase_query  live Supabase REST query latency + success
 *   - owner_route     owner-gated route outcome (success = HTTP 2xx)
 *   - deliverable     artifact-pipeline generation outcome (complete vs failed)
 *
 * Storage strategy mirrors the proven incident store: an in-memory ring (fast
 * windowed reads for the aggregator) backed by an append-only JSONL file so
 * "lifetime" survives a single backend process restart (best-effort; a failed
 * persist never breaks the recorded action). Crash counts are derived directly
 * from the durable incident store, so they are NOT recorded here.
 *
 * No PII, no tokens, no message bodies — only timing + boolean outcome + a
 * short, sanitized detail string.
 */
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
export const IVX_METRICS_STORE_MARKER = 'ivx-metrics-store-2026-06-01';
const DIR = path.join(process.cwd(), 'logs', 'audit', 'metrics');
const LOG_PATH = path.join(DIR, 'samples.jsonl');
const MAX_SAMPLES = 8000;
const RING = [];
let restoreAttempted = false;
let restorePromise = null;
function nowIso() {
    return new Date().toISOString();
}
function capDetail(value) {
    if (typeof value !== 'string')
        return null;
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    return trimmed.length <= 160 ? trimmed : `${trimmed.slice(0, 160)}…`;
}
function pushRing(sample) {
    RING.push(sample);
    while (RING.length > MAX_SAMPLES) {
        RING.shift();
    }
}
async function persistLine(sample) {
    try {
        await mkdir(DIR, { recursive: true });
        await appendFile(LOG_PATH, `${JSON.stringify(sample)}\n`, 'utf8');
    }
    catch {
        // Best-effort persistence — never break the recorded action.
    }
}
async function restoreFromDisk() {
    if (restoreAttempted)
        return;
    restoreAttempted = true;
    try {
        const raw = await readFile(LOG_PATH, 'utf8');
        const lines = raw.split('\n').filter((l) => l.trim().length > 0).slice(-MAX_SAMPLES);
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                if (parsed && typeof parsed.kind === 'string' && typeof parsed.at === 'string') {
                    RING.push(parsed);
                }
            }
            catch {
                // skip corrupt line
            }
        }
    }
    catch {
        // no file yet
    }
}
/** Ensure the durable samples are loaded into the ring (call before reads). */
export async function ensureMetricsStoreReady() {
    if (!restorePromise) {
        restorePromise = restoreFromDisk();
    }
    await restorePromise;
}
/**
 * Record a single metric sample. Synchronous into memory, async to disk.
 * Never throws — a failed persist is swallowed so instrumenting a call site
 * can never break the operation being measured.
 */
export function recordMetricSample(input) {
    if (!input || typeof input.kind !== 'string')
        return;
    const latency = typeof input.latencyMs === 'number' && Number.isFinite(input.latencyMs) && input.latencyMs >= 0
        ? Math.round(input.latencyMs)
        : null;
    const sample = {
        at: nowIso(),
        kind: input.kind,
        latencyMs: latency,
        success: Boolean(input.success),
        statusCode: typeof input.statusCode === 'number' && Number.isFinite(input.statusCode) ? input.statusCode : null,
        detail: capDetail(input.detail),
    };
    pushRing(sample);
    void persistLine(sample);
}
/** Read all samples currently in the ring (restored from disk). Newest last. */
export async function readMetricSamples() {
    await ensureMetricsStoreReady();
    return RING.slice();
}
export function clearMetricsForTest() {
    RING.length = 0;
    // Mark restore as already-done so test reads use ONLY the cleared in-memory
    // ring and never re-hydrate the durable on-disk lifetime samples.
    restoreAttempted = true;
    restorePromise = Promise.resolve();
}
