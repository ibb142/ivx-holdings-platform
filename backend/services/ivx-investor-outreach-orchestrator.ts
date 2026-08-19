/**
 * IVX investor outreach orchestrator.
 * Converts qualified, source-backed CRM investor prospects into corporate
 * IVX Holdings email drafts. It never invents contact data and never sends.
 * Delivery remains owner-approved through the existing outreach -> SES flow.
 *
 * External message identity: IVX Holdings. Internal automation provenance is
 * retained in notes/evidence for auditability and is never inserted into the
 * recipient-facing subject/body.
 */
import { fetchProspects } from './ivx-agent-persistence';
import { createOutreachMessage, listOutreachMessages, submitForApproval } from './ivx-outreach-store';

export const IVX_INVESTOR_OUTREACH_ORCHESTRATOR_MARKER = 'ivx-investor-outreach-orchestrator-2026-08-18';

type PreparedOutreach = {
  prospectId: string;
  prospectName: string;
  score: number | null;
  sourceUrl: string;
  contactEmail: string | null;
  outreachId: string | null;
  status: 'pending_approval' | 'draft_contact_missing' | 'already_exists' | 'skipped_not_qualified' | 'failed';
  error: string | null;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
}
function str(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }
function emailFromData(data: unknown): string | null {
  const d=asRecord(data);
  for (const key of ['email','contactEmail','contact_email','businessEmail','business_email']) {
    const value=str(d[key]);
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return value;
  }
  return null;
}
function sourceContext(name:string,score:number|null,sourceUrl:string):string {
  const scoreText=score===null?'':' The prospect currently carries an internal qualification score of '+score+'.';
  return `IVX Holdings identified ${name} through a permitted public-source research workflow.${scoreText} Source evidence is retained internally; no investment outcome is promised.`;
}

export async function prepareQualifiedInvestorOutreach(limit=50): Promise<{
  marker:string;
  generatedAt:string;
  qualifiedProspects:number;
  prepared:number;
  pendingApproval:number;
  missingContact:number;
  existing:number;
  results:PreparedOutreach[];
}> {
  const safeLimit=Math.max(1,Math.min(200,Math.floor(limit)));
  const [prospectsRes,existingMessages]=await Promise.all([
    fetchProspects('investor',safeLimit),
    listOutreachMessages(),
  ]);
  if(!prospectsRes.ok || !prospectsRes.data){
    throw new Error(prospectsRes.error ?? 'Investor CRM could not be read.');
  }
  const results:PreparedOutreach[]=[];
  for(const p of prospectsRes.data){
    const prospectId=String(p.id ?? p.dedup_key ?? p.name);
    const score=typeof p.score==='number'?p.score:null;
    const sourceUrl=str(p.source_url);
    if(!p.qualified){
      results.push({prospectId,prospectName:p.name,score,sourceUrl,contactEmail:null,outreachId:null,status:'skipped_not_qualified',error:null});
      continue;
    }
    const duplicate=existingMessages.find(m=>m.type==='investor_intro' && (m.notes.includes(`prospect:${prospectId}`) || (m.recipientCompany===p.name && m.notes.includes(sourceUrl))));
    if(duplicate){
      results.push({prospectId,prospectName:p.name,score,sourceUrl,contactEmail:duplicate.recipientContact||null,outreachId:duplicate.id,status:'already_exists',error:null});
      continue;
    }
    const contactEmail=emailFromData(p.data);
    const created=await createOutreachMessage({
      type:'investor_intro',
      recipientCompany:p.name,
      recipientContact:contactEmail ?? '',
      senderName:'IVX Holdings',
      contextNote:sourceContext(p.name,score,sourceUrl),
      notes:`prospect:${prospectId}; source:${sourceUrl}; internal-agent:IA-17; workflow:qualified-investor-outreach`,
    });
    if(!created.ok){
      results.push({prospectId,prospectName:p.name,score,sourceUrl,contactEmail,outreachId:null,status:'failed',error:created.error});
      continue;
    }
    if(contactEmail){
      const submitted=await submitForApproval(created.message.id);
      results.push({prospectId,prospectName:p.name,score,sourceUrl,contactEmail,outreachId:created.message.id,status:submitted?.status==='pending_approval'?'pending_approval':'failed',error:submitted?null:'Could not submit draft for owner approval.'});
    }else{
      results.push({prospectId,prospectName:p.name,score,sourceUrl,contactEmail:null,outreachId:created.message.id,status:'draft_contact_missing',error:null});
    }
  }
  return {
    marker:IVX_INVESTOR_OUTREACH_ORCHESTRATOR_MARKER,
    generatedAt:new Date().toISOString(),
    qualifiedProspects:results.filter(r=>r.status!=='skipped_not_qualified').length,
    prepared:results.filter(r=>r.outreachId!==null && r.status!=='already_exists').length,
    pendingApproval:results.filter(r=>r.status==='pending_approval').length,
    missingContact:results.filter(r=>r.status==='draft_contact_missing').length,
    existing:results.filter(r=>r.status==='already_exists').length,
    results,
  };
}
