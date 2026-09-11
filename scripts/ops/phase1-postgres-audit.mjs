import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { normalizeStoredConnection, repairKnownConnection, connectionIssue, validateConnection, probeFailure } from './autonomous-db-sync.mjs';

export const PROJECT = 'kvclcdjmjghndxsngfzb';
const aliases = ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL'];
const RUNTIME_SERVICE='srv-d7t9ivreo5us73ftose0';
const RUNTIME_OWNER='tea-d7plj9beo5us73ch3ukg';

export async function readRuntimeConnection(env,fetchImpl=fetch) {
  const key=(env.RENDER_API_KEY||env.IVX_RENDER_API_KEY||'').trim();
  const audit={credentialBinding:Boolean(key),serviceId:RUNTIME_SERVICE,requests:0};
  if (!key) return {audit:{...audit,reason:'runtime_credential_binding_missing'}};
  const base=`https://api.render.com/v1/services/${RUNTIME_SERVICE}`;
  async function get(url) {
    audit.requests++;
    const response=await fetchImpl(url,{method:'GET',headers:{Authorization:`Bearer ${key}`},
      redirect:'error',signal:AbortSignal.timeout(10000)});
    const body=await response.json().catch(()=>null);
    return {status:response.status,body};
  }
  try {
    const service=await get(base);audit.serviceStatus=service.status;
    if (service.status!==200 || service.body?.id!==RUNTIME_SERVICE || service.body?.ownerId!==RUNTIME_OWNER
      || service.body?.repo!=='https://github.com/ibb142/ivx-holdings-platform') {
      return {audit:{...audit,reason:'runtime_service_identity_unverified'}};
    }
    const variable=await get(`${base}/env-vars/SUPABASE_DB_URL`);audit.variableStatus=variable.status;
    const body=variable.body?.envVar||variable.body;
    if (variable.status!==200 || body?.key!=='SUPABASE_DB_URL' || typeof body.value!=='string') {
      return {audit:{...audit,reason:'runtime_database_binding_unavailable'}};
    }
    const raw=normalizeStoredConnection(body.value)||body.value;
    const repaired=repairKnownConnection(raw);
    const config=validateConnection(repaired||raw);
    audit.issue=connectionIssue(raw);audit.knownHostnameRepair=Boolean(repaired);
    if (!config || ![5432,6543].includes(config.port)) return {audit:{...audit,reason:'runtime_database_binding_invalid'}};
    return {audit:{...audit,valid:true},config};
  } catch { return {audit:{...audit,reason:'runtime_connection_lookup_failed'}}; }
}
export const SNAPSHOT = `select clock_timestamp() as observed_at,
  current_setting('transaction_read_only') as read_only,
  current_setting('max_connections')::integer as max_connections,
  (select n.nspname from pg_extension e join pg_namespace n on n.oid=e.extnamespace where e.extname='pg_stat_statements') as statement_statistics_schema,
  (select count(*)::integer from pg_stat_activity where backend_type='client backend') as client_connections,
  (select count(*)::integer from pg_locks where not granted) as waiting_locks,
  (select json_agg(s) from (select backend_type,state,wait_event_type,wait_event,count(*)::integer as connections,
    max(extract(epoch from clock_timestamp()-xact_start)) as max_transaction_seconds
    from pg_stat_activity where pid<>pg_backend_pid()
    group by backend_type,state,wait_event_type,wait_event) s) as activity,
  (select i.indisvalid and i.indisready from pg_index i
    where i.indexrelid=to_regclass('public.ivx_autonomous_tasks_queued_scope_idx')) as index_ready,
  (select position('foreach v_active_prefix in array v_active_prefixes' in pg_get_functiondef(p.oid))>0
    from pg_proc p where p.oid=to_regprocedure('public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)')) as claim_scope_active,
  (select json_build_object('security_definer',p.prosecdef,'config',p.proconfig,'acl',p.proacl::text,
    'definition_md5',md5(pg_get_functiondef(p.oid))) from pg_proc p
    where p.oid=to_regprocedure('public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)')) as claim_function;`;

async function bounded(promise, ms) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Object.assign(new Error('database timeout'), { code: 'ETIMEDOUT' })), ms);
  })]); } finally { clearTimeout(timer); }
}

