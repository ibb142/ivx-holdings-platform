import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import { generateText, streamText } from 'ai';
import { createGateway } from '@ai-sdk/gateway';
import { createOpenAI } from '@ai-sdk/openai';
import { createBudgetedFetch } from '../backend/services/ivx-global-ai-budget-fetch.ts';
import { GlobalAIBudgetError, quoteCatalogModel, usageCostUpperNano } from '../backend/services/ivx-global-ai-budget.ts';
import { settleBudgetWithRetry } from '../backend/services/ivx-global-ai-budget-settlement.ts';
import { providerReportedCostNano } from '../backend/services/ivx-provider-reported-cost.ts';
import { CAMPAIGN, MAX_CAMPAIGN_NANO, PAID_LABELS, DB_ORIGIN, SERVICES,
  reservationId, checkPolicy, checkQuote, sharedBinding, checkRows, checkRefusal } from './phase3-provider-live-guards.mjs';
import { paceOriginalResponse } from './phase3-provider-live-stream.mjs';

// Owner-authorized bounded experiment. The production admission/stream parser
// and installed SDK are unchanged. The injected reservation adapter calls the
// REAL shared PostgreSQL RPCs with stable IDs, never a permissive fixture.
// This measures shared admission with real Gateway calls, not native capacity.
const nativeFetch = fetch;
const gatewayOrigin = 'https://ai-gateway.vercel.sh';
const wait = ms => new Promise(resolve => setTimeout(resolve,ms));
const emit = value => console.log(JSON.stringify({channel:'phase3-provider-live',...value}));
const deferred = () => { let resolve,reject; const promise = new Promise((a,b) => {resolve=a;reject=b;});
  promise.catch(() => {}); return {promise,resolve,reject}; };
