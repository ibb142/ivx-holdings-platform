/**
 * IVX deliverable pipeline + background worker queue — PHASE 2 (Real Deliverable System).
 *
 * The orchestrator that turns a report request into a REAL, downloadable
 * artifact with full proof. It chains the leaf services in one resumable,
 * crash-safe, owner-visible job:
 *
 *   1. generate   PDF (pdf-lib) or CSV bytes
 *   2. upload     bytes → Supabase Storage (real path + size)
 *   3. sign       a time-limited download URL
 *   4. verify     the signed URL actually serves the file (real GET)
 *   5. complete   ONLY when every proof exists (markDeliverableComplete)
 *   6. notify     append a "your artifact is ready" notification
 *   7. trace      record an execution trace (audit system, TASK 3)
 *
 * A background worker queue processes jobs one at a time off the event loop so
 * the API returns a job id immediately (no blocking request). The whole run is
 * wrapped in `withAgentRun` so it streams in IVX → Live Work with real proof.
 *
 * HARD RULE (BLOCK 33): a report is COMPLETE only after uploaded path + size +
 * bucket + signed URL + a passing download test. Any missing proof → the job is
 * marked failed with the exact honest reason; it is never reported done.
 */
import { buildCsv } from './ivx-csv-export';
import { generateReportPdf } from './ivx-pdf-generator';
import { createDeliverableJob, getDeliverable, listDeliverables, markDeliverableComplete, markDeliverableFailed, updateDeliverableJob, } from './ivx-deliverable-store';
import { createSignedUrl, ensureBucket, uploadObject, verifyDownload, IVX_DELIVERABLES_BUCKET, } from './ivx-supabase-storage';
import { recordExecutionTrace } from './ivx-execution-trace-store';
import { withAgentRun } from './ivx-agent-activity-store';
export const IVX_DELIVERABLE_PIPELINE_MARKER = 'ivx-deliverable-pipeline-2026-06-01';
const CONTENT_TYPE = {
    pdf: 'application/pdf',
    csv: 'text/csv',
};
const EXT = { pdf: 'pdf', csv: 'csv' };
/** Build a safe, unique storage object path for a deliverable. */
function buildStoragePath(record) {
    const slug = record.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'report';
    const now = new Date();
    const yyyy = now.getUTCFullYear();
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    return `reports/${yyyy}/${mm}/${slug}-${record.id}.${EXT[record.kind]}`;
}
// ---------------------------------------------------------------------------
// Background worker queue
// ---------------------------------------------------------------------------
const queue = [];
let workerActive = false;
/** Generate the artifact bytes for a job. Never throws. */
async function generateBytes(request) {
    if (request.kind === 'pdf') {
        const result = await generateReportPdf(request.spec);
        if (!result.ok)
            return { ok: false, error: `PDF generation failed: ${result.error}` };
        return { ok: true, bytes: result.bytes, detail: `${result.pageCount} page(s), ${result.byteLength} bytes` };
    }
    const csv = buildCsv(request.rows, request.columns);
    if (csv.byteLength === 0)
        return { ok: false, error: 'CSV generation produced an empty file.' };
    return { ok: true, bytes: csv.bytes, detail: `${csv.rowCount} row(s), ${csv.columns.length} column(s), ${csv.byteLength} bytes` };
}
/**
 * Run the full pipeline for a single job id. Advances durable job state at
 * every step; on any failure marks the job failed with the exact reason and
 * returns. Never throws.
 */
