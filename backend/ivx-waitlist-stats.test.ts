import { afterEach, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { Hono } from 'hono';
import * as waitlistAPI from './api/ivx-waitlist-stats';

const initialFetch = globalThis.fetch;
const envNames = ['SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'] as const;
const initialEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
let sequence = 0;
afterEach(() => {
  globalThis.fetch = initialFetch;
  for (const name of envNames) {
    if (initialEnv[name] === undefined) delete process.env[name];
    else process.env[name] = initialEnv[name];
  }
});

type Read = { url: URL; init: RequestInit };
function fixture(reply: (read: Read) => Promise<Response> | Response, configured = true) {
  for (const name of envNames) delete process.env[name];
  if (configured) {
    process.env.SUPABASE_URL = `https://waitlist-${++sequence}.example.invalid`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'isolated-test-key';
  }
  const calls: Read[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const read = { url: new URL(String(input)), init };
    calls.push(read);
    return reply(read);
  }) as typeof fetch;
  // Execute the shipped route with its real canonical-member reader, without
  // booting background workers. Only the external HTTP transport is replaced.
  const source = readFileSync(new URL('./hono.ts', import.meta.url), 'utf8');
  const begin = source.indexOf("app.get('/api/trpc/waitlist.getStats',");
  const end = source.indexOf('// tRPC-compatible waitlist join', begin);
  if (begin < 0 || end <= begin) throw new Error('Missing waitlist stats route');
  const route = source.slice(begin, end).replace("await import('./api/ivx-waitlist-stats')", 'waitlistAPI');
  const app = new Hono();
  app.onError(() => Response.json({ error: 'Unhandled route error' }, { status: 500 }));
  vm.runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(route), {
    app, waitlistAPI, Response, Date, Number, Promise,
    nowIso: () => new Date().toISOString(), DEPLOYMENT_MARKER: 'isolated-waitlist-proof',
  });
  return { app, calls };
}
const headCount = (count: number) => new Response(null, { headers: { 'Content-Range': `*/${count}` } });
const request = (app: Hono) => app.request('/api/trpc/waitlist.getStats');

test('waitlist stats use exact counts above the member-list cap without downloading member rows', async () => {
  const f = fixture(({ url, init }) => init.method === 'HEAD'
    ? headCount(url.searchParams.has('member_type') ? 73 : 3201)
    : Response.json(Array.from({ length: 2000 }, (_, index) => ({ member_type: index < 73 ? 'waitlist' : 'member' }))));
  const response = await request(f.app);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, total: 3201, waitlist: 73 });
  expect(response.headers.get('cache-control')).toBe('no-store');
  expect(f.calls.length).toBe(2);
  for (const read of f.calls) {
    expect(read.init.method).toBe('HEAD');
    expect(read.url.pathname).toBe('/rest/v1/members');
    expect(read.url.searchParams.get('select')).toBe('member_id');
    expect(read.url.searchParams.has('order')).toBe(false);
    expect(new Headers(read.init.headers).get('prefer')).toBe('count=exact');
    expect(read.init.signal).toBeInstanceOf(AbortSignal);
  }
  expect(f.calls.filter(read => read.url.searchParams.get('member_type') === 'eq.waitlist').length).toBe(1);
});

test('an authoritative empty registry returns zero successfully', async () => {
  const f = fixture(() => headCount(0));
  const response = await request(f.app);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, total: 0, waitlist: 0 });
});

test('missing configuration is unavailable rather than a successful zero registry', async () => {
  const f = fixture(() => { throw new Error('Must not fetch'); }, false);
  const response = await request(f.app);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ ok: false, total: null, waitlist: null, code: 'WAITLIST_STATS_UNAVAILABLE' });
  expect(f.calls.length).toBe(0);
});

test('database failures return a sanitized retryable error without fabricated counts', async () => {
  for (const status of [401, 500, 503]) {
    const f = fixture(() => new Response('private database detail', { status }));
    const response = await request(f.app);
    expect(response.status).toBe(503);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('retry-after')).toBe('3');
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, total: null, waitlist: null, code: 'WAITLIST_STATS_UNAVAILABLE', retryable: true });
    expect(JSON.stringify(body)).not.toContain('private database detail');
  }
});

test('unknown or malformed count headers cannot certify a zero count', async () => {
  for (const range of ['', '*/*', '*/-1', '*/9007199254740992']) {
    const f = fixture(() => new Response(null, { headers: { 'Content-Range': range } }));
    const response = await request(f.app);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ total: null, waitlist: null });
  }
});

test('overlapping stats requests coalesce each distinct count without mixing waitlist and total', async () => {
  const pending: Array<() => void> = [];
  const f = fixture(({ url }) => new Promise(resolve => pending.push(() => resolve(headCount(url.searchParams.has('member_type') ? 4 : 50)))));
  const requests = Array.from({ length: 20 }, () => request(f.app));
  for (let i = 0; i < 15; i++) await Promise.resolve();
  for (const resolve of pending) resolve();
  for (const response of await Promise.all(requests)) {
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ total: 50, waitlist: 4 });
  }
  expect(f.calls.length).toBe(2);
});

test('a failed read is not cached and a later authoritative read can recover', async () => {
  let fail = true;
  const f = fixture(({ url }) => fail ? new Response(null, { status: 503 }) : headCount(url.searchParams.has('member_type') ? 2 : 10));
  expect((await request(f.app)).status).toBe(503);
  fail = false;
  const response = await request(f.app);
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ total: 10, waitlist: 2 });
});

test('inconsistent counts are unavailable rather than a misleading successful snapshot', async () => {
  const f = fixture(({ url }) => headCount(url.searchParams.has('member_type') ? 11 : 10));
  const response = await request(f.app);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ total: null, waitlist: null });
});
