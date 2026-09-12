import { test, expect } from 'bun:test';
import { createServer } from 'node:http';
import { newReadTimings, readTimings, measuredReadFetch, timingHeaders, recordPoolCheckout, boundedReadFetch } from './ivx-read-timings';

test('headers distinguish actual body consumption from invisible upstream pool wait', async () => {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{"ok":');
    setTimeout(() => res.end('true}'), 40);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const metrics = newReadTimings();
    await readTimings.run(metrics, async () => {
      const r = await measuredReadFetch(`http://127.0.0.1:${(server.address() as any).port}`);
      expect(await r.json()).toEqual({ ok: true });
    });
    expect(metrics.completed).toBe(1); expect(metrics.pending).toBe(0);
    expect(metrics.payloadMs).toBeGreaterThan(15);
    expect(timingHeaders(metrics)['X-IVX-Pool-Wait-Ms']).toBe('unavailable');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('per-request contexts cannot inherit another request checkout or cached timings', async () => {
  const a = newReadTimings(), b = newReadTimings();
  await Promise.all([readTimings.run(a, async () => { await Promise.resolve(); recordPoolCheckout(12); }),
    readTimings.run(b, async () => { await Promise.resolve(); recordPoolCheckout(3); })]);
  expect(timingHeaders(a)['X-IVX-Pool-Wait-Ms']).toBe('12.0');
  expect(timingHeaders(b)['X-IVX-Pool-Wait-Ms']).toBe('3.0');
  expect(timingHeaders(newReadTimings())['X-IVX-Payload-Ms']).toBe('unavailable');
});

test('body abort rejects instead of reporting a successful upstream payload', async () => {
  const server = createServer((_req, res) => { res.writeHead(200); res.write('{'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const metrics = newReadTimings();
    await expect(readTimings.run(metrics, async () => {
      const r = await measuredReadFetch(`http://127.0.0.1:${(server.address() as any).port}`, { signal: AbortSignal.timeout(50) });
      await r.json();
    })).rejects.toThrow();
    expect(metrics.pending).toBe(0);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});


test('real Supabase SDK cannot retry a wrapper deadline as a network failure', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  const originalFetch = globalThis.fetch;
  const stop = new AbortController();
  let calls = 0;
  globalThis.fetch = ((_input: unknown, init: RequestInit) => {
    calls++;
    return new Promise<Response>((_resolve, reject) => {
      const signal = init.signal!;
      if (signal.aborted) reject(signal.reason);
      else signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  }) as typeof fetch;
  let watchdog: ReturnType<typeof setTimeout> | undefined;
  try {
    const sb = createClient('https://example.supabase.co', 'test-public-key', {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { fetch: (input, init) => boundedReadFetch(input, init, 15) },
    });
    const query = Promise.resolve(sb.from('project_videos').select('id').abortSignal(stop.signal));
    const result = await Promise.race([query, new Promise<null>(resolve => {
      watchdog = setTimeout(() => { stop.abort(); resolve(null); }, 200);
    })]);
    await query;
    expect(result).not.toBeNull();
    expect(result?.error).not.toBeNull();
    expect(calls).toBe(1);
  } finally { clearTimeout(watchdog); stop.abort(); globalThis.fetch = originalFetch; }
});
