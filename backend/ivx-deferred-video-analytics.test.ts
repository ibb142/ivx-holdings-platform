import { expect, test } from 'bun:test';

async function fixture(code: string, timeout = 10000) {
  const child = Bun.spawn([process.execPath, '-e', code], {
    cwd: new URL('../', import.meta.url).pathname,
    stdout: 'pipe', stderr: 'pipe', timeout,
  });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect(exitCode, stderr).toBe(0);
}

const setup = `
  import assert from 'node:assert/strict';
  import { mock } from 'bun:test';
  import { newReadTimings, readTimings } from './backend/services/ivx-read-timings';
  const a = '00000000-0000-4000-8000-00000000000a';
  const hidden = '00000000-0000-4000-8000-00000000000b';
  let queryCalls = 0, analyticsCalls = 0, visible = true, requestedIds;
  let catalogRead = async () => ({ data: [{ id: a }, { id: hidden }], error: null });
  let metaRead = async () => ({ [a]: { status: visible ? 'published' : 'draft' }, [hidden]: { status: 'draft' } });
  let analyticsRead = async () => ({ videos: { [a]: { views: 12, viewer_ids: ['private-viewer'], watch_ms: 10 } }, history: { private: [] } });
  mock.module('@supabase/supabase-js', () => ({ createClient: () => ({ from: table => {
    assert.equal(table, 'project_videos');
    const q = {
      select: columns => { assert.equal(columns, 'id'); return q; },
      in: (column, ids) => { assert.equal(column, 'id'); requestedIds = ids; return q; },
      eq: (column, value) => { assert.equal(column, 'is_approved'); assert.equal(value, true); return q; },
      then: (resolve, reject) => {
        queryCalls++;
        return Promise.resolve().then(catalogRead).then(resolve, reject);
      },
    };
    return q;
  } }) }));
  const real = await import('./backend/services/ivx-video-platform-store');
  mock.module('./backend/services/ivx-video-platform-store', () => ({ ...real,
    getMetaDoc: () => metaRead(),
    getAnalyticsDoc: async () => { analyticsCalls++; return analyticsRead(); },
  }));
  const { handleDeferredVideoAnalytics, deferredAnalyticsUnavailable } = await import('./backend/api/ivx-video-platform');
  const read = (ids, headers) => handleDeferredVideoAnalytics(new Request('https://example.test/api/videos/analytics?ids=' + ids, { headers }));
  const tick = () => new Promise(resolve => setImmediate(resolve));
  async function unavailable(response) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.equal(response.headers.get('X-IVX-Data-State'), 'unavailable');
    assert.equal(response.headers.get('Retry-After'), '3');
    assert.deepEqual(await response.json(), { videos: [], analytics_status: 'unavailable',
      degraded: true, data_available: false, retryable: true, code: 'ANALYTICS_UNAVAILABLE' });
  }
`;

test('deferred analytics preserves validation, public projection and fresh visibility checks', async () => {
  await fixture(setup + `
    assert.equal((await read('invalid')).status, 400);
    assert.equal((await read('')).status, 400);
    const tooMany = Array.from({ length: 51 }, (_, i) => '00000000-0000-4000-8000-' + i.toString(16).padStart(12, '0'));
    assert.equal((await read(tooMany.join(','))).status, 400);
    assert.equal(queryCalls, 0);
    assert.deepEqual(await (await read(hidden + ',' + a.toUpperCase() + ',' + a)).json(), { videos: [{ id: a, view_count: 12 }] });
    assert.deepEqual(requestedIds, [a, hidden]);
    visible = false;
    assert.deepEqual(await (await read(hidden + ',' + a)).json(), { videos: [] });
    assert.equal(analyticsCalls, 1, 'Hidden videos must not expose aggregates or use an old cached response');
    await unavailable(deferredAnalyticsUnavailable());
  `);
});

test('deferred analytics backs off after failure without inventing counters and recovers', async () => {
  await fixture(setup + `
    let clock = Date.now(); Date.now = () => clock;
    const healthy = analyticsRead;
    analyticsRead = async () => { throw new Error('private database connection details'); };
    await unavailable(await read(a));
    await unavailable(await read(a, { Authorization: 'Bearer fixture' }));
    await unavailable(await read(hidden, { Cookie: 'fixture=1' }));
    assert.equal(queryCalls, 1, 'A failed producer must back off across callers and ID sets');
    assert.equal((await read('invalid')).status, 400);
    clock += 3001; analyticsRead = healthy;
    assert.deepEqual(await (await read(a)).json(), { videos: [{ id: a, view_count: 12 }] });
    assert.equal(queryCalls, 2);
  `);
});

