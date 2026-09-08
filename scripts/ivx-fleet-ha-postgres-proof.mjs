import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

// This destructive fixture is restricted to an explicitly named local test DB.
const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
await Promise.all([a.connect(), b.connect()]);
try {
  await a.query("create role anon; create role authenticated; create role service_role bypassrls; create table public.ivx_durable_documents(doc_key text, value jsonb); create table public.ivx_agent_states(agent_number integer,last_heartbeat timestamptz);");
  for (const name of ['20260907151751_ivx_autonomous_atomic_task_queue.sql', '20260907153209_ivx_autonomous_unique_worker_lease.sql',
    '20260907175500_ivx_autonomous_release_worker_leases.sql', '20260908174136_ivx_fleet_retry_schedule.sql',
    '20260908195000_ivx_fleet_dashboard_observation.sql', '20260908195100_ivx_fleet_process_fencing.sql']) {
    await a.query(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const fixtures = [1, 2].map(n => ({ taskId: `ha-${n}`, idempotencyKey: `ha-${n}`, assignedAgentNumber: 1,
    state: 'QUEUED', dependencies: [], retryCount: 0, maxRetries: 2 }));
  await a.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb)', [JSON.stringify(fixtures)]);
  const request = JSON.stringify([{ workerId: 'agent:ivx_holdings_1', agentNumber: 1 }]);
  const claim = async (client, id) => (await client.query('select public.ivx_autonomous_tasks_claim_batch($1::jsonb,$2,60) as value', [request, id])).rows[0].value[0];
  const claims = await Promise.all([claim(a, 'replica-a'), claim(b, 'replica-b')]);
  assert.equal(claims.filter(c => c.task).length, 1, 'two DB connections must acquire exactly one logical lane');
  const winner = claims[0].task ? 'replica-a' : 'replica-b'; const loser = winner === 'replica-a' ? 'replica-b' : 'replica-a';
  const task = claims.find(c => c.task).task;
  const lease = JSON.stringify([{ taskId: task.taskId, workerId: 'agent:ivx_holdings_1' }]);
  const start = async id => (await a.query('select public.ivx_autonomous_tasks_start_batch($1::jsonb,$2,60) as value', [lease, id])).rows[0].value[0];
  const heartbeat = async id => (await a.query('select public.ivx_autonomous_tasks_heartbeat_batch($1::jsonb,$2,60) as value', [lease, id])).rows[0].value;
  assert.equal((await start(loser)).ok, false, 'another replica must not start the winning lease');
  assert.equal((await heartbeat(loser)).refreshed, 0, 'another replica must not renew the winning lease');
  const running = await start(winner); assert.equal(running.ok, true);
  const finish = async id => (await a.query('select public.ivx_autonomous_task_compare_and_set($1::jsonb,$2::jsonb,$3,$4,$5) as value',
    [JSON.stringify({ ...running.task, state: 'EXECUTION_COMPLETED' }), '["RUNNING"]', 'agent:ivx_holdings_1', id, 'ha_test'])).rows[0].value;
  assert.equal((await finish(loser)).ok, false, 'stale process completion must be fenced');
  await a.query("update public.ivx_autonomous_tasks set lease_expires_at=now()-interval '1 second' where task_id=$1", [task.taskId]);
  assert.equal((await heartbeat(winner)).refreshed, 0, 'expired worker cannot resurrect its lease');
  assert.equal((await finish(winner)).ok, false, 'expired worker cannot finish');
  const recovered = await claim(b, loser); assert.ok(recovered.task, 'surviving replica must claim available work');
  const release = (await a.query('select public.ivx_autonomous_tasks_release_worker($1) as value', [winner])).rows[0].value;
  assert.equal(release.released, 0, 'late shutdown must not release successor leases');
  const observation = (await a.query('select public.ivx_fleet_dashboard_observation() as value')).rows[0].value;
  assert.equal(observation.assignments[0].taskCount, 2);
  assert.equal(observation.activeTasks.length, 1);
  const privileges = (await a.query("select has_function_privilege('anon','public.ivx_fleet_dashboard_observation()','execute') as anon, has_function_privilege('authenticated','public.ivx_fleet_dashboard_observation()','execute') as authenticated, has_function_privilege('service_role','public.ivx_fleet_dashboard_observation()','execute') as service")).rows[0];
  assert.deepEqual(privileges, { anon: false, authenticated: false, service: true });
  console.log(JSON.stringify({ ok: true, database: 'isolated PostgreSQL', connections: 2, concurrentClaimWinners: 1,
    wrongProcessStartRejected: true, wrongProcessHeartbeatRejected: true, staleCompletionRejected: true,
    expiredLeaseCannotResurrect: true, survivorRefilled: true, lateShutdownFenced: true, privateObservation: true, productionRowsTouched: 0 }));
} finally { await Promise.allSettled([a.end(), b.end()]); }
