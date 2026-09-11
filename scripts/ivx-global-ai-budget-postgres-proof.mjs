import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

export async function proveGlobalAIBudget(clients, realConnections = true) {
  const [a,b]=clients;
  await a.query(await readFile(new URL('../supabase/migrations/20260911203746_ivx_global_ai_budget.sql',import.meta.url),'utf8'));
  const fresh=()=>({validUntil:new Date(Date.now()+300000).toISOString(),source:'isolated fixture'});
  const reserve=async(client,id=randomUUID(),amount=3000,owner='worker-a',price=fresh())=>(await client.query(
    'select public.ivx_ai_budget_reserve($1,$2,$3,$4,$5,$6::jsonb) value',[id,owner,'fixture/model','a'.repeat(64),amount,JSON.stringify(price)])).rows[0].value;
  const finish=async(client,id,status,amount,owner='worker-a')=>(await client.query(
    'select public.ivx_ai_budget_finish($1,$2,$3,$4,null) value',[id,owner,status,amount])).rows[0].value;
  const snapshot=async()=>(await a.query('select public.ivx_ai_budget_status() value')).rows[0].value;
  const reset=async(limit=10000,capacity=112)=>{
    await a.query('truncate public.ivx_ai_budget_reservations,public.ivx_ai_budget_days');
    await a.query("update public.ivx_ai_budget_policy set enabled=true,daily_limit_nano=$1,max_concurrent=$2,authorization_ref='LOCAL_TEST_ONLY'",[limit,capacity]);
  };
  assert.equal((await reserve(a)).reason,'budget_not_activated');
  const acl=(await a.query("select has_function_privilege('anon','public.ivx_ai_budget_reserve(uuid,text,text,text,bigint,jsonb)','execute') anon,has_function_privilege('authenticated','public.ivx_ai_budget_finish(uuid,text,text,bigint,text)','execute') authenticated,has_function_privilege('service_role','public.ivx_ai_budget_status()','execute') service")).rows[0];
  assert.deepEqual(acl,{anon:false,authenticated:false,service:true});
  await reset();
  const attempts=await Promise.all(Array.from({length:20},(_,n)=>reserve(clients[n%clients.length])));
  assert.equal(attempts.filter(x=>x.allowed).length,3);
  assert.equal((await snapshot()).unsettledLiabilityNano,'9000');
  const winner=attempts.find(x=>x.allowed).reservationId;
  assert.equal((await reserve(b,winner)).reason,'reservation_already_exists');
  await assert.rejects(finish(b,winner,'settled',100,'stale-worker'),/owner mismatch/);
  await finish(a,winner,'settled',100);
  assert.equal((await finish(b,winner,'settled',100)).duplicate,true);
  assert.equal((await snapshot()).settledUpperNano,'100');
  await assert.rejects(finish(b,winner,'settled',0),/conflict/);
  assert.equal((await reserve(b)).allowed,true,'unused reservation capacity returns only after known completion');
  await reset(10000,2);
  const c1=await reserve(a),c2=await reserve(b);
  assert(c1.allowed&&c2.allowed);
  assert.equal((await reserve(a)).reason,'global_capacity_exceeded');
  await finish(a,c1.reservationId,'uncertain',null);
  assert.equal((await snapshot()).unsettledLiabilityNano,'6000');
  assert.equal((await reserve(b)).allowed,true,'uncertain completion releases concurrency, never money');
  await reset(10000);
  const old=await reserve(a,randomUUID(),7000);
  await a.query("update public.ivx_ai_budget_reservations set day=(clock_timestamp() at time zone 'UTC')::date-1 where reservation_id=$1",[old.reservationId]);
  assert.equal((await reserve(b,randomUUID(),4000)).reason,'global_daily_budget_exceeded','prior-day unresolved liability carries forward');
  await finish(b,old.reservationId,'settled',6000);
  assert.equal((await snapshot()).settledUpperNano,'6000','settlement counts on completion UTC day');
  const next=await reserve(a,randomUUID(),4000);assert(next.allowed);
  await finish(a,next.reservationId,'cancelled',0);
  assert.equal((await snapshot()).unsettledLiabilityNano,'0');
  await assert.rejects(reserve(a,randomUUID(),0),/Invalid budget reservation/);
  await assert.rejects(reserve(a,randomUUID(),100,'worker-a',{validUntil:null}),/Invalid budget reservation/);
  await assert.rejects(reserve(a,randomUUID(),100,'worker-a',{validUntil:'2000-01-01T00:00:00Z'}),/Invalid budget reservation/);
  await reset(10000);
  const lost=randomUUID();await reserve(a,lost); // Drop the admission receipt deliberately.
  assert.equal((await reserve(b,lost)).allowed,false,'lost response must not grant another provider attempt');
  await finish(a,lost,'settled',4000);
  assert.equal((await snapshot()).enabled,false,'exceeding a price envelope disables further admission');
  assert.equal((await snapshot()).settledUpperNano,'4000','the overrun is recorded rather than clipped');
  await reset(10000);
  await a.query('begin');
  const rolled=randomUUID();await reserve(a,rolled);await a.query('rollback');
  assert.equal((await reserve(b,rolled)).allowed,true,'rolled-back admission leaves no phantom charge');
  if(realConnections){
    await a.query('begin');
    await a.query('select * from public.ivx_ai_budget_policy for update');
    await b.query("set lock_timeout='50ms'");
    await assert.rejects(reserve(b),/lock timeout/);
    await a.query('rollback');await b.query('reset lock_timeout');
    assert.equal((await reserve(b)).allowed,true,'connection recovers after contention');
  }
  const result={verification:'PASS',realConnections,connections:clients.length,attemptedAdmissions:20,admittedWithinBudget:3,
    sharedMonetaryAdmission:true,sharedCapacity:true,duplicateAdmissionRejected:true,settlementIdempotent:true,
    staleWorkerRejected:true,unknownChargesRetained:true,midnightLiabilityCarried:true,lostResponseFenced:true,
    priceOverrunStopsAdmission:true,rollbackAtomic:true,lockRecoveryTested:realConnections,privateAccess:true,
    sourceSha:process.env.GITHUB_SHA??null,observedAt:new Date().toISOString(),providerCalls:0,productionRowsTouched:0};
  return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const connectionString=process.env.IVX_HA_TEST_DATABASE_URL;
  const url=new URL(connectionString??'postgres://invalid/');
  if(!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/ivx_ha_test')throw Error('Local ivx_ha_test database required');
  const clients=Array.from({length:4},()=>new pg.Client({connectionString}));
  await Promise.all(clients.map(c=>c.connect()));
  try{
    const proof=await proveGlobalAIBudget(clients);
    await mkdir('qa/evidence/fleet-ha',{recursive:true});
    await writeFile('qa/evidence/fleet-ha/global-ai-budget.json',JSON.stringify(proof,null,2)+'\n');
    console.log(JSON.stringify(proof));
  }finally{await Promise.allSettled(clients.map(c=>c.end()));}
}
