import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { runInNewContext } from 'node:vm';

async function harness() {
  const source = readFileSync(new URL('./ivx-video-platform.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  const timeoutFetch = ');
  const end = source.indexOf('\n  _sb = createClient', start);
  if (start < 0 || end < start) throw new Error('Video source transport not found');
  const api: { run?: typeof fetch } = {};
  // Use native fetch and real sockets: fetch resolves at headers, while the
  // same signal must continue to govern body consumption. A hand-built
  // Response or a fetch mock ignoring its signal does not model this contract.
  // The imported-transport suite separately exercises the shipped 5s deadline.
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end)) + '\napi.run = timeoutFetch;', {
    api, fetch, AbortSignal, Request, Response, Error, SB_TIMEOUT_MS: 200,
  });
  let requests = 0;
  let notifyRequest!: () => void;
  const requested = new Promise<void>(resolve => { notifyRequest = resolve; });
  const server = createServer((req, res) => {
    requests++;
    notifyRequest();
    if (req.url === '/stalled-headers') return;
    if (req.url === '/empty') { res.writeHead(204); res.end(); return; }
    const status = req.url === '/unavailable' ? 503 : 200;
    res.writeHead(status, { 'content-type': 'application/json', 'content-range': '0-0/1' });
    if (req.url === '/stalled-body') { res.flushHeaders(); res.write('['); return; }
    res.end(JSON.stringify(status === 200 ? [{ id: 'published-video' }] : { code: 'SOURCE_UNAVAILABLE' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('HTTP fixture did not bind');
  const base = `http://127.0.0.1:${address.port}`;
  return {
    run: (path: string, init?: RequestInit) => api.run!(base + path, init),
    requested,
    get requests() { return requests; },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close(error => {
        if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
        else resolve();
      }));
    },
  };
}

test('source deadline includes a stalled response body after successful headers', async () => {
  const h = await harness();
  try {
    const response = await h.run('/stalled-body');
    expect(response.status).toBe(200);
    await expect(response.json()).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(h.requests).toBe(1);
  } finally { await h.close(); }
}, 3000);

test('a source that never sends headers is cancelled at the deadline', async () => {
  const h = await harness();
  try {
    await expect(h.run('/stalled-headers')).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(h.requests).toBe(1);
  } finally { await h.close(); }
}, 3000);

test('caller cancellation is preserved during source reads', async () => {
  const h = await harness();
  const caller = new AbortController();
  try {
    const work = h.run('/stalled-headers', { signal: caller.signal })
      .then(() => ({ name: 'UnexpectedSuccess' }), error => error);
    await h.requested;
    caller.abort();
    expect(await work).toMatchObject({ name: 'AbortError' });
    expect(h.requests).toBe(1);
  } finally { caller.abort(); await h.close(); }
}, 3000);

test('completed JSON and source HTTP failure remain unchanged', async () => {
  const h = await harness();
  try {
    for (const [path, status] of [['/healthy', 200], ['/unavailable', 503]] as const) {
      const body = JSON.stringify(status === 200 ? [{ id: 'published-video' }] : { code: 'SOURCE_UNAVAILABLE' });
      const result = await h.run(path);
      expect(result.status).toBe(status);
      expect(result.headers.get('content-range')).toBe('0-0/1');
      expect(await result.text()).toBe(body);
    }
  } finally { await h.close(); }
}, 3000);

test('bodyless responses retain their status and empty body', async () => {
  const h = await harness();
  try {
    const result = await h.run('/empty');
    expect(result.status).toBe(204);
    expect(await result.text()).toBe('');
  } finally { await h.close(); }
}, 3000);

test('the next read can recover after a stalled body times out', async () => {
  const h = await harness();
  try {
    const first = await h.run('/stalled-body');
    await expect(first.json()).rejects.toMatchObject({ name: 'TimeoutError' });
    const recovered = await h.run('/healthy');
    expect(await recovered.json()).toEqual([{ id: 'published-video' }]);
    expect(h.requests).toBe(2);
  } finally { await h.close(); }
}, 3000);

test('a caller already cancelled cannot issue a source request', async () => {
  const h = await harness();
  const caller = new AbortController();
  caller.abort();
  try {
    await expect(h.run('/healthy', { signal: caller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(h.requests).toBe(0);
    expect((await h.run('/healthy')).status).toBe(200);
    expect(h.requests).toBe(1);
  } finally { await h.close(); }
}, 3000);
