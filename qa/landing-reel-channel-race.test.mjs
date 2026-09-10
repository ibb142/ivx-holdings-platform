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
  const context = vm.createContext({ state, feedEl, VIEWER: 'isolated-viewer', encodeURIComponent,
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
