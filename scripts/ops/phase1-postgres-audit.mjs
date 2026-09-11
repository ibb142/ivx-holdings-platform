import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { normalizeStoredConnection, repairKnownConnection, connectionIssue, validateConnection, probeFailure } from './autonomous-db-sync.mjs';

export const PROJECT = 'kvclcdjmjghndxsngfzb';
const aliases = ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL'];
export const SNAPSHOT = `select clock_timestamp() as observed_at,
  current_setting('transaction_read_only') as read_only,
  current_setting('max_connections')::integer as max_connections,
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
export async function auditPostgres({ env=process.env, makeClient=config=>new pg.Client(config),
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
    for (const [name,query] of [['metadata',SNAPSHOT],['queueCounts',
      'select state,count(*)::integer as tasks from public.ivx_autonomous_tasks group by state order by state;']]) {
      const start=elapsed();const result=await bounded(client.query(query),7000);
      if (!Array.isArray(result.rows) || (name==='metadata' && (result.rows.length!==1 || result.rows[0].read_only!=='on'))) {
        throw Error('Unexpected diagnostic shape');
      }
      report.measurements.push({name,at:now(),elapsedMs:Math.round(elapsed()-start),rows:result.rows});
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
