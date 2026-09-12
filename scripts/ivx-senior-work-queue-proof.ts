import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { SENIOR_QUEUE_ACTIVE_STATUSES, SENIOR_QUEUE_AUTHORITY_SQL, SENIOR_WORK_QUEUE_PATH, SENIOR_WORK_QUEUE_SQL,
  isSeniorQueueWorkItem } from '../backend/services/ivx-senior-work-queue';

type Database = { query(sql: string, values?: any[]): Promise<{ rows: any[] }> };
export async function proveSeniorWorkQueue(db: Database) {
  await db.query('begin');
  try {
    const stamp = '2026-01-01T00:00:00.000Z';
    const active = SENIOR_QUEUE_ACTIVE_STATUSES.map((status, i) => ({ jobId: `work-active-${i}`,
      ownerId: `work-owner-${i}`, status, createdAt: stamp, input: { taskId: `original-task-${i}` },
      idempotencyKey: `original-key-${i}`, workspaceEvidence: { checkpoint: `workspace-${i}` },
      ...(status === 'running' ? { leaseWorkerInstanceId: 'live-worker', leaseExpiresAt: '2099-01-01T00:00:00Z' } : {}),
    }));
    const recovery = { jobId: 'work-failed-deploy', ownerId: 'recover-owner', status: 'failed', createdAt: stamp,
      startedAt: '2020-01-01T00:00:00Z', result: { commitSha: 'a'.repeat(40), commitMatch: false,
        validationEvidence: ['original receipt'], deployId: 'original-deployment' } };
    const excluded = [
      { ...recovery, jobId: 'empty-sha', result: { commitSha: '', commitMatch: false } },
      { ...recovery, jobId: 'null-sha', result: { commitSha: null, commitMatch: false } },
      { ...recovery, jobId: 'missing-sha', result: { commitMatch: false } },
      { ...recovery, jobId: 'matched', result: { commitSha: 'a'.repeat(40), commitMatch: true } },
      { ...recovery, jobId: 'cancelled', status: 'cancelled' },
      { ...recovery, jobId: 'blocked', status: 'blocked' },
      { ...recovery, jobId: 'completed', status: 'completed' },
    ];
    const history = Array.from({ length: 200 - excluded.length - 1 }, (_, i) => ({
      jobId: `work-history-${i}`, ownerId: `historical-owner-${i}`, status: 'completed', createdAt: stamp,
      finishedAt: stamp, result: { commitSha: 'b'.repeat(40), checkpoint: 'original-history-'.repeat(1500) },
    }));
    const original = { marker: 'original-marker', durable: true, updatedAt: stamp,
      jobs: [...history.slice(0, 80), ...active.slice(0, 3), recovery, ...history.slice(80), ...excluded, ...active.slice(3)] };
    const expected = [...active.slice(0, 3), recovery, ...active.slice(3)];
    await db.query("insert into public.ivx_durable_documents(doc_key,value) values ($1,$2::jsonb) on conflict(doc_key) do update set value=excluded.value",
      ['senior-developer-worker/queue.json', JSON.stringify(original)]);
    const full = async () => (await db.query('select value from public.ivx_durable_documents where doc_key=$1',
      ['senior-developer-worker/queue.json'])).rows[0].value;
    const work = async () => (await db.query(SENIOR_WORK_QUEUE_SQL,
      ['senior-developer-worker/queue.json', SENIOR_WORK_QUEUE_PATH])).rows[0].value;
    const projected = await work();
    assert.deepEqual(projected, { ...original, jobs: expected }, 'Exact job fields, recovery checkpoints and queue order survive the projection');
    assert.deepEqual(original.jobs.filter(isSeniorQueueWorkItem), expected, 'REST and direct work selection have identical semantics');
    assert.deepEqual(await full(), original, 'Projection never changes stored history');
    const fullBytes = Buffer.byteLength(JSON.stringify(original));
    const workBytes = Buffer.byteLength(JSON.stringify(projected));
    assert(workBytes < fullBytes / 100, 'Historical payloads must not cross the scheduling read');

    const leaseJob = active.find(job => job.status === 'running')!;
    const authority = async (id: string) => (await db.query(SENIOR_QUEUE_AUTHORITY_SQL,
      ['senior-developer-worker/queue.json', id])).rows;
    const [lease] = await authority(leaseJob.jobId);
    assert.deepEqual(Object.keys(lease).sort(), ['job_id', 'status', 'worker_id', 'lease_expires_at', 'observed_at'].sort());
    assert.equal(lease.job_id, leaseJob.jobId);
    assert.equal(lease.worker_id, 'live-worker');
    assert.equal(lease.status, 'running');
    assert.equal(lease.lease_expires_at, leaseJob.leaseExpiresAt);
    assert(Number.isFinite(new Date(lease.observed_at).getTime()), 'Authority uses a real PostgreSQL timestamp');
    assert.deepEqual(await authority('missing'), []);
    assert.deepEqual(await full(), original, 'Authority observation cannot renew or mutate stored leases');

    const target = active[0]!;
    const next = { ...target, note: 'new checkpoint from the projected snapshot' };
    const patch = async (expectedJob: unknown, nextJob: unknown) => (await db.query(
      'select public.ivx_senior_queue_patch_receipt($1::jsonb) value',
      [JSON.stringify([{ expected: expectedJob, next: nextJob }])])).rows[0].value;
    assert.deepEqual((await patch(target, next)).jobs, [next]);
    const saved = await full();
    const byId = (jobs: any[]) => [...jobs].sort((a, b) => a.jobId.localeCompare(b.jobId));
    assert.deepEqual(byId(saved.jobs), byId(original.jobs.map(job => job.jobId === target.jobId ? next : job)),
      'A write from the work projection preserves every omitted job and its evidence');
    assert.equal((await work()).jobs.find((job: any) => job.jobId === target.jobId).note, next.note, 'A new read observes the database change');
    await db.query('savepoint stale_snapshot');
    await assert.rejects(patch(target, { ...target, note: 'stale writer' }), /changed concurrently/);
    await db.query('rollback to savepoint stale_snapshot');
    return { ok: true, fullBytes, workBytes, retainedJobs: original.jobs.length, workJobs: expected.length,
      terminalJobsPreserved: 200, activeStatuses: active.map(job => job.status), failedDeploymentRetained: true,
      originalOrderAndFields: true, historyUnchanged: true, partialCasPreservesHistory: true,
      freshReadObserved: true, staleCasRejected: true, authorityReadUsesServerClock: true,
      authorityReadPreservesLeaseAndHistory: true, productionRowsTouched: 0 };
  } finally { await db.query('rollback'); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid/');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
  const db = new pg.Client({ connectionString });
  await db.connect();
  try {
    const proof = { ...await proveSeniorWorkQueue(db), database: 'isolated PostgreSQL', sourceSha: process.env.GITHUB_SHA ?? null };
    await mkdir('qa/evidence/fleet-ha', { recursive: true });
    await writeFile('qa/evidence/fleet-ha/senior-work-queue.json', JSON.stringify(proof, null, 2) + '\n');
    console.log(JSON.stringify(proof));
  } finally { await db.end(); }
}
