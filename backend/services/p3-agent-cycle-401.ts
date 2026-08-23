import { executeAgentRun } from './ivx-agent-runtime';

export async function implementP3AgentCycle401(agentId: string, payload: Record<string, unknown>) {
  try {
    const result = await executeAgentRun(agentId, 'real', payload, null);
    return {
      success: true,
      runId: result.runRecord?.runId,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}
