/** Read-only triage. An execution failure is never permission to reset a lease
 * or repeat an external action. The canonical queue owns retry/recovery. */
export type FailedAgentRecoveryInput = { runId: string; agentNumbers: number[] };
export type FailedAgentRecoveryRow = {
  agentNumber: number;
  taskId: string | null;
  finalStatus: string | null;
  simulated: boolean | null;
  verifiedOutput: boolean | null;
  hasExecutionEvidence: boolean | null;
  taskState: string | null;
  payloadState: string | null;
  assignedAgentNumber: number | null;
  taskVersion: string | null;
  leaseActive: boolean | null;
  leaseExpired: boolean | null;
  hasTaskEvidence: boolean | null;
  observedAt: string | Date;
};

export const FAILED_AGENT_RECOVERY_SQL = `
select requested.agent_number as "agentNumber",
  execution.task_id as "taskId", execution.final_status as "finalStatus",
  execution.simulated, execution.verified_output as "verifiedOutput",
  (execution.real_tool_used is true or execution.tool_result_id is not null
    or execution.source_reference is not null or execution.evidence_sha256 is not null)
    as "hasExecutionEvidence",
  task.state as "taskState", task.payload->>'state' as "payloadState",
  task.assigned_agent_number as "assignedAgentNumber", task.version::text as "taskVersion",
  task.lease_expires_at > statement_timestamp() as "leaseActive",
  task.lease_expires_at <= statement_timestamp() as "leaseExpired",
  (coalesce(task.payload->'evidence', '[]'::jsonb) <> '[]'::jsonb
    or nullif(task.payload->>'commitSha', '') is not null
    or nullif(task.payload->>'deploymentId', '') is not null
    or coalesce(task.payload->>'recordsChanged', '0') <> '0') as "hasTaskEvidence",
  statement_timestamp() as "observedAt"
from unnest($2::integer[]) requested(agent_number)
left join lateral (
  select task_id, final_status, simulated, verified_output, real_tool_used,
    tool_result_id, source_reference, evidence_sha256
  from public.ivx_agent_executions
  where run_id = $1 and agent_number = requested.agent_number
  order by created_at desc, finished_at desc nulls last, task_id desc
  limit 1
) execution on true
left join public.ivx_autonomous_tasks task on task.task_id = execution.task_id
order by requested.agent_number`;

export function validateFailedAgentRecoveryInput(input: FailedAgentRecoveryInput): void {
  if (!input || typeof input.runId !== 'string' || !input.runId.trim()
    || input.runId.length > 200 || /[\x00-\x1f\x7f]/.test(input.runId)) {
    throw new Error('INVALID_RECOVERY_RUN_ID');
  }
  if (!Array.isArray(input.agentNumbers) || input.agentNumbers.length < 1 || input.agentNumbers.length > 112
    || input.agentNumbers.some(n => !Number.isInteger(n) || n < 1 || n > 112)
    || new Set(input.agentNumbers).size !== input.agentNumbers.length) {
    throw new Error('INVALID_RECOVERY_AGENT_NUMBERS');
  }
}

function nextStep(row: FailedAgentRecoveryRow): string {
  if (!row.taskId) return 'EXECUTION_NOT_FOUND';
  if (row.simulated !== false) return 'SIMULATION_STATUS_REVIEW';
  if (!row.taskState) return 'CANONICAL_TASK_NOT_FOUND';
  if (row.taskState !== row.payloadState
    || (row.assignedAgentNumber !== null && row.assignedAgentNumber !== row.agentNumber)) {
    return 'CANONICAL_IDENTITY_REVIEW';
  }
  if (row.leaseActive === true) return 'ACTIVE_LEASE_DO_NOT_RESET';
  if (row.finalStatus === 'completed' || row.verifiedOutput === true
    || row.hasExecutionEvidence === true || row.hasTaskEvidence === true) {
    return 'RECONCILE_EXISTING_EVIDENCE';
  }
  if (['FAILED', 'VERIFIED', 'NO_ACTION_REQUIRED', 'CANCELLED', 'EXPIRED'].includes(row.taskState)) {
    return 'TERMINAL_TASK_REVIEW';
  }
  if (!['failed', 'unknown'].includes(row.finalStatus ?? '')) return 'EXECUTION_STATUS_REVIEW';
  if (row.taskState === 'QUEUED') return 'ALREADY_QUEUED';
  if (row.taskState === 'RETRYING') return 'CANONICAL_RETRY_SCHEDULE';
  if (row.leaseExpired === true && ['LEASED', 'RUNNING'].includes(row.taskState)) {
    return 'CANONICAL_EXPIRED_LEASE_RECOVERY';
  }
  return 'MANUAL_RECONCILIATION_REQUIRED';
}

export async function inspectFailedAgentRecovery(
  input: FailedAgentRecoveryInput,
  query: (sql: string, values: unknown[]) => Promise<{ rows: FailedAgentRecoveryRow[] }>,
) {
  validateFailedAgentRecoveryInput(input);
  const agentNumbers = [...input.agentNumbers].sort((a, b) => a - b);
  // One bounded read, scoped to the explicitly selected run. No replay on error.
  const { rows } = await query(FAILED_AGENT_RECOVERY_SQL, [input.runId, agentNumbers]);
  if (rows.length !== agentNumbers.length || new Set(rows.map(row => row.agentNumber)).size !== rows.length
    || rows.some(row => !agentNumbers.includes(row.agentNumber)
      || !(typeof row.observedAt === 'string' || row.observedAt instanceof Date)
      || !Number.isFinite(new Date(row.observedAt).getTime())
      || (row.taskVersion !== null && (typeof row.taskVersion !== 'string' || !/^[0-9]+$/.test(row.taskVersion))))) {
    throw new Error('RECOVERY_OBSERVATION_INCOMPLETE');
  }
  return {
    state: 'DIAGNOSTIC_ONLY', runId: input.runId, requestedAgents: agentNumbers,
    mutationsPerformed: 0, modelCallsCreated: 0, budgetReconciliation: 'NOT_CHECKED',
    rows: rows.map(row => ({ ...row, observedAt: new Date(row.observedAt).toISOString(),
      nextStep: nextStep(row), retryAuthorized: false })),
  };
}
