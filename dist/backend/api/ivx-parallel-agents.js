/**
 * IVX Block 27 — Parallel Agent Execution routes (owner-only).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { PARALLEL_EXECUTION_MARKER, autoDecomposeGoal, dispatchParallelTask, getParentTask, getParentTaskTree, listParentTasks, runParallelValidation, } from '../services/agents/parallel-execution';
import { AGENTS } from '../services/agents/multi-agent-framework';
const VALID_AGENT_IDS = new Set(Object.keys(AGENTS));
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function readAgentId(value) {
    const s = readTrimmed(value);
    return VALID_AGENT_IDS.has(s) ? s : undefined;
}
function getStatus(error) {
    const m = error instanceof Error ? error.message.toLowerCase() : '';
    if (m.includes('missing bearer token') || m.includes('invalid or expired'))
        return 401;
    if (m.includes('privileged ivx access is required'))
        return 403;
    if (m.includes('required') || m.includes('not found') || m.includes('duplicate') || m.includes('unknown'))
        return 400;
    return 500;
}
function errorResponse(error) {
    const msg = error instanceof Error ? error.message : 'IVX parallel-agents route failed.';
    return ownerOnlyJson({
        ok: false,
        error: msg.slice(0, 320),
        marker: PARALLEL_EXECUTION_MARKER,
        timestamp: new Date().toISOString(),
    }, getStatus(error));
}
export function OPTIONS() { return ownerOnlyOptions(); }
function parseChildren(input) {
    if (!Array.isArray(input))
        return undefined;
    const specs = [];
    for (const raw of input) {
        if (!raw || typeof raw !== 'object')
            continue;
        const obj = raw;
        const ref = readTrimmed(obj.ref);
        const goal = readTrimmed(obj.goal);
        if (!ref || !goal)
            continue;
        const forceAgent = readAgentId(obj.forceAgent ?? obj.agentId);
        const dependsOn = Array.isArray(obj.dependsOn)
            ? obj.dependsOn.map((d) => readTrimmed(d)).filter(Boolean)
            : undefined;
        specs.push({ ref, goal, forceAgent, dependsOn });
    }
    return specs.length > 0 ? specs : undefined;
}
export async function handleParallelDispatch(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const goal = readTrimmed(body.goal);
        if (!goal)
            throw new Error('goal is required.');
        const approverEmail = readTrimmed(body.approverEmail) || undefined;
        const children = parseChildren(body.children);
        const parent = await dispatchParallelTask({ goal, children, approverEmail });
        return ownerOnlyJson({
            ok: parent.status === 'completed' || parent.status === 'partial',
            parent,
            marker: PARALLEL_EXECUTION_MARKER,
            timestamp: new Date().toISOString(),
        }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleParallelList(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
        return ownerOnlyJson({
            ok: true,
            parents: listParentTasks(limit).map((p) => ({
                id: p.id,
                goal: p.goal,
                status: p.status,
                children: p.children.length,
                aggregation: p.aggregation,
                createdAt: p.createdAt,
                completedAt: p.completedAt,
            })),
            marker: PARALLEL_EXECUTION_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleParallelGetTree(request, parentId) {
    try {
        await assertIVXOwnerOnly(request);
        const tree = getParentTaskTree(parentId);
        if (!tree)
            throw new Error('parent task not found');
        return ownerOnlyJson({
            ok: true,
            tree,
            marker: PARALLEL_EXECUTION_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleParallelGet(request, parentId) {
    try {
        await assertIVXOwnerOnly(request);
        const parent = getParentTask(parentId);
        if (!parent)
            throw new Error('parent task not found');
        return ownerOnlyJson({
            ok: true,
            parent,
            marker: PARALLEL_EXECUTION_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleParallelDecomposePreview(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const goal = readTrimmed(body.goal);
        if (!goal)
            throw new Error('goal is required.');
        return ownerOnlyJson({
            ok: true,
            goal,
            decomposition: autoDecomposeGoal(goal),
            marker: PARALLEL_EXECUTION_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleParallelValidate(request) {
    try {
        await assertIVXOwnerOnly(request);
        const result = await runParallelValidation();
        return ownerOnlyJson({
            ok: result.ok,
            validation: result,
            marker: PARALLEL_EXECUTION_MARKER,
            timestamp: new Date().toISOString(),
        }, result.ok ? 200 : 207);
    }
    catch (error) {
        return errorResponse(error);
    }
}
