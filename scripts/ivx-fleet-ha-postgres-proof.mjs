import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { proveInterruptedTaskRecovery } from './ivx-task-recovery-postgres-proof.mjs';

// This destructive fixture is restricted to an explicitly named local test DB.
const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
await Promise.all([a.connect(), b.connect()]);
try {
  await a.query("create role anon; create role authenticated; create role service_role bypassrls; create table public.ivx_durable_documents(doc_key text primary key, value jsonb, updated_at timestamptz default now()); create table public.ivx_agent_states(agent_number integer,last_heartbeat timestamptz);");
  for (const name of ['20260907151751_ivx_autonomous_atomic_task_queue.sql', '20260907153209_ivx_autonomous_unique_worker_lease.sql',
    '20260907175500_ivx_autonomous_release_worker_leases.sql', '20260908174136_ivx_fleet_retry_schedule.sql',
    '20260908203927_ivx_fleet_dashboard_observation.sql', '20260908203936_ivx_fleet_process_fencing.sql', '20260908211042_ivx_senior_queue_atomic.sql', '20260908211054_ivx_shared_room_messages.sql', '20260908211101_ivx_ha_observation_roles.sql', '20260908220633_ivx_senior_lease_identity_required.sql', '20260908220934_ivx_senior_claim_transition_required.sql']) {
    await a.query(await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8'));
  }
  const fixtures = [1, 2].map(n => ({ taskId: `ha-${n}`, idempotencyKey: `ha-${n}`, assignedAgentNumber: 1,
    state: 'QUEUED', dependencies: [], retryCount: 0, maxRetries: 2 }));
  await a.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb)', [JSON.stringify(fixtures)]);
  const request = JSON.stringify([{ workerId: 'agent:ivx_holdings_1', agentNumber: 1 }]);
  const claim = async (client, id) => (await client.query('select public.ivx_autonomous_tasks_claim_batch($1::jsonb,$2,60) as value', [request, id])).rows[0].value[0];
  await a.query(await readFile(new URL('../supabase/migrations/20260909141222_ivx_nonblocking_worker_claims.sql', import.meta.url), 'utf8'));
  // A live competing transaction retains its lock throughout this request.
  // The loser must return promptly without taking work or weakening fencing.
  await a.query('begin');
  try {
    await a.query("select pg_advisory_xact_lock(hashtextextended('ivx-autonomous-worker:agent:ivx_holdings_1',0))");
    await b.query("set statement_timeout='1s'");
    const contended = await claim(b, 'contended-replica');
    assert.equal(contended.task, null);
    assert.equal(contended.claimContended, true);
    assert.equal(contended.ok, true);
  } finally {
    await a.query('rollback');
    await b.query('reset statement_timeout');
  }
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
  // The claim RPC also fences restart resumes of already-created PRs.
  const queueJob = n => ({ jobId: `senior-${n}`, ownerId: 'test-owner', status: 'queued', attempts: 0, createdAt: new Date().toISOString(), idempotencyKey: `senior-key-${n}` });
  const qa = queueJob(1), qb = queueJob(2);
  const patch = (client, changes) => client.query('select public.ivx_senior_queue_patch($1::jsonb) as value', [JSON.stringify(changes)]);
  await Promise.all([patch(a, [{ expected: null, next: qa }]), patch(b, [{ expected: null, next: qb }])]);
  let queue = (await a.query("select value from public.ivx_durable_documents where doc_key='senior-developer-worker/queue.json'")).rows[0].value;
  assert.equal(queue.jobs.length, 2, 'parallel API enqueues must not overwrite each other');
  await assert.rejects(patch(b, [{ expected: qb, next: { ...qb, status: 'running' } }]), /Queued work requires the atomic claim RPC/);
  const claimSenior = async (client, id, worker) => (await client.query('select public.ivx_senior_queue_claim($1,$2) as value', [id, worker])).rows[0].value;
  const seniorClaims = await Promise.all([claimSenior(a, qa.jobId, 'senior-a'), claimSenior(b, qa.jobId, 'senior-b')]);
  assert.equal(seniorClaims.filter(Boolean).length, 1, 'shared document claims are atomic');
  const senior = seniorClaims.find(Boolean); const seniorWorker = senior.leaseWorkerInstanceId;
  const resume = { jobId: 'resume-test', ownerId: 'resume-owner', status: 'committing', attempts: 1, leaseExpiresAt: new Date(Date.now()-1000).toISOString(), result: { commitSha: 'a'.repeat(40), prNumber: 1 } };
  await patch(a, [{ expected: null, next: resume }]);
  const resumes = await Promise.all([a.query('select public.ivx_senior_queue_claim($1,$2,true) as value', [resume.jobId,'resume-a']), b.query('select public.ivx_senior_queue_claim($1,$2,true) as value', [resume.jobId,'resume-b'])]);
  assert.equal(resumes.filter(r => r.rows[0].value).length, 1, 'only one replica may resume the same PR merge wait');

  assert.equal(await claimSenior(b, qb.jobId, 'another-worker'), null, 'one active job per owner across replicas');
  await assert.rejects(patch(a, [{ expected: senior, next: { ...senior, status: 'completed' }, workerInstanceId: 'stale-worker' }]), /Worker lease lost/);
  await assert.rejects(patch(b, [{ expected: senior, next: { ...senior, status: 'completed' } }]), /Worker lease identity required/);
  await assert.rejects(patch(b, [{ expected: senior, next: { ...senior, lastHeartbeatAt: new Date().toISOString() } }]), /Worker lease identity required/);
  await patch(a, [{ expected: senior, next: { ...senior, status: 'cancelled' } }]);
  const cancelled = { ...senior, status: 'cancelled' };
  await assert.rejects(patch(b, [{ expected: cancelled, next: { ...cancelled, status: 'running' } }]), /Terminal job cannot be reactivated/);
  await assert.rejects(patch(b, [{ expected: senior, next: { ...senior, status: 'completed' }, workerInstanceId: seniorWorker }]), /changed concurrently/);
  assert.ok(await claimSenior(b, qb.jobId, 'another-worker'), 'owner cancellation returns capacity');
  await Promise.all([a.query('select public.ivx_senior_ledger_put($1::jsonb)', [JSON.stringify({ jobId: 'proof-a' })]),
    b.query('select public.ivx_senior_ledger_put($1::jsonb)', [JSON.stringify({ jobId: 'proof-b' })])]);
  const ledger = (await a.query("select value from public.ivx_durable_documents where doc_key='senior-developer-worker/proof-ledger.json'")).rows[0].value;
  assert.equal(ledger.entries.length, 2, 'parallel proof writes must both survive');
  await a.query("insert into public.ivx_shared_room_messages(room_id,username,text,source) values ('ha-room','fixture','Shared across connections','user')");
  assert.equal((await b.query("select text from public.ivx_shared_room_messages where room_id='ha-room'")).rows[0].text, 'Shared across connections');
  const roomAccess = (await a.query("select has_table_privilege('anon','public.ivx_shared_room_messages','select') as anon, has_table_privilege('authenticated','public.ivx_shared_room_messages','insert') as authenticated, has_table_privilege('service_role','public.ivx_shared_room_messages','select,insert') as service")).rows[0];
  assert.deepEqual(roomAccess, { anon: false, authenticated: false, service: true });
  await a.query("insert into public.ivx_autonomous_task_events(event_type,worker_instance_id,event) values ('fleet_slo_sample','ha-role-test','{\"instance_role\":\"api\",\"process_role\":\"api\",\"shared_state\":true,\"shared_worker_queue\":true}')");
  const roles = (await b.query('select public.ivx_fleet_dashboard_observation() as value')).rows[0].value;
  assert.equal(roles.instances[0].processRole, 'api'); assert.equal(roles.instances[0].sharedState, true);
  const taskRecovery = await proveInterruptedTaskRecovery(a, b);
  assert.equal(taskRecovery.verification, 'PASS');
  console.log(JSON.stringify({ ok: true, database: 'isolated PostgreSQL', connections: 2, concurrentClaimWinners: 1,
    interruptedTaskRecovery: taskRecovery.verification,
    sharedRoomHistory: true, privateRoomStorage: true, roleObservation: true, parallelEnqueuesPreserved: true, atomicSeniorClaims: true, missingWorkerIdentityRejected: true, terminalResurrectionRejected: true, crossReplicaOwnerSingleFlight: true, concurrentProofsPreserved: true, wrongProcessStartRejected: true, wrongProcessHeartbeatRejected: true, staleCompletionRejected: true,
    expiredLeaseCannotResurrect: true, survivorRefilled: true, lateShutdownFenced: true, privateObservation: true, productionRowsTouched: 0 }));
} finally { await Promise.allSettled([a.end(), b.end()]); }
