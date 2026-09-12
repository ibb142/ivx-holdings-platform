import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function harness(fetchImpl: typeof fetch) {
  const source = readFileSync(new URL('./ivx-video-platform.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  const timeoutFetch = ');
  const end = source.indexOf('\n  _sb = createClient', start);
  if (start < 0 || end < start) throw new Error('Video source transport not found');
  const timers = new Map<unknown, number>();
  const api: { run?: typeof fetch } = {};
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end)) + '\napi.run = timeoutFetch;', {
    api, fetch: fetchImpl, AbortController, Response, Error, SB_TIMEOUT_MS: 5000,
    setTimeout: (fn: () => void, ms: number) => { timers.set(fn, ms); return fn; },
    clearTimeout: (fn: unknown) => timers.delete(fn),
  });
  return { run: api.run!, timers, expire: () => { for (const fn of [...timers.keys()]) (fn as () => void)(); } };
}
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }

test('source deadline includes a stalled response body after successful headers', async () => {
  let signal: AbortSignal | undefined;
  const h = harness((async (_url, init) => {
    signal = init?.signal as AbortSignal;
    return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } });
  }) as typeof fetch);
  let settled = false, failure: unknown;
  const work = h.run('https://source.test').then(() => { settled = true; }, e => { settled = true; failure = e; });
  await flush();
  expect(settled).toBe(false);
  expect([...h.timers.values()]).toEqual([5000]);
  h.expire(); await flush();
  expect(settled).toBe(true);
  expect(failure).toBeInstanceOf(Error);
  expect(signal?.aborted).toBe(true);
  await work;
  expect(h.timers.size).toBe(0);
});

test('a transport ignoring abort still settles at the original deadline', async () => {
  const h = harness((() => new Promise(() => {})) as typeof fetch);
  let rejected = false;
  void h.run('https://source.test').catch(() => { rejected = true; });
  h.expire(); await flush();
  expect(rejected).toBe(true);
  expect(h.timers.size).toBe(0);
});

test('caller cancellation is preserved during source reads', async () => {
  let signal: AbortSignal | undefined;
  const h = harness((async (_url, init) => { signal = init?.signal as AbortSignal; return new Promise(() => {}); }) as typeof fetch);
  const caller = new AbortController(); let rejected = false;
  void h.run('https://source.test', { signal: caller.signal }).catch(() => { rejected = true; });
  caller.abort(); await flush();
  expect(rejected).toBe(true);
  expect(signal?.aborted).toBe(true);
  expect(h.timers.size).toBe(0);
});

test('completed JSON and source HTTP failure remain unchanged', async () => {
  for (const status of [200, 503]) {
    const body = JSON.stringify(status === 200 ? [{ id: 'published-video' }] : { code: 'SOURCE_UNAVAILABLE' });
    const h = harness((async () => new Response(body, { status, headers: { 'content-type': 'application/json', 'content-range': '0-0/1' } })) as typeof fetch);
    const result = await h.run('https://source.test');
    expect(result.status).toBe(status);
    expect(result.headers.get('content-range')).toBe('0-0/1');
    expect(await result.text()).toBe(body);
    expect(h.timers.size).toBe(0);
  }
});

test('bodyless responses retain their status and empty body', async () => {
  const h = harness((async () => new Response(null, { status: 204 })) as typeof fetch);
  const result = await h.run('https://source.test');
  expect(result.status).toBe(204);
  expect(result.body).toBeNull();
  expect(h.timers.size).toBe(0);
});

test('the next read can recover after a stalled body times out', async () => {
  let calls = 0;
  const h = harness((async () => ++calls === 1
    ? new Response(new ReadableStream({ start() {} }))
    : Response.json([{ id: 'recovered-video' }])) as typeof fetch);
  const first = h.run('https://source.test');
  const rejected = first.catch(() => 'failed');
  await flush(); h.expire();
  expect(await rejected).toBe('failed');
  const recovered = await h.run('https://source.test');
  expect(await recovered.json()).toEqual([{ id: 'recovered-video' }]);
  expect(calls).toBe(2);
  expect(h.timers.size).toBe(0);
});

test('a caller already cancelled cannot issue a source request', async () => {
  let calls = 0;
  const h = harness((async () => { calls++; return Response.json([]); }) as typeof fetch);
  const controller = new AbortController(); controller.abort();
  await expect(h.run('https://source.test', { signal: controller.signal })).rejects.toThrow();
  expect(calls).toBe(0);
  expect(h.timers.size).toBe(0);
});
