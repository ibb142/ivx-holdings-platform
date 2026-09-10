import { createHash } from 'node:crypto';
import { createTasksBatch, finalizeEvidenceTask, transitionTaskState, type Task } from './ivx-autonomous-task-engine';
import { getSchedulerState, isJobDue, runScheduledJob, type SchedulerState } from './ivx-autonomous-scheduler';
import { checkEmergencyStop, assertEmergencyStopInactive } from './ivx-emergency-stop-gate';

const PREFIX = 'technical-schedule:';
const KINDS = ['daily_self_audit', 'daily_drift_detection'] as const;
let lastSeedAt = 0;

export function dueTechnicalTasks(state: SchedulerState, now = Date.now()) {
  if (!state.enabled || (process.env.IVX_SCHEDULER ?? 'on').toLowerCase() === 'off') return [];
  return KINDS.filter(kind => isJobDue(state.jobs[kind], now)).map(kind => ({
    title: `Scheduled technical audit: ${kind}`,
    description: `Execute the due ${kind} with real scan evidence and durable repair handoff.`,
    // Both coordinators share one atomic lane: scheduler state writes cannot race.
    assignedAgentNumber: 1, taskType: 'qa' as const, priority: 'high' as const, executionOrder: -1000,
    idempotencyKey: `${PREFIX}${kind}:${state.jobs[kind].nextDueAt ?? 'initial'}`,
    acceptanceCriteria: [{ id: 'real-scan', description: 'Technical scan completed with persisted findings.', verificationMethod: 'test_pass' as const, met: false, evidence: null }],
  }));
}

/** Called by the worker-owned fleet refill. The existing PG claim/heartbeat
 * machinery supplies cross-process exclusion and restart recovery. */
export async function ensureTechnicalScheduleSeeded(): Promise<void> {
  if (Date.now() - lastSeedAt < 30_000) return;
  const state = await getSchedulerState({ requireExisting: true });
  const inputs = dueTechnicalTasks(state);
  if (inputs.length) {
    const results = await createTasksBatch(inputs);
    if (results.some(result => !result.ok)) throw new Error('Technical schedule enqueue failed');
    for (const result of results) {
      if (result.task && technicalTaskIsDue(result.task, state) && canRecoverTechnicalRollout(result.task)) {
        await assertEmergencyStopInactive('technical-rollout-recovery');
        const retry = await transitionTaskState(result.task.taskId, 'RETRYING');
        if (!retry.ok) throw new Error('Technical rollout recovery changed concurrently');
      }
    }
  }
  lastSeedAt = Date.now();
}

export function technicalTaskKind(task: Pick<Task, 'idempotencyKey'>) {
  return KINDS.find(kind => task.idempotencyKey.startsWith(`${PREFIX}${kind}:`)) ?? null;
}

export function technicalTaskIsDue(task: Pick<Task, 'idempotencyKey'>, state: SchedulerState, now = Date.now()): boolean {
  return dueTechnicalTasks(state, now).some(input => input.idempotencyKey === task.idempotencyKey);
}

/** An old replica may claim a newly supported task while a rollout drains.
 * Retry only that zero-work rejection after the overlap window; preserve owner
 * blocks, real execution evidence, and the existing attempt/time budgets. */
export function canRecoverTechnicalRollout(task: Task, now = Date.now()): boolean {
  const updated = Date.parse(task.updatedAt);
  const expiry = Date.parse(task.leaseExpiresAt ?? '');
  if (task.leaseExpiresAt && (!Number.isFinite(expiry) || expiry > now) || task.leaseHolder && !task.leaseExpiresAt) return false;
  return task.taskType === 'qa' && technicalTaskKind(task) !== null && task.state === 'BLOCKED'
    && task.blocker === 'NO_EXECUTOR: this task has no supported module inspection or Landing executor; no work was performed.'
    && task.evidence.length === 0 && task.retryCount < task.maxRetries
    && Number.isFinite(updated) && now - updated >= 120_000;
}

export async function executeTechnicalTask(task: Task, workerId: string, agentNumber: number, sourceSha: string) {
  const kind = technicalTaskKind(task);
  if (!kind || task.state !== 'RUNNING') throw new Error('A running, leased technical task is required');
  const [control, state] = await Promise.all([checkEmergencyStop(), getSchedulerState({ requireExisting: true })]);
  const startedAt = new Date().toISOString();
  const controlsAllow = control.source !== 'unavailable' && !control.active && state.enabled
    && (process.env.IVX_SCHEDULER ?? 'on').toLowerCase() !== 'off';
  const canRun = controlsAllow && technicalTaskIsDue(task, state);
  const result = canRun ? await runScheduledJob(kind, { requireExistingState: true }) : { ok: false,
    summary: controlsAllow ? 'Technical occurrence is no longer due; an earlier execution or scheduler change requires reconciliation.' : 'Technical schedule paused by owner control.', durationMs: 0 };
  const completedAt = new Date().toISOString();
  const seconds = canRun ? Math.min(result.durationMs, Date.parse(completedAt) - Date.parse(startedAt)) / 1000 : 0;
  const summary = 'IVX_WORK_RESULT ' + JSON.stringify({ v: 1, unit_id: kind, agent_number: agentNumber,
    status: result.ok ? 'PASS' : 'BLOCKED', started_at: startedAt, completed_at: completedAt,
    productive_seconds: seconds, production_sha: sourceSha, detail: result.summary });
  const finalized = await finalizeEvidenceTask({ taskId: task.taskId, workerId, outcome: result.ok ? 'VERIFIED' : 'BLOCKED',
    blocker: result.ok ? undefined : result.summary,
    evidence: { evidenceType: 'test_result', source: 'technical-scheduler', summary, commitSha: sourceSha, deploymentId: null,
      contentHash: createHash('sha256').update(summary).digest('hex') } });
  return { finalized, startedAt, completedAt, seconds, ran: canRun };
}
