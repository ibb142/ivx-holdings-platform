import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CAMPAIGN, MAX_LIABILITY_NANO, reservationId, dbFor, freshQuote, callProvider,
  observedReceipt, receiptCoverageNano } from './phase3-native-quota.mjs';
import { TEAM, prepareContext, readNativeState, checkNativeBudget, budgetSummary,
  management, emitProof } from './phase3-native-budget.mjs';

const PRIOR_SHA256='bebed74f9a14ca05dc9a4a9e044b21af2297ff58b0a0ae7e1aba78d5e823ea07';
export function evidenceContentHash(value) {
  return createHash('sha256').update(JSON.stringify(value,(_,item)=>
    item && typeof item==='object' && !Array.isArray(item)
      ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)).digest('hex');
}
export function verifyObservedNativeQuota(prior) {
  assert.equal(prior.sourceSha,'d572ca0df73250b98d346aff6e2b03d6d11e86eb','PRIOR_SOURCE_CHANGED');
  assert.equal(prior.runId,'34698467674','PRIOR_RUN_CHANGED');
  assert(typeof prior.testKeyId==='string' && /^[A-Za-z0-9_-]{16,100}$/.test(prior.testKeyId),'PRIOR_KEY_INVALID');
  assert.equal(prior.testKeyDeleted,true,'PRIOR_KEY_NOT_DELETED');
  assert.equal(prior.productionControlsPreserved,true,'PRIOR_PRODUCTION_CONTROL_UNCONFIRMED');
  assert.equal(prior.calls.length,5,'PRIOR_CALL_COUNT_CHANGED');
  const denied=prior.calls.find(c=>c.label==='denied');
  assert(denied && denied.reservationId===reservationId('denied'),'PRIOR_DENIAL_ID_CHANGED');
  assert.equal(denied.admissions,1,'PRIOR_ADMISSION_REPEATED');
  assert.equal(denied.providerHttpAttempts,1,'PRIOR_PROVIDER_ATTEMPT_REPEATED');
  assert.deepEqual(denied.statuses,[402],'NATIVE_402_NOT_OBSERVED');
  const error=denied.quotaErrors[0];
  assert(denied.quotaErrors.length===1 && error.status===402
    && error.type==='quota_for_entity_exceeded'
    && error.message.startsWith('API key budget exceeded.'),'WRONG_NATIVE_ERROR_SCOPE');
  const quota=prior.quotaSnapshots.at(-1);
  assert(quota && quota.quotaEntityId==='api_key_id_'+prior.testKeyId
    && quota.scopeId===prior.testKeyId && quota.active && !quota.archived
    && quota.limitAmount===1 && quota.currentSpend===1.18074,'NATIVE_EXHAUSTION_UNCONFIRMED');
  assert.equal(prior.receipts.length,4,'PRIOR_RECEIPTS_MISSING');
  assert.equal(new Set(prior.receipts.map(r=>r.id)).size,4,'DUPLICATE_PRIOR_RECEIPTS');
  for(let i=6;i<=9;i++) {
    const call=prior.calls.find(c=>c.label==='fill'+i);
    const receipt=prior.receipts.find(r=>r.label==='fill'+i);
    assert(call && receipt && call.reservationId===reservationId(call.label)
      && call.providerHttpAttempts===1 && call.admissions===1,'PRIOR_FILL_BINDING_CHANGED');
    assert.deepEqual(call.statuses,[200],'PRIOR_FILL_NOT_SUCCESSFUL');
    assert.equal(receipt.id,call.settlement.generationId,'PRIOR_RECEIPT_BINDING_CHANGED');
    receiptCoverageNano({reservedNano:'822728000'},call.settlement,receipt.costNano);
  }
  assert.equal(prior.receipts.reduce((n,r)=>n+BigInt(r.costNano),0n),1180740000n,'PRIOR_NATIVE_SPEND_MISMATCH');
  return {httpStatus:402,type:error.type,limitUsd:1,
    spendUsd:quota.currentSpend,providerHttpAttempts:1,originalRunPassed:prior.passed};
}
const safeError=error=>String(error?.message??'').split('\n')[0].trim().match(/^[A-Z][A-Z0-9_]{2,100}$/)?.[0]
  ??'NATIVE_RECOVERY_CHECK_FAILED';
