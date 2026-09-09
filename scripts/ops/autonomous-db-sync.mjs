import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import pg from 'pg';

const project = 'kvclcdjmjghndxsngfzb';
const owner = 'tea-d7plj9beo5us73ch3ukg';
const services = ['srv-d7t9ivreo5us73ftose0', 'srv-d9i15fg4n6ts73bn00j0'];
const aliases = ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL'];
const base = `https://${project}.supabase.co`;
const mask = value => { if (value) console.log(`::add-mask::${value.replace(/%/g,'%25').replace(/\r/g,'%0D').replace(/\n/g,'%0A')}`); };

export function validateConnection(raw) {
  try {
    const u = new URL(raw);
    const user = decodeURIComponent(u.username);
    if (!['postgres:', 'postgresql:'].includes(u.protocol) || !u.password || !user || u.pathname !== '/postgres') return null;
    if (u.hostname !== `db.${project}.supabase.co`
      && !(u.hostname.endsWith('.pooler.supabase.com') && user === `postgres.${project}`)) return null;
    if (u.searchParams.has('sslmode') && !['require','verify-ca','verify-full'].includes(u.searchParams.get('sslmode'))) return null;
    return { host:u.hostname, port:Number(u.port || 5432), user, password:decodeURIComponent(u.password), database:'postgres',
      ssl:{rejectUnauthorized:true}, connectionTimeoutMillis:5000, query_timeout:5000, statement_timeout:5000 };
  } catch { return null; }
}

export function connectionIssue(raw) {
  if(!raw?.trim())return 'missing';
  try {
    const u=new URL(raw.trim());
    if(!['postgres:','postgresql:'].includes(u.protocol))return 'not_postgres_uri';
    if(!u.username || !u.password)return 'missing_database_credentials';
    const password=decodeURIComponent(u.password);
    if(/^(?:\[?YOUR[-_ ](?:DB[-_ ])?PASSWORD\]?|password|changeme|\*+)$/i.test(password))return 'placeholder_password';
    if(u.hostname==='base')return 'invalid_base_hostname';
    if(u.pathname!=='/postgres')return 'database_name_mismatch';
    return validateConnection(raw)?'valid':'project_or_tls_mismatch';
  } catch { return 'malformed_uri'; }
}

export function repairKnownConnection(raw) {
  try {
    const u=new URL(raw.trim());
    // Repair only the observed invalid host, preserving existing credentials.
    // A same-project live TLS probe is mandatory before persisting this candidate.
    if(connectionIssue(raw)!=='invalid_base_hostname' || u.username!=='postgres'
      || u.pathname!=='/postgres' || (u.port && u.port!=='5432'))return null;
    u.hostname=`db.${project}.supabase.co`;
    return validateConnection(u.href)?u.href:null;
  } catch {return null;}
}

export function candidates(env) {
  const result = aliases.filter(k=>env[k]?.trim()).map(k=>({source:k, value:env[k].trim()}));
  for(const candidate of [...result]) {
    const repaired=repairKnownConnection(candidate.value);
    if(repaired)result.push({source:candidate.source+'_hostname_repair',value:repaired});
  }
  if (env.SUPABASE_DB_PASSWORD?.trim()) {
    const u = new URL(`postgresql://db.${project}.supabase.co/postgres`);
    u.username = env.SUPABASE_DB_USER?.trim() || 'postgres';
    u.password = env.SUPABASE_DB_PASSWORD.trim();
    if (env.SUPABASE_DB_HOST?.trim()) u.hostname = env.SUPABASE_DB_HOST.trim();
    u.port = env.SUPABASE_DB_PORT?.trim() || '5432';
    result.push({source:'SUPABASE_DB_PASSWORD',value:u.href});
  }
  return result;
}

