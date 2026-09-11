import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Exercise the actual parser with the two device transport boundaries. RN's
// legacy fetch can return SSE headers but no readable body (Android CI log).
function harness() {
  const source = readFileSync(new URL('../../expo/src/modules/ivx-owner-ai/services/ivxAIRequestService.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function fetchOwnerAIWithHeartbeat(');
  const code = source.slice(start, source.indexOf('\nfunction isTransientStatus(', start));
  const binding = source.match(/import\s*\{\s*fetch\s+as\s+(\w+)\s*\}\s*from\s*['"]expo\/fetch['"]/);
  const timers = new Set<unknown>(); const calls: any[] = []; const legacy: any[] = [];
  const logs: any[] = [];
  let stream!: ReadableStreamDefaultController<Uint8Array>; let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ start(c) { stream = c; }, cancel() { cancelled = true; } });
  const nativeFetch = async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(body, { headers: { 'content-type': 'text/event-stream' } }); };
  const api: any = {};
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(code) + '\napi.run = fetchOwnerAIWithHeartbeat;', {
    api, ...(binding ? { [binding[1]]: nativeFetch } : {}),
    fetch: async (...args: unknown[]) => { legacy.push(args); return { status: 200, headers: new Headers({ 'content-type': 'text/event-stream' }), body: null }; },
    assertRemoteRoutingAvailable() {}, getIVXOwnerAIEndpoint: () => 'https://api.ivxholding.com/api/ivx/owner-ai',
    AbortController, Response, TextDecoder, OWNER_AI_SSE_TIMEOUT_MS: 180000,
    createOwnerAICallerAbortError: (message = 'caller aborted') => Object.assign(new Error(message), { name: 'AbortError' }),
    logBackendPostProofStart() {}, logBackendPostProofThrow() {}, logBackendPostProofFinish() {},
    console: { log: (...args: unknown[]) => logs.push(args) },
    setTimeout: (fn: unknown) => { timers.add(fn); return fn; }, clearTimeout: (id: unknown) => timers.delete(id),
  });
  const events: any[] = [];
  return { calls, legacy, timers, events, logs, cancelled: () => cancelled,
    run: (signal?: AbortSignal) => api.run('fixture-owner-token', { requestId: 'fixture-request', conversationId: 'fixture-room', message: 'hello' }, (e: unknown) => events.push(e), signal),
    send: (event: unknown) => stream.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`)),
  };
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }

test('native SSE delivers a delta before final without legacy JSON fallback', async () => {
  const h = harness(); let settled = false;
  const pending = h.run().finally(() => { settled = true; }); pending.catch(() => {});
  h.send({ type: 'delta', delta: 'Hola' }); await flush();
  expect(h.events).toEqual([{ type: 'delta', delta: 'Hola' }]);
  expect(settled).toBe(false); expect(h.legacy).toHaveLength(0); expect(h.calls).toHaveLength(1);
  expect(h.logs[0][0]).toContain('OWNER_AI_SSE_FIRST_DELTA');
  expect(h.calls[0].url).toBe('https://api.ivxholding.com/api/ivx/owner-ai');
  expect(h.calls[0].init.headers.Authorization).toBe('Bearer fixture-owner-token');
  expect(JSON.parse(h.calls[0].init.body).requestId).toBe('fixture-request');
  h.send({ type: 'final', status: 200, ok: true, body: { answer: 'Hola', assistantPersisted: true } });
  const result = await pending;
  expect(await result.response.json()).toEqual({ answer: 'Hola', assistantPersisted: true });
  expect(h.cancelled()).toBe(true); expect(h.timers.size).toBe(0);
  expect(JSON.parse(h.logs[1][1])).toMatchObject({ requestId: 'fixture-request', deltaCount: 1, status: 200 });
  expect(JSON.stringify(h.logs)).not.toContain('fixture-owner-token');
  expect(JSON.stringify(h.logs)).not.toContain('Hola');
});

test('caller abort terminates a native stream while waiting for its next chunk', async () => {
  const h = harness(); const controller = new AbortController();
  const pending = h.run(controller.signal); pending.catch(() => {}); await flush();
  expect(h.calls).toHaveLength(1); controller.abort();
  await expect(pending).rejects.toThrow('caller aborted');
  expect(h.calls[0].init.signal.aborted).toBe(true); expect(h.timers.size).toBe(0);
});

test('native stream errors stay errors and cannot manufacture a final answer', async () => {
  const h = harness(); const pending = h.run(); pending.catch(() => {});
  h.send({ type: 'error', error: 'AI_UNAVAILABLE' });
  await expect(pending).rejects.toThrow('AI_UNAVAILABLE');
  expect(h.events).toEqual([{ type: 'error', error: 'AI_UNAVAILABLE' }]);
  expect(h.cancelled()).toBe(true); expect(h.timers.size).toBe(0);
});
