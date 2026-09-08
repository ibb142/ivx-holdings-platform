/**
 * IVX Autonomous Blocked Reconciler
 *
 * Requeues ONLY blockers that are demonstrably transient:
 *  - evidence tied to an older production SHA after a new SHA is live;
 *  - CI/workflow checks that were still in_progress/queued when sampled.
 *
 * Real defects, owner/security gates and missing configuration stay BLOCKED.
 * This prevents stale BLOCKED rows from starving the 112-lane queue without
 * hiding genuine failures.
 */
import { getAllTasks, transitionTaskState, type Task } from './ivx-autonomous-task-engine';
import { resolveProductionSha } from './ivx-landing-p0-backlog';

export const IVX_BLOCKED_RECONCILER_MARKER = 'ivx-autonomous-blocked-reconciler-2026-09-08-v1';
const DEFAULT_INTERVAL_MS = 30_000;
const MIN_BLOCK_AGE_MS = 20_000;
let timer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;

export type BlockedReconcileResult = {
  marker: string;
  measuredAt: string;
  productionSha: string;
  blockedSeen: number;
  requeued: number;
  retainedRealDefects: number;
  retainedOwnerOrConfig: number;
  errors: number;
};

function taskText(task: Task): string {
  return `${task.title}\n${task.description}\n${task.blocker ?? ''}\n${task.idempotencyKey}`.toLowerCase();
}

function shaFromTask(task: Task): string | null {
  const candidates = [task.idempotencyKey, task.description, task.blocker ?? ''].join(' ');
  const match = candidates.match(/\b[0-9a-f]{40}\b/i);
  return match ? match[0].toLowerCase() : null;
}

function isOwnerOrConfigGate(task: Task): boolean {
  const text = taskText(task);
  return /owner approval|owner-gated|not configured|missing credential|secret|iam|permission|billing|payment|mfa|security boundary/.test(text);
}

function isTransientWorkflowBlock(task: Task): boolean {
  const text = taskText(task);
  return /workflow|github actions|e2e acceptance|reels live certificate|live e2e/.test(text)
    && /in_progress|in progress|queued|dispatch it|no .* run exists/.test(text);
}

function isRealDefect(task: Task): boolean {
  const text = taskText(task);
  return /defect persists|\b502\b|\b500\b|broken|invalid contract|missing target|crash|failed/.test(text);
}

export async function reconcileRetryableBlockedTasks(): Promise<BlockedReconcileResult> {
  const productionSha = resolveProductionSha().toLowerCase();
  const tasks = await getAllTasks();
  const blocked = tasks.filter((task) => task.state === 'BLOCKED');
  let requeued = 0;
  let retainedRealDefects = 0;
  let retainedOwnerOrConfig = 0;
  let errors = 0;
  const now = Date.now();

  for (const task of blocked) {
    const updatedMs = Date.parse(task.updatedAt ?? '');
    if (Number.isFinite(updatedMs) && now - updatedMs < MIN_BLOCK_AGE_MS) continue;

    if (isOwnerOrConfigGate(task)) {
      retainedOwnerOrConfig += 1;
      continue;
    }

    const taskSha = shaFromTask(task);
    const staleSha = Boolean(taskSha && productionSha && taskSha !== productionSha);
    const transientWorkflow = isTransientWorkflowBlock(task);

    // A real defect on the CURRENT SHA remains blocked until Autonomous repairs
    // it and produces new evidence. A stale-SHA defect is safe to re-verify.
    if (isRealDefect(task) && !staleSha) {
      retainedRealDefects += 1;
      continue;
    }

    if (!staleSha && !transientWorkflow) continue;

    try {
      const moved = await transitionTaskState(task.taskId, 'QUEUED', {
        blocker: undefined,
        error: undefined,
      });
      if (moved.ok) requeued += 1;
      else errors += 1;
    } catch {
      errors += 1;
    }
  }

  return {
    marker: IVX_BLOCKED_RECONCILER_MARKER,
    measuredAt: new Date().toISOString(),
    productionSha,
    blockedSeen: blocked.length,
    requeued,
    retainedRealDefects,
    retainedOwnerOrConfig,
    errors,
  };
}

export function startBlockedTaskReconciler(): boolean {
  if (timer) return true;
  if ((process.env.IVX_BLOCKED_RECONCILER ?? 'on').toLowerCase() === 'off') return false;
  const raw = Number.parseInt(process.env.IVX_BLOCKED_RECONCILER_INTERVAL_MS ?? '', 10);
  const intervalMs = Number.isFinite(raw) && raw >= 10_000 ? raw : DEFAULT_INTERVAL_MS;
  const tick = () => {
    if (runInFlight) return;
    runInFlight = true;
    void reconcileRetryableBlockedTasks()
      .then((result) => {
        if (result.requeued > 0 || result.errors > 0) console.log('[IVX Blocked Reconciler]', result);
      })
      .catch((error) => console.warn('[IVX Blocked Reconciler] failed', error instanceof Error ? error.message : String(error)))
      .finally(() => { runInFlight = false; });
  };
  tick();
  timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return true;
}

export function stopBlockedTaskReconciler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
