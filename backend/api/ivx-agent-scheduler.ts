import { Hono } from 'hono';
import { verifyAgentScheduler } from '../services/ivx-scheduler';

export function registerSchedulerRoutes(app: Hono): void {
  app.get('/api/ivx/agents/scheduler/verify', (c) => {
    const result = verifyAgentScheduler();
    return c.json({
      ok: result.ok,
      marker: 'ivx-agent-scheduler-verify',
      result,
    });
  });
}