async function processJob(jobId, request) {
    const record = await getDeliverable(jobId);
    if (!record)
        return null;
    // 1. generate
    await updateDeliverableJob(jobId, { status: 'generating' }, 'Generating artifact bytes.');
    const gen = await generateBytes(request);
    if (!gen.ok) {
        await markDeliverableFailed(jobId, gen.error);
        return getDeliverable(jobId);
    }
    const contentType = CONTENT_TYPE[record.kind];
    const storagePath = buildStoragePath(record);
    const filename = storagePath.split('/').pop() ?? `${record.id}.${EXT[record.kind]}`;
    await updateDeliverableJob(jobId, { fileSize: gen.bytes.byteLength, contentType, filename }, `Generated: ${gen.detail}.`);
    // 2. upload (ensure bucket first)
    await updateDeliverableJob(jobId, { status: 'uploading' }, `Ensuring bucket ${IVX_DELIVERABLES_BUCKET} + uploading.`);
    const bucketResult = await ensureBucket(IVX_DELIVERABLES_BUCKET);
    if (!bucketResult.ok) {
        await markDeliverableFailed(jobId, `Storage bucket unavailable: ${bucketResult.error}`);
        return getDeliverable(jobId);
    }
    const upload = await uploadObject({ bucket: IVX_DELIVERABLES_BUCKET, path: storagePath, body: gen.bytes, contentType });
    if (!upload.ok) {
        await markDeliverableFailed(jobId, `Upload failed: ${upload.error}`);
        return getDeliverable(jobId);
    }
    await updateDeliverableJob(jobId, { bucket: upload.bucket, storagePath: upload.path, fileSize: upload.size }, `Uploaded ${upload.size} bytes to ${upload.fullPath} (HTTP ${upload.httpStatus}).`);
    // 3. sign
    await updateDeliverableJob(jobId, { status: 'signing' }, 'Creating signed download URL.');
    const ttl = request.signedUrlTtlSeconds ?? 3600;
    const signed = await createSignedUrl(upload.path, ttl, upload.bucket);
    if (!signed.ok) {
        await markDeliverableFailed(jobId, `Signed URL failed: ${signed.error}`);
        return getDeliverable(jobId);
    }
    await updateDeliverableJob(jobId, { signedUrl: signed.signedUrl, signedUrlExpiresAt: signed.expiresAt }, `Signed URL created (expires ${signed.expiresAt}).`);
    // 4. verify download
    await updateDeliverableJob(jobId, { status: 'verifying' }, 'Verifying the signed URL serves the file.');
    const verify = await verifyDownload(signed.signedUrl);
    if (!verify.ok || verify.httpStatus === null) {
        await markDeliverableFailed(jobId, `Download verification failed: ${verify.error ?? `HTTP ${verify.httpStatus}`}`);
        return getDeliverable(jobId);
    }
    await updateDeliverableJob(jobId, { downloadHttpStatus: verify.httpStatus, downloadVerifiedSize: verify.contentLength }, `Download verified: HTTP ${verify.httpStatus}${verify.contentLength !== null ? ` · ${verify.contentLength} bytes` : ''}.`);
    // 7. trace (audit) — record the real artifact proof BEFORE completion so the
    // execution-trace id can be linked into the completed record.
    const traceId = await recordExecutionTrace({
        toolName: `deliverable_${record.kind}`,
        requestId: record.requestId ?? jobId,
        taskId: record.taskId,
        conversationId: record.conversationId,
        rawOutput: {
            bucket: upload.bucket,
            storagePath: upload.path,
            fileSize: upload.size,
            contentType,
            signedUrl: signed.signedUrl,
            signedUrlExpiresAt: signed.expiresAt,
            downloadHttpStatus: verify.httpStatus,
            downloadVerifiedSize: verify.contentLength,
        },
        rawOutputRef: `${upload.bucket}/${upload.path}`,
        linkedClaim: `Deliverable "${record.title}" generated and uploaded (${upload.size} bytes).`,
    });
    // 5 + 6. complete (proof-gated) + notify (notification fired inside markComplete)
    const completion = await markDeliverableComplete(jobId, {
        filename,
        bucket: upload.bucket,
        storagePath: upload.path,
        fileSize: upload.size,
        contentType,
        signedUrl: signed.signedUrl,
        signedUrlExpiresAt: signed.expiresAt,
        downloadHttpStatus: verify.httpStatus,
        downloadVerifiedSize: verify.contentLength,
        executionTraceId: traceId,
    });
    if (!completion.ok) {
        await markDeliverableFailed(jobId, completion.error);
        return getDeliverable(jobId);
    }
    return completion.record;
}
/** Pump the queue: process jobs sequentially until empty. */
function startWorker() {
    if (workerActive)
        return;
    workerActive = true;
    void (async () => {
        try {
            while (queue.length > 0) {
                const next = queue.shift();
                if (!next)
                    continue;
                const request = pendingRequests.get(next);
                pendingRequests.delete(next);
                if (!request)
                    continue;
                await withAgentRun({
                    kind: 'other',
                    label: `Deliverable: ${request.title}`,
                    why: 'Owner requested a real downloadable artifact (PHASE 2 deliverable pipeline).',
                    detail: `Generate ${request.kind.toUpperCase()} → upload → sign → verify → complete.`,
                    proofOf: (rec) => rec && rec.status === 'complete'
                        ? `COMPLETE · ${rec.fileSize ?? 0} bytes · ${rec.bucket}/${rec.storagePath} · download HTTP ${rec.downloadHttpStatus}.`
                        : `Failed: ${rec?.error ?? 'unknown error'}`,
                }, () => processJob(next, request));
            }
        }
        finally {
            workerActive = false;
            // A job may have been enqueued between the loop exit and flag reset.
            if (queue.length > 0)
                startWorker();
        }
    })();
}
const pendingRequests = new Map();
/**
 * Enqueue a deliverable job. Creates the durable job record (status queued),
 * schedules the background worker, and returns the job id immediately — the
 * heavy generate→upload→sign→verify work runs off the request path.
 */
export async function enqueueDeliverable(request) {
    const record = await createDeliverableJob({
        kind: request.kind,
        title: request.title,
        requestId: request.requestId,
        conversationId: request.conversationId,
        taskId: request.taskId,
    });
    pendingRequests.set(record.id, request);
    queue.push(record.id);
    startWorker();
    return { jobId: record.id, status: record.status, kind: record.kind, title: record.title };
}
/**
 * Run a deliverable job to completion synchronously (await the full pipeline).
 * Used by callers that need the final proof inline (and by tests). Bypasses the
 * background queue but reuses the exact same processing path.
 */
export async function runDeliverableNow(request) {
    const record = await createDeliverableJob({
        kind: request.kind,
        title: request.title,
        requestId: request.requestId,
        conversationId: request.conversationId,
        taskId: request.taskId,
    });
    return processJob(record.id, request);
}
export { getDeliverable, listDeliverables };
