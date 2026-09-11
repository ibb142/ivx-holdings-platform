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
  await insert(Array.from({ length: 1000 }, (_, index) => ({ taskId: `${prefix}overflow-${index}`,
    idempotencyKey: `module-audit:${sha}:${prefix}overflow-${index}`, state: 'BLOCKED' })));
  await assert.rejects(() => store.readPostgresRecoveryTasks(sha), /recovery is incomplete/,
    'a genuinely oversized current mission must still fail closed');
  console.log(JSON.stringify({ result: 'PASS', exactMission: true, historyPreserved: true, realOverflowRejected: true, productionRowsTouched: 0 }));
} finally {
  await admin.query('delete from public.ivx_autonomous_tasks where task_id like $1', [prefix + '%']);
  await admin.end();
}
