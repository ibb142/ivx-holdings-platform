/**
 * IVX video worker.
 *
 * End-to-end media pipeline for owner-uploaded videos:
 *   queued → probing → extracting_frames → transcribing → analyzing → completed
 *                                                                   ↘ failed (with retry)
 *
 * HONEST RUNTIME SCOPE
 * - The production backend currently runs in `node:22-alpine` with NO ffmpeg/
 *   ffprobe binary. Frame extraction and audio-track extraction REQUIRE those
 *   binaries. Until they are attached, the worker records a precise, named
 *   blocker on the job (it never fabricates frames or transcripts).
 * - Every heavy dependency (tooling detection, frame extraction, audio
 *   extraction, transcription, frame vision analysis) is INJECTABLE so the
 *   orchestration, retry, and status tracking are fully unit-testable without
 *   ffmpeg or the network, and so the feature goes live the instant an
 *   ffmpeg-capable runtime + transcription key are present.
 *
 * Attach to make fully operational:
 *   1. An ffmpeg + ffprobe capable runtime (e.g. node:22 base image or an
 *      `apk add --no-cache ffmpeg` layer), OR set IVX_FFMPEG_PATH / IVX_FFPROBE_PATH.
 *   2. A transcription key: ELEVENLABS_API_KEY (preferred) or OPENAI_API_KEY.
 *   3. AI_GATEWAY_API_KEY for frame vision analysis (already used elsewhere).
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const MAX_FRAMES = 16;
const DEFAULT_FRAMES = 8;
const FRAME_MIME = 'image/jpeg';
const SUBPROCESS_TIMEOUT_MS = 60_000;
const TOOLING_BLOCKER = 'Media tooling unavailable: this runtime has no ffmpeg/ffprobe binary. '
    + 'Attach an ffmpeg-capable runtime (or set IVX_FFMPEG_PATH / IVX_FFPROBE_PATH) to enable '
    + 'frame extraction and audio transcription. Upload + storage + status tracking work now; '
    + 'frame/transcript stages stay blocked until tooling is attached.';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function nowIso() {
    return new Date().toISOString();
}
function ffmpegBinary() {
    return readTrimmed(process.env.IVX_FFMPEG_PATH) || 'ffmpeg';
}
function ffprobeBinary() {
    return readTrimmed(process.env.IVX_FFPROBE_PATH) || 'ffprobe';
}
function clampFrameCount(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0)
        return DEFAULT_FRAMES;
    return Math.min(MAX_FRAMES, Math.max(1, Math.floor(value)));
}
/** Run a binary, capturing stdout/stderr. Never throws on non-zero exit. */
function runProcess(bin, args) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch (error) {
            reject(error instanceof Error ? error : new Error('Failed to spawn process.'));
            return;
        }
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${bin} timed out after ${SUBPROCESS_TIMEOUT_MS}ms.`));
        }, SUBPROCESS_TIMEOUT_MS);
        child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
        child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
        child.on('error', (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on('close', (code) => {
            clearTimeout(timer);
            resolve({ code: code ?? -1, stdout, stderr });
        });
    });
}
async function binaryExists(bin) {
    try {
        const result = await runProcess(bin, ['-version']);
        return result.code === 0;
    }
    catch {
        return false;
    }
}
/* ---------------- default ffmpeg-backed deps ---------------- */
let cachedTooling = null;
/** Detect ffmpeg/ffprobe once per process. Set IVX_FORCE_TOOLING_REDETECT=1 to bypass cache. */
export async function detectMediaTooling() {
    if (cachedTooling && readTrimmed(process.env.IVX_FORCE_TOOLING_REDETECT) !== '1') {
        return cachedTooling;
    }
    const ffmpegPath = ffmpegBinary();
    const ffprobePath = ffprobeBinary();
    const [ffmpegAvailable, ffprobeAvailable] = await Promise.all([
        binaryExists(ffmpegPath),
        binaryExists(ffprobePath),
    ]);
    cachedTooling = {
        ffmpegAvailable,
        ffprobeAvailable,
        ffmpegPath,
        ffprobePath,
        detail: ffmpegAvailable && ffprobeAvailable
            ? 'ffmpeg and ffprobe are available; full video pipeline is operational.'
            : TOOLING_BLOCKER,
    };
    return cachedTooling;
}
/** Materialize a video source to a local temp file with cleanup. */
export async function resolveSource(source) {
    const fileName = readTrimmed(source.fileName) || `video-${Date.now()}.mp4`;
    const mimeType = source.mimeType ?? null;
    if (source.localPath) {
        return { path: source.localPath, fileName, mimeType, cleanup: async () => { } };
    }
    if (!source.bytes || source.bytes.byteLength === 0) {
        throw new Error('Video source has neither bytes nor a local path.');
    }
    const dir = await mkdtemp(join(tmpdir(), 'ivx-video-'));
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-100) || 'input.mp4';
    const path = join(dir, safeName);
    await writeFile(path, source.bytes);
    return {
        path,
        fileName,
        mimeType,
        cleanup: async () => { await rm(dir, { recursive: true, force: true }).catch(() => { }); },
    };
}
async function defaultProbe(source) {
    const result = await runProcess(ffprobeBinary(), [
        '-v', 'error',
        '-print_format', 'json',
        '-show_format',
        '-show_streams',
        source.path,
    ]);
    if (result.code !== 0) {
        throw new Error(`ffprobe failed (${result.code}): ${result.stderr.slice(0, 300)}`);
    }
    let parsed = {};
    try {
        parsed = JSON.parse(result.stdout);
    }
    catch {
        throw new Error('ffprobe returned unparseable JSON.');
    }
    const format = (parsed.format ?? {});
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const durationRaw = readTrimmed(format.duration);
    const duration = durationRaw ? Number.parseFloat(durationRaw) : NaN;
    const videoStream = streams.find((s) => readTrimmed(s.codec_type) === 'video');
    const hasAudio = streams.some((s) => readTrimmed(s.codec_type) === 'audio');
    return {
        durationSeconds: Number.isFinite(duration) ? duration : null,
        width: videoStream && typeof videoStream.width === 'number' ? videoStream.width : null,
        height: videoStream && typeof videoStream.height === 'number' ? videoStream.height : null,
        hasAudio,
    };
}
async function defaultExtractFrames(source, frameCount, probe) {
    const outDir = await mkdtemp(join(tmpdir(), 'ivx-frames-'));
    try {
        const duration = probe.durationSeconds && probe.durationSeconds > 0 ? probe.durationSeconds : null;
        // Evenly sample across the duration; fall back to a fixed fps when duration unknown.
        const args = ['-hide_banner', '-loglevel', 'error', '-i', source.path];
        const timestamps = [];
        if (duration) {
            const step = duration / (frameCount + 1);
            for (let i = 1; i <= frameCount; i += 1)
                timestamps.push(Number((step * i).toFixed(3)));
            const fps = frameCount / duration;
            args.push('-vf', `fps=${fps.toFixed(6)}`, '-frames:v', String(frameCount));
        }
        else {
            args.push('-vf', 'fps=1', '-frames:v', String(frameCount));
        }
        args.push('-q:v', '3', join(outDir, 'frame-%04d.jpg'));
        const result = await runProcess(ffmpegBinary(), args);
        if (result.code !== 0) {
            throw new Error(`ffmpeg frame extraction failed (${result.code}): ${result.stderr.slice(0, 300)}`);
        }
        const files = (await readdir(outDir)).filter((f) => f.endsWith('.jpg')).sort();
        const frames = [];
        for (let i = 0; i < files.length; i += 1) {
            const bytes = await readFile(join(outDir, files[i]));
            frames.push({
                index: i,
                timestampSeconds: timestamps[i] ?? (duration ? (duration / files.length) * i : i),
                base64: bytes.toString('base64'),
                mimeType: FRAME_MIME,
            });
        }
        if (frames.length === 0)
            throw new Error('ffmpeg produced no frames.');
        return frames;
    }
    finally {
        await rm(outDir, { recursive: true, force: true }).catch(() => { });
    }
}
async function defaultExtractAudio(source) {
    const outDir = await mkdtemp(join(tmpdir(), 'ivx-audio-'));
    const outPath = join(outDir, 'audio.m4a');
    try {
        const result = await runProcess(ffmpegBinary(), [
            '-hide_banner', '-loglevel', 'error',
            '-i', source.path,
            '-vn', '-acodec', 'aac', '-b:a', '128k',
            outPath,
        ]);
        if (result.code !== 0) {
            // No audio track is a normal, non-fatal outcome.
            return null;
        }
        const bytes = await readFile(outPath).catch(() => null);
        return bytes ? new Uint8Array(bytes) : null;
    }
    finally {
        await rm(outDir, { recursive: true, force: true }).catch(() => { });
    }
}
async function defaultTranscribe(audio, fileName) {
    const { transcribeAudioBytes } = await import('./ivx-transcription-core');
    return transcribeAudioBytes(audio, fileName);
}
async function defaultAnalyzeFrames(input) {
    const { understandIVXVideo, defaultFrameVisionAnalyzer } = await import('./ivx-video-understanding');
    const result = await understandIVXVideo({
        frames: input.frames.map((frame) => ({
            url: `data:${frame.mimeType};base64,${frame.base64}`,
            timestampSeconds: frame.timestampSeconds,
            mimeType: frame.mimeType,
        })),
        goal: input.goal,
        context: input.context,
    }, defaultFrameVisionAnalyzer);
    if (!result.ok || !result.analysis) {
        throw new Error(result.error ?? result.blocker ?? 'Frame analysis returned no result.');
    }
    return result.analysis;
}
export const defaultVideoWorkerDeps = {
    detectTooling: detectMediaTooling,
    probe: defaultProbe,
    extractFrames: defaultExtractFrames,
    extractAudio: defaultExtractAudio,
    transcribe: defaultTranscribe,
    analyzeFrames: defaultAnalyzeFrames,
};
/* ---------------- pipeline orchestration ---------------- */
export class VideoToolingUnavailableError extends Error {
    stage;
    constructor(stage) {
        super(TOOLING_BLOCKER);
        this.name = 'VideoToolingUnavailableError';
        this.stage = stage;
    }
}
/**
 * Run the full pipeline for a single video. Throws on hard failure (so the job
 * store can record the error + decide on retry). The thrown error preserves the
 * tooling blocker when ffmpeg is missing.
 */
export async function runVideoPipeline(input, deps = defaultVideoWorkerDeps, onStage) {
    const frameCount = clampFrameCount(input.frameCount);
    const goal = input.goal ?? 'describe';
    const wantTranscript = input.transcribe !== false;
    const context = readTrimmed(input.context);
    const tooling = await deps.detectTooling();
    if (!tooling.ffmpegAvailable || !tooling.ffprobeAvailable) {
        throw new VideoToolingUnavailableError('probe');
    }
    const resolved = await resolveSource(input.source);
    try {
        onStage?.('probing');
        const probe = await deps.probe(resolved);
        onStage?.('extracting_frames');
        const frames = await deps.extractFrames(resolved, frameCount, probe);
        let transcript = null;
        if (wantTranscript && probe.hasAudio) {
            onStage?.('transcribing');
            const audio = await deps.extractAudio(resolved);
            if (audio && audio.byteLength > 0) {
                transcript = await deps.transcribe(audio, `${resolved.fileName}.m4a`);
            }
        }
        onStage?.('analyzing');
        const analysis = await deps.analyzeFrames({ frames, goal, context });
        return {
            probe,
            frameCount: frames.length,
            timeline: frames.map((frame) => ({ index: frame.index, timestampSeconds: frame.timestampSeconds })),
            transcript,
            analysis,
        };
    }
    finally {
        await resolved.cleanup();
    }
}
const RETRY_BACKOFF_MS = [0, 5_000, 30_000];
function backoffForAttempt(attempt) {
    return RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)] ?? 30_000;
}
/**
 * In-memory job store. Survives within a process; designed so the persistence
 * layer (Supabase/Postgres table `ivx_video_jobs`) can be swapped in behind the
 * same interface without touching callers.
 */
export class VideoJobStore {
    jobs = new Map();
    enqueue(input) {
        const id = `vj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        const ts = nowIso();
        const job = {
            id,
            ownerUserId: input.ownerUserId,
            status: 'queued',
            storagePath: input.storagePath ?? null,
            bucket: input.bucket ?? null,
            attempts: 0,
            maxAttempts: typeof input.maxAttempts === 'number' && input.maxAttempts > 0 ? Math.min(5, input.maxAttempts) : 3,
            nextRetryAt: null,
            blocker: null,
            error: null,
            result: null,
            createdAt: ts,
            updatedAt: ts,
        };
        this.jobs.set(id, job);
        return { ...job };
    }
    get(id) {
        const job = this.jobs.get(id);
        return job ? { ...job } : null;
    }
    list(ownerUserId) {
        return Array.from(this.jobs.values())
            .filter((job) => job.ownerUserId === ownerUserId)
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
            .map((job) => ({ ...job }));
    }
    patch(id, patch) {
        const job = this.jobs.get(id);
        if (!job)
            return null;
        const next = { ...job, ...patch, updatedAt: nowIso() };
        this.jobs.set(id, next);
        return { ...next };
    }
    /**
     * Whether a failed job can be retried now. A null `nextRetryAt` means no retry
     * was scheduled (tooling blocker or attempts exhausted), so it is NOT retryable.
     */
    canRetry(id) {
        const job = this.jobs.get(id);
        if (!job || job.status !== 'failed')
            return false;
        if (job.attempts >= job.maxAttempts)
            return false;
        if (!job.nextRetryAt)
            return false;
        return Date.parse(job.nextRetryAt) <= Date.now();
    }
    /**
     * Process a single job through the pipeline. Resolver loads the bytes for the
     * job (e.g. download from Supabase storage). Records status transitions,
     * blocker, error, retry scheduling, and final result. Never throws.
     */
    async process(id, resolveInput, deps = defaultVideoWorkerDeps) {
        const existing = this.jobs.get(id);
        if (!existing)
            return null;
        if (existing.status === 'completed')
            return { ...existing };
        const attempt = existing.attempts + 1;
        this.patch(id, { status: 'queued', attempts: attempt, error: null, blocker: null, nextRetryAt: null });
        try {
            const input = await resolveInput({ ...existing });
            const result = await runVideoPipeline(input, deps, (status) => {
                this.patch(id, { status });
            });
            return this.patch(id, { status: 'completed', result, error: null, blocker: null, nextRetryAt: null });
        }
        catch (error) {
            const isTooling = error instanceof VideoToolingUnavailableError;
            const message = error instanceof Error ? error.message : 'Video pipeline failed.';
            const canRetryAgain = attempt < existing.maxAttempts && !isTooling;
            return this.patch(id, {
                status: 'failed',
                error: message.slice(0, 500),
                blocker: isTooling ? TOOLING_BLOCKER : null,
                nextRetryAt: canRetryAgain ? new Date(Date.now() + backoffForAttempt(attempt - 1)).toISOString() : null,
            });
        }
    }
    /** Test/maintenance helper. */
    clear() {
        this.jobs.clear();
    }
}
let sharedStore = null;
export function getVideoJobStore() {
    if (!sharedStore)
        sharedStore = new VideoJobStore();
    return sharedStore;
}
export async function getVideoWorkerCapabilities() {
    const tooling = await detectMediaTooling();
    const transcriptionConfigured = Boolean(readTrimmed(process.env.ELEVENLABS_API_KEY)
        || readTrimmed(process.env.ELEVENLABS_SECRET_KEY)
        || readTrimmed(process.env.OPENAI_API_KEY)
        || readTrimmed(process.env.WHISPER_API_KEY));
    const aiGatewayConfigured = Boolean(readTrimmed(process.env.AI_GATEWAY_API_KEY));
    const ffmpegReady = tooling.ffmpegAvailable && tooling.ffprobeAvailable;
    const remaining = [];
    if (!ffmpegReady)
        remaining.push('ffmpeg + ffprobe binaries (attach an ffmpeg-capable runtime or set IVX_FFMPEG_PATH / IVX_FFPROBE_PATH)');
    if (!transcriptionConfigured)
        remaining.push('transcription key (ELEVENLABS_API_KEY or OPENAI_API_KEY)');
    if (!aiGatewayConfigured)
        remaining.push('AI_GATEWAY_API_KEY for frame vision analysis');
    return {
        videoUpload: true,
        videoMetadataSummary: true,
        videoFrameExtraction: ffmpegReady,
        videoTranscriptExtraction: ffmpegReady && transcriptionConfigured,
        videoFrameAnalysis: ffmpegReady && aiGatewayConfigured,
        retryStatusTracking: true,
        tooling,
        transcriptionConfigured,
        aiGatewayConfigured,
        remainingRuntimeDependencies: remaining,
    };
}
export const VIDEO_WORKER_TOOLING_BLOCKER = TOOLING_BLOCKER;
