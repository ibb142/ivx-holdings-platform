import { getAllExecutionStates, pauseAgent, resumeAgent, disableAgent, enableAgent } from './ivx-agent-runtime';
import { campaignDispatcherControl, getCampaignDispatcherSnapshot, listCampaignDispatcherRecords, runCampaignBootRecovery, startCampaignDispatcher } from './ivx-campaign-dispatcher';
import { syncCampaignAssignmentsToDispatcher, updateControlState } from './ivx-app-completion-campaign';
import { getGitHubActionsExternalSupervisorStatus } from './ivx-github-actions-external-supervisor';
import { getSchedulerState } from './ivx-autonomous-scheduler';
import { getAllTasks, type Task } from './ivx-autonomous-task-engine';

export const IVX_AUTONOMOUS_TRUTH_CONTROL_MARKER = 'ivx-autonomous-truth-control-2026-09-04-v7-task-engine';
export const IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS = 60 * 1000;
export const IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS = 30 * 1000;
export const IVX_AUTONOMOUS_CASCADE_SEED_SIZE = 10;
export const IVX_AUTONOMOUS_CASCADE_FANOUT = 10;

const TASK_ENGINE_ACTIVE_STATES = new Set([
  'LEASED', 'RUNNING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS',
  'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING',
]);

export type TruthControlAction = 'start_all'|'stop_all'|'pause_all'|'resume_all'|'pause_agent'|'resume_agent'|'disable_agent'|'enable_agent'|'retry_agent';

function heartbeatAgeMs(value: string | null): number | null { if (!value) return null; const ts=Date.parse(value); return Number.isFinite(ts)?Math.max(0,Date.now()-ts):null; }
function heartbeatFresh(value: string | null): boolean { const age=heartbeatAgeMs(value); return age!==null&&age<=IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS; }
function taskHeartbeat(task: Task | undefined): string | null { return task?.lastHeartbeatAt ?? task?.updatedAt ?? null; }

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
  const [dispatcher,scheduler,dispatcherRecords,tasks]=await Promise.all([
    getCampaignDispatcherSnapshot(),
    getSchedulerState().catch(()=>null),
    listCampaignDispatcherRecords(),
    getAllTasks(),
  ]);
  const github=getGitHubActionsExternalSupervisorStatus(); const states=getAllExecutionStates();
  const runningByAgent=new Map<number,typeof dispatcherRecords[number]>();
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
    const taskEngineWorking=Boolean(taskRecord&&taskEngineHeartbeatFresh);
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
  const continuousRuntimeCertified=agents.length===112&&counts.working===112&&counts.stale===0&&counts.blocked===0&&counts.unknown===0&&counts.freshHeartbeat===112&&autonomousWorking;
  return {
    ok:agents.length===112,
    marker:IVX_AUTONOMOUS_TRUTH_CONTROL_MARKER,
    generatedAt:new Date().toISOString(),
    truthPolicy:{
      heartbeatFreshMs:IVX_AUTONOMOUS_TRUTH_HEARTBEAT_FRESH_MS,
      workingRequiresOneOf:[
        'agent runtime busy + activeTaskId + heartbeat <=60s',
        'dispatcher RUNNING + real workerJobId + dispatcher heartbeat <=60s',
        'autonomous task-engine active task + durable heartbeat <=60s',
      ],
      noInferenceFromGithubActions:true,
      noInferenceFromContinuityPromiseCount:true,
      noSyntheticWorkingStatus:true,
      staleFailsClosed:true,
      cascadeActivation:{seedSize:IVX_AUTONOMOUS_CASCADE_SEED_SIZE,fanout:IVX_AUTONOMOUS_CASCADE_FANOUT},
    },
    certification:{continuousRuntimeCertified,requiredAgents:112,workingAgents:counts.working,freshHeartbeatAgents:counts.freshHeartbeat,reason:continuousRuntimeCertified?'112/112 real workers have fresh <=60s heartbeat evidence and Autonomous is running':'Fail-closed: requires Autonomous running + 112/112 WORKING + 112/112 fresh heartbeats + zero STALE/BLOCKED/UNKNOWN'},
    autonomous:{working:autonomousWorking,schedulerEnabled:Boolean(scheduler?.enabled),dispatcherPaused:dispatcher.paused,emergencyStop:dispatcher.emergencyStop,runningJobs:dispatcher.totals.running,queuedJobs:dispatcher.totals.queued,taskEngineRunning,completedJobs:dispatcher.totals.completed,failedJobs:dispatcher.totals.failed,blockedJobs:dispatcher.totals.blocked,maxConcurrency:dispatcher.maxConcurrency},
    developmentProgress:{totalJobs:totalDevelopmentJobs,pendingOwner:dispatcher.totals.pendingOwner,awaitingImplement:dispatcher.totals.awaitingImplement,queued:dispatcher.totals.queued,running:dispatcher.totals.running,taskEngineRunning,completed:dispatcher.totals.completed,failed:dispatcher.totals.failed,blocked:dispatcher.totals.blocked,completionPercent,activeAgentPercent},
    agents:{counts,rows:agents},
    github:github?{checkedAt:github.checkedAt,queued:github.queued,inProgress:github.inProgress,storm:github.storm,error:github.error}:null,
  };
}

export async function enforceAutonomous112RuntimeTruth(){
  const before=await getAutonomousTruthSnapshot();
  if(!before.autonomous.schedulerEnabled||before.autonomous.dispatcherPaused||before.autonomous.emergencyStop) return {ok:false,action:'owner_or_system_stop_respected',recovered:[],snapshot:before};
  await runCampaignBootRecovery().catch(()=>0); await syncCampaignAssignmentsToDispatcher();
  const recoverable=before.agents.rows.filter(a=>!a.paused&&!a.disabled&&['IDLE','STALE','UNKNOWN'].includes(a.status));
  for(const agent of recoverable){ resumeAgent(agent.agentId); await campaignDispatcherControl('retry_agent',agent.agentNumber).catch(()=>undefined); }
  if(recoverable.length) await campaignDispatcherControl('resume_all');
  const after=await getAutonomousTruthSnapshot();
  return {ok:after.certification.continuousRuntimeCertified,action:recoverable.length?'recovered_nonworking_agents':'verified',recovered:recoverable.map(a=>a.agentNumber),snapshot:after};
}

export async function applyTruthControl(action:TruthControlAction,agentId?:string,agentNumber?:number){
  if(action==='start_all'||action==='resume_all'){
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
  else if(action==='stop_all'){for(const state of getAllExecutionStates())pauseAgent(state.agentId);await updateControlState('stop_all');await campaignDispatcherControl('stop_all');}
  else if(action==='pause_all'){for(const state of getAllExecutionStates())pauseAgent(state.agentId);await updateControlState('pause_all');await campaignDispatcherControl('pause_all');}
  else {if(!agentId&&typeof agentNumber!=='number')throw new Error('agentId or agentNumber required');const state=getAllExecutionStates().find(row=>row.agentId===agentId||row.agentNumber===agentNumber);if(!state)throw new Error('agent not found');if(action==='pause_agent')pauseAgent(state.agentId);if(action==='resume_agent')resumeAgent(state.agentId);if(action==='disable_agent')disableAgent(state.agentId);if(action==='enable_agent')enableAgent(state.agentId);if(action==='retry_agent')await campaignDispatcherControl('retry_agent',state.agentNumber);}
  return getAutonomousTruthSnapshot();
}
