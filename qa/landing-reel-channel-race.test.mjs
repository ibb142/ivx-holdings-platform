import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(process.env.REELS_SOURCE_FILE || 'expo/ivxholding-landing/ivx-reels.js', 'utf8');
const begin = source.indexOf('  /* ---------- feed loading ---------- */');
const end = source.indexOf('  /* ---------- slide construction ---------- */');
assert.ok(begin >= 0 && end > begin);
function fixture() {
  const pending = [], errors = [];
  const feedEl = { children: [], appendChild(el) { el.parentNode = this; this.children.push(el); }, removeChild(el) { this.children = this.children.filter(x => x !== el); el.parentNode = null; } };
  Object.defineProperty(feedEl, 'innerHTML', { set() { for (const el of this.children) el.parentNode = null; this.children = []; } });
  const state = { channel: '', loading: false, done: false, cursor: null, videos: {} };
  const context = vm.createContext({ state, feedEl, VIEWER: 'isolated-viewer', encodeURIComponent, URL,
    API_CANDIDATES: ['https://api.ivxholding.com'], window: {},
    deactivateCurrent() {}, observeSlides() {}, toast() {},
    document: { createElement: () => ({ querySelector: () => ({ addEventListener() {} }) }) },
    buildSlide: video => ({ video }), console: { error: (...args) => errors.push(args) }
  });
  vm.runInContext(source.slice(begin, end), context);
  context.apiFetchJson = path => new Promise((resolve, reject) => pending.push({ path, resolve, reject }));
  return { context, state, pending, errors, feedEl };
}
async function settle() { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); }
const videos = (id, next_cursor = null) => ({ videos: [{ id, title: id }], next_cursor });

test('switching channels starts its request and ignores the older successful response', async () => {
  const f = fixture();
  f.context.loadMore();
  f.state.channel = '__reels'; f.context.resetFeed(); f.context.loadMore();
  assert.equal(f.pending.length, 2, 'The new channel must load while the old request is pending');
  assert.match(f.pending[1].path, /type=reel/);
  f.pending[1].resolve(videos('current')); await settle();
  f.pending[0].resolve(videos('stale', 'old-cursor')); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['current']);
  assert.equal(f.state.cursor, null);
  assert.equal(f.state.loading, false);
});

test('an old failure cannot finish or overwrite the new loading state', async () => {
  const f = fixture();
  f.context.loadMore();
  f.state.channel = 'investor'; f.context.resetFeed(); f.context.loadMore();
  assert.equal(f.pending.length, 2);
  f.pending[0].reject(new Error('obsolete request failed')); await settle();
  assert.equal(f.state.loading, true);
  assert.deepEqual(f.errors, []);
  f.pending[1].resolve(videos('investor')); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['investor']);
});

test('a late fallback from an old channel is also ignored', async () => {
  const f = fixture();
  f.state.channel = '__reels'; f.context.loadMore();
  f.pending[0].resolve({ videos: [] }); await settle();
  assert.equal(f.pending.length, 2);
  f.state.channel = 'buyer'; f.context.resetFeed(); f.context.loadMore();
  assert.equal(f.pending.length, 3);
  f.pending[2].resolve(videos('buyer')); await settle();
  f.pending[1].resolve(videos('stale-fallback')); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['buyer']);
});

test('concurrent pagination in the same channel still shares the active request', async () => {
  const f = fixture();
  f.context.loadMore(); f.context.loadMore();
  assert.equal(f.pending.length, 1);
  f.pending[0].resolve(videos('single')); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['single']);
});

const publicFeed = () => ({
  videos: ['one', 'two'].map(id => ({ id, title: id, video_type: 'reel',
    video_url: 'https://ivxholding.com/' + id + '.mp4', viewer_liked: false, viewer_saved: false })),
  next_cursor: null, total: 2, channel: null, personalized: false,
  feed_type: 'unified', ordering: 'canonical-unified-v2',
});

test('a transient personalized feed failure recovers the same public Reels scope with unknown viewer state', async () => {
  const f = fixture();
  f.state.channel = '__reels'; f.context.loadMore();
  f.pending[0].reject(new Error('upstream timeout')); await settle();
  assert.equal(f.pending.length, 2);
  assert.equal(f.pending[1].path, '/api/reels?limit=6&type=reel');
  const data = { ...publicFeed(), feed_type: 'reel' };
  f.pending[1].resolve(data); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.video_url), data.videos.map(x => x.video_url));
  assert.equal(f.state.videos.one.viewer_state_available, false);
  assert.equal(f.state.videos.one.viewer_liked, undefined, 'Public data must not assert the current viewer has not liked a reel');
  assert.equal(data.videos[0].viewer_liked, false, 'Recovery must not mutate the source response');
  assert.equal(f.state.done, true);
});

