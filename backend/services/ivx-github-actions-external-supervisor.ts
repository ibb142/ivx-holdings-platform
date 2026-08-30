import { getIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';

export const IVX_GITHUB_ACTIONS_EXTERNAL_SUPERVISOR_MARKER = 'ivx-github-actions-external-supervisor-v2-2026-08-30';
const REPO = process.env.IVX_GITHUB_REPO || 'ibb142/ivx-holdings-platform';
const API = 'https://api.github.com';
const INTERVAL_MS = 60_000;
const QUEUE_STORM_THRESHOLD = 12;
const MAX_QUEUE_AGE_MS = 5 * 60_000;
const MAX_CURRENT_SHA_PUSH_RUNS = 6;

const CRITICAL_WORKFLOWS = new Set([
  'IVX Dashboard + IA Chat End-to-End Certificate',
  'IVX Owner Sign In + Home Android Certificate',
  'IVX E2E Acceptance Pipeline',
  'IVX QA Suite',
  'IVX CI',
  'IVX 10/10 Full Certification',
]);

type WorkflowRun = { id:number; name:string; event:string; status:string; conclusion:string|null; head_sha:string; head_branch:string|null; created_at:string; updated_at:string };
type QueueSnapshot = { checkedAt:string; mainSha:string|null; queued:number; inProgress:number; oldestQueuedAgeMs:number; currentShaPushQueued:number; storm:boolean; fanoutExceeded:boolean; cancelledRunIds:number[]; preservedCriticalRunIds:number[]; tokenAvailable:boolean; error:string|null };
let lastSnapshot: QueueSnapshot | null = null;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function getToken(): Promise<string> {
  return (process.env.GITHUB_TOKEN || process.env.IVX_GITHUB_TOKEN || (await getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN')) || '').trim();
}
async function gh<T>(path:string, token:string, init:RequestInit={}):Promise<T> {
  const headers:Record<string,string>={Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',...(init.headers as Record<string,string>|undefined)};
  if(token) headers.Authorization=`Bearer ${token}`;
  const response=await fetch(`${API}${path}`,{...init,headers,signal:AbortSignal.timeout(10_000)});
  if(!response.ok) throw new Error(`GitHub ${init.method||'GET'} ${path} -> HTTP ${response.status}`);
  if(response.status===204) return undefined as T;
  return await response.json() as T;
}
function ageMs(createdAt:string):number { const created=Date.parse(createdAt); return Number.isFinite(created)?Math.max(0,Date.now()-created):0; }
function isCriticalCurrent(run:WorkflowRun, mainSha:string|null):boolean { return Boolean(mainSha&&run.head_branch==='main'&&run.head_sha===mainSha&&CRITICAL_WORKFLOWS.has(run.name)); }
async function cancelRun(runId:number,token:string):Promise<boolean>{
  if(!token)return false;
  try{await gh<void>(`/repos/${REPO}/actions/runs/${runId}/cancel`,token,{method:'POST'});return true;}catch(error){console.warn('[IVX Actions External Supervisor] cancel failed',{runId,error:error instanceof Error?error.message:String(error)});return false;}
}
function newestFirst(runs:WorkflowRun[]):WorkflowRun[]{return [...runs].sort((a,b)=>Date.parse(b.created_at)-Date.parse(a.created_at));}

export async function runGitHubActionsExternalSupervision():Promise<QueueSnapshot>{
  const token=await getToken(); const cancelledRunIds:number[]=[]; const preservedCriticalRunIds:number[]=[];
  try{
    const ref=await gh<{object:{sha:string}}>(`/repos/${REPO}/git/ref/heads/main`,token); const mainSha=ref.object.sha||null;
    const queuedData=await gh<{workflow_runs:WorkflowRun[]}>(`/repos/${REPO}/actions/runs?branch=main&status=queued&per_page=100`,token);
    const runningData=await gh<{workflow_runs:WorkflowRun[]}>(`/repos/${REPO}/actions/runs?branch=main&status=in_progress&per_page=100`,token);
    const queued=queuedData.workflow_runs||[]; const inProgress=runningData.workflow_runs||[];
    const oldestQueuedAgeMs=queued.reduce((max,run)=>Math.max(max,ageMs(run.created_at)),0);
    const currentShaPushRuns=queued.filter(run=>run.event==='push'&&run.head_branch==='main'&&run.head_sha===mainSha);
    const fanoutExceeded=currentShaPushRuns.length>MAX_CURRENT_SHA_PUSH_RUNS;
    const storm=queued.length>=QUEUE_STORM_THRESHOLD||oldestQueuedAgeMs>=MAX_QUEUE_AGE_MS||fanoutExceeded;
    if(storm){
      const preservedNames=new Set<string>();
      for(const run of newestFirst(queued)){
        if(isCriticalCurrent(run,mainSha)&&!preservedNames.has(run.name)){preservedNames.add(run.name);preservedCriticalRunIds.push(run.id);continue;}
        // During runner starvation every noncritical queued run is disposable.
        // This makes broad push-main fanout harmless while trigger files are progressively path-scoped.
        if(!isCriticalCurrent(run,mainSha)&&await cancelRun(run.id,token)) cancelledRunIds.push(run.id);
      }
      for(const run of inProgress){
        if(mainSha&&run.head_sha!==mainSha&&!CRITICAL_WORKFLOWS.has(run.name)&&await cancelRun(run.id,token)) cancelledRunIds.push(run.id);
      }
    }
    lastSnapshot={checkedAt:new Date().toISOString(),mainSha,queued:queued.length,inProgress:inProgress.length,oldestQueuedAgeMs,currentShaPushQueued:currentShaPushRuns.length,storm,fanoutExceeded,cancelledRunIds,preservedCriticalRunIds,tokenAvailable:Boolean(token),error:null};
    console.log('[IVX Actions External Supervisor]',lastSnapshot); return lastSnapshot;
  }catch(error){
    lastSnapshot={checkedAt:new Date().toISOString(),mainSha:null,queued:0,inProgress:0,oldestQueuedAgeMs:0,currentShaPushQueued:0,storm:false,fanoutExceeded:false,cancelledRunIds,preservedCriticalRunIds,tokenAvailable:Boolean(token),error:error instanceof Error?error.message:String(error)};
    console.warn('[IVX Actions External Supervisor] cycle failed',lastSnapshot); return lastSnapshot;
  }
}
export function getGitHubActionsExternalSupervisorStatus():QueueSnapshot|null{return lastSnapshot;}
export function startGitHubActionsExternalSupervisor():void{if(running)return;running=true;const boot=setTimeout(()=>{void runGitHubActionsExternalSupervision();},15_000);boot.unref?.();timer=setInterval(()=>{void runGitHubActionsExternalSupervision();},INTERVAL_MS);timer.unref?.();}
export function stopGitHubActionsExternalSupervisorForTests():void{running=false;if(timer)clearInterval(timer);timer=null;}
