import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyObservedNativeQuota, publicRecoveryProof, evidenceContentHash } from './phase3-native-recovery.mjs';
import { reservationId } from './phase3-native-quota.mjs';

function fixture() {
  const key='synthetic_credential_identifier';
  const calls=[6,7,8,9].map(i=>({label:'fill'+i,reservationId:reservationId('fill'+i),
    providerHttpAttempts:1,admissions:1,statuses:[200],settlement:{status:'uncertain',
      settledUpperNano:null,generationId:'synthetic-generation-'+i}}));
  const receipts=[6,7,8,9].map(i=>({label:'fill'+i,id:'synthetic-generation-'+i,costNano:'295185000'}));
  calls.push({label:'denied',reservationId:reservationId('denied'),providerHttpAttempts:1,admissions:1,
    statuses:[402],quotaErrors:[{status:402,type:'quota_for_entity_exceeded',message:'API key budget exceeded.'}]});
  return {sourceSha:'d572ca0df73250b98d346aff6e2b03d6d11e86eb',runId:'34698467674',
    testKeyId:key,testKeyDeleted:true,productionControlsPreserved:true,calls,receipts,
    quotaSnapshots:[{quotaEntityId:'api_key_id_'+key,scopeId:key,active:true,archived:false,
      limitAmount:1,currentSpend:1.18074}],passed:false};
}
test('evidence checksum ignores object key ordering but preserves values and array order',()=>{
  const one={a:{x:1,y:2},z:[3,4]};
  assert.equal(evidenceContentHash(one),evidenceContentHash({z:[3,4],a:{y:2,x:1}}));
  assert.notEqual(evidenceContentHash(one),evidenceContentHash({a:{x:1,y:3},z:[3,4]}));
  assert.notEqual(evidenceContentHash(one),evidenceContentHash({a:{x:1,y:2},z:[4,3]}));
  assert.notEqual(evidenceContentHash(one),evidenceContentHash({a:{x:1,y:2},z:[3,4],extra:true}));
});
test('native proof rejects local refusal, scope mismatch, replay and uncovered liability',()=>{
  assert.equal(verifyObservedNativeQuota(fixture()).httpStatus,402);
  for(const mutate of [
    p=>p.calls.at(-1).statuses=[429],p=>p.calls.at(-1).providerHttpAttempts=2,
    p=>p.calls.at(-1).quotaErrors[0].type='insufficient_funds',
    p=>p.calls.at(-1).quotaErrors[0].message='Team budget exceeded.',
    p=>p.quotaSnapshots.at(-1).scopeId='another-key',p=>p.quotaSnapshots.at(-1).currentSpend=0,
    p=>p.receipts[0].costNano='900000000',p=>p.receipts[0].id=p.receipts[1].id,
    p=>p.testKeyDeleted=false,p=>p.productionControlsPreserved=false,
  ]) {const copy=fixture();mutate(copy);assert.throws(()=>verifyObservedNativeQuota(copy));}
});
test('public proof excludes bindings, credential IDs, raw rows and raw provider errors',()=>{
  const secret='synthetic-private-identifier';
  const result=publicRecoveryProof({passed:false,teamId:secret,recoveryKeyId:secret,endpoints:[secret],
    priorRows:[{worker_instance_id:secret}],rows:[{generation_id:secret}],
    productionSettingsBefore:{keyId:secret},error:'unexpected '+secret,
    receipts:[{id:secret,model:'fixture/model',costNano:'100'}],
    nativeQuotaRejection:verifyObservedNativeQuota(fixture()),
    calls:[{label:'recovery',model:'openai/gpt-4o-mini',admissions:1,providerHttpAttempts:1,statuses:[200],
      quotaErrors:[secret],settlement:{status:'uncertain',generationId:secret,reservedNano:'1000'},
      settlementConfirmation:'rpc_ack'}]});
  assert(!JSON.stringify(result).includes(secret));
  assert(!JSON.stringify(result).includes('synthetic_credential_identifier'));
  assert.equal(result.passed,false);assert.equal(result.calls[0].settlementConfirmed,true);
  assert.equal(result.receiptCount,1);assert.equal(result.error,'NATIVE_RECOVERY_CHECK_FAILED');
  assert.equal(result.nativeSameKeyQuotaIncreaseTested,false);assert.equal(result.providerMaximumConcurrency,null);
});
