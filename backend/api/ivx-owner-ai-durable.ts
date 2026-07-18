/**
 * IVX Owner AI Durable Task API — owner-only endpoints for the P0 reliability layer.
 *
 * POST /api/ivx/owner-ai/tasks                     — persist-first intake, returns taskId immediately (202)
 * GET  /api/ivx/owner-ai/tasks                     — list recent tasks
 * GET  /api/ivx/owner-ai/tasks/:id                 — task status (checkpoint, retries, durations)
 * POST /api/ivx/owner-ai/tasks/:id/retry           — manual retry of a failed/canceled task
 * POST /api/ivx/owner-ai/tasks/:id/cancel          — owner cancellation
 * POST /api/ivx/owner-ai/tasks/recover             — requeue orphaned RUNNING tasks now
 * POST /api/ivx/owner-ai/tasks/replay-dead-letter  — replay all dead-letter tasks
 * GET  /api/ivx/owner-ai/incidents                 — recent 5xx incidents on the owner AI route
 */

import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import {
  enqueueOwnerAITask,
  getTask,
  listTasks,
  retryTask,
  cancelTask,
  recoverOrphanTasks,
  replayDeadLetterTasks,
  listOwnerAIIncidents,
  isTaskQueueConfigured,
  getWorkerRuntimeInfo,
  isTerminalTaskStatus,
  type ChaosState,
} from '../services/ivx-owner-ai-task-queue';

export function ownerAIDurableOptions(): Response {
  return ownerOnlyOptions();
}

async function requireOwner(request: Request): Promise<Response | null> {
  try {
    await assertIVXOwnerOnly(request);
    return null;
  } catch (error) {
    const status = error instanceof Error && 'status' in error ? (error as { status: number }).status : 401;
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'IVX owner authentication failed.' }, status);
  }
}

interface DurableTaskCreateBody {
  message?: string;
  prompt?: string;
  conversationId?: string | null;
  messageId?: string | null;
  traceId?: string | null;
  idempotencyKey?: string | null;
  maxRetries?: number;
  chaos?: { failuresRemaining?: number; simulatedStatus?: number } | null;
}

function normalizeChaos(input: DurableTaskCreateBody['chaos']): ChaosState | null {
  if (!input || typeof input !== 'object') return null;
  const failures = Number(input.failuresRemaining ?? 0);
  if (!Number.isFinite(failures) || failures <= 0) return null;
  const status = Number(input.simulatedStatus ?? 503);
  return {
    failures_remaining: Math.min(Math.max(Math.round(failures), 1), 20),
    simulated_status: [429, 502, 503, 504].includes(status) ? status : 503,
  };
}

function taskView(task: NonNullable<Awaited<ReturnType<typeof getTask>>>): Record<string, unknown> {
  return {
    taskId: task.id,
    traceId: task.trace_id,
    idempotencyKey: task.idempotency_key,
    conversationId: task.conversation_id,
    messageId: task.message_id,
    status: task.status,
    terminal: isTerminalTaskStatus(task.status),
    checkpoint: task.checkpoint,
    checkpointHistory: task.checkpoint_history,
    retryCount: task.retry_count,
    maxRetries: task.max_retries,
    nextRetryAt: task.next_retry_at,
    answer: task.answer,
    assistantMessageId: task.assistant_message_id,
    model: task.model,
    provider: task.provider,
    errorCode: task.error_code,
    errorMessage: task.error_message,
    httpStatus: task.http_status,
    failureSource: task.failure_source,
    durations: task.durations,
    deadLetter: task.dead_letter,
    createdAt: task.created_at,
    updatedAt: task.updated_at,
  };
}

