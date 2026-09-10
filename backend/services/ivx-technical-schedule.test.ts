import { expect, test } from 'bun:test';
import { freshSchedulerState } from './ivx-autonomous-scheduler';
import { canRecoverTechnicalRollout, dueTechnicalTasks, technicalTaskKind } from './ivx-technical-schedule';
import type { Task } from './ivx-autonomous-task-engine';

test('rollout recovery retries only a drained old executor rejection without work', () => {
  const now = Date.now();
  const task = { idempotencyKey: 'technical-schedule:daily_self_audit:initial', state: 'BLOCKED',
    blocker: 'NO_EXECUTOR: this task has no supported module inspection or Landing executor; no work was performed.',
    evidence: [], retryCount: 0, maxRetries: 3, updatedAt: new Date(now - 120_000).toISOString() } as Task;
  expect(canRecoverTechnicalRollout(task, now)).toBe(true);
  expect(canRecoverTechnicalRollout(task, now - 1)).toBe(false);
  expect(canRecoverTechnicalRollout({ ...task, state: 'RUNNING' }, now)).toBe(false);
  expect(canRecoverTechnicalRollout({ ...task, blocker: 'OWNER_GATE: paused' }, now)).toBe(false);
  expect(canRecoverTechnicalRollout({ ...task, retryCount: 3 }, now)).toBe(false);
  expect(canRecoverTechnicalRollout({ ...task, idempotencyKey: 'unsupported:new-kind' }, now)).toBe(false);
  expect(canRecoverTechnicalRollout({ ...task, evidence: [{ evidenceId: 'real-work' } as Task['evidence'][number]] }, now)).toBe(false);
});

test('worker replicas create the same due technical tasks without scheduling outreach', () => {
  const now = Date.now(); const state = freshSchedulerState(now);
  const first = dueTechnicalTasks(state, now), second = dueTechnicalTasks(state, now + 10_000);
  expect(first.map(t => t.idempotencyKey)).toEqual(second.map(t => t.idempotencyKey));
  expect(first.map(technicalTaskKind)).toEqual(['daily_self_audit', 'daily_drift_detection']);
  expect(new Set(first.map(t => t.assignedAgentNumber)).size).toBe(1);
  state.jobs.daily_self_audit.nextDueAt = new Date(now + 86_400_000).toISOString();
  expect(dueTechnicalTasks(state, now).map(technicalTaskKind)).toEqual(['daily_drift_detection']);
  const tomorrow = dueTechnicalTasks(state, now + 86_400_000);
  expect(tomorrow[0].idempotencyKey).not.toBe(first[0].idempotencyKey);
});

test('disabled scheduler and disabled environment never enqueue work', () => {
  const state = freshSchedulerState(); state.enabled = false;
  expect(dueTechnicalTasks(state)).toEqual([]);
  state.enabled = true;
  const previous = process.env.IVX_SCHEDULER;
  try { process.env.IVX_SCHEDULER = 'off'; expect(dueTechnicalTasks(state)).toEqual([]); }
  finally { if (previous === undefined) delete process.env.IVX_SCHEDULER; else process.env.IVX_SCHEDULER = previous; }
});

test('durable state outage cannot reset owner controls or create new schedule identities', async () => {
  const child = Bun.spawn([process.execPath, '-e', `
    import { mock } from 'bun:test';
    let mode = 'offline', writes = 0;
    const durable = await import('./backend/services/ivx-durable-store.ts');
    mock.module('./backend/services/ivx-durable-store.ts', () => ({
      ...durable,
      isDurableStoreConfigured: () => true,
      readDurableJson: async () => { if (mode === 'offline') throw Error('scheduler storage offline'); return null; },
      writeDurableJson: async () => { writes++; }, appendDurableEvent: async () => {}
    }));
    const scheduler = await import('./backend/services/ivx-autonomous-scheduler.ts');
    const technical = await import('./backend/services/ivx-technical-schedule.ts');
    for (const failure of ['offline', 'missing']) {
      mode = failure;
      let rejected = false;
      try { await technical.ensureTechnicalScheduleSeeded(); } catch { rejected = true; }
      if (!rejected) throw Error('Unreadable schedule was treated as enabled');
    }
    mode = 'offline';
    let completionRejected = false;
    try {
      await scheduler.runScheduledJob('daily_drift_detection', {
        requireExistingState: true,
        drift: { detectArchitectureDrift: async () => { throw Error('injected scan failure'); } }
      });
    } catch { completionRejected = true; }
    if (!completionRejected || writes !== 0) throw Error('Completion replaced unavailable owner state');
  `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
  const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw Error(error || 'Scheduler outage child failed without diagnostics');
  expect(code).toBe(0);
});
