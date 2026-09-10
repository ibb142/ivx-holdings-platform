import { expect, spyOn, test } from 'bun:test';
import * as engine from './ivx-autonomous-task-engine';
import * as store from './ivx-postgres-autonomous-task-store';
import * as backlog from './ivx-landing-p0-backlog';
import * as scheduler from './ivx-autonomous-scheduler';
import * as stop from './ivx-emergency-stop-gate';
import { reconcileRetryableBlockedTasks } from './ivx-autonomous-blocked-reconciler';
import { dueTechnicalTasks, ensureTechnicalScheduleSeeded } from './ivx-technical-schedule';
import { runRealEngineeringCycle } from './ivx-agent-real-engineering-cycle';

const sha = 'a'.repeat(40);
const noExecutor = 'NO_EXECUTOR: this task has no supported module inspection or Landing executor; no work was performed.';
function fixture(now: number): engine.Task {
  const state = scheduler.freshSchedulerState(now - 600_000);
  return { ...dueTechnicalTasks(state, now)[0], taskId: 'technical-attempt', state: 'BLOCKED',
    createdAt: new Date(now - 600_000).toISOString(), updatedAt: new Date(now - 180_000).toISOString(),
    startedAt: new Date(now - 600_000).toISOString(), leaseHolder: null, leaseExpiresAt: null,
    lastHeartbeatAt: null, blocker: noExecutor, error: null, retryCount: 0, maxRetries: 3,
    evidence: [], dependencies: [], filesChanged: [] } as unknown as engine.Task;
}

test('a recovered attempt keeps its lease while genuinely idle attempts still expire despite heartbeats', async () => {
  const now = Date.now();
  for (const fresh of [true, false]) {
    const task = { ...fixture(now), state: 'RUNNING' as const, leaseHolder: 'agent:ivx_holdings_1',
      leaseExpiresAt: new Date(now + 300_000).toISOString(), lastHeartbeatAt: new Date(now).toISOString(),
      attemptStartedAt: new Date(now - (fresh ? 30_000 : 400_000)).toISOString() };
    const release = spyOn(engine, 'releaseLease').mockResolvedValue({ ok: true, error: null });
    const spies = [release, spyOn(store, 'postgresAtomicQueueSelected').mockReturnValue(true),
      spyOn(store, 'readPostgresRecoveryTasks').mockResolvedValue([task]),
      spyOn(backlog, 'resolveProductionSha').mockReturnValue(sha)];
    try {
      const result = await reconcileRetryableBlockedTasks();
      expect(result.aliveButIdleSeen).toBe(fresh ? 0 : 1);
      expect(release).toHaveBeenCalledTimes(fresh ? 0 : 1);
      expect(task.startedAt).toBe(new Date(now - 600_000).toISOString());
    } finally { spies.forEach(s => s.mockRestore()); }
  }
});

