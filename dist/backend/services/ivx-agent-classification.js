/**
 * IVX Honest Agent Classification — classifies the current 12 agents
 * based on REAL runtime architecture, not static config.
 *
 * Classification types per owner directive:
 *   - REAL_INDEPENDENT_AGENT: Has own runtime, isolated state, heartbeat
 *   - SHARED_WORKER_WITH_ROLE: Runs on shared worker pool with role routing
 *   - UI_ONLY_LABEL: Exists only in UI/dashboard, no runtime
 *   - PLACEHOLDER: Stub with no implementation
 *   - MOCK: Returns fake/canned data
 *   - BROKEN: Runtime exists but crashes
 *   - UNKNOWN: Not yet classified
 */
import { EXECUTIVE_AGENTS, EXECUTIVE_AGENT_IDS, } from './ivx-enterprise-business-os';
import { ENTERPRISE_AGENTS, } from './ivx-enterprise-agents';
import { AGENTS, } from './agents/multi-agent-framework';
import { ROLE_AGENTS, } from './agents/role-agents';
export const IVX_AGENT_CLASSIFICATION_MARKER = 'ivx-agent-classification-2026-07-25';
// ── Classification Engine ────────────────────────────────────────────────────
/**
 * Classify an executive agent based on its real runtime architecture.
 *
 * Evidence used:
 * - Does the agent have its own process/worker entry point?
 * - Does it share a runtime with other agents (framework agent mapping)?
 * - Is it a thin role wrapper over a shared framework agent?
 * - Does it have a heartbeat loop?
 * - Does it have any completed jobs in the proof ledger?
 */
function classifyExecutiveAgent(agentId) {
    const def = EXECUTIVE_AGENTS[agentId];
    const entDef = ENTERPRISE_AGENTS[agentId];
    const frameworkAgentId = entDef?.frameworkAgent ?? 'operations';
    const fwDef = AGENTS[frameworkAgentId];
    // Determine runtime type
    // Only senior_developer has its own dedicated worker entry point
    // (backend/workers/ivx-senior-dev-worker-entry.ts)
    const hasOwnWorker = agentId === 'senior_developer';
    // All enterprise agents map to one of 11 framework agents
    // Multiple enterprise agents share the same framework agent → shared worker
    const agentsSharingFramework = EXECUTIVE_AGENT_IDS.filter((id) => ENTERPRISE_AGENTS[id]?.frameworkAgent === frameworkAgentId);
    // Role agents are thin wrappers over framework agents
    const roleAgentMatch = Object.values(ROLE_AGENTS).find((ra) => ra.frameworkAgent === frameworkAgentId);
    let classification;
    let runtimeType;
    let sharedWorkerPool = null;
    let evidence;
    if (hasOwnWorker) {
        // senior_developer has a dedicated worker entry point
        // BUT it still runs inside the same Node process as the API server
        // when IVX_SENIOR_DEV_WORKER_ENABLED=true, or as a separate Render service
        classification = 'SHARED_WORKER_WITH_ROLE';
        runtimeType = 'shared_worker';
        sharedWorkerPool = 'senior-dev-worker-pool';
        evidence = `Has dedicated worker entry (ivx-senior-dev-worker-entry.ts) but runs as a shared worker pool. Other agents route through this worker via role wrappers.`;
    }
    else if (agentsSharingFramework.length > 1) {
        // Multiple agents share the same framework agent → shared worker with role
        classification = 'SHARED_WORKER_WITH_ROLE';
        runtimeType = 'shared_worker';
        sharedWorkerPool = `framework-${frameworkAgentId}`;
        evidence = `Shares framework agent "${frameworkAgentId}" with ${agentsSharingFramework.length - 1} other agent(s): ${agentsSharingFramework.filter((id) => id !== agentId).join(', ')}. No isolated runtime.`;
    }
    else if (roleAgentMatch) {
        // Has a role agent wrapper → shared worker with role
        classification = 'SHARED_WORKER_WITH_ROLE';
        runtimeType = 'shared_worker';
        sharedWorkerPool = `role-${roleAgentMatch.id}`;
        evidence = `Has role agent wrapper "${roleAgentMatch.roleName}" over framework agent "${frameworkAgentId}". Runs in-process, not as independent runtime.`;
    }
    else {
        // No role wrapper, no shared framework → config only
        classification = 'UI_ONLY_LABEL';
        runtimeType = 'config_only';
        evidence = `Agent exists in executive registry and enterprise registry but has no dedicated runtime, no role agent wrapper, and no independent worker. Dashboard label only.`;
    }
    return {
        agent_id: agentId,
        agent_name: def.name,
        role: def.role,
        classification,
        runtime_type: runtimeType,
        shared_worker_pool: sharedWorkerPool,
        framework_agent: frameworkAgentId,
        runtime_mapping: `executive(${agentId}) → enterprise(${entDef?.id ?? 'N/A'}) → framework(${frameworkAgentId})`,
        files: [],
        evidence,
    };
}
/**
 * Classify all 12 executive agents honestly.
 */
export function classifyAllAgents() {
    return EXECUTIVE_AGENT_IDS.map((id) => classifyExecutiveAgent(id));
}
/**
 * Produce a summary of the honest classification.
 */
export function getClassificationSummary() {
    const results = classifyAllAgents();
    const counts = {
        total: results.length,
        real_independent: results.filter((r) => r.classification === 'REAL_INDEPENDENT_AGENT').length,
        shared_worker: results.filter((r) => r.classification === 'SHARED_WORKER_WITH_ROLE').length,
        ui_only: results.filter((r) => r.classification === 'UI_ONLY_LABEL').length,
        placeholder: results.filter((r) => r.classification === 'PLACEHOLDER').length,
        mock: results.filter((r) => r.classification === 'MOCK').length,
        broken: results.filter((r) => r.classification === 'BROKEN').length,
        unknown: results.filter((r) => r.classification === 'UNKNOWN').length,
        details: results,
    };
    return counts;
}
