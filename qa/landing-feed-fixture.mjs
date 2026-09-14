// Browser-only synthetic catalog. Never imported by the app or API.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const FIXTURE_SCOPE = 'isolated-synthetic-feed';
const apiOrigins = new Set(['https://api.ivxholding.com', 'https://ivx-holdings-platform.onrender.com']);
const mediaOrigin = 'https://ivxholding.com';
const mediaPath = '/qa-synthetic-feed.mp4';

export function fixtureCatalog() {
  const deals = Array.from({ length: 3 }, (_, i) => ({
    id: `qa-deal-${i + 1}`, name: `Synthetic QA project ${i + 1}`, title: `Synthetic QA project ${i + 1}`,
    city: 'QA fixture', status: 'active', deal_type: 'jv', url: `${mediaOrigin}/?deal=qa-deal-${i + 1}`,
  }));
  const videos = deals.slice(0, 2).map((deal, i) => ({
    id: `qa-video-${i + 1}`, project_id: deal.id, property_id: deal.id,
    title: deal.title, video_url: `${mediaOrigin}${mediaPath}?clip=${i + 1}`,
    video_type: 'reel', is_featured: true, is_pinned: true, is_approved: true,
    duration_sec: 4, width: 360, height: 640, orientation: 'portrait',
    created_at: '2026-01-01T00:00:00Z', like_count: 0, comment_count: 0,
    share_count: 0, save_count: 0, view_count: 0, deal,
  }));
  return { videos, blocks: [...deals.map(deal => ({ type: 'deal', deal })), { type: 'video', video: videos[0] }] };
}

export async function createFixtureMedia() {
  const directory = await mkdtemp(path.join(tmpdir(), 'ivx-qa-feed-'));
  try {
    const file = path.join(directory, 'synthetic.mp4');
    // A moving test pattern with silent AAC exercises real H.264 decoding.
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=15',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '4', '-c:v', 'libx264',
      '-preset', 'ultrafast', '-crf', '32', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', file]);
    return await readFile(file);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

export async function installLandingFeedFixture(context, previewSource, media) {
  assert.ok(previewSource, 'Synthetic feed requires an explicit local PR preview');
  const preview = new URL(previewSource);
  assert.equal(preview.origin, 'http://127.0.0.1:4175', 'Synthetic feed is restricted to the local QA preview');
  assert.ok(Buffer.isBuffer(media) && media.length > 0, 'Synthetic media bytes are required');
  const { videos, blocks } = fixtureCatalog();
  const headers = { 'access-control-allow-origin': mediaOrigin, 'cache-control': 'no-store', 'x-ivx-qa-fixture': FIXTURE_SCOPE };
  await context.route(url => url.origin === mediaOrigin && url.pathname === mediaPath, route =>
    route.fulfill({ status: 200, headers: { ...headers, 'content-type': 'video/mp4' }, body: media }));
  await context.route(url => apiOrigins.has(url.origin), async route => {
    const request = route.request(), url = new URL(request.url());
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...headers,
      'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS', 'access-control-allow-headers': 'content-type' } });
    // Engagement is handled by the existing page-level interaction fixture.
    // Discard synthetic view telemetry locally; never write it to production.
    if (!['GET', 'HEAD'].includes(request.method())) {
      if (url.pathname === '/api/ivx/video-platform/events') return route.fulfill({ status: 204, headers });
      return route.abort('blockedbyclient');
    }
    let data;
    if (['/api/reels', '/api/ivx/videos/feed', '/api/ivx/video-platform/feed'].includes(url.pathname)) {
      data = { videos, count: videos.length, total: videos.length, next_cursor: null };
    } else if (url.pathname === '/api/ivx/video-platform/home-feed') {
      data = { blocks, count: blocks.length, deal_count: 3, video_count: 1, ordering: 'canonical-home-v3' };
    } else return route.fallback();
    return route.fulfill({ status: 200, headers, contentType: 'application/json',
      body: JSON.stringify({ ...data, data_available: true, qa_fixture: FIXTURE_SCOPE }) });
  });
}
