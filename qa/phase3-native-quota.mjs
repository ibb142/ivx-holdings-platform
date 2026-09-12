import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createBudgetedFetch } from '../backend/services/ivx-global-ai-budget-fetch.ts';
import { GlobalAIBudgetError, quoteCatalogModel, usageCostUpperNano } from '../backend/services/ivx-global-ai-budget.ts';
import { settleBudgetWithRetry } from '../backend/services/ivx-global-ai-budget-settlement.ts';
import { providerReportedCostNano } from '../backend/services/ivx-provider-reported-cost.ts';
import { TEAM, prepareContext, readNativeState, checkNativeBudget, budgetSummary,
  management, requestJson, emitProof } from './phase3-native-budget.mjs';

export const CAMPAIGN = 'phase3-native-quota-20260912-01';
export const LABELS = Object.freeze(['fill1','fill2','denied','recovery']);
export const MAX_LIABILITY_NANO = 10000000000n;
const ORIGIN = 'https://ai-gateway.vercel.sh';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const nativeFetch = fetch;
const event = (type, details = {}) => console.log(JSON.stringify({
  channel: CAMPAIGN, type, at: new Date().toISOString(), ...details,
}));
function safeError(error) {
  const first = String(error?.message ?? '').split('\n')[0];
  return /^[A-Z][A-Z0-9_]{2,100}$/.test(first) ? first : 'NATIVE_QUOTA_CHECK_FAILED';
}
export function reservationId(label) {
  assert(LABELS.includes(label), 'UNREVIEWED_LABEL');
  const h = createHash('sha256').update(CAMPAIGN + ':' + label).digest('hex');
  return h.slice(0,8)+'-'+h.slice(8,12)+'-5'+h.slice(13,16)+'-a'+h.slice(17,20)+'-'+h.slice(20,32);
}
export function checkQuote(quote, now = Date.now()) {
  assert(['openai/gpt-4.1','openai/gpt-4o-mini'].includes(quote.model), 'UNREVIEWED_MODEL');
  assert(/^\d{1,16}$/.test(quote.reservedNano ?? ''), 'INVALID_QUOTE');
  assert(BigInt(quote.reservedNano) > 0n && BigInt(quote.reservedNano) <= 4300000000n, 'QUOTE_TOO_LARGE');
  assert(Date.parse(quote.observedAt) <= now && Date.parse(quote.validUntil) > now, 'QUOTE_EXPIRED');
  assert(/^[a-f0-9]{64}$/.test(quote.catalogSha256 ?? ''), 'INVALID_CATALOG_HASH');
}
function dbFor(context) {
  const headers = { apikey: context.serviceKey };
  return {
    async rpc(name, body = {}) {
      assert(['ivx_ai_budget_status','ivx_ai_budget_reserve','ivx_ai_budget_finish'].includes(name), 'UNREVIEWED_RPC');
      const r = await requestJson(context.databaseUrl + '/rest/v1/rpc/' + name, context.serviceKey,
        { method:'POST', body, headers });
      assert.equal(r.status, 200, 'DATABASE_HTTP_FAILED'); return r.data;
    },
    async rows() {
      const r = await requestJson(context.databaseUrl + '/rest/v1/ivx_ai_budget_reservations?reservation_id=in.('
        + LABELS.map(reservationId).join(',') + ')&select=reservation_id,worker_instance_id,model,request_sha,'
        + 'policy_revision,reserved_nano,status,settled_upper_nano,generation_id,created_at,completed_at',
        context.serviceKey, { headers });
      assert.equal(r.status, 200, 'ROWS_HTTP_FAILED');
      assert(Array.isArray(r.data) && r.data.every(x => LABELS.map(reservationId).includes(x.reservation_id)),
        'INVALID_CAMPAIGN_ROWS'); return r.data;
    },
  };
}
async function freshQuote(model) {
  const r = await requestJson(ORIGIN + '/v1/models', '', { timeout:15000 });
  assert.equal(r.status, 200, 'CATALOG_HTTP_FAILED');
  const hash = createHash('sha256').update(JSON.stringify(r.data)).digest('hex');
  const quote = quoteCatalogModel(r.data, model, Date.now(), hash);
  event('catalog-quote',quote); checkQuote(quote); return quote;
}
function fillPrompt(index) {
  // Public synthetic integers; never private input and never written to logs.
  // Approximately 300k-400k input tokens, inside GPT-4.1's published context.
  // No token estimate is used for admission: reserve the FULL catalog envelope.
  let value = 100000000 + index * 7919;
  const numbers = [];
  for (let i=0; i<100000; i++) {
    value = (value * 48271) % 2147483647;
    numbers.push(String(value % 90000000 + 10000000));
  }
  return 'This is a bounded quota verification. Ignore the numbers; reply only OK.\n'
    + numbers.join(' ') + '\nReply only OK.';
}
export function checkTestKeyIdentity(apiKey, id) {
  assert(apiKey && apiKey.id === id && apiKey.teamId === TEAM && apiKey.purpose === 'ai-gateway',
    'TEST_KEY_BINDING_CHANGED');
  assert.equal(apiKey.name, CAMPAIGN, 'TEST_KEY_NAME_CHANGED');
  assert(!apiKey.metadata?.bypassAll, 'TEST_KEY_BYPASSES_CONTROLS');
}
async function getTestKey(context, id) {
  const { apiKey } = await management(context, '/v1/api-keys/' + encodeURIComponent(id));
  checkTestKeyIdentity(apiKey,id); return apiKey;
}
async function quotaSnapshot(context, id, label) {
  await getTestKey(context,id);
  const { budgets } = await management(context,'/ai-gateway/budgets/list');
  const quota=budgets.find(b=>b.quotaEntityId==='api_key_id_'+id);
  assert(quota && quota.active && !quota.archived,'TEST_QUOTA_NOT_ACTIVE');
  const snapshot = { label, at: new Date().toISOString(), ...budgetSummary(quota) };
  context.proof.quotaSnapshots.push(snapshot); return snapshot;
}
async function pollSpend(context, id, minimum, label) {
  let quota;
  for (let i=0;i<16;i++) {
    quota = await quotaSnapshot(context,id,label);
    if (quota.currentSpend >= minimum - 0.00000001) return quota;
    await wait(4000);
  }
  throw new Error('NATIVE_SPEND_NOT_VISIBLE');
}
async function callProvider(context, db, key, label, quote) {
  checkQuote(quote);
  const proof = context.proof;
  const before = await db.rows();
  assert(!before.some(r=>r.reservation_id===reservationId(label)), 'CAMPAIGN_REQUEST_ALREADY_EXISTS');
  const total = before.reduce((n,r)=>n+BigInt(r.reserved_nano),0n) + BigInt(quote.reservedNano);
  assert(total <= MAX_LIABILITY_NANO, 'CAMPAIGN_LIABILITY_TOO_LARGE');
  const stats = { label, model:quote.model, reservationId:reservationId(label), startedAt:new Date().toISOString(),
    admissions:0, providerHttpAttempts:0, statuses:[], quotaErrors:[], quotaHeaders:[] };
  proof.calls.push(stats);
  const worker = CAMPAIGN + ':' + label;
  let settled = false;
  const reserve = async (model, hash) => {
    stats.admissions++; assert.equal(stats.admissions,1,'SDK_RETRIED_ADMISSION');
    assert.equal(model,quote.model,'MODEL_QUOTE_MISMATCH'); checkQuote(quote);
    let admitted;
    for(let i=0;i<20;i++) {
      admitted = await db.rpc('ivx_ai_budget_reserve', { p_reservation_id:stats.reservationId,
        p_worker_instance_id:worker,p_model:model,p_request_sha:hash,p_reserved_nano:quote.reservedNano,
        p_pricing_evidence:quote });
      if(admitted.allowed || admitted.reason!=='global_capacity_exceeded')break;
      await wait(1000);
    }
    if(!admitted.allowed || admitted.reservationId!==stats.reservationId)
      throw new GlobalAIBudgetError(admitted.reason ?? 'unconfirmed');
    assert.equal(Number(admitted.policyRevision),2,'POLICY_REVISION_CHANGED');
    return { quote, async finish(usage, notStarted=false, generationId) {
      if(settled)return; settled=true;
      const params={p_reservation_id:stats.reservationId,p_worker_instance_id:worker,
        p_status:notStarted?'cancelled':usage?'settled':'uncertain',
        p_settled_upper_nano:notStarted?'0':usage?usageCostUpperNano(quote,usage):null,
        p_generation_id:usage?.generationId??generationId??null};
      let confirmed=false;
      await settleBudgetWithRetry(p=>db.rpc('ivx_ai_budget_finish',p),params,{
        onConfirmed:()=>{confirmed=true;},onUnconfirmed:()=>{},
      });
      assert(confirmed,'SETTLEMENT_UNCONFIRMED');
      stats.settlement={status:params.p_status,reservedNano:quote.reservedNano,
        settledUpperNano:params.p_settled_upper_nano,generationId:params.p_generation_id};
    }};
  };
  const transport=createBudgetedFetch(async(resource,init)=>{
    const request = new Request(resource,init), url = new URL(request.url);
    assert.equal(url.origin,ORIGIN,'UNREVIEWED_ORIGIN');
    if(request.method==='POST') {
      assert.equal(url.pathname,'/v1/chat/completions','UNREVIEWED_PROVIDER_PATH');
      assert.equal(++stats.providerHttpAttempts,1,'SDK_RETRIED_NATIVE_REQUEST');
      const response=await nativeFetch(request);
      stats.statuses.push(response.status);
      stats.quotaHeaders.push(Object.fromEntries([...response.headers].filter(([k,v])=>
        /^(retry-after|x-ratelimit-[a-z-]+|ratelimit-[a-z-]+)$/.test(k)&&/^[\w .,:+/-]{1,160}$/.test(v))));
      if(response.status>=400){
        const error=await response.clone().json().catch(()=>null);
        stats.quotaErrors.push({ status:response.status,
          type:error?.error?.type==='quota_for_entity_exceeded'?'quota_for_entity_exceeded':null,
          namesTestKeyQuota:typeof error?.error?.message==='string'
            && error.error.message.includes('api_key_id_'+proof.testKeyId) });
      }
      return response;
    }
    assert.equal(request.method,'GET','UNREVIEWED_HTTP_METHOD');
    assert.equal(url.pathname,'/v1/generation','UNREVIEWED_RECEIPT_PATH');
    return nativeFetch(request);
  },{enabled:()=>true,reserve});
  const provider=createOpenAI({apiKey:key,baseURL:ORIGIN+'/v1',fetch:transport});
  let succeeded=false;
  try {
    await generateText({model:provider.chat(quote.model),
      prompt:label.startsWith('fill')?fillPrompt(Number(label.slice(-1))):'Reply only OK.',
      maxOutputTokens:8,maxRetries:label==='denied'?2:0,abortSignal:AbortSignal.timeout(150000)});
    succeeded=true;
  } catch(error) {
    stats.sdkStatus=Number.isInteger(error?.statusCode)?error.statusCode:null;
    stats.sdkErrorName=/^[A-Za-z_]{1,90}$/.test(error?.name??'')?error.name:null;
    if(label!=='denied')throw new Error('REAL_PROVIDER_CALL_FAILED');
  }
  stats.completedAt=new Date().toISOString();
  assert.equal(stats.providerHttpAttempts,1,'WRONG_PROVIDER_ATTEMPT_COUNT');
  assert(stats.settlement,'NO_SETTLEMENT_EVIDENCE');
  if(label==='denied') {
    assert(!succeeded,'NATIVE_QUOTA_DID_NOT_BLOCK');
    assert.deepEqual(stats.statuses,[402],'NATIVE_QUOTA_NOT_402');
    assert(stats.quotaErrors.length===1 && stats.quotaErrors[0].type==='quota_for_entity_exceeded'
      && stats.quotaErrors[0].namesTestKeyQuota,'WRONG_NATIVE_REJECTION');
    // Production conservatively retains unknown liability on upstream errors.
    assert.equal(stats.settlement.status,'uncertain','NATIVE_REJECTION_LIABILITY_DISCARDED');
    assert.equal(stats.settlement.settledUpperNano,null,'NATIVE_REJECTION_LIABILITY_REFUNDED');
  } else {
    assert(succeeded && stats.statuses[0]===200,'REAL_PROVIDER_NOT_SUCCESSFUL');
    assert.equal(stats.settlement.status,'settled','REAL_PROVIDER_NOT_SETTLED');
    assert(/^gen_[0-9A-HJKMNP-TV-Z]{26}$/.test(stats.settlement.generationId??''),'GENERATION_NOT_RETAINED');
    let receipt;
    for(let i=0;i<10;i++){
      const r=await requestJson(ORIGIN+'/v1/generation?id='+encodeURIComponent(stats.settlement.generationId),key);
      if(r.status===200 && r.data?.data){receipt=r.data.data;break;} await wait(1500);
    }
    assert(receipt && receipt.id===stats.settlement.generationId && receipt.model===quote.model,'RECEIPT_BINDING_FAILED');
    const costNano=providerReportedCostNano(receipt.total_cost);
    assert(BigInt(costNano)>0n && BigInt(costNano)<=BigInt(stats.settlement.settledUpperNano),'RECEIPT_COST_NOT_COVERED');
    const record={label,id:receipt.id,model:receipt.model,costUsd:receipt.total_cost,costNano,
      createdAt:receipt.created_at,at:new Date().toISOString()};
    proof.receipts.push(record);
  }
  event('request-finished',{label,httpStatus:stats.statuses[0],settlement:stats.settlement.status});
  return stats;
}
function existingLimits(state, excludedId) {
  return state.budgets.filter(b=>b.scopeType!=='team' && b.quotaEntityId!=='api_key_id_'+excludedId).map(b=>({
    id:b.quotaEntityId,limit:b.limitAmount,period:b.refreshPeriod,active:b.active,archived:b.archived,
    byok:b.includeByokInQuota,
  })).sort((a,b)=>a.id.localeCompare(b.id));
}
async function main() {
  const proof={type:'native-quota-result',campaign:CAMPAIGN,startedAt:new Date().toISOString(),
    sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),runId:process.env.GITHUB_RUN_ID,
    teamId:TEAM,endpoints:[],quotaSnapshots:[],calls:[],receipts:[],passed:false,
    native402Observed:false,native429Observed:false,providerMaximumConcurrency:null,
    productionKeyChanged:false,productionBudgetChanged:false,secretValuesReturned:false,
    maxCampaignLiabilityNano:MAX_LIABILITY_NANO.toString(),item11_5Closed:false,phase3Closed:false};
  let context,db,before,testKeyId,testKey;
  try {
    assert.equal(process.env.IVX_NATIVE_QUOTA_PROBE,CAMPAIGN,'CAMPAIGN_BINDING_REQUIRED');
    context=await prepareContext(proof); db=dbFor(context);
    assert.equal((await db.rows()).length,0,'CAMPAIGN_ALREADY_HAS_DURABLE_RESERVATIONS');
    const list=await management(context,'/v1/api-keys?purpose=ai-gateway');
    const prior=list.apiKeys.filter(k=>k.name===CAMPAIGN);
    for(const candidate of prior) {
      // Exact orphan from the no-inference run 34693679116; never another key.
      assert.equal(candidate.id,'jtAnoFZC1LAdFBOuA9gwn8byoEteiOrNxS4y0rwikpKds7aq','UNREVIEWED_PRIOR_KEY');
      await getTestKey(context,candidate.id);
      await management(context,'/v1/api-keys/'+encodeURIComponent(candidate.id),{method:'DELETE'});
      proof.priorUnusedKeyDeleted=candidate.id;
    }
    before=await readNativeState(context);checkNativeBudget(before.teamBudget);
    const fillQuote=await freshQuote('openai/gpt-4.1'),smallQuote=await freshQuote('openai/gpt-4o-mini');
    assert(BigInt(fillQuote.reservedNano)*2n+BigInt(smallQuote.reservedNano)*2n<=MAX_LIABILITY_NANO,
      'PLANNED_CAMPAIGN_EXCEEDS_BOUND');
    assert(fillQuote.maxInputTokens>=1000000,'MODEL_CONTEXT_TOO_SMALL');
    proof.initialQuotes=[fillQuote,smallQuote];
    const created=await management(context,'/v1/api-keys',{method:'POST',body:{
      purpose:'ai-gateway',name:CAMPAIGN,expiresAt:Date.now()+3600000,
      aiGatewayQuota:{limitAmount:1,refreshPeriod:'none',includeByokInQuota:true,alertThresholds:[]},
    }});
    testKeyId=created.apiKey?.id; testKey=created.apiKeyString;
    if(typeof testKeyId==='string') proof.testKeyId=testKeyId;
    assert(typeof testKeyId==='string' && typeof testKey==='string' && testKey.startsWith('vck_'),'TEST_KEY_CREATE_FAILED');
    assert.notEqual(testKeyId,before.key.id,'TEST_KEY_IS_PRODUCTION_KEY');
    proof.testKeyId=testKeyId;
    await getTestKey(context,testKeyId);
    await management(context,'/v1/api-keys/'+encodeURIComponent(testKeyId)+'/quota',{method:'PATCH',
      body:{limitAmount:1,refreshPeriod:'none',includeByokInQuota:true,active:true,archived:false}});
    const first=await quotaSnapshot(context,testKeyId,'created');
    assert.equal(first.limitAmount,1,'TEST_QUOTA_LIMIT_MISMATCH');
    assert.equal(first.refreshPeriod,'none','TEST_QUOTA_PERIOD_MISMATCH');
    assert.equal(first.currentSpend,0,'NEW_TEST_KEY_ALREADY_SPENT');
    event('test-key-created',{testKeyId,warmupSeconds:125});
    // Documented new-key metering may need two minutes. No paid warm-up calls.
    for(let i=0;i<5;i++){await wait(25000);event('metering-warmup',{elapsedSeconds:(i+1)*25});}
    let quota=await quotaSnapshot(context,testKeyId,'before-spend');
    for(let i=1;i<=2 && quota.currentSpend<1;i++) {
      await callProvider(context,db,testKey,'fill'+i,await freshQuote('openai/gpt-4.1'));
      const knownSpend=proof.receipts.reduce((n,r)=>n+BigInt(r.costNano),0n);
      quota=await pollSpend(context,testKeyId,Number(knownSpend)/1e9,'after-fill'+i);
    }
    assert(quota.currentSpend>=1,'ISOLATED_QUOTA_NOT_EXHAUSTED');
    event('native-quota-exhausted',{currentSpend:quota.currentSpend,limit:quota.limitAmount});
    // Allow a full documented propagation window, then observe the real error.
    for(let i=0;i<4;i++){await wait(15000);event('quota-propagation',{elapsedSeconds:(i+1)*15});}
    await callProvider(context,db,testKey,'denied',await freshQuote('openai/gpt-4o-mini'));
    proof.native402Observed=true;
    const raisedLimit=Math.max(2,Math.ceil(quota.currentSpend)+1);
    assert(raisedLimit<=5,'RECOVERY_QUOTA_TOO_LARGE');
    await management(context,'/v1/api-keys/'+encodeURIComponent(testKeyId)+'/quota',{method:'PATCH',
      body:{limitAmount:raisedLimit,refreshPeriod:'none',includeByokInQuota:true}});
    const raised=await quotaSnapshot(context,testKeyId,'recovery-quota');
    assert.equal(raised.limitAmount,raisedLimit,'RECOVERY_QUOTA_NOT_APPLIED');
    assert(raised.currentSpend>=quota.currentSpend,'QUOTA_EDIT_RESET_SPEND');
    for(let i=0;i<4;i++){await wait(15000);event('recovery-propagation',{elapsedSeconds:(i+1)*15});}
    await callProvider(context,db,testKey,'recovery',await freshQuote('openai/gpt-4o-mini'));
    proof.nativeRecoveryObserved=true;
    assert.equal(new Set(proof.receipts.map(r=>r.id)).size,proof.receipts.length,'DUPLICATE_RECEIPTS');
    proof.actualReceiptCostNano=proof.receipts.reduce((n,r)=>n+BigInt(r.costNano),0n).toString();
    proof.passed=true;
  } catch(error) { proof.error=safeError(error); process.exitCode=1; }
  finally {
    if(context && testKeyId) {
      try{
        assert(testKeyId===proof.testKeyId && testKeyId!==before?.key.id,'UNSAFE_KEY_CLEANUP');
        await getTestKey(context,testKeyId);
        await management(context,'/v1/api-keys/'+encodeURIComponent(testKeyId),{method:'DELETE'});
        testKey=null;
        const list=await management(context,'/v1/api-keys?purpose=ai-gateway');
        assert(!list.apiKeys.some(k=>k.id===testKeyId),'TEST_KEY_STILL_ACTIVE');
        proof.testKeyDeleted=true;
      }catch(error){proof.cleanupError=safeError(error);proof.passed=false;process.exitCode=1;}
    }
    if(context && before){
      try{
        const after=await readNativeState(context);checkNativeBudget(after.teamBudget);
        assert.equal(after.key.id,before.key.id,'PRODUCTION_KEY_CHANGED');
        assert.deepEqual(existingLimits(after,testKeyId),existingLimits(before,testKeyId),'PRODUCTION_QUOTAS_CHANGED');
        proof.teamBudgetAfter=budgetSummary(after.teamBudget);
        proof.productionControlsPreserved=true;
      }catch(error){proof.finalControlError=safeError(error);proof.passed=false;process.exitCode=1;}
    }
    if(db){
      try{
        proof.rows=await db.rows();
        assert(proof.rows.every(r=>r.status!=='reserved'),'OWN_ACTIVE_RESERVATION_REMAINS');
        proof.activeOwnReservations=0;
        proof.sharedPolicyAfter=await db.rpc('ivx_ai_budget_status');
        assert.equal(proof.sharedPolicyAfter.enabled,true,'SHARED_POLICY_DISABLED');
        assert.equal(proof.sharedPolicyAfter.dailyLimitNano,'200000000000','SHARED_POLICY_CHANGED');
      }catch(error){proof.finalRowsError=safeError(error);proof.passed=false;process.exitCode=1;}
    }
    proof.native429Observed=proof.calls.some(c=>c.statuses.includes(429));
    await emitProof(proof,'native-quota');
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) await main();