/** POST /api/ivx/owner-ai/tasks — persist first, return the task id immediately. */
export async function handleOwnerAITaskCreate(request: Request): Promise<Response> {
  const authFailure = await requireOwner(request);
  if (authFailure) return authFailure;

  if (!isTaskQueueConfigured()) {
    return ownerOnlyJson({ ok: false, error: 'Durable task queue persistence is not configured in this runtime.' }, 503);
  }

  let body: DurableTaskCreateBody;
  try {
    body = await request.json() as DurableTaskCreateBody;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const prompt = (body.message ?? body.prompt ?? '').trim();
  if (!prompt) {
    return ownerOnlyJson({ ok: false, error: 'message is required.' }, 400);
  }

  try {
    const { task, duplicate } = await enqueueOwnerAITask({
      prompt,
      conversationId: body.conversationId ?? null,
      messageId: body.messageId ?? null,
      traceId: body.traceId ?? null,
      idempotencyKey: body.idempotencyKey ?? null,
      maxRetries: body.maxRetries,
      chaos: normalizeChaos(body.chaos),
    });
    return ownerOnlyJson({
      ok: true,
      duplicate,
      task: taskView(task),
      poll: `/api/ivx/owner-ai/tasks/${task.id}`,
      message: duplicate
        ? 'Duplicate send detected — returning the existing task for this idempotency key.'
        : 'Task persisted and queued. Poll the task id for progress; the mobile request does not stay open.',
    }, duplicate ? 200 : 202);
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      error: error instanceof Error ? error.message : 'Task intake failed.',
    }, 503);
  }
}

/** GET /api/ivx/owner-ai/tasks/:id */
export async function handleOwnerAITaskStatus(request: Request, taskId: string): Promise<Response> {
  const authFailure = await requireOwner(request);
  if (authFailure) return authFailure;
  const task = await getTask(taskId);
  if (!task) return ownerOnlyJson({ ok: false, error: 'Task not found.', taskId }, 404);
  return ownerOnlyJson({ ok: true, task: taskView(task) }, 200);
}

/** GET /api/ivx/owner-ai/tasks */
export async function handleOwnerAITaskList(request: Request): Promise<Response> {
  const authFailure = await requireOwner(request);
  if (authFailure) return authFailure;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '20');
  const tasks = await listTasks(Number.isFinite(limit) ? limit : 20);
  return ownerOnlyJson({
    ok: true,
    worker: getWorkerRuntimeInfo(),
    count: tasks.length,
    tasks: tasks.map(taskView),
  }, 200);
}

/** POST /api/ivx/owner-ai/tasks/:id/retry */
export async function handleOwnerAITaskRetry(request: Request, taskId: string): Promise<Response> {
  const authFailure = await requireOwner(request);
  if (authFailure) return authFailure;
  const result = await retryTask(taskId);
  if (!result.task) return ownerOnlyJson({ ok: false, error: 'Task not found.', taskId }, 404);
  if (!result.ok && result.reason === 'already_in_flight') {
    return ownerOnlyJson({ ok: false, error: 'Task is already queued or running.', task: taskView(result.task) }, 409);
  }
  return ownerOnlyJson({ ok: true, reason: result.reason ?? 'requeued', task: taskView(result.task) }, 202);
}

/** POST /api/ivx/owner-ai/tasks/:id/cancel */
export async function handleOwnerAITaskCancel(request: Request, taskId: string): Promise<Response> {
  const authFailure = await requireOwner(request);
  if (authFailure) return authFailure;
  let reason = 'Canceled by owner.';
  try {
    const body = await request.json() as { reason?: string };
    if (body.reason && typeof body.reason === 'string') reason = body.reason;
  } catch { /* empty body is fine */ }
  const task = await cancelTask(taskId, reason);
  if (!task) return ownerOnlyJson({ ok: false, error: 'Task not found.', taskId }, 404);
  return ownerOnlyJson({ ok: true, task: taskView(task) }, 200);
}

/** POST /api/ivx/owner-ai/tasks/recover */
export async function handleOwnerAITaskRecover(request: Request): Promise<Response> {
  const authFailure = await requireOwner(request);
  if (authFailure) return authFailure;
  const recovered = await recoverOrphanTasks();
  return ownerOnlyJson({ ok: true, recovered }, 200);
}

/** POST /api/ivx/owner-ai/tasks/replay-dead-letter */
export async function handleOwnerAITaskReplayDeadLetter(request: Request): Promise<Response> {
  const authFailure = await requireOwner(request);
  if (authFailure) return authFailure;
  const replayed = await replayDeadLetterTasks();
  return ownerOnlyJson({ ok: true, replayed }, 200);
}

/** GET /api/ivx/owner-ai/incidents */
export async function handleOwnerAIIncidentList(request: Request): Promise<Response> {
  const authFailure = await requireOwner(request);
  if (authFailure) return authFailure;
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get('limit') ?? '50');
  return ownerOnlyJson({
    ok: true,
    incidents: listOwnerAIIncidents(Number.isFinite(limit) ? limit : 50),
  }, 200);
}
