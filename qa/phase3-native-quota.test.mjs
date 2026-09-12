import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMPAIGN,LABELS,MAX_LIABILITY_NANO,reservationId,checkQuote,checkTestKeyIdentity,receiptCoverageNano } from './phase3-native-quota.mjs';

test('durable reservation identities cannot change with a workflow replay',()=>{
  const before=LABELS.map(reservationId),old=process.env.GITHUB_RUN_ATTEMPT;
  process.env.GITHUB_RUN_ATTEMPT='9999';
  try { assert.deepEqual(LABELS.map(reservationId),before); }
  finally { if(old===undefined)delete process.env.GITHUB_RUN_ATTEMPT;else process.env.GITHUB_RUN_ATTEMPT=old; }
  assert.equal(new Set(before).size,LABELS.length);
  assert(before.every(id=>/^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/.test(id)));
  assert.throws(()=>reservationId('unreviewed-extra-fill'));
});
test('financial envelope refuses oversized, expired and unsupported quotes',()=>{
  const now=Date.parse('2026-09-12T12:00:00Z');
  const q={model:'openai/gpt-4o',reservedNano:'822728000',catalogSha256:'a'.repeat(64),
    observedAt:new Date(now).toISOString(),validUntil:new Date(now+300000).toISOString()};
  checkQuote(q,now);
  assert.throws(()=>checkQuote({...q,reservedNano:'1000000001'},now));
  assert.throws(()=>checkQuote({...q,model:'unreviewed/model'},now));
  assert.throws(()=>checkQuote(q,now+300000));
  assert.throws(()=>checkQuote({...q,catalogSha256:''},now));
  assert.throws(()=>checkQuote({...q,reservedNano:'0'},now));
  assert(MAX_LIABILITY_NANO<200000000000n);
  assert.equal(CAMPAIGN,'phase3-native-quota-20260912-01');
});

test('cleanup verifies key ownership without requiring an active hydrated quota',()=>{
  const id='isolated-key';
  const key={id,name:CAMPAIGN,purpose:'ai-gateway',teamId:'team_fEfCJAenMBXVSGiX6LeoA3Ji'};
  checkTestKeyIdentity(key,id);
  checkTestKeyIdentity({...key,quota:{active:false}},id);
  assert.throws(()=>checkTestKeyIdentity({...key,teamId:'different-team'},id));
  assert.throws(()=>checkTestKeyIdentity({...key,name:'production-key'},id));
  assert.throws(()=>checkTestKeyIdentity({...key,metadata:{bypassAll:true}},id));
});

test('late receipts require full retained liability or an adequate settled bound',()=>{
  const q={reservedNano:'822728000'};
  assert.equal(receiptCoverageNano(q,{status:'uncertain',settledUpperNano:null},'200000000'),'822728000');
  assert.equal(receiptCoverageNano(q,{status:'settled',settledUpperNano:'350000000'},'200000000'),'350000000');
  assert.throws(()=>receiptCoverageNano(q,{status:'uncertain',settledUpperNano:'0'},'200000000'));
  assert.throws(()=>receiptCoverageNano(q,{status:'cancelled',settledUpperNano:'0'},'200000000'));
  assert.throws(()=>receiptCoverageNano(q,{status:'settled',settledUpperNano:'100000000'},'200000000'));
  assert.throws(()=>receiptCoverageNano(q,{status:'uncertain',settledUpperNano:null},'822728001'));
  assert.throws(()=>receiptCoverageNano(q,{status:'uncertain',settledUpperNano:null},'0'));
});
