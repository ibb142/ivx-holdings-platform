import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureIdentity, claimSql, assertConcurrentClaims } from './phase1-lease-production.mjs';
const fixture = fixtureIdentity('12345678-1234-1234-1234-123456789abc');
const a = { pid: 101, result: [{ ok: true, task: { taskId: fixture.id } }] };
const b = { pid: 202, observedHolderPid: 101, result: [{ ok: true, task: null, claimContended: true }] };
test('only observed contention across distinct DB processes can pass', () => assertConcurrentClaims(a,b,fixture.id));
test('sequential exclusion cannot substitute for concurrency proof', () => assert.throws(() => assertConcurrentClaims(a,{...b,result:[{ok:true,task:null}]},fixture.id)));
test('two winning leases fail acceptance', () => assert.throws(() => assertConcurrentClaims(a,{...b,result:a.result},fixture.id)));
test('same PID and an unrelated fixture fail acceptance', () => {
  assert.throws(() => assertConcurrentClaims(a,{...b,pid:101},fixture.id));
  assert.throws(() => assertConcurrentClaims(a,b,'another-task'));
});
test('untrusted identities cannot become SQL fixture selectors', () => assert.throws(() => fixtureIdentity("'; delete from public.ivx_autonomous_tasks;--")));
test('production fixture is claimed before commit and fallback excludes other missions', () => {
  const query=claimSql(fixture);
  assert(query.indexOf('ivx_autonomous_tasks_claim_batch') < query.indexOf('commit;'));
  assert(query.includes('"familyPrefixes":[""]'));
  assert(query.includes('"activePrefixes":["'+fixture.id+'"]'));
});