test('Project Reels recovery requests its public rail when the homepage snapshot contains deal videos', async () => {
  const f = fixture();
  const homepage = publicFeed();
  homepage.videos.forEach(video => { video.video_type = 'deal'; });
  f.context.window.__ivxPublicReels = { at: Date.now(), data: homepage };
  f.state.channel = '__reels'; f.context.loadMore();
  f.pending[0].reject(new Error('viewer query timed out')); await settle();
  assert.equal(f.pending[1].path, '/api/reels?limit=6&type=reel');
  assert.deepEqual(Object.keys(f.state.videos), [], 'An unrelated homepage catalog must not enter the requested rail');
  const rail = { ...publicFeed(), feed_type: 'reel' };
  rail.videos.forEach(video => { video.viewer_liked = true; video.viewer_following_creator = true; });
  f.pending[1].resolve(rail); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['one', 'two']);
  assert.equal(f.state.videos.one.viewer_liked, undefined);
  assert.equal(f.state.videos.one.viewer_following_creator, undefined);
  assert.equal(f.state.videos.one.viewer_state_available, false);
  assert.equal(rail.videos[0].viewer_liked, true, 'Shared source data must stay unchanged');
});

test('a matching public Reels rail preserves its cursor', async () => {
  const f = fixture();
  f.state.channel = '__reels'; f.context.loadMore();
  f.pending[0].reject(new Error('viewer query timed out')); await settle();
  const rail = { ...publicFeed(), feed_type: 'reel', next_cursor: 'page-two', total: 10 };
  f.pending[1].resolve(rail); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['one', 'two']);
  assert.equal(f.state.cursor, 'page-two');
  assert.equal(f.state.done, false);
  f.context.loadMore();
  const next = new URL(f.pending[2].path, 'https://api.ivxholding.com');
  assert.equal(next.searchParams.get('type'), 'reel');
  assert.equal(next.searchParams.get('cursor'), 'page-two');
  f.pending[2].resolve(videos('three')); await settle();
});

test('matching public rail recovery rejects unavailable, private and mismatched responses', async () => {
  for (const fields of [{ degraded: true }, { data_available: false }, { code: 'PUBLIC_DATA_UNAVAILABLE' },
    { personalized: true }, { channel: 'buyer' }, { feed_type: 'unified' }, { ordering: 'other' }, { videos: [] }]) {
    const f = fixture();
    f.state.channel = '__reels'; f.context.loadMore();
    f.pending[0].reject(new Error('timeout')); await settle();
    f.pending[1].resolve({ ...publicFeed(), feed_type: 'reel', ...fields }); await settle();
    assert.deepEqual(Object.keys(f.state.videos), [], JSON.stringify(fields));
    assert.equal(f.state.loading, false);
    assert.equal(f.errors.length, 1);
  }
});

test('a matching public rail arriving after a channel switch cannot replace the current videos', async () => {
  const f = fixture();
  f.state.channel = '__reels'; f.context.loadMore();
  f.pending[0].reject(new Error('timeout')); await settle();
  f.state.channel = 'buyer'; f.context.resetFeed(); f.context.loadMore();
  f.pending[2].resolve(videos('buyer')); await settle();
  f.pending[1].resolve({ ...publicFeed(), feed_type: 'reel' }); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['buyer']);
  assert.equal(f.state.loading, false);
});

test('anonymous Reels recovery preserves the requested page size and its pagination', async () => {
  const f = fixture();
  const loading = f.context.fetchFeedPage('/api/reels?limit=2&viewer_id=isolated-viewer&type=reel', () => true);
  f.pending[0].reject(new Error('viewer state unavailable')); await settle();
  assert.equal(f.pending[1].path, '/api/reels?limit=2&type=reel');
  f.pending[1].resolve({ ...publicFeed(), feed_type: 'reel', total: 4, next_cursor: 'next-reel-page' });
  const data = await loading;
  assert.equal(data.videos.length, 2);
  assert.equal(data.next_cursor, 'next-reel-page');
  assert.equal(data.viewer_state_available, false);
});

test('a scoped Reels fallback still rejects a deal video', async () => {
  const f = fixture();
  f.state.channel = '__reels'; f.context.loadMore();
  f.pending[0].reject(new Error('viewer state unavailable')); await settle();
  const data = { ...publicFeed(), feed_type: 'reel' };
  data.videos[0].video_type = 'deal';
  f.pending[1].resolve(data); await settle();
  assert.deepEqual(Object.keys(f.state.videos), []);
  assert.equal(f.state.loading, false);
});

