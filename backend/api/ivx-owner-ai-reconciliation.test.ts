import { beforeEach, expect, mock, test } from 'bun:test';
import { ownerChatRequestKey } from '../services/ivx-owner-chat-admission';
import { IVX_OWNER_AI_ROOM_ID } from '../../expo/constants/ivx-owner-ai';

let ownerId = 'owner-a';
let authFailed = false;
let reads = 0;
let enqueues = 0;
let retries = 0;
let cancellations = 0;
const rows = new Map<string, unknown>();
mock.module('./owner-only', () => ({
  ownerOnlyOptions: () => new Response(null, { status: 204 }),
  ownerOnlyJson: (body: unknown, status = 200) => Response.json(body, { status }),
  assertIVXOwnerOnly: async () => {
    if (authFailed) throw Object.assign(new Error('auth required'), { status: 401 });
    return { userId: ownerId, client: { from: () => {
      let key = '';
      const query = { select: () => query, eq: (_: string, value: string) => { key = value; return query; },
        limit: () => query, abortSignal: () => query,
        maybeSingle: async () => { reads++; return { data: rows.has(key) ? { value: rows.get(key) } : null, error: null }; } };
      return query;
    } } };
  },
}));
mock.module('../services/ivx-owner-ai-task-queue', () => ({
  enqueueOwnerAITask: async () => { enqueues++; throw new Error('must not enqueue on uncertain primary delivery'); },
  getTask: async () => null, listTasks: async () => [],
  retryTask: async () => { retries++; return {}; }, cancelTask: async () => { cancellations++; return null; },
  recoverOrphanTasks: async () => 0, replayDeadLetterTasks: async () => 0, listOwnerAIIncidents: () => [],
  isTaskQueueConfigured: () => false, getWorkerRuntimeInfo: () => ({}), isTerminalTaskStatus: () => false,
}));
const { handleOwnerAITaskCreate, handleOwnerAITaskStatus, handleOwnerAITaskRetry, handleOwnerAITaskCancel } = await import('./ivx-owner-ai-durable');
const request = () => new Request('https://api.invalid/api/ivx/owner-ai/tasks', { method: 'POST',
  body: JSON.stringify({ message: 'original prompt', primaryRequestId: 'message-1' }) });
const key = () => ownerChatRequestKey('owner-a', IVX_OWNER_AI_ROOM_ID, 'message-1');
beforeEach(() => { rows.clear(); reads = 0; enqueues = 0; retries = 0; cancellations = 0; ownerId = 'owner-a'; authFailed = false; });

test('fallback returns the pending primary receipt without another task or provider', async () => {
  rows.set(key(), { version: 1, state: 'running' });
  const result = await handleOwnerAITaskCreate(request());
  expect(result.status).toBe(202);
  const data = await result.json();
  expect(data.task.taskId).toBe('owner-request:message-1');
  expect(data.task.checkpoint).toBe('ORIGINAL_REQUEST_PENDING');
  expect(enqueues).toBe(0);
});

test('a missing receipt is an unknown outcome, never permission for fallback execution', async () => {
  const result = await handleOwnerAITaskCreate(request());
  expect(result.status).toBe(503);
  expect((await result.json()).code).toBe('OWNER_CHAT_RECONCILIATION_REQUIRED');
  expect(enqueues).toBe(0);
});

test('reopening polls the original response and preserved assistant message', async () => {
  rows.set(key(), { version: 1, state: 'completed', response: { status: 200,
    body: JSON.stringify({ status: 'ok', answer: 'original result', assistantMessageId: 'assistant-1', assistantPersisted: true }) } });
  const result = await handleOwnerAITaskStatus(request(), 'owner-request:message-1');
  expect(result.status).toBe(200);
  const task = (await result.json()).task;
  expect(task.answer).toBe('original result'); expect(task.assistantMessageId).toBe('assistant-1');
  expect(enqueues).toBe(0);
});

test('another owner cannot poll this receipt using the same external request id', async () => {
  rows.set(key(), { version: 1, state: 'running' }); ownerId = 'owner-b';
  expect((await handleOwnerAITaskStatus(request(), 'owner-request:message-1')).status).toBe(503);
  expect(enqueues).toBe(0);
});

test('authentication fails before reading the ledger', async () => {
  authFailed = true;
  expect((await handleOwnerAITaskStatus(request(), 'owner-request:message-1')).status).toBe(401);
  expect(reads).toBe(0); expect(enqueues).toBe(0);
});

test('a failed original response preserves its real HTTP status, diagnostic code and request identity', async () => {
  rows.set(key(), { version: 1, state: 'completed', identity: { requestId: 'message-1' }, response: { status: 503,
    body: JSON.stringify({ ok: false, code: 'PROVIDER_UNAVAILABLE', error: 'Provider unavailable', traceId: 'trace-1' }) } });
  const response = await handleOwnerAITaskStatus(request(), 'owner-request:message-1');
  expect((await response.json()).task).toMatchObject({ status: 'FAILED', httpStatus: 503,
    requestId: 'message-1', traceId: 'trace-1', errorCode: 'PROVIDER_UNAVAILABLE',
    errorMessage: 'Provider unavailable', checkpoint: 'ORIGINAL_REQUEST_FAILED', canRetry: false, canCancel: false });
});

test('legacy corrupt or null JSON receipts fail visibly instead of crashing reconciliation', async () => {
  for (const body of ['null', '[]', 'not-json', '{"ok":true}']) {
    rows.set(key(), { version: 1, state: 'completed', response: { status: 200, body } });
    const response = await handleOwnerAITaskStatus(request(), 'owner-request:message-1');
    expect(response.status).toBe(200);
    expect((await response.json()).task).toMatchObject({ status: 'FAILED', answer: null });
  }
});

test('the production incident receipt recovers the budget diagnosis hidden in old router metadata', async () => {
  rows.set(key(), { version: 1, state: 'completed', response: { status: 503,
    body: JSON.stringify({ status: 'error', answer: 'The text reply could not be completed and saved.',
      routerDebug: { reason: 'LLM call failed for knowledge question (conversation). No deploy, no commit, no task creation. Error: Global AI budget: durable admission unavailable' } }) } });
  const response = await handleOwnerAITaskStatus(request(), 'owner-request:message-1');
  expect((await response.json()).task).toMatchObject({ status: 'FAILED', httpStatus: 503,
    errorCode: 'IVX_AI_BUDGET_ADMISSION_UNAVAILABLE', errorMessage: 'Global AI budget: durable admission unavailable',
    canRetry: false, canCancel: false });
  expect(enqueues).toBe(0);
});

test('retry and cancel on an original receipt cannot mutate the unrelated legacy queue', async () => {
  for (const handle of [handleOwnerAITaskRetry, handleOwnerAITaskCancel]) {
    const response = await handle(request(), 'owner-request:message-1');
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('OWNER_CHAT_RECEIPT_ACTION_UNSUPPORTED');
  }
  expect(retries).toBe(0); expect(cancellations).toBe(0);
});
