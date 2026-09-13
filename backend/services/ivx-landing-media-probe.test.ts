import { afterEach, test } from 'bun:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { executeLandingUnit, __resetLandingExecutorCachesForTests } from './ivx-landing-p0-executor';
import { probeMediaAsset } from './ivx-media-asset-probe';
import type { LandingUnit } from './ivx-landing-p0-backlog';

afterEach(__resetLandingExecutorCachesForTests);
const sha = 'a'.repeat(40);
const ctx = { agentId: 'synthetic-media-agent', agentNumber: 28, taskId: 'synthetic-media-task', sourceSha: sha, productionSha: sha, repair: false };
const mediaUrl = 'https://cdn.example/property.mp4';
const unit = (assertion: 'mime' | 'resolvable' = 'mime'): LandingUnit => ({
  unitId: `media.deal-videos-${assertion}`, lane: 'media', workstream: 'F_MEDIA', title: 'Video response evidence', severity: 'P1',
  check: { kind: 'media', source: 'deals-videos', assert: assertion },
});
const run = (asset: (init: RequestInit) => Promise<Response>, assertion: 'mime' | 'resolvable' = 'mime') => executeLandingUnit(unit(assertion), ctx, {
  fetchImpl: (async (input, init) => String(input).endsWith('/api/deals')
    ? Response.json({ deals: [{ id: 'synthetic-property', title: 'Synthetic property', video_url: mediaUrl }] })
    : asset(init ?? {})) as typeof fetch,
});
const response = (contentType: string | null, status = 200) => new Response(null, { status, headers: contentType === null ? {} : { 'content-type': contentType } });

for (const mime of ['text/html; charset=utf-8', 'application/json', null, 'application/octet-stream', 'video/', 'application/vnd.apple.mpegurl.invalid', 'application/dash+xml-invalid']) {
  test(`video MIME rejects ${mime ?? 'missing content-type'} without certifying the asset`, async () => {
    const result = await run(async () => response(mime));
    assert.equal(result.record.status, 'FAIL');
    assert.equal(result.record.bugs_found.length, 1);
    assert.equal(result.full.commit_sha, null);
  });
}

for (const mime of ['Video/MP4; codecs="avc1.42E01E"', 'video/webm', 'application/vnd.apple.mpegurl', 'application/x-mpegurl', 'application/dash+xml']) {
  test(`video MIME retains support for ${mime}`, async () => {
    const result = await run(async () => response(mime));
    assert.equal(result.record.status, 'PASS');
    assert.equal(result.record.browser_checks, 0, 'MIME evidence is not playback certification');
  });
}

for (const status of [403, 405, 501]) {
  test(`HEAD ${status} falls back once to GET and releases an ignored Range body`, async () => {
    const methods: string[] = [];
    let cancelled = false;
    let textReads = 0;
    const body = new ReadableStream<Uint8Array>({ cancel() { cancelled = true; } });
    try {
      const result = await run(async (init) => {
        methods.push(String(init.method));
        if (init.method === 'HEAD') return response(null, status);
        assert.equal(new Headers(init.headers).get('range'), 'bytes=0-0');
        const res = new Response(body, { headers: { 'content-type': 'video/mp4', 'content-length': '90000000' } });
        // A metadata check must not consume a server's full 90 MB response.
        res.text = async () => { textReads++; throw new Error('unbounded media body read'); };
        return res;
      });
      assert.equal(result.record.status, 'PASS');
      assert.deepEqual(methods, ['HEAD', 'GET']);
      assert.equal(textReads, 0);
      assert.equal(cancelled, true);
    } finally { if (!body.locked) await body.cancel(); }
  });
}

test('a successful Range response keeps MIME evidence without downloading the video', async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array([1])); }, cancel() { cancelled = true; } });
  try {
    const result = await run(async (init) => init.method === 'HEAD' ? response(null, 405) : new Response(body, {
      status: 206, headers: { 'content-type': 'video/mp4', 'content-range': 'bytes 0-0/4000000', 'content-length': '1' },
    }));
    assert.equal(result.record.status, 'PASS');
    assert.equal(cancelled, true);
  } finally { if (!body.locked) await body.cancel(); }
});

test('404 with a video content-type remains unavailable and is not retried', async () => {
  let calls = 0;
  const result = await run(async () => { calls++; return response('video/mp4', 404); });
  assert.equal(result.record.status, 'FAIL');
  assert.equal(calls, 1);
});

test('204 cannot certify video availability despite a video content-type', async () => {
  const result = await run(async () => response('video/mp4', 204), 'resolvable');
  assert.equal(result.record.status, 'FAIL');
});