// This entry point only opens one TLS connection and a read-only transaction.
// It never invokes credential synchronization, DDL, DML, restart or owner controls.
export async function auditPostgres({ env=process.env, makeClient=config=>new pg.Client(config),fetchImpl=fetch,
  now=()=>new Date().toISOString(), elapsed=()=>performance.now() }={}) {
  if (env.PROJECT_REF!==PROJECT) throw Error('Unexpected project binding');
  const report={kind:'postgres-read-only-diagnostic',project:PROJECT,sourceSha:env.GITHUB_SHA||null,
    startedAt:now(),certified:false,ok:false,bindings:[],connectionAttempts:0,measurements:[]};
  let selected;
  for (const name of aliases) {
    const raw=env[name]?.trim();
    const normalized=raw ? normalizeStoredConnection(raw)||raw : null;
    // This existing repair only recognizes the previously observed literal
    // "base" hostname for postgres/postgres and substitutes this fixed project.
    // It preserves the credential and never writes configuration anywhere.
    const repaired=normalized ? repairKnownConnection(normalized) : null;
    const config=normalized ? validateConnection(repaired||normalized) : null;
    const valid=Boolean(config && [5432,6543].includes(config.port));
    report.bindings.push({name,present:Boolean(raw),valid,issue:connectionIssue(normalized),knownHostnameRepair:Boolean(repaired)});
    if (!selected && valid) selected={name,config};
  }
  if (!selected) {
    const runtime=await readRuntimeConnection(env,fetchImpl);report.runtimeBinding=runtime.audit;
    if (runtime.config) selected={name:'RENDER_SUPABASE_DB_URL',config:runtime.config};
  }
  if (!selected) return {...report,error:{reason:'no_valid_same_project_database_binding'},finishedAt:now()};
  const client=makeClient({...selected.config,connectionTimeoutMillis:5000,query_timeout:7000,
    statement_timeout:5000,lock_timeout:1000,idle_in_transaction_session_timeout:10000,
    application_name:'ivx_phase1_read_only_audit'});
  client.on?.('error',error=>{ report.connectionError=probeFailure(error); });
  report.selectedBinding=selected.name;
  report.connectionAttempts=1;
  const began=elapsed();
  let connected=false, transaction=false;
  try {
    await bounded(client.connect(),6000);connected=true;
    report.connectionMs=Math.round(elapsed()-began);
    await bounded(client.query("BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; SET LOCAL idle_in_transaction_session_timeout='10s';"),7000);
    transaction=true;
    const measurements=[['metadata',SNAPSHOT],['activeQueries',`select pid,application_name,
      state,wait_event_type,wait_event,extract(epoch from clock_timestamp()-query_start) as query_age_seconds,
      pg_blocking_pids(pid) as blocking_pids,
      case when query ilike '%ivx_autonomous_tasks_claim_batch%' then 'claim_batch'
        when query ilike '%ivx_autonomous_task_events%' then 'task_events'
        when query ilike '%ivx_autonomous_tasks%' then 'autonomous_tasks'
        when query ilike '%ivx_durable_documents%' then 'durable_documents'
        when query ilike '%pg_namespace%' or query ilike '%pg_proc%' then 'schema_catalog'
        when query ilike '%jv_deals%' then 'jv_deals' else 'other' end as query_family
      from pg_stat_activity where pid<>pg_backend_pid() and state='active'
      order by query_start asc limit 25;`],['queueEstimate',
      "select reltuples::bigint as estimated_rows, pg_relation_size(oid) as heap_bytes, pg_total_relation_size(oid) as total_bytes from pg_class where oid=to_regclass('public.ivx_autonomous_tasks');"]];
    for (let index=0;index<measurements.length;index++) {
      const [name,query]=measurements[index];
      const start=elapsed();const result=await bounded(client.query(query),7000);
      if (!Array.isArray(result.rows) || (name==='metadata' && (result.rows.length!==1 || result.rows[0].read_only!=='on'))) {
        throw Error('Unexpected diagnostic shape');
      }
      report.measurements.push({name,at:now(),elapsedMs:Math.round(elapsed()-start),rows:result.rows});
      if (name==='metadata') {
        const schema=result.rows[0].statement_statistics_schema;
        if (schema==='public' || schema==='extensions') measurements.push(['queryStatistics',`select queryid::text,calls,
          round(total_exec_time::numeric,2) as total_exec_ms,round(mean_exec_time::numeric,2) as mean_exec_ms,
          round(max_exec_time::numeric,2) as max_exec_ms,rows,shared_blks_hit,shared_blks_read,temp_blks_written,
          case when query ilike '%ivx_autonomous_tasks_claim_batch%' then 'claim_batch'
            when query ilike '%ivx_autonomous_task_events%' then 'task_events'
            when query ilike '%ivx_autonomous_tasks%' then 'autonomous_tasks'
            when query ilike '%ivx_durable_documents%' then 'durable_documents'
            when query ilike '%pg_namespace%' or query ilike '%pg_proc%' then 'schema_catalog'
            when query ilike '%jv_deals%' then 'jv_deals' else 'other' end as query_family
          from ${schema}.pg_stat_statements where calls>0 order by total_exec_time desc limit 15;`]);
        else report.queryStatisticsUnavailable=true;
      }
    }
    report.ok=true;
  } catch (error) { report.error=probeFailure(error); }
  finally {
    if (connected && transaction) {
      try { await bounded(client.query('ROLLBACK'),2000); }
      catch (error) { report.ok=false;report.rollbackError=probeFailure(error); }
    }
    try { await bounded(client.end(),2000); }
    catch (error) { report.ok=false;report.closeError=probeFailure(error); }
    report.finishedAt=now();
  }
  return report;
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const report=await auditPostgres();
  writeFileSync('phase1-postgres-audit.json',JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
  if (!report.ok) process.exitCode=1;
}
