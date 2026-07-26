/**
 * IVX Block 25 — Multi-Agent Framework routes (owner-only).
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { AGENTS, APPROVAL_LEVELS, MULTI_AGENT_MARKER, completeTask, dispatchTask, failTask, getTask, listActiveAgents, listAudit, listHandoffs, listTasks, readAgentMemory, recordHandoff, routeTaskToAgent, runFrameworkValidation, writeAgentMemory, } from '../services/agents/multi-agent-framework';
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function getStatus(error) {
    const m = error instanceof Error ? error.message.toLowerCase() : '';
    if (m.includes('missing bearer token') || m.includes('invalid or expired'))
        return 401;
    if (m.includes('privileged ivx access is required'))
        return 403;
    if (m.includes('required') || m.includes('not found'))
        return 400;
    return 500;
}
function errorResponse(error) {
    const msg = error instanceof Error ? error.message : 'IVX multi-agent route failed.';
    return ownerOnlyJson({
        ok: false,
        error: msg.slice(0, 320),
        marker: MULTI_AGENT_MARKER,
        timestamp: new Date().toISOString(),
    }, getStatus(error));
}
const VALID_AGENT_IDS = new Set(Object.keys(AGENTS));
function readAgentId(value) {
    const s = readTrimmed(value);
    return VALID_AGENT_IDS.has(s) ? s : undefined;
}
export function OPTIONS() { return ownerOnlyOptions(); }
export async function handleStatus(request) {
    try {
        await assertIVXOwnerOnly(request);
        return ownerOnlyJson({
            ok: true,
            marker: MULTI_AGENT_MARKER,
            block: 'block25-multi-agent-framework',
            approvalLevels: APPROVAL_LEVELS,
            agents: Object.values(AGENTS).map((a) => ({
                id: a.id,
                name: a.name,
                role: a.role,
                memoryNamespace: a.memoryNamespace,
                riskLimit: a.riskLimit,
                allowedTools: a.allowedTools,
                approvalLevel: a.approvalLevel,
            })),
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleListActiveAgents(request) {
    try {
        await assertIVXOwnerOnly(request);
        return ownerOnlyJson({
            ok: true,
            activeAgents: listActiveAgents(),
            marker: MULTI_AGENT_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleDispatch(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const goal = readTrimmed(body.goal);
        if (!goal)
            throw new Error('goal is required.');
        const approverEmail = readTrimmed(body.approverEmail) || undefined;
        const forceAgent = readAgentId(body.agentId);
        const result = dispatchTask({ goal, approverEmail, forceAgent });
        return ownerOnlyJson({
            ok: true,
            task: result.task,
            auditEntries: result.audit,
            marker: MULTI_AGENT_MARKER,
            timestamp: new Date().toISOString(),
        }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleListTasks(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
        return ownerOnlyJson({
            ok: true,
            tasks: listTasks(limit),
            marker: MULTI_AGENT_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleGetTask(request, taskId) {
    try {
        await assertIVXOwnerOnly(request);
        const task = getTask(taskId);
        if (!task)
            throw new Error('task not found');
        return ownerOnlyJson({ ok: true, task, marker: MULTI_AGENT_MARKER, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleHandoff(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const taskId = readTrimmed(body.taskId);
        const fromAgent = readAgentId(body.fromAgent);
        const toAgent = readAgentId(body.toAgent);
        const reason = readTrimmed(body.reason) || 'manual handoff';
        if (!taskId || !fromAgent || !toAgent)
            throw new Error('taskId, fromAgent, toAgent are required.');
        const handoff = recordHandoff(fromAgent, toAgent, taskId, reason);
        return ownerOnlyJson({ ok: true, handoff, marker: MULTI_AGENT_MARKER, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleListHandoffs(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100;
        return ownerOnlyJson({
            ok: true,
            handoffs: listHandoffs(limit),
            marker: MULTI_AGENT_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleAudit(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '100', 10) || 100;
        const agentId = readAgentId(url.searchParams.get('agentId'));
        return ownerOnlyJson({
            ok: true,
            audit: listAudit(limit, agentId),
            marker: MULTI_AGENT_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleMemoryWrite(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const agentId = readAgentId(body.agentId);
        const key = readTrimmed(body.key);
        const value = readTrimmed(body.value);
        if (!agentId || !key || !value)
            throw new Error('agentId, key, value are required.');
        const entry = writeAgentMemory(agentId, key, value, body.metadata ?? {});
        return ownerOnlyJson({ ok: true, entry, marker: MULTI_AGENT_MARKER, timestamp: new Date().toISOString() }, 201);
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleMemoryRead(request) {
    try {
        await assertIVXOwnerOnly(request);
        const url = new URL(request.url);
        const agentId = readAgentId(url.searchParams.get('agentId'));
        const key = readTrimmed(url.searchParams.get('key')) || undefined;
        if (!agentId)
            throw new Error('agentId is required.');
        return ownerOnlyJson({
            ok: true,
            entries: readAgentMemory(agentId, key),
            marker: MULTI_AGENT_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleComplete(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const taskId = readTrimmed(body.taskId);
        if (!taskId)
            throw new Error('taskId is required.');
        const result = body.result ?? {};
        const task = completeTask(taskId, result);
        return ownerOnlyJson({ ok: true, task, marker: MULTI_AGENT_MARKER, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleFail(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const taskId = readTrimmed(body.taskId);
        const errorMessage = readTrimmed(body.error) || 'unspecified failure';
        if (!taskId)
            throw new Error('taskId is required.');
        const task = failTask(taskId, errorMessage);
        return ownerOnlyJson({ ok: true, task, marker: MULTI_AGENT_MARKER, timestamp: new Date().toISOString() });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleRoutePreview(request) {
    try {
        await assertIVXOwnerOnly(request);
        const body = await request.json().catch(() => ({}));
        const goal = readTrimmed(body.goal);
        if (!goal)
            throw new Error('goal is required.');
        return ownerOnlyJson({
            ok: true,
            goal,
            routedAgent: routeTaskToAgent(goal),
            marker: MULTI_AGENT_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
export async function handleValidate(request) {
    try {
        await assertIVXOwnerOnly(request);
        const result = runFrameworkValidation();
        return ownerOnlyJson({
            ok: result.ok,
            validation: result,
            marker: MULTI_AGENT_MARKER,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return errorResponse(error);
    }
}
