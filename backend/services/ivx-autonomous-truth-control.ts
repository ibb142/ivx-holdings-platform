import { getAllExecutionStates, pauseAgent, resumeAgent, disableAgent, enableAgent } from './ivx-agent-runtime';
import { campaignDispatcherControl, getCampaignDispatcherSnapshot, listCampaignDispatcherRecords, runCampaignBootRecovery, startCampaignDispatcher } from './ivx-campaign-dispatcher';
import { loadControlState, syncCampaignAssignmentsToDispatcher, updateControlState } from './ivx-app-completion-campaign';
import { getGitHubActionsExternalSupervisorStatus } from './ivx-github-actions-external-supervisor';
import { getSchedulerState, setSchedulerEnabled } from './ivx-autonomous-scheduler';
import { getAllTasks, type Task } from './ivx-autonomous-task-engine';

export const IVX_AUTONOMOUS_TRUTH_CONTROL_MARKER = 'ivx-autonomous-truth-control-2026-09-05-v10-self-start';
export const IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS = 60 * 1000;
export const IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS = 30 * 1000;
export const IVX_AUTONOMOUS_CASCADE_SEED_SIZE = 10;
export const IVX_AUTONOMOUS_CASCADE_FANOUT = 10;
export const IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS = 2_500;

const TASK_ENGINE_ACTIVE_STATES = new Set([
  'LEASED', 'RUNNING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS',
  'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING',
]);

export type TruthControlAction = 'start_all'|'stop_all'|'pause_all'|'resume_all'|'pause_agent'|'resume_agent'|'disable_agent'|'enable_agent'|'retry_agent';

type BoundedDependency<T> = { value: T | null; error: string | null };

function heartbeatAgeMs(value: string | null): number | null { if (!value) return null; const ts=Date.parse(value); return Number.isFinite(ts)?Math.max(0,Date.now()-ts):null; }
function heartbeatFresh(value: string | null): boolean { const age=heartbeatAgeMs(value); return age!==null&&age<=IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS; }
function taskHeartbeat(task: Task | undefined): string | null { return task?.lastHeartbeatAt ?? null; }

