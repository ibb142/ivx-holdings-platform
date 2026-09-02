import { executeRealAgentCycle } from './agent-cycle-handler';

export async function p3AgentCycle401(agentId: string, payload: Record<string, unknown>): Promise<void> {
  // Execute the agent cycle 401 for the given agentId
  await executeRealAgentCycle(agentId, payload);
}
