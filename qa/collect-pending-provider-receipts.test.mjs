import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { collectorRevision,collectPendingReceipts } from './collect-pending-provider-receipts.mjs';

const NOW=Date.parse('2026-09-13T16:00:00Z');
const cfg={serviceKey:'PRIVATE_SERVICE_KEY',gatewayKey:'vck_PRIVATE_GATEWAY_KEY',sourceRevision:'a'.repeat(40),
  gitSha:'b'.repeat(40),invocationId:'123456-1'};
const row={reservation_id:'00000000-0000-4000-8000-000000000001',model:'openai/gpt-4o',day:'2026-09-13',
  status:'uncertain',reserved_nano:1000000,settled_upper_nano:null,generation_id:'gen_01ARZ3NDEKTSV4RRFFQ69G5FAV',
  created_at:'2026-09-13T15:00:00Z',completed_at:'2026-09-13T15:00:03Z'};
const payload={data:{id:row.generation_id,model:row.model,created_at:'2026-09-13T15:00:01Z',is_byok:false,
  total_cost:'0.00015',gateway_cost:'0.00015',usage:'0.00015',finish_reason:'stop',tokens_prompt:9,tokens_completion:2,
  latency:20,generation_time:30,privatePrompt:'PRIVATE_PROMPT'}};
function fixture({rows=[row],sourceApproved=true,bindings,existing=false,provider=()=>Response.json(payload),
  cursor=null,queryRows,dbFailOnce=false,settlement={state:'VERIFIED_RECEIPTS_SETTLED',settled:1,rejected:0}}={}) {
  const calls=[],writes=[];let failed=false;
  const fetcher=async(url,init)=>{
    const u=new URL(url);calls.push({u,init});assert.equal(init.redirect,'error');
    if(u.origin==='https://ai-gateway.vercel.sh') {
      assert.equal(init.method,'GET');assert.equal(u.pathname,'/v1/generation');
      assert.equal(init.headers.Authorization,'Bearer '+cfg.gatewayKey);assert.equal(init.headers.apikey,undefined);
      return provider(u);
    }
    assert.equal(u.origin,'https://kvclcdjmjghndxsngfzb.supabase.co');
    assert.equal(init.headers.Authorization,'Bearer '+cfg.serviceKey);assert.equal(init.headers.apikey,cfg.serviceKey);
    if(init.method==='POST') {
      const body=JSON.parse(init.body);writes.push({path:u.pathname,body,headers:init.headers});
      assert(['/rest/v1/ivx_durable_documents','/rest/v1/rpc/fn_autonomous_finance_depuration'].includes(u.pathname));
      return u.pathname.includes('/rpc/')?Response.json(settlement):new Response(null,{status:201});
    }
    assert.equal(init.method,'GET');
    if(u.pathname.endsWith('/ivx_ai_receipt_sources')) {
      if(dbFailOnce&&!failed){failed=true;return new Response('',{status:503});}
      return Response.json(sourceApproved?[{source_sha:cfg.sourceRevision}]:[]);
    }
    if(u.pathname.endsWith('/ivx_durable_documents')) {
      return Response.json(u.searchParams.get('doc_key')?.startsWith('eq.')
        ?(cursor?[{value:cursor}]:[]):existing?[{doc_key:'private-existing-receipt'}]:[]);
    }
    assert.equal(u.pathname,'/rest/v1/ivx_ai_budget_reservations');
    if(u.searchParams.has('generation_id')&&u.searchParams.get('generation_id').startsWith('in.'))
      return Response.json(bindings??rows.map(r=>({reservation_id:r.reservation_id,generation_id:r.generation_id})));
    assert.equal(u.searchParams.get('status'),'eq.uncertain');assert.equal(u.searchParams.get('limit'),'51');
    assert.equal(u.searchParams.get('created_at'),'lt.2026-09-13T15:45:00.000Z');
    assert.equal(u.searchParams.get('generation_id'),'not.is.null');
    return Response.json(queryRows?queryRows(u):rows);
  };
  return {calls,writes,fetcher};
}
const collect=(f,config=cfg)=>collectPendingReceipts(config,{fetcher:f.fetcher,now:()=>NOW,pause:async()=>{}});

