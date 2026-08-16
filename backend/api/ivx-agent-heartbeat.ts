import { Context } from 'hono';
import { getExecutionState } from '../services/ivx-agent-runtime';

export function handleAgentHeartbeat(c: Context): Response {
  const agentId = c.req.param('agentId');
  const state = getExecutionState(agentId);
  if (!state) {
    return c.json({ ok: false, error: `Agent ${agentId} not found`, errorCode: 'AGENT_NOT_FOUND' }, 404);
  }
  return c.json({ ok: true, agentId, lastHeartbeat: state.lastHeartbeat });
}