async function boundedDependency<T>(label: string, task: Promise<T>): Promise<BoundedDependency<T>> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}_timeout_${IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS}ms`)), IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS);
    });
    const value = await Promise.race([task, timeout]);
    return { value, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[IVXAutonomousTruth] dependency degraded:', { label, message: message.slice(0, 220) });
    return { value: null, error: message.slice(0, 220) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function cascadeStartAllAgents(): Promise<{seedAgents:number[]; activated:number[]; waves:number[][]}> {
  const states = [...getAllExecutionStates()].sort((a,b)=>a.agentNumber-b.agentNumber);
  const eligible = states.filter((state)=>!state.disabledState);
  const activated = new Set<number>();
  const waves: number[][] = [];
  const seedAgents = eligible.slice(0, IVX_AUTONOMOUS_CASCADE_SEED_SIZE).map((state)=>state.agentNumber);
  let frontier = [...seedAgents];

  while(frontier.length > 0 && activated.size < eligible.length){
    const wave: number[] = [];
    for(const parentNumber of frontier){
      const parent = eligible.find((state)=>state.agentNumber===parentNumber);
      if(parent && !activated.has(parentNumber)){
        resumeAgent(parent.agentId);
        await campaignDispatcherControl('retry_agent', parentNumber).catch(()=>undefined);
        activated.add(parentNumber);
        wave.push(parentNumber);
      }

      const children = eligible
        .filter((state)=>!activated.has(state.agentNumber) && !frontier.includes(state.agentNumber))
        .slice(0, IVX_AUTONOMOUS_CASCADE_FANOUT);
      for(const child of children){
        resumeAgent(child.agentId);
        await campaignDispatcherControl('retry_agent', child.agentNumber).catch(()=>undefined);
        activated.add(child.agentNumber);
        wave.push(child.agentNumber);
      }
    }
    if(wave.length===0) break;
    waves.push(wave);
    frontier = wave.filter((n)=>!seedAgents.includes(n));
  }

  for(const state of eligible){
    if(!activated.has(state.agentNumber)){
      resumeAgent(state.agentId);
      await campaignDispatcherControl('retry_agent',state.agentNumber).catch(()=>undefined);
      activated.add(state.agentNumber);
      waves.push([state.agentNumber]);
    }
  }

  await campaignDispatcherControl('resume_all');
  return {seedAgents, activated:[...activated].sort((a,b)=>a-b), waves};
}

export async function getAutonomousTruthSnapshot() {
  startCampaignDispatcher();

  const [dispatcherResult,schedulerResult,dispatcherRecordsResult,tasksResult]=await Promise.all([
    boundedDependency('dispatcher_snapshot', Promise.resolve(getCampaignDispatcherSnapshot())),
    boundedDependency('scheduler_state', Promise.resolve(getSchedulerState())),
    boundedDependency('dispatcher_records', Promise.resolve(listCampaignDispatcherRecords())),
    boundedDependency('task_engine', Promise.resolve(getAllTasks())),
  ]);

  const dispatcher = dispatcherResult.value ?? {
    paused: true,
    emergencyStop: false,
    totals: { pendingOwner:0, awaitingImplement:0, queued:0, running:0, completed:0, failed:0, blocked:0 },
    maxConcurrency: 0,
  };
  const scheduler=schedulerResult.value;
  const dispatcherRecords=dispatcherRecordsResult.value ?? [];
  const tasks=tasksResult.value ?? [];
  const degradedDependencies = [
    dispatcherResult.error ? 'dispatcher_snapshot' : null,
    schedulerResult.error ? 'scheduler_state' : null,
    dispatcherRecordsResult.error ? 'dispatcher_records' : null,
    tasksResult.error ? 'task_engine' : null,
  ].filter((value): value is string => Boolean(value));

  const github=getGitHubActionsExternalSupervisorStatus(); const states=getAllExecutionStates();
  const runningByAgent=new Map<number,(typeof dispatcherRecords)[number]>();
  for(const record of dispatcherRecords) if(record.status==='RUNNING'&&record.workerJobId) runningByAgent.set(record.agentNumber,record);

  const activeTaskByAgent=new Map<number,Task>();
  for(const task of tasks){
    if(task.assignedAgentNumber==null || !TASK_ENGINE_ACTIVE_STATES.has(task.state)) continue;
    const current=activeTaskByAgent.get(task.assignedAgentNumber);
    const currentTs=Date.parse(taskHeartbeat(current)??'');
    const nextTs=Date.parse(taskHeartbeat(task)??'');
    if(!current || (!Number.isFinite(currentTs) || (Number.isFinite(nextTs)&&nextTs>currentTs))) activeTaskByAgent.set(task.assignedAgentNumber,task);
  }

  const agents=states.map((state)=>{
    const runtimeAgeMs=heartbeatAgeMs(state.lastHeartbeat); const runtimeHeartbeatFresh=heartbeatFresh(state.lastHeartbeat);
    const dispatcherRecord=runningByAgent.get(state.agentNumber); const dispatcherHeartbeat=dispatcherRecord?.lastHeartbeatAt??null;
    const dispatcherAgeMs=heartbeatAgeMs(dispatcherHeartbeat); const dispatcherHeartbeatFresh=heartbeatFresh(dispatcherHeartbeat);
    const taskRecord=activeTaskByAgent.get(state.agentNumber); const taskEngineHeartbeat=taskHeartbeat(taskRecord);
    const taskEngineAgeMs=heartbeatAgeMs(taskEngineHeartbeat); const taskEngineHeartbeatFresh=heartbeatFresh(taskEngineHeartbeat);
    const runtimeWorking=state.availability==='busy'&&Boolean(state.activeTaskId)&&runtimeHeartbeatFresh;
    const dispatcherWorking=Boolean(dispatcherRecord?.workerJobId&&dispatcherRecord.status==='RUNNING'&&dispatcherHeartbeatFresh);
    const taskEngineWorking=Boolean(taskRecord?.taskId&&taskRecord?.leaseHolder&&taskEngineHeartbeatFresh);
    const actuallyWorking=runtimeWorking||dispatcherWorking||taskEngineWorking;
    const blocked=state.pauseState||state.disabledState||state.availability==='offline'||state.health==='failed';
    const hasClaimedWork=Boolean(state.activeTaskId||dispatcherRecord?.workerJobId||taskRecord?.taskId);
    const anyHeartbeatFresh=runtimeHeartbeatFresh||dispatcherHeartbeatFresh||taskEngineHeartbeatFresh;
    const stale=!actuallyWorking&&!blocked&&hasClaimedWork&&!anyHeartbeatFresh;
    const idle=!actuallyWorking&&!blocked&&!stale&&state.availability==='available';
    const ages=[runtimeAgeMs,dispatcherAgeMs,taskEngineAgeMs].filter((age):age is number=>age!==null);
    return {
      agentId:state.agentId,
      agentNumber:state.agentNumber,
      status:actuallyWorking?'WORKING':blocked?'BLOCKED':stale?'STALE':idle?'IDLE':'UNKNOWN',
      actuallyWorking,
      proofSource:runtimeWorking?'agent_runtime':dispatcherWorking?'campaign_dispatcher':taskEngineWorking?'autonomous_task_engine':null,
      activeTaskId:taskRecord?.taskId??state.activeTaskId??dispatcherRecord?.workerJobId??null,
      dutyId:dispatcherRecord?.dutyId??null,
      module:taskRecord?.title??dispatcherRecord?.module??null,
      workerJobId:dispatcherRecord?.workerJobId??null,
      workerStatus:dispatcherRecord?.workerStatus??null,
      availability:state.availability,
      health:state.health,
      queueDepth:state.queueDepth,
      paused:state.pauseState,
      disabled:state.disabledState,
      lastHeartbeat:state.lastHeartbeat,
      dispatcherHeartbeat,
      taskEngineHeartbeat,
      heartbeatFresh:anyHeartbeatFresh,
      heartbeatAgeMs:ages.length?Math.min(...ages):null,
      totalRuns:state.totalRuns,
      successfulRuns:state.successfulRuns,
      failedRuns:state.failedRuns,
      evidenceCount:state.evidenceCount,
    };
  });
  const counts={total:agents.length,working:agents.filter(a=>a.status==='WORKING').length,idle:agents.filter(a=>a.status==='IDLE').length,blocked:agents.filter(a=>a.status==='BLOCKED').length,stale:agents.filter(a=>a.status==='STALE').length,unknown:agents.filter(a=>a.status==='UNKNOWN').length,freshHeartbeat:agents.filter(a=>a.heartbeatFresh).length};
  const taskEngineRunning=activeTaskByAgent.size;
  const autonomousWorking=Boolean(scheduler?.enabled&&!dispatcher.paused&&!dispatcher.emergencyStop&&(dispatcher.totals.running>0||dispatcher.totals.queued>0||taskEngineRunning>0));
  const totalDevelopmentJobs=dispatcher.totals.pendingOwner+dispatcher.totals.awaitingImplement+dispatcher.totals.queued+dispatcher.totals.running+dispatcher.totals.completed+dispatcher.totals.failed+dispatcher.totals.blocked;
  const completionPercent=totalDevelopmentJobs>0?Math.round((dispatcher.totals.completed/totalDevelopmentJobs)*10000)/100:0;
  const activeAgentPercent=agents.length>0?Math.round((counts.working/agents.length)*10000)/100:0;
  const continuousRuntimeCertified=degradedDependencies.length===0&&agents.length===112&&counts.working===112&&counts.stale===0&&counts.blocked===0&&counts.unknown===0&&counts.freshHeartbeat===112&&autonomousWorking;
  return {
    ok:agents.length===112,
    marker:IVX_AUTONOMOUS_TRUTH_CONTROL_MARKER,
    generatedAt:new Date().toISOString(),
    degraded:degradedDependencies.length>0,
    degradedDependencies,
    truthPolicy:{
      heartbeatFreshMs:IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS,
      dependencyTimeoutMs:IVX_AUTONOMOUS_TRUTH_DEPENDENCY_TIMEOUT_MS,
      workingRequiresOneOf:[
        'agent runtime busy + activeTaskId + heartbeat <=60s',
        'dispatcher RUNNING + real workerJobId + dispatcher heartbeat <=60s',
        'autonomous task-engine active task + leaseHolder + real lastHeartbeatAt <=60s',
      ],
      noInferenceFromGithubActions:true,
      noInferenceFromContinuityPromiseCount:true,
      noInferenceFromTaskUpdatedAt:true,
      noSyntheticWorkingStatus:true,
      staleFailsClosed:true,
      dependencyFailureFailsClosedWithoutTurningTruthEndpointIntoA500:true,
      cascadeActivation:{seedSize:IVX_AUTONOMOUS_CASCADE_SEED_SIZE,fanout:IVX_AUTONOMOUS_CASCADE_FANOUT},
    },
    certification:{continuousRuntimeCertified,requiredAgents:112,workingAgents:counts.working,freshHeartbeatAgents:counts.freshHeartbeat,reason:continuousRuntimeCertified?'112/112 real workers have fresh <=60s heartbeat evidence and Autonomous is running':degradedDependencies.length?`Fail-closed: degraded truth dependencies: ${degradedDependencies.join(',')}`:'Fail-closed: requires Autonomous running + 112/112 WORKING + 112/112 fresh heartbeats + zero STALE/BLOCKED/UNKNOWN'},
    autonomous:{working:autonomousWorking,schedulerEnabled:Boolean(scheduler?.enabled),dispatcherPaused:dispatcher.paused,emergencyStop:dispatcher.emergencyStop,runningJobs:dispatcher.totals.running,queuedJobs:dispatcher.totals.queued,taskEngineRunning,completedJobs:dispatcher.totals.completed,failedJobs:dispatcher.totals.failed,blockedJobs:dispatcher.totals.blocked,maxConcurrency:dispatcher.maxConcurrency},
    developmentProgress:{totalJobs:totalDevelopmentJobs,pendingOwner:dispatcher.totals.pendingOwner,awaitingImplement:dispatcher.totals.awaitingImplement,queued:dispatcher.totals.queued,running:dispatcher.totals.running,taskEngineRunning,completed:dispatcher.totals.completed,failed:dispatcher.totals.failed,blocked:dispatcher.totals.blocked,completionPercent,activeAgentPercent},
    agents:{counts,rows:agents},
    github:github?{checkedAt:github.checkedAt,queued:github.queued,inProgress:github.inProgress,storm:github.storm,error:github.error}:null,
  };
}

export async function enforceAutonomous112RuntimeTruth(){
  const before=await getAutonomousTruthSnapshot();
  const control=await loadControlState().catch(()=>({paused:false,stopped:false,pausedAgents:[],stoppedAgents:[]}));
  if(control.stopped||control.paused||before.autonomous.emergencyStop){
    return {ok:false,action:'explicit_owner_or_emergency_stop_respected',recovered:[],snapshot:before};
  }

  let controlPlaneRecovered=false;
  if(!before.autonomous.schedulerEnabled||before.autonomous.dispatcherPaused){
    await setSchedulerEnabled(true);
    startCampaignDispatcher();
    await updateControlState('resume_all');
    await runCampaignBootRecovery().catch(()=>0);
    await syncCampaignAssignmentsToDispatcher();
    await campaignDispatcherControl('resume_all');
    controlPlaneRecovered=true;
  }

  const current=controlPlaneRecovered?await getAutonomousTruthSnapshot():before;
  await runCampaignBootRecovery().catch(()=>0);
  await syncCampaignAssignmentsToDispatcher();
  const recoverable=current.agents.rows.filter(a=>!a.paused&&!a.disabled&&['IDLE','STALE','UNKNOWN'].includes(a.status));
  for(const agent of recoverable){
    resumeAgent(agent.agentId);
    await campaignDispatcherControl('retry_agent',agent.agentNumber).catch(()=>undefined);
  }
  if(recoverable.length) await campaignDispatcherControl('resume_all');
  const after=await getAutonomousTruthSnapshot();
  return {
    ok:after.certification.continuousRuntimeCertified,
    action:controlPlaneRecovered?(recoverable.length?'recovered_control_plane_and_agents':'recovered_control_plane'):(recoverable.length?'recovered_nonworking_agents':'verified'),
    recovered:recoverable.map(a=>a.agentNumber),
    snapshot:after,
  };
}

export async function applyTruthControl(action:TruthControlAction,agentId?:string,agentNumber?:number){
  if(action==='start_all'||action==='resume_all'){
    await setSchedulerEnabled(true);
    startCampaignDispatcher();
    await runCampaignBootRecovery().catch(()=>0);
    await updateControlState('resume_all');
    await syncCampaignAssignmentsToDispatcher();
    if(action==='start_all') await cascadeStartAllAgents();
    else {
      for(const state of getAllExecutionStates()) resumeAgent(state.agentId);
      await campaignDispatcherControl('resume_all');
    }
  }
  else if(action==='stop_all'){
    for(const state of getAllExecutionStates())pauseAgent(state.agentId);
    await updateControlState('stop_all');
    await campaignDispatcherControl('stop_all');
    await setSchedulerEnabled(false);
  }
  else if(action==='pause_all'){
    for(const state of getAllExecutionStates())pauseAgent(state.agentId);
    await updateControlState('pause_all');
    await campaignDispatcherControl('pause_all');
  }
  else {
    if(!agentId&&typeof agentNumber!=='number')throw new Error('agentId or agentNumber required');
    const state=getAllExecutionStates().find(row=>row.agentId===agentId||row.agentNumber===agentNumber);
    if(!state)throw new Error('agent not found');
    if(action==='pause_agent')pauseAgent(state.agentId);
    if(action==='resume_agent')resumeAgent(state.agentId);
    if(action==='disable_agent')disableAgent(state.agentId);
    if(action==='enable_agent')enableAgent(state.agentId);
    if(action==='retry_agent')await campaignDispatcherControl('retry_agent',state.agentNumber);
  }
  return getAutonomousTruthSnapshot();
}
