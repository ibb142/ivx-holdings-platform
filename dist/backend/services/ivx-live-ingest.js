/**
 * IVX Live Streaming Ingest — HTTP push ingestion → live HLS.
 *
 * The browser/mobile client captures the camera (getUserMedia + MediaRecorder,
 * restarted every ~3s so each blob is a self-contained WebM/MP4), then POSTs
 * each blob to /live/:sessionId/ingest?seq=N. The server transcodes every blob
 * to an H.264/AAC MPEG-TS segment, appends it to a rolling EVENT playlist in
 * S3, and viewers play the stream through the standard HLS pipeline (hls.js /
 * native Safari) via the session's playback_url.
 *
 * This is real live ingestion over HTTPS (same transport class Instagram Live
 * web uses). Classic RTMP ingest requires a socket-level media server which a
 * Render web service cannot host — the API accepts an external RTMP-derived
 * HLS playback_url for that case.
 *
 * Storage layout:
 *   videos/live/{sessionId}/seg_{N}.ts    — live segments
 *   videos/live/{sessionId}/index.m3u8    — EVENT playlist (ENDLIST on stop)
 */
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
export const LIVE_INGEST_MARKER = 'ivx-live-ingest-v1-2026-07-03';
const LIVE_PREFIX = 'videos/live';
const SEGMENT_TRANSCODE_TIMEOUT_MS = 60_000;
const MAX_CHUNK_BYTES = 24 * 1024 * 1024;
function env(name) {
    const value = process.env[name];
    return typeof value === 'string' ? value.trim() : '';
}
function bucket() {
    return env('S3_BUCKET_NAME') || 'ivxholding.com';
}
function publicBase() {
    return (env('IVX_VIDEO_CDN_BASE') || 'https://ivxholding.com').replace(/\/+$/, '');
}
let _s3 = null;
async function getS3() {
    if (_s3)
        return _s3;
    const { S3Client } = await import('@aws-sdk/client-s3');
    const accessKeyId = env('AWS_ACCESS_KEY_ID');
    const secretAccessKey = env('AWS_SECRET_ACCESS_KEY');
    if (!accessKeyId || !secretAccessKey)
        throw new Error('AWS credentials missing on runtime.');
    _s3 = new S3Client({ region: env('AWS_REGION') || 'us-east-1', credentials: { accessKeyId, secretAccessKey } });
    return _s3;
}
async function s3Put(key, body, contentType, cacheControl) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await getS3();
    await s3.send(new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body),
        ContentType: contentType,
        CacheControl: cacheControl,
    }));
}
const playlistDocKey = (sessionId) => `${LIVE_PREFIX}/${sessionId}/state.json`;
const playlistKey = (sessionId) => `${LIVE_PREFIX}/${sessionId}/index.m3u8`;
async function readState(sessionId) {
    try {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = await getS3();
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: playlistDocKey(sessionId) }));
        const bytes = await res.Body?.transformToByteArray();
        if (bytes)
            return JSON.parse(Buffer.from(bytes).toString('utf-8'));
    }
    catch {
        // new session
    }
    return { sessionId, segments: [], targetDuration: 4, ended: false, updated_at: new Date().toISOString() };
}
function renderPlaylist(state) {
    const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        `#EXT-X-TARGETDURATION:${Math.max(1, Math.ceil(state.targetDuration))}`,
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:EVENT',
    ];
    for (const seg of state.segments) {
        lines.push(`#EXTINF:${seg.duration.toFixed(3)},`);
        lines.push(`seg_${seg.seq}.ts`);
    }
    if (state.ended)
        lines.push('#EXT-X-ENDLIST');
    lines.push('');
    return lines.join('\n');
}
async function persistState(state) {
    state.updated_at = new Date().toISOString();
    await s3Put(playlistDocKey(state.sessionId), JSON.stringify(state), 'application/json', 'no-cache');
    await s3Put(playlistKey(state.sessionId), renderPlaylist(state), 'application/vnd.apple.mpegurl', 'no-cache');
}
/* ---------------- ffmpeg chunk → TS segment ---------------- */
function runProc(bin, args, timeoutMs) {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        let stdout = '';
        const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error(`${bin} timed out`)); }, timeoutMs);
        child.stdout?.on('data', (c) => { stdout += c.toString('utf8'); });
        child.stderr?.on('data', (c) => { stderr += c.toString('utf8'); if (stderr.length > 12_000)
            stderr = stderr.slice(-6_000); });
        child.on('error', (error) => { clearTimeout(timer); reject(error); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, stderr, stdout }); });
    });
}
const ffmpegBin = () => env('IVX_FFMPEG_PATH') || 'ffmpeg';
const ffprobeBin = () => env('IVX_FFPROBE_PATH') || 'ffprobe';
/**
 * Ingest one self-contained media blob as live segment `seq`.
 * Transcodes to 720p H.264/AAC TS (ultrafast, single thread) and appends to
 * the session's EVENT playlist.
 */
