import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// Use a separately installed PGlite to exercise actual PostgreSQL functions.
// npm install --prefix /tmp/ivx-finance-tests @electric-sql/pglite@0.5.8
// IVX_PGLITE_MODULE=/tmp/ivx-finance-tests/node_modules/@electric-sql/pglite node --test qa/verified-finance-reconciliation.test.mjs
const require = createRequire(import.meta.url);
const migrationUrl = new URL('../supabase/migrations/20260913152950_verified_finance_reconciliation_cron.sql', import.meta.url);
const migration = (await readFile(migrationUrl,'utf8')).split('-- SCHEDULING:')[0];
const SOURCE = 'ef429b20225fc01c84f6adc9e5f165291a95d389';
let db;
if (process.env.IVX_POSTGRES_URL) {
  const { Client } = require(process.env.IVX_POSTGRES_MODULE || 'pg');
  const client = new Client({connectionString:process.env.IVX_POSTGRES_URL});
  await client.connect();
  db = {query:(s,p)=>client.query(s,p),exec:s=>client.query(s),close:()=>client.end()};
} else {
  const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');
  db = new PGlite();
}
await db.exec(`
  create role anon; create role authenticated; create role service_role bypassrls;
  create table public.ivx_durable_documents(doc_key text primary key,value jsonb not null,updated_at timestamptz not null default now());
  grant select,insert,update on public.ivx_durable_documents to service_role;
  create table public.ivx_agent_states(agent_id text primary key,certification_status text);
  insert into public.ivx_agent_states values('agent-sentinel','in_progress');
`);
await db.exec(await readFile(new URL('../supabase/migrations/20260911203746_ivx_global_ai_budget.sql',import.meta.url),'utf8'));
await db.exec(migration);
await db.exec(await readFile(new URL('../supabase/migrations/20260913155726_finance_receipt_prefix_matching.sql',import.meta.url),'utf8'));
const query = (s,p=[])=>db.query(s,p);
const call = async()=> (await query('select public.fn_autonomous_finance_depuration() as result')).rows[0].result;

async function fixture({ageMinutes=25,cost='100000',reserved='800000000',day,withReceipt=true}={}) {
  const id=randomUUID();
  const created=new Date(Date.now()-ageMinutes*60000).toISOString();
  const completed=new Date(Date.parse(created)+1000).toISOString();
  const reservationDay=day || created.slice(0,10);
  await query(`insert into public.ivx_ai_budget_reservations
    (reservation_id,worker_instance_id,model,request_sha,day,policy_revision,reserved_nano,status,
     pricing_evidence,generation_id,created_at,completed_at)
    values($1,'fixture-worker','openai/gpt-4o',$2,$3,1,$4,'uncertain','{}',$5,$6,$7)`,
    [id,'a'.repeat(64),reservationDay,reserved,'gen_01M2CCP2QG05KHK1D6Z62CB8H3',created,completed]);
  const core={reservationId:id,generationId:'gen_01M2CCP2QG05KHK1D6Z62CB8H3',model:'openai/gpt-4o',
    state:'PROVIDER_RECEIPT_OBSERVED',providerCostNano:cost,reservedNano:reserved,
    providerCreatedAt:created,ledgerCompletedAt:completed,observedAt:new Date().toISOString(),
    promptTokens:9,completionTokens:2,firstTokenMs:42,generationMs:48,
    ledgerStatus:'uncertain',finishReason:'stop'};
  const receipt={...core,sourceSha:SOURCE,source:'https://ai-gateway.vercel.sh/v1/generation',
    providerReceiptSha256:createHash('sha256').update(JSON.stringify(core)).digest('hex')};
  const key=`finance/provider-receipts/${reservationDay}/${id}/${receipt.providerReceiptSha256}.json`;
  if(withReceipt) await query('insert into public.ivx_durable_documents(doc_key,value) values($1,$2)',[key,JSON.stringify(receipt)]);
  return {id,key,core,receipt};
}
async function row(id){return (await query('select status,settled_upper_nano,completed_at,pricing_evidence from public.ivx_ai_budget_reservations where reservation_id=$1',[id])).rows[0];}
async function reset(){await db.exec(`delete from public.ivx_durable_documents; delete from public.ivx_ai_budget_reservations;
  delete from public.ivx_ai_budget_days; delete from public.ivx_ai_finance_reconciliation_runs;`);}

