import { randomUUID } from 'node:crypto';

// Manual operator recovery is restricted to selected Landing QA patrols.
// The normal terminal-state guard, claim RPC and all budget records are unchanged.
export const PROJECT = 'kvclcdjmjghndxsngfzb';
const COLUMNS = 'task_id,idempotency_key,state,version::text,assigned_agent_number,lease_holder,worker_instance_id,lease_expires_at,last_heartbeat_at,payload,clock_timestamp() as observed_at';
export const READ_TASKS = 'SELECT ' + COLUMNS + ' FROM public.ivx_autonomous_tasks WHERE task_id = ANY($1::text[]) ORDER BY task_id';
const LOCK_TASK = 'SELECT ' + COLUMNS + ' FROM public.ivx_autonomous_tasks WHERE task_id=$1 FOR UPDATE NOWAIT';

export function validateRecoveryInput(input) {
  if (!input || !/^[a-f0-9]{40}$/.test(input.sourceSha ?? '')
      || !Array.isArray(input.taskIds) || input.taskIds.length < 1 || input.taskIds.length > 10
      || input.taskIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9:_./-]{1,200}$/.test(id))
      || new Set(input.taskIds).size !== input.taskIds.length
      || typeof input.apply !== 'boolean'
      || (input.apply && (typeof input.reason !== 'string' || !input.reason.trim()
        || input.reason.length > 500 || /[\x00-\x1f\x7f]/.test(input.reason)))) {
    throw new Error('RECOVERY_REQUIRES_EXACT_SHA_AND_1_TO_10_UNIQUE_TASK_IDS; --apply also requires --reason');
  }
}

export function validateDatabaseBinding(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('VERIFIED_PROJECT_DATABASE_BINDING_REQUIRED'); }
  const direct = url.hostname === 'db.' + PROJECT + '.supabase.co';
  const pooler = url.hostname.endsWith('.pooler.supabase.com')
    && decodeURIComponent(url.username) === 'postgres.' + PROJECT;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || (!direct && !pooler)
      || url.pathname !== '/postgres') throw new Error('VERIFIED_PROJECT_DATABASE_BINDING_REQUIRED');
  // pg must not replace verified CA options with URL sslmode settings.
  for (const key of ['sslmode','sslcert','sslkey','sslrootcert','ssl']) url.searchParams.delete(key);
  return url.href;
}

function epoch(value) { return value instanceof Date ? value.getTime() : Date.parse(value); }
function sameTime(a, b) {
  return a == null && b == null || a != null && b != null
    && Number.isFinite(epoch(a)) && epoch(a) === epoch(b);
}

export function recoveryBlocker(row, sourceSha) {
  if (!row) return 'TASK_NOT_FOUND';
  const p = row.payload;
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.taskId !== row.task_id
      || p.idempotencyKey !== row.idempotency_key || p.state !== row.state
      || p.assignedAgentNumber !== row.assigned_agent_number
      || (p.leaseHolder ?? null) !== (row.lease_holder ?? null)
      || !sameTime(p.leaseExpiresAt, row.lease_expires_at)
      || !sameTime(p.lastHeartbeatAt, row.last_heartbeat_at)
      || typeof row.version !== 'string' || !/^[1-9][0-9]*$/.test(row.version)
      || !Number.isFinite(epoch(row.observed_at))) return 'CANONICAL_IDENTITY_REVIEW';
  const suffix = row.idempotency_key.match(/^landing-p0-patrol:([a-f0-9]{40}):ia-([0-9]{3})$/);
  if (!suffix || suffix[1] !== sourceSha || Number(suffix[2]) !== row.assigned_agent_number
      || row.assigned_agent_number < 1 || row.assigned_agent_number > 112 || p.taskType !== 'qa') {
    return 'NOT_A_SELECTED_SHA_QA_PATROL';
  }
  if (row.state !== 'FAILED') return 'STATE_' + row.state;
  if (row.lease_expires_at != null && !(epoch(row.lease_expires_at) <= epoch(row.observed_at))
      || row.lease_expires_at == null && (row.lease_holder || row.worker_instance_id)) return 'LEASE_AUTHORITY_REVIEW';
  if (p.retry_attempts_exhausted || !Number.isInteger(p.retryCount) || p.retryCount < 0
      || !Number.isInteger(p.maxRetries) || p.maxRetries < 0 || p.retryCount >= p.maxRetries) return 'RETRY_ATTEMPTS_EXHAUSTED';
  if (p.retryStartedAt != null && (!Number.isFinite(Date.parse(p.retryStartedAt))
      || Date.parse(p.retryStartedAt) > epoch(row.observed_at)
      || epoch(row.observed_at) - Date.parse(p.retryStartedAt) >= 900000)) return 'RETRY_TIME_BUDGET_EXHAUSTED';
  if (p.commitSha || p.deploymentId || !Array.isArray(p.filesChanged) || p.filesChanged.length
      || !Array.isArray(p.evidence) || p.evidence.some(e => !e || typeof e !== 'object'
        || ['source_file_changed','code_diff','database_mutation','deployment_id'].includes(e.evidenceType))) {
    return 'RECONCILE_EXISTING_SIDE_EFFECTS';
  }
  const error = String(p.error ?? '') + ' ' + String(p.blocker ?? '');
  if (/retry.*exhausted|unauthori[sz]ed|forbidden|permission denied|owner.approval|missing credential|\b(400|401|403|404|422|42501|42703|42P01)\b/i.test(error)
      || !/timeout|timed out|ECONNRESET|ECONNREFUSED|EAI_AGAIN|fetch failed|service unavailable|\b(408|429|502|503|504)\b/i.test(error)) return 'NON_TRANSIENT_FAILURE_REVIEW';
  return null;
}

