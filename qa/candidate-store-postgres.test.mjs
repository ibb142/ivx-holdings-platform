import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';

const require=createRequire(import.meta.url);
const connectionString=process.env.IVX_CANDIDATE_TEST_DATABASE_URL;
let db, pool;
if(connectionString) {
  const url=new URL(connectionString);
  assert(['127.0.0.1','localhost'].includes(url.hostname)&&url.pathname==='/ivx_candidate_test',
    'Only the isolated local ivx_candidate_test database is permitted');
  const {Pool}=require(process.env.IVX_PG_MODULE||'pg');
  pool=new Pool({connectionString,max:24,connectionTimeoutMillis:3000,query_timeout:5000});
  const client=await pool.connect();
  db={query:(s,p)=>client.query(s,p),exec:s=>client.query(s),close:async()=>{client.release();await pool.end();}};
} else {
  const {PGlite}=require(process.env.IVX_PGLITE_MODULE||'@electric-sql/pglite');
  db=new PGlite();
}
await db.exec('create role anon;create role authenticated;create role service_role bypassrls;');
try {
  await db.exec(await readFile(new URL('../supabase/migrations/20260913162015_candidate_lease_evidence_store.sql',import.meta.url),'utf8'));
} catch(error) {
  console.error({code:error.code,message:error.message,position:error.position});await db.close();throw new Error('Migration failed');
}
const q=(s,p=[])=>db.query(s,p);
const acquire=async(event='event',owner='worker',version=1,token=randomUUID(),ttl=30000,executor=q)=>
  (await executor('select public.ivx_candidate_acquire($1,$2,$3,$4::uuid,$5) as result',[event,owner,version,token,ttl])).rows[0].result;
const candidate=(change={})=>({eventId:'event',agentId:'IA-10',taskType:'qa',rootCause:'Observed failure',
  hypothesis:'Proposed check',gitSha:'abcdef'.repeat(6)+'abcd',version:1,...change});
const save=async(c,owner,token,executor=q)=>(await executor('select public.ivx_candidate_save($1::jsonb,$2,$3::uuid) result',[JSON.stringify(c),owner,token])).rows[0].result;
const reset=()=>db.exec('truncate public.ivx_candidate_leases,public.ivx_candidate_lessons,public.ivx_candidate_phase_failures restart identity;');
const snapshot=async()=> (await q('select to_jsonb(l) as value from public.ivx_candidate_lessons l')).rows;
const count=async()=> (await q('select count(*)::int n from public.ivx_candidate_lessons')).rows[0].n;

