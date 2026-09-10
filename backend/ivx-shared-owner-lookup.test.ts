import { afterEach, expect, spyOn, test } from 'bun:test';
import * as durable from './services/ivx-durable-store';
import * as shared from './services/ivx-senior-shared-queue';
import { expireStaleJobs, getActiveJobForOwner } from './services/ivx-senior-developer-worker';

const spies: Array<{ mockRestore(): void }> = [];
afterEach(() => { for (const spy of spies.splice(0)) spy.mockRestore(); });

test('owner lookup does not mutate another worker lease while admitting a chat task', async () => {
  const jobs = [
    { jobId: 'leased-other-job', ownerId: 'other-owner', status: 'running',
      lastHeartbeatAt: '2020-01-01T00:00:00.000Z',
      leaseExpiresAt: new Date(Date.now() + 120_000).toISOString(),
      leaseWorkerInstanceId: 'other-physical-worker', attempts: 1 },
    { jobId: 'owner-queued-job', ownerId: 'request-owner', status: 'queued' },
  ];
  spies.push(spyOn(durable, 'isDurableStoreConfigured').mockReturnValue(true));
  spies.push(spyOn(shared, 'sharedSeniorQueueEnabled').mockReturnValue(true));
  spies.push(spyOn(shared, 'readSharedSeniorDocument').mockImplementation(async () =>
    structuredClone({ jobs, durable: true }) as any));
  const patch = spyOn(shared, 'patchSharedSeniorQueue').mockImplementation(async () => {
    throw new Error('Worker lease identity required');
  });
  spies.push(patch);

  expect((await getActiveJobForOwner('request-owner'))?.jobId).toBe('owner-queued-job');
  expect(patch).not.toHaveBeenCalled();
  expect(jobs[0].status).toBe('running');
});

test('shared sweep preserves a committed job for recovery instead of blocking the queue', async () => {
  const jobs = [{ jobId: 'committed-expired-job', ownerId: 'other-owner', status: 'committing',
    lastHeartbeatAt: '2020-01-01T00:00:00.000Z', leaseExpiresAt: '2020-01-01T00:02:00.000Z',
    leaseWorkerInstanceId: 'previous-physical-worker', attempts: 1,
    result: { commitSha: 'a'.repeat(40) } }];
  spies.push(spyOn(durable, 'isDurableStoreConfigured').mockReturnValue(true));
  spies.push(spyOn(shared, 'sharedSeniorQueueEnabled').mockReturnValue(true));
  spies.push(spyOn(shared, 'readSharedSeniorDocument').mockImplementation(async () =>
    structuredClone({ jobs, durable: true }) as any));
  const patch = spyOn(shared, 'patchSharedSeniorQueue').mockImplementation(async () => {
    throw new Error('Worker lease identity required');
  });
  spies.push(patch);
  expect(await expireStaleJobs()).toEqual([]);
  expect(patch).not.toHaveBeenCalled();
  expect(jobs[0].result.commitSha).toBe('a'.repeat(40));
});

test('shared sweep requeues expired uncommitted work but preserves a live physical lease', async () => {
  const jobs = ['expired', 'live'].map((jobId) => ({ jobId, ownerId: 'owner', status: 'running',
    lastHeartbeatAt: '2020-01-01T00:00:00.000Z', attempts: 1,
    leaseWorkerInstanceId: 'physical-worker',
    leaseExpiresAt: jobId === 'live' ? new Date(Date.now() + 120_000).toISOString() : '2020-01-01T00:02:00.000Z' }));
  spies.push(spyOn(durable, 'isDurableStoreConfigured').mockReturnValue(true));
  spies.push(spyOn(shared, 'sharedSeniorQueueEnabled').mockReturnValue(true));
  spies.push(spyOn(shared, 'readSharedSeniorDocument').mockImplementation(async () =>
    structuredClone({ jobs, durable: true }) as any));
  const patch = spyOn(shared, 'patchSharedSeniorQueue').mockImplementation(async (queue) => queue);
  spies.push(patch);
  expect(await expireStaleJobs()).toEqual(['expired']);
  const saved = patch.mock.calls[0][0].jobs as typeof jobs;
  expect(saved[0].status).toBe('queued');
  expect(saved[0].leaseWorkerInstanceId).toBeNull();
  expect(saved[1].status).toBe('running');
  expect(saved[1].leaseWorkerInstanceId).toBe('physical-worker');
});
