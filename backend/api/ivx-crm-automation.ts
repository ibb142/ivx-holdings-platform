import { Hono } from 'hono';
import { executeCrmAutomationTask } from '../services/ivx-crm-automation';

export function registerCrmAutomationRoutes(app: Hono): void {
  app.post('/api/ivx/crm/automation/execute', async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const taskType = body.taskType || 'standard';
    const parameters = body.parameters || {};
    
    const result = await executeCrmAutomationTask(taskType, parameters);
    return c.json({
      ok: result.success,
      message: result.message,
      evidenceId: result.evidenceId,
    });
  });
}
