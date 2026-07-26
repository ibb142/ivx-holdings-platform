/**
 * IVX Video Pipeline — Instagram-grade upload → storage → transcode → adaptive HLS.
 *
 * Flow (status column):
 *   uploaded → processing → ready
 *                         ↘ failed (exact error kept, original preserved, retryable)
 *
 * Storage layout (S3 bucket served by CloudFront at https://ivxholding.com):
 *   videos/original/{videoId}/{safeName}       — untouched source file
 *   videos/hls/{videoId}/master.m3u8           — adaptive master playlist
 *   videos/hls/{videoId}/{h}p/index.m3u8       — per-rendition playlist
 *   videos/hls/{videoId}/{h}p/seg_%04d.ts      — MPEG-TS segments (H.264 + AAC)
 *   videos/thumbs/{videoId}/thumb.jpg          — 480w thumbnail
 *   videos/thumbs/{videoId}/poster.jpg         — 1280w preview poster
 *   videos/thumbs/{videoId}/preview-blur.jpg   — tiny blurred placeholder (fast first paint)
 *   videos/meta/{videoId}.json                 — full metadata record (source of truth)
 *   videos/meta/index.json                     — id → playback summary (feed enrichment)
 *
 * Bitrate ladder (H.264 video + AAC 128k audio, per spec):
 *   1080p 5000k · 720p 3000k · 480p 1200k · 360p 800k — capped at source height.
 *
 * Requires ffmpeg/ffprobe on the runtime (Dockerfile installs them) and AWS creds.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const VIDEO_PIPELINE_MARKER = 'ivx-video-pipeline-v1-2026-07-03';
const LADDER = [
    { height: 1080, videoKbps: 5000, maxrateKbps: 6000 },
    { height: 720, videoKbps: 3000, maxrateKbps: 3500 },
    { height: 480, videoKbps: 1200, maxrateKbps: 1500 },
    { height: 360, videoKbps: 800, maxrateKbps: 900 },
];
const AUDIO_KBPS = 128;
const HLS_SEGMENT_SECONDS = 4;
const TRANSCODE_TIMEOUT_MS = 12 * 60 * 1000;
const PROBE_TIMEOUT_MS = 60 * 1000;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const INTERRUPTED_GRACE_MS = 3 * 60 * 1000;
const INTERRUPTED_ERROR = 'Processing was interrupted by a runtime restart (deploy or out-of-memory). '
    + 'The original file is preserved — retry processing.';
const META_PREFIX = 'videos/meta';
const ORIGINAL_PREFIX = 'videos/original';
const HLS_PREFIX = 'videos/hls';
const THUMB_PREFIX = 'videos/thumbs';
function env(name) {
    const value = process.env[name];
    return typeof value === 'string' ? value.trim() : '';
}
export function videoPipelineConfig() {
    const maxHeight = Number.parseInt(env('IVX_VIDEO_MAX_HEIGHT') || '1080', 10) || 1080;
    return {
        bucket: env('S3_BUCKET_NAME') || 'ivxholding.com',
        region: env('AWS_REGION') || 'us-east-1',
        publicBaseUrl: (env('IVX_VIDEO_CDN_BASE') || 'https://ivxholding.com').replace(/\/+$/, ''),
        maxUploadMb: Number.parseInt(env('IVX_VIDEO_MAX_MB') || '300', 10) || 300,
        /** Top rung of the encode ladder — lower it on memory-constrained runtimes (e.g. 720 on 512MB). */
        maxRenditionHeight: maxHeight,
        ladder: LADDER.filter((rung) => rung.height <= maxHeight).map((rung) => ({ ...rung, audioKbps: AUDIO_KBPS })),
        segmentSeconds: HLS_SEGMENT_SECONDS,
        supportedFormats: ['mp4', 'mov', 'm4v', 'qt (H.264 / HEVC sources)'],
        marker: VIDEO_PIPELINE_MARKER,
    };
}
function nowIso() {
    return new Date().toISOString();
}
/* ---------------- S3 helpers ---------------- */
let _s3 = null;
async function getS3() {
    if (_s3)
        return _s3;
    const { S3Client } = await import('@aws-sdk/client-s3');
    const cfg = videoPipelineConfig();
    const accessKeyId = env('AWS_ACCESS_KEY_ID');
    const secretAccessKey = env('AWS_SECRET_ACCESS_KEY');
    if (!accessKeyId || !secretAccessKey) {
        throw new Error('AWS credentials missing on runtime (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).');
    }
    _s3 = new S3Client({ region: cfg.region, credentials: { accessKeyId, secretAccessKey } });
    return _s3;
}
function contentTypeForKey(key) {
    if (key.endsWith('.m3u8'))
        return 'application/vnd.apple.mpegurl';
    if (key.endsWith('.ts'))
        return 'video/MP2T';
    if (key.endsWith('.jpg') || key.endsWith('.jpeg'))
        return 'image/jpeg';
    if (key.endsWith('.mp4') || key.endsWith('.m4v'))
        return 'video/mp4';
    if (key.endsWith('.mov') || key.endsWith('.qt'))
        return 'video/quicktime';
    if (key.endsWith('.json'))
        return 'application/json';
    return 'application/octet-stream';
}
async function s3Put(key, body, cacheControl) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await getS3();
    const cfg = videoPipelineConfig();
    await s3.send(new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body),
        ContentType: contentTypeForKey(key),
        CacheControl: cacheControl,
    }));
}
async function s3GetBytes(key) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await getS3();
    const cfg = videoPipelineConfig();
    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        const bytes = await res.Body?.transformToByteArray();
        return bytes ?? null;
    }
    catch {
        return null;
    }
}
/** Stream an S3 object to a local file (low memory — no full buffering). */
async function s3GetToFile(key, destPath) {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const { createWriteStream } = await import('node:fs');
    const { pipeline } = await import('node:stream/promises');
    const { Readable } = await import('node:stream');
    const s3 = await getS3();
    const cfg = videoPipelineConfig();
    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
        if (!res.Body)
            return false;
        await pipeline(res.Body, createWriteStream(destPath));
        return true;
    }
    catch {
        return false;
    }
}
function publicUrl(key) {
    return `${videoPipelineConfig().publicBaseUrl}/${key}`;
}
/* ---------------- metadata store (S3 JSON, source of truth) ---------------- */
function metaKey(videoId) {
    return `${META_PREFIX}/${videoId}.json`;
}
export async function getVideoRecord(videoId) {
    const safe = videoId.replace(/[^a-zA-Z0-9-]/g, '');
    if (!safe)
        return null;
    const bytes = await s3GetBytes(metaKey(safe));
    if (!bytes)
        return null;
    try {
        return JSON.parse(Buffer.from(bytes).toString('utf-8'));
    }
    catch {
        return null;
    }
}
async function saveVideoRecord(record) {
    record.updated_at = nowIso();
    await s3Put(metaKey(record.video_id), JSON.stringify(record, null, 2), 'no-cache');
    await updatePlaybackIndex(record);
}
async function updatePlaybackIndex(record) {
    try {
        const bytes = await s3GetBytes(`${META_PREFIX}/index.json`);
        let index = {};
        if (bytes) {
            try {
                index = JSON.parse(Buffer.from(bytes).toString('utf-8'));
            }
            catch {
                index = {};
            }
        }
        index[record.video_id] = {
            status: record.status,
            hls_url: record.hls_master_url,
            poster_url: record.poster_url,
            thumbnail_url: record.thumbnail_url,
            preview_blur_url: record.preview_blur_url ?? null,
            duration: record.duration,
            width: record.width,
            height: record.height,
            updated_at: record.updated_at,
        };
        await s3Put(`${META_PREFIX}/index.json`, JSON.stringify(index, null, 2), 'no-cache');
        cachedIndex = { at: Date.now(), index };
    }
    catch (error) {
        console.log('[VideoPipeline] index update failed:', error instanceof Error ? error.message : error);
    }
}
let cachedIndex = null;
/** Playback index for feed enrichment — 30s in-memory cache, never throws. */
export async function getPlaybackIndex() {
    if (cachedIndex && Date.now() - cachedIndex.at < 30_000)
        return cachedIndex.index;
    try {
        const bytes = await s3GetBytes(`${META_PREFIX}/index.json`);
        const index = bytes ? JSON.parse(Buffer.from(bytes).toString('utf-8')) : {};
        cachedIndex = { at: Date.now(), index };
        return index;
    }
    catch {
        return cachedIndex?.index ?? {};
    }
}
export async function listVideoRecords() {
    return getPlaybackIndex();
}
function runProc(bin, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        let child;
        try {
            child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch (error) {
            reject(error instanceof Error ? error : new Error('spawn failed'));
            return;
        }
        let stdout = '';
        let stderr = '';
        const timer = setTimeout(() => {
            child.kill('SIGKILL');
            reject(new Error(`${bin} timed out after ${Math.round(timeoutMs / 1000)}s`));
        }, timeoutMs);
        child.stdout?.on('data', (c) => { stdout += c.toString('utf8'); });
        child.stderr?.on('data', (c) => { stderr += c.toString('utf8'); if (stderr.length > 20_000)
            stderr = stderr.slice(-10_000); });
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
    });
}
function ffmpegBin() { return env('IVX_FFMPEG_PATH') || 'ffmpeg'; }
function ffprobeBin() { return env('IVX_FFPROBE_PATH') || 'ffprobe'; }
async function probeFile(path) {
    const res = await runProc(ffprobeBin(), ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], PROBE_TIMEOUT_MS);
    if (res.code !== 0)
        throw new Error(`ffprobe failed (${res.code}): ${res.stderr.slice(0, 400)}`);
    const parsed = JSON.parse(res.stdout);
    const streams = parsed.streams ?? [];
    const video = streams.find((s) => s.codec_type === 'video');
    const durationRaw = parsed.format?.duration ? Number.parseFloat(parsed.format.duration) : NaN;
    return {
        duration: Number.isFinite(durationRaw) ? Math.round(durationRaw * 100) / 100 : null,
        width: video && typeof video.width === 'number' ? video.width : null,
        height: video && typeof video.height === 'number' ? video.height : null,
        hasAudio: streams.some((s) => s.codec_type === 'audio'),
        videoCodec: video && typeof video.codec_name === 'string' ? video.codec_name : null,
    };
}
/* ---------------- transcode ---------------- */
function evenDim(value) {
    const v = Math.round(value);
    return v % 2 === 0 ? v : v - 1;
}
function selectLadder(sourceHeight) {
    const capHeight = videoPipelineConfig().maxRenditionHeight;
    const h = Math.min(sourceHeight && sourceHeight > 0 ? sourceHeight : 1080, capHeight);
    const rungs = LADDER
        .filter((r) => r.height <= h)
        .map((r) => ({ height: r.height, videoKbps: r.videoKbps, maxrateKbps: r.maxrateKbps }));
    if (rungs.length === 0)
        rungs.push({ height: evenDim(Math.max(h, 144)), videoKbps: 800, maxrateKbps: 900 });
    return rungs;
}
async function dirBytes(dir) {
    let total = 0;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory())
            total += await dirBytes(p);
        else
            total += (await stat(p)).size;
    }
    return total;
}
async function uploadDir(dir, keyPrefix, cacheControl) {
    const uploaded = [];
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) {
            uploaded.push(...await uploadDir(p, `${keyPrefix}/${entry.name}`, cacheControl));
        }
        else {
            const bytes = await readFile(p);
            const key = `${keyPrefix}/${entry.name}`;
            await s3Put(key, new Uint8Array(bytes), cacheControl);
            uploaded.push(key);
        }
    }
    return uploaded;
}
/**
 * Transcode a local source file into the HLS ladder + thumbnail + poster,
 * upload everything to S3, and return rendition metadata.
 */
