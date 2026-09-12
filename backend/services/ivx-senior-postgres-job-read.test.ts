import { afterEach, expect, spyOn, test } from 'bun:test';
import * as deadline from './ivx-senior-queue-read-budget';
import { readSeniorActiveOwnerJobPostgres, readSeniorQueuePostgresJob, readSeniorWorkQueuePostgres, resetPostgresAutonomousTaskStoreForTests } from './ivx-postgres-autonomous-task-store';
import { SENIOR_QUEUE_JOB_SQL, SENIOR_WORK_QUEUE_SQL, SENIOR_WORK_QUEUE_PATH } from './ivx-senior-work-queue';

const env = { ...process.env };
afterEach(() => { process.env = { ...env }; resetPostgresAutonomousTaskStoreForTests(); });
function configure() {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://queuereadtest.supabase.co';
  process.env.SUPABASE_DB_URL = 'postgresql://postgres:test-only@db.queuereadtest.supabase.co:5432/postgres';
}

test('direct polling projects one job with bound identities and detects duplicate or mismatched results', async () => {
  configure();
  const query = spyOn(deadline, 'queryWithSeniorQueueReadBudget').mockResolvedValue({ rows: [{ job: { jobId: 'job-1', status: 'running' } }] } as never);
  try {
    expect(await readSeniorQueuePostgresJob('job-1')).toEqual({ jobId: 'job-1', status: 'running' });
    expect(query.mock.calls[0][1]).toBe(SENIOR_QUEUE_JOB_SQL);
    expect(query.mock.calls[0][2]).toEqual(['senior-developer-worker/queue.json', 'job-1']);
    query.mockResolvedValue({ rows: [] } as never);
    expect(await readSeniorQueuePostgresJob('missing')).toBeNull();
    query.mockResolvedValue({ rows: [{ job: { jobId: 'other' } }] } as never);
    await expect(readSeniorQueuePostgresJob('job-1')).rejects.toThrow('identity mismatch');
    query.mockResolvedValue({ rows: [{ job: { jobId: 'job-1' } }, { job: { jobId: 'job-1' } }] } as never);
    await expect(readSeniorQueuePostgresJob('job-1')).rejects.toThrow('Duplicate');
    query.mockRejectedValue(new Error('deadline exceeded'));
    await expect(readSeniorQueuePostgresJob('job-1')).rejects.toThrow('deadline exceeded');
    expect(query).toHaveBeenCalledTimes(5);
  } finally { query.mockRestore(); }
});

test('cross-project database bindings cannot serve a repair job', async () => {
  configure();
  process.env.SUPABASE_DB_URL = 'postgresql://postgres:test-only@db.otherproject.supabase.co:5432/postgres';
  const query = spyOn(deadline, 'queryWithSeniorQueueReadBudget');
  try {
    await expect(readSeniorQueuePostgresJob('job-1')).rejects.toThrow('project_mismatch');
    await expect(readSeniorWorkQueuePostgres()).rejects.toThrow('project_mismatch');
    expect(query).not.toHaveBeenCalled();
  } finally { query.mockRestore(); }
});

test('work queue uses the bound scheduling projection and propagates outages without replay', async () => {
  configure();
  const queue = { jobs: [{ jobId: 'queued', status: 'queued', input: { taskId: 'original-task' } }] };
  const query = spyOn(deadline, 'queryWithSeniorQueueReadBudget').mockResolvedValue({ rows: [{ value: queue }] } as never);
  try {
    expect(await readSeniorWorkQueuePostgres()).toEqual(queue);
    expect(query.mock.calls[0][1]).toBe(SENIOR_WORK_QUEUE_SQL);
    expect(query.mock.calls[0][2]).toEqual(['senior-developer-worker/queue.json', SENIOR_WORK_QUEUE_PATH]);
    query.mockRejectedValue(new Error('storage timeout'));
    await expect(readSeniorWorkQueuePostgres()).rejects.toThrow('storage timeout');
    expect(query).toHaveBeenCalledTimes(2);
  } finally { query.mockRestore(); }
});

test('owner lookup binds identity, returns only one active checkpoint and propagates an outage', async () => {
  configure();
  const query = spyOn(deadline, 'queryWithSeniorQueueReadBudget').mockResolvedValue({ rows: [{ job: { ownerId: 'owner-1', status: 'running', jobId: 'job-1' } }] } as never);
  try {
    expect((await readSeniorActiveOwnerJobPostgres('owner-1'))?.ownerId).toBe('owner-1');
    expect(query.mock.calls[0][1]).toContain("->>'ownerId' = $2");
    expect(query.mock.calls[0][1]).toContain('order by ordinal desc limit 1');
    expect(query.mock.calls[0][2]?.[1]).toBe('owner-1');
    query.mockResolvedValue({ rows: [{ job: { ownerId: 'other', status: 'running' } }] } as never);
    await expect(readSeniorActiveOwnerJobPostgres('owner-1')).rejects.toThrow('mismatch');
    query.mockResolvedValue({ rows: [{ job: { ownerId: 'owner-1', status: 'completed' } }] } as never);
    await expect(readSeniorActiveOwnerJobPostgres('owner-1')).rejects.toThrow('mismatch');
    query.mockResolvedValue({ rows: [] } as never);
    expect(await readSeniorActiveOwnerJobPostgres('owner-1')).toBeNull();
    query.mockRejectedValue(new Error('Query read timeout'));
    await expect(readSeniorActiveOwnerJobPostgres('owner-1')).rejects.toThrow('Query read timeout');
  } finally { query.mockRestore(); }
});

