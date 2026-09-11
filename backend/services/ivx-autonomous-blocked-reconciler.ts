/** IVX Autonomous blocked + productivity recovery hot loop. */
import { getAllTasks, releaseLease, transitionTaskState, type Task } from './ivx-autonomous-task-engine';
import { getExecutionState, updateExecutionState } from './ivx-agent-runtime';
import { resolveProductionSha, getLandingTasksForSha, parseLandingTaskKey } from './ivx-landing-p0-backlog';
import { assertEmergencyStopInactive } from './ivx-emergency-stop-gate';
import { compareAndSetPostgresAutonomousTask, postgresAtomicQueueSelected, readPostgresRecoveryTasks } from './ivx-postgres-autonomous-task-store';
import { planTaskRetry, taskRetryDue, FLEET_RETRY_BUDGET_MS } from './ivx-retry-policy';

export const IVX_BLOCKED_RECONCILER_MARKER = 'ivx-autonomous-dependency-recovery-2026-09-10-v6';
const DEFAULT_INTERVAL_MS = 15_000;
const MIN_BLOCK_AGE_MS = 20_000;
const DEFAULT_PRODUCTIVITY_STALE_MS = 5 * 60_000;
const HEARTBEAT_FRESH_MS = 60_000;
const DEPENDENCY_WAIT_MS = 30_000;
let timer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;
export type BlockedReconcileResult = { marker: string; measuredAt: string; productionSha: string; blockedSeen: number; superseded: number; requeued: number; dependencyWaits: number; retainedRealDefects: number; retainedOwnerOrConfig: number; aliveButIdleSeen: number; staleLeasesReleased: number; staleQueuedLeasesCleared: number; runtimeSlotsCleared: number; errors: number };

/** A new version gets new QA. Retain the old failure as cancelled history,
 * with a durable replacement identity; never convert it into successful work. */
export function supersededLandingReplacement(task: Task, current: readonly Task[], sha: string, now: number): Task | null {
  const old = parseLandingTaskKey(task.idempotencyKey);
  if (!/^[a-f0-9]{40}$/i.test(sha) || !old || !/^[a-f0-9]{40}$/i.test(old.sha) || old.sha === sha || task.taskType !== 'qa'
    || task.state !== 'BLOCKED') return null;
  if (task.leaseExpiresAt && (!Number.isFinite(Date.parse(task.leaseExpiresAt)) || Date.parse(task.leaseExpiresAt) > now)) return null;
  if (task.leaseHolder && !task.leaseExpiresAt) return null;
  const created = Date.parse(task.createdAt);
  if (!Number.isFinite(created)) return null;
  return current.find(candidate => {
    const replacement = parseLandingTaskKey(candidate.idempotencyKey);
    return replacement?.sha === sha && replacement.unitId === old.unitId && !replacement.repair
      && candidate.taskType === 'qa' && !['CANCELLED', 'EXPIRED'].includes(candidate.state)
      && Date.parse(candidate.createdAt) > created;
  }) ?? null;
}
function taskText(task: Task): string { return `${task.title}\n${task.description}\n${task.blocker ?? ''}\n${task.error ?? ''}\n${(task.evidence ?? []).map((e) => e.summary ?? '').join('\n')}\n${task.idempotencyKey}`.toLowerCase(); }
function shaFromTask(task: Task): string | null { const match = [task.idempotencyKey, task.description, task.blocker ?? ''].join(' ').match(/\b[0-9a-f]{40}\b/i); return match ? match[0].toLowerCase() : null; }
function isOwnerOrConfigGate(task: Task): boolean { return /owner approval|owner-gated|not configured|missing credential|secret|iam|permission|billing|payment|mfa|security boundary/.test(taskText(task)); }
function isTransientWorkflowBlock(task: Task): boolean { const text = taskText(task); return /workflow|github actions|e2e acceptance|reels live certificate|live e2e/.test(text) && /in_progress|in progress|queued|dispatch it|no .* run exists/.test(text); }
function isSafeQaFixtureDependency(task: Task): boolean { return /isolated registration acceptance fixture|controlled qa identity|safe qa identity|test fixture/.test(taskText(task)); }
function isExternalDependencyWait(task: Task): boolean { return isTransientWorkflowBlock(task) || isSafeQaFixtureDependency(task); }
function isRealDefect(task: Task): boolean { return /defect persists|\b502\b|\b500\b|broken|invalid contract|missing target|crash|failed/.test(taskText(task)); }
function productivityStaleMs(): number { const raw = Number.parseInt(process.env.IVX_PRODUCTIVITY_STALE_MS ?? '', 10); return Number.isFinite(raw) ? Math.max(60_000, Math.min(raw, 30 * 60_000)) : DEFAULT_PRODUCTIVITY_STALE_MS; }
function latestProductiveEvidenceMs(task: Task): number { let latest = Date.parse(task.startedAt ?? task.createdAt ?? '') || 0; for (const evidence of task.evidence ?? []) { const at = Date.parse(evidence.createdAt ?? ''); if (Number.isFinite(at) && at > latest) latest = at; } return latest; }
async function readRecoveryTasks(sourceSha: string): Promise<Task[]> { if (postgresAtomicQueueSelected()) return readPostgresRecoveryTasks(sourceSha); return getAllTasks(); }
function clearMatchingSlot(task: Task): void { const agentId = task.leaseHolder?.startsWith('agent:') ? task.leaseHolder.slice(6) : null; if (agentId && getExecutionState(agentId)?.activeTaskId === task.taskId) updateExecutionState(agentId, { availability: 'available', activeTaskId: null }); }