export async function ingestLiveChunk(sessionId, seq, bytes) {
    const safeSession = sessionId.replace(/[^a-zA-Z0-9-]/g, '');
    if (!safeSession)
        throw new Error('Invalid session id.');
    if (!Number.isInteger(seq) || seq < 0 || seq > 100_000)
        throw new Error('seq must be a non-negative integer.');
    if (bytes.byteLength === 0)
        throw new Error('Empty chunk.');
    if (bytes.byteLength > MAX_CHUNK_BYTES)
        throw new Error(`Chunk too large (max ${MAX_CHUNK_BYTES} bytes).`);
    const workDir = await mkdtemp(join(tmpdir(), `ivx-live-${safeSession.slice(0, 8)}-`));
    try {
        const inPath = join(workDir, 'chunk.bin');
        const outPath = join(workDir, `seg_${seq}.ts`);
        await writeFile(inPath, Buffer.from(bytes));
        const res = await runProc(ffmpegBin(), [
            '-hide_banner', '-loglevel', 'error', '-y',
            '-i', inPath,
            '-vf', 'scale=-2:min(720\\,ih)',
            '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1',
            '-x264-params', 'ref=1:rc-lookahead=4:bframes=0',
            '-b:v', '2500k', '-maxrate', '3000k', '-bufsize', '5000k',
            '-pix_fmt', 'yuv420p', '-g', '48', '-sc_threshold', '0',
            '-c:a', 'aac', '-b:a', '96k', '-ac', '2', '-ar', '44100',
            '-f', 'mpegts', outPath,
        ], SEGMENT_TRANSCODE_TIMEOUT_MS);
        if (res.code !== 0)
            throw new Error(`live chunk transcode failed: ${res.stderr.slice(0, 300)}`);
        const probe = await runProc(ffprobeBin(), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', outPath], 15_000);
        const duration = Math.max(0.5, Number.parseFloat(probe.stdout.trim()) || 3);
        const segKey = `${LIVE_PREFIX}/${safeSession}/seg_${seq}.ts`;
        await s3Put(segKey, new Uint8Array(await readFile(outPath)), 'video/MP2T', 'public, max-age=60');
        const state = await readState(safeSession);
        if (state.ended)
            throw new Error('Live session already ended.');
        if (!state.segments.some((s) => s.seq === seq)) {
            state.segments.push({ seq, duration });
            state.segments.sort((a, b) => a.seq - b.seq);
        }
        state.targetDuration = Math.max(state.targetDuration, duration);
        await persistState(state);
        return {
            session_id: safeSession,
            seq,
            segment_url: `${publicBase()}/${segKey}`,
            segment_duration: duration,
            playlist_url: `${publicBase()}/${playlistKey(safeSession)}`,
            segment_count: state.segments.length,
            marker: LIVE_INGEST_MARKER,
        };
    }
    finally {
        await rm(workDir, { recursive: true, force: true }).catch(() => { });
    }
}
/** Playback URL for a session's live playlist (exists once the first chunk lands). */
export function livePlaybackUrl(sessionId) {
    return `${publicBase()}/${playlistKey(sessionId.replace(/[^a-zA-Z0-9-]/g, ''))}`;
}
/** Close the live playlist (append ENDLIST) so players end cleanly. */
export async function finalizeLivePlaylist(sessionId) {
    const safeSession = sessionId.replace(/[^a-zA-Z0-9-]/g, '');
    if (!safeSession)
        return null;
    const state = await readState(safeSession);
    if (state.segments.length === 0)
        return null;
    state.ended = true;
    await persistState(state);
    return { segment_count: state.segments.length };
}
