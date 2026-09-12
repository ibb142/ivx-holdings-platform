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
  management, requestJson, readDatabaseJson, emitProof } from './phase3-native-budget.mjs';

export const CAMPAIGN = 'phase3-native-quota-20260912-01';
export const LABELS = Object.freeze(['fill1','fill2','fill3','fill4','fill5','fill6','fill7','fill8','fill9','denied','recovery']);
export const MAX_LIABILITY_NANO = 11000000000n;
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
  assert(['openai/gpt-4o','openai/gpt-4o-mini'].includes(quote.model), 'UNREVIEWED_MODEL');
  assert(/^\d{1,16}$/.test(quote.reservedNano ?? ''), 'INVALID_QUOTE');
  assert(BigInt(quote.reservedNano) > 0n && BigInt(quote.reservedNano) <= 1000000000n, 'QUOTE_TOO_LARGE');
  assert(Date.parse(quote.observedAt) <= now && Date.parse(quote.validUntil) > now, 'QUOTE_EXPIRED');
  assert(/^[a-f0-9]{64}$/.test(quote.catalogSha256 ?? ''), 'INVALID_CATALOG_HASH');
}
function dbFor(context) {
  return {
    async rpc(name,body={}) {
      assert(['ivx_ai_budget_status','ivx_ai_budget_reserve','ivx_ai_budget_finish'].includes(name),'UNREVIEWED_RPC');
      const path='/rest/v1/rpc/'+name;
      const r=name==='ivx_ai_budget_status'
        ? await readDatabaseJson(context,path,{method:'POST',body})
        : await requestJson(context.databaseUrl+path,context.serviceKey,
          {method:'POST',body,headers:{apikey:context.serviceKey},timeout:30000});
      assert.equal(r.status,200,'DATABASE_HTTP_FAILED');return r.data;
    },
    async activeRows() {
      const r=await readDatabaseJson(context,'/rest/v1/ivx_ai_budget_reservations?status=eq.reserved'
        +'&order=created_at.asc&limit=4&select=reservation_id,worker_instance_id,model,created_at');
      assert.equal(r.status,200,'ACTIVE_ROWS_HTTP_FAILED');
      assert(Array.isArray(r.data),'INVALID_ACTIVE_ROWS');return r.data;
    },
    async rows() {
      const r=await readDatabaseJson(context,'/rest/v1/ivx_ai_budget_reservations?reservation_id=in.('
        +LABELS.map(reservationId).join(',')+')&select=reservation_id,worker_instance_id,model,request_sha,'
        +'policy_revision,reserved_nano,status,settled_upper_nano,generation_id,created_at,completed_at');
      assert.equal(r.status,200,'ROWS_HTTP_FAILED');
      assert(Array.isArray(r.data)&&r.data.every(x=>LABELS.map(reservationId).includes(x.reservation_id)),
        'INVALID_CAMPAIGN_ROWS');return r.data;
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
  // Approximately 118k input tokens, inside GPT-4o's published 128k context.
  // No token estimate is used for admission: reserve the FULL catalog envelope.
  let value = 100000000 + index * 7919;
  const numbers = [];
  for (let i=0; i<29500; i++) {
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
  const snapshot = { label, at: new Date().toISOString(), ...(quota ? budgetSummary(quota) : {notYetVisible:true}) };
  context.proof.quotaSnapshots.push(snapshot);
  assert(quota && quota.active && !quota.archived,'TEST_QUOTA_NOT_ACTIVE');
  return snapshot;
}
async function waitForQuota(context,id,label,limit,minimum=0) {
  for(let i=0;i<30;i++) {
    try {
      const quota=await quotaSnapshot(context,id,label);
      if(quota.limitAmount===limit && quota.currentSpend>=minimum-0.00000001) return quota;
    } catch(error) { if(error?.message!=='TEST_QUOTA_NOT_ACTIVE')throw error; }
    await wait(5000);
  }
  throw new Error('NATIVE_QUOTA_PROPAGATION_TIMEOUT');
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
export function receiptCoverageNano(quote, settlement, costNano) {
  assert(settlement && ['settled','uncertain'].includes(settlement.status),'UNSAFE_RECEIPT_STATE');
  const reserved=BigInt(quote.reservedNano);
  let covered;
  if(settlement.status==='uncertain') {
    assert.equal(settlement.settledUpperNano,null,'UNKNOWN_LIABILITY_WAS_RELEASED');
    covered=reserved;
  } else {
    assert(/^\d+$/.test(settlement.settledUpperNano??''),'INVALID_SETTLED_AMOUNT');
    covered=BigInt(settlement.settledUpperNano);
    assert(covered<=reserved,'SETTLED_AMOUNT_EXCEEDS_RESERVATION');
  }
  assert(BigInt(costNano)>0n && BigInt(costNano)<=covered,'RECEIPT_COST_NOT_COVERED');
  return covered.toString();
}
async function observedReceipt(key,id,model) {
  let receipt;
  for(let i=0;i<25;i++){
    const r=await requestJson(ORIGIN+'/v1/generation?id='+encodeURIComponent(id),key);
    if(r.status===200 && r.data?.data) {
      receipt=r.data.data;
      assert(receipt.id===id && receipt.model===model && receipt.is_byok===false,'RECEIPT_BINDING_FAILED');
      if(BigInt(providerReportedCostNano(receipt.total_cost))>0n)break;
    }
    await wait(1500);
  }
  assert(receipt,'RECEIPT_NOT_AVAILABLE');
  const costNano=providerReportedCostNano(receipt.total_cost);
  assert(BigInt(costNano)>0n,'POSITIVE_RECEIPT_NOT_AVAILABLE');
  return {id:receipt.id,model:receipt.model,costUsd:receipt.total_cost,costNano,
    isByok:receipt.is_byok,createdAt:receipt.created_at,at:new Date().toISOString(),
    costFields:Object.fromEntries(['total_cost','gateway_cost','usage','upstream_inference_cost','surcharge_cost','market_cost']
      .filter(k=>typeof receipt[k]==='number'||(typeof receipt[k]==='string'&&/^[0-9.eE+-]+$/.test(receipt[k])))
      .map(k=>[k,receipt[k]]))};
}

export function terminalRowMatches(row, params, quote, hash) {
  return Boolean(row && row.reservation_id===params.p_reservation_id
    && row.worker_instance_id===params.p_worker_instance_id && row.model===quote.model
    && row.request_sha===hash && Number(row.policy_revision)===2
    && String(row.reserved_nano)===quote.reservedNano && row.status===params.p_status
    && (params.p_settled_upper_nano===null ? row.settled_upper_nano===null
      : String(row.settled_upper_nano)===params.p_settled_upper_nano)
    && (row.generation_id??null)===(params.p_generation_id??null));
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
    let admitted, nextProgress=Date.now()+15000;
    const admissionDeadline=Date.now()+180000;
    stats.admissionChecks=0;
    do {
      checkQuote(quote);
      stats.admissionChecks++;
      admitted = await db.rpc('ivx_ai_budget_reserve', { p_reservation_id:stats.reservationId,
        p_worker_instance_id:worker,p_model:model,p_request_sha:hash,p_reserved_nano:quote.reservedNano,
        p_pricing_evidence:quote });
      if(admitted.allowed || admitted.reason!=='global_capacity_exceeded')break;
      stats.localAdmissionReason=admitted.reason;
      if(Date.now()>=nextProgress) {
        event('waiting-for-shared-capacity',{label,checks:stats.admissionChecks,
          remainingSeconds:Math.max(0,Math.ceil((admissionDeadline-Date.now())/1000))});
        nextProgress=Date.now()+15000;
      }
      await wait(700+Math.floor(Math.random()*300));
    } while(Date.now()<admissionDeadline);
    if(!admitted.allowed || admitted.reservationId!==stats.reservationId)
      throw new GlobalAIBudgetError(admitted.reason ?? 'unconfirmed');
    assert.equal(Number(admitted.policyRevision),2,'POLICY_REVISION_CHANGED');
    return { quote, async finish(usage, notStarted=false, generationId) {
      if(settled)return; settled=true;
      const params={p_reservation_id:stats.reservationId,p_worker_instance_id:worker,
        p_status:notStarted?'cancelled':usage?'settled':'uncertain',
        p_settled_upper_nano:notStarted?'0':usage?usageCostUpperNano(quote,usage):null,
        p_generation_id:usage?.generationId??generationId??null};
      stats.settlementRequested={status:params.p_status,reservedNano:quote.reservedNano,
        settledUpperNano:params.p_settled_upper_nano,generationId:params.p_generation_id};
      let confirmed=false;
      await settleBudgetWithRetry(p=>db.rpc('ivx_ai_budget_finish',p),params,{
        onConfirmed:()=>{confirmed=true;},onUnconfirmed:()=>{},
      });
      stats.settlementConfirmation=confirmed?'rpc_ack':null;
      if(!confirmed) {
        for(let i=0;i<3;i++) {
          try {
            const terminal=(await db.rows()).find(r=>r.reservation_id===stats.reservationId);
            if(terminalRowMatches(terminal,params,quote,hash)) {
              confirmed=true;stats.settlementConfirmation='independent_terminal_row';break;
            }
          } catch { /* A failed read does not confirm a terminal write. */ }
          await wait(2000);
        }
      }
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
        const redact=value=>{
          if(typeof value!=='string')return null;
          for(const secret of [key,context.gatewayKey,context.managementToken,context.serviceKey].filter(Boolean))
            value=value.split(secret).join('[REDACTED]');
          return value.replace(/\b(?:vck_|vcp_|sk-)[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,1200);
        };
        stats.quotaErrors.push({ status:response.status,
          code:redact(error?.error?.code),param:redact(error?.error?.param),message:redact(error?.error?.message),
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
    const result=await generateText({model:provider.chat(quote.model),
      prompt:label.startsWith('fill')?fillPrompt(Number(label.slice(-1))):'Reply only OK.',
      maxOutputTokens:32,maxRetries:label==='denied'?2:0,abortSignal:AbortSignal.timeout(540000)});
    stats.sdkUsage=Object.fromEntries(['inputTokens','outputTokens','totalTokens'].filter(k=>typeof result.usage?.[k]==='number').map(k=>[k,result.usage[k]]));
    succeeded=true;
  } catch(error) {
    stats.sdkStatus=Number.isInteger(error?.statusCode)?error.statusCode:null;
    stats.sdkErrorName=/^[A-Za-z_]{1,90}$/.test(error?.name??'')?error.name:null;
    stats.sdkErrorCode=safeError(error);
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
    assert(/^gen_[0-9A-HJKMNP-TV-Z]{26}$/.test(stats.settlement.generationId??''),'GENERATION_NOT_RETAINED');
    const record=await observedReceipt(key,stats.settlement.generationId,quote.model);
    record.label=label;
    record.coveredNano=receiptCoverageNano(quote,stats.settlement,record.costNano);
    record.ledgerState=stats.settlement.status;
    proof.receipts.push(record);
  }
  event('request-finished',{label,httpStatus:stats.statuses[0],settlement:stats.settlement.status});
  return stats;
}
function existingLimits(state, excludedId) {
  return state.budgets.filter(b=>b.scopeType!=='team' && !['api_key_id_'+excludedId,'api_key_id_jtAnoFZC1LAdFBOuA9gwn8byoEteiOrNxS4y0rwikpKds7aq',
    'api_key_id_pWesf5bv7wl7jAK357RL2q4DlnWYS4SzQN6ufeQiLGbYlURw',
    'api_key_id_UVzvUiLtmTPVjrFIgsOhTOgUMo42t9fNu8FMAL0KcJOUzYaF',
    'api_key_id_KSPgGHhv0EZq3WMzHszAA7qFVbOnarOiMI08J3YVq6c5a6gG',
    'api_key_id_knOwlYBnQg2O8NXTSmdzabDiELeajwcuAxsOVavJAlvv60K7',
    'api_key_id_AfVkVmLscQFO0cj0SRJaZcAZVrdVUoj9hagCXBx2kYjfUXID',
    'api_key_id_lmcgOgp2P4cc70xHcz9lA1HAvza3uJxyIkR0Ea7zQZVjkvnY',
    'api_key_id_ONdG1MfmiqLYVm0fEbxNUatjdxaWSIJtEhsnKOY7aBaqk3rs',
    'api_key_id_LSA0XIVQj6OKdv5yFsqzLYdqS8Ctd6rpvXtqfhFAzANCzyRq'].includes(b.quotaEntityId)).map(b=>({
    id:b.quotaEntityId,limit:b.limitAmount,period:b.refreshPeriod,active:b.active,archived:b.archived,
    byok:b.includeByokInQuota,
  })).sort((a,b)=>a.id.localeCompare(b.id));
}
async function reviewRetiredCapacity(context, db) {
  // Independently reviewed Render evidence: SIGTERM at 12:50:25, last log
  // 12:50:48, replacement live at 12:57:51, CPU/instance metrics at 13:08-13:12
  // identify exactly k9hjm and lzsnj. No current process owns c9sfd.
  const id='1308643c-2af6-4251-b6ea-e1bb651c4296';
  const worker='ivx-senior-dev-01:srv-d9i15fg4n6ts73bn00j0-5697ddff69-c9sfd:17:cc1c989b-532';
  const read=async()=>{
    const r=await readDatabaseJson(context,'/rest/v1/ivx_ai_budget_reservations?reservation_id=eq.'+id
      +'&select=reservation_id,worker_instance_id,model,status,reserved_nano,settled_upper_nano,generation_id,created_at,completed_at');
    assert.equal(r.status,200,'RETIRED_ROW_READ_FAILED');
    assert(Array.isArray(r.data)&&r.data.length===1,'RETIRED_ROW_MISSING');return r.data[0];
  };
  const before=await read();
  assert(before.worker_instance_id===worker && before.model==='openai/gpt-4o'
    && String(before.reserved_nano)==='822728000' && before.settled_upper_nano===null
    && before.generation_id===null && Date.parse(before.created_at)===Date.parse('2026-09-12T12:50:54.189453Z'),
    'RETIRED_ROW_BINDING_CHANGED');
  const review={at:new Date().toISOString(),before,liabilityReleasedNano:'0',
    physicalInstance:'srv-d9i15fg4n6ts73bn00j0-c9sfd',
    replacementDeploy:'dep-daiko4tckfvc7394ap5g',
    physicalTopologyObservedAt:'2026-09-12T13:12:00Z',
    currentInstances:['srv-d9i15fg4n6ts73bn00j0-k9hjm','srv-d9i15fg4n6ts73bn00j0-lzsnj'],
    mutationAttempted:false};
  context.proof.retiredCapacityReview=review;
  assert(['reserved','uncertain'].includes(before.status),'RETIRED_ROW_STATUS_CHANGED');
  if(before.status==='reserved') {
    assert(Date.now()<Date.parse('2026-09-12T14:00:00Z'),'RETIREMENT_REVIEW_EXPIRED');
    review.mutationAttempted=true;
    try {
      await db.rpc('ivx_ai_budget_finish',{p_reservation_id:id,p_worker_instance_id:worker,
        p_status:'uncertain',p_settled_upper_nano:null,p_generation_id:null});
    } catch { review.acknowledgmentUncertain=true; }
  }
  const after=await read();
  assert(after.status==='uncertain' && String(after.reserved_nano)==='822728000'
    && after.settled_upper_nano===null && after.generation_id===null,'RETIRED_LIABILITY_NOT_CONFIRMED');
  review.after=after;review.confirmed=true;
  event('retired-capacity-confirmed',{reservationId:id,status:'uncertain',retainedNano:'822728000'});
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
    const priorRows=await db.rows();
    const expectedPrior=[
      ['fill1','openai/gpt-4.1','4125468000','gen_01M2ASZFDXDJ0JFAZ5V37KM4JJ'],
      ['fill2','openai/gpt-4o','822728000','gen_01M2AWQ3GTQ4Z72QX87BBE7NDF'],
      ['fill3','openai/gpt-4o','822728000','gen_01M2AXCRXSM6DF2VX1EYBMQ9RP'],
      ['fill4','openai/gpt-4o','822728000','gen_01M2AXDQS1ADMY8PHRF632C6YY'],
      ['fill5','openai/gpt-4o','822728000','gen_01M2AXEWJ1FDRYNSHVRJQ62XM0'],
    ];
    assert.equal(priorRows.length,expectedPrior.length,'CAMPAIGN_REPLAY_OR_PRIOR_STATE_CHANGED');
    for(const [label,model,reserved,generation] of expectedPrior) {
      const row=priorRows.find(r=>r.reservation_id===reservationId(label));
      assert(row && row.worker_instance_id===CAMPAIGN+':'+label && row.model===model
        && row.status==='uncertain' && row.settled_upper_nano===null
        && String(row.reserved_nano)===reserved && row.generation_id===generation,
        'CAMPAIGN_REPLAY_OR_PRIOR_STATE_CHANGED');
    }
    const priorFirst=priorRows.find(r=>r.reservation_id===reservationId('fill1'));
    proof.priorFailedReservation=priorFirst;
    proof.priorRetainedReservations=priorRows;
    proof.priorPaidReceipts=[];
    for(const [label,model,reserved,generation] of expectedPrior.slice(1)) {
      const receipt=await observedReceipt(context.gatewayKey,generation,model);
      receipt.label=label;
      receipt.coveredNano=receiptCoverageNano({reservedNano:reserved},
        {status:'uncertain',settledUpperNano:null},receipt.costNano);
      proof.priorPaidReceipts.push(receipt);
    }
    proof.priorReceiptCostNano=proof.priorPaidReceipts.reduce((n,r)=>n+BigInt(r.costNano),0n).toString();
    proof.priorPaidReceipt=proof.priorPaidReceipts[0];
    if(process.argv[2]!=='diagnose') await reviewRetiredCapacity(context,db);
    proof.activeGlobalReservationsBefore=await db.activeRows();
    const diagnostic=await requestJson(ORIGIN+'/v1/generation?id=gen_01M2ASZFDXDJ0JFAZ5V37KM4JJ',context.gatewayKey);
    const priorReceipt=diagnostic.data?.data;
    const protectedText=value=>{
      if(typeof value!=='string')return null;
      for(const secret of [context.gatewayKey,context.managementToken,context.serviceKey].filter(Boolean))
        value=value.split(secret).join('[REDACTED]');
      return value.replace(/\b(?:vck_|vcp_|sk-)[A-Za-z0-9_-]+/g,'[REDACTED]').slice(0,1200);
    };
    const priorError=priorReceipt?.error ?? diagnostic.data?.error;
    proof.priorGenerationObservation={httpStatus:diagnostic.status,
      error:typeof priorError==='string'?protectedText(priorError):{
        code:protectedText(priorError?.code),type:protectedText(priorError?.type),message:protectedText(priorError?.message)},
      errorMessage:protectedText(priorReceipt?.error_message),
      ...(priorReceipt && priorReceipt.id===priorFirst.generation_id ? {
        id:priorReceipt.id,model:priorReceipt.model,costUsd:priorReceipt.total_cost,
        createdAt:priorReceipt.created_at,status:priorReceipt.status,
        availableFields:Object.keys(priorReceipt).filter(k=>/^[a-zA-Z0-9_]{1,80}$/.test(k)),
      }: {})};
    event('prior-generation-observed',proof.priorGenerationObservation);
    if(process.argv[2]==='diagnose') { proof.scope='read_only_prior_generation'; proof.diagnosticCompleted=true; return; }
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
    const fillQuote=await freshQuote('openai/gpt-4o'),smallQuote=await freshQuote('openai/gpt-4o-mini');
    assert(priorRows.reduce((n,r)=>n+BigInt(r.reserved_nano),0n)+BigInt(fillQuote.reservedNano)*4n+BigInt(smallQuote.reservedNano)*2n<=MAX_LIABILITY_NANO,
      'PLANNED_CAMPAIGN_EXCEEDS_BOUND');
    assert(fillQuote.maxInputTokens>=128000,'MODEL_CONTEXT_TOO_SMALL');
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
    event('test-key-created',{testKeyId,warmupSeconds:125});
    // Documented new-key metering may need two minutes. No paid warm-up calls.
    for(let i=0;i<5;i++){await wait(25000);event('metering-warmup',{elapsedSeconds:(i+1)*25});}
    let quota=await waitForQuota(context,testKeyId,'before-spend',1);
    assert.equal(quota.refreshPeriod,'none','TEST_QUOTA_PERIOD_MISMATCH');
    assert.equal(quota.currentSpend,0,'NEW_TEST_KEY_ALREADY_SPENT');
    for(let i=6;i<=9 && quota.currentSpend<1;i++) {
      await callProvider(context,db,testKey,'fill'+i,await freshQuote(fillQuote.model));
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
    const raised=await waitForQuota(context,testKeyId,'recovery-quota',raisedLimit,quota.currentSpend);
    assert.equal(raised.limitAmount,raisedLimit,'RECOVERY_QUOTA_NOT_APPLIED');
    assert(raised.currentSpend>=quota.currentSpend,'QUOTA_EDIT_RESET_SPEND');
    for(let i=0;i<4;i++){await wait(15000);event('recovery-propagation',{elapsedSeconds:(i+1)*15});}
    await callProvider(context,db,testKey,'recovery',await freshQuote('openai/gpt-4o-mini'));
    proof.nativeRecoveryObserved=true;
    assert.equal(new Set(proof.receipts.map(r=>r.id)).size,proof.receipts.length,'DUPLICATE_RECEIPTS');
    proof.newKeyReceiptCostNano=proof.receipts.reduce((n,r)=>n+BigInt(r.costNano),0n).toString();
    proof.actualReceiptCostNano=(BigInt(proof.newKeyReceiptCostNano)+BigInt(proof.priorReceiptCostNano)).toString();
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
