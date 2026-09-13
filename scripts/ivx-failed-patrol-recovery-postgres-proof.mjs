import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { recoverFailedPatrols } from '../backend/services/ivx-failed-patrol-recovery.mjs';

const connectionString = process.env.IVX_PATROL_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['postgres:','postgresql:'].includes(url.protocol)
    || !['127.0.0.1','localhost'].includes(url.hostname)
    || url.pathname !== '/ivx_patrol_recovery_test') throw new Error('Disposable local ivx_patrol_recovery_test required');
const a = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 4000 });
const b = new pg.Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 4000 });
const sha = 'a'.repeat(40);
const version = '9007199254740993';
let checks = 0;
const invoke = (client, id) => recoverFailedPatrols({ client, sourceSha: sha, taskIds: [id],
  apply: true, reason: 'Isolated PostgreSQL recovery proof' });
const state = async id => (await a.query('select state,version::text,payload,lease_holder,worker_instance_id,lease_expires_at,last_heartbeat_at from public.ivx_autonomous_tasks where task_id=$1', [id])).rows[0];
const audits = async id => (await a.query("select event from public.ivx_autonomous_task_events where task_id=$1 and event_type='owner_patrol_recovery'", [id])).rows;

try {
  await Promise.all([a.connect(), b.connect()]);
  await a.query("create role anon; create role authenticated; create role service_role bypassrls; create table public.ivx_durable_documents(doc_key text primary key,value jsonb,updated_at timestamptz default now()); create table public.ivx_agent_states(agent_number integer,last_heartbeat timestamptz); create table public.ivx_agent_controls(control_name text primary key,active boolean); insert into public.ivx_agent_controls values ('emergency_stop',false)");
  for (const migration of ['20260907151751_ivx_autonomous_atomic_task_queue.sql','20260908174136_ivx_fleet_retry_schedule.sql']) {
    await a.query(await readFile(new URL('../supabase/migrations/' + migration, import.meta.url), 'utf8'));
  }
  const seed = async (id, agent) => {
    const at = new Date().toISOString();
    const expiry = new Date(Date.now() - 10000).toISOString();
    const payload = { taskId:id, idempotencyKey:'landing-p0-patrol:' + sha + ':ia-' + String(agent).padStart(3,'0'),
      state:'FAILED', assignedAgentNumber:agent, taskType:'qa', priority:'critical', executionOrder:0,
      leaseHolder:'expired-' + id, leaseExpiresAt:expiry,lastHeartbeatAt:expiry,
      retryCount:1,maxRetries:4,retryStartedAt:at,retryNotBefore:null,
      evidence:[{evidenceType:'http_request',summary:'original failed probe'}],filesChanged:[],recordsChanged:4,
      error:'canceling statement due to statement timeout',blocker:null,commitSha:null,deploymentId:null,
      startedAt:at,completedAt:at,createdAt:at,updatedAt:at };
    const inserted = (await a.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb) as result',[JSON.stringify([payload])])).rows[0].result;
    assert.equal(inserted[0].ok,true);
    await a.query('update public.ivx_autonomous_tasks set version=$2::bigint,worker_instance_id=$3 where task_id=$1',[id,version,'expired-process']);
    return payload;
  };

  const original = await seed('patrol-proof-success',1);
  const dry = await recoverFailedPatrols({client:a,sourceSha:sha,taskIds:[original.taskId],apply:false});
  assert.equal(dry.outcome,'DRY_RUN');
  assert.equal((await state(original.taskId)).version,version);
  assert.equal((await audits(original.taskId)).length,0); checks++;

  const applied = await invoke(a,original.taskId);
  assert.equal(applied.outcome,'RECOVERY_RECORDED');
  const saved = await state(original.taskId);
  assert.equal(saved.state,'RETRYING');
  assert.equal(saved.version,'9007199254740994');
  assert.equal(saved.payload.retryCount,2);
  assert.equal(saved.payload.completedAt,null);
  assert.deepEqual(saved.payload.evidence,original.evidence);
  assert.equal(saved.payload.recordsChanged,original.recordsChanged);
  for (const key of ['lease_holder','worker_instance_id','lease_expires_at','last_heartbeat_at']) assert.equal(saved[key],null);
  for (const key of ['leaseHolder','leaseExpiresAt','lastHeartbeatAt']) assert.equal(saved.payload[key],null);
  assert.equal((await audits(original.taskId))[0].event.previousCompletedAt,original.completedAt);
  assert.equal((await audits(original.taskId))[0].event.previousError,original.error);
  const retry = await invoke(a,original.taskId);
  assert.equal(retry.outcome,'NO_ELIGIBLE_TASKS');
  assert.equal((await audits(original.taskId)).length,1); checks++;

  const race = await seed('patrol-proof-race',2);
  const outcomes = await Promise.all([invoke(a,race.taskId),invoke(b,race.taskId)]);
  assert.equal(outcomes.filter(r=>r.outcome==='RECOVERY_RECORDED').length,1);
  assert.equal((await state(race.taskId)).version,'9007199254740994');
  assert.equal((await audits(race.taskId)).length,1); checks++;

  const changed = await seed('patrol-proof-version',3);
  let changedOnce = false;
  const changeClient = { async query(sql,values) {
    const result = await a.query(sql,values);
    if (sql.includes('ANY($1') && !changedOnce) {
      changedOnce = true;
      await b.query("update public.ivx_autonomous_tasks set version=version+1,payload=payload || '{\"concurrentMarker\":true}'::jsonb where task_id=$1",[changed.taskId]);
    }
    return result;
  } };
  const rejected = await invoke(changeClient,changed.taskId);
  assert.equal(rejected.results[0].blocker,'VERSION_CHANGED');
  assert.equal((await state(changed.taskId)).payload.concurrentMarker,true);
  assert.equal((await audits(changed.taskId)).length,0); checks++;

  const rollback = await seed('patrol-proof-audit-rollback',4);
  await a.query("create function pg_temp.reject_patrol_audit() returns trigger language plpgsql as $$ begin if new.event_type='owner_patrol_recovery' then raise exception 'fixture audit failure'; end if; return new; end $$; create trigger reject_patrol_audit before insert on public.ivx_autonomous_task_events for each row execute function pg_temp.reject_patrol_audit()");
  try {
    assert.equal((await invoke(a,rollback.taskId)).outcome,'TRANSACTION_ABORTED');
    assert.equal((await state(rollback.taskId)).state,'FAILED');
    assert.equal((await state(rollback.taskId)).version,version);
    assert.equal((await audits(rollback.taskId)).length,0);
  } finally { await a.query('drop trigger reject_patrol_audit on public.ivx_autonomous_task_events'); }
  checks++;

  const stopped = await seed('patrol-proof-stop',5);
  await a.query("update public.ivx_agent_controls set active=true where control_name='emergency_stop'");
  try {
    assert.equal((await invoke(a,stopped.taskId)).results[0].blocker,'EMERGENCY_STOP_ACTIVE_OR_UNAVAILABLE');
    assert.equal((await state(stopped.taskId)).version,version);
  } finally { await a.query("update public.ivx_agent_controls set active=false where control_name='emergency_stop'"); }
  checks++;

  const uncertain = await seed('patrol-proof-lost-ack',6);
  const lostAck = { async query(sql,values) {
    const result = await a.query(sql,values);
    if (sql==='COMMIT') throw new Error('fixture response lost after actual COMMIT');
    return result;
  } };
  const lost = await invoke(lostAck,uncertain.taskId);
  assert.equal(lost.outcome,'WRITE_UNCONFIRMED');
  assert.equal((await state(uncertain.taskId)).state,'RETRYING');
  assert.equal((await audits(uncertain.taskId)).length,1);
  assert.equal((await invoke(a,uncertain.taskId)).outcome,'NO_ELIGIBLE_TASKS');
  assert.equal((await audits(uncertain.taskId)).length,1); checks++;

  console.log(JSON.stringify({status:'PASS',checks,database:'isolated PostgreSQL',connections:2,
    productionTouched:false,providerCalls:0}));
} finally {
  await Promise.allSettled([a.end(),b.end()]);
}

