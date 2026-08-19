/**
 * IVX 112 individual role-alignment certification.
 *
 * A run is not enough by itself. Each IA only certifies when its durable work
 * matches the business function assigned in the master registry and carries
 * verifiable source/evidence. Generic research does not certify engineering,
 * deployment, QA, sales, investor, or product-building roles.
 */
import { ALL_AGENT_CONTRACTS } from './ivx-agent-contracts';
import { getAgentByNumber } from './ivx-enterprise-master-registry';
import { readAgentDashboardLedger } from './ivx-agent-dashboard-ledger';

export const IVX_AGENT_ROLE_CERT_MARKER = 'ivx-agent-role-certification-2026-08-18-v1';

export type IndividualAgentCertificate = {
  certificateId: string;
  agentNumber: number;
  agentId: string;
  agentName: string;
  role: string;
  mission: string;
  windowHours: number;
  executionCount: number;
  completedCount: number;
  failedCount: number;
  blockedCount: number;
  alignedExecutionCount: number;
  evidenceExecutionCount: number;
  lastHeartbeat: string | null;
  latestTask: string | null;
  latestTools: string[];
  latestSource: string | null;
  status: 'CERTIFIED' | 'GAP' | 'NO_EVIDENCE';
  gap: string | null;
  requiredNextEvidence: string;
};

type RoleRule = {
  taskTerms: string[];
  toolTerms: string[];
  requiredNextEvidence: string;
  forbidGenericOnly?: boolean;
};

