import { runGitHubActionsExternalSupervision } from './ivx-github-actions-external-supervisor';
import { resolveMainSha, runGlobalCertificationSupervision } from './ivx-global-certification-supervisor';

export const IVX_AUTONOMOUS_ORGANISM_MARKER = 'ivx-autonomous-organism-v1-2026-08-30';
const INTERVAL_MS = 60_000;
const API_BASE = (process.env.IVX_API_BASE || 'https://api.ivxholding.com').replace(/\/$/, '');
const EXTERNAL_TARGETS = ['https://ivxholding.com','https://www.ivxholding.com','https://chat.ivxholding.com',`${API_BASE}/health`,`${API_BASE}/version`];
type Probe={target:string;ok:boolean;status:number|null;latencyMs:number;error:string|null};
type OrganismSnapshot={marker:typeof IVX_AUTONOMOUS_ORGANISM_MARKER;checkedAt:string;overall:'GREEN'|'YELLOW'|'RED';brain:{ok:boolean;mainSha:string|null;certification:string|null;error:string|null};heart:{ok:boolean;health:Probe;version:Probe};circulation:{ok:boolean;agents:Probe;dashboard:Probe};senses:{ok:boolean;targets:Probe[]};immune:{ok:boolean;queueStorm:boolean;queued:number;inProgress:number;cancelledRunIds:number[];error:string|null}};
let timer:ReturnType<typeof setInterval>|null=null;let running=false;let cycleRunning=false;let lastSnapshot:OrganismSnapshot|null=null;
async function probe(target:string):Promise<Probe>{const started=Date.now();try{const response=await fetch(target,{method:'GET',redirect:'follow',signal:AbortSignal.timeout(10_000),headers:{'User-Agent':'IVX-Autonomous-Organism/1.0'}});return{target,ok:response.ok,status:response.status,latencyMs:Date.now()-started,error:null};}catch(error){return{target,ok:false,status:null,latencyMs:Date.now()-started,error:error instanceof Error?error.message:String(error)};}}
export async function runAutonomousOrganismCycle():Promise<OrganismSnapshot>{
 const checkedAt=new Date().toISOString();
 const [queue,mainSha,external]=await Promise.all([runGitHubActionsExternalSupervision(),resolveMainSha().catch(()=>null),Promise.all(EXTERNAL_TARGETS.map(probe))]);
 const health=external.find(x=>x.target===`${API_BASE}/health`)!;const version=external.find(x=>x.target===`${API_BASE}/version`)!;
 const [agents,dashboard]=await Promise.all([probe(`${API_BASE}/api/ivx/agents`),probe(`${API_BASE}/api/ivx/agents/app-completion/dashboard`)]);
 let certification:string|null=null;let brainError:string|null=null;
 if(mainSha){try{certification=(await runGlobalCertificationSupervision(mainSha)).status;}catch(error){brainError=error instanceof Error?error.message:String(error);}}else brainError='Unable to resolve main SHA.';
 const brainOk=Boolean(mainSha&&certification&&certification!=='RED'&&!brainError);const heartOk=health.ok&&version.ok;const circulationOk=agents.ok&&dashboard.ok;const sensesOk=external.every(x=>x.ok);const immuneOk=!queue.error&&!queue.storm;
 const overall:OrganismSnapshot['overall']=(!heartOk||!circulationOk||certification==='RED')?'RED':(!brainOk||!sensesOk||!immuneOk)?'YELLOW':'GREEN';
 lastSnapshot={marker:IVX_AUTONOMOUS_ORGANISM_MARKER,checkedAt,overall,brain:{ok:brainOk,mainSha,certification,error:brainError},heart:{ok:heartOk,health,version},circulation:{ok:circulationOk,agents,dashboard},senses:{ok:sensesOk,targets:external},immune:{ok:immuneOk,queueStorm:queue.storm,queued:queue.queued,inProgress:queue.inProgress,cancelledRunIds:queue.cancelledRunIds,error:queue.error}};
 console.log('[IVX Autonomous Organism]',{overall,mainSha,certification,heartOk,circulationOk,sensesOk,queueStorm:queue.storm,queued:queue.queued,inProgress:queue.inProgress,cancelled:queue.cancelledRunIds.length});return lastSnapshot;
}
export function getAutonomousOrganismStatus():OrganismSnapshot|null{return lastSnapshot;}
export function startAutonomousOrganismSupervisor():void{if(running)return;running=true;const execute=async()=>{if(cycleRunning)return;cycleRunning=true;try{await runAutonomousOrganismCycle();}finally{cycleRunning=false;}};const boot=setTimeout(()=>{void execute();},10_000);boot.unref?.();timer=setInterval(()=>{void execute();},INTERVAL_MS);timer.unref?.();}
export function stopAutonomousOrganismSupervisorForTests():void{running=false;cycleRunning=false;if(timer)clearInterval(timer);timer=null;}
