import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1','localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Isolated ivx_ha_test database required');
const a = new pg.Client({ connectionString }), b = new pg.Client({ connectionString });
const objective = 'objective-link-fixture';
await Promise.all([a.connect(),b.connect()]);
try {
  const states = ['RUNNING','LEASED','PAUSED','WAITING_FOR_APPROVAL','BLOCKED','FAILED','CANCELLED','EXPIRED','VERIFIED','NO_ACTION_REQUIRED'];
  for (let n=0;n<337;n++) {
    const id=`link-proof-queued-${String(n).padStart(3,'0')}`;
    await a.query(`insert into public.ivx_autonomous_tasks(task_id,idempotency_key,state,payload,created_at)
      values($1,$1,'QUEUED',$2,'2000-01-01')`,[id,{taskId:id,commitSha:'a'.repeat(40),evidence:[{id:`evidence-${n}`}]}]);
  }
  for (const state of states) {
    const id=`link-proof-protected-${state}`;
    await a.query(`insert into public.ivx_autonomous_tasks(task_id,idempotency_key,state,payload)
      values($1,$1,$2,$3)`,[id,state,{taskId:id,commitSha:'b'.repeat(40),evidence:[{id:state}]}]);
  }
  const leased='link-proof-protected-owner';
  await a.query(`insert into public.ivx_autonomous_tasks(task_id,idempotency_key,state,lease_holder,worker_instance_id,payload)
    values($1,$1,'QUEUED','fixture-agent','fixture-worker',$2)`,[leased,{taskId:leased,evidence:[{id:'owned'}]}]);
  const protectedRows = async () => (await b.query("select * from public.ivx_autonomous_tasks where task_id like 'link-proof-protected-%' order by task_id")).rows;
  const originalProtected = await protectedRows();
  const originalPayloads = (await a.query("select task_id,payload from public.ivx_autonomous_tasks where task_id like 'link-proof-queued-%' order by task_id")).rows;
  const eligible=(await a.query("select count(*)::integer as n from public.ivx_autonomous_tasks where (payload->>'objectiveId' is null or payload->>'objectiveId'='') and lease_holder is null and worker_instance_id is null and state in ('RECEIVED','VALIDATING','PLANNING','QUEUED','RETRYING')")).rows[0].n;
  const privileges = async () => (await b.query("select has_function_privilege('anon','public.ivx_autonomous_tasks_link_objective(text)','execute') as anon,has_function_privilege('authenticated','public.ivx_autonomous_tasks_link_objective(text)','execute') as authenticated,has_function_privilege('service_role','public.ivx_autonomous_tasks_link_objective(text)','execute') as service")).rows[0];
  const accessBefore = await privileges();
  assert.deepEqual(accessBefore,{anon:false,authenticated:false,service:true});
  await b.query("set lock_timeout='200ms'; set statement_timeout='2s'");
  const assertProgress = async () => {
    const count=(await b.query('select public.ivx_autonomous_tasks_link_objective($1) as n',[objective])).rows[0].n;
    assert.equal(count,112,'An occupied task must allow a full bounded batch of other eligible tasks');
    return count;
  };
  await a.query('begin');
  await a.query("select task_id from public.ivx_autonomous_tasks where task_id='link-proof-queued-000' for update");
  await assert.rejects(assertProgress(),error=>error.code==='55P03','Baseline must reproduce objective linking blocked by another transaction');
  await a.query('rollback');
  await a.query('begin');
  await a.query(await readFile(new URL('../supabase/migrations/20260911041334_bounded_objective_linking.sql',import.meta.url),'utf8'));
  await a.query('commit');
  assert.deepEqual(await privileges(),accessBefore);
  await a.query('begin');
  await a.query("select task_id from public.ivx_autonomous_tasks where task_id='link-proof-queued-000' for update");
  await assertProgress();
  assert.equal((await a.query("select payload->>'objectiveId' as id from public.ivx_autonomous_tasks where task_id='link-proof-queued-000'")).rows[0].id,null);
  assert.deepEqual(await protectedRows(),originalProtected);
  await a.query('commit');
  let zero=false;
  for(let i=0;i<Math.ceil(eligible/112)+2;i++) {
    const n=(await b.query('select public.ivx_autonomous_tasks_link_objective($1) as n',[objective])).rows[0].n;
    assert.ok(n>=0 && n<=112);
    if(n===0) { zero=true;break; }
  }
  assert.ok(zero,'Reconciliation must become a no-op after the bounded backlog is linked');
  const after = (await b.query("select task_id,payload from public.ivx_autonomous_tasks where task_id like 'link-proof-queued-%' order by task_id")).rows;
  for(let i=0;i<after.length;i++) {
    assert.equal(after[i].payload.objectiveId,objective);
    const payload={...after[i].payload};delete payload.objectiveId;delete payload.updatedAt;
    assert.deepEqual(payload,originalPayloads[i].payload,'Commit and evidence must survive metadata linking');
  }
  assert.deepEqual(await protectedRows(),originalProtected);
  const events=(await b.query("select event from public.ivx_autonomous_task_events where event_type='orphan_tasks_linked_to_objective' and event->>'objectiveId'=$1",[objective])).rows;
  assert.ok(events.every(({event})=>event.linked<=112 && event.linked===event.taskIds.length));
  await assert.rejects(b.query('select public.ivx_autonomous_tasks_link_objective($1)',['']),error=>error.code==='22023');
  const proof={ok:true,sourceSha:process.env.GITHUB_SHA??null,baselineLockTimeout:true,sameProgressAssertionPasses:true,batchLimit:112,eligibleFixturesLinked:after.length,protectedFixturesUnchanged:states.length+1,commitAndEvidencePreserved:true,privateAccessUnchanged:true,idempotent:true,productionRowsTouched:0};
  const output=new URL('../qa/evidence/fleet-ha/objective-link.json',import.meta.url);
  await mkdir(new URL('.',output),{recursive:true});await writeFile(output,JSON.stringify(proof,null,2)+'\n');console.log(JSON.stringify(proof));
} finally { await Promise.allSettled([a.query('rollback'),b.query('rollback')]);await Promise.allSettled([a.end(),b.end()]); }
