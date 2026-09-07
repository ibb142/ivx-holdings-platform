import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { withAutonomousTaskEngineOwner } from './ivx-autonomous-task-engine-api';

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
