import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { pathToFileURL } from 'node:url';

// One statement keeps capacity, groups and transaction observations in the
// same pg_stat_activity snapshot. Query text is deliberately not collected.
export const AUDIT_SQL = `
WITH activity AS MATERIALIZED (
  SELECT pid, datname, usename, application_name, client_addr::text,
    backend_type, state, wait_event_type, wait_event, backend_start,
    xact_start, query_start, state_change, query_id::text
  FROM pg_catalog.pg_stat_activity
), clients AS MATERIALIZED (
  SELECT * FROM activity WHERE backend_type = 'client backend'
), groups AS (
  SELECT datname, usename, coalesce(nullif(application_name, ''), 'unnamed_client') AS application_name,
    client_addr, count(*)::int AS connection_count,
    count(*) FILTER (WHERE state = 'idle')::int AS idle_count,
    count(*) FILTER (WHERE state = 'active')::int AS active_count,
    count(*) FILTER (WHERE state IN ('idle in transaction', 'idle in transaction (aborted)'))::int AS idle_in_transaction_count,
    count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lock_wait_count,
    count(*) FILTER (WHERE state IS NULL)::int AS hidden_state_count,
    extract(epoch FROM statement_timestamp() - min(backend_start))::double precision AS oldest_connection_seconds
  FROM clients GROUP BY datname, usename, application_name, client_addr
  ORDER BY connection_count DESC, application_name, datname, usename, client_addr
  LIMIT 51
), sessions AS (
  SELECT pid, datname, usename, application_name, state, wait_event_type, wait_event,
    extract(epoch FROM statement_timestamp() - xact_start)::double precision AS transaction_age_seconds,
    CASE WHEN state = 'active' THEN extract(epoch FROM statement_timestamp() - query_start)::double precision END AS active_query_age_seconds,
    extract(epoch FROM statement_timestamp() - state_change)::double precision AS state_age_seconds,
    pg_catalog.pg_blocking_pids(pid) AS blocking_pids, query_id
  FROM clients
  WHERE datname = current_database() AND pid <> pg_backend_pid()
    AND (xact_start < statement_timestamp() - interval '10 seconds'
      OR (state IN ('idle in transaction', 'idle in transaction (aborted)')
        AND state_change < statement_timestamp() - interval '10 seconds')
      OR wait_event_type = 'Lock')
  ORDER BY xact_start ASC NULLS LAST, pid LIMIT 51
)
SELECT statement_timestamp() AS captured_at, current_database() AS database_name,
  pg_backend_pid() AS audit_pid,
  current_setting('max_connections')::int AS max_connections,
  current_setting('superuser_reserved_connections')::int AS superuser_reserved_connections,
  coalesce(current_setting('reserved_connections', true), '0')::int AS reserved_connections,
  (SELECT count(*)::int FROM clients) AS client_connections,
  (SELECT count(*)::int FROM clients WHERE datname = current_database()) AS database_client_connections,
  (SELECT count(*)::int FROM clients WHERE state = 'idle') AS idle_clients,
  (SELECT count(*)::int FROM clients WHERE state = 'active') AS active_clients,
  (SELECT count(*)::int FROM clients WHERE state IN ('idle in transaction', 'idle in transaction (aborted)')) AS idle_in_transaction_clients,
  (SELECT count(*)::int FROM clients WHERE wait_event_type = 'Lock') AS lock_waiting_clients,
  (SELECT count(*)::int FROM clients WHERE state IS NULL) AS hidden_state_clients,
  (SELECT count(*)::int FROM activity WHERE backend_type <> 'client backend') AS other_backends,
  (SELECT count(*)::int FROM activity WHERE backend_type IS NULL) AS unclassified_backends,
  coalesce((SELECT jsonb_agg(g) FROM groups g), '[]'::jsonb) AS application_groups,
  coalesce((SELECT jsonb_agg(s) FROM sessions s), '[]'::jsonb) AS sessions_to_review
`;

class AuditFailure extends Error {
  constructor(code, stage) { super(code); this.code = code; this.stage = stage; }
}

function failureCode(error) {
  if (error instanceof AuditFailure) return error.code;
  const code = String(error?.code ?? '');
  return /^[0-9A-Z]{5}$/.test(code)
    || ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN'].includes(code)
    ? code : 'AUDIT_OPERATION_FAILED';
}

