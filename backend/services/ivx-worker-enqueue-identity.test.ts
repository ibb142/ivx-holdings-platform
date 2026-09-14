import { expect, test } from 'bun:test';
import { resolveWorkerEnqueueIdentity } from './ivx-worker-enqueue-identity';

test('preserves an existing autonomous task and its reply destination on retries', () => {
  const request = { taskId: 'task_framework_patch_block_18_final', sourceChatMessageId: 'message-1', conversationId: 'room-1' };
  const first = resolveWorkerEnqueueIdentity('owner-1', request);
  expect(first).toEqual({ ok: true, identity: request });
  expect(resolveWorkerEnqueueIdentity('owner-1', request)).toEqual(first);
});

test('retains owner-bound chat identity when no explicit mission is supplied', () => {
  const request = { sourceChatMessageId: 'message-1', conversationId: 'room-1' };
  const first = resolveWorkerEnqueueIdentity('owner-1', request);
  expect(first.ok).toBe(true);
  expect(resolveWorkerEnqueueIdentity('owner-1', request)).toEqual(first);
  expect(resolveWorkerEnqueueIdentity('owner-2', request)).not.toEqual(first);
  expect(resolveWorkerEnqueueIdentity('owner-1', { ...request, sourceChatMessageId: 'message-2' })).not.toEqual(first);
});

test('accepts legacy requests without correlation and does not create approval flags', () => {
  expect(resolveWorkerEnqueueIdentity('owner-1', {})).toEqual({ ok: true, identity: {} });
  expect(resolveWorkerEnqueueIdentity('owner-1', { taskId: 'task-1' })).toEqual({ ok: true, identity: { taskId: 'task-1' } });
});

test('rejects malformed correlation instead of silently changing the task identity', () => {
  for (const request of [{ taskId: {} }, { taskId: '' }, { taskId: 'task/1' }, { taskId: 'a'.repeat(513) },
    { sourceChatMessageId: 12 }, { conversationId: [] }]) {
    expect(resolveWorkerEnqueueIdentity('owner-1', request).ok).toBe(false);
  }
});