test('30 saturated callers share one read, respond within budget and retain pending work until it settles', async () => {
  await fixture(setup + `
    let finish, producerSignal;
    const healthy = await analyticsRead();
    analyticsRead = () => {
      producerSignal = readTimings.getStore()?.deadline;
      return new Promise(resolve => { finish = resolve; });
    };
    const started = performance.now();
    const responses = await readTimings.run(newReadTimings(5), () => Promise.all(Array.from({ length: 30 }, (_, i) =>
      read(i % 2 ? a.toUpperCase() : a, i % 2 ? { Authorization: 'Bearer fixture' } : undefined))));
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 2400 && elapsed < 4500, 'Optional analytics must keep its 2.5s response deadline before the provider deadline');
    for (const response of responses) await unavailable(response);
    assert.equal(queryCalls, 1); assert.equal(analyticsCalls, 1);
    assert.equal(producerSignal.aborted, false, 'The producer must have an independent deadline');
    await unavailable(await read(hidden));
    assert.equal(queryCalls, 1, 'A different ID set cannot exceed the one-read capacity');
    const late = read(a); await tick();
    assert.equal(queryCalls, 1, 'The HTTP deadline must not release an unfinished producer');
    finish(healthy);
    assert.deepEqual(await (await late).json(), { videos: [{ id: a, view_count: 12 }] });
    analyticsRead = async () => healthy;
    assert.deepEqual(await (await read(a)).json(), { videos: [{ id: a, view_count: 12 }] });
    assert.equal(queryCalls, 2, 'Capacity is reusable after the original read settles');
  `);
});

test('an early metadata failure retains capacity until the outstanding catalog read settles', async () => {
  await fixture(setup + `
    let finish, clock = Date.now(); Date.now = () => clock;
    catalogRead = () => new Promise(resolve => { finish = resolve; });
    metaRead = async () => { throw new Error('Metadata unavailable'); };
    await unavailable(await read(a));
    clock += 6000;
    await unavailable(await read(hidden));
    assert.equal(queryCalls, 1, 'An early failure must not allow overlapping catalog reads');
    finish({ data: [{ id: a }], error: null }); await tick();
    assert.equal(analyticsCalls, 0);
  `);
});

test('a stalled real upstream body is cancelled after the response fallback and later reads recover', async () => {
  await fixture(`
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { mock } from 'bun:test';
    const a = '00000000-0000-4000-8000-00000000000a';
    let stalled = true, requests = 0, upstreamError;
    let announce; const cancelled = new Promise(resolve => { announce = resolve; });
    const server = http.createServer((_req, res) => {
      requests++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (stalled) { res.flushHeaders(); res.write('['); }
      else res.end(JSON.stringify([{ id: a }]));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = 'http://127.0.0.1:' + server.address().port;
    mock.module('@supabase/supabase-js', () => ({ createClient: (_url, _key, options) => ({ from: () => {
      const q = { select: () => q, in: () => q, eq: () => q, then: (resolve, reject) =>
        options.global.fetch(url).then(r => r.json()).then(data => ({ data, error: null })).catch(error => {
          upstreamError = error; announce(); throw error;
        }).then(resolve, reject) };
      return q;
    } }) }));
    const real = await import('./backend/services/ivx-video-platform-store');
    mock.module('./backend/services/ivx-video-platform-store', () => ({ ...real,
      getMetaDoc: async () => ({ [a]: { status: 'published' } }),
      getAnalyticsDoc: async () => ({ videos: { [a]: { views: 7 } }, history: {} }),
    }));
    const { handleDeferredVideoAnalytics } = await import('./backend/api/ivx-video-platform');
    const read = () => handleDeferredVideoAnalytics(new Request('https://example.test/api/videos/analytics?ids=' + a));
    let watchdog;
    try {
      const response = await read();
      assert.equal(response.status, 200); assert.equal((await response.json()).data_available, false);
      await Promise.race([cancelled, new Promise((_, reject) => { watchdog = setTimeout(() => reject(new Error('Upstream body was not cancelled')), 5000); })]);
      clearTimeout(watchdog); await new Promise(resolve => setImmediate(resolve));
      assert.equal(upstreamError.name, 'AbortError'); assert.equal(requests, 1);
      stalled = false; const realNow = Date.now; Date.now = () => realNow() + 3001;
      assert.deepEqual(await (await read()).json(), { videos: [{ id: a, view_count: 7 }] });
      assert.equal(requests, 2);
    } finally {
      clearTimeout(watchdog); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    }
  `, 10000);
}, 12000);
