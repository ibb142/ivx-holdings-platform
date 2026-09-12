import { afterEach, expect, spyOn, test } from 'bun:test';
import * as store from './ivx-postgres-autonomous-task-store';
import * as durable from './ivx-durable-store';
import { getSeniorDeveloperJob } from './ivx-senior-developer-worker';
import { claimSharedSeniorJob, readSharedSeniorDocument, readSharedSeniorWorkQueue, readSharedSeniorJob, rememberSeniorQueue, patchSharedSeniorQueue } from './ivx-senior-shared-queue';

const file = 'senior-developer-worker/queue.json';
const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0).reverse()) restore(); });
function direct() {
  const selected = spyOn(store, 'preferDirectTransport').mockReturnValue(true);
  restores.push(() => selected.mockRestore());
}

test('work reads coalesce independently of history and a claim fences their snapshots', async () => {
  direct();
  const full = spyOn(store, 'readSeniorQueuePostgresDocument').mockResolvedValue({ jobs: [{ jobId: 'history', status: 'completed' }] });
  const pending: Array<(value: any) => void> = [];
  const work = spyOn(store, 'readSeniorWorkQueuePostgres').mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const claim = spyOn(store, 'seniorQueuePostgresRpc').mockRejectedValue(new Error('uncertain claim'));
  restores.push(() => full.mockRestore(), () => work.mockRestore(), () => claim.mockRestore());
  const fallback = { jobs: [] as Array<{ jobId: string; status: string; version: number }> };
  const readers = Array.from({ length: 112 }, () => readSharedSeniorWorkQueue(file, fallback));
  expect((await readSharedSeniorDocument(file, fallback)).jobs[0].jobId).toBe('history');
  expect(work).toHaveBeenCalledTimes(1);
  await expect(claimSharedSeniorJob('job-1')).rejects.toThrow('uncertain claim');
  const fresh = readSharedSeniorWorkQueue(file, fallback);
  expect(work).toHaveBeenCalledTimes(2);
  pending.forEach((resolve, i) => resolve({ jobs: [{ jobId: 'job-1', status: 'queued', version: i + 1 }] }));
  const values = await Promise.all(readers);
  values[0].jobs[0].version = -1;
  expect(values[1].jobs[0].version).toBe(1);
  expect((await fresh).jobs[0].version).toBe(2);
  work.mockRejectedValue(new Error('work read unavailable'));
  await expect(readSharedSeniorWorkQueue(file, fallback)).rejects.toThrow('work read unavailable');
  expect(full).toHaveBeenCalledTimes(1);
  await expect(readSharedSeniorWorkQueue('senior-developer-worker/proof-ledger.json', fallback)).rejects.toThrow('not allowed');
});

test('112 overlapping senior observers share one read, with independent snapshots and no stale cache', async () => {
  direct();
  let reads = 0;
  const reader = spyOn(store, 'readSeniorQueuePostgresDocument').mockImplementation(async () => {
    const version = ++reads;
    await new Promise(resolve => setTimeout(resolve, 5));
    return { jobs: [{ jobId: 'job-1', version }] };
  });
  restores.push(() => reader.mockRestore());
  const rows = await Promise.all(Array.from({ length: 112 }, () => readSharedSeniorDocument(file, { jobs: [] as Array<{ jobId: string; version: number }> })));
  expect(reads).toBe(1);
  rows[0].jobs[0].version = -1;
  expect(rows[1].jobs[0].version).toBe(1);
  expect((await readSharedSeniorDocument(file, { jobs: [] as Array<{ version: number }> })).jobs[0].version).toBe(2);
});

test('failed shared reads are released so a later observer can recover', async () => {
  direct();
  const reader = spyOn(store, 'readSeniorQueuePostgresDocument').mockRejectedValue(new Error('read unavailable'));
  restores.push(() => reader.mockRestore());
  const rows = await Promise.allSettled(Array.from({ length: 12 }, () => readSharedSeniorDocument(file, { jobs: [] })));
  expect(rows.every(row => row.status === 'rejected')).toBe(true);
  expect(reader).toHaveBeenCalledTimes(1);
  reader.mockResolvedValue({ jobs: [] });
  expect(await readSharedSeniorDocument(file, { jobs: [] })).toEqual({ jobs: [] });
});

