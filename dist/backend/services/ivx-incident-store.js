/**
 * IVX Incident Store — central, persistent, owner-readable record of every
 * runtime failure (frontend, backend, provider, auth, render, timeout).
 *
 * Storage strategy:
 *   - In-memory ring (fast read for diagnosis agent + health metric)
 *   - File-backed JSONL append at logs/audit/incidents.jsonl so incidents
 *     survive a single backend process restart (best-effort; safe to fail)
 *
 * No PII, no message bodies, no tokens. `requestBodyPreview` is capped and
 * sanitized; `stack` is capped to 8 KB.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
const MAX_ENTRIES = 500;
const STACK_CAP = 8 * 1024;
const BODY_CAP = 2 * 1024;
const STORE = new Map();
const ORDER = [];
const INCIDENTS_FILE = path.resolve(process.cwd(), 'logs/audit/incidents.jsonl');
let restoreAttempted = false;
function nowIso() {
    return new Date().toISOString();
}
function makeId() {
    return `inc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function capString(value, cap) {
    if (!value)
        return null;
    const s = String(value);
    if (s.length <= cap)
        return s;
    return `${s.slice(0, cap)}\n…(truncated ${s.length - cap} chars)`;
}
function sanitizeBodyPreview(value) {
    if (!value)
        return null;
    const redacted = String(value)
        .replace(/("?(?:authorization|access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|jwt)"?\s*[:=]\s*"?)([^"\s,}]+)/gi, '$1<redacted>')
        .replace(/Bearer\s+[A-Za-z0-9._\-+/=]+/gi, 'Bearer <redacted>');
    return capString(redacted, BODY_CAP);
}
function currentEnvironment() {
    return process.env.NODE_ENV || process.env.RENDER_ENV || 'unknown';
}
function currentBuildId() {
    return (process.env.RENDER_GIT_COMMIT
        || process.env.GIT_COMMIT
        || process.env.IVX_BUILD_ID
        || null);
}
async function persistIncidentLine(entry) {
    try {
        await fs.mkdir(path.dirname(INCIDENTS_FILE), { recursive: true });
        await fs.appendFile(INCIDENTS_FILE, `${JSON.stringify(entry)}\n`, 'utf8');
    }
    catch {
        // best-effort persistence
    }
}
async function restoreIncidentsFromDisk() {
    if (restoreAttempted)
        return;
    restoreAttempted = true;
    try {
        const raw = await fs.readFile(INCIDENTS_FILE, 'utf8');
        const lines = raw.split('\n').filter((l) => l.trim().length > 0).slice(-MAX_ENTRIES);
        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);
                if (parsed && typeof parsed.id === 'string') {
                    STORE.set(parsed.id, parsed);
                    ORDER.push(parsed.id);
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
export async function ensureIncidentStoreReady() {
    await restoreIncidentsFromDisk();
}
/**
 * Records an incident synchronously into memory and asynchronously to disk.
 * Returns the created incident immediately.
 */
export function recordIncident(input) {
    const id = makeId();
    const entry = {
        id,
        traceId: input.traceId?.trim() || null,
        userId: input.userId?.trim() || null,
        conversationId: input.conversationId?.trim() || null,
        source: input.source ?? 'unknown',
        checkpoint: input.checkpoint?.trim() || null,
        fileLine: input.fileLine?.trim() || null,
        message: String(input.message || 'unknown error').slice(0, 1024),
        stack: capString(input.stack ?? null, STACK_CAP),
        requestBodyPreview: sanitizeBodyPreview(input.requestBodyPreview ?? null),
        responseStatus: typeof input.responseStatus === 'number' ? input.responseStatus : null,
        environment: currentEnvironment(),
        buildId: input.buildId ?? currentBuildId(),
        suggestedFix: input.suggestedFix ? capString(input.suggestedFix, 2048) : null,
        severity: input.severity ?? 'error',
        status: 'open',
        diagnosis: null,
        approval: null,
        lifecycle: [{ stage: 'detected', at: nowIso(), note: null, actor: 'system' }],
        createdAt: nowIso(),
        updatedAt: nowIso(),
    };
    STORE.set(id, entry);
    ORDER.push(id);
    while (ORDER.length > MAX_ENTRIES) {
        const oldest = ORDER.shift();
        if (oldest)
            STORE.delete(oldest);
    }
    void persistIncidentLine(entry);
    return entry;
}
export function listIncidents(limit = 50, filter) {
    const safeLimit = Math.max(1, Math.min(MAX_ENTRIES, Math.floor(limit)));
    const ids = ORDER.slice().reverse();
    const out = [];
    for (const id of ids) {
        const e = STORE.get(id);
        if (!e)
            continue;
        if (filter?.severity && e.severity !== filter.severity)
            continue;
        if (filter?.status && e.status !== filter.status)
            continue;
        if (filter?.source && e.source !== filter.source)
            continue;
        out.push(e);
        if (out.length >= safeLimit)
            break;
    }
    return out;
}
export function getIncident(id) {
    return STORE.get(id) ?? null;
}
export function updateIncident(id, patch) {
    const existing = STORE.get(id);
    if (!existing)
        return null;
    if (patch.status)
        existing.status = patch.status;
    if (patch.diagnosis !== undefined)
        existing.diagnosis = patch.diagnosis;
    if (patch.approval !== undefined)
        existing.approval = patch.approval;
    if (patch.suggestedFix !== undefined)
        existing.suggestedFix = patch.suggestedFix;
    existing.updatedAt = nowIso();
    void persistIncidentLine(existing);
    return existing;
}
/**
 * Append a lifecycle event to an incident. Used by the repair-policy state
 * machine to record every gate transition (stage → replay → approve → promote
 * → monitor → rollback). Best-effort persistence.
 */
export function appendLifecycleEvent(id, event) {
    const existing = STORE.get(id);
    if (!existing)
        return null;
    const entry = {
        stage: event.stage,
        at: event.at ?? nowIso(),
        note: event.note ?? null,
        actor: event.actor,
        metadata: event.metadata,
    };
    existing.lifecycle = [...(existing.lifecycle ?? []), entry];
    existing.updatedAt = nowIso();
    void persistIncidentLine(existing);
    return existing;
}
/**
 * Rolling failure rate over last `windowSize` owner-ai-style events (server source only).
 * Used by the production guard.
 */
export function getRollingFailureRate(windowSize = 50, sources = ['backend', 'provider', 'timeout', 'auth']) {
    const ids = ORDER.slice(-windowSize);
    const entries = ids.map((i) => STORE.get(i)).filter((e) => Boolean(e));
    const relevant = entries.filter((e) => sources.includes(e.source));
    const failures = relevant.filter((e) => e.severity === 'error' || e.severity === 'critical').length;
    const total = relevant.length;
    return {
        total,
        failures,
        rate: total > 0 ? failures / total : 0,
        windowStartedAt: relevant[0]?.createdAt ?? null,
        windowEndedAt: relevant[relevant.length - 1]?.createdAt ?? null,
    };
}
export function clearIncidentsForTest() {
    STORE.clear();
    ORDER.length = 0;
    restoreAttempted = false;
}
