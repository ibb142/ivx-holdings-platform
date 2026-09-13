import { Pool, type PoolClient } from 'pg';
import { execFileSync } from 'node:child_process';
import { emergencyStopPostgresConfig } from '../../backend/services/ivx-emergency-stop-postgres';
import { observePostgresPoolErrors } from '../../backend/services/ivx-postgres-deadline';

export const CONNECTION_DIAGNOSTIC_SQL = `
with activity as materialized (
  select pid, datname, usename, application_name, state, backend_type, wait_event_type
  from pg_stat_activity
), purge_matches as (
  select * from activity where state = 'idle' and pid <> pg_backend_pid()
    and application_name not ilike '%supabase%'
    and application_name not ilike '%pooler%' and backend_type = 'client backend'
), groups as (
  select datname, usename, application_name, count(*)::int as connections
  from purge_matches group by datname, usename, application_name
  order by connections desc, datname, usename, application_name limit 20
)
select jsonb_build_object(
  'observedAt', statement_timestamp(), 'database', current_database(),
  'observerRole', current_user,
  'canReadAllStats', pg_has_role(current_user, 'pg_read_all_stats', 'MEMBER')
    or coalesce((select rolsuper from pg_roles where rolname = current_user), false),
  'maxConnections', current_setting('max_connections')::int,
  'clusterClientBackends', count(*) filter (where backend_type = 'client backend'),
  'databaseClientBackends', count(*) filter (where backend_type = 'client backend' and datname = current_database()),
  'databaseActive', count(*) filter (where backend_type = 'client backend' and datname = current_database() and state = 'active'),
  'databaseIdle', count(*) filter (where backend_type = 'client backend' and datname = current_database() and state = 'idle'),
  'databaseIdleInTransaction', count(*) filter (where backend_type = 'client backend' and datname = current_database() and state like 'idle in transaction%'),
  'databaseLockWaiters', count(*) filter (where backend_type = 'client backend' and datname = current_database() and wait_event_type = 'Lock'),
  'originalPurgeMatches', (select count(*) from purge_matches),
  'originalPurgeMatchGroups', coalesce((select jsonb_agg(to_jsonb(g)) from groups g), '[]'::jsonb)
) as report from activity`;

export const FAILED_TASK_DIAGNOSTIC_SQL = `
with sample as materialized (
  select task_id, version::text as version, state, updated_at,
    jsonb_typeof(payload) as payload_kind,
    payload->>'state' as payload_state,
    lease_holder, worker_instance_id, lease_expires_at, last_heartbeat_at,
    lease_expires_at > statement_timestamp() as lease_active,
    case when jsonb_typeof(payload->'evidence') = 'array'
      then jsonb_array_length(payload->'evidence') else null end as evidence_count,
    (nullif(payload->>'commitSha', '') is not null
      or nullif(payload->>'deploymentId', '') is not null) as has_result_reference
  from public.ivx_autonomous_tasks
  where state = 'FAILED'
  order by updated_at desc, task_id limit 11
), visible as (
  select * from sample order by updated_at desc, task_id limit 10
)
select jsonb_build_object(
  'observedAt', statement_timestamp(), 'sampleLimit', 10,
  'hasMore', (select count(*) > 10 from sample),
  'budgetReconciliation', 'NOT_CHECKED',
  'tasks', coalesce((select jsonb_agg(to_jsonb(v) || jsonb_build_object(
    'nextStep', case
      when payload_kind is distinct from 'object' or payload_state is distinct from state then 'CANONICAL_PAYLOAD_REVIEW'
      when lease_active is true then 'ACTIVE_LEASE_DO_NOT_RESET'
      when coalesce(evidence_count, 0) > 0 or has_result_reference then 'RECONCILE_EXISTING_EVIDENCE'
      else 'TERMINAL_TASK_REVIEW' end,
    'retryAuthorized', false)) from visible v), '[]'::jsonb)
) as report`;

type Query = (sql: string) => Promise<{ rows: Array<{ report: Record<string, unknown> }> }>;
export async function collectInfraDiagnostic(query: Query) {
  const read = async (sql: string) => {
    const { rows } = await query(sql);
    const report = rows[0]?.report;
    if (rows.length !== 1 || !report || typeof report !== 'object' || Array.isArray(report)
      || typeof report.observedAt !== 'string' || !Number.isFinite(Date.parse(report.observedAt))) {
      throw new Error('INFRA_DIAGNOSTIC_INCOMPLETE');
    }
    return report;
  };
  const connections = await read(CONNECTION_DIAGNOSTIC_SQL);
  const failedTasks = await read(FAILED_TASK_DIAGNOSTIC_SQL);
  return { status: 'DIAGNOSTIC_COMPLETE', recoveryCertified: false,
    mutationsPerformed: 0, connectionsTerminated: 0, tasksRequeued: 0,
    connections, failedTasks };
}

export function diagnosticConfig(env: NodeJS.ProcessEnv) {
  const selected = [env.IVX_BUDGET_RECONCILIATION_DATABASE_URL, env.SUPABASE_DB_URL, env.DATABASE_URL]
    .find(value => value?.trim())?.trim();
  // Validate the chosen binding against the configured Supabase project without
  // replacing the caller's environment or putting credentials in process args.
  const config = emergencyStopPostgresConfig({ ...env, SUPABASE_DB_URL: selected, DATABASE_URL: selected });
  return { ...config, application_name: 'ivx_infra_diagnostic', max: 1,
    connectionTimeoutMillis: 5000, statement_timeout: 4500, query_timeout: 5500,
    idleTimeoutMillis: 1000 };
}

if (import.meta.main) {
  let pool: Pool | undefined;
  let client: PoolClient | undefined;
  let connectionFailure: Error | null = null;
  let stage = 'configuration';
  const onError = (error: Error) => { connectionFailure = error; };
  try {
    if (process.argv.length !== 2) throw new Error('UNSUPPORTED_ARGUMENTS');
    const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: import.meta.dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    pool = new Pool(diagnosticConfig(process.env));
    observePostgresPoolErrors(pool, 'infra_diagnostic');
    stage = 'connect';
    client = await pool.connect();
    client.on('error', onError);
    stage = 'read-only-diagnostic';
    await client.query("BEGIN READ ONLY; SET LOCAL statement_timeout = '4500ms'; SET LOCAL lock_timeout = '1s'; SET LOCAL idle_in_transaction_session_timeout = '5s'");
    const report = await collectInfraDiagnostic(sql => client!.query(sql));
    await client.query('COMMIT');
    if (connectionFailure) throw connectionFailure;
    console.log(JSON.stringify({ ...report, sourceCommit, productionCommitVerified: false }, null, 2));
  } catch {
    console.error(JSON.stringify({ status: 'DIAGNOSTIC_UNAVAILABLE', stage, recoveryCertified: false,
      error: 'Verify same-project database binding, read privileges and connectivity. No successful recovery is certified.' }));
    process.exitCode = 1;
  } finally {
    // This one-shot observer never returns a potentially uncertain session to a pool.
    if (client) { client.release(true); client.removeListener('error', onError); }
    if (pool) await pool.end().catch(() => { process.exitCode = 1; });
  }
}
