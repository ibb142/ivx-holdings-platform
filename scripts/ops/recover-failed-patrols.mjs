import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { rootCertificates } from 'node:tls';
import { pathToFileURL } from 'node:url';

export const PROJECT = 'kvclcdjmjghndxsngfzb';
const MAX_BATCH = 10;

// Evaluate with the database clock, both during preview and after locking the row.
// A FAILED row is not necessarily abandoned or entitled to another retry.
const ELIGIBILITY = `case
  when t.state <> 'FAILED' then 'STATE_CHANGED'
  when jsonb_typeof(t.payload) is distinct from 'object'
    or t.payload->>'taskId' is distinct from t.task_id then 'INVALID_PAYLOAD'
  when t.payload->>'state' is distinct from 'FAILED' then 'PAYLOAD_STATE_MISMATCH'
  when t.version < 1 or t.version >= 9223372036854775807 then 'INVALID_VERSION'
  when t.lease_expires_at > clock_timestamp() then 'LIVE_LEASE'
  when (t.lease_holder is not null or t.worker_instance_id is not null)
    and t.lease_expires_at is null then 'UNKNOWN_LEASE_EXPIRY'
  when t.last_heartbeat_at >= clock_timestamp() - interval '5 minutes' then 'RECENT_HEARTBEAT'
  when coalesce(t.payload->>'retryCount','0') !~ '^[0-9]{1,9}$'
    or coalesce(t.payload->>'maxRetries','3') !~ '^[0-9]{1,9}$' then 'INVALID_RETRY_STATE'
  when coalesce(t.payload->>'retryCount','0')::int >= coalesce(t.payload->>'maxRetries','3')::int
    then 'RETRY_ATTEMPTS_EXHAUSTED'
  when t.payload->>'retryStartedAt' is not null
    and not pg_input_is_valid(t.payload->>'retryStartedAt','timestamp with time zone')
    then 'INVALID_RETRY_TIMESTAMP'
  when t.payload->>'retryStartedAt' is not null and (
    (t.payload->>'retryStartedAt')::timestamptz > clock_timestamp()
    or (t.payload->>'retryStartedAt')::timestamptz <= clock_timestamp() - interval '15 minutes')
    then 'RETRY_TIME_BUDGET_EXHAUSTED'
  when t.payload->>'retryNotBefore' is not null
    and not pg_input_is_valid(t.payload->>'retryNotBefore','timestamp with time zone')
    then 'INVALID_RETRY_TIMESTAMP'
  when (t.payload->>'retryNotBefore')::timestamptz > clock_timestamp() then 'RETRY_NOT_DUE'
  when t.payload->>'error' in ('retry attempt_budget exhausted','retry time_budget exhausted')
    then 'RETRY_BUDGET_EXHAUSTED'
  else 'ELIGIBLE' end`;

export function previewQuery({ taskIds = [], limit = MAX_BATCH } = {}) {
  validateSelection(taskIds, limit);
  // Bound heap/JSON reads before inspecting payload. Do not scan historical JSON
  // looking for a mismatch, or return full evidence documents to the client.
  return {
    text: `with bounded as materialized (
      select task_id,idempotency_key,state,version,lease_holder,worker_instance_id,
        lease_expires_at,last_heartbeat_at,updated_at,payload
      from public.ivx_autonomous_tasks
      where state='FAILED' ${taskIds.length ? 'and task_id=any($2::text[])' : ''}
      order by updated_at desc,task_id limit $1
    ) select t.task_id,t.idempotency_key,t.version::text as version,
      t.lease_holder,t.worker_instance_id,t.lease_expires_at,t.last_heartbeat_at,
      t.payload->>'retryCount' as retry_count,t.payload->>'maxRetries' as max_retries,
      ${ELIGIBILITY} as eligibility,clock_timestamp() as inspected_at
      from bounded t order by t.updated_at desc,t.task_id`,
    values: taskIds.length ? [limit, taskIds] : [limit],
  };
}

