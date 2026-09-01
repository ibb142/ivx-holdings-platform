/** IVX Autonomous Operations Dashboard client (owner-only). */
import { getDirectApiBaseUrl } from '@/lib/api-base';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

export type AgentStatus='ACTIVE'|'IDLE'|'RUNNING'|'TESTING'|'DEPLOYING'|'VERIFYING'|'RETRYING'|'BLOCKED'|'OWNER_ACTION_REQUIRED'|'FAILED'|'COMPLETED';
export type ActivityCategory='DEVELOPMENT'|'INVESTORS'|'BUYERS'|'LEADS_CRM'|'PROPERTIES_DEALS'|'MARKETING'|'FINANCIAL'|'AUTONOMOUS_SYSTEM';
export type UnifiedAgent={agentNumber:number;agentId:string;name:string;department:string;primaryResponsibility:string;status:AgentStatus;currentTask:string|null;tasksStartedToday:number;tasksCompletedToday:number;tasksFailedToday:number;tasksBlockedToday:number;lastActivityTime:string|null;totalExecutionTimeMs:number|null;successRate:number|null;evidenceLink:string|null;traceId:string|null;lastToolUsed?:string|null;lastSourceReference?:string|null;lastEvidenceSha?:string|null;health?:string;availability?:string;};
export type ActivityItem={itemNumber:number;agent:string;department:string;category:ActivityCategory;task:string;actionExecuted:string;result:string;status:AgentStatus;startTime:string|null;endTime:string|null;durationMs:number|null;repository:string|null;branch:string|null;commitSha:string|null;deploymentId:string|null;productionUrl:string|null;investorId:string|null;propertyId:string|null;leadId:string|null;error:string|null;retryCount:number;evidence:string;traceId:string|null;actor?:'AUTONOMOUS'|'CI'|'HUMAN'|'UNKNOWN';};
export type CategorySummary={category:ActivityCategory;total:number;completed:number;failed:number;blocked:number;items:ActivityItem[]};
export type DailySummary={reportDate:string;totalTasksStarted:number;totalTasksCompleted:number;totalTasksFailed:number;totalTasksBlocked:number;totalRetries:number;totalDeployments:number;totalCodeCommits:number;totalBugsFixed:number;totalInvestorsProcessed:number;totalBuyersProcessed:number;totalLeadsGenerated:number;totalPropertiesUpdated:number;totalMessagesSent:number;totalRevenueOpportunities:number;totalOwnerActionsRequired:number;agentUtilization:Array<{agentId:string;name:string;tasksToday:number;utilization:number}>;topCompletedWork:string[];topFailures:string[];businessRisks:string[];next24HourPlan:string[];};
export type LiveFeedEntry={time:string;agent:string;department:string;currentAction:string;status:AgentStatus;progressPercent:number|null;traceId:string|null;taskId:string|null};
export type OwnerActionEntry={traceId:string;title:string;status:string;createdAt:string;blocker:string|null};
export type Rolling24h={windowStart:string;windowEnd:string;tasksStarted:number;tasksCompleted:number;tasksFailed:number;tasksRunning:number;activeTimeMs:number;idleTimeMs:number;autonomousAttributed:number;unknownAttributed:number;proofEntries:number;ownerActionsRequired:number};
export type Enterprise112Status={registryCount:number;durableStateCount:number;durableExecutionCount:number;storeMode:string;ledgerOk:boolean;ledgerError:string|null};
export type AutonomousOpsDashboard={marker:string;ledgerMarker?:string;generatedAt:string;backendCommitSha:string|null;backendBootTime:string|null;backendRouteCount:number;githubHeadSha:string|null;commitMatch:boolean;dateRange:{start:string;end:string;label:string};agents:UnifiedAgent[];activityItems:ActivityItem[];categoryBreakdown:CategorySummary[];dailySummary:DailySummary|null;liveActivityFeed:LiveFeedEntry[];ownerActionRequests:OwnerActionEntry[];deploymentStatus:{renderDeployId:string|null;renderDeployStatus:string|null;renderCommitSha:string|null;productionHealthy:boolean};realAgentCount:number;placeholderAgentCount:number;rolling24h?:Rolling24h;enterprise112?:Enterprise112Status;smsConversation?:{enabled:boolean;reminderMinutes:number;phoneConfigured:boolean;phoneMasked:string|null;pendingTracked:number};disclaimer:string;};
export type DateRange='24h'|'today'|'yesterday'|'7d'|'30d';
export type DashboardStreamState='CONNECTING'|'AUTHENTICATING'|'LIVE'|'RECONNECTING'|'CLOSED'|'ERROR';
export type DashboardStreamMeta={state:DashboardStreamState;sequence:number;serverTime:string|null;intervalMs:number|null;marker:string|null;transport:'websocket'|'rest-fallback';};

