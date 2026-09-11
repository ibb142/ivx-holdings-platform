import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as shared from './ivx-senior-shared-queue';
import * as stop from './ivx-emergency-stop-gate';
import * as durable from './ivx-durable-store';
import { createAutonomousJobFromChat } from './ivx-chat-autonomous-handoff';
import type { IVXWorkerJob } from './ivx-senior-developer-worker';

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