test('receipt reconciliation safeguards in PostgreSQL',async t=>{
  await t.test('receipt prefix matching survives the production locale',async()=>{
    const r=(await query(`select datcollate, 'finance/abc/39.json' < 'finance/abc/~' as locale_comparison,
      'finance/abc/39.json' ~<~ 'finance/abc/~' as bytewise_comparison
      from pg_database where datname=current_database()`)).rows[0];
    assert.equal(r.bytewise_comparison,true);
    if (process.env.IVX_POSTGRES_URL) {
      assert.match(r.datcollate,/^en_US\.(UTF-8|utf8)$/);
      assert.equal(r.locale_comparison,false,'real PostgreSQL must reproduce the production regression');
    }
  });
  await t.test('old charges without receipts stay uncertain',async()=>{
    await reset(); const f=await fixture({withReceipt:false}); const r=await call();
    assert.equal(r.state,'NO_ELIGIBLE_RECEIPTS');assert.equal(r.settled,0);assert.equal((await row(f.id)).status,'uncertain');
    assert.equal(r.fullReconciliationCertified,false);
  });
  await t.test('valid receipt settles exact cost and repeated calls do not double charge',async()=>{
    await reset();const f=await fixture();const before=await row(f.id);const r=await call();
    assert.equal(r.settled,1);assert.equal(r.providerCostNano,'100000');assert.equal(r.releasedLiabilityNano,'799900000');
    assert.equal((await row(f.id)).status,'settled');assert.equal((await row(f.id)).completed_at.toISOString(),before.completed_at.toISOString());
    assert.equal((await call()).settled,0);
    assert.equal(String((await query('select sum(settled_upper_nano) as total from public.ivx_ai_budget_days')).rows[0].total),'100000');
    assert.equal((await query("select count(*)::int n from public.ivx_durable_documents where doc_key like 'finance/settlements/%'")).rows[0].n,1);
  });
  await t.test('the fifteen minute condition never overrides absent or young evidence',async()=>{
    await reset();const f=await fixture({ageMinutes:5});assert.equal((await call()).settled,0);assert.equal((await row(f.id)).status,'uncertain');
  });
  for(const [name,mutate,rehash] of [
    ['changed cost without matching digest',r=>r.providerCostNano='1',false],
    ['null evidence',r=>r.generationId=null,true],
    ['missing timestamp',r=>delete r.providerCreatedAt,true],
    ['cost above reservation',r=>r.providerCostNano='800000001',true],
    ['negative cost',r=>r.providerCostNano='-1',true],
    ['generation mismatch',r=>r.generationId='gen_01M2CCP2QG05KHK1D6Z62CB8H4',true],
    ['future observation',r=>r.observedAt='2099-01-01T00:00:00Z',true],
    ['invalid termination',r=>r.finishReason='running',true],
    ['invalid token count',r=>r.promptTokens=-1,true],
  ]) await t.test(name+' cannot settle',async()=>{
    await reset();const f=await fixture();const core={...f.core};mutate(core);
    const digest=rehash?createHash('sha256').update(JSON.stringify(core)).digest('hex'):f.receipt.providerReceiptSha256;
    const key=f.key.replace(f.receipt.providerReceiptSha256,digest);
    await query('update public.ivx_durable_documents set doc_key=$2,value=$3 where doc_key=$1',[f.key,key,
      JSON.stringify({...core,source: f.receipt.source,sourceSha:SOURCE,providerReceiptSha256:digest})]);
    const r=await call();assert.equal(r.settled,0);assert.equal(r.rejected,1);assert.equal((await row(f.id)).status,'uncertain');
  });
  await t.test('unapproved collector cannot settle',async()=>{
    await reset();const f=await fixture();await query("update public.ivx_durable_documents set value=jsonb_set(value,'{sourceSha}',to_jsonb($2::text)) where doc_key=$1",[f.key,'b'.repeat(40)]);
    assert.equal((await call()).rejected,1);assert.equal((await row(f.id)).status,'uncertain');
  });
  await t.test('conflicting authentic receipt amounts do not choose a winner',async()=>{
    await reset();const f=await fixture();const core={...f.core,providerCostNano:'100001'};
    const hash=createHash('sha256').update(JSON.stringify(core)).digest('hex');
    await query('insert into public.ivx_durable_documents(doc_key,value) values($1,$2)',[
      f.key.replace(f.receipt.providerReceiptSha256,hash),JSON.stringify({...core,source:f.receipt.source,sourceSha:SOURCE,providerReceiptSha256:hash})]);
    const r=await call();assert.equal(r.settled,0);assert.equal(r.errors[0].reason,'RECEIPT_COST_CONFLICT');
  });
  await t.test('historical liability charges the current admission day without modifying policy or agent certification',async()=>{
    await reset();const f=await fixture({day:'2020-01-01'});
    const policy=(await query('select to_jsonb(p) value from public.ivx_ai_budget_policy p')).rows[0].value;
    assert.equal((await call()).settled,1);
    const days=(await query("select day::text,settled_upper_nano::text from public.ivx_ai_budget_days")).rows;
    assert.deepEqual(days,[{day:new Date().toISOString().slice(0,10),settled_upper_nano:'100000'}]);
    assert.deepEqual((await query('select to_jsonb(p) value from public.ivx_ai_budget_policy p')).rows[0].value,policy);
    assert.equal((await query('select certification_status from public.ivx_agent_states')).rows[0].certification_status,'in_progress');
  });
  await t.test('a later ledger failure rolls back reservation, aggregate and audit together',async()=>{
    await reset();const f=await fixture();
    await db.exec("alter table public.ivx_ai_budget_days add constraint fixture_reject_cost check(settled_upper_nano=0)");
    await assert.rejects(call());
    assert.equal((await row(f.id)).status,'uncertain');
    assert.equal((await query("select count(*)::int n from public.ivx_durable_documents where doc_key like 'finance/settlements/%'")).rows[0].n,0);
    await db.exec('alter table public.ivx_ai_budget_days drop constraint fixture_reject_cost');
  });
  await t.test('bounded batches leave remaining verified receipts for the next run',async()=>{
    await reset();for(let i=0;i<26;i++)await fixture();
    assert.equal((await call()).settled,25);assert.equal((await call()).settled,1);assert.equal((await call()).settled,0);
    assert.equal(String((await query('select sum(settled_upper_nano) as n from public.ivx_ai_budget_days')).rows[0].n),'2600000');
  });
  await t.test('the authorized service role can settle without security definer',async()=>{
    await reset();const f=await fixture();await db.exec('set role service_role');
    assert.equal((await call()).settled,1);await db.exec('reset role');assert.equal((await row(f.id)).status,'settled');
  });
  await t.test('public and ordinary authenticated users cannot execute or approve sources',async()=>{
    for(const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      await assert.rejects(call(),/permission denied/);
      await assert.rejects(query('select * from public.ivx_ai_receipt_sources'),/permission denied/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    await assert.rejects(query('insert into public.ivx_ai_receipt_sources(source_sha) values($1)',['b'.repeat(40)]),/permission denied/);
    await db.exec('reset role');
  });
  await db.close();
});
