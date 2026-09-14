import { pathToFileURL } from 'node:url';

export const INFRA_DIAGNOSTIC_QUERIES = {
  connections: `select statement_timestamp() as observed_at,
    current_setting('max_connections')::int as max_connections,
    pg_has_role(current_user,'pg_read_all_stats','member') as full_stats_visibility,
    (select count(*)::int from pg_stat_activity where backend_type='client backend') as client_connections,
    (select count(*)::int from pg_stat_activity where backend_type='client backend' and state='idle') as idle_clients,
    (select coalesce(jsonb_agg(g order by connections desc),'[]'::jsonb) from (
      select application_name, usename, datname, backend_type, count(*)::int as connections
      from pg_stat_activity where state='idle' and pid<>pg_backend_pid()
        and application_name not ilike '%supabase%' and application_name not ilike '%pooler%'
      group by application_name, usename, datname, backend_type
    ) g) as proposed_purge_targets`,
  budget: `select statement_timestamp() as observed_at,
    public.ivx_ai_budget_status() - 'authorizationRef' as policy,
    (select coalesce(jsonb_agg(r order by created_at,reservation_id),'[]'::jsonb) from (
      select reservation_id, status, reserved_nano::text, settled_upper_nano::text,
        generation_id is not null as has_provider_id, created_at, completed_at
      from public.ivx_ai_budget_reservations
      where status='reserved' and generation_id is null
        and created_at < statement_timestamp() - interval '15 minutes'
      order by created_at,reservation_id limit 113
    ) r) as stale_reserved_sample`,
  tasks: `select task_id, state, payload->>'state' as payload_state,
    version::text as version, lease_expires_at, updated_at,
    lease_expires_at > statement_timestamp() as lease_active,
    (coalesce(payload->'evidence','[]'::jsonb) <> '[]'::jsonb
      or nullif(payload->>'commitSha','') is not null
      or nullif(payload->>'deploymentId','') is not null
      or coalesce(payload->>'recordsChanged','0') <> '0') as has_embedded_evidence,
    statement_timestamp() as observed_at
    from public.ivx_autonomous_tasks where state='FAILED'
    order by updated_at desc,task_id limit 11`,
  emergencyStop: `select statement_timestamp() as observed_at,
    count(*)::int as authority_rows, bool_or(active) as active
    from public.ivx_agent_controls where control_name='emergency_stop'`,
};

function safeError(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
    ? `POSTGRES_${error.code}` : 'DATABASE_OPERATION_UNCONFIRMED';
}

export async function collectInfraDiagnostics(client) {
  const sections = {};
  for (const [name, sql] of Object.entries(INFRA_DIAGNOSTIC_QUERIES)) {
    try {
      await client.query('BEGIN READ ONLY');
      await client.query("SET LOCAL statement_timeout = '3000ms'");
      await client.query("SET LOCAL lock_timeout = '1000ms'");
      const { rows } = await client.query(sql);
      await client.query('COMMIT');
      sections[name] = { status: 'OBSERVED', rows };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      sections[name] = { status: 'UNAVAILABLE', error: safeError(error), rows: null };
    }
  }
  const budget = sections.budget.rows?.[0];
  if (budget?.stale_reserved_sample) {
    budget.sample_truncated = budget.stale_reserved_sample.length > 112;
    budget.stale_reserved_sample = budget.stale_reserved_sample.slice(0, 112);
    budget.next_step = budget.stale_reserved_sample.length
      ? 'VERIFY_STOPPED_EXECUTION_AND_RECONCILE_PROVIDER_EVIDENCE' : 'NO_STALE_RESERVATIONS_MATCH_FILTER';
  }
  if (sections.tasks.rows) {
    sections.tasks.sampleTruncated = sections.tasks.rows.length > 10;
    sections.tasks.rows = sections.tasks.rows.slice(0, 10).map(row => ({
      ...row, next_step: row.lease_active === true ? 'ACTIVE_LEASE_DO_NOT_RESET'
        : row.payload_state !== row.state ? 'CANONICAL_STATE_RECONCILIATION'
          : row.has_embedded_evidence === true ? 'RECONCILE_EXISTING_EVIDENCE'
          : 'TERMINAL_TASK_REVIEW_WITH_CANONICAL_ENGINE',
    }));
  }
  return { mode: 'DIAGNOSTIC_ONLY', observedAt: new Date().toISOString(),
    state: Object.values(sections).every(section => section.status === 'OBSERVED')
      ? 'DIAGNOSTICS_COMPLETE' : 'DIAGNOSTICS_INCOMPLETE',
    mutationsPerformed: 0, recoveryVerified: false, readiness: 'NOT_CHECKED', sections };
}

export async function runInfraControlTower({ env = process.env, createClient } = {}) {
  const connectionString = [env.IVX_BUDGET_RECONCILIATION_DATABASE_URL, env.SUPABASE_DB_URL, env.DATABASE_URL]
    .find(value => typeof value === 'string' && value.trim())?.trim();
  if (!connectionString) return { state: 'CONFIGURATION_MISSING', error: 'DATABASE_URL_NOT_CONFIGURED',
    mutationsPerformed: 0, recoveryVerified: false, exitCode: 1 };
  let client;
  let report;
  try {
    const factory = createClient ?? (async config => { const { Client } = await import('pg'); return new Client(config); });
    client = await factory({ connectionString, application_name: 'ivx_infra_control_tower_audit',
      connectionTimeoutMillis: 5000, statement_timeout: 3000, query_timeout: 4000 });
    await client.connect();
    report = await collectInfraDiagnostics(client);
    report.exitCode = report.state === 'DIAGNOSTICS_COMPLETE' ? 0 : 2;
  } catch (error) {
    report = { state: 'DIAGNOSTICS_INCOMPLETE', error: safeError(error),
      mutationsPerformed: 0, recoveryVerified: false, exitCode: 1 };
  } finally {
    if (client) {
      try { await client.end(); }
      catch { report = { ...report, state: 'DIAGNOSTICS_INCOMPLETE', cleanupError: 'CONNECTION_CLOSE_UNCONFIRMED', exitCode: 1 }; }
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: infra-control-tower.sh [--diagnose]\nRead-only diagnostics; exit 0 means diagnostics completed, not fleet recovery.\nDatabase binding: IVX_BUDGET_RECONCILIATION_DATABASE_URL, SUPABASE_DB_URL, or DATABASE_URL.');
  } else if (args.length > 1 || (args.length && args[0] !== '--diagnose')) {
    console.error('INVALID_ARGUMENT: supported mode is --diagnose.');
    process.exitCode = 1;
  } else {
    const report = await runInfraControlTower();
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.exitCode;
  }
}