test('authenticated lookup saves only validated receipt fields and requests atomic settlement',async()=>{
  const f=fixture(),r=await collect(f);assert.equal(r.uploaded,1);assert.equal(r.settled,1);assert.equal(r.unavailable,0);
  const proof=f.writes.find(w=>w.body.doc_key?.startsWith('finance/provider-receipts/'));
  assert.equal(proof.headers.Prefer,'resolution=ignore-duplicates,return=minimal');
  assert.equal(proof.body.value.providerCostNano,'150000');assert.equal(proof.body.value.sourceSha,cfg.sourceRevision);
  assert(!JSON.stringify(f.writes).includes('PRIVATE_PROMPT'));assert(!JSON.stringify(r).includes('PRIVATE_'));
  const {sourceSha,source,providerReceiptSha256,...receipt}=proof.body.value;
  assert.equal(createHash('sha256').update(JSON.stringify(receipt)).digest('hex'),providerReceiptSha256);
  assert.equal(r.fullReconciliationCertified,false);assert.equal(r.modelCallsCreated,0);
});
test('source approval failure stops before provider lookup or writes',async()=>{
  const f=fixture({sourceApproved:false});await assert.rejects(collect(f),/COLLECTOR_SOURCE_UNAPPROVED/);
  assert.equal(f.calls.length,1);assert.equal(f.writes.length,0);
});
test('invalid execution binding stops before any connection',async()=>{
  for(const change of [{gatewayKey:''},{sourceRevision:'main'},{gitSha:'HEAD'},{invocationId:'../../private'},{serviceKey:''}]) {
    const f=fixture();await assert.rejects(collect(f,{...cfg,...change}),/COLLECTOR_BINDING_UNAVAILABLE/);assert.equal(f.calls.length,0);
  }
});
test('missing generation identity is never inferred',async()=>{
  const f=fixture({rows:[{...row,generation_id:null}]});await assert.rejects(collect(f),/LEDGER_IDENTITY_INVALID/);
  assert.equal(f.writes.length,0);assert(!f.calls.some(c=>c.u.origin.includes('ai-gateway')));
});
test('a generation bound to another ledger record cannot be settled',async()=>{
  const f=fixture({bindings:[{reservation_id:row.reservation_id,generation_id:row.generation_id},
    {reservation_id:'00000000-0000-4000-8000-000000000002',generation_id:row.generation_id}]});
  const r=await collect(f);assert.equal(r.unavailable,1);assert.equal(r.records[0].reason,'GENERATION_BINDING_AMBIGUOUS');
  assert.equal(r.providerLookups,0);assert(!f.writes.some(w=>w.path.includes('/rpc/')));
});
test('a missing receipt remains unavailable and no zero-charge evidence is written',async()=>{
  const f=fixture({provider:()=>new Response('PRIVATE_ERROR',{status:404})}),r=await collect(f);
  assert.equal(r.unavailable,1);assert.equal(r.records[0].reason,'READ_HTTP_404');assert.equal(r.settled,0);
  assert(!f.writes.some(w=>w.body.doc_key?.startsWith('finance/provider-receipts/')));
  assert(!JSON.stringify(r).includes('PRIVATE_ERROR'));
});
test('BYOK, cost conflicts, identity changes and unfinished responses do not produce evidence',async()=>{
  for(const change of [{is_byok:true},{gateway_cost:'0.001'},{model:'other/model'},{finish_reason:'running'},
    {created_at:'2026-09-12T00:00:00Z'},{tokens_prompt:-1}]) {
    const f=fixture({provider:()=>Response.json({data:{...payload.data,...change}})}),r=await collect(f);
    assert.equal(r.uploaded,0);assert.equal(r.unavailable,1);assert(!f.writes.some(w=>w.path.includes('/rpc/')));
  }
});
test('existing receipt is consumed without repeatedly appending provider evidence',async()=>{
  const f=fixture({existing:true}),r=await collect(f);assert.equal(r.alreadyPresent,1);assert.equal(r.providerLookups,0);
  assert.equal(r.settled,1);assert(!f.writes.some(w=>w.body.doc_key?.startsWith('finance/provider-receipts/')));
});
test('receipt rejection stays visible after collection',async()=>{
  const f=fixture({settlement:{state:'RECEIPTS_REJECTED',settled:0,rejected:1}}),r=await collect(f);
  assert.equal(r.uploaded,1);assert.equal(r.settled,0);assert.equal(r.rejected,1);
});
test('an empty cohort is recorded without provider calls or blanket settlement',async()=>{
  const f=fixture({rows:[]}),r=await collect(f);assert.equal(r.selected,0);assert.equal(r.providerLookups,0);
  assert.equal(r.settled,0);assert.equal(r.fullReconciliationCertified,false);
});
test('cursor wraps once so unresolved receipts are retried without starving later work',async()=>{
  const f=fixture({cursor:{sourceRevision:cfg.sourceRevision,createdAt:row.created_at,reservationId:row.reservation_id},
    queryRows:u=>u.searchParams.has('or')?[]:[row]}),r=await collect(f);
  assert.equal(r.uploaded,1);assert.equal(f.calls.filter(c=>c.u.searchParams.get('limit')==='51').length,2);
});
test('a transient read-only database failure receives a bounded retry',async()=>{
  const f=fixture({dbFailOnce:true});assert.equal((await collect(f)).uploaded,1);
  assert.equal(f.calls.filter(c=>c.u.pathname.endsWith('/ivx_ai_receipt_sources')).length,2);
});
test('content approval changes with collector dependencies and is independent of deployment SHA',async()=>{
  const base=await collectorRevision(async u=>Buffer.from(u.pathname));
  assert.match(base,/^[a-f0-9]{40}$/);
  assert.equal(base,await collectorRevision(async u=>Buffer.from(u.pathname)));
  assert.notEqual(base,await collectorRevision(async u=>Buffer.from(u.pathname+'changed')));
});
