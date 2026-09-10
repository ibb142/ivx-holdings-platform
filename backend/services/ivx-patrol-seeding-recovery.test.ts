import { expect, test } from 'bun:test';

test('patrol seed reads existing identities without locking 112 existing tasks', async () => {
  const child=Bun.spawn([process.execPath,'-e',`
    import {mock} from 'bun:test';
    const sha='a'.repeat(40);
    let creates=0, missing=false;
    mock.module('./backend/services/ivx-postgres-autonomous-task-store.ts',()=>({
      postgresAtomicQueueSelected:()=>true,
      readPostgresTaskIdentitiesByPrefix:async()=>Array.from({length:missing?111:112},(_,i)=>({
        taskId:'t'+i,idempotencyKey:'landing-p0-patrol:'+sha+':ia-'+String(i+1).padStart(3,'0'),state:'RUNNING'
      }))
    }));
    mock.module('./backend/services/ivx-autonomous-task-engine.ts',()=>({
      createTask:()=>{}, taskProgressRank:()=>0, TERMINAL_SUCCESS_STATES:['VERIFIED'],
      getAllTasks:()=>{throw Error('full ledger read');},
      createTasksBatch:async(rows)=>{creates++;if(rows.length!==1||rows[0].assignedAgentNumber!==112)throw Error('existing tasks were locked again');
        return rows.map(task=>({ok:true,duplicate:false,task}));}
    }));
    mock.module('./backend/services/ivx-agent-runtime.ts',()=>({getAllExecutionStates:()=>[]}));
    mock.module('./backend/services/ivx-landing-github-read.ts',()=>({fetchLandingGitHubRead:()=>{}}));
    const m=await import('./backend/services/ivx-landing-p0-backlog.ts');
    const a=await m.seedLandingP0Patrol(sha);
    if(a.error||a.existing!==112||creates!==0)throw Error(JSON.stringify(a));
    missing=true;
    const b=await m.seedLandingP0Patrol(sha);
    if(b.error||b.existing!==111||b.created!==1||creates!==1)throw Error(JSON.stringify(b));
  `],{cwd:new URL('../../',import.meta.url).pathname,stdout:'pipe',stderr:'pipe',timeout:10000});
  const [code,err]=await Promise.all([child.exited,new Response(child.stderr).text()]);
  expect(err).toBe('');expect(code).toBe(0);
});

test('seed outage does not prevent claims of already durable current-mission work',async()=>{
  const child=Bun.spawn([process.execPath,'-e',`
    import {mock} from 'bun:test';
    let claims=0;
    const state={agentId:'ivx_holdings_1',agentNumber:1,pauseState:false,disabledState:false,health:'healthy',availability:'available',activeTaskId:null};
    mock.module('./backend/services/ivx-autonomous-truth-control.ts',()=>({
      IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS:30000,
      enforceAutonomous112RuntimeTruth:async()=>({ok:false,recovered:[],action:'verified',snapshot:{autonomous:{dispatcherPaused:false,emergencyStop:false},agents:{counts:{}}}})
    }));
    mock.module('./backend/services/ivx-agent-runtime.ts',()=>({getAllExecutionStates:()=>[state],updateExecutionState:()=>{}}));
    mock.module('./backend/services/ivx-agent-real-engineering-cycle.ts',()=>({runRealEngineeringCycle:()=>{}}));
    mock.module('./backend/services/ivx-autonomous-task-engine.ts',()=>({
      getAllTasks:async()=>[],heartbeatTasksBatch:async()=>({refreshed:0}),
      leaseNextTasksBatch:async(requests)=>{claims++;if(requests[0].options.missionScope.activePrefixes.length!==3)throw Error('mission fencing lost');return [];},
      startLeasedTasksBatch:async()=>[],
      releaseLease:async()=>{throw Error('no lease was claimed');}
    }));
    mock.module('./backend/services/ivx-autonomous-work-manager.ts',()=>({ensureAutonomousManagerBacklog:async()=>{},getAutonomousWorkManagerStatus:()=>({})}));
    mock.module('./backend/services/ivx-autonomous-decision-quality.ts',()=>({getAutonomousDecisionQualityStatus:()=>({}),runAutonomousDecisionQualityLoop:async()=>{}}));
    mock.module('./backend/services/ivx-autonomous-semantic-360.ts',()=>({getAutonomousSemantic360Status:()=>({}),runAutonomousSemantic360:async()=>{}}));
    mock.module('./backend/services/ivx-autonomous-control-policy.ts',()=>({autonomousRuntimeEnforcerEnabled:()=>true}));
    mock.module('./backend/services/ivx-postgres-autonomous-task-store.ts',()=>({
      postgresAtomicQueueSelected:()=>true,autonomousWorkerInstanceId:()=>'test',
      readPostgresFleetLeaseRows:async()=>[],releasePostgresWorkerInstanceTasks:async()=>0
    }));
    mock.module('./backend/services/ivx-landing-p0-backlog.ts',()=>({
      ensureLandingP0BacklogSeeded:async()=>({error:'query timeout'}),
      ensureLandingP0PatrolSeeded:async()=>({error:'deadlock detected'}),
      isLandingPatrolTask:()=>false,isLandingP0MissionActive:async()=>true,
      LANDING_P0_PATROL_PREFIX:'landing-p0-patrol:',LANDING_P0_PREFIX:'landing-p0:',LANDING_P0_REPAIR_PREFIX:'landing-p0-repair:'
    }));
    mock.module('./backend/services/ivx-landing-continuous-patrol.ts',()=>({
      getLandingPatrolIntervalMs:()=>60000,getLandingPatrolLiveStates:()=>[],
      IVX_LANDING_CONTINUOUS_PATROL_MARKER:'test',runLandingPatrolSession:async()=>{}
    }));
    const realTimeout=setTimeout;
    globalThis.setTimeout=(fn,ms,...args)=>realTimeout(fn,ms===5000?5:ms,...args);
    const m=await import('./backend/services/ivx-autonomous-runtime-enforcer.ts');
    m.startAutonomous112RuntimeEnforcer();
    await new Promise(r=>realTimeout(r,100));
    await m.stopAutonomous112RuntimeEnforcer();
    if(claims<1)throw Error('existing work starved by seed outage');
  `],{cwd:new URL('../../',import.meta.url).pathname,stdout:'pipe',stderr:'pipe',timeout:10000});
  const [code,err]=await Promise.all([child.exited,new Response(child.stderr).text()]);
  expect(err).not.toContain('existing work starved');expect(code).toBe(0);
});
