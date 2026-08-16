import { getContractByAgentId, AGENT_CONTRACT_REGISTRY } from './ivx-agent-contracts';
import { verifyPermissionMatrix } from './ivx-agent-runtime';

export async function verifyReadiness(agentId: string) {
  const contract = getContractByAgentId(agentId);
  if (!contract) {
    throw new Error(`Contract for agentId ${agentId} not found.`);
  }

  const permissionsOk = verifyPermissionMatrix();
  if (!permissionsOk) {
    throw new Error(`Permissions matrix verification failed for agent ${agentId}.`);
  }

  // Check heartbeat
  const state = AGENT_CONTRACT_REGISTRY[agentId].executionState;
  if (!state || !state.lastHeartbeat) {
    throw new Error(`Heartbeat not found for agent ${agentId}.`);
  }

  return {
    ok: true,
    message: `Agent ${agentId} readiness verified.`,
  };
}
