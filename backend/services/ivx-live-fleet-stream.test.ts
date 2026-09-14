import { expect, test } from 'bun:test';
import { createLiveFleetStream } from './ivx-live-fleet-stream';

test('emits snapshots and closes on a subsequent owner authorization failure', async () => {
  let reads = 0;
  const stream = createLiveFleetStream({ signal: new AbortController().signal, initial: { ok: true }, intervalMs: 2,
    read: async () => ++reads === 1 ? Response.json({ ok: true, dashboard: { changed: true } }) : Response.json({ ok: false }, { status: 403 }) });
  const text = await new Response(stream).text();
  expect(text).toContain('"sequence":1'); expect(text).toContain('"sequence":2');
  expect(text).toContain('"status":403'); expect(reads).toBe(2);
});
test('a stalled observer read is bounded and cannot launch overlapping reads', async () => {
  let reads = 0;
  const stream = createLiveFleetStream({ signal: new AbortController().signal, initial: { ok: true }, intervalMs: 2, readTimeoutMs: 5,
    read: () => { reads++; return new Promise<Response>(() => {}); } });
  const text = await new Response(stream).text();
  expect(text).toContain('"type":"error"'); expect(reads).toBe(1);
});
test('cancelling an idle subscriber stops future database reads', async () => {
  let reads = 0;
  const stream = createLiveFleetStream({ signal: new AbortController().signal, initial: { ok: true }, intervalMs: 5,
    read: async () => { reads++; return Response.json({ ok: true }); } });
  const reader = stream.getReader(); await reader.read(); await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 12));
  expect(reads).toBe(0);
});