async function writeTask(task: Task, expectedStates: Task['state'][], eventType: string): Promise<boolean> {
  if (postgresAtomicQueueSelected()) return (await compareAndSetPostgresAutonomousTask({ task, expectedStates, eventType })).ok;
  return (await transitionTaskState(task.taskId, task.state)).ok;
}

async function scheduleDependencyWait(task: Task, now: number): Promise<boolean> {
  // A dependency wait is not a failed attempt. Preserve retryCount and restart
  // neither attempt nor time budget. This prevents healthy long-running CI or
  // safe QA-fixture prerequisites from being converted into false failures.
  const next: Task = { ...task, state: 'RETRYING', retryNotBefore: new Date(now + DEPENDENCY_WAIT_MS).toISOString(), retryStartedAt: null, leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null, completedAt: null, error: null, updatedAt: new Date(now).toISOString() };
  const ok = await writeTask(next, ['BLOCKED'], 'dependency_wait_scheduled');
  if (ok) clearMatchingSlot(task);
  return ok;
}

async function scheduleBlockedRetry(task: Task): Promise<boolean> { const next = { ...task, ...planTaskRetry(task) }; const ok = await writeTask(next as Task, ['BLOCKED'], next.state === 'RETRYING' ? 'retry_scheduled' : 'retry_budget_exhausted'); if (ok) clearMatchingSlot(task); return ok; }

async function releaseDueRetries(tasks: Task[], now: number): Promise<number> {
  let errors = 0;
  for (const task of tasks) {
    if (task.state !== 'RETRYING' || !taskRetryDue(task, now)) continue;
    const dependencyWait = isExternalDependencyWait(task) && !task.retryStartedAt;
    const expired = !dependencyWait && Boolean(task.retryStartedAt && now - Date.parse(task.retryStartedAt) >= FLEET_RETRY_BUDGET_MS);
    const next: Task = { ...task, state: expired ? 'FAILED' : 'QUEUED', updatedAt: new Date(now).toISOString(), leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null, retryNotBefore: null };
    if (expired) { next.error = 'retry time_budget exhausted'; next.completedAt = next.updatedAt; }
    try { if (!(await writeTask(next, ['RETRYING'], expired ? 'retry_budget_exhausted' : dependencyWait ? 'dependency_wait_due' : 'retry_due'))) errors += 1; } catch { errors += 1; }
  }
  return errors;
}

async function clearStaleQueuedLeases(tasks: Task[], now: number): Promise<{ cleared: number; errors: number }> {
  let cleared = 0; let errors = 0;
  for (const task of tasks) {
    if (task.state !== 'QUEUED' || !task.leaseHolder) continue;
    const expiry = Date.parse(task.leaseExpiresAt ?? '');
    if (Number.isFinite(expiry) && expiry > now) continue;
    const next: Task = { ...task, leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null, updatedAt: new Date(now).toISOString() };
    try { if (await writeTask(next, ['QUEUED'], 'stale_queued_lease_cleared')) { cleared += 1; clearMatchingSlot(task); } else errors += 1; } catch { errors += 1; }
  }
  return { cleared, errors };
}

async function releaseAliveButIdleTasks(tasks: Task[], now: number): Promise<{ seen: number; released: number; runtimeSlotsCleared: number; errors: number }> {
  const staleMs = productivityStaleMs(); let seen = 0; let released = 0; let runtimeSlotsCleared = 0; let errors = 0;
  for (const task of tasks) {
    if (task.state !== 'RUNNING' || !task.leaseHolder) continue;
    const heartbeatMs = Date.parse(task.lastHeartbeatAt ?? ''); if (!Number.isFinite(heartbeatMs) || now - heartbeatMs > HEARTBEAT_FRESH_MS) continue;
    const productiveMs = latestProductiveEvidenceMs(task); if (productiveMs > 0 && now - productiveMs < staleMs) continue;
    if (hasFreshTaskAttempt(task, now, staleMs)) continue;
    seen += 1;
    try { const workerId = task.leaseHolder; const agentId = workerId.startsWith('agent:') ? workerId.slice('agent:'.length) : null; const result = await releaseLease(task.taskId, workerId); if (result.ok) { released += 1; if (agentId) { updateExecutionState(agentId, { availability: 'available', activeTaskId: null }); runtimeSlotsCleared += 1; } } else errors += 1; } catch { errors += 1; }
  }
  return { seen, released, runtimeSlotsCleared, errors };
}

