import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createCancellableEventStream } from './ivx-cancellable-event-stream';

// Exercise the actual canonical route transport without credentials, a live
// provider, or the unrelated tools imported by the full owner AI module.
function harness(signal?: AbortSignal) {
  const source = readFileSync(new URL('../api/ivx-owner-ai.ts', import.meta.url), 'utf8');
  const start = source.indexOf('async function handleIVXOwnerAIRequestSSE(');
  const end = source.indexOf('\n/**\n * V6.15 LIVE PROOF:', start);
  if (start < 0 || end < 0) throw new Error('Canonical SSE handler not found');
  const api: { run?: (request: Request, auditRequest: Request, startedAt: number) => Promise<Response> } = {};
  const timers = new Set<() => void>();
  const audits: Record<string, unknown>[] = [];
  let calls = 0;
  let resolve!: (response: Response) => void;
  let reject!: (error: Error) => void;
  let delta: ((text: string) => void) | undefined;
  const pending = new Promise<Response>((ok, fail) => { resolve = ok; reject = fail; });
  runInNewContext(new Bun.Transpiler({ loader: 'ts' }).transformSync(source.slice(start, end))
    + '\napi.run = handleIVXOwnerAIRequestSSE;', {
    api, Request, Response, ReadableStream, TextEncoder, Error, createCancellableEventStream,
    console: { log() {} }, DEPLOYMENT_MARKER: 'local-fixture',
    assertIVXOwnerOnly: async () => ({ userId: 'fixture-owner' }),
    logIVXOwnerAIUsageRow: async (row: Record<string, unknown>) => { audits.push(row); },
    handleIVXOwnerAIRequestInternal: () => { calls++; return pending; },
    runWithOwnerAIStreamCallback: (callback: (text: string) => void, run: () => Promise<Response>) => {
      delta = callback; return run();
    },
    setInterval: (callback: () => void) => { timers.add(callback); return callback; },
    clearInterval: (callback: () => void) => timers.delete(callback),
  });
  const request = new Request('https://api.invalid/api/ivx/owner-ai', {
    method: 'POST', body: JSON.stringify({ requestId: 'fixture-request', message: 'hello' }), signal,
  });
  return { timers, audits, resolve, reject, calls: () => calls, delta: (text: string) => delta?.(text),
    response: api.run!(request, new Request(request.url), Date.now()),
  };
}

async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function events(response: Response) {
  return (await response.text()).split('\n\n').filter(Boolean)
    .map(line => JSON.parse(line.slice('data: '.length)) as Record<string, unknown>);
}

test('canonical SSE preserves deltas and the durable final answer, then releases its heartbeat', async () => {
  const h = harness(); const response = await h.response; await flush();
  h.delta('Hola');
  h.resolve(Response.json({ status: 'ok', answer: 'Hola', assistantPersisted: true }));
  const result = await events(response);
  expect(result).toContainEqual({ type: 'delta', delta: 'Hola' });
  expect(result.at(-1)).toEqual({ type: 'final', status: 200, ok: true,
    body: { status: 'ok', answer: 'Hola', assistantPersisted: true } });
  expect(h.calls()).toBe(1); expect(h.timers.size).toBe(0);
});

test('reader cancellation clears the heartbeat before an admitted operation settles', async () => {
  const h = harness(); const response = await h.response; await flush();
  expect(h.calls()).toBe(1); expect(h.timers.size).toBe(1);
  const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
  expect(h.timers.size).toBe(0);
  // Completing the original operation may still persist its receipt. Closing
  // the transport neither retries it nor fabricates a cancellation receipt.
  expect(() => h.delta('late')).not.toThrow();
  h.resolve(Response.json({ answer: 'late', assistantPersisted: true })); await flush();
  expect(h.calls()).toBe(1); expect(h.timers.size).toBe(0);
});

test('HTTP abort closes the reader and heartbeat even when the producer remains pending', async () => {
  const abort = new AbortController(); const h = harness(abort.signal);
  const response = await h.response; await flush(); abort.abort();
  expect(h.timers.size).toBe(0);
  h.resolve(Response.json({ answer: 'late' }));
  const result = await events(response);
  expect(result.some(event => event.type === 'final')).toBe(false);
  expect(h.calls()).toBe(1);
});

test('a request already aborted never starts the canonical chat operation', async () => {
  const abort = new AbortController(); abort.abort();
  const h = harness(abort.signal); const response = await h.response; await flush();
  expect(h.calls()).toBe(0); expect(h.timers.size).toBe(0);
  h.resolve(Response.json({ answer: 'unused' }));
  expect(await events(response)).toEqual([]);
});

test('dependency failures keep their final status and do not become successful empty sessions', async () => {
  const h = harness(); const response = await h.response;
  const body = { ok: false, code: 'AUTH_SERVICE_UNAVAILABLE' };
  h.resolve(Response.json(body, { status: 503 }));
  expect((await events(response)).at(-1)).toEqual({ type: 'final', status: 503, ok: false, body });
  expect(h.timers.size).toBe(0);
});

test('invalid successful response bodies produce an explicit failed final event', async () => {
  for (const raw of ['private-upstream-body', '', 'null', '[]', '42']) {
    const h = harness(); const response = await h.response;
    h.resolve(new Response(raw, { status: 200 }));
    const result = await events(response); const final = result.at(-1);
    expect(final).toMatchObject({ type: 'final', status: 502, ok: false,
      body: { ok: false, status: 'error', code: 'OWNER_CHAT_RESPONSE_INVALID', executionOutcome: 'unknown' } });
    expect(JSON.stringify(result)).not.toContain('private-upstream-body');
    expect(result).not.toContainEqual({ type: 'stage', stage: 'provider_ok' });
    expect(h.timers.size).toBe(0);
  }
});

test('an error payload under HTTP 200 remains an error in the stream and its audit', async () => {
  for (const body of [{ ok: false, error: 'DEPENDENCY_BUSY' }, { status: 'error', error: 'DEPENDENCY_BUSY' }]) {
    const h = harness(); const response = await h.response;
    h.resolve(Response.json(body));
    const result = await events(response); await flush();
    expect(result.at(-1)).toEqual({ type: 'final', status: 200, ok: false, body });
    expect(result).not.toContainEqual({ type: 'stage', stage: 'provider_ok' });
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ status: 'error', error: 'owner_chat_response_failed' });
  }
});

test('unexpected exceptions terminate the stream with a structured error without private detail', async () => {
  const h = harness(); const response = await h.response;
  h.reject(new Error('private-database-connection-string'));
  const result = await events(response);
  expect(result.at(-1)).toMatchObject({ type: 'final', status: 500, ok: false,
    body: { ok: false, status: 'error', code: 'OWNER_CHAT_RESPONSE_UNAVAILABLE' } });
  expect(JSON.stringify(result)).not.toContain('private-database-connection-string');
  expect(h.timers.size).toBe(0);
});