function record(v:unknown):Record<string,unknown>{return v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};}
function sameSha(a:string|null|undefined,b:string|null|undefined):boolean{
  if(!a||!b)return false;
  return a===b||a.startsWith(b)||b.startsWith(a);
}
export function normalizeAutonomousDashboard(raw:AutonomousOpsDashboard):AutonomousOpsDashboard{
  if(!Array.isArray(raw.agents))throw new Error('Autonomous dashboard telemetry invalid: agents[] missing.');
  if(raw.agents.length!==112)throw new Error(`Autonomous dashboard fail-closed: expected 112 agents, received ${raw.agents.length}.`);
  const numbers=raw.agents.map((a)=>a.agentNumber).sort((a,b)=>a-b);
  for(let i=0;i<112;i+=1){if(numbers[i]!==i+1)throw new Error(`Autonomous dashboard fail-closed: IA registry mismatch at ${i+1}.`);}
  if(!raw.enterprise112)throw new Error('Autonomous dashboard fail-closed: enterprise ledger status missing.');
  if(raw.enterprise112.registryCount!==112)throw new Error(`Autonomous dashboard fail-closed: registry ${raw.enterprise112.registryCount}/112.`);
  if(!raw.enterprise112.ledgerOk)throw new Error(`Autonomous dashboard fail-closed: durable ledger unhealthy${raw.enterprise112.ledgerError?` — ${raw.enterprise112.ledgerError}`:''}.`);
  const backendSha=raw.backendCommitSha??null;
  const renderSha=raw.deploymentStatus?.renderCommitSha??null;
  const githubSha=raw.githubHeadSha??null;
  const productionHealthy=Boolean(backendSha&&renderSha&&sameSha(backendSha,renderSha)&&raw.enterprise112.ledgerOk);
  return {...raw,commitMatch:githubSha?sameSha(backendSha,githubSha):false,deploymentStatus:{...raw.deploymentStatus,productionHealthy},realAgentCount:raw.agents.filter((a)=>a.tasksStartedToday>0||Boolean(a.lastActivityTime)).length,placeholderAgentCount:raw.agents.filter((a)=>a.tasksStartedToday===0&&!a.lastActivityTime).length};
}

async function ownerFetch(path:string):Promise<unknown>{
  const token=await getIVXAccessToken();
  if(!token)throw new Error('IVX autonomous dashboard requires an authenticated Owner session.');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),12000);
  try{
    const res=await fetch(`${getDirectApiBaseUrl()}${path}`,{signal:controller.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'Cache-Control':'no-store'}});
    if(!res.ok){const b=await res.text().catch(()=>'');throw new Error(`IVX autonomous-ops request failed: HTTP ${res.status}${b?` — ${b.slice(0,200)}`:''}`);}
    return res.json();
  }catch(error){
    if(error instanceof Error&&error.name==='AbortError')throw new Error('IVX autonomous dashboard request timed out after 12s.');
    throw error;
  }finally{clearTimeout(timeout);}
}

