import { afterAll, beforeEach, expect, mock, test } from 'bun:test';

const storage = new Map<string, string>();
mock.module('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => storage.get(key) ?? null,
  setItem: async (key: string, value: string) => { storage.set(key, value); },
} }));
mock.module('../lib/ivx-supabase-client', () => ({
  getIVXAccessToken: async () => 'fixture-token', IVX_CANONICAL_API_BASE_URL: 'https://api.invalid',
}));
const originalFetch = globalThis.fetch;
const calls: { url: string; body: Record<string, unknown> | null }[] = [];
let intake: unknown;
let intakeStatus = 200;
beforeEach(() => {
  storage.clear(); calls.length = 0; intakeStatus = 200;
  intake = { task: { taskId: 'owner-request:message-1', status: 'FAILED', terminal: true,
    checkpoint: 'ORIGINAL_REQUEST_FAILED', errorMessage: 'Provider unavailable', httpStatus: 503,
    errorCode: 'PROVIDER_UNAVAILABLE', source: 'original_owner_chat_request' } };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    if (calls.length > 1) throw new Error('The completed result must not require another network call');
    return Response.json(intake, { status: intakeStatus });
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = originalFetch; });
const { runDurableOwnerAIFallback } = await import('../src/modules/ivx-owner-ai/services/ivxDurableTaskService');
const input = { message: 'original instruction', primaryRequestId: 'message-1', conversationId: 'owner-room' };

test('terminal intake failure is used immediately and retains real diagnostics', async () => {
  const result = await runDurableOwnerAIFallback(input);
  expect(calls).toHaveLength(1); expect(calls[0].body?.primaryRequestId).toBe('message-1');
  expect(result).toMatchObject({ ok: false, status: 'FAILED', httpStatus: 503, errorCode: 'PROVIDER_UNAVAILABLE' });
  expect([...storage.values()].join('')).not.toContain('message-1');
});

test('terminal success retains the assistant id and does not depend on a second fetch', async () => {
  intake = { task: { taskId: 'owner-request:message-1', terminal: true, status: 'COMPLETED',
    answer: 'Saved answer', assistantMessageId: 'assistant-1', assistantPersisted: true } };
  const result = await runDurableOwnerAIFallback(input);
  expect(result).toMatchObject({ ok: true, answer: 'Saved answer', assistantMessageId: 'assistant-1' });
  expect(calls).toHaveLength(1);
});

test('an unavailable lookup preserves the original identity locally without creating replacement work', async () => {
  intake = { error: 'Receipt unavailable' }; intakeStatus = 503;
  const result = await runDurableOwnerAIFallback(input);
  expect(result).toMatchObject({ ok: false, taskId: 'owner-request:message-1' });
  expect([...storage.values()].join('')).toContain('owner-request:message-1');
  expect(calls).toHaveLength(1);
});

test('a malformed success payload cannot poll a missing task id or fabricate a reply', async () => {
  intake = { task: { terminal: true, status: 'COMPLETED', answer: 'unbound answer' } };
  const result = await runDurableOwnerAIFallback(input);
  expect(result).toMatchObject({ ok: false, answer: null, taskId: 'owner-request:message-1' });
  expect(calls).toHaveLength(1);
});
