import { expect, test } from 'bun:test';
import { once } from 'node:events';
import { serve } from '@hono/node-server';
import { withPublicFeedAvailability as cache } from './ivx-public-feed-availability';

const primary = 'https://api.ivxholding.com';
const alternate = 'https://ivx-holdings-platform.onrender.com';
const home = '/api/ivx/video-platform/home-feed';
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const data = () => Response.json({ blocks: [{ type: 'deal', deal: { id: 'published' } }], personalized: false });

test('equivalent Home URLs share one pending read and leave the second slot available for deals', async () => {
  let calls = 0;
  const finishes: Array<(response: Response) => void> = [];
  const pending = () => { calls++; return new Promise<Response>(resolve => finishes.push(resolve)); };
  const requests = Array.from({ length: 30 }, (_, i) => new Request(
    (i % 2 ? primary : alternate) + (i % 3 ? home : '/api/home/feed')
      + (i % 2 ? '?limit=60&case=burst' : '?case=burst&limit=60')));
  const reads = requests.map(req => cache(req, pending));
  await turn();
  const observedCalls = calls;
  let dealsRead = false;
  const deals = await cache(new Request(primary + '/api/deals?case=burst'), async () => {
    dealsRead = true;
    return Response.json({ deals: [{ id: 'published' }] });
  });
  finishes.forEach(finish => finish(data()));
  const responses = await Promise.all(reads);
  expect(observedCalls).toBe(1);
  expect(dealsRead).toBe(true);
  expect(await deals.json()).toEqual({ deals: [{ id: 'published' }] });
  for (const response of responses) {
    expect(response.headers.get('X-IVX-Data-State')).toBe('available');
    expect(await response.json()).toMatchObject({ blocks: [{ deal: { id: 'published' } }] });
  }
  const hit = await cache(requests[1], pending);
  expect(hit.headers.get('X-IVX-Cache')).toBe('HIT');
  expect(calls).toBe(1);
});

test('a failed Home read shares its retry backoff with the alternate host and route', async () => {
  let calls = 0;
  const failure = async () => { calls++; return Response.json({}, { status: 503 }); };
  const first = await cache(new Request(primary + home + '?case=backoff'), failure);
  const second = await cache(new Request(alternate + '/api/home/feed?case=backoff'), failure);
  expect(calls).toBe(1);
  for (const response of [first, second]) {
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Retry-After')).toBe('3');
    expect(await response.json()).toMatchObject({ blocks: [], data_available: false, degraded: true });
  }
});

test('viewer, cookie, authorization and non-GET requests bypass a shared Home snapshot', async () => {
  const path = home + '?case=private';
  await cache(new Request(primary + path), async () => data());
  let calls = 0;
  const requests = [
    new Request(alternate + path + '&viewer_id=guest-a'),
    new Request(alternate + path, { headers: { Cookie: 'session=example' } }),
    new Request(alternate + path, { headers: { Authorization: 'Bearer example' } }),
    new Request(alternate + path, { method: 'POST' }),
  ];
  for (const req of requests) {
    const response = await cache(req, async () => { calls++; return Response.json({ error: 'denied' }, { status: 403 }); });
    expect(response.status).toBe(403);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  }
  expect(calls).toBe(requests.length);
});

test('different filters, duplicate-value order and unrecognized origins retain distinct snapshots', async () => {
  const urls = [
    primary + home + '?case=distinct&limit=60',
    alternate + home + '?case=distinct&limit=30',
    primary + home + '?case=distinct&limit=60&limit=30',
    alternate + home + '?case=distinct&limit=30&limit=60',
    'https://unrelated.example.test' + home + '?case=distinct&limit=60',
    primary + '/api/ivx/video-platform/feed?case=distinct&limit=60',
    primary + '/api/ivx/videos/feed?case=distinct&limit=60',
    primary + home + '?case=distinct&limit=60&channel=jv',
    primary + home + '?case=distinct&limit=60&cursor=next',
    primary + home + '?case=distinct&limit=60&project_id=other',
  ];
  let calls = 0;
  for (let i = 0; i < urls.length; i++) {
    const response = await cache(new Request(urls[i]), async () => Response.json({ source: calls++ }));
    expect(await response.json()).toEqual({ source: i });
  }
  expect(calls).toBe(urls.length);
});

test('the production HTTP adapter shares Home data after TLS terminates at the load balancer', async () => {
  let calls = 0;
  const seen: string[] = [];
  const read = async () => { calls++; return data(); };
  const server = serve({ hostname: '127.0.0.1', port: 0, fetch: request => {
    seen.push(request.url);
    return cache(request, read);
  } });
  try {
    if (!server.listening) await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP test server has no port');
    const send = (host: string, path: string) => fetch(`http://127.0.0.1:${address.port}${path}`, {
      headers: { Host: host, 'X-Forwarded-Proto': 'https' },
    });
    const first = await send('api.ivxholding.com', home + '?case=http-adapter&limit=60');
    expect(await first.json()).toMatchObject({ blocks: [{ deal: { id: 'published' } }] });
    const second = await send('ivx-holdings-platform.onrender.com', '/api/home/feed?limit=60&case=http-adapter');
    expect(await second.json()).toMatchObject({ blocks: [{ deal: { id: 'published' } }] });
    expect(seen.every(url => url.startsWith('http://'))).toBe(true);
    expect(second.headers.get('X-IVX-Cache')).toBe('HIT');
    const https = await cache(new Request(primary + home + '?case=http-adapter&limit=60'), read);
    expect(https.headers.get('X-IVX-Cache')).toBe('HIT');
    expect(calls).toBe(1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('forwarded headers cannot opt unknown hosts or nonstandard ports into the Home cache', async () => {
  const path = home + '?case=untrusted-forwarding';
  await cache(new Request(primary + path), async () => data());
  let calls = 0;
  for (const origin of ['http://unrelated.example.test', 'http://api.ivxholding.com:10001', 'https://api.ivxholding.com:10001']) {
    const response = await cache(new Request(origin + path, { headers: {
      'X-Forwarded-Host': 'api.ivxholding.com', 'X-Forwarded-Proto': 'https',
      Forwarded: 'proto=https;host=api.ivxholding.com',
    } }), async () => Response.json({ source: ++calls }));
    expect(await response.json()).toEqual({ source: calls });
  }
  expect(calls).toBe(3);
});
