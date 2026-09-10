import { createHash } from 'node:crypto';
import { createTasksBatch, finalizeEvidenceTask, type Task } from './ivx-autonomous-task-engine';
import { getSchedulerState, isJobDue, runScheduledJob, type SchedulerState } from './ivx-autonomous-scheduler';
import { checkEmergencyStop } from './ivx-emergency-stop-gate';

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
  }
  lastSeedAt = Date.now();
}

export function technicalTaskKind(task: Pick<Task, 'idempotencyKey'>) {
  return KINDS.find(kind => task.idempotencyKey.startsWith(`${PREFIX}${kind}:`)) ?? null;
}

export async function executeTechnicalTask(task: Task, workerId: string, agentNumber: number, sourceSha: string) {
  const kind = technicalTaskKind(task);
  if (!kind || task.state !== 'RUNNING') throw new Error('A running, leased technical task is required');
  const [control, state] = await Promise.all([checkEmergencyStop(), getSchedulerState({ requireExisting: true })]);
  const startedAt = new Date().toISOString();
  const canRun = control.source !== 'unavailable' && !control.active && state.enabled
    && (process.env.IVX_SCHEDULER ?? 'on').toLowerCase() !== 'off';
  const result = canRun ? await runScheduledJob(kind, { requireExistingState: true }) : { ok: false, summary: 'Technical schedule paused by owner control.', durationMs: 0 };
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
