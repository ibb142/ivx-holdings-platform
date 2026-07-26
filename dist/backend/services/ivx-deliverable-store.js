/**
 * IVX deliverable metadata + job-status store — PHASE 2 (Real Deliverable System).
 *
 * Durable, append-only + materialised store for every artifact the pipeline
 * produces. This is the "deliverable metadata table" + "job status tracking" +
 * "artifact audit trail" + "user notification" backing — all on durable disk so
 * status survives process restarts (the worker can crash mid-job and a fresh
 * process still reads the exact state).
 *
 * Layout (mirrors the proven execution-trace / agent-activity stores):
 *   logs/audit/deliverables/deliverables.jsonl   append-only event log (truth)
 *   logs/audit/deliverables/deliverables.json     materialised current state
 *   logs/audit/deliverables/notifications.json     ready-notification feed
 *
 * HARD RULE (BLOCK 33 alignment): a deliverable is COMPLETE only after ALL
 * proof exists — uploaded path + file size + bucket + signed URL + a passing
 * download-URL test. `markDeliverableComplete` enforces this; it refuses to
 * flip to `complete` without every proof field, so a report can never be
 * reported done without a real, downloadable artifact.
 *
 * Never throws into callers — a persistence failure is swallowed.
 */
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { recordMetricSample } from './ivx-metrics-store';
export const IVX_DELIVERABLE_STORE_MARKER = 'ivx-deliverable-store-2026-06-01';
const DIR = path.join(process.cwd(), 'logs', 'audit', 'deliverables');
const LOG_PATH = path.join(DIR, 'deliverables.jsonl');
const STATE_PATH = path.join(DIR, 'deliverables.json');
const NOTIFY_PATH = path.join(DIR, 'notifications.json');
const MAX_RECORDS = 500;
const MAX_NOTIFICATIONS = 200;
let writeChain = Promise.resolve();
async function ensureDir() {
    await mkdir(DIR, { recursive: true });
}
async function readJson(file, fallback) {
    try {
        const raw = await readFile(file, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : fallback;
    }
    catch {
        return fallback;
    }
}
async function writeJsonAtomic(file, value) {
    await ensureDir();
    const tmp = `${file}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
    await rename(tmp, file);
}
function enqueue(task) {
    const run = writeChain.then(task, task);
    writeChain = run.then(() => undefined, () => undefined);
    return run;
}
function genId() {
    return `dlv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
function trimOrNull(value) {
    if (typeof value !== 'string')
        return null;
    const t = value.trim();
    return t.length > 0 ? t : null;
}
async function readState() {
    return readJson(STATE_PATH, []);
}
async function writeState(records) {
    await writeJsonAtomic(STATE_PATH, records.slice(0, MAX_RECORDS));
}
/** Create a new queued deliverable job. Returns the created record. */
export async function createDeliverableJob(input) {
    const now = new Date().toISOString();
    const record = {
        id: genId(),
        kind: input.kind,
        title: trimOrNull(input.title) ?? 'Untitled report',
        status: 'queued',
        requestId: trimOrNull(input.requestId),
        conversationId: trimOrNull(input.conversationId),
        taskId: trimOrNull(input.taskId),
        filename: null,
        bucket: null,
        storagePath: null,
        fileSize: null,
        contentType: null,
        signedUrl: null,
        signedUrlExpiresAt: null,
        downloadVerified: false,
        downloadHttpStatus: null,
        downloadVerifiedSize: null,
        executionTraceId: null,
        error: null,
        events: [{ at: now, status: 'queued', detail: 'Deliverable job queued.' }],
        createdAt: now,
        updatedAt: now,
        completedAt: null,
    };
    await enqueue(async () => {
        try {
            await ensureDir();
            await appendFile(LOG_PATH, `${JSON.stringify({ at: now, event: 'create', record })}\n`, 'utf8');
            const records = await readState();
            await writeState([record, ...records]);
        }
        catch {
            // Never break the pipeline on a persistence error.
        }
    });
    return record;
}
/**
 * Patch a deliverable + append an audit-trail event. Returns the updated
 * record (or null if not found). `status` always records an audit event.
 */
export async function updateDeliverableJob(id, patch, eventDetail) {
    return enqueue(async () => {
        try {
            const records = await readState();
            const index = records.findIndex((r) => r.id === id);
            if (index < 0)
                return null;
            const existing = records[index];
            const now = new Date().toISOString();
            const nextStatus = patch.status ?? existing.status;
            const events = [...existing.events];
            if (patch.status && patch.status !== existing.status) {
                events.push({ at: now, status: patch.status, detail: eventDetail ?? `Status → ${patch.status}.` });
            }
            else if (eventDetail) {
                events.push({ at: now, status: nextStatus, detail: eventDetail });
            }
            const updated = {
                ...existing,
                ...patch,
                id: existing.id,
                events,
                createdAt: existing.createdAt,
                updatedAt: now,
            };
            records[index] = updated;
            await ensureDir();
            await appendFile(LOG_PATH, `${JSON.stringify({ at: now, event: 'update', id, patch, status: nextStatus })}\n`, 'utf8');
            await writeState(records);
            return updated;
        }
        catch {
            return null;
        }
    });
}
/**
 * Mark a deliverable COMPLETE — ONLY when every proof field exists (BLOCK 33
 * hard rule). Refuses (and marks failed-honest is left to the caller) if any
 * proof is missing, so a report can never be reported done without a real,
 * downloadable artifact + a passing download test.
 */
export async function markDeliverableComplete(id, proof) {
    const missing = [];
    if (!trimOrNull(proof.filename))
        missing.push('filename');
    if (!trimOrNull(proof.bucket))
        missing.push('bucket');
    if (!trimOrNull(proof.storagePath))
        missing.push('storagePath');
    if (!(typeof proof.fileSize === 'number' && proof.fileSize > 0))
        missing.push('fileSize');
    if (!trimOrNull(proof.signedUrl))
        missing.push('signedUrl');
    if (!trimOrNull(proof.signedUrlExpiresAt))
        missing.push('signedUrlExpiresAt');
    if (!(typeof proof.downloadHttpStatus === 'number' && (proof.downloadHttpStatus === 200 || proof.downloadHttpStatus === 206))) {
        missing.push('downloadHttpStatus(200|206)');
    }
    if (missing.length > 0) {
        return { ok: false, error: `Cannot mark complete — missing proof: ${missing.join(', ')}.`, missing };
    }
    const now = new Date().toISOString();
    const updated = await updateDeliverableJob(id, {
        status: 'complete',
        filename: proof.filename,
        bucket: proof.bucket,
        storagePath: proof.storagePath,
        fileSize: proof.fileSize,
        contentType: proof.contentType,
        signedUrl: proof.signedUrl,
        signedUrlExpiresAt: proof.signedUrlExpiresAt,
        downloadVerified: true,
        downloadHttpStatus: proof.downloadHttpStatus,
        downloadVerifiedSize: proof.downloadVerifiedSize ?? null,
        executionTraceId: proof.executionTraceId ?? null,
        completedAt: now,
        error: null,
    }, 'Deliverable COMPLETE — uploaded, signed, and download-verified.');
    if (!updated)
        return { ok: false, error: `Deliverable ${id} not found.`, missing: ['record'] };
    await recordDeliverableNotification({
        deliverableId: updated.id,
        title: updated.title,
        kind: updated.kind,
        signedUrl: updated.signedUrl ?? '',
        fileSize: updated.fileSize ?? 0,
    });
    // Metric: deliverable generation succeeded (real, download-verified artifact).
    recordMetricSample({ kind: 'deliverable', success: true, detail: `${updated.kind} · complete` });
    return { ok: true, record: updated };
}
/** Mark a deliverable failed with an honest reason. */
export async function markDeliverableFailed(id, error) {
    // Metric: deliverable generation failed (honest outcome).
    recordMetricSample({ kind: 'deliverable', success: false, detail: trimOrNull(error) ?? 'failed' });
    return updateDeliverableJob(id, { status: 'failed', error: trimOrNull(error) ?? 'Deliverable failed.' }, `Failed: ${error}`);
}
export async function getDeliverable(id) {
    const key = trimOrNull(id);
    if (!key)
        return null;
    const records = await readState();
    return records.find((r) => r.id === key) ?? null;
}
export async function listDeliverables(limit = 100) {
    const records = await readState();
    const safe = Math.max(1, Math.min(MAX_RECORDS, Math.floor(limit)));
    return records.slice(0, safe);
}
export async function summarizeDeliverables() {
    const records = await readState();
    const byStatus = {
        queued: 0, generating: 0, uploading: 0, signing: 0, verifying: 0, complete: 0, failed: 0,
    };
    for (const r of records)
        byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    return {
        marker: IVX_DELIVERABLE_STORE_MARKER,
        total: records.length,
        byStatus,
        complete: byStatus.complete,
        failed: byStatus.failed,
        inProgress: byStatus.queued + byStatus.generating + byStatus.uploading + byStatus.signing + byStatus.verifying,
    };
}
/** Append a "your artifact is ready" notification. Never throws. */
export async function recordDeliverableNotification(input) {
    await enqueue(async () => {
        try {
            const now = new Date().toISOString();
            const notif = {
                id: `ntf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
                deliverableId: input.deliverableId,
                title: input.title,
                kind: input.kind,
                signedUrl: input.signedUrl,
                fileSize: input.fileSize,
                createdAt: now,
                read: false,
            };
            const existing = await readJson(NOTIFY_PATH, []);
            await writeJsonAtomic(NOTIFY_PATH, [notif, ...existing].slice(0, MAX_NOTIFICATIONS));
        }
        catch {
            // notifications are best-effort.
        }
    });
}
export async function listDeliverableNotifications(limit = 50) {
    const all = await readJson(NOTIFY_PATH, []);
    const safe = Math.max(1, Math.min(MAX_NOTIFICATIONS, Math.floor(limit)));
    return all.slice(0, safe);
}
/**
 * True when at least one COMPLETE, download-verified deliverable exists for the
 * conversation — the signal the evidence gate uses to allow a real "report is
 * ready / here is your link" claim (BLOCK 33). Cross-session (reads disk).
 */
export async function conversationHasRealDeliverable(conversationId) {
    const key = trimOrNull(conversationId ?? null);
    if (!key)
        return false;
    const records = await readState();
    return records.some((r) => r.conversationId === key && r.status === 'complete' && r.downloadVerified && Boolean(r.signedUrl));
}
