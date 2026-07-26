import { AGENTS, classifyTaskRisk, routeTaskToAgent } from './agents/multi-agent-framework';
import { buildIVXOwnerAIPlannerDecision } from './ivx-owner-ai-intent-router';
import { classifyTaskIntent, requiredCapabilitiesFor } from './ivx-pre-execution-feasibility-gate';
export const IVX_AGENT_RUNTIME_V2_MARKER = 'ivx-agent-runtime-v2-2026-05-19';
export const IVX_AGENT_RUNTIME_V2_VERSION = 'agent_runtime_v2';
function nowIso() {
    return new Date().toISOString();
}
function readText(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function safeIdPart(value) {
    return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'task';
}
function unique(values) {
    return [...new Set(values)];
}
/**
 * Detects stale auth-failure narratives that an earlier turn may have persisted as
 * an assistant message. These are status templates the model emitted about itself
 * (e.g. "OWNER_AUTH_FAILED ... status: 401"), NOT ground truth. If they are loaded
 * back into memory the model treats its own past error text as a live fact and keeps
 * echoing a 401 even when the owner route is authenticating successfully. We strip
 * them so they can never poison subsequent context.
 */
function isStaleAuthFailureArtifact(body) {
    const text = body.toLowerCase();
    if (text.includes('owner_auth_failed') || text.includes('owner_route_auth_401')) {
        return true;
    }
    const mentionsAuth = text.includes('authentication failure') ||
        text.includes('authentication for') ||
        text.includes('owner authentication') ||
        text.includes('auth diagnostics') ||
        text.includes('refresh token') ||
        text.includes('re-authenticate');
    const mentions401 = text.includes('401') || text.includes('owner session was rejected');
    return mentionsAuth && mentions401;
}
export function buildIVXAgentRuntimeV2MemorySnapshot(input) {
    const recentMessages = input.recentMessages ?? [];
    const ownerMessages = recentMessages
        .filter((message) => readText(message.sender_role) === 'owner' || readText(message.sender_role) === 'user')
        .map((message) => readText(message.body))
        .filter(Boolean)
        .slice(-6);
    const assistantMessages = recentMessages
        .filter((message) => readText(message.sender_role) === 'assistant')
        .map((message) => readText(message.body))
        .filter(Boolean)
        .filter((body) => !isStaleAuthFailureArtifact(body))
        .slice(-6);
    return {
        enabled: true,
        persistence: input.persistence ?? 'backend_conversation_messages',
        conversationId: input.conversationId,
        loadedTurnCount: recentMessages.length,
        recentOwnerMessages: ownerMessages,
        recentAssistantMessages: assistantMessages,
        writePolicy: 'persist_turn_when_requested',
        crossConversationPolicy: 'load_recent_owner_room_context',
        state: recentMessages.length > 0 ? 'loaded' : 'empty',
    };
}
function buildToolChain(plannerDecision, completedToolNames, failedToolNames) {
    if (!plannerDecision.useTools && plannerDecision.toolHints.length === 0) {
        return [{
                id: 'tool-none',
                name: 'no_tool_required',
                mode: 'none',
                required: false,
                status: 'skipped',
                reason: 'Planner selected conversational reasoning without live tools.',
            }];
    }
    const toolNames = unique([...plannerDecision.toolHints, ...completedToolNames, ...failedToolNames]);
    return toolNames.map((name, index) => {
        const failed = failedToolNames.includes(name);
        const completed = completedToolNames.includes(name);
        return {
            id: `tool-${index + 1}-${safeIdPart(name)}`,
            name,
            mode: name.includes('write') || name.includes('migration') || name.includes('delete') ? 'owner_approval_required' : 'read_only',
            required: plannerDecision.useTools,
            status: failed ? 'failed' : completed ? 'completed' : 'planned',
            reason: failed
                ? 'Tool failed and must be exposed as real state.'
                : completed
                    ? 'Tool evidence is available for GPT synthesis.'
                    : 'Tool is planned only if the active request requires live evidence.',
        };
    });
}
function makeTask(input) {
    return {
        id: input.id,
        parentId: input.parentId,
        title: input.title,
        ownerGoal: input.ownerGoal,
        assignedAgent: input.agentId,
        status: input.status ?? 'ready',
        risk: input.risk,
        approvalRequired: input.approvalRequired,
        toolMode: input.toolMode,
        retryable: input.retryable,
        children: input.children ?? [],
    };
}
function flattenTaskTree(root) {
    return [root, ...root.children.flatMap((child) => flattenTaskTree(child))];
}
function buildTaskTree(input) {
    const approvalRequired = input.risk === 'high' || input.toolChain.some((step) => step.mode === 'owner_approval_required');
    const toolMode = input.plannerDecision.useTools ? 'read_only' : 'context_only';
    const root = makeTask({
        id: 'runtime-v2-root',
        parentId: null,
        title: 'Owner request orchestration',
        ownerGoal: input.prompt,
        agentId: 'cto_orchestrator',
        risk: input.risk,
        approvalRequired,
        toolMode,
        retryable: true,
        status: 'planning',
    });
    const childSpecs = [
        { title: 'Load persistent conversation memory', agentId: 'cto_orchestrator', toolMode: 'context_only', retryable: true },
        { title: 'Classify semantic intent and route safely', agentId: 'cto_orchestrator', toolMode: 'context_only', retryable: false },
    ];
    if (input.plannerDecision.requiresTaskDecomposition) {
        childSpecs.push({ title: 'Decompose into multi-step execution plan', agentId: input.assignedAgent, toolMode: 'context_only', retryable: true });
    }
    if (input.plannerDecision.useTools) {
        childSpecs.push({ title: 'Run only required read tools and collect evidence', agentId: input.assignedAgent, toolMode: 'read_only', retryable: true });
    }
    childSpecs.push({ title: 'Synthesize natural GPT-4o answer', agentId: input.assignedAgent, toolMode: 'context_only', retryable: true });
    if (input.plannerDecision.requiresLongResponse) {
        childSpecs.push({ title: 'Chunk long structured response without replacing it with a template', agentId: input.assignedAgent, toolMode: 'none', retryable: true });
    }
    childSpecs.push({ title: 'Expose true backend/tool state and persist turn when requested', agentId: 'cto_orchestrator', toolMode: 'context_only', retryable: true });
    root.children = childSpecs.map((spec, index) => makeTask({
        id: `runtime-v2-${index + 1}-${safeIdPart(spec.title)}`,
        parentId: root.id,
        title: spec.title,
        ownerGoal: input.prompt,
        agentId: spec.agentId,
        risk: input.risk,
        approvalRequired: approvalRequired && (spec.toolMode === 'owner_approval_required' || input.risk === 'high'),
        toolMode: spec.toolMode,
        retryable: spec.retryable,
    }));
    return { root, flat: flattenTaskTree(root) };
}
function estimateChunkCount(prompt, plannerDecision) {
    const explicitRange = prompt.match(/\b(?:1\s*(?:to|-)\s*|from\s+1\s+to\s+)(\d{2,4})\b/i);
    const requestedItems = explicitRange?.[1] ? Number.parseInt(explicitRange[1], 10) : plannerDecision.requiresLongResponse ? 80 : 20;
    if (!Number.isFinite(requestedItems) || requestedItems <= 0)
        return plannerDecision.requiresLongResponse ? 3 : 1;
    return Math.max(1, Math.ceil(requestedItems / 40));
}
export function buildIVXAgentRuntimeV2Envelope(input) {
    const plannerDecision = input.plannerDecision ?? buildIVXOwnerAIPlannerDecision(input.prompt);
    const assignedAgent = routeTaskToAgent(input.prompt);
    const risk = classifyTaskRisk(input.prompt);
    const completedToolNames = input.completedToolNames ?? [];
    const failedToolNames = input.failedToolNames ?? [];
    const toolChain = buildToolChain(plannerDecision, completedToolNames, failedToolNames);
    const taskTree = buildTaskTree({ prompt: input.prompt, plannerDecision, assignedAgent, risk, toolChain });
    const estimatedChunks = estimateChunkCount(input.prompt, plannerDecision);
    return {
        version: IVX_AGENT_RUNTIME_V2_VERSION,
        marker: IVX_AGENT_RUNTIME_V2_MARKER,
        requestId: input.requestId,
        conversationId: input.conversationId,
        generatedAt: nowIso(),
        backendState: {
            fallbackMasking: false,
            trueStateExposed: true,
            destructiveActionsRequireApproval: true,
        },
        memory: buildIVXAgentRuntimeV2MemorySnapshot({
            conversationId: input.conversationId,
            recentMessages: input.recentMessages,
            persistence: input.persistence,
        }),
        planner: {
            ...plannerDecision,
            orchestrator: 'cto_orchestrator',
            assignedAgent,
            risk,
        },
        taskTree,
        streaming: {
            supported: true,
            mode: 'chunked_response_contract',
            shouldChunk: plannerDecision.requiresLongResponse || estimatedChunks > 1,
            maxChunkCharacters: 6_000,
            estimatedChunks,
            reason: plannerDecision.requiresLongResponse
                ? 'The request asks for a long structured answer; preserve structure and chunk instead of failing.'
                : 'Normal answer length is expected to fit in one response.',
        },
        retryRecovery: {
            enabled: true,
            maxAttempts: 3,
            retryableFailures: ['gateway_timeout', 'rate_limited', 'tool_transient_error', 'network_unreachable'],
            visibleFailurePolicy: 'surface_backend_or_tool_error_never_canned_answer',
        },
        toolChain,
        multiAgent: {
            coordinator: 'cto_orchestrator',
            availableAgents: Object.values(AGENTS).map((agent) => ({
                id: agent.id,
                name: agent.name,
                role: agent.role,
                riskLimit: agent.riskLimit,
                allowedTools: agent.allowedTools,
            })),
            coordinationMode: 'single_owner_agent_with_specialist_routing',
        },
        businessReasoning: {
            enabled: true,
            mode: 'technical_product_business_context',
            instruction: 'Reason about implementation impact, owner risk, product value, and business tradeoffs before selecting tools.',
        },
        preExecutionFeasibilityGate: {
            enabled: true,
            marker: 'ivx-pre-execution-feasibility-gate-2026-07-05-v1',
            intent: classifyTaskIntent(input.prompt),
            requiredCapabilities: requiredCapabilitiesFor(classifyTaskIntent(input.prompt)),
            policy: 'block_first_then_execute_never_loop',
            blockerMemory: 'persistent_across_turns_until_owner_clears',
        },
    };
}
export function buildIVXAgentRuntimeV2StatusSnapshot() {
    const plannerDecision = buildIVXOwnerAIPlannerDecision('Explain current IVX app status');
    const envelope = buildIVXAgentRuntimeV2Envelope({
        requestId: 'status-probe',
        conversationId: 'status-probe',
        prompt: 'Explain current IVX app status',
        plannerDecision,
        recentMessages: [],
    });
    return {
        ...envelope,
        requestId: null,
        conversationId: null,
        memory: {
            enabled: true,
            persistence: 'backend_conversation_messages',
            state: 'status_probe',
            crossConversationPolicy: 'load_recent_owner_room_context',
        },
        taskTree: {
            supported: true,
            structure: 'root_with_children',
            statuses: ['pending', 'planning', 'ready', 'running', 'blocked', 'completed', 'failed'],
        },
    };
}
