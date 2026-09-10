import {expect,test} from 'bun:test';
test('112-lane proof accepts two fenced workers and rejects missing identity, stale/future heartbeat or unstarted work',async()=>{
 const child=Bun.spawn([process.execPath,'-e',`
 import {mock} from 'bun:test';
 const sha='a'.repeat(40), now=Date.now();
 const rows=Array.from({length:112},(_,i)=>({taskId:'t'+i,idempotencyKey:'patrol:'+sha+':'+i,state:'RUNNING',assignedAgentNumber:i+1,leaseHolder:'agent:ivx_holdings_'+(i+1),workerInstanceId:i%2?'worker-a':'worker-b',lastHeartbeatAt:new Date(now-1000).toISOString(),leaseExpiresAt:new Date(now+60000).toISOString()}));
 mock.module('./backend/services/ivx-autonomous-task-engine.ts',()=>({getAllTasks:async()=>[],recordLeasedTaskEvidence:()=>{},releaseLease:()=>{}}));
 mock.module('./backend/services/ivx-landing-p0-backlog.ts',()=>({encodeLandingResult:()=>'',LANDING_P0_PATROL_PREFIX:'patrol:',LANDING_P0_PREFIX:'task:',LANDING_P0_REPAIR_PREFIX:'repair:',landingPatrolUnitFor:()=>{},parseLandingPatrolTaskKey:()=>{},resolveProductionSha:()=>sha}));
 mock.module('./backend/services/ivx-landing-p0-executor.ts',()=>({executeLandingUnit:()=>{}}));
 mock.module('./backend/services/ivx-postgres-autonomous-task-store.ts',()=>({postgresAtomicQueueSelected:()=>true,readPostgresFleetLeaseRows:async()=>rows}));
 const m=await import('./backend/services/ivx-landing-continuous-patrol.ts');
 const valid=await m.buildLandingFleetProof(sha,now);if(!valid.exact112Working||valid.workerIdentities!==2)throw Error('Valid HA fleet rejected');
 for(const mutation of [{workerInstanceId:null},{lastHeartbeatAt:new Date(now+1000).toISOString()},{lastHeartbeatAt:new Date(now-61000).toISOString()},{state:'LEASED'},{assignedAgentNumber:2}]){
  const original={...rows[0]};Object.assign(rows[0],mutation);
  if((await m.buildLandingFleetProof(sha,now)).exact112Working)throw Error('Invalid proof accepted '+JSON.stringify(mutation));
  Object.assign(rows[0],original);
 }
 `],{cwd:new URL('../',import.meta.url).pathname,stdout:'pipe',stderr:'pipe',timeout:5000});
 const [code,err]=await Promise.all([child.exited,new Response(child.stderr).text()]);expect(err).toBe('');expect(code).toBe(0);
});