export function hasFreshTaskAttempt(task: Pick<Task, 'attemptStartedAt' | 'startedAt'>, now: number, staleMs: number): boolean {
  const started = Date.parse(task.attemptStartedAt ?? task.startedAt ?? '');
  return Number.isFinite(started) && started <= now && now - started < staleMs;
}

export async function reconcileRetryableBlockedTasks(): Promise<BlockedReconcileResult> {
  const productionSha = resolveProductionSha().toLowerCase(); const tasks = await readRecoveryTasks(productionSha); const blocked = tasks.filter((task) => task.state === 'BLOCKED');
  const current = postgresAtomicQueueSelected() && blocked.some(task => parseLandingTaskKey(task.idempotencyKey)?.sha !== productionSha)
    ? await getLandingTasksForSha(productionSha) : [];
  let superseded = 0; let retirementGuardChecked = false;
  let requeued = 0; let dependencyWaits = 0; let retainedRealDefects = 0; let retainedOwnerOrConfig = 0; let errors = 0; const now = Date.now();
  for (const task of blocked) {
    const updatedMs = Date.parse(task.updatedAt ?? ''); if (Number.isFinite(updatedMs) && now - updatedMs < MIN_BLOCK_AGE_MS) continue;
    const replacement = supersededLandingReplacement(task, current, productionSha, now);
    if (replacement) {
      try {
        if (!retirementGuardChecked) { await assertEmergencyStopInactive('superseded-landing-qa'); retirementGuardChecked = true; }
        const next: Task = { ...task, state: 'CANCELLED', updatedAt: new Date(now).toISOString(), completedAt: new Date(now).toISOString(),
          leaseHolder: null, leaseExpiresAt: null, lastHeartbeatAt: null,
          error: `SUPERSEDED_BY_DEPLOYMENT:${productionSha}; replacementTaskId=${replacement.taskId}${task.error ? `; previousError=${task.error}` : ''}` };
        if (await writeTask(next, ['BLOCKED'], 'landing_task_superseded')) superseded += 1; else errors += 1;
      } catch { errors += 1; }
      continue;
    }
    if (isOwnerOrConfigGate(task)) { retainedOwnerOrConfig += 1; continue; }
    if (isExternalDependencyWait(task)) { try { if (await scheduleDependencyWait(task, now)) dependencyWaits += 1; else errors += 1; } catch { errors += 1; } continue; }
    const taskSha = shaFromTask(task); const staleSha = Boolean(taskSha && productionSha && taskSha !== productionSha);
    if (isRealDefect(task) && !staleSha) { retainedRealDefects += 1; continue; }
    if (!staleSha) continue;
    try { if (await scheduleBlockedRetry(task)) requeued += 1; else errors += 1; } catch { errors += 1; }
  }
  const productivity = await releaseAliveButIdleTasks(tasks, now); errors += productivity.errors;
  const staleQueued = await clearStaleQueuedLeases(tasks, now); errors += staleQueued.errors;
  errors += await releaseDueRetries(tasks, now);
  return { marker: IVX_BLOCKED_RECONCILER_MARKER, measuredAt: new Date().toISOString(), productionSha, blockedSeen: blocked.length, superseded, requeued, dependencyWaits, retainedRealDefects, retainedOwnerOrConfig, aliveButIdleSeen: productivity.seen, staleLeasesReleased: productivity.released, staleQueuedLeasesCleared: staleQueued.cleared, runtimeSlotsCleared: productivity.runtimeSlotsCleared, errors };
}
export function startBlockedTaskReconciler(): boolean { if (timer) return true; if ((process.env.IVX_BLOCKED_RECONCILER ?? 'on').toLowerCase() === 'off') return false; const raw = Number.parseInt(process.env.IVX_BLOCKED_RECONCILER_INTERVAL_MS ?? '', 10); const intervalMs = Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_INTERVAL_MS; const tick = () => { if (runInFlight) return; runInFlight = true; void reconcileRetryableBlockedTasks().then((result) => { if (result.superseded > 0 || result.requeued > 0 || result.dependencyWaits > 0 || result.staleLeasesReleased > 0 || result.staleQueuedLeasesCleared > 0 || result.errors > 0) console.log('[IVX Realtime Productivity Reconciler]', result); }).catch((error) => console.warn('[IVX Realtime Productivity Reconciler] failed', error instanceof Error ? error.message : String(error))).finally(() => { runInFlight = false; }); }; tick(); timer = setInterval(tick, intervalMs); timer.unref?.(); return true; }
export function stopBlockedTaskReconciler(): void { if (!timer) return; clearInterval(timer); timer = null; }