test('rollout recovery retries only the same due unsupported occurrence with expired ownership and owner controls', async () => {
  const baseNow = Date.now(); let clock = 0;
  for (const scenario of ['recover', 'stopped', 'unavailable', 'disabled', 'advanced', 'live-lease', 'unknown-lease', 'real-defect', 'unrelated', 'budget'] as const) {
    const now = baseNow + (++clock) * 180_000;
    const state = scheduler.freshSchedulerState(now - 600_000);
    const task = fixture(now);
    if (scenario === 'disabled') state.enabled = false;
    if (scenario === 'advanced') state.jobs.daily_self_audit.nextDueAt = new Date(now + 60_000).toISOString();
    if (scenario === 'live-lease') task.leaseExpiresAt = new Date(now + 60_000).toISOString();
    if (scenario === 'unknown-lease') task.leaseHolder = 'agent:ivx_holdings_1';
    if (scenario === 'real-defect') task.blocker = 'A real scan failed';
    if (scenario === 'unrelated') task.idempotencyKey = 'owner-business-work';
    if (scenario === 'budget') task.retryCount = task.maxRetries;
    const changed: engine.Task[] = [];
    const spies = [spyOn(Date, 'now').mockReturnValue(now), spyOn(store, 'postgresAtomicQueueSelected').mockReturnValue(true),
      spyOn(store, 'readPostgresTaskById').mockResolvedValue(task),
      spyOn(engine, 'createTasksBatch').mockResolvedValue([{ ok: true, task, duplicate: true, error: null }]),
      spyOn(backlog, 'resolveProductionSha').mockReturnValue(sha),
      spyOn(backlog, 'getLandingTasksForSha').mockResolvedValue([]),
      spyOn(stop, 'assertEmergencyStopInactive').mockImplementation(async () => { if (scenario === 'stopped') throw Error('EMERGENCY_STOP_ACTIVE'); }),
      spyOn(scheduler, 'getSchedulerState').mockImplementation(async options => {
        expect(options).toEqual({ requireExisting: true });
        if (scenario === 'unavailable') throw Error('Existing scheduler state is unavailable');
        return state;
      }),
      spyOn(store, 'compareAndSetPostgresAutonomousTask').mockImplementation(async input => {
        expect(input.expectedStates).toEqual(['BLOCKED']);
        changed.push(input.task); return { ok: true, task: input.task, error: null };
      })];
    try {
      try { await ensureTechnicalScheduleSeeded(); } catch (error) {
        expect(['stopped', 'unavailable'].includes(scenario)).toBe(true);
      }
      expect(changed.length).toBe(scenario === 'recover' ? 1 : 0);
      if (scenario === 'recover') {
        expect(changed[0].state).toBe('RETRYING');
        expect(changed[0].taskId).toBe(task.taskId);
        expect(changed[0].idempotencyKey).toBe(task.idempotencyKey);
        expect(changed[0].retryCount).toBe(1);
        expect(changed[0].evidence).toEqual(task.evidence);
      }
      if (scenario === 'budget') expect(task.retryCount).toBe(task.maxRetries);
    } finally { spies.forEach(s => s.mockRestore()); }
  }
});

test('the real dispatcher executes a technical scan and never repeats an occurrence after its durable schedule advanced', async () => {
  for (const lostCompletion of [false, true]) {
    const now = Date.now(), state = scheduler.freshSchedulerState(now - 600_000);
    const task = { ...fixture(now), state: 'RUNNING' as const, leaseHolder: 'agent:ivx_holdings_1',
      attemptStartedAt: new Date(now).toISOString() };
    let scans = 0, finishes = 0;
    const spies = [spyOn(scheduler, 'getSchedulerState').mockImplementation(async options => {
      expect(options).toEqual({ requireExisting: true }); return state;
    }), spyOn(stop, 'checkEmergencyStop').mockResolvedValue({ active: false, source: 'supabase', checkedAt: new Date(now).toISOString() } as Awaited<ReturnType<typeof stop.checkEmergencyStop>>),
    spyOn(scheduler, 'runScheduledJob').mockImplementation(async (kind, options) => {
      expect(options).toEqual({ requireExistingState: true }); scans++;
      state.jobs[kind].nextDueAt = new Date(Date.now() + 86_400_000).toISOString();
      return { kind, ok: true, summary: 'Isolated scan completed', durationMs: 0 };
    }), spyOn(engine, 'finalizeEvidenceTask').mockImplementation(async input => {
      finishes++;
      if (finishes === 1 && lostCompletion) return { ok: false, task, error: 'Worker lease lost or expired.', evidenceId: null, states: [] };
      if (finishes === 2) {
        expect(input.outcome).toBe('BLOCKED');
        expect(input.blocker).toContain('no longer due');
      }
      return { ok: true, task: { ...task, state: input.outcome }, error: null, evidenceId: 'fixture-evidence', states: [input.outcome] };
    })];
    try {
      const input = { agentId: 'ivx_holdings_1', agentNumber: 1, sourceSha: sha, preparedTask: task };
      const first = await runRealEngineeringCycle(input);
      expect(first.action).toBe(lostCompletion ? 'CYCLE_ERROR' : 'TASK_COMPLETED');
      const retry = await runRealEngineeringCycle(input);
      expect(retry.action).toBe('TASK_BLOCKED');
      expect(retry.productiveMinutes).toBe(0);
      expect(scans).toBe(1);
    } finally { spies.forEach(s => s.mockRestore()); }
  }
});