function delayedResponse(init: RequestInit, delay: number, status: number, onAbort: () => void): Promise<Response> {
  return new Promise((resolve, reject) => {
    const signal = init.signal;
    const abort = () => { clearTimeout(timer); onAbort(); reject(new DOMException('aborted', 'AbortError')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(response('video/mp4', status)); }, delay);
    if (signal?.aborted) abort();
    else signal?.addEventListener('abort', abort, { once: true });
  });
}

test('a stalled HEAD is cancelled within the 2s asset budget without starting GET', async () => {
  const methods: string[] = [];
  let aborted = false;
  const started = performance.now();
  const result = await run(async (init) => {
    methods.push(String(init.method));
    return delayedResponse(init, 2300, 200, () => { aborted = true; });
  });
  assert.equal(result.record.status, 'FAIL');
  assert.equal(aborted, true);
  assert.deepEqual(methods, ['HEAD']);
  assert.ok(performance.now() - started < 2250, 'the 2s ceiling allows only scheduling overhead');
});

test('HEAD and GET share one 2s budget instead of receiving a new budget each', async () => {
  let aborted = false;
  const methods: string[] = [];
  const started = performance.now();
  const result = await run(async (init) => {
    methods.push(String(init.method));
    return delayedResponse(init, init.method === 'HEAD' ? 1000 : 1300, init.method === 'HEAD' ? 405 : 200, () => { aborted = true; });
  });
  assert.equal(result.record.status, 'FAIL');
  assert.equal(aborted, true);
  assert.deepEqual(methods, ['HEAD', 'GET']);
  assert.ok(performance.now() - started < 2250, 'fallback must use the remaining original budget');
});

test('real HTTP fallback closes an ignored Range transfer after receiving its headers', async () => {
  const methods: string[] = [];
  let bytesSent = 0;
  let resolveClosed!: () => void;
  const transferClosed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const server = createServer((req, res) => {
    methods.push(req.method ?? '');
    if (req.method === 'HEAD') { res.writeHead(405); res.end(); return; }
    assert.equal(req.headers.range, 'bytes=0-0');
    res.writeHead(200, { 'content-type': 'video/mp4', 'content-length': '90000000' });
    const chunk = new Uint8Array(1024);
    res.write(chunk); bytesSent += chunk.byteLength;
    const timer = setInterval(() => { res.write(chunk); bytesSent += chunk.byteLength; }, 10);
    // Observe the actual connection: Bun's ServerResponse does not emit
    // close here even when the cancelled transport socket has closed.
    req.socket.once('close', () => { clearInterval(timer); resolveClosed(); });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const result = await run((init) => fetch(`http://127.0.0.1:${address.port}/property.mp4`, init));
    assert.equal(result.record.status, 'PASS');
    await Promise.race([transferClosed, new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('media transfer was not cancelled')), 1000);
    })]);
    assert.deepEqual(methods, ['HEAD', 'GET']);
    assert.ok(bytesSent < 90000000, 'must not download the complete ignored Range response');
  } finally { clearTimeout(watchdog); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('real HTTP headers that never arrive are aborted and never start a fallback request', async () => {
  const methods: string[] = [];
  let resolveClosed!: () => void;
  const requestClosed = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const server = createServer((req, res) => {
    methods.push(req.method ?? '');
    req.socket.once('close', resolveClosed);
    // Deliberately withhold response headers until the real client aborts.
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const started = performance.now();
    const result = await probeMediaAsset(fetch, `http://127.0.0.1:${address.port}/property.mp4`);
    assert.equal(result.status, 0);
    assert.equal(result.error, 'MEDIA_ASSET_TIMEOUT_EXCEEDED');
    assert.ok(performance.now() - started < 2250);
    await Promise.race([requestClosed, new Promise<never>((_, reject) => {
      watchdog = setTimeout(() => reject(new Error('stalled HTTP request was not cancelled')), 1000);
    })]);
    assert.deepEqual(methods, ['HEAD']);
  } finally { clearTimeout(watchdog); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test('unsupported schemes and embedded credentials never cause an external request', async () => {
  for (const url of ['file:///tmp/media.mp4', 'ftp://cdn.example/video.mp4', 'https://user:pass@cdn.example/video.mp4']) {
    const result = await probeMediaAsset((async () => assert.fail('unexpected request')) as typeof fetch, url);
    assert.equal(result.status, 0);
    assert.equal(result.error, 'MEDIA_ASSET_URL_INVALID');
  }
});
