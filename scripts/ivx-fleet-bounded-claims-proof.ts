import assert from 'node:assert/strict';
import pg from 'pg';
import { refillFleetBatches } from '../backend/services/ivx-fleet-refill-batches';
import { queryWithPostgresDeadline } from '../backend/services/ivx-postgres-deadline';

const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
const pool = new pg.Pool({ connectionString, max: 2, query_timeout: 5_000 });
const admin = new pg.Client({ connectionString });
await admin.connect();
const original = (await admin.query("select pg_get_functiondef('public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)'::regprocedure) definition")).rows[0].definition;
try {
  // Add deterministic per-lane work only to this isolated database. A single
  // 112-lane call exceeds the real server deadline; four-lane calls can commit.
  const instrumented = original.replace("v_worker_id := nullif(v_request->>'workerId','');", "perform pg_catalog.pg_sleep(0.05);\n    v_worker_id := nullif(v_request->>'workerId','');");
  assert.notEqual(instrumented, original);
  await admin.query(instrumented);
  await admin.query('truncate public.ivx_autonomous_task_events, public.ivx_autonomous_tasks');
  const tasks = Array.from({ length: 112 }, (_, i) => ({ taskId: `bounded-${i + 1}`, idempotencyKey: `bounded-${i + 1}`,
    assignedAgentNumber: i + 1, state: 'QUEUED', dependencies: [] }));
  await admin.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb)', [JSON.stringify(tasks)]);
  const requests = tasks.map((task, i) => ({ workerId: `agent:bounded-${i + 1}`, agentNumber: task.assignedAgentNumber }));
  const rpc = async (name: string, rows: unknown) => (await queryWithPostgresDeadline<{ result: any }>(pool,
    `select public.${name}($1::jsonb,$2::text,120) result`, [JSON.stringify(rows), 'bounded-proof'])).rows[0].result;
  await assert.rejects(rpc('ivx_autonomous_tasks_claim_batch', requests), (error: any) => error.code === '57014');
  const rolledBack = await admin.query("select count(*)::int n from public.ivx_autonomous_tasks where state='QUEUED'");
  assert.equal(rolledBack.rows[0].n, 112, 'timed-out full batch must roll back every lease');
  let dispatched = 0;
  await refillFleetBatches(requests, {
    batchSize: 4, shouldStop: () => false,
    lease: async rows => {
      assert(rows.length <= 4);
      const running = await admin.query("select count(*)::int n from public.ivx_autonomous_tasks where state='RUNNING'");
      assert.equal(running.rows[0].n, dispatched, 'dispatch must follow a durable start before the next claim');
      return rpc('ivx_autonomous_tasks_claim_batch', rows);
    },
    start: rows => rpc('ivx_autonomous_tasks_start_batch', rows),
    onStarted: () => { dispatched++; return true; },
    release: async () => { throw new Error('Accepted executions must retain their leases'); },
  });
  const running = await admin.query("select count(*)::int n,count(distinct lease_holder)::int holders from public.ivx_autonomous_tasks where state='RUNNING' and worker_instance_id='bounded-proof'");
  assert.equal(dispatched, 112); assert.deepEqual(running.rows[0], { n: 112, holders: 112 });
  console.log(JSON.stringify({ ok: true, database: 'isolated PostgreSQL', syntheticLaneLatencyMs: 50,
    oversizedBatchCancelledAndRolledBack: true, boundedClaimsCommitted: true, durableRunning: 112,
    distinctLeaseHolders: 112, incrementalDispatch: true, productionRowsTouched: 0 }));
} finally {
  await admin.query(original);
  await Promise.allSettled([admin.end(), pool.end()]);
}
