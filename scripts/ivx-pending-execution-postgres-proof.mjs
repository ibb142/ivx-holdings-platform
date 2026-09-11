import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') {
  throw new Error('Local ivx_ha_test database required');
}
const db = new pg.Client({ connectionString });
await db.connect();
const query = `select task_id,run_id,agent_id,agent_number,workflow,task_type,final_status,started_at
  from public.ivx_agent_executions where final_status=any($1::text[])
  and workflow=$2 and task_type=$3 order by started_at asc nulls first,task_id asc limit $4`;
const values = [['pending', 'running'], 'ivx-112-real-execution-certificate', 'real_execution_certification', 2];
let latestPlan;
async function probe() {
  const rows = (await db.query({ name: 'pending-discovery-proof', text: query, values })).rows;
  assert.deepEqual(rows.map(row => row.task_id), ['a-pending', 'b-pending'], 'filter before limit; stable null-first task identity');
  const explained = (await db.query(`explain (analyze, buffers, format json)
    execute "pending-discovery-proof" (array['pending','running'],
      'ivx-112-real-execution-certificate','real_execution_certification',2)`)).rows[0]['QUERY PLAN'][0];
  latestPlan = explained;
  // Bounds physical work rather than checking for a particular index name.
  // The old status index reads thousands of unrelated wide execution rows.
  assert.ok(explained.Plan['Shared Hit Blocks'] + explained.Plan['Shared Read Blocks'] < 50,
    'pending discovery must read fewer than 50 blocks despite retained history');
  return explained;
}
try {
  await db.query(`create table public.ivx_agent_executions (
    task_id text primary key,run_id text not null,agent_id text not null,agent_number int not null,
    workflow text not null,task_type text not null,final_status text not null,started_at timestamptz,
    evidence jsonb,output jsonb);
    create index idx_ivx_agent_exec_status_started on public.ivx_agent_executions(final_status,started_at desc);
    insert into public.ivx_agent_executions
    select 'history-'||i,'retained','agent',1,'other','other',case when i%2=0 then 'pending' else 'completed' end,
      now(),jsonb_build_object('retained',repeat('x',1800)),jsonb_build_object('sha',md5(i::text))
    from generate_series(1,12000) i;
    insert into public.ivx_agent_executions values
      ('b-pending','rec-1','agent',1,'ivx-112-real-execution-certificate','real_execution_certification','pending',null,null,null),
      ('a-pending','rec-1','agent',1,'ivx-112-real-execution-certificate','real_execution_certification','pending',null,null,null),
      ('c-running','rec-1','agent',1,'ivx-112-real-execution-certificate','real_execution_certification','running',now(),null,null);
    analyze public.ivx_agent_executions;`);
  const history = async () => (await db.query("select count(*)::int n,md5(string_agg(task_id||output::text,'|' order by task_id)) digest from public.ivx_agent_executions where task_id like 'history-%'")).rows[0];
  const before = await history();
  await assert.rejects(probe, error => error.code === 'ERR_ASSERTION' && /50 blocks/.test(error.message));
  const baselinePlan = latestPlan;
  const sql = await readFile(new URL('../supabase/repair-functions/ivx-pending-execution-index.sql', import.meta.url), 'utf8');
  await db.query(sql);
  await db.query(sql);
  await db.query('vacuum analyze public.ivx_agent_executions');
  // Repeat the named parameterized statement beyond PostgreSQL's custom-plan
  // sampling window, matching the prepared requests used by PostgREST.
  const plans = [];
  for (let attempt = 0; attempt < 8; attempt++) plans.push(await probe());
  assert.deepEqual(await history(), before, 'all historical identities and evidence retained');
  const validity = (await db.query("select indisvalid,indisready from pg_index where indexrelid='public.idx_ivx_agent_exec_pending_discovery'::regclass")).rows[0];
  assert.deepEqual(validity, { indisvalid: true, indisready: true });
  const preparedPlans = (await db.query("select generic_plans::int,custom_plans::int from pg_prepared_statements where name='pending-discovery-proof'")).rows[0];
  assert.ok(preparedPlans.generic_plans + preparedPlans.custom_plans >= 16, 'exercise real prepared execution beyond plan sampling');
  const receipt = { result: 'PASS', baselineBlockBoundFailed: true, baselinePlan, unchangedHistory: before, preparedPlans,
    preparedExecutions: plans.length, finalPlan: plans.at(-1), concurrentIndexValid: true, idempotent: true };
  await mkdir('qa/evidence/fleet-ha', { recursive: true });
  await writeFile('qa/evidence/fleet-ha/pending-execution-discovery.json', JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify(receipt));
} finally {
  await db.query('drop table if exists public.ivx_agent_executions');
  await db.end();
}
