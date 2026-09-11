import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { normalizeStoredConnection, repairKnownConnection, connectionIssue, validateConnection, probeFailure } from './autonomous-db-sync.mjs';

export const PROJECT = 'kvclcdjmjghndxsngfzb';
const aliases = ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL'];
const RUNTIME_SERVICE='srv-d7t9ivreo5us73ftose0';
const RUNTIME_OWNER='tea-d7plj9beo5us73ch3ukg';

// Keep only fixed SQL vocabulary; literals and unknown identifiers cannot reach
// logs or artifacts, even if pg_stat_statements contains sensitive SQL.
const sqlVocabulary=new Set(`select with from where as and or not null is in any all order by asc desc limit offset
  insert into update delete set values on conflict do returning join left right inner outer cross lateral using
  group having union distinct case when then else end for skip locked true false begin commit rollback
  public count coalesce json_agg jsonb_agg jsonb_array_elements jsonb_build_object row_to_json to_json json_build_object
  array_agg min max sum now statement_timestamp current_setting nullif set_config json_to_record json_to_recordset
  jsonb_to_record jsonb_to_recordset pg_catalog text json jsonb integer bigint numeric timestamp timestamptz
  ivx_durable_documents ivx_durable_events ivx_autonomous_tasks ivx_autonomous_task_events
  ivx_autonomous_tasks_claim_batch ivx_autonomous_tasks_create_batch ivx_autonomous_tasks_start_batch
  ivx_autonomous_tasks_heartbeat_batch ivx_autonomous_tasks_release_worker ivx_autonomous_task_compare_and_set
  ivx_fleet_dashboard_observation ivx_work_evidence_hours ivx_senior_queue_patch ivx_senior_queue_claim
  ivx_senior_ledger_put value doc_key payload state task_id idempotency_key assigned_agent_number updated_at
  created_at lease_holder lease_expires_at worker_instance_id event_type event`.split(/\s+/));
export function statementShape(sql) {
  const tokens=[];const names=new Map();let i=0;
  const identifier=word=>{const lower=word.toLowerCase();if(sqlVocabulary.has(lower))return lower;
    if(!names.has(word))names.set(word,`identifier_${names.size+1}`);return names.get(word);};
  while(i<sql.length && tokens.length<1800) {
    const tail=sql.slice(i);let match;
    if((match=/^\s+/.exec(tail))) {i+=match[0].length;continue;}
    if(tail.startsWith('--')) {const end=sql.indexOf('\n',i+2);i=end<0?sql.length:end+1;continue;}
    if(tail.startsWith('/*')) {let depth=1;i+=2;while(i<sql.length&&depth){if(sql.startsWith('/*',i)){depth++;i+=2;}
      else if(sql.startsWith('*/',i)){depth--;i+=2;}else i++;}continue;}
    if((match=/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/.exec(tail))) {
      const end=sql.indexOf(match[0],i+match[0].length);i=end<0?sql.length:end+match[0].length;tokens.push('?');continue;}
    if(tail[0]==="'" || tail[0]==='"') {
      const quote=tail[0];let value='';i++;while(i<sql.length){if(sql[i]==='\\'){i+=2;continue;}
        if(sql[i]===quote){if(sql[i+1]===quote){value+=quote;i+=2;continue;}i++;break;}value+=sql[i++];}
      tokens.push(quote==='"'?identifier(value):'?');continue;
    }
    if((match=/^\$\d+|^\d+(?:\.\d+)?/.exec(tail))){i+=match[0].length;tokens.push('?');continue;}
    if((match=/^[A-Za-z_][A-Za-z_0-9$]*/.exec(tail))){i+=match[0].length;tokens.push(identifier(match[0]));continue;}
    if((match=/^(?:->>|->|::|<=|>=|<>|!=|[(),.*=+\-\/< >;\[\]])/.exec(tail))){i+=match[0].length;tokens.push(match[0]);continue;}
    i++;tokens.push('?');
  }
  return tokens.join(' ');
}

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
      "select reltuples::bigint as estimated_rows, pg_relation_size(oid) as heap_bytes, pg_total_relation_size(oid) as total_bytes from pg_class where oid=to_regclass('public.ivx_autonomous_tasks');"],
      ['idleTransactions',`select application_name,state,usename,count(*)::integer as connections,
        max(extract(epoch from clock_timestamp()-xact_start)) as max_transaction_seconds,
        case when query ilike 'COMMIT%' then 'commit' when query ilike 'BEGIN%' then 'begin'
          when query ilike 'SET%' then 'set' when query ilike '%ivx_durable_documents%' then 'durable_documents'
          when query ilike '%ivx_autonomous_tasks%' then 'autonomous_tasks' else 'other' end as last_statement_family
        from pg_stat_activity where state like 'idle in transaction%' and pid<>pg_backend_pid()
        group by application_name,state,usename,last_statement_family limit 30;`],
      ['tableStatistics',`select relname,n_live_tup,n_dead_tup,seq_scan,seq_tup_read,idx_scan,idx_tup_fetch,
        n_tup_ins,n_tup_upd,n_tup_del,n_tup_hot_upd,last_autovacuum,last_autoanalyze,
        pg_relation_size(relid) as heap_bytes,pg_total_relation_size(relid) as total_bytes
        from pg_stat_user_tables where schemaname='public' and relname in
        ('ivx_durable_documents','ivx_autonomous_tasks','ivx_autonomous_task_events','jv_deals');`],
      ['indexes',`select t.relname as table_name,c.relname as index_name,i.indisvalid,i.indisready,
        pg_get_indexdef(i.indexrelid) as definition from pg_index i join pg_class t on t.oid=i.indrelid
        join pg_class c on c.oid=i.indexrelid where i.indrelid in
        (to_regclass('public.ivx_autonomous_tasks'),to_regclass('public.ivx_durable_documents')) limit 40;`]];
    for (let index=0;index<measurements.length;index++) {
      const [name,query]=measurements[index];
      const start=elapsed();const result=await bounded(client.query(query),7000);
      if (!Array.isArray(result.rows) || (name==='metadata' && (result.rows.length!==1 || result.rows[0].read_only!=='on'))) {
        throw Error('Unexpected diagnostic shape');
      }
      const rows=name==='statementShapes'?result.rows.map(({query_text,...row})=>({...row,shape:statementShape(query_text)})):result.rows;
      report.measurements.push({name,at:now(),elapsedMs:Math.round(elapsed()-start),rows});
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
        if(schema==='public'||schema==='extensions') measurements.push(['statementShapes',`select queryid::text,
          left(query,16000) as query_text from ${schema}.pg_stat_statements where queryid in
          (3268397091923167603,-2792327436087087644,-8967737368402977499,2523043091432368203,
          -2303944876909706765,1156818850290747812,-7945457970706214271,4080096186774504574,
          -5566853358085852722,1918250860910811350) limit 10;`]);
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
