import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mock } from 'bun:test';
import pg from 'pg';

const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') {
  throw new Error('Local ivx_ha_test database required');
}
// Substitute only local transport configuration; exercise the real store,
// PostgreSQL transactions, index predicates and timeout cleanup.
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
const prefix = `landing-read-proof:${randomUUID()}:`;
const sha = createHash('sha1').update(prefix).digest('hex');
const oldSha = '0'.repeat(40);
const families = ['landing-p0:', 'landing-p0-repair:', 'landing-p0-patrol:'];
const current = families.map((family, index) => ({
  taskId: `${prefix}current-${index}`, idempotencyKey: `${family}${sha}:unit-${index}`,
  state: index === 0 ? 'VERIFIED' : 'BLOCKED', commitSha: 'c'.repeat(40),
  evidence: [{ evidenceId: 'original-failure', summary: 'FAIL ' + 'retained-detail '.repeat(3000) },
    { evidenceId: 'later-observation', summary: 'Current observation is not a global certificate' }],
  checkpoint: { attempt: 7, changedFiles: ['fixture.ts'] },
}));
const fixtures = [...current,
  { taskId: `${prefix}history`, idempotencyKey: `landing-p0:${oldSha}:old`, state: 'BLOCKED', evidence: [{ summary: 'historical failure' }] },
  { taskId: `${prefix}unrelated`, idempotencyKey: `owner-task:${sha}:keep`, state: 'QUEUED', evidence: [{ summary: 'owner objective' }] },
];
async function insert(rows: object[]) {
  await admin.query(`insert into public.ivx_autonomous_tasks(task_id,idempotency_key,state,payload)
    select row->>'taskId',row->>'idempotencyKey',row->>'state',row
    from jsonb_array_elements($1::jsonb) row`, [JSON.stringify(rows)]);
}
async function snapshot() {
  return (await admin.query('select task_id,payload from public.ivx_autonomous_tasks where task_id like $1 order by task_id', [prefix + '%'])).rows;
}
try {
  await insert(fixtures);
  const before = await snapshot();
  const original = (await admin.query(
    'select payload from public.ivx_autonomous_tasks where idempotency_key like any($1::text[]) order by task_id limit 1000',
    [families.map(family => `${family}${sha}:%`)],
  )).rows.map(row => row.payload);
  const selected = await store.readPostgresLandingTasks(sha);
  assert.deepEqual(selected, original, 'optimized selection must preserve the entire original result');
  assert.deepEqual(selected, current, 'all three exact-SHA families, full failure evidence and checkpoints must survive');

  let lockTimeoutCode: string | undefined;
  const started = Date.now();
  await admin.query('BEGIN');
  try {
    await admin.query('LOCK TABLE public.ivx_autonomous_tasks IN ACCESS EXCLUSIVE MODE');
    await assert.rejects(() => store.readPostgresLandingTasks(sha), (error: any) => {
      lockTimeoutCode = error.code;
      return error.code === '55P03';
    }, 'the transaction-local lock timeout must cancel the read before the client timeout');
  } finally { await admin.query('ROLLBACK'); }
  const blockedReadMs = Date.now() - started;
  assert(blockedReadMs < 5000, 'blocked Landing read exceeded its bounded deadline');
  assert.deepEqual(await store.readPostgresLandingTasks(sha), current, 'next read must recover after failed connection cleanup');
  assert.deepEqual(await snapshot(), before, 'reads must not rewrite evidence, tasks or checkpoints');

  await insert(Array.from({ length: 1000 }, (_, index) => ({
    taskId: `${prefix}overflow-${index}`, idempotencyKey: `landing-p0:${sha}:overflow-${index}`,
    state: 'BLOCKED', evidence: [{ summary: 'Never hide overflow to make a certificate pass' }],
  })));
  const beforeOverflow = await snapshot();
  await assert.rejects(() => store.readPostgresLandingTasks(sha), /Incomplete/);
  assert.deepEqual(await snapshot(), beforeOverflow);
  console.log(JSON.stringify({ result: 'PASS', sourceSha: process.env.GITHUB_SHA,
    observedAt: new Date().toISOString(), exactFamilies: 3, fullPayloadEquivalent: true,
    failureEvidenceAndCheckpointsPreserved: true, lockTimeoutCode, blockedReadMs,
    nextReadRecovered: true, genuineOverflowRejected: true, productionRowsTouched: 0 }));
} finally {
  await admin.query('delete from public.ivx_autonomous_tasks where task_id like $1', [prefix + '%']);
  await admin.end();
}
process.exit(0);
