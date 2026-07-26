/**
 * Owner-only video worker routes.
 *
 * Drives the end-to-end media pipeline (ffmpeg frame/audio extraction →
 * transcription → AI-gateway frame analysis) on top of the existing
 * upload/storage/metadata pipeline in `owner-multimodal.ts`.
 *
 * Routes (all owner-guarded):
 *   POST /api/video/jobs              enqueue + process a stored video
 *   GET  /api/video/jobs              list this owner's jobs
 *   GET  /api/video/jobs/:jobId       fetch one job's status/result
 *   POST /api/video/jobs/:jobId/retry retry a failed job (if attempts remain)
 *   GET  /api/video/capabilities      runtime capability + dependency report
 *
 * Honest scope: when the runtime has no ffmpeg/ffprobe, jobs transition to
 * `failed` with a precise `blocker` (never fabricated frames/transcripts). The
 * moment an ffmpeg-capable runtime + transcription key are attached, the same
 * routes produce real frames, transcripts, and analysis with no code change.
 */
import { IVX_CHAT_UPLOAD_BUCKET, IVX_OWNER_AI_BUCKET } from '../../expo/shared/ivx';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getVideoJobStore, getVideoWorkerCapabilities, } from '../services/ivx-video-worker';
const DEPLOYMENT_MARKER = 'ivx-owner-video-worker-2026-06-15t-feature4';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function nowIso() {
    return new Date().toISOString();
}
function resolveBucket(value) {
    const requested = readTrimmed(value);
    if (requested === IVX_CHAT_UPLOAD_BUCKET || requested === IVX_OWNER_AI_BUCKET)
        return requested;
    return IVX_OWNER_AI_BUCKET;
}
async function readJsonBody(request) {
    return await request.json().catch(() => ({}));
}
async function downloadStoredFile(client, storagePath, bucket) {
    const dl = await client.storage.from(bucket).download(storagePath);
    if (dl.error || !dl.data) {
        throw new Error(dl.error?.message ?? 'Failed to download stored video.');
    }
    const buffer = await dl.data.arrayBuffer();
    const mimeType = dl.data.type || null;
    return { bytes: new Uint8Array(buffer), mimeType };
}
function getErrorStatus(error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    if (message.includes('missing bearer token') || message.includes('invalid or expired'))
        return 401;
    if (message.includes('privileged ivx access is required'))
        return 403;
    if (message.includes('required') || message.includes('not found'))
        return 400;
    return 500;
}
function serializeJob(job) {
    return {
        id: job.id,
        status: job.status,
        storagePath: job.storagePath,
        bucket: job.bucket,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        nextRetryAt: job.nextRetryAt,
        blocker: job.blocker,
        error: job.error,
        result: job.result,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
    };
}
/** Build the resolver that loads a job's video bytes from Supabase storage. */
function makeInputResolver(client, options) {
    return async (job) => {
        if (!job.storagePath)
            throw new Error('Job has no storage path to load.');
        const bucket = job.bucket ?? IVX_OWNER_AI_BUCKET;
        const { bytes, mimeType } = await downloadStoredFile(client, job.storagePath, bucket);
        return {
            source: {
                bytes,
                fileName: job.storagePath.split('/').pop() ?? 'video.mp4',
                mimeType,
            },
            frameCount: options.frameCount,
            goal: options.goal,
            transcribe: options.transcribe,
            context: options.context,
        };
    };
}
async function withOwner(request, fn) {
    try {
        const ctx = await assertIVXOwnerOnly(request);
        const payload = await fn(ctx);
        return ownerOnlyJson({ ok: true, deploymentMarker: DEPLOYMENT_MARKER, ...payload });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Video worker error.';
        return ownerOnlyJson({ ok: false, error: message, detail: message, deploymentMarker: DEPLOYMENT_MARKER }, getErrorStatus(error));
    }
}
/** Enqueue a stored video and run the pipeline synchronously (awaited). */
export async function handleVideoJobCreate(request) {
    return withOwner(request, async (ctx) => {
        const body = await readJsonBody(request);
        const storagePath = readTrimmed(body.path ?? body.storagePath);
        if (!storagePath)
            throw new Error('Storage path is required to start a video job.');
        const bucket = resolveBucket(body.bucket);
        const store = getVideoJobStore();
        const job = store.enqueue({
            ownerUserId: ctx.userId,
            storagePath,
            bucket,
            maxAttempts: typeof body.maxAttempts === 'number' ? body.maxAttempts : undefined,
        });
        const resolver = makeInputResolver(ctx.client, {
            frameCount: typeof body.frameCount === 'number' ? body.frameCount : undefined,
            goal: typeof body.goal === 'string' ? body.goal : undefined,
            transcribe: body.transcribe !== false,
            context: readTrimmed(body.context),
        });
        const processed = await store.process(job.id, resolver);
        return { job: processed ? serializeJob(processed) : serializeJob(job), timestamp: nowIso() };
    });
}
export async function handleVideoJobList(request) {
    return withOwner(request, async (ctx) => {
        const jobs = getVideoJobStore().list(ctx.userId).map(serializeJob);
        return { jobs, count: jobs.length, timestamp: nowIso() };
    });
}
export async function handleVideoJobGet(request, jobId) {
    return withOwner(request, async (ctx) => {
        const job = getVideoJobStore().get(readTrimmed(jobId));
        if (!job || job.ownerUserId !== ctx.userId)
            throw new Error('Video job not found.');
        return { job: serializeJob(job), timestamp: nowIso() };
    });
}
export async function handleVideoJobRetry(request, jobId) {
    return withOwner(request, async (ctx) => {
        const store = getVideoJobStore();
        const existing = store.get(readTrimmed(jobId));
        if (!existing || existing.ownerUserId !== ctx.userId)
            throw new Error('Video job not found.');
        if (!store.canRetry(existing.id)) {
            return {
                retried: false,
                reason: existing.status !== 'failed'
                    ? `Job is ${existing.status}; only failed jobs can be retried.`
                    : existing.attempts >= existing.maxAttempts
                        ? 'Maximum retry attempts reached.'
                        : 'Retry backoff has not elapsed yet.',
                job: serializeJob(existing),
                timestamp: nowIso(),
            };
        }
        const resolver = makeInputResolver(ctx.client, {});
        const processed = await store.process(existing.id, resolver);
        return { retried: true, job: processed ? serializeJob(processed) : serializeJob(existing), timestamp: nowIso() };
    });
}
export async function handleVideoWorkerCapabilities(request) {
    return withOwner(request, async () => {
        const capabilities = await getVideoWorkerCapabilities();
        return { capabilities, timestamp: nowIso() };
    });
}
export function ownerVideoWorkerOptions() {
    return ownerOnlyOptions();
}
