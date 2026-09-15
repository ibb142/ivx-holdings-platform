import assert from 'node:assert/strict';
import test from 'node:test';
import { PRODUCTION_REELS_URL, verifyProductionFeed } from './production-feed-check.mjs';

const videos = [{ id: 'reel-1', video_url: 'https://example.test/reel.mp4' }];
const healthy = { videos, count: 1 };
for (const [name, body, reason] of [
  ['degraded HTTP 200', { videos: [], count: 0, degraded: true }, 'FEED_DEGRADED'],
  ['unavailable data', { ...healthy, data_available: false }, 'FEED_DEGRADED'],
  ['empty feed', { videos: [], count: 0 }, 'FEED_EMPTY'],
  ['wrong results contract', { results: videos, count: 1 }, 'FEED_INVALID_SCHEMA'],
  ['inconsistent count', { videos, count: 2 }, 'FEED_INVALID_SCHEMA'],
  ['missing video identity', { videos: [{}], count: 1 }, 'FEED_INVALID_SCHEMA'],
  ['non-object JSON', null, 'FEED_INVALID_SCHEMA'],
]) test(`${name} blocks readiness`, async () => {
  const result = await verifyProductionFeed({ fetchImpl: async () => Response.json(body) });
  assert.deepEqual(result, { isValid: false, reason, data: [] });
});
test('uses the actual public Reels endpoint and returns the validated videos', async () => {
  let calls = 0;
  const signal = new AbortController().signal;
  const result = await verifyProductionFeed({ signal, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, PRODUCTION_REELS_URL);
    assert.equal(url, 'https://api.ivxholding.com/api/reels?channel=reel');
    assert.equal(options.signal, signal); assert.equal(options.cache, 'no-store');
    return Response.json(healthy);
  } });
  assert.equal(calls, 1); assert.deepEqual(result, { isValid: true, data: videos });
});
for (const state of ['unavailable', 'stale']) test(`${state} response headers cannot be masked by a healthy body`, async () => {
  const result = await verifyProductionFeed({ fetchImpl: async () => Response.json(healthy, { headers: { 'X-IVX-Data-State': state } }) });
  assert.equal(result.isValid, false); assert.equal(result.reason, `FEED_${state.toUpperCase()}`);
});
test('HTTP errors, non-JSON and network failures preserve failure state', async () => {
  for (const [fetchImpl, reason] of [
    [async () => Response.json(healthy, { status: 503 }), 'FEED_HTTP_503'],
    [async () => new Response('<html>error</html>'), 'FEED_INVALID_JSON'],
    [async () => { throw new Error('private upstream detail'); }, 'FEED_UNREACHABLE'],
  ]) {
    assert.deepEqual(await verifyProductionFeed({ fetchImpl }), { isValid: false, reason, data: [] });
  }
});
test('a transport abort is rejected without retry or a database probe', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  const result = await verifyProductionFeed({ signal: controller.signal, fetchImpl: async (_url, { signal }) => {
    calls++; signal.throwIfAborted();
  } });
  assert.equal(calls, 1); assert.deepEqual(result, { isValid: false, reason: 'FEED_TIMEOUT', data: [] });
});
