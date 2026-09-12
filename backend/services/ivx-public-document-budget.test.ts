import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { DurableStore } from './ivx-durable-store';
import { newReadTimings, readTimings } from './ivx-read-timings';

const originalFetch = globalThis.fetch;
const names = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const;
let saved: (string | undefined)[];
beforeEach(() => {
  saved = names.map(name => process.env[name]);
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://documents.example.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  names.forEach((name, i) => saved[i] === undefined ? delete process.env[name] : process.env[name] = saved[i]);
});
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const read = <T>(store: DurableStore, key: string, fallback: T, budget = 1000) =>
  readTimings.run(newReadTimings(budget), () => store.readJson(key, fallback));

test('public burst does one GET, no schema probe or mutation, with isolated results', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0;
  globalThis.fetch = (async (input, init) => {
    calls++;
    expect(init?.method).toBe('GET');
    expect(new URL(String(input)).searchParams.get('doc_key')).toBe('eq.meta');
    await gate;
    return Response.json([{ value: { visible: true } }]);
  }) as typeof fetch;
  const store = new DurableStore();
  const requests = Array.from({ length: 30 }, () => read(store, 'meta', { visible: false }));
  release();
  const values = await Promise.all(requests);
  expect(calls).toBe(1);
  values[0].visible = false;
  expect(values[1].visible).toBe(true);
});

test('stalled real HTTP body is aborted once and subsequent calls hit the open circuit', async () => {
  let calls = 0, closed = false;
  const server = createServer((_req, res) => {
    calls++;
    _req.socket.on('close', () => { closed = true; });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('[{"value":');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  process.env.EXPO_PUBLIC_SUPABASE_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const store = new DurableStore();
    const start = performance.now();
    await expect(read(store, 'meta', {}, 60)).rejects.toThrow();
    expect(performance.now() - start).toBeLessThan(500);
    await expect(read(store, 'meta', {})).rejects.toThrow('circuit open');
    for (let i = 0; i < 20 && !closed; i++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(calls).toBe(1);
    expect(closed).toBe(true);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

test('late failure before a write cannot reopen the circuit for the new document', async () => {
  let rejectOld!: (error: Error) => void;
  let reads = 0;
  globalThis.fetch = (async (input, init) => {
    if (init?.method === 'POST') return new Response(null, { status: 201 });
    if (!new URL(String(input)).searchParams.has('doc_key')) return Response.json([]);
    if (++reads === 1) return new Promise<Response>((_resolve, reject) => { rejectOld = reject; });
    return Response.json([{ value: { version: 2 } }]);
  }) as typeof fetch;
  const store = new DurableStore();
  const old = read(store, 'meta', {}).catch(() => null);
  await turn();
  await store.writeJson('meta', { version: 2 });
  rejectOld(new Error('old transport failed'));
  await old;
  expect(await read(store, 'meta', {})).toEqual({ version: 2 });
  expect(reads).toBe(2);
});

test('public source failure is not converted into an empty successful document', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return Response.json({}, { status: 503 }); }) as typeof fetch;
  await expect(read(new DurableStore(), 'meta', [])).rejects.toThrow('source unavailable');
  expect(calls).toBe(1);
});

test('missing public metadata does not invoke S3 repair or substitute default visibility', async () => {
  const requests: { url: string; method: string | undefined }[] = [];
  globalThis.fetch = (async (input, init) => {
    requests.push({ url: String(input), method: init?.method });
    return Response.json([]);
  }) as typeof fetch;
  const { getMetaDoc } = await import('./ivx-video-platform-store');
  await expect(readTimings.run(newReadTimings(1000), () => getMetaDoc())).rejects.toThrow('Public metadata snapshot unavailable');
  expect(requests).toHaveLength(1);
  expect(requests[0].method).toBe('GET');
  expect(new URL(requests[0].url).pathname).toBe('/rest/v1/ivx_durable_documents');
});
