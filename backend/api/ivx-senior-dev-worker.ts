/**
 * IVX Senior Developer Worker API
 *
 * Owner-only endpoints for submitting and polling autonomous senior developer
 * tasks. The actual work is performed by the IVX-SENIOR-DEV-01 background worker.
 *
 * POST /api/ivx/senior-developer/worker/jobs
 *   Creates a durable task (ivx_owner_ai_tasks) with task_type = 'senior_dev'.
 *   Returns HTTP 202 with taskId, status, assigned worker, and approval requirement.
 *
 * GET /api/ivx/senior-developer/worker/jobs/:taskId
 *   Returns the current task state and any evidence produced so far.
 *
 * POST /api/ivx/senior-developer/worker/jobs/:taskId/approve
 *   Owner approves a specific action (e.g., GitHub write, Render deploy) for a task.
 */

import { assertIVXOwnerOnly } from '../api/owner-only';
import {
  enqueueOwnerAITask,
  getTask,
  isTerminalTaskStatus,
  patchTask,
  type IVXOwnerAITaskRow,
} from '../services/ivx-owner-ai-task-queue';
import {
  recordApproval,
  type IVXSeniorDevApprovalAction,
} from '../services/ivx-senior-dev-proof';

const ASSIGNED_WORKER = 'IVX-SENIOR-DEV-01';

function taskResponse(task: IVXOwnerAITaskRow) {
  return {
    taskId: task.id,
    status: task.status,
    taskType: task.task_type ?? 'senior_dev',
    assignedWorker: task.assigned_worker_id ?? ASSIGNED_WORKER,
    approvalRequired: task.status === 'WAITING_APPROVAL',
    checkpoint: task.checkpoint,
    terminal: isTerminalTaskStatus(task.status),
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    filesChanged: task.files_changed ?? [],
    commitSha: task.commit_sha ?? null,
    renderDeployId: task.render_deploy_id ?? null,
    runtimeSha: task.runtime_sha ?? null,
    proofLedgerId: task.proof_ledger_id ?? null,
    errorMessage: task.error_message ?? null,
  };
}

export async function handleSeniorDevWorkerSubmit(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return json({ error: 'OWNER_APPROVAL_REQUIRED' }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json().catch(() => null);
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const prompt = readString(body.goal) || readString(body.prompt) || '';
  if (!prompt) {
    return json({ error: 'Message is required.' }, 400);
  }

  const conversationId = readString(body.conversationId) ?? null;
  const messageId = readString(body.messageId) ?? null;
  const traceId = readString(body.traceId) ?? `senior-dev-${Date.now()}`;
  const idempotencyKey = readString(body.idempotencyKey) ?? `senior-dev-${traceId}`;

  const requiresInternalAuthorization = new URL(request.url).pathname.includes('/autonomous-worker/');
  const task = await enqueueOwnerAITask({
    prompt,
    conversationId,
    messageId,
    traceId,
    idempotencyKey,
    maxRetries: 5,
  });

  // Mark as senior-dev task and assign to the worker.
  await patchTask(task.task.id, {
    task_type: 'senior_dev',
    assigned_worker_id: ASSIGNED_WORKER,
    worker_data: {
      templateMode: body.templateMode,
      proposedPlan: body.proposedPlan,
      filesAffected: body.filesAffected,
      riskLevel: body.riskLevel,
      rollbackPlan: body.rollbackPlan,
      requestsDeploy: body.requestsDeploy,
      internalDeploymentApprovals: body.internalDeploymentApprovals,
      requestedCommitSha: body.requestedCommitSha,
      requiresInternalAuthorization,
    },
    checkpoint: 'QUEUED',
    checkpoint_history: appendCheckpoint(task.task.checkpoint_history, 'QUEUED for IVX-SENIOR-DEV-01'),
  });

  return json({ ok: true, task: taskResponse({ ...task.task, task_type: 'senior_dev', assigned_worker_id: ASSIGNED_WORKER }) }, 202);
}

export async function handleSeniorDevWorkerStatus(request: Request, taskId: string): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return json({ error: 'OWNER_APPROVAL_REQUIRED' }, 401);
  }

  const task = await getTask(taskId);
  if (!task) return json({ error: 'Task not found.' }, 404);
  return json({ ok: true, task: taskResponse(task) }, 200);
}

export async function handleSeniorDevWorkerApprove(request: Request, taskId: string): Promise<Response> {
  let ownerId: string | null = null;
  try {
    const ctx = await assertIVXOwnerOnly(request);
    ownerId = ctx.userId ?? null;
  } catch {
    return json({ error: 'OWNER_APPROVAL_REQUIRED' }, 401);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed = await request.json().catch(() => null);
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const action = readString(body.action) as IVXSeniorDevApprovalAction | null;
  const phrase = readString(body.phrase) ?? '';
  const scope = readString(body.scope) ?? null;
  const commitSha = readString(body.commitSha) ?? null;

  if (!action) return json({ error: 'action is required.' }, 400);
  if (!phrase) return json({ error: 'phrase is required.' }, 400);

  const task = await getTask(taskId);
  if (!task) return json({ error: 'Task not found.' }, 404);
  if (task.status !== 'WAITING_APPROVAL') {
    return json({ error: 'Task is not waiting for approval.', status: task.status }, 409);
  }

  await recordApproval({
    taskId,
    ownerId: ownerId ?? 'unknown',
    action,
    phrase,
    scope,
    commitSha,
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 min
  });

  await patchTask(taskId, {
    status: 'COMMITTING',
    checkpoint: 'COMMITTING (approval granted)',
    checkpoint_history: appendCheckpoint(task.checkpoint_history, `APPROVAL_GRANTED action=${action} phrase=${phrase}`),
  });

  return json({ ok: true, task: taskResponse({ ...task, status: 'COMMITTING' }) }, 200);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function json(payload: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

function appendCheckpoint(
  history: { checkpoint: string; at: string }[] | null | undefined,
  checkpoint: string,
): { checkpoint: string; at: string }[] {
  const list = Array.isArray(history) ? history.slice(-40) : [];
  list.push({ checkpoint, at: new Date().toISOString() });
  return list;
}