export const RECOVER_SQL = `with locked as materialized (
  select t.* from public.ivx_autonomous_tasks t
  where t.task_id=$1 and t.state='FAILED' and t.version=$2::bigint
  for update skip locked
), eligible as materialized (
  select t.*,clock_timestamp() as recovered_at from locked t
  where (${ELIGIBILITY})='ELIGIBLE'
), updated as (
  update public.ivx_autonomous_tasks t set
    state='QUEUED',lease_holder=null,worker_instance_id=null,
    lease_expires_at=null,last_heartbeat_at=null,
    version=t.version+1,updated_at=e.recovered_at,
    payload=t.payload || jsonb_build_object(
      'state','QUEUED','leaseHolder',null,'workerInstanceId',null,
      'leaseExpiresAt',null,'lastHeartbeatAt',null,
      'completedAt',null,'attemptStartedAt',null,'error',null,
      'retryCount',coalesce(t.payload->>'retryCount','0')::int+1,
      'retryStartedAt',coalesce(t.payload->>'retryStartedAt',e.recovered_at::text),
      'retryNotBefore',null,'updatedAt',e.recovered_at::text,
      'recoveredAt',e.recovered_at::text,'recoveryRunId',$3::text)
  from eligible e where t.task_id=e.task_id and t.version=e.version
  returning t.task_id,t.version::text as version,t.updated_at
), audited as (
  insert into public.ivx_autonomous_task_events(event_type,task_id,worker_instance_id,event,created_at)
  select 'manual_failed_task_requeued',u.task_id,e.worker_instance_id,
    jsonb_build_object('recoveryRunId',$3::text,'reason',$4::text,
      'fromState','FAILED','toState','QUEUED','previousVersion',e.version::text,
      'newVersion',u.version,'previousLeaseHolder',e.lease_holder,
      'previousWorkerInstanceId',e.worker_instance_id,
      'previousLeaseExpiresAt',e.lease_expires_at,'previousHeartbeatAt',e.last_heartbeat_at,
      'previousError',e.payload->'error','previousCompletedAt',e.payload->'completedAt',
      'previousAttemptStartedAt',e.payload->'attemptStartedAt',
      'previousRetryCount',e.payload->'retryCount','previousRetryStartedAt',e.payload->'retryStartedAt'),
    u.updated_at
  from updated u join eligible e using(task_id)
  returning task_id,event_id::text as event_id
) select u.task_id,u.version,a.event_id from updated u left join audited a using(task_id)`;

function validateSelection(taskIds, limit) {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) throw Error('INVALID_LIMIT: use 1..10');
  if (!Array.isArray(taskIds) || taskIds.length > MAX_BATCH
    || taskIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(id))
    || new Set(taskIds).size !== taskIds.length) throw Error('INVALID_TASK_IDS');
  if (taskIds.length > limit) throw Error('LIMIT_SMALLER_THAN_TASK_IDS');
}

async function begin(client, readOnly = false) {
  await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN');
  // Session startup settings alone are not reliable through a transaction pooler.
  await client.query("SET LOCAL statement_timeout='10s'");
  await client.query("SET LOCAL lock_timeout='1s'");
  await client.query("SET LOCAL idle_in_transaction_session_timeout='15s'");
}

