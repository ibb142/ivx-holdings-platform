import {test,expect} from 'bun:test';
import {createCandidateStore,type CandidateLesson,type CandidateQuery} from './ivx-candidate-store';
const token='00000000-0000-4000-8000-000000000001';
const candidate: CandidateLesson={eventId:'event',agentId:'IA-10',taskType:'qa',rootCause:'Observed failure',
  hypothesis:'Proposed check',gitSha:'abcdef'.repeat(6)+'abcd',version:1};

test('input validation runs before checkout, including INT overflow and null text',async()=>{
  let calls=0;const store=createCandidateStore(async()=>{calls++;throw Error('unexpected database call');});
  for(const version of [-1,1.5,2147483648,NaN])expect((await store.acquireLock('event','worker',version,1000)).acquired).toBe(false);
  for(const ttl of [0,-1,300001,NaN])expect((await store.acquireLock('event','worker',1,ttl)).acquired).toBe(false);
  for(const change of [{rootCause:null},{hypothesis:' \t'},{eventId:''},{version:-1},{gitSha:'G'.repeat(40)}])
    expect((await store.saveCandidateWithLease({...candidate,...change} as CandidateLesson,'worker',token)).success).toBe(false);
  expect(calls).toBe(0);
});
test('native acquisition tokens are unique and only bound parameters contain caller values',async()=>{
  const calls: unknown[][]=[];const store=createCandidateStore(async(sql,values)=>{
    expect(sql).not.toContain("event'quoted");calls.push(values);
    return {rows:[{result:{acquired:true,token:values[3],version:1,expiresAt:'2030-01-01T00:00:00Z'}}]};
  });
  await store.acquireLock("event'quoted",'worker',1,1000);await store.acquireLock('event','worker',1,1000);
  expect(calls[0][3]).not.toBe(calls[1][3]);expect(calls[0][3]).toMatch(/^[a-f0-9-]{36}$/);
});
test('all hexadecimal letters are accepted and evidence is normalized without mutating the caller',async()=>{
  const c={...candidate,gitSha:'BCDEF'.repeat(8),rootCause:'  observed  ',hypothesis:'\n proposed \t'};
  const before=JSON.stringify(c);const store=createCandidateStore(async(sql,values)=>{
    const v=JSON.parse(String(values[0]));expect(v.gitSha).toBe(c.gitSha.toLowerCase());expect(v.rootCause).toBe('observed');
    expect(v.hypothesis).toBe('proposed');return {rows:[{result:{success:true,duplicate:false}}]};
  });
  expect((await store.saveCandidateWithLease(c,'worker',token)).success).toBe(true);expect(JSON.stringify(c)).toBe(before);
});
test('ambiguous database failures are not retried or exposed as success and do not leak provider messages',async()=>{
  let calls=0;const store=createCandidateStore(async()=>{calls++;throw new Error('secret connection password PRIVATE');});
  const r=await store.saveCandidateWithLease(candidate,'worker',token);
  expect(r.success).toBe(false);expect(r).toHaveProperty('outcomeUnknown',true);expect(JSON.stringify(r)).not.toContain('PRIVATE');expect(calls).toBe(1);
});
test('server rejection preserves only SQLSTATE and never hides failure behind an audit write',async()=>{
  let calls=0;const store=createCandidateStore(async()=>{calls++;throw Object.assign(Error('private row'),{code:'55P03'});});
  const r=await store.acquireLock('event','worker',1,1000);expect(r).toEqual({acquired:false,errorType:'CANDIDATE_DATABASE_REJECTED',sqlState:'55P03',outcomeUnknown:false});expect(calls).toBe(1);
});
test('failure history requires a bounded phase, safe reason code and explicit attempt',async()=>{
  let calls=0;const store=createCandidateStore(async(sql,values)=>{calls++;expect(values).toEqual(['event','SAVE','LEASE_EXPIRED',2]);return {rows:[{result:{success:true,failureId:'7'}}]};});
  expect((await store.recordPhaseFailure('event','SAVE','raw error with private data',2)).success).toBe(false);
  expect((await store.recordPhaseFailure('event','SAVE','LEASE_EXPIRED',-1)).success).toBe(false);
  expect(await store.recordPhaseFailure('event','SAVE','LEASE_EXPIRED',2)).toEqual({success:true,failureId:'7'});expect(calls).toBe(1);
});
test('an absent or malformed database acknowledgement remains an unknown outcome',async()=>{
  for(const rows of [[],[{result:null}],[{result:{success:'yes'}}],[{result:{success:true}}]]) {
    const store=createCandidateStore((async()=>({rows})) as CandidateQuery);
    expect(await store.saveCandidateWithLease(candidate,'worker',token)).toHaveProperty('outcomeUnknown',true);
  }
});
