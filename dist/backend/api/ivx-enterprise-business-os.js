/**
 * IVX Enterprise Business OS API — Phase 1 (Executive Command Center).
 *
 *   GET  /api/ivx/enterprise-os/health              → public module registry (no data, no secrets)
 *   GET  /api/ivx/enterprise-os/command-center      → live executive dashboard (owner-only)
 *   GET  /api/ivx/enterprise-os/agents              → 12 executive agents + last-run state (owner-only)
 *   POST /api/ivx/enterprise-os/agents/:agentId/run → execute one agent's real engine now (owner-only)
 *   GET  /api/ivx/enterprise-os/audit               → audited run ledger (owner-only)
 *
 * Every agent run calls a REAL engine and returns verifiable evidence
 * (SEC filing URLs, commit SHAs, report ids). Nothing is fabricated.
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { EXECUTIVE_AGENTS, EXECUTIVE_AGENT_IDS, IVX_ENTERPRISE_OS_MARKER, buildExecutiveCommandCenter, getEnterpriseOsState, isExecutiveAgentId, listEnterpriseOsRuns, runExecutiveAgent, } from '../services/ivx-enterprise-business-os';
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
        }
        return null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message, marker: IVX_ENTERPRISE_OS_MARKER }, status);
    }
}
/**
 * Public, unauthenticated module registry — deliberately contains NO business
 * data and NO secrets. Exists so the live deployment of this module is
 * externally verifiable (route present = module deployed).
 */
export function handleEnterpriseOsHealth() {
    return ownerOnlyJson({
        ok: true,
        marker: IVX_ENTERPRISE_OS_MARKER,
        module: 'enterprise-business-os',
        phase: 1,
        agents: EXECUTIVE_AGENT_IDS.map((id) => ({
            id,
            name: EXECUTIVE_AGENTS[id].name,
            engine: EXECUTIVE_AGENTS[id].engine,
        })),
        routes: [
            'GET /api/ivx/enterprise-os/health',
            'GET /api/ivx/enterprise-os/command-center',
            'GET /api/ivx/enterprise-os/agents',
            'POST /api/ivx/enterprise-os/agents/:agentId/run',
            'GET /api/ivx/enterprise-os/audit',
        ],
        timestamp: new Date().toISOString(),
    });
}
export async function handleEnterpriseOsCommandCenter(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    try {
        const commandCenter = await buildExecutiveCommandCenter();
        return ownerOnlyJson({ ok: true, commandCenter });
    }
    catch (error) {
        return ownerOnlyJson({
            ok: false,
            error: error instanceof Error ? error.message : 'Command center build failed.',
            marker: IVX_ENTERPRISE_OS_MARKER,
        }, 500);
    }
}
export async function handleEnterpriseOsAgents(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    try {
        const state = await getEnterpriseOsState();
        return ownerOnlyJson({
            ok: true,
            marker: IVX_ENTERPRISE_OS_MARKER,
            agents: EXECUTIVE_AGENT_IDS.map((id) => ({
                ...EXECUTIVE_AGENTS[id],
                state: state.agents[id],
            })),
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Agent listing failed.' }, 500);
    }
}
export async function handleEnterpriseOsRunAgent(request, agentIdRaw) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const agentId = (agentIdRaw ?? '').trim();
    if (!isExecutiveAgentId(agentId)) {
        return ownerOnlyJson({
            ok: false,
            error: `Unknown agent '${agentId.slice(0, 40)}'. Valid: ${EXECUTIVE_AGENT_IDS.join(', ')}.`,
            marker: IVX_ENTERPRISE_OS_MARKER,
        }, 400);
    }
    const run = await runExecutiveAgent(agentId, 'owner');
    return ownerOnlyJson({ ok: run.ok, run, agent: EXECUTIVE_AGENTS[agentId], marker: IVX_ENTERPRISE_OS_MARKER }, run.ok ? 200 : 502);
}
export async function handleEnterpriseOsAudit(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    try {
        const url = new URL(request.url);
        const limit = Number.parseInt(url.searchParams.get('limit') ?? '50', 10) || 50;
        const runs = await listEnterpriseOsRuns(limit);
        return ownerOnlyJson({
            ok: true,
            marker: IVX_ENTERPRISE_OS_MARKER,
            total: runs.length,
            runs,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
        return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'Audit listing failed.' }, 500);
    }
}
