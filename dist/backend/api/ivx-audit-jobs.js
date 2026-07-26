/**
 * IVX enterprise audit job API.
 *
 * Endpoints (owner-only):
 *   POST   /api/ivx/audit-jobs                 → start a background audit job
 *   GET    /api/ivx/audit-jobs                 → list recent jobs
 *   GET    /api/ivx/audit-jobs/:id             → job status + cursor + progress
 *   GET    /api/ivx/audit-jobs/:id/chunks      → lazy-load chunks (?offset&limit)
 *   GET    /api/ivx/audit-jobs/:id/export      → assemble the full report
 *   POST   /api/ivx/audit-jobs/:id/resume      → resume after pause/interruption
 *   POST   /api/ivx/audit-jobs/:id/pause       → pause between chunks
 *   POST   /api/ivx/audit-jobs/:id/cancel      → cancel the job
 *
 * The audit engine generates chunk-by-chunk in the background and persists each
 * chunk to disk, so these endpoints can serve progress and resume across restarts.
 */
import { cancelAuditJob, pauseAuditJob, resumeAuditJob, startAuditJob, } from '../services/ivx-audit-engine';
import { assembleAuditReport, getAuditJob, listAuditJobs, readAuditChunks, } from '../services/ivx-audit-job-store';
import { extractRequestedItemCount } from '../services/ivx-report-continuation';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function progressPercent(job) {
    if (!job.targetItemCount || job.targetItemCount <= 0) {
        return null;
    }
    return Math.min(100, Math.round((job.cursorLastItem / job.targetItemCount) * 100));
}
function serializeJob(job) {
    return {
        id: job.id,
        status: job.status,
        prompt: job.prompt,
        targetItemCount: job.targetItemCount,
        cursorLastItem: job.cursorLastItem,
        chunkCount: job.chunkCount,
        totalChars: job.totalChars,
        progressPercent: progressPercent(job),
        error: job.error,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
    };
}
export const OPTIONS = () => ownerOnlyOptions();
export async function handleStartAuditJobRequest(request) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    let body = {};
    try {
        body = (await request.json());
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const prompt = readTrimmed(body.prompt) || readTrimmed(body.message);
    if (!prompt) {
        return ownerOnlyJson({ ok: false, error: 'prompt is required.' }, 400);
    }
    // Honour an explicit target if provided, else infer from the prompt
    // ("audit 1-5000", "5000 items"). Cap at 5000 for a single job.
    const explicitTarget = Number(body.targetItemCount);
    const inferredTarget = extractRequestedItemCount(prompt);
    const target = Number.isFinite(explicitTarget) && explicitTarget > 0
        ? Math.min(Math.floor(explicitTarget), 5000)
        : inferredTarget
            ? Math.min(inferredTarget, 5000)
            : null;
    const job = await startAuditJob({
        prompt,
        module: readTrimmed(body.module) || 'owner-room',
        model: readTrimmed(body.model) || null,
        conversationId: readTrimmed(body.conversationId) || null,
        targetItemCount: target,
        maxOutputTokens: Number.isFinite(Number(body.maxOutputTokens)) ? Number(body.maxOutputTokens) : undefined,
    });
    return ownerOnlyJson({ ok: true, job: serializeJob(job) });
}
export async function handleListAuditJobsRequest(request) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    const jobs = await listAuditJobs(25);
    return ownerOnlyJson({ ok: true, jobs: jobs.map(serializeJob) });
}
export async function handleAuditJobStatusRequest(request, jobId) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    const job = await getAuditJob(jobId);
    if (!job) {
        return ownerOnlyJson({ ok: false, error: 'audit job not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, job: serializeJob(job) });
}
export async function handleAuditJobChunksRequest(request, jobId) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    const job = await getAuditJob(jobId);
    if (!job) {
        return ownerOnlyJson({ ok: false, error: 'audit job not found.' }, 404);
    }
    const url = new URL(request.url);
    const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;
    const limit = Number.parseInt(url.searchParams.get('limit') ?? '20', 10) || 20;
    const page = await readAuditChunks(jobId, offset, limit);
    return ownerOnlyJson({
        ok: true,
        job: serializeJob(job),
        chunks: page.chunks,
        total: page.total,
        nextOffset: page.nextOffset,
    });
}
export async function handleAuditJobExportRequest(request, jobId) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    const job = await getAuditJob(jobId);
    if (!job) {
        return ownerOnlyJson({ ok: false, error: 'audit job not found.' }, 404);
    }
    const report = await assembleAuditReport(jobId);
    return ownerOnlyJson({
        ok: true,
        job: serializeJob(job),
        report,
        reportChars: report.length,
    });
}
export async function handleResumeAuditJobRequest(request, jobId) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    const job = await resumeAuditJob(jobId);
    if (!job) {
        return ownerOnlyJson({ ok: false, error: 'audit job not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, job: serializeJob(job) });
}
export async function handlePauseAuditJobRequest(request, jobId) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    const job = await pauseAuditJob(jobId);
    if (!job) {
        return ownerOnlyJson({ ok: false, error: 'audit job not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, job: serializeJob(job) });
}
export async function handleCancelAuditJobRequest(request, jobId) {
    const owner = await assertIVXOwnerOnly(request);
    if (!owner.userId) {
        return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
    }
    const job = await cancelAuditJob(jobId);
    if (!job) {
        return ownerOnlyJson({ ok: false, error: 'audit job not found.' }, 404);
    }
    return ownerOnlyJson({ ok: true, job: serializeJob(job) });
}
