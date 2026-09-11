import { beforeEach, expect, mock, test } from 'bun:test';

const rows = new Map<string, Record<string, unknown>>();
let providerCalls = 0, writes = 0;
let failCompletion = false;
let authError: Error | null = null;
let providerGate: Promise<void> = Promise.resolve();
let releaseProvider: () => void = () => {};
let ownerId = 'owner-stream-fixture';
let providerFails = false;
let onReceiptStored: () => void = () => {};
const clone = (value: unknown): any => JSON.parse(JSON.stringify(value));
const client = { from: () => {
  let operation = 'read'; let value: Record<string, any> = {}; const filters = new Map<string, string>();
  const run = () => {
    const key = String(value.doc_key ?? filters.get('doc_key'));
    const row = rows.get(key);
    if (operation === 'insert') {
      writes++;
      if (row) return { data: null, error: { code: '23505' } };
      rows.set(key, clone(value.value)); return { data: [{ doc_key: key }], error: null };
    }
    if (operation === 'update') {
      writes++;
      if (failCompletion) return { data: null, error: { message: 'injected unavailable write' } };
      if (row?.token !== filters.get('value->>token') || row?.state !== filters.get('value->>state')) return { data: [], error: null };
      rows.set(key, clone(value.value)); onReceiptStored(); return { data: [{ doc_key: key }], error: null };
    }
    return { data: row ? { value: clone(row) } : null, error: null };
  };
  const query: any = {
    insert: (v: Record<string, unknown>) => { operation = 'insert'; value = v; return query; },
    update: (v: Record<string, unknown>) => { operation = 'update'; value = v; return query; },
    eq: (k: string, v: string) => { filters.set(k, v); return query; },
    select: () => query, limit: () => query, abortSignal: () => query,
    maybeSingle: async () => run(),
    then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject),
  };
  return query;
} };
mock.module('./owner-only', () => ({
  ownerOnlyOptions: () => new Response(null, { status: 204 }),
  ownerOnlyJson: (body: unknown, status = 200) => Response.json(body, { status }),
  assertIVXOwnerOnly: async () => { if (authError) throw authError; return { userId: ownerId, client }; },
}));
mock.module('../ivx-ai-runtime', () => ({
  computeAdaptiveTimeoutMs: () => 1000,
  streamIVXAIText: async function* () {
    providerCalls++;
    yield { type: 'delta', delta: 'real fixture delta' };
    await providerGate;
    if (providerFails) { yield { type: 'error', error: 'injected provider outage' }; return; }
    yield { type: 'done', text: 'real fixture delta', usage: { outputTokens: 3 } };
  },
}));
const { handleIVXOwnerAIStreamRequest } = await import('./ivx-owner-ai-stream');
const request = (requestId = 'message-1', message = 'fixture prompt') => new Request('https://api.invalid/api/ivx/owner-ai/stream', {
  method: 'POST', body: JSON.stringify({ requestId, message }),
});
const events = (text: string): any[] => text.split('\n').filter(x => x.startsWith('data:')).map(x => JSON.parse(x.slice(5)));
beforeEach(() => {
  rows.clear(); providerCalls = 0; writes = 0; failCompletion = false; authError = null;
  ownerId = 'owner-stream-fixture'; providerGate = Promise.resolve(); releaseProvider = () => {};
  providerFails = false; onReceiptStored = () => {};
});

test('two concurrent streams for one identity execute the provider once', async () => {
  providerGate = new Promise(resolve => { releaseProvider = resolve; });
  try {
    const first = await handleIVXOwnerAIStreamRequest(request());
    const reader = first.body!.getReader(); await reader.read(); await reader.read();
    const second = await handleIVXOwnerAIStreamRequest(request());
    await Promise.resolve();
    expect(providerCalls).toBe(1);
    const duplicate = events(await second.text());
    expect(duplicate.some(x => x.type === 'error' && x.status === 409)).toBe(true);
    releaseProvider(); while (!(await reader.read()).done) { /* drain original */ }
  } finally { releaseProvider(); }
});
test('terminal replay keeps the original text without calling the provider again', async () => {
  const first = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  const second = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(providerCalls).toBe(1);
  expect(first.find(x => x.type === 'done')?.text).toBe('real fixture delta');
  expect(second.find(x => x.type === 'done')?.replayed).toBe(true);
  expect(second.find(x => x.type === 'done')?.receiptPersisted).toBe(true);
  expect(second.find(x => x.type === 'done')?.assistantPersisted).toBe(false);
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
  expect(result.some(x => x.type === 'delta')).toBe(true);
  expect(result.some(x => x.type === 'done')).toBe(false);
  expect(result.some(x => x.type === 'error' && x.code === 'OWNER_CHAT_RECONCILIATION_REQUIRED')).toBe(true);
});
test('deltas arrive while the provider has not completed', async () => {
  providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const response = await handleIVXOwnerAIStreamRequest(request());
  const reader = response.body!.getReader();
  try {
    const first = await reader.read(); const second = await reader.read();
    const text = new TextDecoder().decode(first.value) + new TextDecoder().decode(second.value);
    expect(events(text).some(x => x.type === 'delta')).toBe(true);
    expect(events(text).some(x => x.type === 'done')).toBe(false);
    releaseProvider(); while (!(await reader.read()).done) { /* drain */ }
  } finally { releaseProvider(); }
});
test('reusing one identity with changed content is rejected', async () => {
  await (await handleIVXOwnerAIStreamRequest(request())).text();
  const changed = events(await (await handleIVXOwnerAIStreamRequest(request('message-1', 'different prompt'))).text());
  expect(providerCalls).toBe(1);
  expect(changed.some(x => x.code === 'OWNER_CHAT_IDENTITY_CONFLICT')).toBe(true);
});
test('identical message ids of different owners remain isolated', async () => {
  await (await handleIVXOwnerAIStreamRequest(request())).text(); ownerId = 'another-owner';
  const result = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(providerCalls).toBe(2); expect(result.some(x => x.type === 'done')).toBe(true);
});

test('disconnect after a delta preserves the receipt for reconnection', async () => {
  providerGate = new Promise(resolve => { releaseProvider = resolve; });
  const persisted = new Promise<void>(resolve => { onReceiptStored = resolve; });
  const response = await handleIVXOwnerAIStreamRequest(request());
  const reader = response.body!.getReader(); await reader.read(); await reader.read();
  await reader.cancel(); releaseProvider(); await persisted;
  const replay = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(providerCalls).toBe(1);
  expect(replay.some(x => x.type === 'done' && x.replayed === true)).toBe(true);
});

test('a provider error is explicit and its retry does not invoke another provider', async () => {
  providerFails = true;
  const first = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  const replay = events(await (await handleIVXOwnerAIStreamRequest(request())).text());
  expect(providerCalls).toBe(1);
  for (const result of [first, replay]) {
    expect(result.some(x => x.type === 'done')).toBe(false);
    expect(result.some(x => x.type === 'error' && x.code === 'OWNER_STREAM_PROVIDER_FAILED')).toBe(true);
  }
});