export function connectionConfig(env) {
  const raw = [env.IVX_CONNECTION_AUDIT_DATABASE_URL,
    env.IVX_BUDGET_RECONCILIATION_DATABASE_URL, env.DATABASE_URL]
    .find(value => typeof value === 'string' && value.trim())?.trim();
  if (!raw) throw new AuditFailure('MISSING_DATABASE_URL', 'configuration');
  let url;
  try { url = new URL(raw); } catch { throw new AuditFailure('INVALID_DATABASE_URL', 'configuration'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname) {
    throw new AuditFailure('INVALID_DATABASE_URL', 'configuration');
  }
  // pg URL options override Client config; retain our diagnostic time bounds.
  const overridden = new Set(['application_name', 'fallback_application_name', 'options',
    'connectiontimeoutmillis', 'statement_timeout', 'query_timeout', 'lock_timeout',
    'idle_in_transaction_session_timeout']);
  for (const key of [...url.searchParams.keys()]) {
    if (overridden.has(key.toLowerCase())) url.searchParams.delete(key);
  }
  let ssl;
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.pooler.supabase.com')) {
    // Use the same public CA as the backend, without disabling verification.
    ssl = { rejectUnauthorized: true, ca: [...rootCertificates,
      readFileSync(new URL('../../backend/certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8')] };
    for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert', 'ssl']) url.searchParams.delete(key);
  }
  return { connectionString: url.href, ...(ssl ? { ssl } : {}),
    application_name: 'ivx_connection_audit', connectionTimeoutMillis: 5000,
    statement_timeout: 3000, query_timeout: 4000, lock_timeout: 500,
    idle_in_transaction_session_timeout: 5000 };
}

export function interpretSnapshot(row) {
  const counters = ['max_connections', 'superuser_reserved_connections', 'reserved_connections',
    'client_connections', 'database_client_connections', 'idle_clients', 'active_clients',
    'idle_in_transaction_clients', 'lock_waiting_clients', 'hidden_state_clients',
    'other_backends', 'unclassified_backends'];
  if (!row || counters.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0)
    || !Array.isArray(row.application_groups) || !Array.isArray(row.sessions_to_review)) {
    throw new AuditFailure('INVALID_SNAPSHOT', 'interpretation');
  }
  const generalSlots = row.max_connections - row.superuser_reserved_connections - row.reserved_connections;
  if (generalSlots < 1) throw new AuditFailure('INVALID_CAPACITY_SETTINGS', 'interpretation');
  const completeVisibility = row.hidden_state_clients === 0 && row.unclassified_backends === 0;
  const findings = [];
  if (!completeVisibility) findings.push('ACTIVITY_VISIBILITY_INCOMPLETE');
  if (row.client_connections / generalSlots >= 0.8) findings.push('GENERAL_CONNECTION_CAPACITY_PRESSURE');
  if (row.lock_waiting_clients > 0) findings.push('LOCK_WAITS_OBSERVED');
  if (row.sessions_to_review.length) findings.push('LONG_TRANSACTIONS_OR_LOCK_WAITS_REQUIRE_REVIEW');
  return { ...row,
    application_groups: row.application_groups.slice(0, 50),
    sessions_to_review: row.sessions_to_review.slice(0, 50),
    groups_truncated: row.application_groups.length > 50,
    sessions_truncated: row.sessions_to_review.length > 50,
    audit_status: completeVisibility ? 'complete' : 'partial',
    client_capacity_percent: Number((100 * row.client_connections / row.max_connections).toFixed(1)),
    nominal_general_connection_slots: generalSlots,
    nominal_general_slots_remaining: Math.max(0, generalSlots - row.client_connections),
    audit_client_included_in_capacity: true,
    findings,
    leak_status: 'not_proven_by_snapshot',
    limitations: [
      'Idle clients and large groups can be normal pooled connections; neither proves a leak.',
      'Application names and IPs do not uniquely identify processes behind a pooler.',
      'A long transaction does not by itself prove a lock, memory pressure, or the cause of an HTTP 503.',
      'General slot headroom is nominal; role limits, pooler limits and application pool queues are not measured.',
      'No matching sessions means none were observed in this snapshot; it is not a fleet health certificate.',
    ],
  };
}

export async function runConnectionAudit({ env = process.env, ClientClass } = {}) {
  const config = connectionConfig(env);
  if (!ClientClass) ClientClass = (await import('pg')).default.Client;
  const client = new ClientClass(config);
  let failure, eventError, report, stage = 'connect';
  client.on('error', error => { eventError = error; });
  try {
    await client.connect();
    stage = 'begin_read_only';
    await client.query('BEGIN READ ONLY');
    // SET LOCAL also works through transaction pooling and expires at COMMIT.
    await client.query("SET LOCAL statement_timeout = '3s'; SET LOCAL lock_timeout = '500ms'; SET LOCAL idle_in_transaction_session_timeout = '5s'");
    stage = 'capture';
    const result = await client.query(AUDIT_SQL);
    if (result.rows?.length !== 1) throw new AuditFailure('INVALID_SNAPSHOT', stage);
    report = interpretSnapshot(result.rows[0]);
    stage = 'commit';
    await client.query('COMMIT');
    if (eventError) throw eventError;
  } catch (error) {
    failure = new AuditFailure(failureCode(error), error instanceof AuditFailure ? error.stage : stage);
  } finally {
    // Also closes failed connection attempts and rolls back failed read-only
    // transactions. Never issue recovery writes or terminate other backends.
    try { await client.end(); }
    catch (error) { failure ??= new AuditFailure(failureCode(error), 'disconnect'); }
  }
  if (eventError) failure ??= new AuditFailure(failureCode(eventError), 'connection_event');
  if (failure) throw failure;
  return report;
}

export async function main({ args = process.argv.slice(2), env = process.env, ClientClass,
  emit = console.log, emitError = console.error } = {}) {
  try {
    if (args.length) throw new AuditFailure('UNSUPPORTED_ARGUMENT', 'configuration');
    const report = await runConnectionAudit({ env, ClientClass });
    emit(JSON.stringify(report, null, 2));
    return report.audit_status === 'complete' ? 0 : 2;
  } catch (error) {
    // Error details can contain connection strings, SQL and parameters.
    emitError(JSON.stringify({ audit_status: 'failed',
      stage: error instanceof AuditFailure ? error.stage : 'initialization', code: failureCode(error) }));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await main();
}
