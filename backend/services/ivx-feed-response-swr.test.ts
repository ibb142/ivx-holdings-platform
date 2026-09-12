import { expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { createFeedResponseCache } from './ivx-feed-response-cache';
import { measuredReadFetch, newReadTimings, readTimings } from './ivx-read-timings';

const request = (path = '/api/ivx/video-platform/home-feed', headers?: Record<string, string>) =>
  new Request(`https://api.example.test${path}`, { headers });
const feed = (id = 'published') => Response.json({
  blocks: [{ type: 'video', video: { id, video_url: `/media/${id}.mp4` } }], personalized: false,
});
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('public stale feed returns before a stalled refresh and shares one producer across 30 requests', async () => {
  let clock = 0, calls = 0;
  const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true });
  const original = await (await cache(request(), async () => feed())).text();
  clock = 31_000;
  let finish!: (response: Response) => void;
  const load = () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); };
  const requests = Array.from({ length: 30 }, () => cache(request(), load));
  const ready = await Promise.race([Promise.all(requests), turn().then(() => null)]);
  try {
    expect(ready).not.toBeNull();
    expect(calls).toBe(1);
    for (const response of ready!) {
      expect(response.status).toBe(200);
      expect(response.headers.get('X-IVX-Cache')).toBe('STALE');
      expect(response.headers.get('X-IVX-Cache-Age-Ms')).toBe('31000');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('Warning')).toContain('110');
      expect(await response.text()).toBe(original);
    }
  } finally { finish(feed('updated')); await Promise.all(requests); }
  await turn();
  const fresh = await cache(request(), async () => { throw Error('Must use the completed refresh'); });
  expect(fresh.headers.get('X-IVX-Cache')).toBe('HIT');
  expect((await fresh.json()).blocks[0].video.id).toBe('updated');
});

test('valid stale content remains available when another key consumes the producer limit', async () => {
  let clock = 0, refreshes = 0;
  const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true, maxEntries: 1 });
  await cache(request(), async () => feed());
  clock = 31_000;
  let finish!: (response: Response) => void;
  const busy = cache(request('/different-feed'), () => new Promise<Response>(resolve => { finish = resolve; }));
  await turn();
  try {
    const stale = await cache(request(), async () => { refreshes++; return feed(); });
    expect(stale.status).toBe(200);
    expect(stale.headers.get('X-IVX-Cache')).toBe('STALE');
    expect(refreshes).toBe(0);
  } finally { finish(feed()); await busy; }
});

test('failed background refresh backs off without extending the original publication deadline', async () => {
  let clock = 0, calls = 0;
  const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true });
  await cache(request(), async () => feed());
  const fail = async () => { calls++; return Response.json({ error: 'private DB detail' }, { status: 503 }); };
  clock = 31_000;
  await cache(request(), fail);
  await turn();
  for (let i = 0; i < 30; i++) expect((await cache(request(), fail)).status).toBe(200);
  expect(calls).toBe(1);
  clock = 34_000;
  await cache(request(), fail);
  await turn();
  expect(calls).toBe(2);
  clock = 89_999;
  expect((await cache(request(), fail)).status).toBe(200);
  await turn();
  clock = 90_000;
  const expired = await cache(request(), fail);
  expect(expired.status).toBe(503);
  expect(expired.headers.get('Cache-Control')).toBe('no-store');
  const body = await expired.json();
  expect(body.code).toBe('FEED_UNAVAILABLE');
  expect(body.blocks).toBeUndefined();
  expect(JSON.stringify(body)).not.toContain('private DB detail');
});

test('an unresolved refresh cannot extend stale content or create another producer after expiry', async () => {
  let clock = 0, calls = 0;
  const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true, responseTimeoutMs: 5 });
  await cache(request(), async () => feed());
  clock = 31_000;
  let finish!: (response: Response) => void;
  const load = () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); };
  const stale = await cache(request(), load);
  expect(stale.status).toBe(200);
  clock = 90_000;
  try {
    expect((await cache(request(), load)).status).toBe(503);
    expect((await cache(request(), load)).status).toBe(503);
    expect(calls).toBe(1);
  } finally { finish(feed()); await turn(); }
});

test('public revalidation never serves shared stale content to a viewer or authenticated request', async () => {
  let clock = 0;
  const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true });
  await cache(request(), async () => feed());
  clock = 31_000;
  const variants = [request(undefined, { Authorization: 'Bearer test' }), request(undefined, { Cookie: 'session=test' }),
    request('/api/ivx/video-platform/home-feed?viewer_id=private-viewer')];
  for (const req of variants) {
    const response = await cache(req, async () => Response.json({ error: 'private source' }, { status: 503 }));
    expect(response.status).toBe(503);
    expect(response.headers.get('X-IVX-Cache')).toBe('BYPASS');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect((await response.json()).blocks).toBeUndefined();
  }
});

test('a learned authorization denial invalidates old public content before a later outage', async () => {
  for (const status of [401, 403]) {
    let clock = 0;
    const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true });
    await cache(request(), async () => feed());
    clock = 31_000;
    await cache(request(), async () => Response.json({ error: 'denied' }, { status }));
    await turn();
    const afterDenial = await cache(request(), async () => Response.json({}, { status: 503 }));
    expect(afterDenial.status).toBe(503);
    expect((await afterDenial.json()).blocks).toBeUndefined();
  }
});

test('a personalized refresh invalidates old public content and never enters the shared cache', async () => {
  let clock = 0;
  const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true });
  await cache(request(), async () => feed());
  clock = 31_000;
  await cache(request(), async () => Response.json({ personalized: true, privateValue: 'viewer-only' }));
  await turn();
  const subsequent = await cache(request(), async () => { throw Error('source unavailable'); });
  expect(subsequent.status).toBe(503);
  expect(await subsequent.text()).not.toContain('viewer-only');
});

test('a background refresh preserves the request deadline and aborts a stalled real HTTP body', async () => {
  let clock = 0, calls = 0, closed = false;
  const server = createServer((req, res) => {
    calls++;
    req.socket.once('close', () => { closed = true; });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"blocks":');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true });
    await cache(request(), async () => feed());
    clock = 31_000;
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Local HTTP server has no TCP address');
    const load = () => measuredReadFetch(`http://127.0.0.1:${address.port}`);
    const pending = readTimings.run(newReadTimings(60), () => cache(request(), load));
    const immediate = await Promise.race([pending, turn().then(() => null)]);
    expect(immediate).not.toBeNull();
    expect(immediate!.headers.get('X-IVX-Cache')).toBe('STALE');
    expect((await immediate!.json()).blocks[0].video.id).toBe('published');
    for (let i = 0; i < 30 && !closed; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(closed).toBe(true);
    expect(calls).toBe(1);
    await cache(request(), load);
    await turn();
    expect(calls).toBe(1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});
