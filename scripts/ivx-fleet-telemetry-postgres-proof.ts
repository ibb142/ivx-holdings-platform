import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import pg from 'pg';

// This fixture changes a function only in the explicitly named local test DB.
const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') {
  throw new Error('Local ivx_ha_test database required');
}
// The fixture has no Supabase TLS endpoint. Only transport configuration is
// substituted; the application pools, SQL, locks and observations are real.
mock.module('../backend/services/ivx-emergency-stop-postgres', () => ({
  emergencyStopPostgresConfig: () => ({ connectionString }),
}));
mock.module('../backend/services/ivx-supabase-postgres-tls', () => ({
  supabasePostgresTls: () => false,
  withoutPostgresUrlTlsOptions: (value: string) => value,
}));
process.env.SUPABASE_DB_URL = connectionString;
process.env.IVX_AUTONOMOUS_QUEUE_BACKEND = 'postgres_atomic';
process.env.IVX_WORKER_MODE = 'false';
process.env.IVX_PROCESS_ROLE = 'api';
process.env.IVX_REQUIRE_SHARED_STATE = 'true';
process.env.IVX_WORKER_QUEUE_ATOMIC = 'true';
const store = await import('../backend/services/ivx-postgres-autonomous-task-store');
const admin = new pg.Client({ connectionString });
await admin.connect();
const original = (await admin.query("select pg_get_functiondef('public.ivx_autonomous_tasks_link_objective(text)'::regprocedure) definition")).rows[0].definition;
let mutations: Promise<unknown> | undefined;
let observation: Promise<void> | undefined;
let blockedTelemetry: Promise<unknown> | undefined;
let deadline: ReturnType<typeof setTimeout> | undefined;
try {
  await admin.query(`create or replace function public.ivx_autonomous_tasks_link_objective(p_objective_id text)
    returns integer language plpgsql as $$ begin
      perform pg_advisory_xact_lock(9811593); return 0;
    end $$`);
  await admin.query('select pg_advisory_lock(9811593)');
  let completedMutations = 0;
  mutations = Promise.allSettled(Array.from({ length: 4 }, (_, index) =>
    store.linkPostgresAutonomousOrphans(`blocked-fixture-${index}`).finally(() => { completedMutations++; })));
  let blocked = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    blocked = Number((await admin.query("select count(*) from pg_stat_activity where application_name='ivx_tasks' and wait_event='advisory'")).rows[0].count);
    if (blocked === 4) break;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.equal(blocked, 4, 'all task connections must be blocked throughout the observation');
  const started = Date.now();
  observation = (async () => {
    const tasks = await store.readPostgresFleetSloTasks();
    assert(Array.isArray(tasks));
    await store.persistPostgresFleetSloSample({ commit_sha: 'a'.repeat(40), measured_at: new Date().toISOString(), durable: true });
    const shared = await store.readPostgresFleetDashboardObservation() as { instances: Array<{ instanceId: string; sharedState: boolean; sharedWorkerQueue: boolean }> };
    const process = shared.instances.find(instance => instance.instanceId === store.autonomousWorkerInstanceId());
    assert(process?.sharedState && process.sharedWorkerQueue, 'the fresh sample must be visible through shared PostgreSQL');
    assert.equal(completedMutations, 0, 'telemetry must complete before any blocked mutation is released');
  })();
  await Promise.race([observation, new Promise<never>((_, reject) => {
    deadline = setTimeout(() => reject(new Error('Telemetry waited behind the blocked task pool')), 2_000);
  })]);
  console.log(JSON.stringify({ ok: true, database: 'isolated PostgreSQL', blockedTaskConnections: blocked,
    telemetryDuringBlockedMutations: 'PASS', durableSharedSample: true, telemetryMs: Date.now() - started, productionRowsTouched: 0 }));
  clearTimeout(deadline);
  await admin.query('select pg_advisory_unlock(9811593)');
  await mutations;
  // Reproduce the production contention: an aggregate monitoring read occupies
  // its connection while a new process sample must commit and remain readable.
  await admin.query('begin');
  try {
    await admin.query('lock table public.ivx_autonomous_tasks in access exclusive mode');
    let telemetryFinished = false;
    blockedTelemetry = Promise.allSettled([store.readPostgresFleetSloTasks().finally(() => { telemetryFinished = true; })]);
    let telemetryBlocked = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      telemetryBlocked = Number((await admin.query("select count(*) from pg_stat_activity where application_name='ivx_telemetry' and wait_event_type='Lock'")).rows[0].count) === 1;
      if (telemetryBlocked) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert(telemetryBlocked, 'aggregate telemetry must actually be waiting on the task ledger');
    const presenceStarted = Date.now();
    const processObservation = await Promise.race([(async () => {
      await store.persistPostgresFleetSloSample({ commit_sha: 'b'.repeat(40), measured_at: new Date().toISOString(), durable: true });
      return store.readPostgresFleetProcessObservation();
    })(), new Promise<never>((_, reject) => { deadline = setTimeout(() => reject(new Error('Process presence waited behind aggregate telemetry')), 1_500); })]);
    assert(processObservation.instances.some(instance => instance.instanceId === store.autonomousWorkerInstanceId()
      && instance.commitSha === 'b'.repeat(40) && instance.sharedState && instance.sharedWorkerQueue));
    assert.equal(telemetryFinished, false, 'presence must finish before the blocked aggregate read');
    console.log(JSON.stringify({ ok: true, processObservationWithLockedTaskLedger: 'PASS',
      presenceDuringBlockedTelemetry: 'PASS', freshSampleCommitted: true, presenceMs: Date.now() - presenceStarted, productionRowsTouched: 0 }));
  } finally { clearTimeout(deadline); await admin.query('rollback'); await blockedTelemetry; }
} finally {
  if (deadline) clearTimeout(deadline);
  await admin.query('select pg_advisory_unlock(9811593)');
  await Promise.allSettled([mutations, observation]);
  await admin.query(original);
  await admin.end();
}
process.exit(0);
