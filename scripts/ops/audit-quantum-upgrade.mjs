import { pathToFileURL } from 'node:url';

export const DEFAULT_SCAN_LIMIT = 500;
export const MAX_SCAN_LIMIT = 2000;
export const UPGRADE_LOG_KEY = 'self-upgrade/daily-upgrade-log.json';

// First select bounded identities through the existing (created_at, task_id)
// index. Only then inspect payload text; a final LIMIT alone cannot bound a scan.
// Match whole terms: "staging" and "pagination" are not evidence of "AGI".
export const UPGRADE_TASK_QUERY = `with candidates as materialized (
  select task_id, created_at from public.ivx_autonomous_tasks
  order by created_at desc, task_id desc limit ($1::int + 1)
), sample as materialized (
  select t.task_id, t.state, t.version, t.assigned_agent_number,
    t.lease_expires_at, t.last_heartbeat_at, t.created_at, t.updated_at, t.payload
  from candidates c join public.ivx_autonomous_tasks t using (task_id)
  order by c.created_at desc, c.task_id desc limit $1::int
), matches as materialized (
  select * from sample where concat(task_id, ' ', payload::text)
    ~* '(^|[^[:alnum:]])(quantum|agi|self[_[:space:]-]+upgrade)([^[:alnum:]]|$)'
), results as (
  select task_id, state, version::text, assigned_agent_number,
    lease_expires_at, last_heartbeat_at, created_at, updated_at,
    lease_expires_at > statement_timestamp() as lease_active,
    payload->>'state' as payload_state,
    left(payload->>'completedAt', 64) as reported_completed_at,
    case when payload->>'commitSha' ~ '^[0-9a-fA-F]{40}$' then payload->>'commitSha' end as commit_sha,
    left(payload->>'deploymentId', 100) as deployment_id,
    coalesce(jsonb_typeof(payload->'evidence'), 'missing') as evidence_format,
    case when jsonb_typeof(payload->'evidence') = 'array'
      then jsonb_array_length(payload->'evidence') end as evidence_count,
    (select coalesce(jsonb_agg(jsonb_build_object(
        'format', case when jsonb_typeof(e) <> 'object' then 'invalid'
          when e ? 'evidenceType' then 'canonical'
          when e ? 'step' then 'legacy' else 'unrecognized' end,
        'evidence_id', left(e->>'evidenceId',100),
        'evidence_type', left(e->>'evidenceType',80),
        'created_at', left(coalesce(e->>'createdAt', e->>'timestamp'),64),
        'legacy_step', left(e->>'step',80), 'legacy_status', left(e->>'status',40),
        'commit_sha', case when e->>'commitSha' ~ '^[0-9a-fA-F]{40}$' then e->>'commitSha' end,
        'deployment_id', left(e->>'deploymentId',100),
        'content_hash', case when e->>'contentHash' ~ '^[0-9a-fA-F]{16,128}$' then e->>'contentHash' end
      ) order by ordinal), '[]'::jsonb)
      from jsonb_array_elements(case when jsonb_typeof(payload->'evidence')='array'
        then payload->'evidence' else '[]'::jsonb end) with ordinality as evidence(e,ordinal)
      where ordinal <= 20) as evidence_preview
  from matches order by created_at desc, task_id desc limit 10
)
select statement_timestamp() as observed_at,
  (select count(*)::int from sample) as sampled_tasks,
  (select count(*) > $1::int from candidates) as older_tasks_unscanned,
  (select min(created_at) from sample) as oldest_sample_created_at,
  (select max(created_at) from sample) as newest_sample_created_at,
  (select count(*)::int from matches) as matches_in_sample,
  (select coalesce(jsonb_agg(r order by created_at desc, task_id desc),'[]'::jsonb) from results r) as tasks`;

// The daily scheduler records its own claims here. Reading the log does not
// independently verify those claims or activate the scheduler/provider.
export const UPGRADE_LOG_QUERY = `select statement_timestamp() as observed_at,
  d.doc_key is not null as document_found, d.updated_at,
  extract(epoch from statement_timestamp()-d.updated_at)::int as document_age_seconds,
  coalesce(jsonb_typeof(d.value),'missing') as entry_format,
  case when jsonb_typeof(d.value)='array' then jsonb_array_length(d.value) end as entry_count,
  (select coalesce(jsonb_agg(jsonb_build_object(
    'upgrade_id',left(e->>'upgradeId',100), 'timestamp',left(e->>'timestamp',64),
    'reported_success',case when jsonb_typeof(e->'success')='boolean' then e->'success' end,
    'reported_verified_10_of_10',case when jsonb_typeof(e->'verified10of10')='boolean' then e->'verified10of10' end,
    'reported_score',case when jsonb_typeof(e->'capabilityScoreOutOf10')='number' then e->'capabilityScoreOutOf10' end,
    'proof_hash',case when e->>'proofHash' ~ '^[0-9a-fA-F]{16,128}$' then e->>'proofHash' end
  ) order by ordinal),'[]'::jsonb)
  from jsonb_array_elements(case when jsonb_typeof(d.value)='array' then d.value else '[]'::jsonb end)
    with ordinality as log(e,ordinal) where ordinal <= 10) as entries
  from (select 1) seed left join public.ivx_durable_documents d on d.doc_key = $1`;

