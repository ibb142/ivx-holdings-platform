import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as shared from './ivx-senior-shared-queue';
import * as stop from './ivx-emergency-stop-gate';
import * as durable from './ivx-durable-store';
import { createAutonomousJobFromChat } from './ivx-chat-autonomous-handoff';
import * as ownerAuth from '../api/owner-only';
import { handleSeniorDeveloperWorkerEnqueueRequest } from '../api/ivx-senior-developer-worker';
import type { IVXWorkerJob } from './ivx-senior-developer-worker';
import { enqueueOrAttachSeniorDeveloperJob } from './ivx-senior-developer-worker';
import { enqueueOwnerChatWorkerJob } from './ivx-owner-chat-worker';
import { readFileSync } from 'node:fs';

// Exercise the real chat handoff and worker admission. Only persistence and
// the stop lookup are substituted; no provider, repo or production writes run.
const savedEnv = { ...process.env };
const restores: Array<() => void> = [];
let jobs: IVXWorkerJob[] = [];
let writes = 0;
let loseAcknowledgement = false;
beforeEach(() => {
  jobs = []; writes = 0; loseAcknowledgement = false;
  process.env.IVX_PROCESS_ROLE = 'api';
  process.env.IVX_WORKER_QUEUE_ATOMIC = 'true';
  process.env.SUPABASE_URL = 'https://chat-fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  const guard = spyOn(stop, 'checkEmergencyStop').mockResolvedValue({ active: false, source: 'supabase',
    reason: null, error: null, checkedAt: new Date().toISOString(), updatedAt: null, updatedBy: null });
  const read = spyOn(shared, 'readSharedSeniorDocument').mockImplementation(async <T>(file: string): Promise<T> => (
    file.endsWith('queue.json') ? { jobs: structuredClone(jobs), durable: true } : { entries: [], durable: true }
  ) as T);
  const write = spyOn(shared, 'patchSharedSeniorQueue').mockImplementation(async <T extends { jobs: { jobId: string }[] }>(queue: T): Promise<T> => {
    writes++;
    jobs = structuredClone(queue.jobs) as IVXWorkerJob[];
    if (loseAcknowledgement) throw new Error('response timed out after commit');
    return queue;
  });
  const event = spyOn(durable, 'appendDurableEvent').mockResolvedValue(undefined);
  restores.push(() => guard.mockRestore(), () => read.mockRestore(), () => write.mockRestore(), () => event.mockRestore());
});
afterEach(() => { restores.splice(0).forEach(restore => restore()); process.env = { ...savedEnv }; });

const send = (messageId: string | null, room = 'chat-room', owner = 'chat-owner') =>
  createAutonomousJobFromChat('Fix the chat scroll bug', owner, room, messageId);

test('a message retry reuses its task and preserves source identity', async () => {
  const first = await send('message-1');
  const retry = await send('message-1');
  expect(first.ok).toBe(true);
  expect(retry.jobId).toBe(first.jobId);
  expect(jobs).toHaveLength(1);
  expect(writes).toBe(1);
  expect(jobs[0].input.sourceChatMessageId).toBe('message-1');
  expect(jobs[0].input.taskId).toBeTruthy();
});

test('a retry after completion retrieves the original result without executing again', async () => {
  const first = await send('message-1');
  jobs[0].status = 'completed'; jobs[0].stage = 'COMPLETE';
  jobs[0].finishedAt = new Date().toISOString();
  const retry = await send('message-1');
  expect(retry.jobId).toBe(first.jobId);
  expect(retry.attached).toBe(true);
  expect(retry.status).toBe('completed');
  expect(writes).toBe(1);
});

test('new messages with identical wording remain distinct across messages, rooms and owners', async () => {
  const results = [await send('message-1'), await send('message-2'),
    await send('message-1', 'another-room'), await send('message-1', 'chat-room', 'another-owner')];
  expect(results.every(result => result.ok)).toBe(true);
  expect(new Set(results.map(result => result.jobId)).size).toBe(4);
  expect(new Set(jobs.map(job => job.input.taskId)).size).toBe(4);
});

test('a lost database acknowledgement reconciles without a second insert', async () => {
  loseAcknowledgement = true;
  const result = await send('message-1');
  expect(result.ok).toBe(true);
  expect(result.attached).toBe(true);
  expect(result.jobId).toBe(jobs[0].jobId);
  expect(writes).toBe(1);
});

test('missing source identity cannot fabricate a traceable task', async () => {
  const result = await send(null);
  expect(result.ok).toBe(false);
  expect(result.jobId).toBeNull();
  expect(writes).toBe(0);
});


