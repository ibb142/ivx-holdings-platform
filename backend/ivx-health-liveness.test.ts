import { afterEach, beforeAll, describe, expect, it, spyOn } from 'bun:test';
import * as queue from './services/ivx-owner-ai-task-queue';
import * as credentials from './services/ivx-senior-developer-runtime';
import type { Hono } from 'hono';

process.env.IVX_LANDING_P0_MISSION = 'true';
let app: Hono;
const restores: Array<() => void> = [];
afterEach(() => { for (const restore of restores.splice(0)) restore(); });
beforeAll(async () => {
  const server = await import('./hono');
  app = server.default;
  await server.certificateBootRecovery;
}, 30_000);

describe('production health liveness', () => {
  it('responds while remote credential and queue checks never resolve', async () => {
    const audit = spyOn(credentials, 'auditIVXProductionCredentialRuntime').mockImplementation(() => new Promise(() => {}));
    const remoteQueue = spyOn(queue, 'checkQueueHealth').mockImplementation(() => new Promise(() => {}));
    restores.push(() => audit.mockRestore(), () => remoteQueue.mockRestore());
    let timer: ReturnType<typeof setTimeout>;
    try {
      const response = await Promise.race([
        app.request('/health'),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Liveness waited for a remote dependency')), 1_000); }),
      ]);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.ok).toBe(true);
      expect(body.bootTime).toBeTypeOf('string');
      expect(body.timestamp).toBeTypeOf('string');
      expect(audit).not.toHaveBeenCalled();
      expect(remoteQueue).not.toHaveBeenCalled();
      expect(body.queue.depth).toBeNull();
      expect(body.queue.telemetryAvailable).toBe(false);
    } finally { clearTimeout(timer!); }
  });

  it('keeps dependency readiness fail-closed when the database or queue is down', async () => {
    const database = spyOn(queue, 'checkDatabaseHealth').mockResolvedValue({ ok: false, detail: { reason: 'database unavailable' } });
    const remoteQueue = spyOn(queue, 'checkQueueHealth').mockResolvedValue({ ok: false, detail: { reason: 'queue unavailable' } });
    const auth = spyOn(queue, 'checkAuthHealth').mockResolvedValue({ ok: false, detail: { reason: 'auth unavailable' } });
    restores.push(() => database.mockRestore(), () => remoteQueue.mockRestore(), () => auth.mockRestore());
    const response = await app.request('/health/ready');
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.auth.ok).toBe(false);
    expect(body.checks.queue.ok).toBe(false);
    expect(database).toHaveBeenCalledTimes(1);
    expect(remoteQueue).toHaveBeenCalledTimes(1);
  });

  it('requires real Auth availability independently of database and queue readiness', async () => {
    const ai = spyOn(queue, 'checkAIHealth').mockReturnValue({ ok: true, detail: {} });
    const database = spyOn(queue, 'checkDatabaseHealth').mockResolvedValue({ ok: true, detail: {} });
    const remoteQueue = spyOn(queue, 'checkQueueHealth').mockResolvedValue({ ok: true, detail: {} });
    const auth = spyOn(queue, 'checkAuthHealth').mockResolvedValue({ ok: false, detail: { reason: 'auth unavailable' } });
    restores.push(() => ai.mockRestore(), () => database.mockRestore(), () => remoteQueue.mockRestore(), () => auth.mockRestore());
    expect((await app.request('/health/ready')).status).toBe(503);
    auth.mockResolvedValue({ ok: true, detail: {} });
    expect((await app.request('/health/ready')).status).toBe(200);
  });
});
