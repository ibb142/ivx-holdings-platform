import {pathToFileURL} from 'node:url';
const PROJECT='kvclcdjmjghndxsngfzb';
const REPO='ibb142/ivx-holdings-platform';
const WORKFLOW='IVX 112 Live AI Worker Certificate';
const PATH='.github/workflows/ivx-100-live-ai-worker-cert.yml';
export async function recover({fetchImpl=fetch,env=process.env,now=Date.now()}={}) {
  if(!env.SUPABASE_ACCESS_TOKEN?.trim()||!env.GITHUB_TOKEN?.trim())throw Error('Recovery credentials unavailable');
  const cutoff=new Date(now-15*60_000).toISOString();
  async function sql(query,parameters=[],readOnly=true){
    const response=await fetchImpl('https://api.supabase.com/v1/projects/'+PROJECT+'/database/query',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
      headers:{Authorization:'Bearer '+env.SUPABASE_ACCESS_TOKEN.trim(),'Content-Type':'application/json'},
      body:JSON.stringify({query,parameters,read_only:readOnly})
    });
    if(!response.ok)throw Error('Database recovery request HTTP '+response.status);
    const rows=await response.json();
    if(!Array.isArray(rows))throw Error('Unexpected database recovery response');
    return rows;
  }
  const predicate="final_status='running' and workflow=$1 and task_id ~ '^live112-[0-9]+-' and started_at<$2::timestamptz";
  const candidates=await sql("select distinct split_part(task_id,'-',2) as github_run from public.ivx_agent_executions where "+predicate+" limit 112",[WORKFLOW,cutoff]);
  const ended=[];
  for(const row of candidates){
    const id=String(row.github_run);
    if(!/^[0-9]{1,20}$/.test(id))throw Error('Invalid workflow identity');
    const response=await fetchImpl('https://api.github.com/repos/'+REPO+'/actions/runs/'+id,{
      method:'GET',redirect:'error',signal:AbortSignal.timeout(15000),
      headers:{Authorization:'Bearer '+env.GITHUB_TOKEN.trim(),Accept:'application/vnd.github+json'}
    });
    if(!response.ok)throw Error('Workflow verification HTTP '+response.status);
    const run=await response.json();
    if(String(run.id)!==id||run.path!==PATH||run.repository?.full_name!==REPO)throw Error('Workflow identity mismatch');
    if(run.status==='completed')ended.push(id);
  }
  if(!ended.length){console.log(JSON.stringify({orphanRecovery:true,candidates:candidates.length,closed:0}));return {closed:0};}
  const rows=await sql("with recovered as (update public.ivx_agent_executions set final_status='failed', finished_at=now(), duration_ms=coalesce(duration_ms,0), verified_output=false, error='RECOVERY_ORPHANED_WORKFLOW: terminal GitHub workflow; interrupted execution closed without verified success' where "+predicate+" and split_part(task_id,'-',2)=any($3::text[]) returning task_id) select count(*)::int as closed from recovered",[WORKFLOW,cutoff,ended],false);
  const remaining=await sql("select count(*)::int as remaining from public.ivx_agent_executions where "+predicate+" and split_part(task_id,'-',2)=any($3::text[])",[WORKFLOW,cutoff,ended]);
  if(remaining[0]?.remaining!==0)throw Error('Orphan recovery readback failed');
  const closed=rows[0]?.closed;
  if(!Number.isInteger(closed)||closed<0)throw Error('Recovery count unavailable');
  console.log(JSON.stringify({orphanRecovery:true,verifiedTerminalWorkflows:ended.length,closed,remaining:0,successFabricated:false}));
  return {closed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  recover().catch(error=>{console.error(error.message);process.exitCode=1;});
