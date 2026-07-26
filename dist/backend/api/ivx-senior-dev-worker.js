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
import { enqueueOwnerAITask, getTask, isTerminalTaskStatus, patchTask, } from '../services/ivx-owner-ai-task-queue';
import { recordApproval, } from '../services/ivx-senior-dev-proof';
import { createOwnerDeploymentApproval } from '../services/ivx-internal-deploy-auth';
const ASSIGNED_WORKER = 'IVX-SENIOR-DEV-01';
function taskResponse(task) {
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
export async function handleSeniorDevWorkerSubmit(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch {
        return json({ error: 'OWNER_APPROVAL_REQUIRED' }, 401);
    }
    let body = {};
    try {
        const parsed = await request.json().catch(() => null);
        if (parsed && typeof parsed === 'object')
            body = parsed;
    }
    catch {
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
    const requestedCommitSha = readString(body.requestedCommitSha)?.toLowerCase() ?? '';
    const internalDeploymentApprovals = readInternalApprovalMap(body.internalDeploymentApprovals);
    if (requiresInternalAuthorization && (!/^[a-f0-9]{40}$/.test(requestedCommitSha) || !internalDeploymentApprovals.GITHUB_WRITE)) {
        return json({ error: 'Autonomous jobs require an exact requestedCommitSha and a GITHUB_WRITE approval ID.' }, 400);
    }
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
            internalDeploymentApprovals,
            requestedCommitSha,
            requiresInternalAuthorization,
        },
        checkpoint: 'QUEUED',
        checkpoint_history: appendCheckpoint(task.task.checkpoint_history, 'QUEUED for IVX-SENIOR-DEV-01'),
    });
    return json({ ok: true, task: taskResponse({ ...task.task, task_type: 'senior_dev', assigned_worker_id: ASSIGNED_WORKER }) }, 202);
}
export async function handleSeniorDevWorkerStatus(request, taskId) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch {
        return json({ error: 'OWNER_APPROVAL_REQUIRED' }, 401);
    }
    const task = await getTask(taskId);
    if (!task)
        return json({ error: 'Task not found.' }, 404);
    return json({ ok: true, task: taskResponse(task) }, 200);
}
export async function handleSeniorDevWorkerApprove(request, taskId) {
    let ownerId = null;
    try {
        const ctx = await assertIVXOwnerOnly(request);
        ownerId = ctx.userId ?? null;
    }
    catch {
        return json({ error: 'OWNER_APPROVAL_REQUIRED' }, 401);
    }
    let body = {};
    try {
        const parsed = await request.json().catch(() => null);
        if (parsed && typeof parsed === 'object')
            body = parsed;
    }
    catch {
        return json({ error: 'Invalid JSON body.' }, 400);
    }
    const action = readString(body.action);
    const phrase = readString(body.phrase) ?? '';
    const scope = readString(body.scope) ?? null;
    const commitSha = readString(body.commitSha) ?? null;
    if (!action)
        return json({ error: 'action is required.' }, 400);
    if (!phrase)
        return json({ error: 'phrase is required.' }, 400);
    const task = await getTask(taskId);
    if (!task)
        return json({ error: 'Task not found.' }, 404);
    if (task.status !== 'WAITING_APPROVAL') {
        return json({ error: 'Task is not waiting for approval.', status: task.status }, 409);
    }
    if (isAutonomousWorkerTask(task) && action === 'RENDER_DEPLOY') {
        const committedSha = (task.commit_sha ?? '').trim().toLowerCase();
        if (!/^[a-f0-9]{40}$/.test(committedSha) || commitSha?.toLowerCase() !== committedSha) {
            return json({ error: 'RENDER_DEPLOY approval must be bound to this task’s committed SHA.' }, 409);
        }
        const internalApproval = await createOwnerDeploymentApproval({
            ownerUserId: ownerId ?? 'unknown',
            requestedCommitSha: committedSha,
            action: 'RENDER_DEPLOY',
            requestId: `autonomous-${taskId}-render-${Date.now()}`,
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        });
        const existingWorkerData = readRecord(task.worker_data);
        const approvals = readInternalApprovalMap(existingWorkerData.internalDeploymentApprovals);
        await patchTask(taskId, {
            worker_data: {
                ...existingWorkerData,
                requestedCommitSha: committedSha,
                internalDeploymentApprovals: { ...approvals, RENDER_DEPLOY: internalApproval.id },
            },
        });
    }
    await recordApproval({
        taskId,
        ownerId: ownerId ?? 'unknown',
        action,
        phrase,
        scope,
        commitSha,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    await patchTask(taskId, {
        status: 'COMMITTING',
        checkpoint: 'COMMITTING (approval granted)',
        checkpoint_history: appendCheckpoint(task.checkpoint_history, `APPROVAL_GRANTED action=${action} phrase=${phrase}`),
    });
    return json({ ok: true, task: taskResponse({ ...task, status: 'COMMITTING' }) }, 200);
}
function readString(value) {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}
function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function readInternalApprovalMap(value) {
    return Object.fromEntries(Object.entries(readRecord(value)).filter(([key, item]) => ((key === 'GITHUB_WRITE' || key === 'RENDER_DEPLOY' || key === 'PRODUCTION_DEPLOY')
        && typeof item === 'string'
        && item.trim().length > 0)).map(([key, item]) => [key, item.trim()]));
}
function isAutonomousWorkerTask(task) {
    return readRecord(task.worker_data).requiresInternalAuthorization === true;
}
function json(payload, status) {
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}
function appendCheckpoint(history, checkpoint) {
    const list = Array.isArray(history) ? history.slice(-40) : [];
    list.push({ checkpoint, at: new Date().toISOString() });
    return list;
}
