import { afterEach, expect, spyOn, test } from 'bun:test';
import * as deadline from './ivx-postgres-deadline';
import { assertSeniorQueuePostgresAuthority, autonomousWorkerInstanceId, resetPostgresAutonomousTaskStoreForTests } from './ivx-postgres-autonomous-task-store';
import { SENIOR_QUEUE_AUTHORITY_SQL } from './ivx-senior-work-queue';

const originalEnv = { ...process.env };
afterEach(() => { process.env = { ...originalEnv }; resetPostgresAutonomousTaskStoreForTests(); });
function configure() {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://authoritytest.supabase.co';
  process.env.SUPABASE_DB_URL = 'postgresql://postgres:test-only@db.authoritytest.supabase.co:5432/postgres';
  return { job_id: 'job-1', status: 'running', worker_id: autonomousWorkerInstanceId(),
    observed_at: '2020-01-01T00:00:00.000Z', lease_expires_at: '2020-01-01T00:02:00.000Z' };
}

test('every execution boundary reads fresh authority using the server clock without rewriting the queue', async () => {
  const row = configure();
  const query = spyOn(deadline, 'queryWithPostgresDeadline').mockResolvedValue({ rows: [row] } as never);
  try {
    for (let i = 0; i < 20; i++) await assertSeniorQueuePostgresAuthority('job-1');
    expect(query).toHaveBeenCalledTimes(20);
    for (const call of query.mock.calls) {
      expect(call[1]).toBe(SENIOR_QUEUE_AUTHORITY_SQL);
      expect(call[2]).toEqual(['senior-developer-worker/queue.json', 'job-1']);
      expect(call[3]).toBe('service_role'); // The deadline wrapper enforces READ ONLY.
    }
    query.mockResolvedValue({ rows: [{ ...row, status: 'cancelled' }] } as never);
    await expect(assertSeniorQueuePostgresAuthority('job-1')).rejects.toThrow('WORKER_AUTHORITY_UNCONFIRMED');
    expect(query).toHaveBeenCalledTimes(21);
  } finally { query.mockRestore(); }
});

test('authority refuses terminal, queued, missing, duplicate, foreign, expired and malformed leases', async () => {
  const row = configure();
  const query = spyOn(deadline, 'queryWithPostgresDeadline');
  try {
    const invalid = [
      [], [row, row], [{ ...row, job_id: 'other' }], [{ ...row, worker_id: 'former-worker' }],
      ...['queued', 'completed', 'failed', 'cancelled', 'blocked', 'unknown'].map(status => [{ ...row, status }]),
      [{ ...row, observed_at: 'invalid' }], [{ ...row, lease_expires_at: null }],
      [{ ...row, lease_expires_at: row.observed_at }],
      [{ ...row, lease_expires_at: '2020-01-01T00:00:20.000Z' }],
    ];
    for (const rows of invalid) {
      query.mockResolvedValue({ rows } as never);
      await expect(assertSeniorQueuePostgresAuthority('job-1')).rejects.toThrow('WORKER_AUTHORITY_UNCONFIRMED');
    }
    expect(query).toHaveBeenCalledTimes(invalid.length);
  } finally { query.mockRestore(); }
});

test('valid execution phases accept a fresh lease, including a pg Date timestamp', async () => {
  const row = configure();
  const query = spyOn(deadline, 'queryWithPostgresDeadline');
  try {
    for (const status of ['running', 'patching', 'testing', 'committing', 'deploying', 'verifying']) {
      query.mockResolvedValue({ rows: [{ ...row, status, observed_at: new Date(row.observed_at) }] } as never);
      await assertSeniorQueuePostgresAuthority('job-1');
    }
  } finally { query.mockRestore(); }
});

test('failed authority reads are not cached, retried, or converted to queue mutations', async () => {
  const row = configure();
  const query = spyOn(deadline, 'queryWithPostgresDeadline').mockRejectedValue(new Error('Query read timeout'));
  try {
    await expect(assertSeniorQueuePostgresAuthority('job-1')).rejects.toThrow('Query read timeout');
    expect(query).toHaveBeenCalledTimes(1);
    query.mockResolvedValue({ rows: [row] } as never);
    await assertSeniorQueuePostgresAuthority('job-1');
    expect(query).toHaveBeenCalledTimes(2);
  } finally { query.mockRestore(); }
});

test('cross-project and empty identities fail before querying', async () => {
  configure();
  const query = spyOn(deadline, 'queryWithPostgresDeadline');
  try {
    await expect(assertSeniorQueuePostgresAuthority(' ')).rejects.toThrow('identity');
    process.env.SUPABASE_DB_URL = 'postgresql://postgres:test-only@db.otherproject.supabase.co:5432/postgres';
    await expect(assertSeniorQueuePostgresAuthority('job-1')).rejects.toThrow('project_mismatch');
    expect(query).not.toHaveBeenCalled();
  } finally { query.mockRestore(); }
});
