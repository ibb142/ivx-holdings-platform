import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock } from 'bun:test';
import pg from 'pg';

const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') {
  throw new Error('Local ivx_ha_test database required');
}
mock.module('../backend/services/ivx-emergency-stop-postgres', () => ({
  emergencyStopPostgresConfig: () => ({ connectionString }),
}));
mock.module('../backend/services/ivx-supabase-postgres-tls', () => ({
  supabasePostgresTls: () => false,
  withoutPostgresUrlTlsOptions: (value: string) => value,
}));
process.env.SUPABASE_DB_URL = connectionString;
process.env.IVX_AUTONOMOUS_QUEUE_BACKEND = 'postgres_atomic';
const store = await import('../backend/services/ivx-postgres-autonomous-task-store');
const { getWorkerPool } = await import('../backend/services/ivx-database-pools');
const admin = new pg.Client({ connectionString });
await admin.connect();
const prefix = `mission-history-proof:${randomUUID()}:`;
const sha = 'e'.repeat(40), oldSha = 'd'.repeat(40);
const history = Array.from({ length: 1200 }, (_, index) => ({
  taskId: `${prefix}history-${index}`, idempotencyKey: `module-audit:${oldSha}:${prefix}${index}`,
  state: 'BLOCKED', leaseHolder: 'retired-worker', leaseExpiresAt: '2026-01-01T00:00:00Z',
  evidence: [{ summary: `original finding ${index}` }], commitSha: 'c'.repeat(40),
}));
const fixtures = [
  ...history,
  { taskId: `${prefix}old-unstarted`, idempotencyKey: `autonomous-secondary:${oldSha}:${prefix}file`, state: 'QUEUED' },
  { taskId: `${prefix}current-blocked`, idempotencyKey: `module-audit:${sha}:${prefix}file`, state: 'BLOCKED' },
  { taskId: `${prefix}current-complete`, idempotencyKey: `module-audit:${sha}:${prefix}verified`, state: 'VERIFIED' },
  { taskId: `${prefix}current-cancelled`, idempotencyKey: `autonomous-secondary:${sha}:${prefix}cancelled`, state: 'CANCELLED' },
  { taskId: `${prefix}real-repair`, idempotencyKey: `repair:${oldSha}:${prefix}defect`, state: 'BLOCKED', blocker: 'OWNER_GATE: permission required' },
  { taskId: `${prefix}landing-history`, idempotencyKey: `landing-p0:${oldSha}:${prefix}unit`, state: 'BLOCKED' },
  { taskId: `${prefix}running-old`, idempotencyKey: `module-audit:${oldSha}:${prefix}running`, state: 'RUNNING', leaseHolder: 'recover-worker', leaseExpiresAt: '2026-01-01T00:00:00Z' },
  { taskId: `${prefix}blocked-live`, idempotencyKey: `module-audit:${oldSha}:${prefix}live`, state: 'BLOCKED', leaseHolder: 'live-worker', leaseExpiresAt: '2099-01-01T00:00:00Z' },
  { taskId: `${prefix}blocked-unknown`, idempotencyKey: `module-audit:${oldSha}:${prefix}unknown`, state: 'BLOCKED', leaseHolder: 'unknown-worker' },
  { taskId: `${prefix}queued-stale-lease`, idempotencyKey: `module-audit:${oldSha}:${prefix}queued-lease`, state: 'QUEUED', leaseHolder: 'stale-worker', leaseExpiresAt: '2026-01-01T00:00:00Z' },
];
async function insert(rows: object[]) {
  await admin.query(`insert into public.ivx_autonomous_tasks
    (task_id,idempotency_key,state,lease_holder,lease_expires_at,payload)
    select row->>'taskId',row->>'idempotencyKey',row->>'state',row->>'leaseHolder',
      (row->>'leaseExpiresAt')::timestamptz,row from jsonb_array_elements($1::jsonb) row`, [JSON.stringify(rows)]);
}
async function snapshot() {
  return (await admin.query('select task_id,payload from public.ivx_autonomous_tasks where task_id like $1 order by task_id', [prefix + '%'])).rows;
}
try {
  await insert(fixtures);
  const before = await snapshot();
  const failures: string[] = [];
  for (const check of ['recovery', 'planning']) {
    try {
      const selected = check === 'recovery'
        ? await store.readPostgresRecoveryTasks(sha)
        : await store.readPostgresAutonomousTaskIndex(sha);
      const ids = selected.filter(task => task.taskId.startsWith(prefix)).map(task => task.taskId.slice(prefix.length)).sort();
      const expected = check === 'recovery'
        ? ['current-blocked', 'real-repair', 'landing-history', 'running-old', 'blocked-live', 'blocked-unknown', 'queued-stale-lease']
        : ['current-blocked', 'current-complete', 'current-cancelled', 'real-repair', 'running-old', 'blocked-live', 'blocked-unknown', 'queued-stale-lease'];
      assert.deepEqual(ids, expected.sort(), `${check} must retain current work and ownership while excluding obsolete inspections`);
      console.log(JSON.stringify({ check, result: 'PASS', historicalBlocked: 1200, selectedFixtures: ids.length }));
    } catch (error) { failures.push(`${check}: ${error instanceof Error ? error.message : error}`); }
  }
  assert.deepEqual(await snapshot(), before, 'selection must preserve every historical commit, finding and state');
  assert.deepEqual(failures, [], 'mission history must not stop recovery or pollute current planning');
  // Real contention must cancel on the pinned server transaction before the
  // pg client's timeout. This isolated local lock never touches production.
  const blocker = new pg.Client({ connectionString });
  await blocker.connect();
  const workerPool = getWorkerPool();
  const beforeLock = (await workerPool.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0];
  try {
    await blocker.query('BEGIN');
    await blocker.query('LOCK TABLE public.ivx_autonomous_tasks IN ACCESS EXCLUSIVE MODE');
    const started = Date.now();
    await assert.rejects(() => store.readPostgresAutonomousTaskIndex(sha),
      (error: unknown) => error instanceof Error && 'code' in error && error.code === '55P03',
      'planning must hit its 1s server lock deadline, not an ambiguous client timeout');
    const elapsedMs = Date.now() - started;
    assert(elapsedMs >= 750 && elapsedMs < 2_500, 'planning deadline was not bounded');
    console.log(JSON.stringify({ check: 'planning-server-lock-deadline', result: 'PASS',
      elapsedMs, expectedLockTimeoutMs: 1000, expectedCode: '55P03', productionRowsTouched: 0 }));
  } finally {
    await blocker.query('ROLLBACK').catch(() => undefined);
    await blocker.end();
  }
  const resumedPlanning = await store.readPostgresAutonomousTaskIndex(sha);
  assert(resumedPlanning.some(task => task.taskId === prefix + 'current-complete'),
    'planning must recover after lock release');
  const afterLock = (await workerPool.query<{ pid: number }>('select pg_backend_pid() as pid')).rows[0];
  assert.equal(afterLock.pid, beforeLock.pid, 'confirmed lock rollback must retain the same connection');
  assert.deepEqual(await snapshot(), before, 'deadline and recovery must preserve all history');
  // Cancel after an actual write in the isolated database: rollback must undo
  // the write and transaction-local state before this socket is reused.
  const rollbackTaskId = `${prefix}rolled-back-write`;
  await assert.rejects(() => workerPool.query(`
    select set_config('ivx.rollback_proof','present',true);
    insert into public.ivx_autonomous_tasks(task_id,idempotency_key,state,payload)
      values ('${rollbackTaskId}','${rollbackTaskId}','QUEUED','{}'::jsonb);
    select pg_sleep(3)`),
    (error: unknown) => error instanceof Error && 'code' in error && error.code === '57014');
  const afterCancellation = (await workerPool.query<{ pid: number; marker: string | null; writes: number }>(
    `select pg_backend_pid() as pid, current_setting('ivx.rollback_proof',true) as marker,
      (select count(*)::integer from public.ivx_autonomous_tasks where task_id=$1) as writes`, [rollbackTaskId])).rows[0];
  assert.equal(afterCancellation.pid, afterLock.pid, 'confirmed statement rollback must retain the same connection');
  assert.equal(afterCancellation.writes, 0, 'cancelled transaction must not retain its write');
  assert.notEqual(afterCancellation.marker, 'present', 'transaction-local state must not leak');
  console.log(JSON.stringify({ check: 'confirmed-rollback-connection-reuse', result: 'PASS',
    sameBackend: true, cancelledWriteAbsent: true, transactionStateReset: true, productionRowsTouched: 0 }));
  await insert(Array.from({ length: 1000 }, (_, index) => ({ taskId: `${prefix}overflow-${index}`,
    idempotencyKey: `module-audit:${sha}:${prefix}overflow-${index}`, state: 'BLOCKED' })));
  await assert.rejects(() => store.readPostgresRecoveryTasks(sha), /recovery is incomplete/,
    'a genuinely oversized current mission must still fail closed');
  console.log(JSON.stringify({ result: 'PASS', exactMission: true, historyPreserved: true, realOverflowRejected: true, productionRowsTouched: 0 }));
} finally {
  await admin.query('delete from public.ivx_autonomous_tasks where task_id like $1', [prefix + '%']);
  await admin.end();
}
