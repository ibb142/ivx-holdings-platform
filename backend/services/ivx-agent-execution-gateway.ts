import { executeAgentRun, type WorkerExecutionResult } from './ivx-agent-runtime';
import { requireTaskPreflightGate, type TaskPreflightDecision } from './ivx-task-preflight-gate';

export const IVX_AGENT_EXECUTION_GATEWAY_MARKER = 'ivx-agent-execution-gateway-v1-2026-08-30';

export type GatedWorkerExecutionResult = WorkerExecutionResult & {
  preflight: TaskPreflightDecision;
};

/**
 * Mandatory front door for Autonomous/112 IA task execution.
 *
 * Normal work is fail-closed unless production is healthy, exact-main SHA is
 * deployed, and the external Autonomous supervisor is healthy. Queue pressure
 * is reported as a warning rather than a hard blocker because blocking agents
 * on a busy GitHub queue would make the fleet sleep instead of doing useful
 * non-GitHub work.
 *
 * Recovery/deploy/certificate work is allowed through a degraded production
 * state only while the external supervisor is healthy, preventing a deadlock
 * where the task required to repair SHA parity is itself blocked by SHA parity.
 */
export async function executeAgentRunWithP0Preflight(
  agentId: string,
  taskType: string,
  payload: Record<string, unknown>,
  ownerApprovalToken?: string | null,
): Promise<GatedWorkerExecutionResult> {
  const workflow = typeof payload.__workflow === 'string' ? payload.__workflow : '';
  const preflight = await requireTaskPreflightGate(taskType, workflow);
  if (!preflight.ok) {
    return { ok: false, runRecord: null, error: preflight.error, preflight };
  }
  const result = await executeAgentRun(agentId, taskType, payload, ownerApprovalToken);
  return { ...result, preflight };
}