function safeError(error) {
  return typeof error?.code === 'string' && /^[A-Z0-9]{5}$/.test(error.code)
    ? `POSTGRES_${error.code}` : 'DATABASE_OPERATION_UNCONFIRMED';
}

function validScanLimit(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_SCAN_LIMIT;
}

async function readSection(client, sql, params) {
  try {
    await client.query('BEGIN READ ONLY');
    await client.query("SET LOCAL statement_timeout = '3000ms'");
    await client.query("SET LOCAL lock_timeout = '1000ms'");
    const { rows } = await client.query(sql, params);
    if (rows.length !== 1) throw new Error('Incomplete diagnostic result');
    await client.query('COMMIT');
    return { status: 'OBSERVED', data: rows[0] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return { status: 'UNAVAILABLE', error: safeError(error), data: null };
  }
}

export function summarizeUpgradeAudit(sections, scanLimit = DEFAULT_SCAN_LIMIT) {
  const tasks = sections.tasks.data;
  if (tasks) {
    tasks.finding = tasks.matches_in_sample > 0 ? 'KEYWORD_MATCHES_REQUIRE_REVIEW' : 'NO_MATCHES_IN_SCANNED_SAMPLE';
    tasks.results_truncated = tasks.matches_in_sample > 10;
    tasks.tasks = tasks.tasks.map(task => ({ ...task,
      evidence_preview_truncated: task.evidence_count > 20,
      evidence_review: task.evidence_format === 'missing' || task.evidence_format === 'null' || task.evidence_count === 0
        ? 'NO_EMBEDDED_EVIDENCE' : task.evidence_format !== 'array'
          ? 'INVALID_EVIDENCE_FORMAT' : 'REFERENCES_REQUIRE_INDEPENDENT_VERIFICATION',
      state_consistent: task.payload_state == null ? null : task.payload_state === task.state,
    }));
  }
  const complete = Object.values(sections).every(section => section.status === 'OBSERVED');
  return { mode: 'READ_ONLY_UPGRADE_AUDIT', state: complete ? 'AUDIT_COMPLETE' : 'AUDIT_INCOMPLETE',
    observedAt: new Date().toISOString(), scanLimit, resultLimit: 10,
    mutationsPerformed: 0, upgradeVerified: false, versionProgress: 'NOT_ASSESSED_SINGLE_SNAPSHOT',
    sections, exitCode: complete ? 0 : 2 };
}

export async function runQuantumUpgradeAudit({ env = process.env, scanLimit = DEFAULT_SCAN_LIMIT, createClient } = {}) {
  if (!validScanLimit(scanLimit)) return { state: 'INVALID_ARGUMENT', error: 'INVALID_SCAN_LIMIT', exitCode: 1, mutationsPerformed: 0 };
  const connectionString = [env.IVX_BUDGET_RECONCILIATION_DATABASE_URL, env.SUPABASE_DB_URL, env.DATABASE_URL]
    .find(value => typeof value === 'string' && value.trim())?.trim();
  if (!connectionString) return { state: 'CONFIGURATION_MISSING', error: 'DATABASE_URL_NOT_CONFIGURED',
    exitCode: 1, mutationsPerformed: 0, upgradeVerified: false };
  let client;
  let report;
  try {
    const factory = createClient ?? (async config => { const { Client } = await import('pg'); return new Client(config); });
    client = await factory({ connectionString, application_name: 'ivx_upgrade_audit',
      connectionTimeoutMillis: 5000, statement_timeout: 3000, query_timeout: 4000 });
    await client.connect();
    const tasks = await readSection(client, UPGRADE_TASK_QUERY, [scanLimit]);
    const dailyLog = await readSection(client, UPGRADE_LOG_QUERY, [UPGRADE_LOG_KEY]);
    report = summarizeUpgradeAudit({ tasks, dailyLog }, scanLimit);
  } catch (error) {
    report = { state: 'AUDIT_INCOMPLETE', error: safeError(error), exitCode: 1,
      mutationsPerformed: 0, upgradeVerified: false };
  } finally {
    if (client) {
      try { await client.end(); }
      catch { report = { ...report, state: 'AUDIT_INCOMPLETE', cleanupError: 'CONNECTION_CLOSE_UNCONFIRMED', exitCode: 1 }; }
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node scripts/ops/audit-quantum-upgrade.mjs [--scan-limit=1..2000]\nRead-only: inspect the latest 500 tasks by default and the daily upgrade log.\nExit 0 means the audit completed, not that an upgrade occurred. No raw payloads or evidence outputs are printed.');
  } else if (args.length > 1 || (args.length && !/^--scan-limit=[0-9]+$/.test(args[0]))) {
    console.error('INVALID_ARGUMENT: supported option is --scan-limit=1..2000.');
    process.exitCode = 1;
  } else {
    const scanLimit = args.length ? Number(args[0].split('=')[1]) : DEFAULT_SCAN_LIMIT;
    const report = await runQuantumUpgradeAudit({ scanLimit });
    console.log(JSON.stringify(report, null, 2));
    process.exitCode = report.exitCode;
  }
}
