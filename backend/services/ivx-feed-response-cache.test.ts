import { expect, test } from 'bun:test';
import { createFeedResponseCache } from './ivx-feed-response-cache';

const request = (path = '/api/reels', headers?: Record<string, string>) => new Request('https://api.example.test' + path, { headers });
const feed = () => Response.json({ videos: [{ id: 'published', video_url: '/same.mp4' }], personalized: false });

test('fresh cache age decreases and stale recovery expires at its original absolute limit', async () => {
  let clock = 0, calls = 0, failed = false;
  const cache = createFeedResponseCache({ now: () => clock });
  const load = async () => { calls++; return failed ? Response.json({ error: 'DB timeout' }, { status: 500 }) : feed(); };
  expect((await cache(request(), load)).headers.get('Cache-Control')).toContain('max-age=30');
  clock = 25_000;
  expect((await cache(request(), load)).headers.get('Cache-Control')).toContain('max-age=5');
  expect(calls).toBe(1);
  clock = 31_000; failed = true;
  const stale = await cache(request(), load);
  expect(stale.status).toBe(200);
  expect(stale.headers.get('X-IVX-Cache')).toBe('STALE');
  expect(stale.headers.get('Cache-Control')).toBe('no-store');
  clock = 89_999;
  expect((await cache(request(), load)).status).toBe(200);
  clock = 90_000;
  const expired = await cache(request(), load);
  expect(expired.status).toBe(503);
  expect(expired.headers.get('Cache-Control')).toBe('no-store');
  expect(expired.headers.get('Retry-After')).toBe('3');
  expect(await expired.text()).not.toContain('DB timeout');
});

test('errors and malformed success bodies are not cached as a successful empty feed', async () => {
  const cache = createFeedResponseCache();
  for (const invalid of [() => { throw Error('query failure'); }, () => new Response('bad JSON'), () => Response.json(null), () => Response.json({}, { status: 500 })]) {
    const result = await cache(request(), async () => invalid());
    expect(result.status).toBe(503);
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  }
  expect((await cache(request(), async () => feed())).status).toBe(200);
});

test('viewer, cookie and authorization requests cannot reuse or populate the public cache', async () => {
  const cache = createFeedResponseCache();
  await cache(request(), async () => feed());
  let calls = 0;
  for (const req of [request('/api/reels?viewer_id=a'), request('/api/reels', { Authorization: 'Bearer test' }), request('/api/reels', { Cookie: 'test=value' })]) {
    for (let n = 0; n < 2; n++) {
      const result = await cache(req, async () => { calls++; return Response.json({ viewer: calls }); });
      expect(result.headers.get('Cache-Control')).toBe('no-store');
      expect(result.headers.get('X-IVX-Cache')).toBe('BYPASS');
    }
  }
  expect(calls).toBe(6);
  let personalizedCalls = 0;
  for (let n = 0; n < 2; n++) {
    const result = await cache(request('/other'), async () => { personalizedCalls++; return Response.json({ personalized: true }); });
    expect(result.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(personalizedCalls).toBe(2);
});

test('a response timeout keeps the underlying read shared and recovers when it settles', async () => {
  const cache = createFeedResponseCache({ responseTimeoutMs: 5 });
  let finish!: (response: Response) => void, calls = 0;
  const load = () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); };
  expect((await cache(request(), load)).status).toBe(503);
  const second = cache(request(), load);
  finish(feed());
  expect((await second).status).toBe(200);
  expect(calls).toBe(1);
  expect((await cache(request(), load)).headers.get('X-IVX-Cache')).toBe('HIT');
});

test('an upstream authorization failure never recovers from stale public data', async () => {
  let clock = 0;
  const cache = createFeedResponseCache({ now: () => clock });
  await cache(request(), async () => feed());
  clock = 31_000;
  const result = await cache(request(), async () => Response.json({ error: 'denied' }, { status: 403 }));
  expect(result.status).toBe(403);
  expect(result.headers.get('Cache-Control')).toBe('no-store');
});

test('pending reads are bounded across unique requests, and completed reads release capacity', async () => {
  const cache = createFeedResponseCache({ maxEntries: 1, responseTimeoutMs: 5 });
  let finish!: (response: Response) => void, calls = 0;
  const first = cache(request(), () => new Promise(resolve => { finish = resolve; }));
  await Promise.resolve();
  expect((await cache(request('/different'), async () => { calls++; return feed(); })).status).toBe(503);
  expect(calls).toBe(0);
  finish(feed()); await first;
  expect((await cache(request('/different'), async () => feed())).status).toBe(200);
});
