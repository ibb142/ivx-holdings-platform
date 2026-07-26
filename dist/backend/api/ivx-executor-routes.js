/**
 * IVX Senior Developer Executor — API routes.
 *
 *   POST /api/ivx/executor/plan       — create a task plan
 *   POST /api/ivx/executor/diff       — request approval (returns approval_id, pending)
 *   POST /api/ivx/executor/approve    — owner approves a pending approval
 *   POST /api/ivx/executor/run        — run one step OR the full pipeline
 *   POST /api/ivx/executor/deploy     — trigger render deploy (requires approval)
 *   GET  /api/ivx/executor/status/:taskId  — task status + steps
 *   GET  /api/ivx/executor/proof/:taskId   — raw proof object for a task
 *   GET  /api/ivx/executor/capabilities     — list capabilities
 *   GET  /api/ivx/executor/tasks            — list tasks
 *   GET  /api/ivx/executor/approvals        — list approvals
 *   GET  /api/ivx/executor/sql              — the approval-table SQL migration
 */
import { EXECUTOR_MARKER, buildProof, createPlan, listApprovals, listCapabilities, listTasks, getTask, approveRequest, requestApproval, runPipeline, runStep, EXECUTOR_APPROVAL_TABLE_SQL, initExecutor, } from '../services/ivx-senior-developer-executor';
import { assertIVXRegisteredOwnerBearer, ownerOnlyOptions, IVXOwnerApprovalError } from './owner-only';
const CORS = {
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
};
function json(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: CORS });
}
async function readBody(request) {
    try {
        const text = await request.text();
        return text ? JSON.parse(text) : {};
    }
    catch {
        return {};
    }
}
function str(value) { return typeof value === 'string' ? value : ''; }
function arr(value) { return Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []; }
function caps(value) {
    const list = Array.isArray(value) ? value : [];
    return list.filter((v) => typeof v === 'string');
}
let initPromise = null;
function ensureInit() {
    if (!initPromise) {
        initPromise = initExecutor().then(() => { }).catch(() => { });
    }
    return initPromise;
}
// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────
export async function handleExecutorCapabilities(request) {
    await ensureInit();
    return json({ ok: true, marker: EXECUTOR_MARKER, capabilities: listCapabilities() });
}
export async function handleExecutorTasks(request) {
    await ensureInit();
    return json({ ok: true, tasks: listTasks() });
}
export async function handleExecutorApprovals(request) {
    await ensureInit();
    return json({ ok: true, approvals: listApprovals() });
}
export async function handleExecutorSql(request) {
    return json({ ok: true, sql: EXECUTOR_APPROVAL_TABLE_SQL, note: 'Run this in Supabase SQL editor to create owner_execution_approvals. Approvals work in-memory until then.' });
}
export async function handleExecutorPlan(request) {
    await ensureInit();
    const body = await readBody(request);
    const summary = str(body.summary).trim() || 'Untitled executor task';
    const capabilities = caps(body.capabilities);
    if (capabilities.length === 0) {
        return json({ ok: false, error: 'capabilities array is required.' }, 400);
    }
    const files_to_change = arr(body.files_to_change);
    const diff_preview = str(body.diff_preview);
    const task = createPlan({ summary, capabilities, files_to_change, diff_preview });
    return json({ ok: true, task });
}
export async function handleExecutorDiff(request) {
    // requestApproval — requires owner identity
    const body = await readBody(request);
    const task_id = str(body.task_id).trim();
    if (!task_id)
        return json({ ok: false, error: 'task_id is required.' }, 400);
    let ownerProof;
    try {
        const { context } = await assertIVXRegisteredOwnerBearer(request, 'executor_diff');
        ownerProof = { userId: context.userId ?? 'unknown', email: context.email ?? 'unknown' };
    }
    catch (e) {
        if (e instanceof IVXOwnerApprovalError)
            return json({ ok: false, error: e.message, proof: e.proof }, e.status);
        return json({ ok: false, error: e instanceof Error ? e.message : 'owner auth failed' }, 401);
    }
    try {
        const approval = await requestApproval(task_id);
        return json({ ok: true, approval, ownerProof: { userId: ownerProof.userId, emailMasked: ownerProof.email } });
    }
    catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : 'requestApproval failed' }, 400);
    }
}
export async function handleExecutorApprove(request) {
    const body = await readBody(request);
    const approval_id = str(body.approval_id).trim();
    if (!approval_id)
        return json({ ok: false, error: 'approval_id is required.' }, 400);
    let ownerProof;
    try {
        const { context } = await assertIVXRegisteredOwnerBearer(request, 'executor_approve');
        ownerProof = { userId: context.userId ?? 'unknown', email: context.email ?? 'unknown' };
    }
    catch (e) {
        if (e instanceof IVXOwnerApprovalError)
            return json({ ok: false, error: e.message, proof: e.proof }, e.status);
        return json({ ok: false, error: e instanceof Error ? e.message : 'owner auth failed' }, 401);
    }
    try {
        const approval = await approveRequest(approval_id, ownerProof);
        return json({ ok: true, approval, approved_by: { userId: ownerProof.userId, emailMasked: ownerProof.email } });
    }
    catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : 'approve failed' }, 400);
    }
}
export async function handleExecutorRun(request) {
    // Running write steps requires an approved task. Read-only steps don't.
    const body = await readBody(request);
    const task_id = str(body.task_id).trim();
    if (!task_id)
        return json({ ok: false, error: 'task_id is required.' }, 400);
    const task = getTask(task_id);
    if (!task)
        return json({ ok: false, error: `Task ${task_id} not found.` }, 404);
    const mode = str(body.mode) === 'pipeline' ? 'pipeline' : 'step';
    try {
        if (mode === 'pipeline') {
            const updated = await runPipeline(task_id);
            return json({ ok: true, task: updated });
        }
        const capability = str(body.capability);
        if (!capability)
            return json({ ok: false, error: 'capability is required for step mode (or set mode=pipeline).' }, 400);
        const stepInput = (body.input && typeof body.input === 'object' ? body.input : {});
        const result = await runStep(task_id, capability, stepInput);
        return json({ ok: result.ok, result, task: getTask(task_id) });
    }
    catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : 'run failed', task: getTask(task_id) }, 400);
    }
}
export async function handleExecutorDeploy(request) {
    const body = await readBody(request);
    const task_id = str(body.task_id).trim();
    if (!task_id)
        return json({ ok: false, error: 'task_id is required.' }, 400);
    const task = getTask(task_id);
    if (!task)
        return json({ ok: false, error: `Task ${task_id} not found.` }, 404);
    try {
        const result = await runStep(task_id, 'render_deploy', {});
        return json({ ok: result.ok, result, task: getTask(task_id) });
    }
    catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : 'deploy failed', task: getTask(task_id) }, 400);
    }
}
export async function handleExecutorStatus(request, taskId) {
    await ensureInit();
    const task = getTask(taskId);
    if (!task)
        return json({ ok: false, error: `Task ${taskId} not found.` }, 404);
    return json({ ok: true, task });
}
export async function handleExecutorProof(request, taskId) {
    await ensureInit();
    try {
        const proof = buildProof(taskId);
        return json({ ok: true, proof });
    }
    catch (e) {
        return json({ ok: false, error: e instanceof Error ? e.message : 'proof failed' }, 404);
    }
}
export { ownerOnlyOptions as executorOptions };