test('public recovery cannot replace a filtered, paginated, or denied request', async () => {
  for (const args of [{ channel: 'buyer' }, { cursor: 'page-two' }, { denied: true }]) {
    const f = fixture();
    Object.assign(f.state, args); f.context.loadMore();
    const error = new Error('unavailable');
    if (args.denied) error.retryable = false;
    f.pending[0].reject(error); await settle();
    assert.equal(f.pending.length, 1);
    assert.deepEqual(Object.keys(f.state.videos), []);
    assert.equal(f.state.loading, false);
  }
});

test('Project Reels recovery rejects a mixed, incomplete, or empty public catalog', async () => {
  for (const alter of [d => { d.videos[0].video_type = 'deal'; },
    d => { d.next_cursor = 'more'; d.total = 30; }, d => { d.videos = []; d.total = 0; }]) {
    const f = fixture();
    f.state.channel = '__reels'; f.context.loadMore();
    f.pending[0].reject(new Error('timeout')); await settle();
    assert.equal(f.pending.length, 2);
    const data = publicFeed(); alter(data); f.pending[1].resolve(data); await settle();
    assert.deepEqual(Object.keys(f.state.videos), []);
    assert.equal(f.state.loading, false);
  }
});

test('a public recovery arriving after a channel switch cannot insert its videos', async () => {
  const f = fixture();
  f.context.loadMore(); f.pending[0].reject(new Error('timeout')); await settle();
  assert.equal(f.pending.length, 2);
  f.state.channel = 'buyer'; f.context.resetFeed(); f.context.loadMore();
  f.pending[2].resolve(videos('buyer')); await settle();
  f.pending[1].resolve(publicFeed()); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['buyer']);
});

test('a recent homepage catalog recovers a transient failure without another database request', async () => {
  const f = fixture();
  f.context.window.__ivxPublicReels = { at: Date.now(), data: publicFeed() };
  f.state.channel = '__reels'; f.context.loadMore();
  f.pending[0].reject(new Error('cold viewer query timed out')); await settle();
  assert.equal(f.pending.length, 1, 'Recovery must reuse the catalog already received on this page');
  assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['one', 'two']);
});

test('expired or incompatible page snapshots cannot be used for recovery', async () => {
  for (const snapshot of [{ at: Date.now() - 31000, data: publicFeed() },
    { at: Date.now(), data: { ...publicFeed(), personalized: true } },
    { at: Date.now(), data: { ...publicFeed(), degraded: true } },
    { at: Date.now(), data: { ...publicFeed(), data_available: false } }]) {
    const f = fixture();
    f.context.window.__ivxPublicReels = snapshot;
    f.context.loadMore(); f.pending[0].reject(new Error('timeout')); await settle();
    assert.equal(f.pending.length, 2, 'An unusable snapshot requires a real public API response');
    assert.deepEqual(Object.keys(f.state.videos), []);
    f.pending[1].resolve(publicFeed()); await settle();
    assert.deepEqual(f.feedEl.children.map(x => x.video?.id), ['one', 'two']);
  }
});

function transport(respond) {
  const requests = [], timers = new Map(); let timerId = 0, clock = 1000;
  const context = vm.createContext({ URL, AbortController, API: 'https://primary.example',
    Date: { now: () => clock, parse: Date.parse },
    API_CANDIDATES: ['https://primary.example', 'https://secondary.example'],
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms, at: clock + ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: (url, options) => { requests.push({ url, options }); return Promise.resolve(respond(url, options)); },
  });
  vm.runInContext(source.slice(begin, end), context);
  return { context, requests, timers, advance(ms) {
    clock += ms;
    for (const [id, timer] of timers) if (timer.at <= clock) { timers.delete(id); timer.fn(); }
  } };
}

test('a degraded reel response waits for Retry-After before using the second host', async () => {
  for (const status of [200, 503, 429]) {
    const f = transport(url => ({ ok: url.includes('secondary') || status === 200, status,
      headers: { get: () => '3' }, text: async () => JSON.stringify(
        url.includes('primary') ? { videos: [], degraded: true } : publicFeed()) }));
    const pending = f.context.apiFetchJson('/api/reels', 0, 4000);
    await settle(); assert.equal(f.requests.length, 1);
    f.advance(2999); await settle(); assert.equal(f.requests.length, 1);
    f.advance(1); const result = await pending;
    assert.equal(result.videos.length, 2);
    assert.equal(f.requests.length, 2);
    assert.equal(f.context.API, 'https://secondary.example');
    assert.equal(f.timers.size, 0);
  }
});

