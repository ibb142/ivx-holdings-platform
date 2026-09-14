import { expect, test } from 'bun:test';
import { createOwnerChatProgressStream } from './ivx-owner-chat-progress-stream';

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(finish => { resolve = finish; });
  return { promise, resolve };
};
const records = (text: string) => text.trim().split('\n\n').map(line => JSON.parse(line.slice(6)));

test('delivers provider deltas before completion and preserves the real failure status', async () => {
  const result = deferred<Response>();
  const stream = createOwnerChatProgressStream({ signal: new AbortController().signal, startedAt: Date.now(), requestId: 'one',
    execute: async emit => { emit('real delta'); return result.promise; } });
  const reader = stream.getReader(), decoder = new TextDecoder();
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) seen.push(decoder.decode((await reader.read()).value));
  expect(seen.join('')).toContain('real delta');
  expect(seen.join('')).not.toContain('"type":"final"');
  result.resolve(Response.json({ ok: false, error: 'ADMISSION_BLOCKED' }, { status: 429 }));
  while (true) { const chunk = await reader.read(); if (chunk.done) break; seen.push(decoder.decode(chunk.value)); }
  const final = records(seen.join('')).filter(r => r.type === 'final');
  expect(final).toEqual([{ type: 'final', status: 429, ok: false, body: { ok: false, error: 'ADMISSION_BLOCKED' } }]);
});

test('bounds a stalled operation and never claims completion or a fixed commit', async () => {
  const result = deferred<Response>(), settled = deferred<number>();
  const stream = createOwnerChatProgressStream({ signal: new AbortController().signal, startedAt: Date.now(), requestId: 'stable-key',
    execute: () => result.promise, onSettled: status => { settled.resolve(status); }, heartbeatMs: 2, timeoutMs: 15 });
  const text = await new Response(stream).text();
  const final = records(text).filter(r => r.type === 'final');
  expect(final).toHaveLength(1);
  expect(final[0]).toMatchObject({ status: 504, ok: false, body: { requestId: 'stable-key', executionConfirmed: false } });
  expect(text).not.toContain('commit_hash');
  result.resolve(Response.json({ ok: true, answer: 'durable result' }));
  expect(await settled.promise).toBe(200);
});

test('HTTP abort closes the transport while admitted work can still settle once', async () => {
  const owner = new AbortController(), result = deferred<Response>(), settled = deferred<number>();
  const stream = createOwnerChatProgressStream({ signal: owner.signal, startedAt: Date.now(), requestId: 'one',
    execute: () => result.promise, onSettled: status => { settled.resolve(status); } });
  const body = new Response(stream).text(); owner.abort();
  expect(await body).not.toContain('"type":"final"');
  result.resolve(Response.json({ ok: true }));
  expect(await settled.promise).toBe(200);
});

test('reader cancellation clears transport resources without starting a second operation', async () => {
  const result = deferred<Response>(); let executions = 0;
  const stream = createOwnerChatProgressStream({ signal: new AbortController().signal, startedAt: Date.now(), requestId: 'one',
    execute: () => { executions++; return result.promise; }, heartbeatMs: 2, timeoutMs: 10 });
  const reader = stream.getReader(); await reader.read(); await reader.cancel();
  result.resolve(Response.json({ ok: true }));
  await Promise.resolve();
  expect(executions).toBe(1);
  expect((await reader.read()).done).toBe(true);
});

test('invalid provider JSON is a 502, never a successful completion', async () => {
  const stream = createOwnerChatProgressStream({ signal: new AbortController().signal, startedAt: Date.now(), requestId: 'one',
    execute: async () => new Response('invalid JSON') });
  const final = records(await new Response(stream).text()).find(r => r.type === 'final');
  expect(final.status).toBe(502); expect(final.ok).toBe(false);
});

test('an already disconnected request never executes', async () => {
  const owner = new AbortController(); owner.abort(); let calls = 0;
  const stream = createOwnerChatProgressStream({ signal: owner.signal, startedAt: Date.now(), requestId: 'one',
    execute: async () => { calls++; return Response.json({ ok: true }); } });
  expect(await new Response(stream).text()).toBe(''); expect(calls).toBe(0);
});
