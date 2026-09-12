import { expect, test } from 'bun:test';
import { createFeedResponseCache } from './ivx-feed-response-cache';
import { newReadTimings, readTimings } from './ivx-read-timings';
import { withPublicFeedAvailability } from './ivx-public-feed-availability';

const req = (headers?: Record<string, string>) => new Request('https://example.test/api/reels', { headers });
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

test('30 cold requests return marked fallback, share one producer and warm after caller deadline', async () => {
  const cache = createFeedResponseCache({ staleWhileRevalidate: true, responseTimeoutMs: 15,
    refreshTimeoutMs: 1000, fallback: () => ({ videos: [], count: 0 }) });
  let calls = 0, finish!: (response: Response) => void, signal: AbortSignal | undefined;
  const handler = () => { calls++; signal = readTimings.getStore()?.deadline;
    return new Promise<Response>(resolve => { finish = resolve; }); };
  const responses = await Promise.all(Array.from({ length: 30 }, () =>
    readTimings.run(newReadTimings(5), () => cache(req(), handler))));
  expect(calls).toBe(1);
  expect(signal?.aborted).toBe(false);
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(response.headers.get('X-IVX-Cache')).toBe('FALLBACK');
    expect(response.headers.get('X-IVX-Data-State')).toBe('unavailable');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ degraded: true, data_available: false, videos: [] });
  }
  finish(Response.json({ videos: [{ id: 'real' }] })); await turn();
  const recovered = await cache(req(), handler);
  expect(recovered.headers.get('X-IVX-Cache')).toBe('HIT');
  expect(await recovered.json()).toEqual({ videos: [{ id: 'real' }] });
  expect(calls).toBe(1);
});

test('30 stale reads return before refresh settles, one refresh replaces the snapshot', async () => {
  let clock = 0, calls = 0, finish!: (response: Response) => void;
  const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true });
  await cache(req(), async () => Response.json({ videos: [{ id: 'old' }] }));
  clock = 31_000;
  const handler = () => { calls++; return new Promise<Response>(resolve => { finish = resolve; }); };
  const responses = await Promise.all(Array.from({ length: 30 }, () => cache(req(), handler)));
  expect(calls).toBe(1);
  for (const response of responses) {
    expect(response.headers.get('X-IVX-Data-State')).toBe('stale');
    expect(response.headers.get('X-IVX-Data-Age-Ms')).toBe('31000');
  }
  finish(Response.json({ videos: [] })); await turn();
  expect(await (await cache(req(), handler)).json()).toEqual({ videos: [] });
});

test('failures back off, expired publications are discarded and auth rejections stay rejected', async () => {
  let clock = 0, calls = 0;
  const cache = createFeedResponseCache({ now: () => clock, staleWhileRevalidate: true,
    fallback: () => ({ videos: [] }) });
  await cache(req(), async () => Response.json({ videos: [{ id: 'old' }] }));
  const fail = async () => { calls++; return Response.json({}, { status: 503 }); };
  clock = 31_000; await cache(req(), fail); await turn();
  clock = 32_000; await cache(req(), fail); expect(calls).toBe(1);
  clock = 90_000;
  const expired = await cache(req(), fail);
  expect(await expired.json()).toMatchObject({ videos: [], degraded: true });
  for (const headers of [{ Authorization: 'Bearer example' }, { Cookie: 'session=example' }]) {
    const denied = await cache(req(headers), async () => Response.json({ error: 'denied' }, { status: 403 }));
    expect(denied.status).toBe(403);
  }
});

test('actual availability wrapper preserves each route contract and limits producers globally to two', async () => {
  let calls = 0;
  const finishes: ((r: Response) => void)[] = [];
  const stalled = () => { calls++; return new Promise<Response>(resolve => finishes.push(resolve)); };
  const a = withPublicFeedAvailability(new Request('https://example.test/api/deals'), stalled);
  const b = withPublicFeedAvailability(new Request('https://example.test/api/reels'), stalled);
  await turn();
  const home = await withPublicFeedAvailability(new Request('https://example.test/api/home/feed'), stalled);
  expect(calls).toBe(2);
  expect(await home.json()).toMatchObject({ blocks: [], degraded: true, data_available: false });
  finishes.forEach(finish => finish(Response.json({}, { status: 503 })));
  expect(await (await a).json()).toMatchObject({ deals: [], sourceCount: null, degraded: true });
  expect(await (await b).json()).toMatchObject({ videos: [], next_cursor: null, degraded: true });
});
