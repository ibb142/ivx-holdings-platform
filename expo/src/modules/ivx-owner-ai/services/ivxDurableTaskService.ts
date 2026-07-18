/**
 * IVX Owner AI Durable Task client — P0 503 recovery fallback.
 *
 * When the primary Owner AI request fails with a transient failure
 * (503/502/504/429/timeout/network), the owner message is handed to the
 * backend durable task queue instead of being lost:
 *   1. POST /api/ivx/owner-ai/tasks persists the message FIRST and returns a
 *      task id immediately — the mobile HTTP request never stays open.
 *   2. The client polls the task id; the backend worker retries with backoff,
 *      fails over providers, and persists the assistant reply.
 *   3. Pending task ids survive app restart via AsyncStorage so progress is
 *      restored when the app reopens.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { getIVXAccessToken, IVX_CANONICAL_API_BASE_URL } from '@/lib/ivx-supabase-client';

const TASKS_ENDPOINT = `${IVX_CANONICAL_API_BASE_URL}/api/ivx/owner-ai/tasks`;
const PENDING_TASKS_STORAGE_KEY = 'ivx_owner_ai_pending_durable_tasks';
const POLL_INTERVAL_MS = 3_000;
const DEFAULT_POLL_BUDGET_MS = 5 * 60_000;

const TRANSIENT_STATUS_CODES = [408, 429, 502, 503, 504];
const TRANSIENT_MESSAGE_PATTERN = /timed?\s?out|timeout|network|connection|abort|unavailable|fetch failed|socket/i;

export interface DurableTaskView {
  taskId: string;
  traceId: string;
  status: string;
  terminal: boolean;
  checkpoint: string;
  retryCount: number;
  answer: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  deadLetter: boolean;
}

export interface DurableFallbackResult {
  ok: boolean;
  taskId: string | null;
  status: string | null;
  checkpoint: string | null;
  answer: string | null;
  error: string | null;
}

interface PendingTaskRecord {
  taskId: string;
  conversationId: string | null;
  messagePreview: string;
  createdAt: string;
}

/**
 * Decide whether a primary-route failure is safe to hand to the durable queue.
 * Only transient failures qualify — auth/validation failures are never retried.
 */
export function shouldAttemptDurableFallback(
  diagnostics: { statusCode?: number | null; stage?: string | null } | null,
  failureMessage: string,
): boolean {
  const status = diagnostics?.statusCode ?? null;
  if (status !== null) {
    if (TRANSIENT_STATUS_CODES.includes(status)) return true;
    if (status >= 500) return true;
    // 4xx auth/validation — do not re-execute automatically.
    return false;
  }
  if (diagnostics?.stage === 'auth') return false;
  return TRANSIENT_MESSAGE_PATTERN.test(failureMessage);
}

function parseTaskView(payload: unknown): DurableTaskView | null {
  if (!payload || typeof payload !== 'object') return null;
  const task = (payload as { task?: Record<string, unknown> }).task;
  if (!task || typeof task !== 'object') return null;
  return {
    taskId: String(task.taskId ?? ''),
    traceId: String(task.traceId ?? ''),
    status: String(task.status ?? 'UNKNOWN'),
    terminal: task.terminal === true,
    checkpoint: String(task.checkpoint ?? ''),
    retryCount: Number(task.retryCount ?? 0),
    answer: typeof task.answer === 'string' ? task.answer : null,
    errorCode: typeof task.errorCode === 'string' ? task.errorCode : null,
    errorMessage: typeof task.errorMessage === 'string' ? task.errorMessage : null,
    deadLetter: task.deadLetter === true,
  };
}