test('reel Retry-After cannot exceed the combined existing host budgets', async () => {
  const f = transport(() => ({ ok: false, status: 503, headers: { get: () => '60' } }));
  await assert.rejects(f.context.apiFetchJson('/api/reels', 0, 4000), /503/);
  assert.equal(f.requests.length, 1); assert.equal(f.timers.size, 0);
});

test('reel retries cannot restart after a suspended page exceeds its deadline', async () => {
  const f = transport(() => ({ ok: false, status: 503, headers: { get: () => '3' } }));
  const pending = f.context.apiFetchJson('/api/reels', 0, 4000);
  const rejected = assert.rejects(pending);
  await settle(); f.advance(9000); await rejected;
  assert.equal(f.requests.length, 1); assert.equal(f.timers.size, 0);
});

test('feed transport does not fail over an authorization denial', async () => {
  const f = transport(() => ({ ok: false, status: 403 }));
  await assert.rejects(f.context.apiFetchJson('/api/reels', 0, 4000), /403/);
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
});

test('feed transport fails over degraded HTTP 200 before promoting a host', async () => {
  for (const flags of [{ degraded: true }, { data_available: false }, { code: 'PUBLIC_DATA_UNAVAILABLE' }]) {
    const f = transport(url => ({ ok: true, text: async () => JSON.stringify(
      url.startsWith('https://primary.example') ? { videos: [], ...flags } : publicFeed()) }));
    const result = await f.context.apiFetchJson('/api/reels', 0, 4000);
    assert.equal(result.videos.length, 2);
    assert.equal(f.requests.length, 2);
    assert.equal(f.context.API, 'https://secondary.example');
    assert.equal(f.timers.size, 0);
  }
});

test('a persistently degraded reel catalog is an error, not a completed empty page', async () => {
  const f = transport(() => ({ ok: true, text: async () => '{"videos":[],"data_available":false}' }));
  await assert.rejects(f.context.apiFetchJson('/api/reels', 0, 4000), /unavailable/i);
  assert.equal(f.requests.length, 2);
  assert.equal(f.timers.size, 0);
});

for (const [name, unavailable] of [
  ['data_available=false', () => Response.json({ videos: [], data_available: false })],
  ['unavailable code', () => Response.json({ videos: [], code: 'PUBLIC_DATA_UNAVAILABLE' })],
  ['unavailable header', () => Response.json({ videos: [] }, { headers: { 'X-IVX-Data-State': 'unavailable' } })],
]) {
  test(`Reels retries HTTP 200 with ${name} and surfaces a persistent outage`, async () => {
    const recovered = transport(url => new URL(url).hostname === 'primary.example' ? unavailable() : Response.json(publicFeed()));
    const data = await recovered.context.apiFetchJson('/api/reels', 0, 4000);
    assert.equal(recovered.requests.length, 2);
    assert.equal(data.videos.length, 2);
    assert.equal(data.videos[0].id, 'one');
    assert.equal(recovered.context.API, 'https://secondary.example');
    assert.equal(recovered.timers.size, 0);

    const outage = transport(() => unavailable());
    await assert.rejects(outage.context.apiFetchJson('/api/reels', 0, 4000), /unavailable/i);
    assert.equal(outage.requests.length, 2);
    assert.equal(outage.context.API, 'https://primary.example');
    assert.equal(outage.timers.size, 0);
  });
}

test('an available empty Reels catalog remains valid even when served stale', async () => {
  const f = transport(() => Response.json({ videos: [], data_available: true, degraded: true }));
  const data = await f.context.apiFetchJson('/api/reels', 0, 4000);
  assert.equal(data.videos.length, 0);
  assert.equal(f.requests.length, 1);
  assert.equal(f.timers.size, 0);
});

test('the feed deadline covers the response body as well as the headers', async () => {
  let finishBody;
  const f = transport(() => ({ ok: true, text: () => new Promise(resolve => { finishBody = resolve; }) }));
  const pending = f.context.apiFetchJson('/api/reels', 0, 4000);
  await settle();
  assert.equal(f.timers.size, 1, 'A stalled body must still have an active deadline');
  assert.equal([...f.timers.values()][0].ms, 4000);
  finishBody('{"videos":[]}'); await pending;
  assert.equal(f.timers.size, 0);
});
