import assert from 'node:assert/strict';
import test from 'node:test';
import { createPlatformFeedLoader } from './services/ivx-platform-feed-loader.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(overrides = {}) {
  const calls = [];
  const values = { videos: [{ id: 'video-1', title: 'Original' }], meta: { 'video-1': { published: true } },
    counts: { 'video-1': { likes: 2 } }, playback: {}, analytics: { videos: {} }, deals: [{ id: 'deal-1' }], mediaCandidates: new Set(['video-1']) };
  const sources = Object.fromEntries(Object.entries(values).map(([name, value]) => [name, async (...args) => {
    calls.push({ name, args });
    return overrides[name] ? overrides[name](...args) : structuredClone(value);
  }]));
  return { calls, values, load: createPlatformFeedLoader(sources, 2) };
}

test('independent documents and deals start while the catalog is still pending', async () => {
  const catalog = deferred(), metadata = deferred(), counts = deferred();
  const f = fixture({ videos: () => catalog.promise, meta: () => metadata.promise, counts: () => counts.promise });
  const result = f.load(null);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.map(c => c.name).sort(), ['videos', 'meta', 'playback', 'analytics', 'deals'].sort());
  catalog.resolve(f.values.videos);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(f.calls.find(c => c.name === 'counts').args, [['video-1']]);
  metadata.resolve(f.values.meta);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.filter(c => c.name === 'mediaCandidates').length, 1, 'Media candidate selection overlaps the pending count query');
  counts.resolve(f.values.counts);
  assert.deepEqual(await result, f.values);
});

test('a burst of viewer requests shares the public catalog but receives independent snapshots', async () => {
  const gate = deferred();
  const f = fixture({ videos: () => gate.promise });
  const requests = Array.from({ length: 30 }, () => f.load(null));
  gate.resolve(f.values.videos);
  const rows = await Promise.all(requests);
  for (const name of Object.keys(f.values)) assert.equal(f.calls.filter(c => c.name === name).length, 1);
  rows[0].meta['video-1'].published = false;
  rows[0].mediaCandidates.clear();
  rows[0].counts['video-1'].likes = 0;
  assert.equal(rows[1].meta['video-1'].published, true);
  assert.equal(rows[1].mediaCandidates.has('video-1'), true);
  assert.equal(rows[1].counts['video-1'].likes, 2);
});

test('settled data is never reused after a publication or count change', async () => {
  const f = fixture();
  await f.load(null);
  f.values.meta['video-1'].published = false;
  f.values.counts['video-1'].likes = 3;
  const next = await f.load(null);
  assert.equal(next.meta['video-1'].published, false);
  assert.equal(next.counts['video-1'].likes, 3);
  assert.equal(f.calls.filter(c => c.name === 'videos').length, 2);
});

test('project scopes cannot share or inherit another catalog', async () => {
  const f = fixture({ videos: async id => [{ id: String(id), scope: id }] });
  const [all, scoped] = await Promise.all([f.load(null), f.load('null')]);
  assert.equal(all.videos[0].scope, null);
  assert.equal(scoped.videos[0].scope, 'null');
  assert.equal(f.calls.filter(c => c.name === 'videos').length, 2);
});

test('a failed source keeps pending work shared, returns the real failure and permits a fresh recovery', async () => {
  const metadata = deferred(), catalog = deferred();
  const failure = new Error('upstream unavailable');
  let recovered = false;
  const f = fixture({ meta: () => recovered ? Promise.resolve(f.values.meta) : metadata.promise, videos: () => catalog.promise });
  const first = f.load(null), rejected = assert.rejects(first, error => error === failure);
  metadata.reject(failure);
  await new Promise(resolve => setImmediate(resolve));
  const second = f.load(null), secondRejected = assert.rejects(second, error => error === failure);
  assert.equal(f.calls.filter(c => c.name === 'videos').length, 1);
  catalog.resolve(f.values.videos);
  await Promise.all([rejected, secondRejected]);
  recovered = true;
  assert.deepEqual(await f.load(null), f.values);
  assert.equal(f.calls.filter(c => c.name === 'videos').length, 2);
});

test('bounded pending scopes allow same-scope followers and release capacity when reads finish', async () => {
  const gate = deferred();
  const f = fixture({ videos: () => gate.promise });
  const first = f.load('one'), second = f.load('two'), follower = f.load('one');
  await assert.rejects(f.load('three'), /capacity exceeded/);
  gate.resolve(f.values.videos);
  await Promise.all([first, second, follower]);
  await f.load('three');
  assert.equal(f.calls.filter(c => c.name === 'videos').length, 3);
});