function ruleFor(n: number): RoleRule {
  if (n === 1) return { taskTerms:['executive','operations','report','orchestration'],toolTerms:['crm_read','github','render','supabase'],requiredNextEvidence:'Executive operating decision/report tied to durable company data.' };
  if (n === 2) return { taskTerms:['acquisition'],toolTerms:['sec_edgar','crm_write'],requiredNextEvidence:'Qualified acquisition opportunity written to CRM with source evidence.' };
  if (n === 3) return { taskTerms:['underwriting'],toolTerms:['sec_edgar','market','finance'],requiredNextEvidence:'Underwriting analysis tied to sourced financial/property evidence.' };
  if (n === 4) return { taskTerms:['development','construction','project'],toolTerms:['property','market','crm'],requiredNextEvidence:'Development pipeline action with project/property evidence.' };
  if (n === 5) return { taskTerms:['asset','noi','occupancy','variance'],toolTerms:['crm','property','finance'],requiredNextEvidence:'Asset-management action tied to portfolio KPI evidence.' };
  if (n === 6) return { taskTerms:['finance','account','rate'],toolTerms:['frankfurter','finance','supabase'],requiredNextEvidence:'Finance/accounting output with verifiable source or ledger reference.' };
  if (n === 7) return { taskTerms:['investor'],toolTerms:['sec_edgar','crm'],requiredNextEvidence:'Investor-relations research or CRM action with source evidence.' };
  if (n === 8) return { taskTerms:['compliance','legal','regulation'],toolTerms:['sec_edgar','compliance'],requiredNextEvidence:'Compliance finding with regulatory source evidence.' };
  if (n === 9) return { taskTerms:['sales','marketing','lead','campaign','conversion'],toolTerms:['crm','analytics','campaign'],requiredNextEvidence:'Demand-generation action tied to measurable lead/campaign evidence.',forbidGenericOnly:true };
  if (n === 10) return { taskTerms:['technology','platform','deploy','code','api'],toolTerms:['github','render','source_code','crm_read'],requiredNextEvidence:'Platform engineering/operations evidence such as code, API, deployment, or production telemetry.',forbidGenericOnly:true };
  if (n === 11) return { taskTerms:['qa','security','cert','verify'],toolTerms:['sec_edgar_submissions','github','test','security'],requiredNextEvidence:'QA/security verification with reproducible evidence.' };
  if (n === 12) return { taskTerms:['intelligence','research','market'],toolTerms:['worldbank','sec_edgar','research'],requiredNextEvidence:'Global intelligence finding with primary-source evidence.' };
  if (n >= 13 && n <= 16) return { taskTerms:['marketing','growth','advert','brand','campaign','market'],toolTerms:['campaign','analytics','crm','worldbank'],requiredNextEvidence:'Growth/marketing output tied to campaign, audience, or market evidence.',forbidGenericOnly:true };
  if (n === 17) return { taskTerms:['investor_lead','investor','acquisition'],toolTerms:['sec_edgar','crm_write'],requiredNextEvidence:'Qualified investor lead sourced and written to CRM; outreach may be drafted for owner approval.' };
  if (n === 18) return { taskTerms:['investor','retention','crm','follow_up'],toolTerms:['crm_read','crm_write','outreach'],requiredNextEvidence:'Investor-retention/follow-up action tied to a CRM record.' };
  if (n === 19) return { taskTerms:['buyer_acquisition','buyer'],toolTerms:['sec_edgar','crm_write'],requiredNextEvidence:'Qualified buyer sourced and persisted to CRM.' };
  if (n === 20) return { taskTerms:['buyer_qualification','buyer'],toolTerms:['crm_read','crm_write'],requiredNextEvidence:'Buyer qualification decision tied to a CRM record.' };
  if (n === 21) return { taskTerms:['buyer_follow_up','follow_up','buyer'],toolTerms:['crm_read','outreach'],requiredNextEvidence:'Buyer follow-up draft/action tied to a CRM record.' };
  if (n >= 22 && n <= 30) return { taskTerms:['market','business','partnership','jv','revenue','stability','project','pipeline'],toolTerms:['crm','sec_edgar','worldbank'],requiredNextEvidence:'Business-development/JV/market action tied to CRM or primary-source evidence.',forbidGenericOnly:true };
  if (n >= 31 && n <= 40) return { taskTerms:['token','digital','technology','ai','quantum','automation','research'],toolTerms:['sec_edgar','worldbank','github','source_code'],requiredNextEvidence:'Technology/tokenization research or implementation evidence appropriate to the assigned specialty.',forbidGenericOnly:true };
  if (n >= 41 && n <= 45) return { taskTerms:['intelligence','market','competitor','economic','real_estate','research'],toolTerms:['worldbank','sec_edgar','research'],requiredNextEvidence:'Intelligence finding backed by primary-source evidence.' };
  if (n >= 46 && n <= 55) return { taskTerms:['deal','off_market','buyer','seller','broker','lender','capital','equity','family','institution'],toolTerms:['crm','sec_edgar'],requiredNextEvidence:'Qualified network/deal/capital prospect persisted or updated in CRM.',forbidGenericOnly:true };
  if (n >= 56 && n <= 62) return { taskTerms:['international','country','city','development','asset','growth','opportunity','market'],toolTerms:['worldbank','sec_edgar','crm'],requiredNextEvidence:'Expansion opportunity scored with geographic/market evidence.',forbidGenericOnly:true };
  if (n >= 63 && n <= 67) return { taskTerms:['app','product','business_case','ux','ui','design','roadmap'],toolTerms:['github','source_code','design','file'],requiredNextEvidence:'Concrete product artifact: requirements, UX/UI artifact, roadmap file, or code committed to the product repo.',forbidGenericOnly:true };
  if (n >= 68 && n <= 77) return { taskTerms:['frontend','backend','database','api','ai','security','authentication','payment','analytics','notification','app'],toolTerms:['github','source_code','write_','test','database'],requiredNextEvidence:'Concrete engineering artifact: code/schema/API/test/config with repository evidence.',forbidGenericOnly:true };
  if (n >= 78 && n <= 86) return { taskTerms:['ios','android','web','portal','marketplace','automation','app'],toolTerms:['github','source_code','build','test','deploy'],requiredNextEvidence:'Concrete application artifact/build/code with repository or build evidence.',forbidGenericOnly:true };
  if (n >= 87 && n <= 92) return { taskTerms:['test','qa','security','deploy','monitor','growth','app'],toolTerms:['test','security','github','render','deploy','monitor'],requiredNextEvidence:'Reproducible QA/security/deploy/monitoring/growth evidence for a real app.',forbidGenericOnly:true };
  if (n >= 93 && n <= 102) return { taskTerms:['project','feasibility','financial','legal','brand','operations','technology','automation','launch','scale'],toolTerms:['github','crm','finance','research','source_code'],requiredNextEvidence:'Concrete project artifact or operating result tied to the assigned project function.',forbidGenericOnly:true };
  return { taskTerms:['product','saas','fintech','proptech','ai','token','quantum','tool','client','innovation','experiment'],toolTerms:['github','source_code','research','crm'],requiredNextEvidence:'Concrete product/innovation artifact: experiment, code, product spec, prototype, or client deliverable.',forbidGenericOnly:true };
}

