/**
 * IVX Autonomous Task Engine API — owner-only endpoints for the 23-state task
 * state machine, objective planning, agent routing, approval gate, queue leasing,
 * evidence ledger, and honest completion validator.
 *
 * Routes (all owner-only):
 *   GET    /api/ivx/autonomous-task-engine                     — summary
 *   GET    /api/ivx/autonomous-task-engine/objectives           — list objectives
 *   POST   /api/ivx/autonomous-task-engine/objectives           — create objective
 *   GET    /api/ivx/autonomous-task-engine/tasks                — list tasks
 *   POST   /api/ivx/autonomous-task-engine/tasks                — create task
 *   GET    /api/ivx/autonomous-task-engine/tasks/:taskId        — get task
 *   POST   /api/ivx/autonomous-task-engine/tasks/:taskId/transition — transition state
 *   POST   /api/ivx/autonomous-task-engine/tasks/:taskId/evidence — add evidence
 *   POST   /api/ivx/autonomous-task-engine/tasks/:taskId/criterion — mark criterion met
 *   POST   /api/ivx/autonomous-task-engine/lease                — lease next task
 *   POST   /api/ivx/autonomous-task-engine/lease/:taskId/heartbeat — heartbeat
 *   POST   /api/ivx/autonomous-task-engine/lease/:taskId/release — release lease
 *   GET    /api/ivx/autonomous-task-engine/approvals            — list approvals
 *   POST   /api/ivx/autonomous-task-engine/approvals            — create approval
 *   POST   /api/ivx/autonomous-task-engine/approvals/consume    — consume approval
 *   GET    /api/ivx/autonomous-task-engine/validate/:taskId     — validate completion
 *   GET    /api/ivx/autonomous-task-engine/permission-matrix    — permission matrix
 *   GET    /api/ivx/autonomous-task-engine/states               — 23-state machine
 */
import type { Context as HonoContext } from 'hono';
import {
  createObjective,
  createTask,
  transitionTaskState,
  leaseNextTask,
  heartbeat,
  releaseLease,
  createApprovalToken,
  consumeApprovalToken,
  validateCompletion,
  getTaskEngineSummary,
  getAllTasks,
  getAllObjectives,
  getAllApprovals,
  getTaskById,
  addTaskEvidence,
  markCriterionMet,
  routeTaskToAgent,
  isActionAllowed,
  PERMISSION_MATRIX,
  ALL_TASK_STATES,
  ALL_PROTECTED_ACTIONS,
  isTaskCompleted,
  isTaskInProgress,
  requiresApproval,
  type TaskState,
  type ProtectedAction,
} from '../services/ivx-autonomous-task-engine.js';

export async function handleAutonomousTaskEngine(c: HonoContext): Promise<Response> {
  const summary = await getTaskEngineSummary();
  return c.json({ ok: true, marker: summary.marker, summary });
}

export async function handleListObjectives(c: HonoContext): Promise<Response> {
  const objectives = await getAllObjectives();
  return c.json({ ok: true, totalObjectives: objectives.length, objectives });
}

export async function handleCreateObjective(c: HonoContext): Promise<Response> {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const ownerEmail = c.get('ownerEmail') as string | undefined;
  const result = await createObjective({
    ownerRequest: String(body.ownerRequest ?? body.request ?? ''),
    businessOutcome: body.businessOutcome ? String(body.businessOutcome) : undefined,
    technicalOutcome: body.technicalOutcome ? String(body.technicalOutcome) : undefined,
    scope: body.scope ? String(body.scope) : undefined,
    exclusions: Array.isArray(body.exclusions) ? body.exclusions.map(String) : undefined,
    riskClassification: body.riskClassification as 'low' | 'medium' | 'high' | 'critical' | undefined,
    priority: body.priority as 'critical' | 'high' | 'medium' | 'low' | undefined,
    ownerEmail: ownerEmail ?? 'owner@ivxholding.com',
  });
  return c.json(result);
}

export async function handleListTasks(c: HonoContext): Promise<Response> {
  const tasks = await getAllTasks();
  return c.json({ ok: true, totalTasks: tasks.length, tasks });
}

export async function handleCreateTask(c: HonoContext): Promise<Response> {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const result = await createTask({
    objectiveId: body.objectiveId ? String(body.objectiveId) : null,
    parentTaskId: body.parentTaskId ? String(body.parentTaskId) : null,
    title: String(body.title ?? ''),
    description: String(body.description ?? ''),
    taskType: body.taskType as 'development' | 'security' | 'investor_research' | 'buyer_research' | 'outreach' | 'deployment' | 'qa' | 'reporting' | 'discovery' | 'configuration' | undefined,
    idempotencyKey: String(body.idempotencyKey ?? `idem_${Date.now().toString(36)}`),
    assignedAgentNumber: body.assignedAgentNumber ? Number(body.assignedAgentNumber) : null,
    assignedEngine: body.assignedEngine ? String(body.assignedEngine) : null,
    priority: body.priority as 'critical' | 'high' | 'medium' | 'low' | undefined,
    executionOrder: body.executionOrder ? Number(body.executionOrder) : undefined,
    maxRetries: body.maxRetries ? Number(body.maxRetries) : undefined,
  });
  return c.json(result);
}