test('a claim fences outstanding reads even when its result is ambiguous', async () => {
  direct();
  const pending: Array<(value: unknown) => void> = [];
  const reader = spyOn(store, 'readSeniorQueuePostgresDocument').mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  const claim = spyOn(store, 'seniorQueuePostgresRpc').mockRejectedValue(new Error('transport timeout'));
  restores.push(() => reader.mockRestore(), () => claim.mockRestore());
  const before = readSharedSeniorDocument(file, { jobs: [] });
  await expect(claimSharedSeniorJob('job-1')).rejects.toThrow('transport timeout');
  const after = readSharedSeniorDocument(file, { jobs: [] });
  const count = reader.mock.calls.length;
  pending.forEach((resolve, i) => resolve({ jobs: [], version: i + 1 }));
  await Promise.all([before, after]);
  expect(count).toBe(2);
  expect(claim).toHaveBeenCalledTimes(1);
});

test('one-job polling uses the bounded reader and keeps distinct identities separate', async () => {
  direct();
  const all = spyOn(store, 'readSeniorQueuePostgresDocument').mockRejectedValue(new Error('full queue must not be read'));
  const one = spyOn(store, 'readSeniorQueuePostgresJob').mockImplementation(async jobId => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return jobId === 'missing' ? null : { jobId, status: 'running' };
  });
  restores.push(() => all.mockRestore(), () => one.mockRestore());
  const rows = await Promise.all(Array.from({ length: 112 }, (_, i) => readSharedSeniorJob(file, `job-${i % 2}`)));
  expect(one).toHaveBeenCalledTimes(2);
  expect(all).not.toHaveBeenCalled();
  expect(rows[0]?.jobId).toBe('job-0');
  expect(rows[1]?.jobId).toBe('job-1');
  rows[0]!.jobId = 'changed';
  expect(rows[2]?.jobId).toBe('job-0');
  expect(await readSharedSeniorJob(file, 'missing')).toBeNull();
  one.mockRejectedValue(new Error('transport unavailable'));
  await expect(readSharedSeniorJob(file, 'job-0')).rejects.toThrow('transport unavailable');
  expect(all).not.toHaveBeenCalled();
});

test('a single-job snapshot sends its exact change and receives only its acknowledgement', async () => {
  direct();
  const existing = { jobId: 'job-1', status: 'running', ownerId: 'owner-1' };
  const queue = rememberSeniorQueue({ jobs: [structuredClone(existing)] });
  queue.jobs[0].status = 'testing';
  const patch = spyOn(store, 'seniorQueuePostgresRpc').mockImplementation(async (name, body) => {
    expect(name).toBe('ivx_senior_queue_patch_receipt');
    expect(body.p_changes).toEqual([{ next: queue.jobs[0], expected: existing, workerInstanceId: store.autonomousWorkerInstanceId() }]);
    return { kind: 'ivx-senior-patch-receipt-v1', updatedAt: '2026-09-11T00:00:00Z', jobs: [queue.jobs[0]], removedJobIds: [] };
  });
  restores.push(() => patch.mockRestore());
  const saved = await patchSharedSeniorQueue(queue, new Set(['job-1']));
  expect(saved.jobs).toEqual([queue.jobs[0]]);
  await patchSharedSeniorQueue(saved, new Set(['job-1']));
  expect(patch).toHaveBeenCalledTimes(1);
});

test('the real worker job endpoint uses the bounded durable path and propagates outages', async () => {
  direct();
  const atomic = process.env.IVX_WORKER_QUEUE_ATOMIC;
  process.env.IVX_WORKER_QUEUE_ATOMIC = 'true';
  restores.push(() => { if (atomic === undefined) delete process.env.IVX_WORKER_QUEUE_ATOMIC; else process.env.IVX_WORKER_QUEUE_ATOMIC = atomic; });
  const configured = spyOn(durable, 'isDurableStoreConfigured').mockReturnValue(true);
  const one = spyOn(store, 'readSeniorQueuePostgresJob').mockResolvedValue({ jobId: 'job-1', status: 'running' });
  const all = spyOn(store, 'readSeniorQueuePostgresDocument').mockRejectedValue(new Error('full queue must not be read'));
  restores.push(() => configured.mockRestore(), () => one.mockRestore(), () => all.mockRestore());
  expect(await getSeniorDeveloperJob('job-1')).toEqual({ jobId: 'job-1', status: 'running' });
  expect(all).not.toHaveBeenCalled();
  one.mockRejectedValue(new Error('database unavailable'));
  await expect(getSeniorDeveloperJob('job-1')).rejects.toThrow('database unavailable');
  configured.mockReturnValue(false);
  await expect(getSeniorDeveloperJob('job-1')).rejects.toThrow('Shared queue storage unavailable');
});
