import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
for (const surface of ['reels', 'home-feed']) {
  const source = readFileSync(new URL(`../expo/ivxholding-landing/ivx-${surface}.js`, import.meta.url), 'utf8');
  const start = source.indexOf('  function loadDeferredAnalytics(');
  const end = source.indexOf('\n  function ', start + 3);
  const make = new Function('fetch', 'setTimeout', 'clearTimeout', 'AbortController', 'API', 'API_CANDIDATES', source.slice(start, end) + ';return loadDeferredAnalytics;');
  const tick = () => new Promise(resolve => setImmediate(resolve));
  const timer = (fn, ms) => { if (ms === 0) queueMicrotask(fn); return 1; };
  test(`${surface}: analytics starts after render and hydrates counters without blocking`, async () => {
    let resolve, calls = 0;
    const pending = new Promise(r => { resolve = r; });
    const load = make(() => { calls++; return pending; }, timer, () => {}, AbortController, 'https://example.test', ['https://example.test']);
    const videos = [{ id: 'a', view_count: null, analytics_status: 'deferred' }];
    assert.equal(load(videos, () => true), undefined); assert.equal(calls, 0);
    await tick(); assert.equal(calls, 1); assert.equal(videos[0].view_count, null);
    resolve(Response.json({ videos: [{ id: 'a', view_count: 12 }] })); await tick();
    assert.equal(videos[0].view_count, 12); assert.equal(videos[0].analytics_status, 'ready');
  });
  for (const status of [503, 200]) test(`${surface}: unavailable analytics (HTTP ${status}) cannot fail the already-rendered feed`, async () => {
    const load = make(async () => Response.json({ videos: [], degraded: true, data_available: false }, { status }), timer, () => {}, AbortController, 'https://example.test', ['https://example.test']);
    const videos = [{ id: 'a', analytics_status: 'deferred' }];
    load(videos, () => true); await tick();
    assert.equal(videos[0].analytics_status, 'unavailable'); assert.equal(videos.length, 1);
  });
  test(`${surface}: navigation cancels stale hydration`, async () => {
    let calls = 0;
    const load = make(async () => { calls++; }, timer, () => {}, AbortController, 'https://example.test', ['https://example.test']);
    load([{ id: 'a', analytics_status: 'deferred' }], () => false); await tick(); assert.equal(calls, 0);
  });
}