export async function handleGetTask(c: HonoContext): Promise<Response> {
  const taskId = c.req.param('taskId') ?? '';
  const task = await getTaskById(taskId);
  if (!task) return c.json({ ok: false, error: 'Task not found.' }, 404);
  return c.json({ ok: true, task });
}

export async function handleTransitionTask(c: HonoContext): Promise<Response> {
  const taskId = c.req.param('taskId') ?? '';
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const result = await transitionTaskState(taskId, body.toState as TaskState, {
    error: body.error ? String(body.error) : undefined,
    blocker: body.blocker ? String(body.blocker) : undefined,
    commitSha: body.commitSha ? String(body.commitSha) : undefined,
    deploymentId: body.deploymentId ? String(body.deploymentId) : undefined,
    approvalId: body.approvalId ? String(body.approvalId) : undefined,
  });
  return c.json(result);
}

export async function handleAddEvidence(c: HonoContext): Promise<Response> {
  const taskId = c.req.param('taskId') ?? '';
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const result = await addTaskEvidence(taskId, {
    evidenceType: body.evidenceType as 'source_file_inspected' | 'source_file_changed' | 'code_diff' | 'database_query' | 'database_mutation' | 'test_result' | 'http_request' | 'commit_sha' | 'deployment_id' | 'production_verification' | 'approval_record' | 'log' | 'screenshot' | 'device_qa',
    source: String(body.source ?? ''),
    contentHash: String(body.contentHash ?? ''),
    summary: String(body.summary ?? ''),
    commitSha: body.commitSha ? String(body.commitSha) : null,
    deploymentId: body.deploymentId ? String(body.deploymentId) : null,
  });
  return c.json(result);
}

export async function handleMarkCriterion(c: HonoContext): Promise<Response> {
  const taskId = c.req.param('taskId') ?? '';
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const result = await markCriterionMet(taskId, String(body.criterionId ?? ''), String(body.evidence ?? ''));
  return c.json(result);
}

export async function handleLeaseTask(c: HonoContext): Promise<Response> {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const workerId = String(body.workerId ?? `worker_${Date.now().toString(36)}`);
  const result = await leaseNextTask(workerId);
  return c.json(result);
}

export async function handleHeartbeat(c: HonoContext): Promise<Response> {
  const taskId = c.req.param('taskId') ?? '';
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const workerId = String(body.workerId ?? '');
  if (!workerId) return c.json({ ok: false, error: 'Worker ID required' }, 400);
  const result = await heartbeat(taskId, workerId);
  return c.json(result);
}

export async function handleReleaseLease(c: HonoContext): Promise<Response> {
  const taskId = c.req.param('taskId') ?? '';
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const result = await releaseLease(taskId, String(body.workerId ?? ''));
  return c.json(result);
}

export async function handleListApprovals(c: HonoContext): Promise<Response> {
  const approvals = await getAllApprovals();
  return c.json({ ok: true, totalApprovals: approvals.length, approvals });
}

export async function handleCreateApproval(c: HonoContext): Promise<Response> {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const ownerEmail = c.get('ownerEmail') as string | undefined;
  const result = await createApprovalToken({
    taskId: String(body.taskId ?? ''),
    action: body.action as ProtectedAction,
    resource: String(body.resource ?? ''),
    ownerEmail: ownerEmail ?? String(body.ownerEmail ?? 'owner@ivxholding.com'),
  });
  return c.json(result);
}

export async function handleConsumeApproval(c: HonoContext): Promise<Response> {
  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const ownerEmail = c.get('ownerEmail') as string | undefined;
  const result = await consumeApprovalToken({
    approvalId: String(body.approvalId ?? ''),
    taskId: String(body.taskId ?? ''),
    action: body.action as ProtectedAction,
    ownerEmail: ownerEmail ?? String(body.ownerEmail ?? ''),
    nonce: String(body.nonce ?? ''),
  });
  return c.json(result);
}

export async function handleValidateCompletion(c: HonoContext): Promise<Response> {
  const taskId = c.req.param('taskId') ?? '';
  const task = await getTaskById(taskId);
  if (!task) return c.json({ ok: false, error: 'Task not found.' }, 404);
  const validation = validateCompletion(task);
  return c.json({ ok: true, taskId, validation });
}

export async function handlePermissionMatrix(c: HonoContext): Promise<Response> {
  return c.json({ ok: true, matrix: PERMISSION_MATRIX, protectedActions: ALL_PROTECTED_ACTIONS });
}

export async function handleTaskStates(c: HonoContext): Promise<Response> {
  return c.json({
    ok: true,
    allStates: ALL_TASK_STATES,
    terminalSuccessStates: ['VERIFIED', 'NO_ACTION_REQUIRED'],
    terminalStates: ['VERIFIED', 'NO_ACTION_REQUIRED', 'CANCELLED', 'FAILED', 'EXPIRED'],
    inProgressStates: ALL_TASK_STATES.filter(isTaskInProgress),
  });
}
