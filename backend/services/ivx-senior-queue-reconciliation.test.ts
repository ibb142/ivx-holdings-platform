import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import * as shared from './ivx-senior-shared-queue';
import * as stop from './ivx-emergency-stop-gate';
import * as durable from './ivx-durable-store';
import { enqueueOrAttachSeniorDeveloperJob, type IVXWorkerJob, type IVXWorkerJobInput } from './ivx-senior-developer-worker';

const savedEnv = { ...process.env };
let jobs: IVXWorkerJob[] = [];
let writes = 0;
let onWrite: ((next: IVXWorkerJob) => void) | null = null;
const restores: Array<() => void> = [];
beforeEach(() => {
  jobs = []; writes = 0; onWrite = null;
  process.env.IVX_PROCESS_ROLE = 'api';
  process.env.IVX_WORKER_QUEUE_ATOMIC = 'true';
  process.env.SUPABASE_URL = 'https://queue-fixture.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-only';
  const guard = spyOn(stop, 'checkEmergencyStop').mockResolvedValue({ active: false, source: 'supabase',
    reason: null, error: null, checkedAt: new Date().toISOString(), updatedAt: null, updatedBy: null });
  const read = spyOn(shared, 'readSharedSeniorDocument').mockImplementation(async <T>(file: string, _fallback: T): Promise<T> => (
    file.endsWith('queue.json') ? { jobs: structuredClone(jobs), durable: true } : { entries: [], durable: true }
  ) as T);
  const write = spyOn(shared, 'patchSharedSeniorQueue').mockImplementation(async <T extends { jobs: { jobId: string }[] }>(queue: T): Promise<T> => {
    writes++;
    const next = queue.jobs.at(-1) as IVXWorkerJob;
    if (onWrite) onWrite(next);
    jobs = structuredClone(queue.jobs) as IVXWorkerJob[];
    return queue;
  });
  const event = spyOn(durable, 'appendDurableEvent').mockResolvedValue(undefined);
  restores.push(() => guard.mockRestore(), () => read.mockRestore(), () => write.mockRestore(), () => event.mockRestore());
});
afterEach(() => { restores.splice(0).forEach(restore => restore()); process.env = { ...savedEnv }; });

const input = (taskId: string, ownerId = 'queue-owner'): IVXWorkerJobInput => ({
  taskId, ownerId, goal: 'Repair a reproduced queue failure', ownerApproved: true,
  executionMode: 'code_change', approvePatch: false, approveGitDeploy: false,
});

test('finds a retry behind a newer different task for the same owner', async () => {
  const first = await enqueueOrAttachSeniorDeveloperJob(input('scope-a'));
  await enqueueOrAttachSeniorDeveloperJob(input('scope-b'));
  const retry = await enqueueOrAttachSeniorDeveloperJob({ ...input('scope-a'), goal: 'Updated diagnostic evidence' });
  expect(retry.attached).toBe(true);
  expect(retry.job.jobId).toBe(first.job.jobId);
  expect(jobs).toHaveLength(2);
  expect(writes).toBe(2);
});

test('attaches to the other replica after an atomic duplicate rejection without a second write', async () => {
  onWrite = next => {
    jobs = [{ ...structuredClone(next), jobId: 'winner-on-other-replica', status: 'running' }];
    throw Object.assign(new Error('Active idempotency key already exists'), { code: '23505' });
  };
  const result = await enqueueOrAttachSeniorDeveloperJob(input('shared-repair'));
  expect(result.attached).toBe(true);
  expect(result.job.jobId).toBe('winner-on-other-replica');
  expect(writes).toBe(1);
});

test('reconciles a lost commit acknowledgement without replaying the insert', async () => {
  onWrite = next => { jobs = [structuredClone(next)]; throw new Error('response timed out after commit'); };
  const result = await enqueueOrAttachSeniorDeveloperJob(input('lost-ack'));
  expect(result.attached).toBe(true);
  expect(result.job.jobId).toBe(jobs[0].jobId);
  expect(writes).toBe(1);
});

test('preserves a real failure and never attaches another owner or a failed repair', async () => {
  for (const other of ['other-owner', 'failed-repair']) {
    jobs = []; writes = 0;
    onWrite = next => {
      jobs = [{ ...structuredClone(next), ...(other === 'other-owner' ? { ownerId: 'someone-else' } : { status: 'failed' as const }) }];
      throw new Error('queue insert rejected');
    };
    await expect(enqueueOrAttachSeniorDeveloperJob(input(other))).rejects.toThrow('queue insert rejected');
    expect(writes).toBe(1);
  }
});