async function request(url, token, init={}) {
  const r = await fetch(url,{...init,headers:{Authorization:`Bearer ${token}`,Accept:'application/json','Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(20000)});
  if (!r.ok) throw new Error(`remote_http_${r.status}`);
  return r.json();
}

export async function renderKey() {
  const direct=(process.env.RENDER_API_KEY || process.env.IVX_RENDER_API_KEY || '').trim();
  if (direct) { mask(direct); return direct; }
  const service=process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!service) throw new Error('github_supabase_service_binding_missing');
  let rows;
  try {
    rows=await request(`${base}/rest/v1/ivx_owner_variables?select=encrypted_value,value_iv,value_tag,value_hash&name=eq.RENDER_API_KEY&limit=2`,service,{headers:{apikey:service}});
  } catch(error) {
    const transient=error.name==='TimeoutError' || error.name==='TypeError' || /^remote_http_5[0-9]{2}$/.test(error.message);
    if(!transient) throw new Error('owner_variable_rest_access_failed');
    const management=process.env.SUPABASE_ACCESS_TOKEN?.trim();
    if(!management) throw new Error('owner_variable_rest_unavailable_management_binding_missing');
    console.log('owner_variable_rest_unavailable: trying_read_only_management_query');
    try {
      rows=await request(`https://api.supabase.com/v1/projects/${project}/database/query`,management,{
        method:'POST',body:JSON.stringify({query: "SELECT encrypted_value, value_iv, value_tag, value_hash FROM public.ivx_owner_variables WHERE name = 'RENDER_API_KEY' LIMIT 2",read_only:true})
      });
    } catch { throw new Error('owner_variable_management_read_failed'); }
  }
  if (!Array.isArray(rows) || rows.length!==1) throw new Error('render_owner_variable_missing');
  const row=rows[0];
  const secrets=[process.env.IVX_OWNER_VARIABLES_ENCRYPTION_KEY,process.env.APP_SECRET,process.env.JWT_SECRET,
    crypto.createHash('sha256').update(`${base}:${service}`).digest('hex')].filter(Boolean);
  for (const secret of secrets) {
    try {
      const decipher=crypto.createDecipheriv('aes-256-gcm',crypto.createHash('sha256').update(secret).digest(),Buffer.from(row.value_iv,'base64'));
      decipher.setAAD(Buffer.from('ivx_owner_variables:v1'));
      decipher.setAuthTag(Buffer.from(row.value_tag,'base64'));
      const value=Buffer.concat([decipher.update(Buffer.from(row.encrypted_value,'base64')),decipher.final()]).toString('utf8').trim();
      if (crypto.createHash('sha256').update(value).digest('hex')!==row.value_hash) continue;
      mask(value); return value;
    } catch { /* Try only the configured encryption keys, never guess passwords. */ }
  }
  throw new Error('render_owner_variable_decryption_failed');
}

async function readEnv(serviceId,key) {
  const env={}; let cursor=''; const cursors=new Set();
  for(let page=0;page<20;page++) {
    const rows=await request(`https://api.render.com/v1/services/${serviceId}/env-vars?limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,key);
    if (!Array.isArray(rows)) throw new Error('render_env_response_invalid');
    for(const item of rows) { const e=item.envVar || item; if(typeof e.key==='string'&&typeof e.value==='string') env[e.key]=e.value; }
    if(rows.length<100) return env;
    cursor=rows.at(-1)?.cursor;
    if(!cursor||cursors.has(cursor)) throw new Error('render_env_pagination_incomplete');
    cursors.add(cursor);
  }
  throw new Error('render_env_pagination_limit');
}

export async function readLinkedGroups(key) {
  const result=[]; let cursor=''; const seen=new Set();
  for(let page=0;page<20;page++) {
    const rows=await request(`https://api.render.com/v1/env-groups?ownerId=${owner}&limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:''}`,key);
    if(!Array.isArray(rows))throw new Error('render_group_response_invalid');
    for(const item of rows) {
      const meta=item.envGroup || item;
      if(meta.ownerId!==owner || !Array.isArray(meta.serviceLinks))throw new Error('render_group_identity_invalid');
      if(!meta.serviceLinks.some(link=>services.includes(link.id)))continue;
      if(typeof meta.id!=='string' || !/^evg-[a-z0-9]+$/.test(meta.id))throw new Error('render_group_id_invalid');
      const group=await request(`https://api.render.com/v1/env-groups/${meta.id}`,key);
      if(group.id!==meta.id || group.ownerId!==owner || !Array.isArray(group.serviceLinks)
        || !group.serviceLinks.some(link=>services.includes(link.id)) || !Array.isArray(group.envVars))throw new Error('render_group_identity_invalid');
      const env={};
      for(const e of group.envVars)if(typeof e.key==='string'&&typeof e.value==='string')env[e.key]=e.value;
      console.log(JSON.stringify({groupId:meta.id,credentialPresence:Object.fromEntries([...aliases,'SUPABASE_DB_PASSWORD'].map(n=>[n,Boolean(env[n]?.trim())])),validUrlAliases:aliases.filter(n=>validateConnection(env[n])),connectionIssues:Object.fromEntries(aliases.map(n=>[n,connectionIssue(env[n])]))}));
      result.push({serviceId:meta.id,env});
    }
    if(rows.length<100)return result;
    cursor=rows.at(-1)?.cursor;
    if(!cursor || seen.has(cursor))throw new Error('render_group_pagination_incomplete');
    seen.add(cursor);
  }
  throw new Error('render_group_pagination_limit');
}

export async function main() {
  const key=await renderKey();
  const configurations=[];
  for(const serviceId of services) {
    const service=await request(`https://api.render.com/v1/services/${serviceId}`,key);
    if(service.ownerId!==owner || service.repo!=='https://github.com/ibb142/ivx-holdings-platform') throw new Error('render_service_identity_mismatch');
    const env=await readEnv(serviceId,key);
    const names=[...aliases,'SUPABASE_DB_PASSWORD','SUPABASE_DB_HOST','SUPABASE_DB_USER'];
    console.log(JSON.stringify({serviceId,credentialPresence:Object.fromEntries(names.map(n=>[n,Boolean(env[n]?.trim())])),validUrlAliases:aliases.filter(n=>validateConnection(env[n])),connectionIssues:Object.fromEntries(aliases.map(n=>[n,connectionIssue(env[n])]))}));
    configurations.push({serviceId,env});
  }
  const groups=await readLinkedGroups(key);
  console.log(JSON.stringify({linkedGroupsAudited:groups.length}));
  let chosen=null;
  for(const entry of [...configurations,...groups]) for(const candidate of candidates(entry.env)) {
    if(chosen) break;
    if(connectionIssue(candidate.value)!=='valid')continue;
    const config=validateConnection(candidate.value); if(!config) continue;
    mask(candidate.value); mask(config.password);
    const client=new pg.Client(config); client.on('error',()=>console.log('database_probe_connection_error'));
    try {
      await client.connect();
      const r=await client.query('SELECT active FROM public.ivx_agent_controls WHERE control_name = $1 LIMIT 2',['emergency_stop']);
      if(r.rows.length!==1 || typeof r.rows[0].active!=='boolean') throw new Error('control_row_invalid');
      chosen=candidate;
      console.log(JSON.stringify({probe:'PASS',serviceId:entry.serviceId,source:candidate.source,ownerStopActive:r.rows[0].active}));
    } catch(error) {
      const known=['ENOTFOUND','ENETUNREACH','ECONNREFUSED','ETIMEDOUT','28P01','3D000','42501','CERT_HAS_EXPIRED','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE'];
      console.log(JSON.stringify({probe:'FAIL',serviceId:entry.serviceId,source:candidate.source,reason:known.includes(error?.code)?error.code:'database_probe_failed'}));
    }
    finally { await client.end(); }
  }
  if(!chosen) throw new Error('no_verified_same_project_database_connection');
  for(const {serviceId,env} of configurations) {
    if(env.SUPABASE_DB_URL===chosen.value) { console.log(JSON.stringify({serviceId,sync:'already_matches'})); continue; }
    await request(`https://api.render.com/v1/services/${serviceId}/env-vars/SUPABASE_DB_URL`,key,{method:'PUT',body:JSON.stringify({value:chosen.value})});
    const verified=await readEnv(serviceId,key);
    if(verified.SUPABASE_DB_URL!==chosen.value) throw new Error('render_sync_verification_failed');
    console.log(JSON.stringify({serviceId,sync:'verified'}));
  }
  console.log('CONFIGURATION_SYNC_PASS: runtime recovery must be verified after deployment');
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) main().catch(error=>{
  // Never print upstream bodies, connection strings, or stack traces.
  const code=String(error.message);
  console.error(/^[a-z0-9_]+$/.test(code)?code:'configuration_audit_failed'); process.exitCode=1;
});
