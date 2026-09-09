import {expect,test} from 'bun:test';
test('doctor avoids restarting 112 recently observed idle patrols without certifying them',async()=>{
 const child=Bun.spawn([process.execPath,'-e',`
 import {mock} from 'bun:test';
 import {createHash} from 'node:crypto';
 process.env.RENDER_GIT_COMMIT='a'.repeat(40);
 const sha=process.env.RENDER_GIT_COMMIT, calls=[];
 const rows=Array.from({length:112},(_,i)=>({agentNumber:i+1,status:'IDLE',paused:false,disabled:false,heartbeatFresh:false}));
 const observations=rows.map(row=>{const summary='LANDING_P0_RESULT '+JSON.stringify({v:1,agent_number:row.agentNumber,production_sha:sha,status:'PASS',completed_at:new Date().toISOString()});return {task_id:'t'+row.agentNumber,assigned_agent_number:row.agentNumber,evidence:{source:'continuous-patrol:unit',summary,contentHash:createHash('sha256').update(summary).digest('hex'),createdAt:new Date().toISOString(),commitSha:sha}};});
 const snapshot={degraded:false,degradedDependencies:[],autonomous:{schedulerEnabled:true,dispatcherPaused:false,emergencyStop:false},agents:{rows,counts:{total:112,working:0,freshHeartbeat:0,stale:0,blocked:0,unknown:0}},certification:{continuousRuntimeCertified:false}};
 mock.module('./backend/services/ivx-agent-runtime.ts',()=>({getAllExecutionStates:()=>[],resumeAgent:()=>calls.push('resume')}));
 mock.module('./backend/services/ivx-campaign-dispatcher.ts',()=>({campaignDispatcherControl:async()=>calls.push('retry')}));
 mock.module('./backend/services/ivx-autonomous-truth-control.ts',()=>({getAutonomousTruthSnapshot:async()=>snapshot,enforceAutonomous112RuntimeTruth:async()=>{calls.push('enforce');return {};}}));
 mock.module('./backend/services/ivx-autonomous-work-manager.ts',()=>({IVX_AUTONOMOUS_FLEET_SIZE:112,ensureAutonomousManagerBacklog:async()=>{calls.push('backlog');return {ok:true};}}));
 mock.module('./backend/services/ivx-autonomous-learning-engine.ts',()=>({observeAndLearn:async()=>({action:'observed'})}));
 mock.module('./backend/services/ivx-autonomous-control-policy.ts',()=>({autonomousDoctorRepairEnabled:()=>true,autonomousRepairCapacity:()=>112}));
 mock.module('./backend/services/ivx-postgres-autonomous-task-store.ts',()=>({postgresAtomicQueueSelected:()=>true,readPostgresPatrolObservations:async()=>observations}));
 const m=await import('./backend/services/ivx-autonomous-doctor.ts');
 await m.runAutonomousDoctorCycle();
 const status=m.getAutonomousDoctorStatus();
 if(calls.length||status.totalRepairs!==0||status.lastCertification.certified!==false||status.recentPatrolAgents!==112||!status.lastHealthyAt)throw Error(JSON.stringify({calls,status}));
 `],{cwd:new URL('../',import.meta.url).pathname,stdout:'pipe',stderr:'pipe',timeout:5000});
 const [code,err]=await Promise.all([child.exited,new Response(child.stderr).text()]);expect(err).toBe('');expect(code).toBe(0);
});
