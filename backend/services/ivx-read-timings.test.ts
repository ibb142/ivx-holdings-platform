import { test, expect } from 'bun:test';
import { createServer } from 'node:http';
import { newReadTimings, readTimings, measuredReadFetch, timingHeaders, recordPoolCheckout } from './ivx-read-timings';

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
