import { expect, test } from 'bun:test';
import { freshSchedulerState } from './ivx-autonomous-scheduler';
import { dueTechnicalTasks, technicalTaskKind } from './ivx-technical-schedule';

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
