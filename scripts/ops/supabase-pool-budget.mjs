import { pathToFileURL } from 'node:url';
export const PROJECT = 'kvclcdjmjghndxsngfzb';
export function primaryPoolSizes(rows) {
  if (!rows || typeof rows!=='object') throw new Error('Invalid pool configuration');
  const pools=Array.isArray(rows)?rows.filter(row=>row.database_type==='PRIMARY'):[rows];
  // Supabase Studio uses the pgbouncer configuration endpoint for the settings
  // shared by all poolers. Null means the documented Nano default (15); this
  // recovery is scoped to the project audited with max_connections=60.
  const sizes=pools.map(row=>row.default_pool_size===null?15:row.default_pool_size);
  if (!sizes.length || sizes.some(size=>!Number.isInteger(size)||size<1)) throw new Error('Primary pool size unavailable');
  return sizes;
}
export async function run(fetchImpl=fetch,token=process.env.SUPABASE_ACCESS_TOKEN) {
  if (!token?.trim()) throw new Error('SUPABASE_ACCESS_TOKEN is missing');
  const base='https://api.supabase.com/v1/projects/'+PROJECT;
  async function request(path,method='GET',body) {
    const response=await fetchImpl(base+path,{method,
      headers:{Authorization:'Bearer '+token.trim(),'Content-Type':'application/json'},
      ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(45000)});
    if(!response.ok)throw new Error('Supabase '+method+' '+path+' HTTP '+response.status);
    return response.json();
  }
  const before=primaryPoolSizes(await request('/config/database/pgbouncer'));
  // This incident's database has 60 slots, with Auth/Storage/PostgREST sharing
  // them. Bound external pool servers; this does not limit logical IA lanes.
  if (Math.max(...before)>15) throw new Error('Pool differs from audited configuration; review required');
  const target=Math.min(5,...before);
  console.log(JSON.stringify({project:PROJECT,beforePoolSizes:before,targetPoolSize:target}));
  if(before.some(size=>size!==target))await request('/config/database/pooler','PATCH',{default_pool_size:target});
  const after=primaryPoolSizes(await request('/config/database/pgbouncer'));
  if(after.some(size=>size!==target))throw new Error('Pool budget readback mismatch');
  console.log(JSON.stringify({poolBudgetVerified:true,serverConnectionsPerPool:target,credentialsChanged:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  run().catch(error=>{console.error(error.message);process.exitCode=1;});
