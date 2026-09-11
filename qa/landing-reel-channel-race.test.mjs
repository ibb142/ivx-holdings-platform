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

test('a transient personalized feed failure recovers actual public reels with unknown viewer state', async () => {
  const f = fixture();
  f.state.channel = '__reels'; f.context.loadMore();
  f.pending[0].reject(new Error('upstream timeout')); await settle();
  assert.equal(f.pending.length, 2);
  assert.equal(f.pending[1].path, '/api/reels');
  const data = publicFeed();
  f.pending[1].resolve(data); await settle();
  assert.deepEqual(f.feedEl.children.map(x => x.video?.video_url), data.videos.map(x => x.video_url));
  assert.equal(f.state.videos.one.viewer_state_available, false);
  assert.equal(f.state.videos.one.viewer_liked, undefined, 'Public data must not assert the current viewer has not liked a reel');
  assert.equal(data.videos[0].viewer_liked, false, 'Recovery must not mutate the source response');
  assert.equal(f.state.done, true);
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
    { at: Date.now(), data: { ...publicFeed(), personalized: true } }]) {
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
  const requests = [], timers = new Map(); let timerId = 0;
  const context = vm.createContext({ URL, AbortController, API: 'https://primary.example',
    API_CANDIDATES: ['https://primary.example', 'https://secondary.example'],
    setTimeout: (fn, ms) => { timers.set(++timerId, { fn, ms }); return timerId; },
    clearTimeout: id => timers.delete(id),
    fetch: (url, options) => { requests.push({ url, options }); return Promise.resolve(respond(url, options)); },
  });
  vm.runInContext(source.slice(begin, end), context);
  return { context, requests, timers };
}

test('feed transport does not fail over an authorization denial', async () => {
  const f = transport(() => ({ ok: false, status: 403 }));
  await assert.rejects(f.context.apiFetchJson('/api/reels', 0, 4000), /403/);
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
