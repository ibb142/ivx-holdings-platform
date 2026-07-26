/**
 * IVX Media Jobs API — owner-only endpoints for heavy media understanding jobs.
 *
 * Routes:
 *   OPTIONS /api/ivx/media-jobs
 *   POST    /api/ivx/media-jobs                 → create job (returns id, state, progress)
 *   GET     /api/ivx/media-jobs/:jobId          → snapshot (state, progress, logs, finalResult, errorState)
 *   POST    /api/ivx/media-jobs/:jobId/advance  → drive next phase (server-side worker step)
 *   POST    /api/ivx/media-jobs/:jobId/complete → mark completed with finalResult
 *   POST    /api/ivx/media-jobs/:jobId/fail     → mark failed (auto-retries once before final fail)
 *
 * Notes:
 *   - This is the visible job-lifecycle surface required by Block 2.
 *   - Heavy AI work itself runs through the existing /api/ivx/owner-ai pipeline; this surface tracks state and exposes phase progress for the chat UI.
 */
import { completeMediaJob, createMediaJob, failMediaJob, getMediaJob, transitionMediaJob, } from '../services/ivx-media-jobs';
const ALLOWED_NEXT_STATES = [
    'queued',
    'running',
    'analyzing_media',
    'generating_answer',
];
function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-store',
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
    });
}
export function ivxMediaJobsOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
    });
}
function readString(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}
function readMediaTypes(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value))
        return {};
    const result = {};
    for (const [key, raw] of Object.entries(value)) {
        if (typeof key !== 'string' || !key.trim())
            continue;
        const count = readNumber(raw);
        if (count > 0)
            result[key] = count;
    }
    return result;
}
function serializeJob(job) {
    return {
        id: job.id,
        ownerId: job.ownerId,
        mediaCount: job.mediaCount,
        mediaTypes: job.mediaTypes,
        state: job.state,
        progress: job.progress,
        logs: job.logs,
        finalResult: job.finalResult,
        errorState: job.errorState,
        retryCount: job.retryCount,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        completedAt: job.completedAt,
    };
}
export async function handleIVXMediaJobsCreateRequest(request) {
    let body = {};
    try {
        body = await request.json();
    }
    catch {
        return jsonResponse({ ok: false, error: 'Invalid JSON body.' }, 400);
    }
    const mediaCount = readNumber(body.mediaCount);
    const mediaTypes = readMediaTypes(body.mediaTypes);
    const prompt = readString(body.prompt);
    const ownerId = readString(body.ownerId) || null;
    if (mediaCount <= 0) {
        return jsonResponse({ ok: false, error: 'mediaCount must be > 0.' }, 400);
    }
    if (!prompt) {
        return jsonResponse({ ok: false, error: 'prompt is required.' }, 400);
    }
    const job = createMediaJob({ mediaCount, mediaTypes, prompt, ownerId });
    return jsonResponse({ ok: true, job: serializeJob(job) }, 201);
}
export async function handleIVXMediaJobsGetRequest(_request, jobId) {
    const job = getMediaJob(jobId);
    if (!job) {
        return jsonResponse({ ok: false, error: 'Media job not found.', jobId }, 404);
    }
    return jsonResponse({ ok: true, job: serializeJob(job) });
}
export async function handleIVXMediaJobsAdvanceRequest(request, jobId) {
    const job = getMediaJob(jobId);
    if (!job) {
        return jsonResponse({ ok: false, error: 'Media job not found.', jobId }, 404);
    }
    let body = {};
    try {
        body = await request.json();
    }
    catch {
        body = {};
    }
    const nextState = readString(body.state);
    const message = readString(body.message) || `Phase advanced to ${nextState}.`;
    if (!ALLOWED_NEXT_STATES.includes(nextState)) {
        return jsonResponse({
            ok: false,
            error: `Invalid next state. Allowed: ${ALLOWED_NEXT_STATES.join(', ')}`,
            jobId,
        }, 400);
    }
    const updated = transitionMediaJob(jobId, nextState, message);
    if (!updated) {
        return jsonResponse({ ok: false, error: 'Media job not found after advance.', jobId }, 404);
    }
    return jsonResponse({ ok: true, job: serializeJob(updated) });
}
export async function handleIVXMediaJobsCompleteRequest(request, jobId) {
    let body = {};
    try {
        body = await request.json();
    }
    catch {
        body = {};
    }
    const finalResult = readString(body.finalResult);
    if (!finalResult) {
        return jsonResponse({ ok: false, error: 'finalResult is required.', jobId }, 400);
    }
    const updated = completeMediaJob(jobId, finalResult);
    if (!updated) {
        return jsonResponse({ ok: false, error: 'Media job not found.', jobId }, 404);
    }
    return jsonResponse({ ok: true, job: serializeJob(updated) });
}
export async function handleIVXMediaJobsFailRequest(request, jobId) {
    let body = {};
    try {
        body = await request.json();
    }
    catch {
        body = {};
    }
    const errorMessage = readString(body.errorMessage) || 'Unknown media-job failure.';
    const code = readString(body.code) || 'media_job_failed';
    const updated = failMediaJob(jobId, errorMessage, code);
    if (!updated) {
        return jsonResponse({ ok: false, error: 'Media job not found.', jobId }, 404);
    }
    return jsonResponse({ ok: true, job: serializeJob(updated) });
}