async function transcodeToHls(videoId, sourcePath, probe) {
    const workDir = await mkdtemp(join(tmpdir(), `ivx-hls-${videoId.slice(0, 8)}-`));
    try {
        const rungs = selectLadder(probe.height);
        const renditions = [];
        for (const rung of rungs) {
            const outDir = join(workDir, `${rung.height}p`);
            await mkdir(outDir, { recursive: true });
            // Low-memory encode settings: the production runtime is a small container
            // (Render free tier, 512MB). superfast + single thread + ref=1 keeps the
            // x264 working set small enough to avoid the OOM killer while preserving
            // the target bitrate ladder (bitrate — not preset — drives delivered quality).
            const args = [
                '-hide_banner', '-loglevel', 'error', '-y',
                '-i', sourcePath,
                '-vf', `scale=-2:${rung.height}`,
                '-c:v', 'libx264', '-profile:v', 'main', '-level', '4.0',
                '-preset', 'superfast',
                '-threads', '1',
                '-x264-params', 'ref=1:rc-lookahead=8',
                '-b:v', `${rung.videoKbps}k`, '-maxrate', `${rung.maxrateKbps}k`, '-bufsize', `${rung.videoKbps * 2}k`,
                '-pix_fmt', 'yuv420p',
                '-g', '48', '-keyint_min', '48', '-sc_threshold', '0',
            ];
            if (probe.hasAudio)
                args.push('-c:a', 'aac', '-b:a', `${AUDIO_KBPS}k`, '-ac', '2', '-ar', '44100');
            else
                args.push('-an');
            args.push('-hls_time', String(HLS_SEGMENT_SECONDS), '-hls_playlist_type', 'vod', '-hls_segment_filename', join(outDir, 'seg_%04d.ts'), join(outDir, 'index.m3u8'));
            const res = await runProc(ffmpegBin(), args, TRANSCODE_TIMEOUT_MS);
            if (res.code !== 0)
                throw new Error(`ffmpeg ${rung.height}p failed (${res.code}): ${res.stderr.slice(0, 500)}`);
            const segCount = (await readdir(outDir)).filter((f) => f.endsWith('.ts')).length;
            if (segCount === 0)
                throw new Error(`ffmpeg ${rung.height}p produced no segments.`);
            const width = probe.width && probe.height
                ? evenDim((probe.width / probe.height) * rung.height)
                : evenDim((16 / 9) * rung.height);
            renditions.push({
                height: rung.height,
                width,
                videoKbps: rung.videoKbps,
                audioKbps: probe.hasAudio ? AUDIO_KBPS : 0,
                playlistUrl: publicUrl(`${HLS_PREFIX}/${videoId}/${rung.height}p/index.m3u8`),
                playlistPath: `${HLS_PREFIX}/${videoId}/${rung.height}p/index.m3u8`,
                segmentCount: segCount,
                bytes: await dirBytes(outDir),
            });
        }
        // Master playlist — highest quality first (players start high on fast links, then adapt).
        const masterLines = ['#EXTM3U', '#EXT-X-VERSION:3'];
        for (const r of renditions) {
            const bandwidth = Math.round((r.videoKbps + r.audioKbps) * 1000 * 1.1);
            const avg = Math.round((r.videoKbps + r.audioKbps) * 1000);
            const codecs = r.audioKbps > 0 ? 'avc1.4d401f,mp4a.40.2' : 'avc1.4d401f';
            masterLines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth},AVERAGE-BANDWIDTH=${avg},RESOLUTION=${r.width}x${r.height},CODECS="${codecs}"`);
            masterLines.push(`${r.height}p/index.m3u8`);
        }
        await writeFile(join(workDir, 'master.m3u8'), `${masterLines.join('\n')}\n`, 'utf-8');
        // Thumbnail (480w) + poster (1280w) from ~10% into the video.
        const seekTo = probe.duration && probe.duration > 2 ? Math.min(probe.duration * 0.1, 5) : 0.5;
        const thumbDir = join(workDir, '__thumbs');
        await mkdir(thumbDir, { recursive: true });
        const thumbRes = await runProc(ffmpegBin(), [
            '-hide_banner', '-loglevel', 'error', '-y', '-ss', seekTo.toFixed(2), '-i', sourcePath,
            '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', join(thumbDir, 'thumb.jpg'),
        ], PROBE_TIMEOUT_MS);
        if (thumbRes.code !== 0)
            throw new Error(`thumbnail generation failed: ${thumbRes.stderr.slice(0, 300)}`);
        const posterRes = await runProc(ffmpegBin(), [
            '-hide_banner', '-loglevel', 'error', '-y', '-ss', seekTo.toFixed(2), '-i', sourcePath,
            '-frames:v', '1', '-vf', 'scale=1280:-2', '-q:v', '3', join(thumbDir, 'poster.jpg'),
        ], PROBE_TIMEOUT_MS);
        if (posterRes.code !== 0)
            throw new Error(`poster generation failed: ${posterRes.stderr.slice(0, 300)}`);
        // Blurred preview placeholder (tiny, heavily blurred) — non-fatal if it fails.
        const blurRes = await runProc(ffmpegBin(), [
            '-hide_banner', '-loglevel', 'error', '-y', '-ss', seekTo.toFixed(2), '-i', sourcePath,
            '-frames:v', '1', '-vf', 'scale=240:-2,boxblur=20:2', '-q:v', '6', join(thumbDir, 'preview-blur.jpg'),
        ], PROBE_TIMEOUT_MS).catch(() => ({ code: -1, stdout: '', stderr: 'blur preview crashed' }));
        // Upload: segments + playlists (immutable long cache), thumbs (1 day).
        for (const r of renditions) {
            await uploadDir(join(workDir, `${r.height}p`), `${HLS_PREFIX}/${videoId}/${r.height}p`, 'public, max-age=31536000, immutable');
        }
        const masterKey = `${HLS_PREFIX}/${videoId}/master.m3u8`;
        await s3Put(masterKey, await readFile(join(workDir, 'master.m3u8'), 'utf-8'), 'public, max-age=300');
        const thumbKey = `${THUMB_PREFIX}/${videoId}/thumb.jpg`;
        const posterKey = `${THUMB_PREFIX}/${videoId}/poster.jpg`;
        await s3Put(thumbKey, new Uint8Array(await readFile(join(thumbDir, 'thumb.jpg'))), 'public, max-age=86400');
        await s3Put(posterKey, new Uint8Array(await readFile(join(thumbDir, 'poster.jpg'))), 'public, max-age=86400');
        let previewBlurKey = null;
        if (blurRes.code === 0) {
            previewBlurKey = `${THUMB_PREFIX}/${videoId}/preview-blur.jpg`;
            await s3Put(previewBlurKey, new Uint8Array(await readFile(join(thumbDir, 'preview-blur.jpg'))), 'public, max-age=86400');
        }
        return { renditions, masterKey, thumbKey, posterKey, previewBlurKey };
    }
    finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => { });
    }
}
/* ---------------- Supabase registration ---------------- */
let _sb = null;
async function getSupabase() {
    if (_sb)
        return _sb;
    const { createClient } = await import('@supabase/supabase-js');
    const url = env('EXPO_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL');
    const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY') || env('EXPO_PUBLIC_SUPABASE_ANON_KEY') || env('SUPABASE_ANON_KEY');
    _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
    return _sb;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Register a ready video in project_videos so the Instagram-style feed picks it up. */
async function registerInFeed(record) {
    try {
        const sb = await getSupabase();
        const orientation = record.width && record.height && record.height > record.width ? 'portrait' : 'landscape';
        // project_videos.project_id is a UUID column (NOT NULL, no FK). Deal ids are
        // free-form slugs (e.g. "casa-rosario-001") — those can't be stored in the
        // column, so the row falls back to the video's own id and the deal slug is
        // registered as platform meta property_id (which drives feed deal enrichment).
        const columnProjectId = record.project_id && UUID_RE.test(record.project_id)
            ? record.project_id
            : record.video_id;
        const row = {
            id: record.video_id,
            project_id: columnProjectId,
            video_url: record.original_url,
            thumbnail_url: record.thumbnail_url,
            cover_url: record.poster_url,
            title: record.title,
            duration_sec: record.duration ? Math.round(record.duration) : 0,
            width: record.width,
            height: record.height,
            orientation,
            is_approved: true,
        };
        const { data, error } = await sb.from('project_videos').upsert(row, { onConflict: 'id' }).select('id').maybeSingle();
        if (error)
            return { rowId: null, error: String(error.message ?? error) };
        if (record.project_id && columnProjectId !== record.project_id) {
            try {
                const { upsertVideoMeta } = await import('./ivx-video-platform-store');
                await upsertVideoMeta(record.video_id, { property_id: record.project_id });
            }
            catch (metaError) {
                console.log('[VideoPipeline] deal meta registration failed:', metaError instanceof Error ? metaError.message : metaError);
            }
        }
        return { rowId: data?.id ? String(data.id) : record.video_id, error: null };
    }
    catch (error) {
        return { rowId: null, error: error instanceof Error ? error.message : 'supabase registration failed' };
    }
}
/**
 * Register a video that was already uploaded via the resumable upload path.
 * Creates the metadata record, registers it in the feed, and returns the record.
 */
export async function registerStoredVideo(input) {
    const record = {
        video_id: input.videoId,
        user_id: input.userId,
        project_id: input.projectId,
        title: input.title,
        original_url: publicUrl(input.storagePath),
        storage_path: input.storagePath,
        file_size: input.fileSize,
        duration: null,
        width: null,
        height: null,
        source_codec: null,
        has_audio: false,
        status: 'uploaded',
        error: null,
        attempts: 0,
        hls_master_url: null,
        hls_master_path: null,
        renditions: [],
        thumbnail_url: null,
        poster_url: null,
        preview_blur_url: null,
        db_row_id: null,
        db_table: null,
        db_error: null,
        processing_started_at: null,
        ready_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
        marker: VIDEO_PIPELINE_MARKER,
    };
    await saveVideoRecord(record);
    void processVideo(input.videoId).catch((error) => {
        console.log(`[VideoPipeline] background processing crashed for ${input.videoId}:`, error instanceof Error ? error.message : error);
    });
    return record;
}
/* ---------------- pipeline orchestration ---------------- */
const inFlight = new Set();
const ALLOWED_EXT = new Set(['mp4', 'mov', 'm4v', 'qt']);
export function validateVideoFile(fileName, mimeType, byteLength) {
    const cfg = videoPipelineConfig();
    const maxBytes = cfg.maxUploadMb * 1024 * 1024;
    if (byteLength === 0)
        return 'Empty file.';
    if (byteLength > maxBytes)
        return `File is ${(byteLength / 1024 / 1024).toFixed(1)} MB — max allowed is ${cfg.maxUploadMb} MB (configurable via IVX_VIDEO_MAX_MB).`;
    const ext = (fileName.split('.').pop() ?? '').toLowerCase();
    const mimeOk = !mimeType || mimeType.startsWith('video/') || mimeType === 'application/octet-stream';
    if (!ALLOWED_EXT.has(ext) && !mimeOk)
        return `Unsupported format ".${ext}" — supported: MP4, MOV (H.264 / HEVC).`;
    if (!ALLOWED_EXT.has(ext) && mimeOk && !(mimeType ?? '').startsWith('video/')) {
        return `Unsupported format ".${ext}" — supported: MP4, MOV (H.264 / HEVC).`;
    }
    return null;
}
/**
 * Store the original + create the metadata record (status: uploaded), then kick
 * off background transcoding (status: processing → ready | failed).
 */
export async function createVideo(input) {
    const videoId = randomUUID();
    const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80) || 'source.mp4';
    const storagePath = `${ORIGINAL_PREFIX}/${videoId}/${safeName}`;
    await s3Put(storagePath, input.bytes, 'public, max-age=31536000, immutable');
    const record = {
        video_id: videoId,
        user_id: input.userId ?? null,
        project_id: input.projectId ?? null,
        title: input.title ?? null,
        original_url: publicUrl(storagePath),
        storage_path: storagePath,
        file_size: input.bytes.byteLength,
        duration: null,
        width: null,
        height: null,
        source_codec: null,
        has_audio: false,
        status: 'uploaded',
        error: null,
        attempts: 0,
        hls_master_url: null,
        hls_master_path: null,
        renditions: [],
        thumbnail_url: null,
        poster_url: null,
        preview_blur_url: null,
        db_row_id: null,
        db_table: null,
        db_error: null,
        processing_started_at: null,
        ready_at: null,
        created_at: nowIso(),
        updated_at: nowIso(),
        marker: VIDEO_PIPELINE_MARKER,
    };
    await saveVideoRecord(record);
    // Fire-and-forget transcode; status is tracked in the metadata record.
    void processVideo(videoId).catch((error) => {
        console.log(`[VideoPipeline] background processing crashed for ${videoId}:`, error instanceof Error ? error.message : error);
    });
    return record;
}
/** Run (or re-run) transcoding for a stored video. Never throws; records failure. */
export async function processVideo(videoId) {
    const record = await getVideoRecord(videoId);
    if (!record)
        return null;
    if (inFlight.has(videoId))
        return record;
    inFlight.add(videoId);
    record.status = 'processing';
    record.error = null;
    record.attempts += 1;
    record.processing_started_at = nowIso();
    await saveVideoRecord(record);
    const tempDir = await mkdtemp(join(tmpdir(), `ivx-src-${videoId.slice(0, 8)}-`));
    try {
        const localPath = join(tempDir, record.storage_path.split('/').pop() ?? 'source.mp4');
        const downloaded = await s3GetToFile(record.storage_path, localPath);
        if (!downloaded)
            throw new Error(`Original file missing from storage: ${record.storage_path}`);
        const probe = await probeFile(localPath);
        record.duration = probe.duration;
        record.width = probe.width;
        record.height = probe.height;
        record.source_codec = probe.videoCodec;
        record.has_audio = probe.hasAudio;
        await saveVideoRecord(record);
        const { renditions, masterKey, thumbKey, posterKey, previewBlurKey } = await transcodeToHls(videoId, localPath, probe);
        record.renditions = renditions;
        record.hls_master_path = masterKey;
        record.hls_master_url = publicUrl(masterKey);
        record.thumbnail_url = publicUrl(thumbKey);
        record.poster_url = publicUrl(posterKey);
        record.preview_blur_url = previewBlurKey ? publicUrl(previewBlurKey) : null;
        record.status = 'ready';
        record.ready_at = nowIso();
        const feed = await registerInFeed(record);
        record.db_row_id = feed.rowId;
        record.db_table = feed.rowId ? 'project_videos' : null;
        record.db_error = feed.error;
        await saveVideoRecord(record);
        // Best-effort CDN invalidation so the fresh playlists serve immediately.
        void import('./ivx-cloudfront-invalidation')
            .then(({ createCloudFrontInvalidation }) => createCloudFrontInvalidation({
            paths: [`/${HLS_PREFIX}/${videoId}/*`, `/${THUMB_PREFIX}/${videoId}/*`, `/${META_PREFIX}/*`],
            callerReference: `video-pipeline-${videoId}-${Date.now()}`,
        }))
            .catch(() => { });
        console.log(`[VideoPipeline] ready: ${videoId} (${renditions.length} renditions, ${record.duration}s)`);
        return record;
    }
    catch (error) {
        record.status = 'failed';
        record.error = (error instanceof Error ? error.message : 'transcoding failed').slice(0, 600);
        await saveVideoRecord(record).catch(() => { });
        console.log(`[VideoPipeline] FAILED ${videoId}: ${record.error}`);
        return record;
    }
    finally {
        inFlight.delete(videoId);
        await rm(tempDir, { recursive: true, force: true }).catch(() => { });
    }
}
/**
 * Detect jobs killed mid-transcode. This is a single-instance service, so a
 * record stuck in `processing` that is NOT in this process's in-flight set
 * (with a grace window for deploy overlap) can only mean the previous runtime
 * died (OOM/deploy). Mark it failed with the exact cause so retry works.
 */
export async function reconcileVideoRecord(record) {
    if (record.status !== 'processing')
        return record;
    if (inFlight.has(record.video_id))
        return record;
    const started = record.processing_started_at ? Date.parse(record.processing_started_at) : 0;
    if (Date.now() - started < INTERRUPTED_GRACE_MS)
        return record;
    record.status = 'failed';
    record.error = INTERRUPTED_ERROR;
    await saveVideoRecord(record).catch(() => { });
    console.log(`[VideoPipeline] reconciled interrupted job ${record.video_id} → failed (retryable)`);
    return record;
}
/** Whether a record is eligible for retry (failed, or processing gone stale). */
export function canRetry(record) {
    if (record.status === 'failed')
        return { ok: true, reason: 'status is failed' };
    if (record.status === 'processing') {
        const started = record.processing_started_at ? Date.parse(record.processing_started_at) : 0;
        if (Date.now() - started > STALE_PROCESSING_MS)
            return { ok: true, reason: 'processing is stale (>25 min)' };
        return { ok: false, reason: 'still processing' };
    }
    if (record.status === 'uploaded')
        return { ok: true, reason: 'uploaded but never processed' };
    return { ok: false, reason: `status is ${record.status}` };
}
