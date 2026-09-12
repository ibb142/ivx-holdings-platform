// mock.module is process-global; the discovered wrapper isolates these stubs.
import { beforeEach, expect, mock, test } from 'bun:test';

type Chunk = { type: 'delta' | 'done' | 'error'; delta?: string; text?: string; error?: string };
type Input = { abortSignal?: AbortSignal; maxOutputTokens?: number };
const rows = new Map<string, Record<string, unknown>>();
let providerCalls = 0;
let writes = 0;
let failCompletion = false;
let authError: Error | null = null;
let providerFails = false;
let providerGate: Promise<void> = Promise.resolve();
let releaseProvider: () => void = () => {};
let ownerId = 'owner-stream-fixture';
let onReceiptStored: () => void = () => {};
let lastProviderSignal: AbortSignal | undefined;
const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));

const client = { from: () => {
  let operation = 'read';
  let value: Record<string, any> = {};
  const filters = new Map<string, string>();
  const run = () => {
    const key = String(value.doc_key ?? filters.get('doc_key'));
    const row = rows.get(key);
    if (operation === 'insert') {
      writes++;
      if (row) return { data: null, error: { code: '23505' } };
      rows.set(key, clone(value.value));
      return { data: [{ doc_key: key }], error: null };
    }
    if (operation === 'update') {
      writes++;
      if (failCompletion) return { data: null, error: { message: 'injected unavailable write' } };
      if (row?.token !== filters.get('value->>token') || row?.state !== filters.get('value->>state')) {
        return { data: [], error: null };
      }
      rows.set(key, clone(value.value));
      onReceiptStored();
      return { data: [{ doc_key: key }], error: null };
    }
    return { data: row ? { value: clone(row) } : null, error: null };
  };
  const query: any = {
    insert: (next: Record<string, unknown>) => { operation = 'insert'; value = next; return query; },
    update: (next: Record<string, unknown>) => { operation = 'update'; value = next; return query; },
    eq: (key: string, next: string) => { filters.set(key, next); return query; },
    select: () => query,
    limit: () => query,
    abortSignal: () => query,
    maybeSingle: async () => run(),
    then: (resolve: (next: unknown) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve().then(run).then(resolve, reject),
  };
  return query;
} };

const normal = async function* (input: Input): AsyncGenerator<Chunk> {
  providerCalls++;
  lastProviderSignal = input.abortSignal;
  yield { type: 'delta', delta: 'real fixture delta' };
  if (input.abortSignal?.aborted) return;
  await Promise.race([
    providerGate,
    new Promise<void>(resolve => input.abortSignal?.addEventListener('abort', () => resolve(), { once: true })),
  ]);
  if (input.abortSignal?.aborted) return;
  if (providerFails) { yield { type: 'error', error: 'injected provider outage' }; return; }
  yield { type: 'done', text: 'real fixture delta' };
};
const provider = mock(normal);

mock.module('../ivx-ai-runtime', () => ({
  computeAdaptiveTimeoutMs: () => 1000,
  streamIVXAIText: provider,
}));
mock.module('./owner-only', () => ({
  assertIVXOwnerOnly: async () => {
    if (authError) throw authError;
    return { userId: ownerId, client };
  },
  ownerOnlyJson: (body: unknown, status = 200) => Response.json(body, { status }),
  ownerOnlyOptions: () => new Response(null, { status: 204 }),
}));
const { handleIVXOwnerAIStreamRequest } = await import('./ivx-owner-ai-stream');

function request(requestId = 'message-1', message = 'fixture prompt', signal?: AbortSignal) {
  return new Request('https://ivx.test/api/ivx/owner-ai/stream', {
    method: 'POST', signal, headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requestId, message, maxOutputTokens: 64 }),
  });
}
const events = (text: string): any[] => text.split('\n').filter(line => line.startsWith('data:'))
  .map(line => JSON.parse(line.slice(5)));

beforeEach(() => {
  rows.clear(); providerCalls = 0; writes = 0; failCompletion = false; authError = null;
  providerFails = false; providerGate = Promise.resolve(); releaseProvider = () => {};
  ownerId = 'owner-stream-fixture'; onReceiptStored = () => {}; lastProviderSignal = undefined;
  provider.mockClear(); provider.mockImplementation(normal);
});

test('Owner authorization rejects before admission and provider work', async () => {
  authError = new Error('Missing bearer token');
  expect((await handleIVXOwnerAIStreamRequest(request())).status).toBe(401);
  expect(providerCalls).toBe(0); expect(writes).toBe(0);
});

test('normal completion persists before done and keeps the SSE contract', async () => {
  const result = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(result.map(event => event.type)).toEqual(['start', 'delta', 'done']);
  expect(result.find(event => event.type === 'done')?.receiptPersisted).toBe(true);
  expect(result.find(event => event.type === 'done')?.assistantPersisted).toBe(false);
  expect(provider.mock.calls[0][0].maxOutputTokens).toBe(64);
  expect(lastProviderSignal?.aborted).toBe(false);
});

