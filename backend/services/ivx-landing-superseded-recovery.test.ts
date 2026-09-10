import { expect, spyOn, test } from 'bun:test';
import type { Task } from './ivx-autonomous-task-engine';
import { supersededLandingReplacement, reconcileRetryableBlockedTasks } from './ivx-autonomous-blocked-reconciler';
import * as backlog from './ivx-landing-p0-backlog';
import * as store from './ivx-postgres-autonomous-task-store';
import * as stop from './ivx-emergency-stop-gate';
const oldSha = 'a'.repeat(40), sha = 'b'.repeat(40);
const old = { taskId: 'old', idempotencyKey: `landing-p0:${oldSha}:registration.duplicate-email`,
  taskType: 'qa', state: 'BLOCKED', createdAt: '2026-09-07T00:00:00Z', leaseExpiresAt: null,
  blocker: 'IVX_OWNER_EMAIL not configured', evidence: [{ summary: 'original failure retained' }],
} as Task;
const current = { ...old, taskId: 'replacement', idempotencyKey: `landing-p0:${sha}:registration.duplicate-email`, createdAt: '2026-09-10T00:00:00Z', state: 'FAILED' } as Task;
const now = Date.parse('2026-09-10T01:00:00Z');

test('old configuration failures hand off to an existing newer QA task without certifying either', () => {
  expect(supersededLandingReplacement(old, [current], sha, now)?.taskId).toBe('replacement');
  expect(old.blocker).toContain('IVX_OWNER_EMAIL');
  expect(old.evidence[0].summary).toBe('original failure retained');
  expect(current.state).toBe('FAILED');
});
test('preserves current failures, live leases, business work and deployments newer than this process', () => {
  for (const task of [current, { ...old, leaseExpiresAt: new Date(now + 60_000).toISOString() },
    { ...old, taskType: 'code_change' }, { ...old, createdAt: '2026-09-11T00:00:00Z' },
    { ...old, idempotencyKey: 'owner-task:do-not-touch' }, { ...old, state: 'RUNNING' }]) {
    expect(supersededLandingReplacement(task as Task, [current], sha, now)).toBeNull();
  }
});
test('missing, cancelled or unrelated replacement cannot erase a blocker', () => {
  for (const replacements of [[], [{ ...current, state: 'CANCELLED' }], [{ ...current, idempotencyKey: `landing-p0:${sha}:other-unit` }]]) {
    expect(supersededLandingReplacement(old, replacements as Task[], sha, now)).toBeNull();
  }
});

test('reconciler persists supersession through the atomic state transition and respects the owner stop', async () => {
  for (const stopped of [false, true]) {
    const changes: Task[] = [];
    const spies = [
      spyOn(backlog, 'resolveProductionSha').mockReturnValue(sha),
      spyOn(backlog, 'getLandingTasksForSha').mockResolvedValue([current]),
      spyOn(store, 'postgresAtomicQueueSelected').mockReturnValue(true),
      spyOn(store, 'readPostgresRecoveryTasks').mockResolvedValue([{ ...old, updatedAt: old.createdAt }]),
      spyOn(stop, 'assertEmergencyStopInactive').mockImplementation(async () => { if (stopped) throw new Error('EMERGENCY_STOP_ACTIVE'); }),
      spyOn(store, 'compareAndSetPostgresAutonomousTask').mockImplementation(async input => {
        expect(input.expectedStates).toEqual(['BLOCKED']);
        expect(input.eventType).toBe('landing_task_superseded');
        changes.push(input.task);
        return { ok: true, task: input.task, error: null };
      }),
    ];
    try {
      const result = await reconcileRetryableBlockedTasks();
      expect(result.superseded).toBe(stopped ? 0 : 1);
      expect(changes).toHaveLength(stopped ? 0 : 1);
      if (!stopped) {
        expect(changes[0].state).toBe('CANCELLED');
        expect(changes[0].error).toContain('replacementTaskId=replacement');
        expect(changes[0].blocker).toBe(old.blocker);
        expect(changes[0].evidence).toEqual(old.evidence);
      }
    } finally { spies.forEach(spy => spy.mockRestore()); }
  }
});
