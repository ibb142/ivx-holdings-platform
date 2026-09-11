import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.IVX_OWNER_QUEUE_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_owner_queue_test') throw new Error('Isolated local test database required');
const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
await Promise.all([a.connect(), b.connect()]);
const sha = process.env.GITHUB_SHA || 'a'.repeat(40), startedAt = new Date().toISOString();
const rpc = async (client, name, params = []) => (await client.query(`select public.${name}(${params.map((_, i) => '$' + (i + 1)).join(',')}) value`, params)).rows[0].value;
const events = [];
try {
  await a.query(`create role anon; create role authenticated; create role service_role bypassrls;
    create table public.ivx_durable_documents(doc_key text primary key,value jsonb);
    create table public.ivx_agent_controls(control_name text primary key,active boolean);
    create table public.conversations(id uuid primary key);
    create table public.messages(id uuid primary key,conversation_id uuid references public.conversations(id),sender_id text not null,text text);
    insert into public.ivx_durable_documents values('app-completion/campaign-state.json','{"control":{"paused":false,"stopped":false}}');
    insert into public.ivx_agent_controls values('emergency_stop',false);`);
  const source = await readFile(new URL('../backend/services/ivx-owner-ai-task-queue.ts', import.meta.url), 'utf8');
  const ddl = source.match(/const TASK_TABLE_DDL = `([\s\S]*?)`;/)?.[1];
  assert(ddl, 'Real application task schema must be present');
  await a.query(ddl.replaceAll('${TASKS_TABLE}', 'ivx_owner_ai_tasks'));
  await a.query("alter table public.ivx_owner_ai_tasks add column task_type text default 'general'; grant all on all tables in schema public to service_role;");
  const migration = await readFile(new URL('../supabase/repair-functions/ivx_owner_ai_queue_recovery.sql', import.meta.url), 'utf8');
  await a.query(migration);
  await Promise.all([a.query('set role service_role'), b.query('set role service_role')]);
  await Promise.all([rpc(a, 'ivx_owner_ai_worker_pulse', ['worker-a', sha, 'instance-a', 'ready']), rpc(b, 'ivx_owner_ai_worker_pulse', ['worker-b', sha, 'instance-b', 'ready'])]);
  const convo = randomUUID();
  await a.query('insert into public.conversations values($1)', [convo]);
  const add = async (id, changes = {}) => {
    const value = { id, trace_id: 'qa-owner-' + id, idempotency_key: id, prompt: 'isolated queue proof', status: 'QUEUED', conversation_id: convo, ...changes };
    const keys = Object.keys(value);
    await a.query(`insert into public.ivx_owner_ai_tasks(${keys.join(',')}) values(${keys.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(value));
  };
  const senior = randomUUID(), id = randomUUID();
  await add(senior, { task_type: 'senior_dev', trace_id: 'senior-dev-qa', created_at: '2020-01-01' });
  await add(id);
  const two = await Promise.all([rpc(a, 'ivx_owner_ai_queue_claim', ['worker-a', 1]), rpc(b, 'ivx_owner_ai_queue_claim', ['worker-b', 1])]);
  assert.equal(two.reduce((n, x) => n + x.tasks.length, 0), 1);
  const first = two.flatMap(x => x.tasks)[0], winner = first.claimed_by, other = winner === 'worker-a' ? 'worker-b' : 'worker-a';
  assert.equal(first.id, id, 'Senior rows must be excluded before the LIMIT');
  const update = (worker, token, operation, payload = {}) => rpc(a, 'ivx_owner_ai_queue_update', [id, worker, token, operation, JSON.stringify(payload)]);
  assert.equal(await update(other, first.queue_lease_token, 'heartbeat'), false);
  assert.equal(await update(winner, first.queue_lease_token, 'checkpoint', { checkpoint: 'ANSWER_RECEIVED', answer: 'durable answer', model: 'fixture', provider: 'fixture' }), true);
  events.push('concurrent_claim_exclusion', 'wrong_worker_heartbeat_rejected', 'senior_partition_before_limit');

  // Simulate a database lock-pressure timeout on renewal. Transaction rollback
  // must preserve both the task and its answer checkpoint.
  await b.query('begin');
  await b.query('select id from public.ivx_owner_ai_tasks where id=$1 for update', [id]);
  await a.query('begin');
  await a.query("set local lock_timeout='80ms'");
  await assert.rejects(update(winner, first.queue_lease_token, 'heartbeat'), error => error.code === '55P03');
  await a.query('rollback'); await b.query('rollback');
  let row = (await a.query('select * from public.ivx_owner_ai_tasks where id=$1', [id])).rows[0];
  assert.equal(row.answer, 'durable answer'); assert.equal(row.checkpoint, 'ANSWER_RECEIVED');
  await a.query("update public.ivx_owner_ai_tasks set queue_lease_until=now()-interval '1 second' where id=$1", [id]);
  const recovered = await rpc(b, 'ivx_owner_ai_queue_claim', [other, 1]);
  assert.equal(recovered.recovered, 1); assert.equal(recovered.tasks[0].id, id);
  const token = recovered.tasks[0].queue_lease_token;
  assert.notEqual(token, first.queue_lease_token); assert.equal(recovered.tasks[0].answer, 'durable answer');
  assert.equal(await update(winner, first.queue_lease_token, 'heartbeat'), false);
  assert.equal((await rpc(a, 'ivx_owner_ai_queue_complete', [id, winner, first.queue_lease_token, 'qa-assistant'])).applied, false);
  const complete = await rpc(b, 'ivx_owner_ai_queue_complete', [id, other, token, 'qa-assistant']);
  assert.equal(complete.applied, true);
  assert.equal((await rpc(b, 'ivx_owner_ai_queue_complete', [id, other, token, 'qa-assistant'])).duplicate, true);
  assert.equal((await a.query('select count(*)::int n from public.messages where id=$1', [id])).rows[0].n, 1);
  assert.equal(await update(other, token, 'failure', { status: 'FAILED' }), false);
  events.push('database_lock_pressure_preserves_checkpoint', 'lease_recovery_reuses_answer', 'late_worker_fenced', 'atomic_idempotent_reply');

  const canceled = randomUUID(); await add(canceled);
  const cancelLease = (await rpc(a, 'ivx_owner_ai_queue_claim', ['worker-a', 1])).tasks[0];
  await a.query("update public.ivx_owner_ai_tasks set status='CANCELED' where id=$1", [canceled]);
  assert.equal(await rpc(b, 'ivx_owner_ai_queue_update', [canceled, 'worker-a', cancelLease.queue_lease_token, 'checkpoint', '{"answer":"must not publish"}']), false);
  assert.equal((await rpc(b, 'ivx_owner_ai_queue_complete', [canceled, 'worker-a', cancelLease.queue_lease_token, 'qa-assistant'])).applied, false);
  events.push('cancellation_wins_over_late_execution');

  const retry = randomUUID(); await add(retry, { next_retry_at: new Date(Date.now() + 60_000).toISOString() });
  assert.equal((await rpc(a, 'ivx_owner_ai_queue_claim', ['worker-a', 2])).tasks.length, 0);
  await a.query("update public.ivx_owner_ai_tasks set next_retry_at=null where id=$1", [retry]);
  for (const control of ['paused', 'stopped']) {
    await a.query("update public.ivx_durable_documents set value=jsonb_set(value,$1,'true') where doc_key='app-completion/campaign-state.json'", [['control', control]]);
    assert.equal((await rpc(a, 'ivx_owner_ai_queue_claim', ['worker-a', 2])).authorized, false);
    assert.equal((await rpc(a, 'ivx_owner_ai_queue_health', [sha])).authorized, false);
    await a.query("update public.ivx_durable_documents set value=jsonb_set(value,$1,'false') where doc_key='app-completion/campaign-state.json'", [['control', control]]);
  }
  await a.query("update public.ivx_agent_controls set active=true where control_name='emergency_stop'");
  assert.equal((await rpc(b, 'ivx_owner_ai_queue_claim', ['worker-b', 2])).authorized, false);
  await a.query("update public.ivx_agent_controls set active=false where control_name='emergency_stop'");
  const release = (await rpc(a, 'ivx_owner_ai_queue_claim', ['worker-a', 1])).tasks[0];
  await rpc(a, 'ivx_owner_ai_queue_update', [retry, 'worker-a', release.queue_lease_token, 'checkpoint', '{"checkpoint":"ANSWER_RECEIVED","answer":"saved before shutdown"}']);
  await rpc(a, 'ivx_owner_ai_worker_pulse', ['worker-a', sha, 'instance-a', 'draining']);
  assert.equal(await rpc(a, 'ivx_owner_ai_queue_update', [retry, 'worker-a', release.queue_lease_token, 'release', '{}']), true);
  const resumed = (await rpc(b, 'ivx_owner_ai_queue_claim', ['worker-b', 1])).tasks[0];
  assert.equal(resumed.answer, 'saved before shutdown');
  assert.equal((await rpc(b, 'ivx_owner_ai_queue_complete', [retry, 'worker-b', resumed.queue_lease_token, 'qa-assistant'])).applied, true);
  events.push('scheduled_retry_not_claimed_early', 'pause_stop_emergency_respected', 'graceful_release_preserves_answer');

  // Exercise the real GET-RPC's stable function in a read-only transaction, with
  // more rows than every response limit. No health probe may mutate the queue.
  await a.query("insert into public.ivx_owner_ai_tasks(id,trace_id,idempotency_key,prompt,status) select gen_random_uuid(),'bounded-pending-'||n,'bounded-pending-'||n,'health fixture','QUEUED' from generate_series(1,205) n");
  await a.query("insert into public.ivx_owner_ai_tasks(id,trace_id,idempotency_key,prompt,status,dead_letter) select gen_random_uuid(),'bounded-dead-'||n,'bounded-dead-'||n,'health fixture','FAILED',true from generate_series(1,105) n");
  await a.query("insert into public.ivx_owner_ai_queue_workers(worker_id,instance_id,source_sha,state) select 'bounded-worker-'||n,'bounded-instance-'||n,$1,'ready' from generate_series(1,12) n", [sha]);
  await a.query('begin read only');
  const snapshot = await rpc(a, 'ivx_owner_ai_queue_health', [sha]);
  assert.equal(snapshot.authorized, true); assert.equal(snapshot.pending.length, 200);
  assert.equal(snapshot.dead.length, 100); assert.equal(snapshot.workers.length, 10);
  assert.equal((await rpc(a, 'ivx_owner_ai_queue_health', ['b'.repeat(40)])).workers.length, 0);
  await a.query('commit');
  events.push('bounded_read_only_health_snapshot', 'health_workers_match_release_sha');

  await a.query('reset role');
  const acl = (await a.query("select bool_and(not prosecdef) invoker, bool_and(proconfig @> array['search_path=\"\"']) empty_path from pg_proc where pronamespace='public'::regnamespace and proname in ('ivx_owner_ai_queue_authorized','ivx_owner_ai_queue_health','ivx_owner_ai_worker_pulse','ivx_owner_ai_queue_recover','ivx_owner_ai_queue_claim','ivx_owner_ai_queue_update','ivx_owner_ai_queue_complete')")).rows[0];
  assert.equal(acl.invoker, true); assert.equal(acl.empty_path, true);
  for (const role of ['anon', 'authenticated']) {
    await a.query(`set role ${role}`);
    await assert.rejects(rpc(a, 'ivx_owner_ai_queue_claim', ['worker-a', 1]), error => error.code === '42501');
    await assert.rejects(rpc(a, 'ivx_owner_ai_queue_health', [sha]), error => error.code === '42501');
    await assert.rejects(a.query('select * from public.ivx_owner_ai_queue_workers'), error => error.code === '42501');
    await a.query('reset role');
  }
  assert.equal((await a.query('select status from public.ivx_owner_ai_tasks where id=$1', [senior])).rows[0].status, 'QUEUED');
  events.push('service_role_only_invoker_acl');
  const report = { result: 'PASS', sourceSha: sha, startedAt, completedAt: new Date().toISOString(), connections: 2, checks: events, productionRowsTouched: 0 };
  await mkdir('qa/evidence/owner-queue', { recursive: true });
  await writeFile('qa/evidence/owner-queue/postgres.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
} finally { await Promise.allSettled([a.end(), b.end()]); }
