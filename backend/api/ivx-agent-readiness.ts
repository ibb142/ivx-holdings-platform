import { Context } from 'hono';
import { getContractByAgentId, verifyPermissionMatrix } from '../services/ivx-agent-contracts';
import { getExecutionState, verifyIndependence } from '../services/ivx-agent-runtime';
import { verifyAgentScheduler } from '../services/ivx-scheduler';

export async function handleAgentReadinessCheck(c: Context): Promise<Response> {
  const agentId = c.req.param('agentId');
  const contract = getContractByAgentId(agentId);
  const state = getExecutionState(agentId);
  
  if (!contract || !state) {
    return c.json({ ok: false, error: `Agent ${agentId} not found`, errorCode: 'AGENT_NOT_FOUND' }, 404);
  }

  const contractVerified = !!contract;
  const toolsVerified = contract.allowedTools.length > 0;
  const permissionsVerified = verifyPermissionMatrix().ok;
  const heartbeatVerified = !!state.lastHeartbeat;
  const schedulerVerified = verifyAgentScheduler().ok;
  const independenceVerified = verifyIndependence().ok;
  const qaSecurityGatesVerified = verifyQaSecurityGates().ok;
  const evidenceRecorded = recordAgentEvidence(agentId).ok;

  return c.json({
    ok: true,
    agentId,
    contractVerified,
    toolsVerified,
    permissionsVerified,
    heartbeatVerified,
    qaSecurityGatesVerified,
    evidenceRecorded,
    schedulerVerified,
    independenceVerified,
  });
}
