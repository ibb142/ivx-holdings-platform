/** IVX Autonomous blocked + productivity recovery hot loop. */
import { getAllTasks, releaseLease, transitionTaskState, type Task } from './ivx-autonomous-task-engine';
import { updateExecutionState } from './ivx-agent-runtime';
import { resolveProductionSha } from './ivx-landing-p0-backlog';
import { postgresAtomicQueueSelected, readPostgresCurrentTasks } from './ivx-postgres-autonomous-task-store';

export const IVX_BLOCKED_RECONCILER_MARKER = 'ivx-autonomous-realtime-productivity-reconciler-2026-09-08-current-work-v4';
const DEFAULT_INTERVAL_MS = 15_000;
const MIN_BLOCK_AGE_MS = 20_000;
const DEFAULT_PRODUCTIVITY_STALE_MS = 5 * 60_000;
const HEARTBEAT_FRESH_MS = 60_000;
let timer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;
export type BlockedReconcileResult = { marker: string; measuredAt: string; productionSha: string; blockedSeen: number; requeued: number; retainedRealDefects: number; retainedOwnerOrConfig: number; aliveButIdleSeen: number; staleLeasesReleased: number; runtimeSlotsCleared: number; errors: number };
function taskText(task: Task): string { return `${task.title}\n${task.description}\n${task.blocker ?? ''}\n${task.idempotencyKey}`.toLowerCase(); }
function shaFromTask(task: Task): string | null { const match = [task.idempotencyKey, task.description, task.blocker ?? ''].join(' ').match(/\b[0-9a-f]{40}\b/i); return match ? match[0].toLowerCase() : null; }
function isOwnerOrConfigGate(task: Task): boolean { return /owner approval|owner-gated|not configured|missing credential|secret|iam|permission|billing|payment|mfa|security boundary/.test(taskText(task)); }
function isTransientWorkflowBlock(task: Task): boolean { const text = taskText(task); return /workflow|github actions|e2e acceptance|reels live certificate|live e2e/.test(text) && /in_progress|in progress|queued|dispatch it|no .* run exists/.test(text); }
function isRealDefect(task: Task): boolean { return /defect persists|\b502\b|\b500\b|broken|invalid contract|missing target|crash|failed/.test(taskText(task)); }
function productivityStaleMs(): number { const raw = Number.parseInt(process.env.IVX_PRODUCTIVITY_STALE_MS ?? '', 10); return Number.isFinite(raw) ? Math.max(60_000, Math.min(raw, 30 * 60_000)) : DEFAULT_PRODUCTIVITY_STALE_MS; }
function latestProductiveEvidenceMs(task: Task): number { let latest = Date.parse(task.startedAt ?? task.createdAt ?? '') || 0; for (const evidence of task.evidence ?? []) { const at = Date.parse(evidence.createdAt ?? ''); if (Number.isFinite(at) && at > latest) latest = at; } return latest; }
async function readRecoveryTasks(): Promise<Task[]> {
  // Production atomic queue: this hot 15-second loop must never paginate the
  // historical ledger. Only states this reconciler can act on are transferred.
  if (postgresAtomicQueueSelected()) return readPostgresCurrentTasks(['BLOCKED', 'RUNNING']);
  return getAllTasks();
}
async function releaseAliveButIdleTasks(tasks: Task[], now: number): Promise<{ seen: number; released: number; runtimeSlotsCleared: number; errors: number }> {
  const staleMs = productivityStaleMs(); let seen = 0; let released = 0; let runtimeSlotsCleared = 0; let errors = 0;
  for (const task of tasks) {
    if (task.state !== 'RUNNING' || !task.leaseHolder) continue;
    const heartbeatMs = Date.parse(task.lastHeartbeatAt ?? ''); if (!Number.isFinite(heartbeatMs) || now - heartbeatMs > HEARTBEAT_FRESH_MS) continue;
    const productiveMs = latestProductiveEvidenceMs(task); if (productiveMs > 0 && now - productiveMs < staleMs) continue;
    const startedMs = Date.parse(task.startedAt ?? ''); if (Number.isFinite(startedMs) && now - startedMs < staleMs) continue;
    seen += 1;
    try { const workerId = task.leaseHolder; const agentId = workerId.startsWith('agent:') ? workerId.slice('agent:'.length) : null; const result = await releaseLease(task.taskId, workerId); if (result.ok) { released += 1; if (agentId) { updateExecutionState(agentId, { availability: 'available', activeTaskId: null }); runtimeSlotsCleared += 1; } } else errors += 1; } catch { errors += 1; }
  }
  return { seen, released, runtimeSlotsCleared, errors };
}
export async function reconcileRetryableBlockedTasks(): Promise<BlockedReconcileResult> {
  const productionSha = resolveProductionSha().toLowerCase();
  // Fail closed: if current-work truth cannot be read, this run throws instead
  // of pretending the fleet is healthy or scanning stale historical records.
  const tasks = await readRecoveryTasks();
  const blocked = tasks.filter((task) => task.state === 'BLOCKED');
  let requeued = 0; let retainedRealDefects = 0; let retainedOwnerOrConfig = 0; let errors = 0; const now = Date.now();
  for (const task of blocked) {
    const updatedMs = Date.parse(task.updatedAt ?? ''); if (Number.isFinite(updatedMs) && now - updatedMs < MIN_BLOCK_AGE_MS) continue;
    if (isOwnerOrConfigGate(task)) { retainedOwnerOrConfig += 1; continue; }
    const taskSha = shaFromTask(task); const staleSha = Boolean(taskSha && productionSha && taskSha !== productionSha); const transientWorkflow = isTransientWorkflowBlock(task);
    if (isRealDefect(task) && !staleSha) { retainedRealDefects += 1; continue; }
    if (!staleSha && !transientWorkflow) continue;
    try { const moved = await transitionTaskState(task.taskId, 'QUEUED', { blocker: undefined, error: undefined }); if (moved.ok) requeued += 1; else errors += 1; } catch { errors += 1; }
  }
  const productivity = await releaseAliveButIdleTasks(tasks, now); errors += productivity.errors;
  return { marker: IVX_BLOCKED_RECONCILER_MARKER, measuredAt: new Date().toISOString(), productionSha, blockedSeen: blocked.length, requeued, retainedRealDefects, retainedOwnerOrConfig, aliveButIdleSeen: productivity.seen, staleLeasesReleased: productivity.released, runtimeSlotsCleared: productivity.runtimeSlotsCleared, errors };
}
export function startBlockedTaskReconciler(): boolean {
  if (timer) return true; if ((process.env.IVX_BLOCKED_RECONCILER ?? 'on').toLowerCase() === 'off') return false;
  const raw = Number.parseInt(process.env.IVX_BLOCKED_RECONCILER_INTERVAL_MS ?? '', 10); const intervalMs = Number.isFinite(raw) && raw >= 5_000 ? raw : DEFAULT_INTERVAL_MS;
  const tick = () => { if (runInFlight) return; runInFlight = true; void reconcileRetryableBlockedTasks().then((result) => { if (result.requeued > 0 || result.staleLeasesReleased > 0 || result.errors > 0) console.log('[IVX Realtime Productivity Reconciler]', result); }).catch((error) => console.warn('[IVX Realtime Productivity Reconciler] failed', error instanceof Error ? error.message : String(error))).finally(() => { runInFlight = false; }); };
  tick(); timer = setInterval(tick, intervalMs); timer.unref?.(); return true;
}
export function stopBlockedTaskReconciler(): void { if (!timer) return; clearInterval(timer); timer = null; }
