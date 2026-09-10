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