function includesAny(haystack: string, terms: string[]): boolean {
  const h=haystack.toLowerCase();
  return terms.some(t=>h.includes(t.toLowerCase()));
}

export async function buildIndividualRoleCertificates(windowHours=24): Promise<{marker:string;generatedAt:string;windowHours:number;certified:number;gaps:number;noEvidence:number;certificates:IndividualAgentCertificate[]}> {
  const ledger=await readAgentDashboardLedger(5000);
  const cutoff=Date.now()-windowHours*3600000;
  const states=new Map(ledger.states.map(s=>[s.agent_id,s]));
  const executions=ledger.executions.filter(e=>{
    const t=Date.parse(e.started_at ?? e.finished_at ?? '');
    return Number.isFinite(t)&&t>=cutoff;
  });
  const certs:IndividualAgentCertificate[]=ALL_AGENT_CONTRACTS.map(c=>{
    const meta=getAgentByNumber(c.agentNumber);
    const rule=ruleFor(c.agentNumber);
    const rows=executions.filter(e=>e.agent_id===c.agentId).sort((a,b)=>(b.started_at??'').localeCompare(a.started_at??''));
    const aligned=rows.filter(r=>{
      const task=r.task_type ?? '';
      const tools=(r.tools_used??[]).join(' ');
      const source=r.source_reference ?? '';
      const genericOnly=task==='public_source_research' || task==='market_data_research' || task==='crm_pipeline_review';
      if(rule.forbidGenericOnly && genericOnly) return false;
      return includesAny(task,rule.taskTerms) && (includesAny(tools,rule.toolTerms) || includesAny(source,rule.toolTerms));
    });
    const evidence=rows.filter(r=>Boolean(r.evidence_sha256||r.source_reference));
    const latest=rows[0]??null;
    let status:IndividualAgentCertificate['status']='NO_EVIDENCE';
    let gap:string|null='No durable execution in certification window.';
    if(rows.length>0){
      if(aligned.length>0 && evidence.length>0){status='CERTIFIED';gap=null;}
      else {status='GAP';gap=aligned.length===0?'Recent work does not prove the assigned business/engineering role.':'Role-aligned work exists but lacks durable source/evidence.';}
    }
    return {
      certificateId:`IVX-IA-${String(c.agentNumber).padStart(3,'0')}-ROLE-${status}`,
      agentNumber:c.agentNumber,agentId:c.agentId,agentName:c.agentName,
      role:meta?.role??c.roleName,mission:meta?.mission??c.mission,windowHours,
      executionCount:rows.length,completedCount:rows.filter(r=>r.final_status==='completed').length,
      failedCount:rows.filter(r=>r.final_status==='failed').length,blockedCount:rows.filter(r=>r.final_status==='blocked').length,
      alignedExecutionCount:aligned.length,evidenceExecutionCount:evidence.length,
      lastHeartbeat:states.get(c.agentId)?.last_heartbeat??null,
      latestTask:latest?.task_type??null,latestTools:latest?.tools_used??[],latestSource:latest?.source_reference??null,
      status,gap,requiredNextEvidence:rule.requiredNextEvidence,
    };
  });
  return {marker:IVX_AGENT_ROLE_CERT_MARKER,generatedAt:new Date().toISOString(),windowHours,certified:certs.filter(c=>c.status==='CERTIFIED').length,gaps:certs.filter(c=>c.status==='GAP').length,noEvidence:certs.filter(c=>c.status==='NO_EVIDENCE').length,certificates:certs};
}
