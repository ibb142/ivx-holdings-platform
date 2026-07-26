/**
 * IVX Enterprise Orchestrator API Routes — owner-only.
 *
 * Routes for the central enterprise governance layer:
 *   - /api/ivx/enterprise/state          — full orchestrator state
 *   - /api/ivx/enterprise/kpis           — executive KPIs
 *   - /api/ivx/enterprise/agents         — agent registry & status
 *   - /api/ivx/enterprise/dispatch       — dispatch work to enterprise agent
 *   - /api/ivx/enterprise/research       — global AI research
 *   - /api/ivx/enterprise/opportunities  — business opportunities
 *   - /api/ivx/enterprise/improvement    — self-improvement tasks
 *   - /api/ivx/enterprise/memory         — enterprise memory
 *   - /api/ivx/enterprise/governance     — governance actions
 *   - /api/ivx/enterprise/reports        — executive reports
 *   - /api/ivx/enterprise/cycle          — run orchestrator cycle
 *   - /api/ivx/enterprise/validate       — validate all subsystems
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getOrchestratorState, getExecutiveKPIs, runOrchestratorCycle, updateSubsystemHealth, validateEnterpriseOrchestrator, } from '../services/ivx-enterprise-orchestrator';
import { ENTERPRISE_AGENT_IDS, getEnterpriseAgent, getEnterpriseAgentSummary, dispatchEnterpriseTask, completeEnterpriseTask, failEnterpriseTask, validateEnterpriseAgents, } from '../services/ivx-enterprise-agents';
import { getResearchState, getLatestReport as getLatestResearchReport, listReports as listResearchReports, } from '../services/ivx-global-research';
import { getOpportunityState, getTopOpportunities, getOpportunitiesByType, updateOpportunityStatus, } from '../services/ivx-business-opportunity-engine';
import { getSelfImprovementState, getOpenTasks, createImprovementTask, resolveImprovementTask, } from '../services/ivx-self-improvement';
import { searchMemory, getMemoryState, getRecentMemories, writeMemory, } from '../services/ivx-enterprise-memory';
import { getGovernanceState, getRecentAudit, requestAction, approveAction, blockAction, } from '../services/ivx-governance';
import { getExecutiveReportsState, getLatestExecutiveReport, listExecutiveReports, generateExecutiveReport, } from '../services/ivx-executive-reports';
export const ENTERPRISE_ORCHESTRATOR_MARKER = 'ivx-enterprise-orchestrator-api-2026-07-01';
// ── GET /api/ivx/enterprise/state ─────────────────────────────────────────
export async function handleEnterpriseStateGet(req) {
    assertIVXOwnerOnly(req);
    const state = await getOrchestratorState();
    return ownerOnlyJson(state);
}
// ── GET /api/ivx/enterprise/kpis ──────────────────────────────────────────
export async function handleEnterpriseKPIsGet(req) {
    assertIVXOwnerOnly(req);
    const kpis = await getExecutiveKPIs();
    return ownerOnlyJson(kpis);
}
// ── POST /api/ivx/enterprise/cycle ────────────────────────────────────────
export async function handleEnterpriseCyclePost(req) {
    assertIVXOwnerOnly(req);
    const result = await runOrchestratorCycle();
    return ownerOnlyJson(result);
}
// ── POST /api/ivx/enterprise/dispatch ─────────────────────────────────────
export async function handleEnterpriseDispatchPost(req) {
    assertIVXOwnerOnly(req);
    const body = await req.json();
    if (!body.agentId || !body.goal) {
        return ownerOnlyJson({ error: 'agentId and goal required' }, 400);
    }
    if (!ENTERPRISE_AGENT_IDS.includes(body.agentId)) {
        return ownerOnlyJson({ error: `Unknown agent: ${body.agentId}` }, 400);
    }
    const result = await dispatchEnterpriseTask(body.agentId, body.goal, body.priority);
    return ownerOnlyJson(result);
}
// ── POST /api/ivx/enterprise/dispatch/:taskId/complete ────────────────────
export async function handleEnterpriseTaskCompletePost(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const taskId = url.pathname.split('/').pop();
    const body = await req.json().catch(() => ({}));
    if (!taskId)
        return ownerOnlyJson({ error: 'taskId required' }, 400);
    await completeEnterpriseTask(taskId, body.frameworkTaskId ?? null);
    return ownerOnlyJson({ taskId, status: 'completed' });
}
// ── POST /api/ivx/enterprise/dispatch/:taskId/fail ────────────────────────
export async function handleEnterpriseTaskFailPost(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const taskId = url.pathname.split('/').pop();
    const body = await req.json().catch(() => ({}));
    if (!taskId)
        return ownerOnlyJson({ error: 'taskId required' }, 400);
    await failEnterpriseTask(taskId, body.frameworkTaskId ?? null, body.error ?? 'Unknown error');
    return ownerOnlyJson({ taskId, status: 'failed' });
}
// ── GET /api/ivx/enterprise/agents ────────────────────────────────────────
export async function handleEnterpriseAgentsGet(req) {
    assertIVXOwnerOnly(req);
    const summary = getEnterpriseAgentSummary();
    return ownerOnlyJson({ agents: summary });
}
// ── GET /api/ivx/enterprise/agents/:agentId ───────────────────────────────
export async function handleEnterpriseAgentGet(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const agentId = url.pathname.split('/').pop();
    try {
        const agent = getEnterpriseAgent(agentId);
        return ownerOnlyJson(agent);
    }
    catch {
        return ownerOnlyJson({ error: `Unknown agent: ${agentId}` }, 404);
    }
}
// ── GET /api/ivx/enterprise/research ──────────────────────────────────────
export async function handleEnterpriseResearchGet(req) {
    assertIVXOwnerOnly(req);
    const state = await getResearchState();
    const latestReport = await getLatestResearchReport();
    return ownerOnlyJson({ state, latestReport });
}
// ── GET /api/ivx/enterprise/research/reports ──────────────────────────────
export async function handleEnterpriseResearchReportsGet(req) {
    assertIVXOwnerOnly(req);
    const reports = await listResearchReports(20);
    return ownerOnlyJson({ reports });
}
// ── GET /api/ivx/enterprise/opportunities ─────────────────────────────────
export async function handleEnterpriseOpportunitiesGet(req) {
    assertIVXOwnerOnly(req);
    const state = await getOpportunityState();
    const topOpps = await getTopOpportunities(10);
    return ownerOnlyJson({ state, topOpportunities: topOpps });
}
// ── GET /api/ivx/enterprise/opportunities/:type ───────────────────────────
export async function handleEnterpriseOpportunitiesByTypeGet(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const type = url.pathname.split('/').pop();
    const opportunities = await getOpportunitiesByType(type);
    return ownerOnlyJson({ type, opportunities });
}
// ── POST /api/ivx/enterprise/opportunities/:id/status ─────────────────────
export async function handleEnterpriseOpportunityStatusPost(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const parts = url.pathname.split('/');
    const opportunityId = parts[parts.length - 2];
    const body = await req.json();
    if (!opportunityId || !body.status) {
        return ownerOnlyJson({ error: 'opportunityId and status required' }, 400);
    }
    const result = await updateOpportunityStatus(opportunityId, body.status, body.notes);
    return ownerOnlyJson(result ?? { error: 'Not found' }, result ? 200 : 404);
}
// ── GET /api/ivx/enterprise/improvement ───────────────────────────────────
export async function handleEnterpriseImprovementGet(req) {
    assertIVXOwnerOnly(req);
    const state = await getSelfImprovementState();
    const openTasks = await getOpenTasks();
    return ownerOnlyJson({ state, openTasks });
}
// ── POST /api/ivx/enterprise/improvement ──────────────────────────────────
export async function handleEnterpriseImprovementPost(req) {
    assertIVXOwnerOnly(req);
    const body = await req.json();
    if (!body.category || !body.title) {
        return ownerOnlyJson({ error: 'category and title required' }, 400);
    }
    const task = await createImprovementTask(body.category, body.title, body.description, body.severity, body.evidence, false);
    return ownerOnlyJson(task);
}
// ── POST /api/ivx/enterprise/improvement/:id/resolve ──────────────────────
export async function handleEnterpriseImprovementResolvePost(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const taskId = url.pathname.split('/').pop();
    const body = await req.json();
    if (!taskId || !body.resolution) {
        return ownerOnlyJson({ error: 'taskId and resolution required' }, 400);
    }
    const task = await resolveImprovementTask(taskId, body.resolution);
    return ownerOnlyJson(task ?? { error: 'Not found' }, task ? 200 : 404);
}
// ── GET /api/ivx/enterprise/memory ────────────────────────────────────────
export async function handleEnterpriseMemoryGet(req) {
    assertIVXOwnerOnly(req);
    const state = await getMemoryState();
    const recent = await getRecentMemories(20);
    return ownerOnlyJson({ state, recent });
}
// ── GET /api/ivx/enterprise/memory/search?q= ──────────────────────────────
export async function handleEnterpriseMemorySearchGet(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const q = url.searchParams.get('q') ?? '';
    const category = url.searchParams.get('category');
    if (!q)
        return ownerOnlyJson({ error: 'q parameter required' }, 400);
    const results = await searchMemory(q, { category: category ?? undefined, limit: 20 });
    return ownerOnlyJson({ results });
}
// ── POST /api/ivx/enterprise/memory ───────────────────────────────────────
export async function handleEnterpriseMemoryPost(req) {
    assertIVXOwnerOnly(req);
    const body = await req.json();
    if (!body.category || !body.title || !body.content) {
        return ownerOnlyJson({ error: 'category, title, content required' }, 400);
    }
    const entry = await writeMemory(body.category, body.title, body.content, body.source, {
        importance: body.importance,
        tags: body.tags,
    });
    return ownerOnlyJson(entry);
}
// ── GET /api/ivx/enterprise/governance ────────────────────────────────────
export async function handleEnterpriseGovernanceGet(req) {
    assertIVXOwnerOnly(req);
    const state = await getGovernanceState();
    const recentAudit = await getRecentAudit(20);
    return ownerOnlyJson({ state, recentAudit });
}
// ── POST /api/ivx/enterprise/governance/action ────────────────────────────
export async function handleEnterpriseGovernanceActionPost(req) {
    assertIVXOwnerOnly(req);
    const body = await req.json();
    if (!body.type || !body.description || !body.requestedBy) {
        return ownerOnlyJson({ error: 'type, description, requestedBy required' }, 400);
    }
    const action = await requestAction(body.type, body.description, body.requestedBy, body.evidence, body.rollbackPlan);
    return ownerOnlyJson(action);
}
// ── POST /api/ivx/enterprise/governance/action/:id/approve ────────────────
export async function handleEnterpriseGovernanceApprovePost(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const actionId = url.pathname.split('/').pop();
    const body = await req.json().catch(() => ({}));
    if (!actionId)
        return ownerOnlyJson({ error: 'actionId required' }, 400);
    const action = await approveAction(actionId, body.approvedBy ?? 'owner');
    return ownerOnlyJson(action ?? { error: 'Not found' }, action ? 200 : 404);
}
// ── POST /api/ivx/enterprise/governance/action/:id/block ──────────────────
export async function handleEnterpriseGovernanceBlockPost(req) {
    assertIVXOwnerOnly(req);
    const url = new URL(req.url);
    const actionId = url.pathname.split('/').pop();
    const body = await req.json();
    if (!actionId || !body.reason) {
        return ownerOnlyJson({ error: 'actionId and reason required' }, 400);
    }
    const action = await blockAction(actionId, body.blockedBy ?? 'owner', body.reason);
    return ownerOnlyJson(action ?? { error: 'Not found' }, action ? 200 : 404);
}
// ── GET /api/ivx/enterprise/reports ───────────────────────────────────────
export async function handleEnterpriseReportsGet(req) {
    assertIVXOwnerOnly(req);
    const state = await getExecutiveReportsState();
    const latest = await getLatestExecutiveReport();
    return ownerOnlyJson({ state, latest });
}
// ── POST /api/ivx/enterprise/reports/generate ─────────────────────────────
export async function handleEnterpriseReportsGeneratePost(req) {
    assertIVXOwnerOnly(req);
    const report = await generateExecutiveReport();
    return ownerOnlyJson(report);
}
// ── GET /api/ivx/enterprise/reports/list ──────────────────────────────────
export async function handleEnterpriseReportsListGet(req) {
    assertIVXOwnerOnly(req);
    const reports = await listExecutiveReports(30);
    return ownerOnlyJson({ reports });
}
// ── GET /api/ivx/enterprise/validate ──────────────────────────────────────
export async function handleEnterpriseValidateGet(req) {
    assertIVXOwnerOnly(req);
    const orchValidation = await validateEnterpriseOrchestrator();
    const agentValidation = validateEnterpriseAgents();
    return ownerOnlyJson({
        orchestrator: orchValidation,
        agents: agentValidation,
        allValid: orchValidation.valid && agentValidation.valid,
    });
}
// ── Health check for subsystems ───────────────────────────────────────────
export async function handleEnterpriseHealthPost(req) {
    assertIVXOwnerOnly(req);
    const body = await req.json();
    if (!body.subsystem || !body.health) {
        return ownerOnlyJson({ error: 'subsystem and health required' }, 400);
    }
    const sub = await updateSubsystemHealth(body.subsystem, body.health, body.metrics);
    return ownerOnlyJson(sub);
}
// ── OPTIONS handler ───────────────────────────────────────────────────────
export function enterpriseOrchestratorOptions() {
    return ownerOnlyOptions();
}