test('the direct owner worker endpoint reuses chat identity after a completed job', async () => {
  const system = spyOn(ownerAuth, 'checkIVXAISystemKey').mockResolvedValue(false);
  const auth = spyOn(ownerAuth, 'assertIVXRegisteredOwnerBearer').mockResolvedValue({
    context: { userId: 'chat-owner' },
    approval: { userId: 'chat-owner', ownerSessionDetected: true, ownerVerified: true, bearerAccepted: true },
  } as unknown as Awaited<ReturnType<typeof ownerAuth.assertIVXRegisteredOwnerBearer>>);
  restores.push(() => system.mockRestore(), () => auth.mockRestore());
  const request = (messageId: string) => new Request('https://fixture.invalid/api/ivx/senior-developer/worker/jobs', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: 'Fix the chat scroll bug', approvePatch: true, approveGitDeploy: false,
      sourceChatMessageId: messageId, conversationId: 'chat-room' }),
  });
  const first = await handleSeniorDeveloperWorkerEnqueueRequest(request('message-1'));
  expect(first.status).toBe(202);
  jobs[0].status = 'completed'; jobs[0].stage = 'COMPLETE'; jobs[0].finishedAt = new Date().toISOString();
  const retry = await handleSeniorDeveloperWorkerEnqueueRequest(request('message-1'));
  expect(retry.status).toBe(409);
  expect((await retry.json() as { jobId: string }).jobId).toBe(jobs[0].jobId);
  expect(writes).toBe(1);
  const next = await handleSeniorDeveloperWorkerEnqueueRequest(request('message-2'));
  expect(next.status).toBe(202);
  expect(jobs).toHaveLength(2);
  expect(jobs[0].input.sourceChatMessageId).toBe('message-1');
  expect(jobs[0].input.approveGitDeploy).toBe(false);
});

for (const executionMode of ['read_only', 'qa_only', 'factory', 'code_change'] as const) {
  test(`${executionMode}: equal commands have distinct tasks and retain their conversation`, async () => {
    const input = { ownerId: 'chat-owner', ownerApproved: true, goal: 'Inspect and fix the chat ordering bug',
      executionMode, approvePatch: false, approveGitDeploy: false };
    // Reproduce the old route boundary: missing message identity collapses
    // two independently submitted commands into the same active job.
    const oldFirst = await enqueueOrAttachSeniorDeveloperJob(input);
    const oldSecond = await enqueueOrAttachSeniorDeveloperJob(input);
    expect(oldSecond.job.jobId).toBe(oldFirst.job.jobId);
    jobs = []; writes = 0;

    const first = await enqueueOwnerChatWorkerJob(input, 'room-a', 'message-1');
    const second = await enqueueOwnerChatWorkerJob(input, 'room-a', 'message-2');
    expect(second.job.jobId).not.toBe(first.job.jobId);
    const retry = await enqueueOwnerChatWorkerJob(input, 'room-a', 'message-1');
    expect(retry.job.jobId).toBe(first.job.jobId);
    jobs.find(job => job.jobId === first.job.jobId)!.status = 'completed';
    const completedRetry = await enqueueOwnerChatWorkerJob(input, 'room-a', 'message-1');
    expect(completedRetry.job.jobId).toBe(first.job.jobId);
    const otherRoom = await enqueueOwnerChatWorkerJob(input, 'room-b', 'message-1');
    expect(otherRoom.job.jobId).not.toBe(first.job.jobId);
    expect(jobs).toHaveLength(3);
    expect(writes).toBe(3);
    expect(jobs[0].input.sourceChatMessageId).toBe('message-1');
    expect(jobs[0].input.conversationId).toBe('room-a');
    expect(jobs[0].input.approvePatch).toBe(false);
    expect(jobs[0].input.approveGitDeploy).toBe(false);
    expect(jobs[0].input.executionMode).toBe(executionMode);
  });
}

test('owner-chat admission reconciles a lost acknowledgement and retains authority gates', async () => {
  const input = { ownerId: 'chat-owner', ownerApproved: true, goal: 'Inspect the chat module only', executionMode: 'read_only' as const };
  loseAcknowledgement = true;
  const first = await enqueueOwnerChatWorkerJob(input, 'room-a', 'message-1');
  const retry = await enqueueOwnerChatWorkerJob(input, 'room-a', 'message-1');
  expect(retry.job.jobId).toBe(first.job.jobId);
  expect(writes).toBe(1);
  expect(() => enqueueOwnerChatWorkerJob(input, 'room-a', '')).toThrow('identity');
  await expect(enqueueOwnerChatWorkerJob({ ...input, ownerApproved: false }, 'room-a', 'message-2')).rejects.toThrow('approval');
  expect(writes).toBe(1);
});

test('every owner API worker handoff uses the command-and-conversation boundary', () => {
  const source = readFileSync(new URL('../api/ivx-owner-ai.ts', import.meta.url), 'utf8');
  const calls = [...source.matchAll(/\b(enqueueOwnerChatWorkerJob|enqueueOrAttachSeniorDeveloperJob)\s*\(([^)]*)\)/g)];
  expect(calls).toHaveLength(6);
  for (const call of calls) {
    expect(call[1]).toBe('enqueueOwnerChatWorkerJob');
    const args = call[2].split(',').map(arg => arg.trim());
    expect(args).toHaveLength(3);
    expect(args[1]).toBe('conversation.id');
    expect(args[2]).toBe('requestId');
  }
});