async function authHeaders(): Promise<Record<string, string> | null> {
  const accessToken = await getIVXAccessToken();
  if (!accessToken) return null;
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` };
}

async function loadPendingTasks(): Promise<PendingTaskRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_TASKS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingTaskRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function savePendingTask(record: PendingTaskRecord): Promise<void> {
  try {
    const current = await loadPendingTasks();
    const next = [...current.filter((item) => item.taskId !== record.taskId), record].slice(-10);
    await AsyncStorage.setItem(PENDING_TASKS_STORAGE_KEY, JSON.stringify(next));
  } catch (error) {
    console.log('[IVXDurableTask] pending-task save failed (non-fatal):', error instanceof Error ? error.message : 'unknown');
  }
}

async function clearPendingTask(taskId: string): Promise<void> {
  try {
    const current = await loadPendingTasks();
    await AsyncStorage.setItem(PENDING_TASKS_STORAGE_KEY, JSON.stringify(current.filter((item) => item.taskId !== taskId)));
  } catch {
    // non-fatal
  }
}

/** Enqueue the owner message as a durable backend task (persist-first, 202). */
export async function enqueueDurableOwnerAITask(input: {
  message: string;
  conversationId: string | null;
  messageId?: string | null;
  traceId?: string | null;
  idempotencyKey?: string | null;
}): Promise<{ ok: boolean; task: DurableTaskView | null; duplicate: boolean; error: string | null }> {
  const headers = await authHeaders();
  if (!headers) return { ok: false, task: null, duplicate: false, error: 'Owner session unavailable for durable fallback.' };
  try {
    const response = await fetch(TASKS_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        message: input.message,
        conversationId: input.conversationId,
        messageId: input.messageId ?? null,
        traceId: input.traceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
      }),
    });
    const payload = await response.json().catch(() => null) as { duplicate?: boolean; error?: string } | null;
    const task = parseTaskView(payload);
    if (!response.ok && response.status !== 202) {
      return { ok: false, task, duplicate: payload?.duplicate === true, error: payload?.error ?? `Durable intake failed (HTTP ${response.status}).` };
    }
    if (task?.taskId) {
      await savePendingTask({
        taskId: task.taskId,
        conversationId: input.conversationId,
        messagePreview: input.message.slice(0, 120),
        createdAt: new Date().toISOString(),
      });
    }
    return { ok: task !== null, task, duplicate: payload?.duplicate === true, error: task ? null : 'Durable intake returned no task.' };
  } catch (error) {
    return { ok: false, task: null, duplicate: false, error: error instanceof Error ? error.message : 'Durable intake failed.' };
  }
}

/** Fetch a single task's current state. */
export async function getDurableTask(taskId: string): Promise<DurableTaskView | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  try {
    const response = await fetch(`${TASKS_ENDPOINT}/${encodeURIComponent(taskId)}`, { method: 'GET', headers });
    if (!response.ok) return null;
    return parseTaskView(await response.json().catch(() => null));
  } catch {
    return null;
  }
}

/** Cancel a durable task (owner action). */
export async function cancelDurableTask(taskId: string, reason: string = 'Canceled by owner from app.'): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers) return false;
  try {
    const response = await fetch(`${TASKS_ENDPOINT}/${encodeURIComponent(taskId)}/cancel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ reason }),
    });
    if (response.ok) await clearPendingTask(taskId);
    return response.ok;
  } catch {
    return false;
  }
}

/** Manually retry a failed durable task. */
export async function retryDurableTask(taskId: string): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers) return false;
  try {
    const response = await fetch(`${TASKS_ENDPOINT}/${encodeURIComponent(taskId)}/retry`, { method: 'POST', headers });
    return response.ok || response.status === 202;
  } catch {
    return false;
  }
}

/** Poll a task until it reaches a terminal state or the budget expires. */
export async function pollDurableTask(
  taskId: string,
  options?: { budgetMs?: number; onStatus?: (task: DurableTaskView) => void },
): Promise<DurableTaskView | null> {
  const budgetMs = options?.budgetMs ?? DEFAULT_POLL_BUDGET_MS;
  const deadline = Date.now() + budgetMs;
  let last: DurableTaskView | null = null;
  while (Date.now() < deadline) {
    const task = await getDurableTask(taskId);
    if (task) {
      last = task;
      try { options?.onStatus?.(task); } catch { /* status callback must never break polling */ }
      if (task.terminal || task.status === 'COMPLETED') {
        await clearPendingTask(taskId);
        return task;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return last;
}

/**
 * Full durable fallback: enqueue + poll to completion.
 * The owner message is preserved server-side regardless of what the app does next.
 */
export async function runDurableOwnerAIFallback(input: {
  message: string;
  conversationId: string | null;
  messageId?: string | null;
  traceId?: string | null;
  onStatus?: (task: DurableTaskView) => void;
}): Promise<DurableFallbackResult> {
  const intake = await enqueueDurableOwnerAITask(input);
  if (!intake.ok || !intake.task) {
    return { ok: false, taskId: intake.task?.taskId ?? null, status: intake.task?.status ?? null, checkpoint: null, answer: null, error: intake.error };
  }
  const final = await pollDurableTask(intake.task.taskId, { onStatus: input.onStatus });
  if (!final) {
    return { ok: false, taskId: intake.task.taskId, status: 'UNKNOWN', checkpoint: null, answer: null, error: 'Task status unavailable — it keeps running server-side and will be restored on reopen.' };
  }
  const succeeded = (final.status === 'VERIFIED' || final.status === 'COMPLETED') && typeof final.answer === 'string' && final.answer.length > 0;
  return {
    ok: succeeded,
    taskId: final.taskId,
    status: final.status,
    checkpoint: final.checkpoint,
    answer: final.answer,
    error: succeeded ? null : (final.errorMessage ?? `Task ended in ${final.status}.`),
  };
}

/**
 * Restore progress after app restart: re-poll every pending durable task.
 * Returns tasks that completed while the app was closed.
 */
export async function resumePendingDurableTasks(
  onStatus?: (task: DurableTaskView) => void,
): Promise<DurableTaskView[]> {
  const pending = await loadPendingTasks();
  if (pending.length === 0) return [];
  console.log('[IVXDurableTask] resuming pending durable tasks after app restart', { count: pending.length });
  const restored: DurableTaskView[] = [];
  for (const record of pending) {
    const task = await getDurableTask(record.taskId);
    if (!task) continue;
    try { onStatus?.(task); } catch { /* non-fatal */ }
    if (task.terminal || task.status === 'COMPLETED') {
      await clearPendingTask(task.taskId);
      restored.push(task);
    }
  }
  return restored;
}
