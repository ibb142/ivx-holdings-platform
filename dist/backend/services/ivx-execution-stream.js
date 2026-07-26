/**
 * IVX Execution Stream — unified in-memory ring buffer of live "what the
 * Senior Developer AI is doing right now" events. Powers the Advanced
 * Execution Mode panel in the chat surface so the owner can see real,
 * file-grounded engineering activity instead of a typing animation.
 *
 * Event categories surface 1:1 with the panel sections:
 *   - file_activity      → files searched/read, line ranges, functions
 *   - tool_call          → senior-dev tool invocations (search/read/test…)
 *   - reasoning          → current task / subtask / phase / confidence
 *   - patch_event        → patch plan / diff / before-after evidence
 *   - test_event         → suite / pass / fail / runtime / log preview
 *   - watchdog_event     → checkpoint progress / failure / retry / rollback
 *   - thinking           → high-level workflow labels (NOT raw CoT)
 *   - repo_activity      → repo-wide read/search/scan ops
 *   - evidence_card      → structured evidence (file + line + function + source)
 *
 * Everything is best-effort and owner-only at the API edge. No secrets,
 * tokens, or prompt content are ever recorded.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
export const IVX_EXECUTION_STREAM_MARKER = 'ivx-execution-stream-2026-05-28';
const MAX_EVENTS = 400;
const STREAM = { events: [], seq: 0 };
const STREAM_LOG = path.resolve(process.cwd(), 'logs', 'audit', 'execution-stream.jsonl');
// Bound the on-disk JSONL so long-running sessions don't grow unbounded.
// At ~512 bytes/event * 50_000 events = ~25 MB hard cap. When the file
// exceeds MAX_LOG_BYTES we rotate it to `.1` (overwriting the previous
// rotation) and start a fresh file. Best-effort — never throws.
const MAX_LOG_BYTES = 25 * 1024 * 1024;
let rotationInFlight = false;
async function rotateStreamLogIfNeeded() {
    if (rotationInFlight)
        return;
    try {
        const stat = await fs.stat(STREAM_LOG).catch(() => null);
        if (!stat || stat.size < MAX_LOG_BYTES)
            return;
        rotationInFlight = true;
        const rotated = `${STREAM_LOG}.1`;
        await fs.rename(STREAM_LOG, rotated).catch(async () => {
            // If rename fails (cross-device, etc.), truncate instead.
            await fs.writeFile(STREAM_LOG, '', 'utf8').catch(() => { });
        });
    }
    catch {
        // never throw from the stream
    }
    finally {
        rotationInFlight = false;
    }
}
function nowIso() {
    return new Date().toISOString();
}
function clampMeta(meta) {
    if (!meta)
        return undefined;
    const out = {};
    let keys = 0;
    for (const [k, v] of Object.entries(meta)) {
        if (keys >= 12)
            break;
        if (v === null) {
            out[k] = null;
            keys++;
            continue;
        }
        if (typeof v === 'string') {
            out[k] = v.length > 240 ? v.slice(0, 240) : v;
            keys++;
            continue;
        }
        if (typeof v === 'number' && Number.isFinite(v)) {
            out[k] = v;
            keys++;
            continue;
        }
        if (typeof v === 'boolean') {
            out[k] = v;
            keys++;
            continue;
        }
    }
    return out;
}
/**
 * Record a single execution event. Synchronous push to the in-memory ring;
 * disk persistence is best-effort and fire-and-forget so the request path
 * is never blocked by the stream.
 */
export function recordExecutionEvent(input) {
    const event = {
        seq: ++STREAM.seq,
        at: input.at ?? nowIso(),
        category: input.category,
        label: input.label.length > 160 ? input.label.slice(0, 160) : input.label,
        fileLine: input.fileLine,
        symbol: input.symbol,
        status: input.status,
        confidence: typeof input.confidence === 'number' ? Math.max(0, Math.min(1, input.confidence)) : undefined,
        progressPct: typeof input.progressPct === 'number' ? Math.max(0, Math.min(100, Math.round(input.progressPct))) : undefined,
        durationMs: typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) ? input.durationMs : undefined,
        meta: clampMeta(input.meta),
    };
    STREAM.events.push(event);
    if (STREAM.events.length > MAX_EVENTS)
        STREAM.events.splice(0, STREAM.events.length - MAX_EVENTS);
    // best-effort persistence with bounded rotation
    void (async () => {
        try {
            await fs.mkdir(path.dirname(STREAM_LOG), { recursive: true });
            await fs.appendFile(STREAM_LOG, `${JSON.stringify(event)}\n`, 'utf8');
            // Cheap mod-check — only stat every 64 events to keep hot path light.
            if (event.seq % 64 === 0)
                await rotateStreamLogIfNeeded();
        }
        catch {
            // never throw from the stream
        }
    })();
    return event;
}
/**
 * Return a bounded snapshot of recent execution events. When `sinceSeq` is
 * provided, only newer events are returned (long-poll style).
 */
export function getExecutionSnapshot(opts = {}) {
    const limit = Math.max(10, Math.min(MAX_EVENTS, Math.round(opts.limit ?? 200)));
    const sinceSeq = typeof opts.sinceSeq === 'number' && Number.isFinite(opts.sinceSeq) ? opts.sinceSeq : 0;
    const slice = STREAM.events.filter((e) => e.seq > sinceSeq).slice(-limit);
    const counts = {
        file_activity: 0,
        tool_call: 0,
        reasoning: 0,
        patch_event: 0,
        test_event: 0,
        watchdog_event: 0,
        thinking: 0,
        repo_activity: 0,
        evidence_card: 0,
    };
    for (const e of STREAM.events)
        counts[e.category] += 1;
    const latestReasoning = [...STREAM.events].reverse().find((e) => e.category === 'reasoning');
    const currentTask = latestReasoning
        ? {
            label: latestReasoning.label,
            subtask: typeof latestReasoning.meta?.subtask === 'string' ? latestReasoning.meta.subtask : undefined,
            progressPct: latestReasoning.progressPct,
            status: latestReasoning.status,
            confidence: latestReasoning.confidence,
            at: latestReasoning.at,
        }
        : null;
    return {
        ok: true,
        marker: IVX_EXECUTION_STREAM_MARKER,
        generatedAt: nowIso(),
        latestSeq: STREAM.seq,
        events: slice,
        currentTask,
        counts,
    };
}
/** Reset the stream — used by tests only. */
export function _resetExecutionStreamForTests() {
    STREAM.events.length = 0;
    STREAM.seq = 0;
}