test('two concurrent streams for one identity execute the provider once', async () => {
  providerGate = new Promise(resolve => { releaseProvider = resolve; });
  try {
    const first = await handleIVXOwnerAIStreamRequest(request());
    const reader = first.body!.getReader(); await reader.read(); await reader.read();
    const second = await handleIVXOwnerAIStreamRequest(request());
    expect(providerCalls).toBe(1);
    expect(events(await second.text()).some(event => event.type === 'error' && event.status === 409)).toBe(true);
    releaseProvider(); while (!(await reader.read()).done) { /* drain original */ }
  } finally { releaseProvider(); }
});

test('terminal replay keeps the original text without calling the provider again', async () => {
  const first = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  const second = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(providerCalls).toBe(1);
  expect(first.find(event => event.type === 'done')?.text).toBe('real fixture delta');
  expect(second.find(event => event.type === 'done')?.replayed).toBe(true);
});

test('missing stable identity is rejected before provider or storage', async () => {
  expect((await handleIVXOwnerAIStreamRequest(request(''))).status).toBe(400);
  expect(providerCalls).toBe(0); expect(writes).toBe(0);
});

test('auth outage preserves 503 and never reaches admission or provider', async () => {
  authError = Object.assign(new Error('Auth service unavailable'), { status: 503 });
  expect((await handleIVXOwnerAIStreamRequest(request())).status).toBe(503);
  expect(providerCalls).toBe(0); expect(writes).toBe(0);
});

test('failed result persistence emits an explicit unknown outcome instead of done', async () => {
  failCompletion = true;
  const result = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(result.some(event => event.type === 'delta')).toBe(true);
  expect(result.some(event => event.type === 'done')).toBe(false);
  expect(result.some(event => event.code === 'OWNER_CHAT_RECONCILIATION_REQUIRED')).toBe(true);
});

test('deltas arrive before the provider completes', async () => {
  providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const response = await handleIVXOwnerAIStreamRequest(request());
  const reader = response.body!.getReader();
  try {
    const first = await reader.read(); const second = await reader.read();
    const text = new TextDecoder().decode(first.value) + new TextDecoder().decode(second.value);
    expect(events(text).some(event => event.type === 'delta')).toBe(true);
    expect(events(text).some(event => event.type === 'done')).toBe(false);
    releaseProvider(); while (!(await reader.read()).done) { /* drain */ }
  } finally { releaseProvider(); }
});

test('reusing one identity with changed content is rejected', async () => {
  await (await handleIVXOwnerAIStreamRequest(request())).text();
  const changed = events(await (await handleIVXOwnerAIStreamRequest(request('message-1', 'different prompt'))).text());
  expect(providerCalls).toBe(1);
  expect(changed.some(event => event.code === 'OWNER_CHAT_IDENTITY_CONFLICT')).toBe(true);
});

test('identical message ids of different owners remain isolated', async () => {
  await (await handleIVXOwnerAIStreamRequest(request())).text(); ownerId = 'another-owner';
  const result = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(providerCalls).toBe(2); expect(result.some(event => event.type === 'done')).toBe(true);
});

for (const source of ['request', 'reader']) {
  test(`${source} cancellation aborts admitted provider work and persists its terminal failure`, async () => {
    providerGate = new Promise(resolve => { releaseProvider = resolve; });
    const persisted = new Promise<void>(resolve => { onReceiptStored = resolve; });
    const controller = new AbortController();
    const response = await handleIVXOwnerAIStreamRequest(request('message-1', 'fixture prompt', controller.signal));
    const reader = response.body!.getReader(); await reader.read(); await reader.read();
    if (source === 'request') controller.abort(new Error('client left'));
    else await reader.cancel(new Error('client left'));
    await persisted;
    expect(lastProviderSignal?.aborted).toBe(true);
    const replay = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
    expect(providerCalls).toBe(1);
    expect(replay.some(event => event.type === 'done')).toBe(false);
    expect(replay.some(event => event.code === 'OWNER_STREAM_PROVIDER_FAILED')).toBe(true);
  });
}

test('an already aborted HTTP request never reaches admission or provider work', async () => {
  const controller = new AbortController(); const aborted = request('message-1', 'fixture prompt', controller.signal);
  controller.abort();
  expect(await (await handleIVXOwnerAIStreamRequest(aborted)).text()).toBe('');
  expect(providerCalls).toBe(0); expect(writes).toBe(0);
});

test('a provider error is explicit and retry does not invoke another provider', async () => {
  providerFails = true;
  const first = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  const replay = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(providerCalls).toBe(1);
  for (const result of [first, replay]) {
    expect(result.some(event => event.type === 'done')).toBe(false);
    expect(result.some(event => event.code === 'OWNER_STREAM_PROVIDER_FAILED')).toBe(true);
  }
});