export async function previewRecovery(client, options = {}) {
  const query = previewQuery(options);
  try {
    await begin(client, true);
    const { rows } = await client.query(query.text, query.values);
    await client.query('COMMIT');
    return rows;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

export async function recoverTask(client, row, { runId, reason }) {
  if (!/^[1-9][0-9]{0,18}$/.test(String(row.version))) throw Error('INVALID_VERSION');
  let committing = false;
  try {
    await begin(client);
    const result = await client.query(RECOVER_SQL, [row.task_id, String(row.version), runId, reason]);
    if (result.rows.some(updated => !updated.event_id)) throw Error('AUDIT_NOT_WRITTEN');
    committing = true;
    await client.query('COMMIT');
    // Success is reported only after COMMIT acknowledgement.
    return result.rows[0] ?? null;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    if (committing) {
      const uncertain = Error('COMMIT_OUTCOME_UNKNOWN: inspect task and recoveryRunId before retrying');
      uncertain.code = 'COMMIT_OUTCOME_UNKNOWN';
      throw uncertain;
    }
    throw error;
  }
}

export async function runRecovery(client, { apply = false, taskIds = [], limit = MAX_BATCH, reason = '' } = {}) {
  validateSelection(taskIds, limit);
  if (apply && (!taskIds.length || !reason.trim())) throw Error('APPLY_REQUIRES_TASK_IDS_AND_REASON');
  const rows = await previewRecovery(client, { taskIds, limit });
  const report = { mode: apply ? 'LIVE_APPLY' : 'DRY_RUN_PREVIEW', runId: randomUUID(),
    scanned: rows.length, applied: [], skipped: [], candidates: rows, errors: [] };
  for (const id of taskIds) if (!rows.some(row => row.task_id === id)) {
    report.skipped.push({ task_id: id, reason: 'NOT_FOUND_OR_NOT_FAILED' });
  }
  for (const row of rows) {
    if (row.eligibility !== 'ELIGIBLE') {
      report.skipped.push({ task_id: row.task_id, reason: row.eligibility });
      continue;
    }
    if (!apply) continue;
    try {
      const updated = await recoverTask(client, row, { runId: report.runId, reason });
      if (updated) report.applied.push(updated);
      else report.skipped.push({ task_id: row.task_id, reason: 'CHANGED_LOCKED_OR_INELIGIBLE' });
    } catch (error) {
      report.errors.push({ task_id: row.task_id, code: error.code ?? 'RECOVERY_FAILED' });
      // Preserve acknowledged earlier commits; never retry an uncertain commit.
      break;
    }
  }
  return report;
}

export function parseArgs(args) {
  const options = { apply: false, taskIds: [], limit: MAX_BATCH, reason: '' };
  const seen = new Set();
  for (const arg of args) {
    const name = arg.split('=')[0];
    if (seen.has(name)) throw Error('DUPLICATE_ARGUMENT');
    seen.add(name);
    if (arg === '--apply') options.apply = true;
    else if (arg.startsWith('--task-ids=')) options.taskIds = arg.slice(11).split(',');
    else if (arg.startsWith('--limit=')) options.limit = Number(arg.slice(8));
    else if (arg.startsWith('--reason=')) options.reason = arg.slice(9).trim();
    else throw Error('UNKNOWN_ARGUMENT');
  }
  validateSelection(options.taskIds, options.limit);
  if (options.reason.length > 500) throw Error('REASON_TOO_LONG');
  if (options.apply && (!options.taskIds.length || !options.reason)) throw Error('APPLY_REQUIRES_TASK_IDS_AND_REASON');
  return options;
}

export function clientOptions(env) {
  const raw = env.IVX_PATROL_RECOVERY_DATABASE_URL || env.IVX_BUDGET_RECONCILIATION_DATABASE_URL || env.DATABASE_URL;
  if (!raw?.trim()) throw Error('DATABASE_URL_REQUIRED');
  let url;
  try { url = new URL(raw); } catch { throw Error('INVALID_DATABASE_URL'); }
  const direct = url.hostname === `db.${PROJECT}.supabase.co`;
  const pooler = url.hostname.endsWith('.pooler.supabase.com')
    && decodeURIComponent(url.username) === `postgres.${PROJECT}`;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler)) throw Error('PROJECT_BINDING_MISMATCH');
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert','ssl']) url.searchParams.delete(key);
  return { connectionString: url.href, application_name: 'ivx_failed_patrol_recovery',
    connectionTimeoutMillis: 5000, query_timeout: 12000,
    ssl: { rejectUnauthorized: true, ca: [...rootCertificates,
      readFileSync(new URL('../../backend/certs/supabase-prod-ca-2021.crt', import.meta.url), 'utf8')] } };
}

export async function main(args = process.argv.slice(2), env = process.env, Client = pg.Client, log = console.log) {
  const options = parseArgs(args);
  const client = new Client(clientOptions(env));
  try {
    await client.connect();
    const report = await runRecovery(client, options);
    log(JSON.stringify(report, null, 2));
    return report.errors.length ? 1 : 0;
  } finally {
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    // Do not print connection strings, payloads or database error detail.
    const validationCode = String(error.message ?? '').split(':')[0];
    const code = error.code ?? (/^[A-Z_]{3,64}$/.test(validationCode) ? validationCode : 'RECOVERY_UNAVAILABLE');
    console.error(JSON.stringify({ ok: false, code,
      message: 'Recuperación no completada. Revise argumentos, conexión y evidencia antes de reintentar.' }));
    process.exitCode = 1;
  });
}