// Public evidence contains only explicit QA metrics. Credential identifiers,
// infrastructure bindings, raw rows and native responses stay in memory.
export function publicRecoveryProof(proof) {
  const numeric=value=>typeof value==='number' && Number.isFinite(value)?value:null;
  const amount=value=>typeof value==='string' && /^\d{1,18}$/.test(value)?value:null;
  const calls=(proof.calls??[]).map(c=>({label:'recovery',model:c.model==='openai/gpt-4o-mini'?c.model:null,
    admissions:numeric(c.admissions),providerHttpAttempts:numeric(c.providerHttpAttempts),
    statuses:(c.statuses??[]).filter(s=>Number.isInteger(s)&&s>=100&&s<=599),
    startedAt:c.startedAt,completedAt:c.completedAt,
    settlement:c.settlement?{status:['settled','uncertain'].includes(c.settlement.status)?c.settlement.status:null,
      reservedNano:amount(c.settlement.reservedNano),settledUpperNano:amount(c.settlement.settledUpperNano),
      generationRetained:typeof c.settlement.generationId==='string'}:null,
    settlementConfirmed:['rpc_ack','independent_terminal_row'].includes(c.settlementConfirmation)}));
  const receipts=[...(proof.priorReceipts??[]),...(proof.receipts??[])];
  return {type:'native-recovery-result',startedAt:proof.startedAt,sourceSha:proof.sourceSha,runId:proof.runId,
    stage:proof.stage,priorLogHttpStatus:numeric(proof.priorLogHttpStatus),
    priorLogStorageHttpStatus:numeric(proof.priorLogStorageHttpStatus),
    priorSerializedSha256:proof.priorSerializedSha256,priorContentSha256:proof.priorContentSha256,
    errorClass:['AssertionError','TypeError','SyntaxError','TimeoutError'].includes(proof.errorClass)?proof.errorClass:null,
    passed:proof.passed===true,
    error:proof.error?safeError({message:proof.error}):null,
    finalControlError:proof.finalControlError?safeError({message:proof.finalControlError}):null,
    finalRowsError:proof.finalRowsError?safeError({message:proof.finalRowsError}):null,
    priorJobId:proof.priorJobId,priorArtifactSha256:proof.priorArtifactSha256,
    nativeQuotaRejection:proof.nativeQuotaRejection??null,
    recoveryMode:'existing_authorized_production_route_after_isolated_key_quota_refusal',
    nativeSameKeyQuotaIncreaseTested:false,native429Observed:false,providerMaximumConcurrency:null,
    productionControlsPreserved:proof.productionControlsPreserved===true,
    sharedBindingVerified:proof.sharedBindingVerified===true,
    exhaustedTestKeyAbsent:proof.exhaustedTestKeyAbsent===true,
    nativeMutation:false,secretValuesReturned:false,
    previousReservationCount:proof.priorRows?.length??null,
    previousDenialTerminal:proof.previousDenialClosure?.status==='uncertain',
    previousDenialRetainedNano:amount(String(proof.previousDenialClosure?.reserved_nano??'')),
    previousRowsPreserved:proof.previousRowsPreserved===true,
    calls,receiptCount:receipts.length,distinctReceiptCount:new Set(receipts.map(r=>r.id)).size,
    receiptCostsNano:receipts.map(r=>amount(r.costNano)),
    receiptBindingsSha256:receipts.length?createHash('sha256').update(JSON.stringify(receipts.map(r=>({
      id:r.id,model:r.model,costNano:r.costNano})).sort((a,b)=>a.id.localeCompare(b.id)))).digest('hex'):null,
    verifiedReceiptCostNano:amount(proof.verifiedReceiptCostNano),
    activeOwnReservations:numeric(proof.activeOwnReservations),
    fullCampaignReservedNano:amount(proof.fullCampaignReservedNano),
    maximumCampaignLiabilityNano:amount(proof.maximumCampaignLiabilityNano),
    nativeTeamDailyLimitUsd:numeric(proof.teamBudgetAfter?.limitAmount),
    sharedDailyLimitNano:amount(proof.sharedPolicyAfter?.dailyLimitNano),
    sharedMaxConcurrent:numeric(proof.sharedPolicyAfter?.maxConcurrent),
    sharedPolicyRevision:numeric(Number(proof.sharedPolicyAfter?.policyRevision)),
    nativeServiceRecoveryObserved:proof.nativeServiceRecoveryObserved===true};
}
function settings(state) {
  return {keyId:state.key.id,bypass:state.key.metadata?.bypassAll??false,
    quotas:state.budgets.filter(b=>!b.archived && (b.scopeType==='team'
      || b.quotaEntityId==='api_key_id_'+state.key.id)).map(b=>({
        id:b.quotaEntityId,limit:b.limitAmount,period:b.refreshPeriod,active:b.active,
        archived:b.archived,byok:b.includeByokInQuota})).sort((a,b)=>a.id.localeCompare(b.id))};
}
async function main() {
  const proof={type:'native-recovery-result',campaign:CAMPAIGN,teamId:TEAM,
    startedAt:new Date().toISOString(),sourceSha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    runId:process.env.GITHUB_RUN_ID,endpoints:[],calls:[],receipts:[],passed:false,
    nativeMutation:false,secretValuesReturned:false,nativeSameKeyQuotaIncreaseTested:false,
    recoveryMode:'existing_authorized_production_route_after_isolated_key_quota_refusal',
    maximumCampaignLiabilityNano:MAX_LIABILITY_NANO.toString()};
  let context,db,before;
  try {
    proof.stage='validate_review';
    assert.equal(process.env.IVX_NATIVE_QUOTA_PROBE,'phase3-native-recovery-20260912','REVIEW_BINDING_REQUIRED');
    assert(process.env.GH_TOKEN,'WORKFLOW_LOG_READ_TOKEN_REQUIRED');
    proof.stage='fetch_prior_log';
    const logResponse=await fetch('https://api.github.com/repos/ibb142/ivx-holdings-platform/actions/jobs/103566100793/logs',{
      headers:{Accept:'application/vnd.github+json',Authorization:'Bearer '+process.env.GH_TOKEN},
      redirect:'manual',signal:AbortSignal.timeout(30000)});
    proof.priorLogHttpStatus=logResponse.status;
    let logBody=logResponse;
    if(logResponse.status===302) {
      const location=new URL(logResponse.headers.get('location'));
      assert(location.protocol==='https:' && (location.hostname.endsWith('.blob.core.windows.net')
        || location.hostname.endsWith('.actions.githubusercontent.com')
        || location.hostname==='objects.githubusercontent.com'),'UNEXPECTED_LOG_STORAGE');
      // A signed log URL is fetched without the GitHub Authorization header.
      proof.stage='fetch_prior_log_storage';
      logBody=await fetch(location,{redirect:'error',signal:AbortSignal.timeout(30000)});
    }
    proof.priorLogStorageHttpStatus=logBody.status;
    assert.equal(logBody.status,200,'PRIOR_LOG_UNAVAILABLE');
    const logText=await logBody.text();assert(logText.length<3000000,'PRIOR_LOG_TOO_LARGE');
    const lines=logText.split('\n').filter(x=>x.includes('"type":"native-quota-result"'));
    assert.equal(lines.length,1,'AMBIGUOUS_PRIOR_RESULT');
    proof.stage='parse_prior_log';
    const prior=JSON.parse(lines[0].slice(lines[0].indexOf('{')));
    const raw=JSON.stringify(prior,null,2)+'\n';
    proof.stage='verify_prior_log_hash';
    proof.priorSerializedSha256=createHash('sha256').update(raw).digest('hex');
    proof.priorContentSha256=evidenceContentHash(prior);
    assert.equal(proof.priorContentSha256,'73bc9bdea21529dcbdb455c0b16adc2e48a870fd0b9c1a206ccdad4eb094c2e1','PRIOR_ARTIFACT_CONTENT_CHANGED');
    proof.priorJobId=103566100793;
    proof.priorArtifactSha256=PRIOR_SHA256;
    proof.nativeQuotaRejection=verifyObservedNativeQuota(prior);
    proof.stage='read_protected_bindings';
    context=await prepareContext(proof);db=dbFor(context);
    proof.stage='read_prior_reservations';
    const rows=await db.rows();
    assert.equal(rows.length,10,'COMPLETION_REPLAY_OR_PRIOR_STATE_CHANGED');
    const expected=[
      ...prior.priorRetainedReservations.map(r=>({label:r.worker_instance_id.split(':').at(-1),
        model:r.model,generationId:r.generation_id,reservedNano:String(r.reserved_nano)})),
      ...prior.calls.map(c=>({label:c.label,model:c.model,
        generationId:c.settlementRequested.generationId,reservedNano:c.settlementRequested.reservedNano})),
    ];
    for(const item of expected) {
      const row=rows.find(r=>r.reservation_id===reservationId(item.label));
      assert(row && row.worker_instance_id===CAMPAIGN+':'+item.label && row.model===item.model
        && row.status==='uncertain' && row.settled_upper_nano===null
        && String(row.reserved_nano)===item.reservedNano
        && (row.generation_id??null)===item.generationId && Number(row.policy_revision)===2
        && /^[a-f0-9]{64}$/.test(row.request_sha),'PRIOR_ROW_NOT_SAFELY_TERMINAL');
    }
    proof.priorRows=rows;
    proof.previousDenialClosure=rows.find(r=>r.reservation_id===reservationId('denied'));
    proof.stage='read_native_controls';
    before=await readNativeState(context);checkNativeBudget(before.teamBudget);
    const list=await management(context,'/v1/api-keys?purpose=ai-gateway');
    assert(!list.apiKeys.some(k=>k.id===prior.testKeyId),'EXHAUSTED_TEST_KEY_STILL_PRESENT');
    assert.notEqual(before.key.id,prior.testKeyId,'RECOVERY_KEY_IS_EXHAUSTED_TEST_KEY');
    proof.recoveryKeyId=before.key.id;proof.exhaustedTestKeyAbsent=true;
    proof.productionSettingsBefore=settings(before);
    proof.priorReceipts=[];
    proof.stage='verify_prior_receipts';
    for(const old of [...prior.priorPaidReceipts,...prior.receipts]) {
      const receipt=await observedReceipt(context.gatewayKey,old.id,old.model);
      const row=rows.find(r=>r.generation_id===receipt.id);
      assert(row,'RECEIPT_ROW_MISSING');
      receipt.label=row.worker_instance_id.split(':').at(-1);
      receipt.coveredNano=receiptCoverageNano({reservedNano:String(row.reserved_nano)},
        {status:row.status,settledUpperNano:row.settled_upper_nano},receipt.costNano);
      proof.priorReceipts.push(receipt);
    }
    const quote=await freshQuote('openai/gpt-4o-mini');
    assert(rows.reduce((n,r)=>n+BigInt(r.reserved_nano),0n)+BigInt(quote.reservedNano)<=MAX_LIABILITY_NANO,
      'CAMPAIGN_LIABILITY_TOO_LARGE');
    proof.stage='run_single_recovery';
    await callProvider(context,db,context.gatewayKey,'recovery',quote);
    proof.nativeServiceRecoveryObserved=true;
    assert.equal(proof.calls.length,1,'UNREVIEWED_RECOVERY_CALL');
    const receipts=[...proof.priorReceipts,...proof.receipts];
    assert.equal(new Set(receipts.map(r=>r.id)).size,9,'RECEIPT_IDENTITY_NOT_UNIQUE');
    proof.verifiedReceiptCostNano=receipts.reduce((n,r)=>n+BigInt(r.costNano),0n).toString();
    proof.passed=true;
  } catch(error) { proof.error=safeError(error);proof.errorClass=error?.name;process.exitCode=1; }
  finally {
    if(context && before) {
      try {
        const after=await readNativeState(context);checkNativeBudget(after.teamBudget);
        assert.deepEqual(settings(after),settings(before),'PRODUCTION_SETTINGS_CHANGED');
        proof.productionSettingsAfter=settings(after);
        proof.teamBudgetAfter=budgetSummary(after.teamBudget);proof.productionControlsPreserved=true;
      } catch(error) {proof.finalControlError=safeError(error);proof.passed=false;process.exitCode=1;}
    }
    if(db) {
      try {
        proof.rows=await db.rows();
        assert(proof.rows.every(r=>r.status!=='reserved'),'OWN_ACTIVE_RESERVATION_REMAINS');
        if(proof.priorRows) {
          const order=rows=>[...rows].sort((a,b)=>a.reservation_id.localeCompare(b.reservation_id));
          assert.deepEqual(order(proof.rows.filter(r=>r.reservation_id!==reservationId('recovery'))),
            order(proof.priorRows),'PREVIOUS_RESERVATIONS_CHANGED');
          proof.previousRowsPreserved=true;
        }
        proof.activeOwnReservations=0;
        proof.fullCampaignReservedNano=proof.rows.reduce((n,r)=>n+BigInt(r.reserved_nano),0n).toString();
        assert(BigInt(proof.fullCampaignReservedNano)<=MAX_LIABILITY_NANO,'CAMPAIGN_LIABILITY_TOO_LARGE');
        proof.sharedPolicyAfter=await db.rpc('ivx_ai_budget_status');
        assert(proof.sharedPolicyAfter.enabled && proof.sharedPolicyAfter.dailyLimitNano==='200000000000'
          && Number(proof.sharedPolicyAfter.policyRevision)===2 && proof.sharedPolicyAfter.maxConcurrent===2,
          'SHARED_POLICY_CHANGED');
      }catch(error){proof.finalRowsError=safeError(error);proof.passed=false;process.exitCode=1;}
    }
    await emitProof(publicRecoveryProof(proof),'native-recovery');
  }
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