export async function getAutonomousOpsDashboard(opts?:{range?:DateRange;agent?:string|null;category?:string|null}):Promise<AutonomousOpsDashboard>{
  const p=new URLSearchParams();
  p.set('enterpriseDashboard','1');
  p.set('_ts',String(Date.now()));
  if(opts?.range)p.set('range',opts.range);
  if(opts?.agent)p.set('agent',opts.agent);
  if(opts?.category)p.set('category',opts.category);
  const payload=record(await ownerFetch(`/api/ivx/live-work/agents?${p}`));
  if(payload.ok!==true)throw new Error(typeof payload.error==='string'?payload.error:'Autonomous dashboard backend returned ok=false.');
  return normalizeAutonomousDashboard(record(payload.dashboard) as unknown as AutonomousOpsDashboard);
}

function toWebSocketUrl(base:string):string{
  const normalized=base.replace(/\/$/,'');
  if(normalized.startsWith('https://'))return `wss://${normalized.slice(8)}/api/ivx/autonomous-dashboard-stream`;
  if(normalized.startsWith('http://'))return `ws://${normalized.slice(7)}/api/ivx/autonomous-dashboard-stream`;
  return `wss://${normalized}/api/ivx/autonomous-dashboard-stream`;
}

export async function openAutonomousDashboardStream(opts:{
  range:DateRange;
  onSnapshot:(dashboard:AutonomousOpsDashboard,meta:DashboardStreamMeta)=>void;
  onState?:(meta:DashboardStreamMeta)=>void;
  onError?:(error:Error)=>void;
}):Promise<{close:()=>void;setRange:(range:DateRange)=>void}> {
  const token=await getIVXAccessToken();
  if(!token)throw new Error('IVX autonomous dashboard requires an authenticated Owner session.');
  let sequence=0;
  let closed=false;
  let currentRange=opts.range;
  let latestMeta:DashboardStreamMeta={state:'CONNECTING',sequence:0,serverTime:null,intervalMs:null,marker:null,transport:'websocket'};
  const emitState=(patch:Partial<DashboardStreamMeta>)=>{latestMeta={...latestMeta,...patch,sequence};opts.onState?.(latestMeta);};
  emitState({state:'CONNECTING'});
  const ws=new WebSocket(toWebSocketUrl(getDirectApiBaseUrl()));
  ws.onopen=()=>{
    if(closed)return;
    emitState({state:'AUTHENTICATING'});
    ws.send(JSON.stringify({type:'auth',token,range:currentRange}));
  };
  ws.onmessage=(event)=>{
    if(closed)return;
    try{
      const message=record(JSON.parse(String(event.data)));
      const type=typeof message.type==='string'?message.type:'';
      if(type==='auth_ok'){
        emitState({state:'LIVE',marker:typeof message.marker==='string'?message.marker:null,intervalMs:typeof message.intervalMs==='number'?message.intervalMs:null});
        return;
      }
      if(type==='snapshot'){
        sequence=typeof message.sequence==='number'?message.sequence:sequence+1;
        const dashboard=normalizeAutonomousDashboard(record(message.dashboard) as unknown as AutonomousOpsDashboard);
        const meta:DashboardStreamMeta={state:'LIVE',sequence,serverTime:typeof message.serverTime==='string'?message.serverTime:null,intervalMs:typeof message.intervalMs==='number'?message.intervalMs:null,marker:typeof message.marker==='string'?message.marker:null,transport:'websocket'};
        latestMeta=meta;
        opts.onSnapshot(dashboard,meta);
        opts.onState?.(meta);
        return;
      }
      if(type==='stream_error'||type==='auth_error'||type==='protocol_error'){
        opts.onError?.(new Error(typeof message.error==='string'?message.error:`Autonomous dashboard stream ${type}`));
      }
    }catch(error){opts.onError?.(error instanceof Error?error:new Error(String(error)));}
  };
  ws.onerror=()=>{if(!closed){emitState({state:'ERROR'});opts.onError?.(new Error('Autonomous dashboard WebSocket error.'));}};
  ws.onclose=()=>{if(!closed)emitState({state:'RECONNECTING'});};
  return {
    close:()=>{closed=true;emitState({state:'CLOSED'});try{ws.close();}catch{}},
    setRange:(range)=>{currentRange=range;if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify({type:'set_range',range}));},
  };
}
