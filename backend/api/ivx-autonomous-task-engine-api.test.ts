import { describe, expect, it, spyOn } from 'bun:test';
import { Hono } from 'hono';
import { handleCreateTask, withAutonomousTaskEngineOwner } from './ivx-autonomous-task-engine-api';
import * as engine from '../services/ivx-autonomous-task-engine';

it('rejects invalid HTTP admission before storage and forwards valid requirements intact', async () => {
  const create = spyOn(engine, 'createTask').mockResolvedValue({ ok: true, task: null, duplicate: false, error: null });
  try {
    const app = new Hono();
    app.post('/tasks', handleCreateTask); // Auth is verified separately below.
    for (const body of ['{', 'null', JSON.stringify({ title: 'bad', taskType: 'DEVELOPER_WORKER' })]) {
      const response = await app.request('/tasks', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } });
      expect(response.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
    }
    const input = { title: 'Fix App Guide', description: 'Verify native routing', idempotencyKey: 'route-fix',
      dependencies: ['task-prerequisite'], maxRetries: 0,
      acceptanceCriteria: [{ id: 'device', description: 'Navigation passes', verificationMethod: 'test_pass', met: false, evidence: null }] };
    const response = await app.request('/tasks', { method: 'POST', body: JSON.stringify(input), headers: { 'Content-Type': 'application/json' } });
    expect(response.status).toBe(200);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(input);
  } finally { create.mockRestore(); }
});

describe('Autonomous Task Engine API security boundary', () => {
  it('rejects unauthenticated reads before the handler can inspect the ledger', async () => {
    let invoked = false;
    const app = new Hono();
    app.get('/tasks', withAutonomousTaskEngineOwner(async (c) => {
      invoked = true;
      return c.json({ ok: true });
    }));

    const response = await app.request('/tasks');

    expect(response.status).toBe(401);
    expect(invoked).toBe(false);
    expect((await response.json()).ok).toBe(false);
  });

  it('rejects unauthenticated mutations before the handler can write state', async () => {
    let invoked = false;
    const app = new Hono();
    app.post('/tasks', withAutonomousTaskEngineOwner(async (c) => {
      invoked = true;
      return c.json({ ok: true });
    }));

    const response = await app.request('/tasks', { method: 'POST', body: JSON.stringify({ title: 'must not run' }) });

    expect(response.status).toBe(401);
    expect(invoked).toBe(false);
  });
});