function summary(row, blocker) {
  return { taskId: row?.task_id ?? null, version: row?.version ?? null,
    state: row?.state ?? null, retryCount: row?.payload?.retryCount ?? null,
    maxRetries: row?.payload?.maxRetries ?? null, blocker };
}

export async function recoverFailedPatrols({ client, ...input }) {
  validateRecoveryInput(input);
  const snapshot = await client.query(READ_TASKS, [input.taskIds]);
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length > input.taskIds.length
      || new Set(snapshot.rows.map(r => r.task_id)).size !== snapshot.rows.length
      || snapshot.rows.some(r => !input.taskIds.includes(r.task_id))) throw new Error('RECOVERY_OBSERVATION_INCOMPLETE');
  const initial = new Map(snapshot.rows.map(row => [row.task_id, row]));
  const report = { mode: input.apply ? 'APPLY' : 'DRY_RUN', sourceSha: input.sourceSha,
    outcome: input.apply ? 'NO_ELIGIBLE_TASKS' : 'DRY_RUN', results: [], modelCallsCreated: 0 };
  for (const taskId of input.taskIds) {
    const row = initial.get(taskId);
    const blocker = recoveryBlocker(row, input.sourceSha);
    if (blocker || !input.apply) {
      report.results.push({ ...summary(row, blocker), taskId, result: blocker ? 'SKIPPED' : 'ELIGIBLE_FOR_REVIEW' });
      continue;
    }
    const operationId = randomUUID();
    let tx = false, commitAttempted = false, committed = false, auditId = null;
    try {
      await client.query('BEGIN');
      tx = true;
      await client.query("SET LOCAL statement_timeout='4s'; SET LOCAL lock_timeout='750ms'; SET LOCAL idle_in_transaction_session_timeout='5s'");
      const controls = await client.query("SELECT active FROM public.ivx_agent_controls WHERE control_name='emergency_stop' FOR SHARE NOWAIT");
      if (controls.rows.length !== 1 || controls.rows[0].active !== false) throw new Error('EMERGENCY_STOP_ACTIVE_OR_UNAVAILABLE');
      const locked = (await client.query(LOCK_TASK, [taskId])).rows[0];
      const changed = !locked || locked.version !== row.version;
      const lockedBlocker = changed ? 'VERSION_CHANGED' : recoveryBlocker(locked, input.sourceSha);
      if (lockedBlocker) {
        await client.query('ROLLBACK'); tx = false;
        report.results.push({ ...summary(locked, lockedBlocker), taskId, result: 'SKIPPED' });
        continue;
      }
      const planned = (await client.query(
        'SELECT public.ivx_fleet_retry_payload($1::jsonb,clock_timestamp()) AS payload',
        [JSON.stringify(locked.payload)])).rows[0]?.payload;
      if (!planned || planned.state !== 'RETRYING' || planned.retryCount !== locked.payload.retryCount + 1
          || planned.taskId !== taskId || planned.idempotencyKey !== locked.idempotency_key
          || planned.leaseHolder != null || planned.leaseExpiresAt != null || planned.lastHeartbeatAt != null
          || planned.completedAt != null || !Number.isFinite(Date.parse(planned.retryNotBefore))) {
        await client.query('ROLLBACK'); tx = false;
        report.results.push({ ...summary(locked, 'RETRY_POLICY_REFUSED'), result: 'SKIPPED' });
        continue;
      }
      const next = { ...planned, manualPatrolRecovery: { operationId, reason: input.reason,
        sourceSha: input.sourceSha, previousVersion: row.version,
        previousError: locked.payload.error ?? null, previousBlocker: locked.payload.blocker ?? null,
        previousCompletedAt: locked.payload.completedAt ?? null, requestedAt: planned.updatedAt } };
      const receipt = (await client.query(
        "SELECT public.ivx_autonomous_task_compare_and_set($1::jsonb,'[\"FAILED\"]'::jsonb,NULL,NULL,'state_transition') AS result",
        [JSON.stringify(next)])).rows[0]?.result;
      if (receipt?.ok !== true) throw new Error('RECOVERY_CAS_REFUSED');
      const version = (BigInt(row.version) + 1n).toString();
      const audit = { operationId, reason: input.reason, sourceSha: input.sourceSha,
        fromState: 'FAILED', toState: 'RETRYING', previousVersion: row.version, version,
        previousRetryCount: locked.payload.retryCount, retryCount: next.retryCount,
        previousError: locked.payload.error ?? null, previousBlocker: locked.payload.blocker ?? null,
        previousCompletedAt: locked.payload.completedAt ?? null };
      auditId = (await client.query(
        "INSERT INTO public.ivx_autonomous_task_events(event_type,task_id,event) VALUES ('owner_patrol_recovery',$1,$2::jsonb) RETURNING event_id::text",
        [taskId, JSON.stringify(audit)])).rows[0]?.event_id;
      if (typeof auditId !== 'string' || !/^[0-9]+$/.test(auditId)) throw new Error('RECOVERY_AUDIT_UNCONFIRMED');
      // A rejected/lost COMMIT is never reported as a successful requeue.
      commitAttempted = true;
      await client.query('COMMIT'); tx = false; committed = true;
      const proof = (await client.query(
        "SELECT event->>'operationId' AS operation_id,task_id FROM public.ivx_autonomous_task_events WHERE event_id=$1::bigint AND event_type='owner_patrol_recovery'",
        [auditId])).rows[0];
      if (proof?.operation_id !== operationId || proof.task_id !== taskId) throw new Error('RECOVERY_VERIFICATION_UNAVAILABLE');
      report.results.push({ taskId, result: 'RETRY_SCHEDULE_COMMITTED', previousVersion: row.version,
        version, auditId, operationId, retryNotBefore: next.retryNotBefore,
        retryCount: next.retryCount, workCompleted: false });
      report.outcome = 'RECOVERY_RECORDED';
    } catch (error) {
      if (tx && !commitAttempted) {
        try { await client.query('ROLLBACK'); tx = false; }
        catch { /* Unacknowledged writes remain uncertain until this client closes. */ }
      }
      const outcome = commitAttempted
        ? (committed ? 'COMMITTED_VERIFICATION_UNAVAILABLE' : 'WRITE_UNCONFIRMED')
        : tx ? 'ROLLBACK_UNCONFIRMED' : 'TRANSACTION_ABORTED';
      report.results.push({ taskId, result: outcome, operationId, auditId,
        errorCode: typeof error?.code === 'string' ? error.code : 'RECOVERY_REFUSED',
        // Database messages can include statement arguments: do not emit them.
        blocker: error instanceof Error && /^EMERGENCY_STOP_|^RECOVERY_/.test(error.message)
          ? error.message : 'DATABASE_OPERATION_UNAVAILABLE' });
      report.outcome = outcome;
      break; // No mutation replay, no following task after uncertain authority.
    }
  }
  return report;
}