test('candidate lease and retained evidence contracts',async t=>{
 try {
  await t.test('an active lease has one winner and a retry does not rotate its token',async()=>{
    await reset();const a=await acquire();assert(a.acquired);assert.match(a.token,/^[a-f0-9-]{36}$/);
    assert.equal((await acquire()).acquired,false);assert.equal((await acquire('event','other')).acquired,false);
    assert.equal((await q('select token from public.ivx_candidate_leases')).rows[0].token,a.token);
  });
  await t.test('twenty simultaneous claimants on independent connections have exactly one winner',{skip:!pool},async()=>{
    await reset();const results=await Promise.all(Array.from({length:20},(_,i)=>acquire('race','worker-'+i,1,randomUUID(),30000,(s,p)=>pool.query(s,p))));
    assert.equal(results.filter(r=>r.acquired).length,1);
  });
  await t.test('expired leases can be reclaimed without allowing version rollback',async()=>{
    await reset();const old=await acquire('event','old',2);
    await q("update public.ivx_candidate_leases set expires_at=clock_timestamp()-interval '1 second'");
    assert.equal((await acquire('event','old-version',1)).errorType,'STALE_VERSION');
    const fresh=await acquire('event','new',2);assert(fresh.acquired);assert.notEqual(old.token,fresh.token);
    assert.equal((await save(candidate({version:2}),'old',old.token)).errorType,'AUTHORIZATION_OR_VERSION_MISMATCH');
    assert.equal((await save(candidate({version:2}),'new',fresh.token)).success,true);
  });
  await t.test('a higher revision fences the still-running prior revision',async()=>{
    await reset();const old=await acquire();const fresh=await acquire('event','new',2);assert(fresh.acquired);
    assert.equal((await save(candidate(),'worker',old.token)).success,false);
    assert.equal((await save(candidate({version:2}),'new',fresh.token)).success,true);
  });
  await t.test('owner, token and version must all match',async()=>{
    await reset();const a=await acquire();
    for(const [c,o,token] of [[candidate(),'other',a.token],[candidate(),'worker',randomUUID()],[candidate({version:2}),'worker',a.token]])
      assert.equal((await save(c,o,token)).errorType,'AUTHORIZATION_OR_VERSION_MISMATCH');
    assert.equal(await count(),0);
  });
  await t.test('SQL time rejects expired writers and rejects expiry during insertion',async()=>{
    await reset();const a=await acquire();
    await q("update public.ivx_candidate_leases set expires_at=clock_timestamp()-interval '1 second'");
    assert.equal((await save(candidate(),'worker',a.token)).errorType,'LEASE_EXPIRED');
    const b=await acquire();
    // A trigger simulates a lease expiring after the initial validity check.
    await db.exec(`create function public.fixture_expire() returns trigger language plpgsql as $$begin
      update public.ivx_candidate_leases set expires_at=clock_timestamp()-interval '1 second' where event_id=new.event_id;
      return new;end;$$;
      create trigger fixture_expire before insert on public.ivx_candidate_lessons for each row execute function public.fixture_expire();`);
    try {assert.equal((await save(candidate(),'worker',b.token)).errorType,'LEASE_EXPIRED');assert.equal(await count(),0);}
    finally {await db.exec('drop trigger fixture_expire on public.ivx_candidate_lessons;drop function public.fixture_expire();');}
  });
  await t.test('valid evidence and completion commit together, and an identical retry is idempotent',async()=>{
    await reset();const a=await acquire();const c=candidate({rootCause:'  Observed failure  ',gitSha:candidate().gitSha.toUpperCase()});
    assert.deepEqual(await save(c,'worker',a.token),{success:true,duplicate:false});
    const before=await snapshot();assert.equal(before[0].value.status,'CANDIDATE');
    await q("update public.ivx_candidate_leases set expires_at=clock_timestamp()-interval '1 second'");
    assert.deepEqual(await save(c,'worker',a.token),{success:true,duplicate:true});
    assert.deepEqual(await snapshot(),before);
    assert.notEqual((await q('select completed_at from public.ivx_candidate_leases')).rows[0].completed_at,null);
    assert.equal((await acquire('event','new',100)).errorType,'EVENT_ALREADY_COMPLETED_IMMUTABLE');
  });
  await t.test('conflicting retries cannot change any evidence field or creation time',async()=>{
    await reset();const a=await acquire();await save(candidate(),'worker',a.token);const before=await snapshot();
    for(const change of [{rootCause:'changed'},{hypothesis:'changed'},{agentId:'IA-20'},{taskType:'other'},{gitSha:'b'.repeat(40)}])
      assert.equal((await save(candidate(change),'worker',a.token)).errorType,'CANDIDATE_ALREADY_COMMITTED_IMMUTABLE');
    assert.deepEqual(await snapshot(),before);
  });
  await t.test('concurrent saves preserve one candidate and return one idempotent duplicate',{skip:!pool},async()=>{
    await reset();const a=await acquire();const values=await Promise.all([0,1].map(()=>save(candidate(),'worker',a.token,(s,p)=>pool.query(s,p))));
    assert(values.every(x=>x.success));assert.equal(values.filter(x=>x.duplicate).length,1);assert.equal(await count(),1);
  });
  await t.test('database validation rejects malformed SHA, nulls, empty content and invalid versions',async()=>{
    await reset();const a=await acquire();
    for(const c of [null,[],{...candidate(),extra:'unapproved'},candidate({gitSha:'g'.repeat(40)}),candidate({rootCause:'\t\n'}),
      candidate({agentId:null}),candidate({version:-1}),candidate({version:1.5}),candidate({version:2147483648}),candidate({version:'1'})])
      assert.equal((await save(c,'worker',a.token)).success,false);
    assert.equal(await count(),0);
    for(const ttl of [null,0,-1,300001])assert.equal((await acquire('invalid','worker',1,randomUUID(),ttl)).errorType,'INVALID_TTL');
  });
  await t.test('a database rejection rolls back both candidate and completion',async()=>{
    await reset();const a=await acquire();
    await db.exec('alter table public.ivx_candidate_leases add constraint fixture_reject_completion check(completed_at is null)');
    try {await assert.rejects(save(candidate(),'worker',a.token));assert.equal(await count(),0);
      assert.equal((await q('select completed_at from public.ivx_candidate_leases')).rows[0].completed_at,null);}
    finally {await db.exec('alter table public.ivx_candidate_leases drop constraint fixture_reject_completion');}
  });
  await t.test('failure attempts and lessons survive administrative lease cleanup',async()=>{
    await reset();const a=await acquire();await save(candidate(),'worker',a.token);
    for(const attempt of [0,1])assert.equal((await q("select public.ivx_candidate_record_failure('event','VERIFY','LEASE_EXPIRED',$1) r",[attempt])).rows[0].r.success,true);
    const before=await snapshot();await q('delete from public.ivx_candidate_leases');
    assert.deepEqual(await snapshot(),before);assert.equal((await q('select count(*)::int n from public.ivx_candidate_phase_failures')).rows[0].n,2);
    assert.equal((await acquire()).errorType,'EVENT_ALREADY_COMPLETED_IMMUTABLE');
  });
  await t.test('anonymous and ordinary users cannot access any table or RPC',async()=>{
    for(const role of ['anon','authenticated']) {
      await db.exec('set role '+role);
      try {
        for(const table of ['leases','lessons','phase_failures'])await assert.rejects(q('select * from public.ivx_candidate_'+table),/permission denied/);
        await assert.rejects(acquire(),/permission denied/);
        await assert.rejects(save(candidate(),'worker',randomUUID()),/permission denied/);
        await assert.rejects(q("select public.ivx_candidate_record_failure('event','SAVE','TIMEOUT',0)"),/permission denied/);
      } finally {await db.exec('reset role');}
    }
  });
  await t.test('backend role can commit and append failures but cannot overwrite or delete evidence',async()=>{
    await reset();await db.exec('set role service_role');
    try {
      const a=await acquire();assert(a.acquired);assert.equal((await save(candidate(),'worker',a.token)).success,true);
      assert.equal((await q("select public.ivx_candidate_record_failure('event','SAVE','TIMEOUT',1) r")).rows[0].r.success,true);
      for(const table of ['lessons','phase_failures']) {
        await assert.rejects(q('delete from public.ivx_candidate_'+table),/permission denied/);
        await assert.rejects(q('update public.ivx_candidate_'+table+' set event_id=event_id'),/permission denied/);
      }
      await assert.rejects(q('delete from public.ivx_candidate_leases'),/permission denied/);
    } finally {await db.exec('reset role');}
  });
  await t.test('a stale writer waiting for a competing transaction is fenced after the row lock',{skip:!pool},async()=>{
    await reset();const a=await acquire();const holder=await pool.connect();const waiter=await pool.connect();
    try {
      await holder.query('begin');await holder.query("update public.ivx_candidate_leases set owner_id='new',version=2,token=$1 where event_id='event'",[randomUUID()]);
      const pid=(await waiter.query('select pg_backend_pid() pid')).rows[0].pid;
      const pending=save(candidate(),'worker',a.token,(s,p)=>waiter.query(s,p));
      let observedWait=false;
      for(let i=0;i<100;i++) {
        observedWait=(await q('select cardinality(pg_blocking_pids($1))>0 as waiting',[pid])).rows[0].waiting;
        if(observedWait)break;
        await new Promise(resolve=>setTimeout(resolve,10));
      }
      await holder.query('commit');assert(observedWait,'the old writer really waited for the conflicting transaction');
      assert.equal((await pending).errorType,'AUTHORIZATION_OR_VERSION_MISMATCH');assert.equal(await count(),0);
    } finally {await holder.query('rollback');holder.release();waiter.release();}
  });
  await t.test('lease lookup retains constant physical work with stored history',async()=>{
    await reset();await q(`insert into public.ivx_candidate_leases(event_id,owner_id,version,token,expires_at)
      select 'history-'||i,'fixture',1,$1,clock_timestamp() from generate_series(1,10000)i`,[randomUUID()]);
    await db.exec('analyze public.ivx_candidate_leases');
    const plan=(await q("explain(analyze,buffers,format json) select token,completed_at from public.ivx_candidate_leases where event_id='history-5000'")).rows[0]['QUERY PLAN'][0];
    assert(plan.Plan['Shared Hit Blocks']+plan.Plan['Shared Read Blocks']<20);
    console.log(JSON.stringify({proof:'lease_lookup',engine:pool?'PostgreSQL':'PGlite',storedLeases:10000,executionMs:plan['Execution Time'],planningMs:plan['Planning Time'],planType:plan.Plan['Node Type']}));
  });
 } finally {await db.close();}
});
