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

test('failed feed reads distinguish safe failure kinds without exposing exception details', async () => {
  const privateDetail = 'postgres://private-user:private-password@private-host/private-db';
  const cases = [
    [new Error('owner_control_direct_postgres_project_mismatch', { cause: new Error(privateDetail) }), 'PROJECT_BINDING_REJECTED'],
    [new Error('direct_postgres_not_configured'), 'DATABASE_NOT_CONFIGURED'],
    [new Error('postgres_pool_budget_exceeded'), 'POOL_BUDGET_REJECTED'],
    [new Error('invalid_postgres_pool_limit:IVX_PG_API_MAX_CONNECTIONS'), 'POOL_LIMIT_INVALID'],
    [new Error('postgres_pool_budget_changed_restart_required'), 'POOL_RESTART_REQUIRED'],
    [new TypeError('Invalid URL'), 'CONFIG_URL_INVALID'],
    [Object.assign(new Error(privateDetail), { code: '42501' }), 'DATABASE_PERMISSION'],
    [Object.assign(new Error(privateDetail), { code: '57014' }), 'QUERY_DEADLINE'],
    [Object.assign(new Error(privateDetail), { code: '55P03' }), 'LOCK_DEADLINE'],
    [Object.assign(new Error(privateDetail), { code: 'ECONNRESET' }), 'CONNECTION_ERROR'],
    [new TypeError(privateDetail), 'RUNTIME_TYPE_ERROR'],
    [new Error('postgres_pool_budget_exceeded ' + privateDetail), 'UNKNOWN'],
    [{ message: privateDetail }, 'UNKNOWN'],
  ];
  const originalInfo = console.info;
  const logs = [];
  console.info = (...args) => { logs.push(args.join(' ')); };
  try {
    for (const [failure, expectedKind] of cases) {
      logs.length = 0;
      const f = fixture({ videos: async () => { throw failure; } });
      await assert.rejects(f.load('private-project-id'), error => error === failure);
      const entries = logs.filter(line => line.startsWith('[IVX Feed dependency] '))
        .map(line => JSON.parse(line.slice('[IVX Feed dependency] '.length)));
      const catalog = entries.find(entry => entry.dependency === 'videos');
      assert.equal(catalog.failureKind, expectedKind);
      assert.equal(catalog.outcome, 'failure');
      assert.equal(entries.find(entry => entry.dependency === 'total').failureKind, expectedKind);
      assert.equal(f.calls.filter(call => call.name === 'videos').length, 1, 'Diagnostics must not retry a failed read');
      assert.ok(entries.filter(entry => entry.outcome === 'success').every(entry => entry.failureKind === null));
      for (const secret of [privateDetail, 'private-project-id', 'private-user', 'private-password', 'private-host']) {
        assert.equal(logs.join('\n').includes(secret), false);
      }
    }
  } finally {
    console.info = originalInfo;
  }
});

test('diagnostic sink failures cannot replace the original feed failure', async () => {
  const failure = new Error('upstream rejected');
  const f = fixture({ videos: async () => { throw failure; } });
  const originalInfo = console.info;
  console.info = () => { throw new Error('logger unavailable'); };
  try {
    await assert.rejects(f.load(null), error => error === failure);
  } finally {
    console.info = originalInfo;
  }
});