async function bounded(promise, ms, code) {
  let timer;
  try { return await Promise.race([promise,new Promise((_,reject) => { timer=setTimeout(() => reject(new Error(code)),ms); })]); }
  finally {clearTimeout(timer);}
}
function safeError(error) {
  // Never serialize SDK exceptions, HTTP bodies, headers or environment values.
  const code=typeof error?.message==='string'?error.message.split('\n')[0]:'';
  return /^[A-Z][A-Z0-9_]{2,90}$/.test(code)?code:'PROBE_CHECK_FAILED';
}
async function jsonRead(url, headers = {}, body) {
  const response = await nativeFetch(url,{method:body===undefined?'GET':'POST',redirect:'error',
    signal:AbortSignal.timeout(12_000),headers:{Accept:'application/json',...headers,
      ...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  if (!response.ok) {await response.body?.cancel();throw new Error('PROTECTED_HTTP_'+response.status);}
  const reader=response.body.getReader(), chunks=[]; let size=0;
  try { for (;;) {const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    assert(size<=5_000_000,'PROTECTED_RESPONSE_TOO_LARGE');chunks.push(value);} }
  finally {await reader.cancel().catch(() => {});reader.releaseLock();}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
function database(binding) {
  assert.equal(binding.databaseUrl,DB_ORIGIN,'DATABASE_BINDING_MISMATCH');
  const headers={apikey:binding.serviceKey,Authorization:'Bearer '+binding.serviceKey};
  return {
    rpc:(name,params={}) => {
      assert(['ivx_ai_budget_status','ivx_ai_budget_reserve','ivx_ai_budget_finish'].includes(name),'UNREVIEWED_RPC');
      return jsonRead(DB_ORIGIN+'/rest/v1/rpc/'+name,headers,params);
    },
    rows:() => jsonRead(DB_ORIGIN+'/rest/v1/ivx_ai_budget_reservations?reservation_id=in.('
      +[...PAID_LABELS,'denied'].map(reservationId).join(',')+')&select=reservation_id,worker_instance_id,model,request_sha,policy_revision,reserved_nano,status,settled_upper_nano,generation_id,created_at,completed_at',headers),
  };
}
function admission(binding,quote,label,stats,waitForCapacity=false) {
  const db=database(binding), id=reservationId(label),worker=CAMPAIGN+':'+label, finishSeen=deferred();
  const reserve=async (model,hash) => {
    stats.admissions++;checkQuote(quote);assert.equal(model,quote.model,'MODEL_QUOTE_MISMATCH');
    const params={p_reservation_id:id,p_worker_instance_id:worker,p_model:model,p_request_sha:hash,
      p_reserved_nano:quote.reservedNano,p_pricing_evidence:quote};
    let result;
    // A test client can wait for natural free capacity before sending HTTP.
    // The refused-request test below disables this internal wait. It observes
    // the SDK's bounded 429 retries, with zero provider attempts and one ID.
    for(let i=0;i<(waitForCapacity?16:1);i++) {
      stats.databaseAdmissionAttempts=(stats.databaseAdmissionAttempts||0)+1;
      result=await db.rpc('ivx_ai_budget_reserve',params);
      if(result.allowed===true||result.reason!=='global_capacity_exceeded'||!waitForCapacity||i===15)break;
      await wait(750);
    }
    stats.lastAdmissionReason=result.reason??null;
    if (result.allowed!==true || result.reservationId!==id) throw new GlobalAIBudgetError(result.reason??'unconfirmed');
    assert.equal(Number(result.policyRevision),2,'POLICY_REVISION_CHANGED');
    let finished;
    return {quote,finish(usage,notStarted=false,generationId) {
      if(finished)return finished;
      finished=(async () => {
        const params={p_reservation_id:id,p_worker_instance_id:worker,
          p_status:notStarted?'cancelled':usage?'settled':'uncertain',
          p_settled_upper_nano:notStarted?'0':usage?usageCostUpperNano(quote,usage):null,
          p_generation_id:usage?.generationId??generationId??null};
        const confirmed=deferred();
        await settleBudgetWithRetry(p=>db.rpc('ivx_ai_budget_finish',p),params,{
          onConfirmed:receipt=>confirmed.resolve(receipt),
          onUnconfirmed:()=>confirmed.reject(new Error('SETTLEMENT_UNCONFIRMED')),
        });
        await bounded(confirmed.promise,80_000,'SETTLEMENT_UNCONFIRMED');
        const row=(await db.rows()).find(r=>r.reservation_id===id);
        assert(row && row.status===params.p_status,'SETTLEMENT_UNCONFIRMED');
        stats.settlement={status:row.status,generationId:row.generation_id,
          reservedNano:String(row.reserved_nano),settledUpperNano:row.settled_upper_nano===null?null:String(row.settled_upper_nano)};
        stats.finishParams=params;finishSeen.resolve(row);
      })().catch(error=>{finishSeen.reject(error);throw error;});
      return finished;
    }};
  };
  return {reserve,finishSeen,db};
}

async function childMain(label) {
  assert(PAID_LABELS.includes(label),'UNREVIEWED_PROBE_LABEL');
  const {binding,quote}=JSON.parse(process.env.IVX_PROBE_PRIVATE_BINDING || '{}');
  delete process.env.IVX_PROBE_PRIVATE_BINDING;
  checkQuote(quote);
  const action=deferred(), controller=new AbortController();
  const input=createInterface({input:process.stdin});
  input.once('line',line=>{ if(['complete','cancel'].includes(line))action.resolve(line);else action.reject(new Error('INVALID_CHILD_COMMAND')); });
  input.once('close',()=>action.reject(new Error('PARENT_CHANNEL_CLOSED')));
  const stats={label,pid:process.pid,protocol:label==='cancel'?'gateway_openai_chat_completions':'gateway_ai_sdk',admissions:0,gatewayAttempts:0,statuses:[],quotaHeaders:[],textDeltas:0,cancelRequested:false};
  const a=admission(binding,quote,label,stats,true);
  let selectedAction;
  try {
    const transport=createBudgetedFetch(async (resource,init) => {
      const request=new Request(resource,init),url=new URL(request.url);
      if(request.method==='GET')return nativeFetch(request);
      assert.equal(url.origin,gatewayOrigin,'UNREVIEWED_PROVIDER_ORIGIN');
      assert(['/v4/ai/language-model','/v3/ai/language-model','/v1/chat/completions'].includes(url.pathname),'UNREVIEWED_PROVIDER_PATH');
      assert.equal(++stats.gatewayAttempts,1,'EXTRA_PAID_ATTEMPT_BLOCKED');
      const response=await nativeFetch(request);
      stats.statuses.push(response.status);
      stats.quotaHeaders.push(Object.fromEntries([...response.headers].filter(([key,value])=>
        /^(retry-after|x-ratelimit-[a-z-]+|ratelimit-[a-z-]+)$/.test(key)&&/^[\w .,:+/-]{1,160}$/.test(value))));
      emit({type:'headers',label,pid:process.pid,httpStatus:response.status,at:new Date().toISOString()});
      // Only delay delivery of the ORIGINAL response. Do not clone the stream,
      // fabricate response data, or report this hold as provider concurrency.
      try {selectedAction=await bounded(action.promise,35_000,'PARENT_RELEASE_TIMEOUT');}
      catch(error){controller.abort();await response.body?.cancel().catch(()=>{});throw error;}
      if(selectedAction==='cancel') {
        stats.controlledStreamConsumption={originalBytesPreserved:true,chunkBytes:64,delayMs:10};
        return paceOriginalResponse(response);
      }
      return response;
    },{enabled:()=>true,reserve:a.reserve});
    const gateway=createGateway({apiKey:binding.gatewayKey,fetch:transport});
    // Chat Completions documents its Gateway generation ID in the first
    // content chunk. The native AI SDK stream did not expose that ID before
    // our earlier cancellation; those unknown charges remain fully retained.
    const model=label==='cancel'
      ?createOpenAI({apiKey:binding.gatewayKey,baseURL:gatewayOrigin+'/v1',fetch:transport}).chat(quote.model)
      :gateway(quote.model);
    const result=streamText({model,prompt:'Write the integers from 1 through 100, separated by spaces.',
      maxOutputTokens:256,maxRetries:0,abortSignal:AbortSignal.any([controller.signal,AbortSignal.timeout(60_000)]),
      onError:()=>{}});
    for await(const part of result.fullStream) {
      if(part.type==='error')throw new Error('REAL_PROVIDER_STREAM_ERROR');
      if(part.type==='text-delta') {
        stats.textDeltas++;
        if(selectedAction==='cancel') {stats.cancelRequested=true;controller.abort();break;}
      }
    }
    const row=await bounded(a.finishSeen.promise,85_000,'SETTLEMENT_TIMEOUT');
    assert(stats.textDeltas>0,'NO_REAL_TEXT_DELTA');
    assert.equal(row.status,selectedAction==='cancel'?'uncertain':'settled','UNEXPECTED_TERMINAL_STATE');
    assert(/^gen_[0-9A-HJKMNP-TV-Z]{26}$/.test(row.generation_id || ''),'GENERATION_ID_NOT_RETAINED');
    if(selectedAction==='cancel')assert.equal(row.settled_upper_nano,null,'UNCERTAIN_CHARGE_REFUNDED');
    emit({type:'done',ok:true,...stats,finishParams:undefined,at:new Date().toISOString()});
  } catch(error) {
    controller.abort();
    if(stats.gatewayAttempts)await bounded(a.finishSeen.promise,15_000,'SETTLEMENT_TIMEOUT').catch(()=>{});
    emit({type:'done',ok:false,...stats,finishParams:undefined,error:safeError(error),at:new Date().toISOString()});
    process.exitCode=1;
  } finally {input.close();}
}

function startChild(binding,quote,label,children,proof) {
  const proc=spawn(process.execPath,[fileURLToPath(import.meta.url),'child',label],{
    env:{...process.env,IVX_PROBE_PRIVATE_BINDING:JSON.stringify({binding,quote})},stdio:['pipe','pipe','pipe']});
  const headers=deferred(),done=deferred();let sent=false;
  const reader=createInterface({input:proc.stdout});
  reader.on('line',line=>{if(line.length>60_000)return;let message;try{message=JSON.parse(line);}catch{return;}
    if(message.channel!=='phase3-provider-live'||message.label!==label)return;
    if(message.type==='headers')headers.resolve(message);
    if(message.type==='done'){proof.calls.push(message);done.resolve(message);}});
  // stderr may contain SDK details. Preserve only a byte count, never its text.
  proc.stderr.on('data',chunk=>{proof.childDiagnosticBytes=(proof.childDiagnosticBytes||0)+chunk.length;});
  proc.on('error',()=>{headers.reject(new Error('CHILD_START_FAILED'));done.reject(new Error('CHILD_START_FAILED'));});
  proc.on('exit',()=>{headers.reject(new Error('CHILD_EXIT_BEFORE_HEADERS'));done.reject(new Error('CHILD_EXIT_BEFORE_RESULT'));reader.close();});
  const child={proc,label,headers:headers.promise,done:done.promise,release(command){if(!sent&&!proc.stdin.destroyed){sent=true;proc.stdin.write(command+'\n');}}};
  children.push(child);return child;
}

async function refusedCall(binding,quote,label,expectedReason,proof,key) {
  const stats={label,admissions:0,gatewayAttempts:0,admissionResponses:[]},a=admission(binding,quote,label,stats);
  if(proof)proof[key]=stats;
  const transport=createBudgetedFetch(async(resource,init)=>{
    const r=new Request(resource,init);if(r.method==='GET')return nativeFetch(r);
    stats.gatewayAttempts++;throw new Error('REFUSED_REQUEST_REACHED_TRANSPORT');
  },{enabled:()=>true,reserve:a.reserve});
  const gateway=createGateway({apiKey:binding.gatewayKey,fetch:async(resource,init)=>{
    const response=await transport(resource,init);
    if(response.status>=400)stats.admissionResponses.push({httpStatus:response.status,
      retryAfter:response.headers.get('retry-after'),at:Date.now()});
    return response;
  }});
  let status=null;
  try{await generateText({model:gateway(quote.model),prompt:'Return OK.',maxOutputTokens:4,maxRetries:2});}
  catch(error){status=error?.statusCode??null;stats.errorCode=safeError(error);
    stats.errorName=/^[A-Za-z_]{1,80}$/.test(error?.name||'')?error.name:null;
    stats.lastErrorStatusCode=Number.isInteger(error?.lastError?.statusCode)?error.lastError.statusCode:null;}
  stats.httpStatus=Number.isInteger(status)?status:null;
  checkRefusal(stats,expectedReason);
  return {...stats,source:'shared_postgresql_admission_not_native_provider_quota',passed:true};
}

async function parentMain() {
  const proof={scope:'real_gateway_shared_postgresql_admission_cancel_recovery',campaign:CAMPAIGN,
    sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),startedAt:new Date().toISOString(),
    passed:false,phase3Closed:false,item11_4Closed:false,item11_5Closed:false,
    providerMaximumConcurrency:null,native429Observed:false,maxCampaignLiabilityNano:MAX_CAMPAIGN_NANO.toString(),
    calls:[],receipts:[],secretValuesReturned:false,productionPolicyChanged:false};
  const children=[];let db,binding,rows=[];
  try {
    assert.equal(process.env.IVX_AUTHORIZED_PROVIDER_PROBE,CAMPAIGN,'EXPLICIT_CAMPAIGN_BINDING_REQUIRED');
    assert(process.env.RENDER_API_KEY,'PROTECTED_RENDER_CREDENTIAL_REQUIRED');
    const values=[];
    for(const id of SERVICES) {
      const headers={Authorization:'Bearer '+process.env.RENDER_API_KEY};
      const detail=await jsonRead('https://api.render.com/v1/services/'+id,headers);
      assert.equal(detail.repo,'https://github.com/ibb142/ivx-holdings-platform','SERVICE_REPOSITORY_MISMATCH');
      let cursor='',env={};
      for(let page=0;page<5;page++) {
        const batch=await jsonRead('https://api.render.com/v1/services/'+id+'/env-vars?limit=100'+(cursor?'&cursor='+encodeURIComponent(cursor):''),headers);
        assert(Array.isArray(batch),'INVALID_ENV_BINDINGS');
        for(const {envVar} of batch)env[envVar.key]=envVar.value;
        if(batch.length<100)break;
        cursor=batch.at(-1).cursor;assert(cursor&&page<4,'ENV_PAGINATION_LIMIT');
      }
      values.push(env);
    }
    binding=sharedBinding(values);db=database(binding);
    const health=await jsonRead('https://api.ivxholding.com/health');
    const version=await jsonRead('https://api.ivxholding.com/version');
    assert(health.ok===true&&version.ok===true&&health.commit===version.commit
      &&/^[a-f0-9]{40}$/.test(version.commit),'PRODUCTION_VERSION_NOT_READY');
    proof.productionShaBefore=version.commit;
    const policy=await db.rpc('ivx_ai_budget_status');checkPolicy(policy);
    proof.policy={enabled:policy.enabled,dailyLimitNano:policy.dailyLimitNano,maxConcurrent:policy.maxConcurrent,
      policyRevision:policy.policyRevision,measuredAt:policy.measuredAt};
    const token=process.env.VERCEL_TOKEN||process.env.VERCEL_API_TOKEN||process.env.IVX_VERCEL_TOKEN
      ||values.flatMap(v=>[v.VERCEL_TOKEN,v.VERCEL_API_TOKEN,v.IVX_VERCEL_TOKEN]).find(Boolean);
    proof.nativeBudget={state:'UNOBSERVED',reason:'NO_PROTECTED_MANAGEMENT_TOKEN'};
    if(token) {
      try {
        const budgets=await jsonRead('https://api.vercel.com/ai-gateway/budgets/list?teamId=team_fEfCJAenMBXVSGiX6LeoA3Ji',{Authorization:'Bearer '+token});
        assert(Array.isArray(budgets.budgets),'INVALID_NATIVE_BUDGET_RESULT');
        proof.nativeBudget={state:'OBSERVED',limits:budgets.budgets.map(({scopeType,limitAmount,currentSpend,refreshPeriod,active,archived})=>
          ({scopeType,limitAmount,currentSpend,refreshPeriod,active,archived})),coverageVerified:false};
      } catch(error){proof.nativeBudget={state:'UNOBSERVED',reason:safeError(error)};}
    }
    rows=await db.rows();checkRows(rows);
    const diagnosticOnly=process.argv[2]==='diagnose';
    if(!diagnosticOnly)assert.equal(rows.length,0,'CAMPAIGN_ALREADY_HAS_DURABLE_RESERVATIONS');
    const catalog=await jsonRead(gatewayOrigin+'/v1/models'),at=Date.now();
    const hash=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
    // Select only a model actually present in the current catalog and whose
    // full published context/output liability fits all three possible calls.
    const allowed=['openai/gpt-4o-mini','openai/gpt-4.1-nano','openai/gpt-5-nano'];
    const quotes=allowed.flatMap(model=>{try{const q=quoteCatalogModel(catalog,model,at,hash);checkQuote(q);return[q];}catch{return[];}});
    quotes.sort((a,b)=>BigInt(a.reservedNano)<BigInt(b.reservedNano)?-1:1);
    const quote=quotes[0];assert(quote,'NO_SUPPORTED_MODEL_WITHIN_CAMPAIGN_BOUND');proof.quote=quote;
    if(diagnosticOnly) {
      proof.scope='existing_reservation_refusal_diagnostic_no_provider_calls';
      assert(rows.some(r=>r.reservation_id===reservationId('complete')),'NO_EXISTING_DIAGNOSTIC_RESERVATION');
      await refusedCall(binding,quote,'complete','reservation_already_exists',proof,'diagnosticRefusal');
      proof.diagnosticPassed=true;return;
    }
    // Wait for natural capacity, never pause or change production to force a PASS.
    let idle=false;
    for(let i=0;i<20;i++){const p=await db.rpc('ivx_ai_budget_status');checkPolicy(p);if(p.requestsActive<2){idle=true;break;}await wait(1500);}
    assert(idle,'PRODUCTION_CAPACITY_BUSY');
    const first=startChild(binding,quote,'complete',children,proof),second=startChild(binding,quote,'cancel',children,proof);
    const headers=await bounded(Promise.all([first.headers,second.headers]),45_000,'TWO_REAL_RESPONSES_NOT_OBSERVED');
    assert(headers.every(x=>x.httpStatus===200),'REAL_PROVIDER_HTTP_NOT_200');
    assert.notEqual(headers[0].pid,headers[1].pid,'CLIENTS_NOT_SEPARATE_PROCESSES');
    rows=await db.rows();checkRows(rows);
    assert.equal(rows.filter(r=>r.status==='reserved').length,2,'TWO_OWN_RESERVATIONS_NOT_ACTIVE');
    proof.concurrentAdmission={passed:true,processes:headers.map(h=>h.pid),headers,
      measuredAt:new Date().toISOString(),activeOwnReservations:2,
      semantics:'overlapping_admissions_with_original_responses_held_not_provider_maximum'};
    proof.refused=await refusedCall(binding,quote,'denied','global_capacity_exceeded',proof,'refused');
    first.release('complete');second.release('cancel');
    const initial=await bounded(Promise.all([first.done,second.done]),100_000,'INITIAL_PROBES_NOT_FINISHED');
    assert(initial.every(x=>x.ok),'INITIAL_REAL_PROBE_FAILED');
    rows=await db.rows();checkRows(rows);assert(!rows.some(r=>r.status==='reserved'),'OWN_ACTIVE_RESERVATION_LEAK');
    proof.duplicate=await refusedCall(binding,quote,'complete','reservation_already_exists',proof,'duplicate');
    const recovered=startChild(binding,quote,'recovery',children,proof);recovered.release('complete');
    const recovery=await bounded(recovered.done,100_000,'RECOVERY_PROBE_NOT_FINISHED');
    assert(recovery.ok,'REAL_PROVIDER_RECOVERY_FAILED');
    rows=await db.rows();checkRows(rows);
    assert.equal(rows.length,3,'UNEXPECTED_PROBE_RESERVATION_COUNT');
    assert(!rows.some(r=>r.status==='reserved'),'OWN_ACTIVE_RESERVATION_LEAK');
    // Receipt ingestion is asynchronous. Poll reads only; never repeat inference.
    for(const row of rows) {
      assert(/^gen_[0-9A-HJKMNP-TV-Z]{26}$/.test(row.generation_id||''),'GENERATION_ID_NOT_RETAINED');
      let receipt;
      for(let n=0;n<6;n++) {
        try{receipt=(await jsonRead(gatewayOrigin+'/v1/generation?id='+encodeURIComponent(row.generation_id),{Authorization:'Bearer '+binding.gatewayKey})).data;break;}
        catch(error){if(error.message!=='PROTECTED_HTTP_404'||n===5)throw error;await wait(2500);}
      }
      assert(receipt?.id===row.generation_id&&receipt.model===row.model&&receipt.is_byok===false,'RECEIPT_IDENTITY_MISMATCH');
      const created=Date.parse(receipt.created_at);
      assert(created>=Date.parse(row.created_at)-5000&&created<=Date.parse(row.completed_at)+5000,'RECEIPT_TIME_MISMATCH');
      const cost=providerReportedCostNano(receipt.total_cost);
      for(const key of ['gateway_cost','usage'])if(receipt[key]!==undefined)
        assert.equal(providerReportedCostNano(receipt[key]),cost,'RECEIPT_COST_CONFLICT');
      assert(BigInt(cost)<=BigInt(row.reserved_nano),'RECEIPT_EXCEEDS_RESERVATION');
      if(row.status==='settled')assert(BigInt(cost)<=BigInt(row.settled_upper_nano),'RECEIPT_EXCEEDS_SETTLEMENT');
      proof.receipts.push({reservationId:row.reservation_id,generationId:row.generation_id,model:row.model,
        providerCostNano:cost,ledgerStatus:row.status,retainedLiabilityNano:row.status==='uncertain'?String(row.reserved_nano):'0',
        providerCreatedAt:receipt.created_at,observedAt:new Date().toISOString()});
    }
    assert.equal(new Set(proof.receipts.map(r=>r.generationId)).size,3,'DUPLICATE_PROVIDER_GENERATION');
    proof.providerCostNano=proof.receipts.reduce((sum,r)=>sum+BigInt(r.providerCostNano),0n).toString();
    proof.gatewayAttempts=proof.calls.reduce((sum,r)=>sum+r.gatewayAttempts,0);assert.equal(proof.gatewayAttempts,3,'EXTRA_PROVIDER_ATTEMPTS');
    checkPolicy(await db.rpc('ivx_ai_budget_status'));
    proof.productionShaAfter=(await jsonRead('https://api.ivxholding.com/version')).commit;
    proof.native429Observed=proof.calls.some(r=>r.statuses.includes(429));
    proof.passed=true;
    proof.openRequirements=['Native budget coverage and enforcement','Native provider quota/429 and retry-after behavior'];
  } catch(error) {proof.error=safeError(error);process.exitCode=1;}
  finally {
    for(const child of children)child.release(child.label==='cancel'?'cancel':'complete');
    await Promise.allSettled(children.map(child=>bounded(child.done,20_000,'CHILD_CLEANUP_TIMEOUT')));
    for(const child of children){child.proc.stdin.end();if(child.proc.exitCode===null)child.proc.kill('SIGTERM');}
    if(db)try{rows=await db.rows();checkRows(rows);proof.finalReservations=rows;proof.ownActiveReservations=rows.filter(r=>r.status==='reserved').length;
      if(proof.ownActiveReservations){proof.passed=false;proof.error='OWN_ACTIVE_RESERVATION_RETAINED';process.exitCode=1;}}
    catch{proof.finalLedgerObservation='UNAVAILABLE';proof.passed=false;process.exitCode=1;}
    proof.completedAt=new Date().toISOString();
    proof.native429Observed=proof.calls.some(r=>r.statuses.includes(429));
    await mkdir('qa/evidence/phase3-provider-live',{recursive:true});
    await writeFile('qa/evidence/phase3-provider-live/proof.json',JSON.stringify(proof,null,2)+'\n');
    emit({type:'result',...proof});
  }
}

if(process.argv[2]==='child')await childMain(process.argv[3]);
else await parentMain();
