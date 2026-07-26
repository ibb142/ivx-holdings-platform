/**
 * Local smoke test for the IVX video pipeline (run from the sandbox with real
 * AWS credentials in env). Uploads a small sample, runs the full transcode,
 * prints the resulting record, and verifies the CDN URLs respond.
 *
 * Usage: bun backend/scripts/test-video-pipeline-local.ts /tmp/vptest/sample-720p.mp4
 */
import { readFile } from 'node:fs/promises';
import { createVideo, getVideoRecord } from '../services/ivx-video-pipeline';
async function main() {
    const path = process.argv[2];
    if (!path)
        throw new Error('pass a video file path');
    const bytes = new Uint8Array(await readFile(path));
    console.log(`[test] uploading ${bytes.byteLength} bytes from ${path}`);
    const record = await createVideo({
        bytes,
        fileName: path.split('/').pop() ?? 'sample.mp4',
        mimeType: 'video/mp4',
        userId: 'local-smoke-test',
        title: 'PIPELINE-SMOKE-TEST (safe to delete)',
    });
    console.log(`[test] videoId=${record.video_id} status=${record.status}`);
    console.log(`[test] original: ${record.original_url}`);
    const deadline = Date.now() + 10 * 60 * 1000;
    let latest = record;
    while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
        const next = await getVideoRecord(record.video_id);
        if (!next)
            continue;
        latest = next;
        console.log(`[test] status=${latest.status} attempts=${latest.attempts}${latest.error ? ` error=${latest.error}` : ''}`);
        if (latest.status === 'ready' || latest.status === 'failed')
            break;
    }
    console.log(JSON.stringify(latest, null, 2));
    if (latest.status !== 'ready') {
        process.exitCode = 1;
        return;
    }
    for (const url of [latest.hls_master_url, latest.thumbnail_url, latest.poster_url, ...latest.renditions.map((r) => r.playlistUrl)]) {
        if (!url)
            continue;
        const res = await fetch(`${url}?cb=${Date.now()}`);
        console.log(`[test] GET ${url} → ${res.status} ${res.headers.get('content-type')}`);
    }
}
main().catch((error) => {
    console.error('[test] FAILED:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
});
