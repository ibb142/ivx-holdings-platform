/**
 * IVX Deployment Tools — Unified API Routes
 *
 * Public endpoints (no auth needed for status):
 *   GET  /api/ivx/deploy-tools/brain         — full deployment brain assessment
 *   GET  /api/ivx/deploy-tools/brain/health  — quick health check
 *   GET  /api/ivx/deploy-tools/github        — GitHub tool status
 *   GET  /api/ivx/deploy-tools/render        — Render tool status
 *   GET  /api/ivx/deploy-tools/supabase      — Supabase tool status
 *   GET  /api/ivx/deploy-tools/evidence      — production evidence
 *   GET  /api/ivx/deploy-tools/credentials   — credential sync status
 *   GET  /api/ivx/deploy-tools/dashboard     — unified dashboard (all in one)
 *
 * Owner-only endpoints (require auth):
 *   POST /api/ivx/deploy-tools/render/deploy — trigger Render deploy
 *   POST /api/ivx/deploy-tools/render/rollback — rollback Render deploy
 *   POST /api/ivx/deploy-tools/render/auto-deploy — toggle auto-deploy
 */
import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import * as GitHubTool from '../services/ivx-deployment-tools/github-tool';
import * as RenderTool from '../services/ivx-deployment-tools/render-tool';
import * as SupabaseTool from '../services/ivx-deployment-tools/supabase-tool';
import * as ProductionEvidence from '../services/ivx-deployment-tools/production-evidence';
import * as CredentialSync from '../services/ivx-deployment-tools/credential-sync';
import { assessDeploymentBrain, quickHealthCheck } from '../services/ivx-deployment-tools/deployment-brain';
// ─── CORS Helpers ──────────────────────────────────────────────────────
const PUBLIC_HEADERS = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
};
function publicJson(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: PUBLIC_HEADERS });
}
// ─── OPTIONS ────────────────────────────────────────────────────────────
export function OPTIONS() {
    return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
}
// ─── BRAIN ──────────────────────────────────────────────────────────────
export async function handleBrain() {
    try {
        const brain = await assessDeploymentBrain();
        return publicJson({ ok: true, brain });
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
export async function handleBrainHealth() {
    try {
        const health = await quickHealthCheck();
        return publicJson({ ok: true, health });
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
// ─── GITHUB TOOL ────────────────────────────────────────────────────────
export async function handleGitHubStatus() {
    try {
        const [fullStatus, branches, commit, perms] = await Promise.all([
            GitHubTool.getFullGitHubStatus(),
            GitHubTool.getBranches(),
            GitHubTool.getLatestCommit(),
            GitHubTool.verifyPermissions(),
        ]);
        return publicJson({
            ok: fullStatus.ok,
            error: fullStatus.error,
            branches: branches.branches ?? [],
            commit: commit.commit ?? null,
            permissions: perms.permissions ?? null,
        });
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
// ─── RENDER TOOL ────────────────────────────────────────────────────────
export async function handleRenderStatus() {
    try {
        const fullStatus = await RenderTool.getFullRenderStatus();
        return publicJson({
            ok: fullStatus.ok,
            error: fullStatus.error,
            service: fullStatus.service ?? null,
            deploys: fullStatus.deploys ?? [],
            envVarsCount: fullStatus.envVars?.length ?? 0,
            autoDeploy: fullStatus.autoDeployEnabled ?? null,
        });
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
export async function handleRenderDeploy(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, 401);
    }
    try {
        let clearCache = false;
        if (request.method === 'POST') {
            const body = await request.json().catch(() => ({}));
            clearCache = body.clearCache === true;
        }
        const result = await RenderTool.triggerDeploy(clearCache);
        return ownerOnlyJson({
            ok: result.ok,
            error: result.error,
            deploy: result.deploy ?? null,
        });
    }
    catch (err) {
        return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
export async function handleRenderRollback(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, 401);
    }
    try {
        const body = await request.json().catch(() => ({}));
        const deployId = body.deployId;
        if (!deployId) {
            return ownerOnlyJson({ ok: false, error: 'deployId is required' }, 400);
        }
        const result = await RenderTool.rollbackDeploy(deployId);
        return ownerOnlyJson({
            ok: result.ok,
            error: result.error,
            deploy: result.deploy ?? null,
        });
    }
    catch (err) {
        return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
export async function handleRenderAutoDeploy(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch (err) {
        return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, 401);
    }
    try {
        const body = await request.json().catch(() => ({}));
        const enabled = body.enabled !== false;
        const result = await RenderTool.setAutoDeploy(enabled);
        return ownerOnlyJson({
            ok: result.ok,
            error: result.error,
            autoDeployEnabled: result.autoDeployEnabled ?? null,
        });
    }
    catch (err) {
        return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
// ─── SUPABASE TOOL ──────────────────────────────────────────────────────
export async function handleSupabaseStatus() {
    try {
        const [connections, tables, auth, rw, critical] = await Promise.all([
            SupabaseTool.testConnections(),
            SupabaseTool.listTables(),
            SupabaseTool.checkAuth(),
            SupabaseTool.testReadWrite(),
            SupabaseTool.checkCriticalTables(),
        ]);
        return publicJson({
            ok: connections.ok,
            error: [connections.error, tables.error, auth.error, rw.error, critical.error].filter(Boolean).join('; ') || null,
            connections: connections.connections ?? [],
            tablesCount: tables.tables?.length ?? 0,
            auth: auth.auth ?? null,
            readTest: rw.readTest ?? null,
            writeTest: rw.writeTest ?? null,
            criticalTables: critical.specificTables ?? {},
        });
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
// ─── PRODUCTION EVIDENCE ────────────────────────────────────────────────
export async function handleEvidence() {
    try {
        const evidence = await ProductionEvidence.generateFullEvidence();
        return publicJson({
            ok: true,
            evidence,
        });
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
// ─── CREDENTIALS ────────────────────────────────────────────────────────
export async function handleCredentials() {
    try {
        const creds = await CredentialSync.discoverAllCredentials();
        return publicJson({
            ok: creds.ok,
            credentials: creds.credentials.map(c => ({
                name: c.name,
                category: c.category,
                required: c.required,
                validation: c.validation,
                validationDetail: c.validationDetail,
                sources: c.sources.map(s => ({ source: s.source, present: s.present })),
                tested: c.tested,
            })),
            summary: creds.summary,
            gaps: creds.gaps,
            recommendations: creds.recommendations,
        });
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
// ─── UNIFIED TOOLS INVOKE (independent + autonomous) ──────────────────
/**
 * POST /api/ivx/deploy-tools/invoke
 *
 * Unified endpoint that lets IVX call ANY deployment tool independently.
 * Body: { tool: "github"|"render"|"supabase"|"evidence"|"credentials"|"brain"|"deploy", action?: string, params?: {} }
 *
 * This is the single entry point for both manual (owner-triggered) and
 * autonomous (IVX self-triggered) deployment operations.
 */
export async function handleInvoke(request) {
    let body;
    try {
        body = await request.json().catch(() => ({}));
    }
    catch {
        return publicJson({ ok: false, error: 'Invalid JSON body. Send { tool, action?, params? }' }, 400);
    }
    const tool = typeof body.tool === 'string' ? body.tool.trim().toLowerCase() : '';
    const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : 'status';
    const params = (body.params && typeof body.params === 'object' ? body.params : {});
    if (!tool) {
        return publicJson({ ok: false, error: 'tool is required. Available: github, render, supabase, evidence, credentials, brain, deploy, sync' }, 400);
    }
    try {
        switch (tool) {
            case 'github': {
                if (action === 'status' || action === 'full') {
                    const result = await GitHubTool.getFullGitHubStatus();
                    return publicJson({ ok: true, tool: 'github', action, result });
                }
                if (action === 'commit') {
                    const result = await GitHubTool.getLatestCommit(typeof params.branch === 'string' ? params.branch : undefined);
                    return publicJson({ ok: true, tool: 'github', action, result });
                }
                if (action === 'branches') {
                    const result = await GitHubTool.getBranches();
                    return publicJson({ ok: true, tool: 'github', action, result });
                }
                if (action === 'permissions') {
                    const result = await GitHubTool.verifyPermissions();
                    return publicJson({ ok: true, tool: 'github', action, result });
                }
                if (action === 'workflows') {
                    const result = await GitHubTool.getWorkflowRuns(typeof params.limit === 'number' ? params.limit : 10);
                    return publicJson({ ok: true, tool: 'github', action, result });
                }
                if (action === 'secrets') {
                    const result = await GitHubTool.getSecrets();
                    return publicJson({ ok: true, tool: 'github', action, result });
                }
                return publicJson({ ok: false, error: `Unknown action '${action}' for github. Try: status, commit, branches, permissions, workflows, secrets` }, 400);
            }
            case 'render': {
                if (action === 'status' || action === 'full') {
                    const result = await RenderTool.getFullRenderStatus();
                    return publicJson({ ok: true, tool: 'render', action, result });
                }
                if (action === 'deploy') {
                    const result = await RenderTool.triggerDeploy(params.clearCache === true);
                    return publicJson({ ok: true, tool: 'render', action, result });
                }
                if (action === 'deploys') {
                    const result = await RenderTool.listDeploys(typeof params.limit === 'number' ? params.limit : 5);
                    return publicJson({ ok: true, tool: 'render', action, result });
                }
                if (action === 'rollback') {
                    const deployId = typeof params.deployId === 'string' ? params.deployId : '';
                    if (!deployId)
                        return publicJson({ ok: false, error: 'deployId param required for rollback' }, 400);
                    const result = await RenderTool.rollbackDeploy(deployId);
                    return publicJson({ ok: true, tool: 'render', action, result });
                }
                if (action === 'auto-deploy') {
                    const result = await RenderTool.setAutoDeploy(params.enabled !== false);
                    return publicJson({ ok: true, tool: 'render', action, result });
                }
                if (action === 'service') {
                    const result = await RenderTool.getService();
                    return publicJson({ ok: true, tool: 'render', action, result });
                }
                return publicJson({ ok: false, error: `Unknown action '${action}' for render. Try: status, deploy, deploys, rollback, auto-deploy, service` }, 400);
            }
            case 'supabase': {
                if (action === 'status' || action === 'full') {
                    const [connections, tables, auth, rw, critical] = await Promise.all([
                        SupabaseTool.testConnections(),
                        SupabaseTool.listTables(),
                        SupabaseTool.checkAuth(),
                        SupabaseTool.testReadWrite(),
                        SupabaseTool.checkCriticalTables(),
                    ]);
                    return publicJson({ ok: true, tool: 'supabase', action, result: { connections, tables, auth, rw, critical } });
                }
                if (action === 'connection') {
                    const result = await SupabaseTool.testConnections();
                    return publicJson({ ok: true, tool: 'supabase', action, result });
                }
                if (action === 'tables') {
                    const result = await SupabaseTool.listTables();
                    return publicJson({ ok: true, tool: 'supabase', action, result });
                }
                if (action === 'rw') {
                    const result = await SupabaseTool.testReadWrite();
                    return publicJson({ ok: true, tool: 'supabase', action, result });
                }
                return publicJson({ ok: false, error: `Unknown action '${action}' for supabase. Try: status, connection, tables, rw` }, 400);
            }
            case 'evidence': {
                const evidence = await ProductionEvidence.generateFullEvidence();
                return publicJson({ ok: true, tool: 'evidence', action, evidence });
            }
            case 'credentials': {
                const creds = await CredentialSync.discoverAllCredentials();
                return publicJson({ ok: true, tool: 'credentials', action, creds });
            }
            case 'brain': {
                const brainData = await assessDeploymentBrain();
                return publicJson({ ok: true, tool: 'brain', action, brainData });
            }
            case 'deploy': {
                // Full deployment cycle: assess → trigger if drift → wait → verify
                if (action === 'cycle' || action === 'full') {
                    const { runDeploymentCycle } = await import('../services/ivx-enterprise-deployment-engine');
                    const result = await runDeploymentCycle();
                    return publicJson({ ok: true, tool: 'deploy', action, result });
                }
                if (action === 'trigger') {
                    const { triggerRenderDeploy } = await import('../services/ivx-enterprise-deployment-engine');
                    const result = await triggerRenderDeploy(params.clearCache === true);
                    return publicJson({ ok: true, tool: 'deploy', action, result });
                }
                if (action === 'verify') {
                    const { verifyCommitMatch, getGitHubHeadSha, getProductionHealth } = await import('../services/ivx-enterprise-deployment-engine');
                    const [match, github, prod] = await Promise.all([verifyCommitMatch(), getGitHubHeadSha(), getProductionHealth()]);
                    return publicJson({ ok: true, tool: 'deploy', action, result: { match, github, production: prod } });
                }
                return publicJson({ ok: false, error: `Unknown action '${action}' for deploy. Try: cycle, trigger, verify` }, 400);
            }
            case 'sync': {
                // Full autonomous sync: brain → drift check → deploy if needed → evidence
                const [brainData, evidence] = await Promise.all([
                    assessDeploymentBrain(),
                    ProductionEvidence.generateFullEvidence(),
                ]);
                let deployResult = null;
                if (!brainData.commitMatch && brainData.decision === 'deploy_now' && brainData.autoRepairAvailable) {
                    const { triggerRenderDeploy } = await import('../services/ivx-enterprise-deployment-engine');
                    const trigger = await triggerRenderDeploy(false);
                    deployResult = trigger.ok && trigger.deploy
                        ? { ok: true, deploy: { id: trigger.deploy.id, status: trigger.deploy.status }, error: null }
                        : { ok: false, deploy: null, error: trigger.error };
                }
                return publicJson({
                    ok: true,
                    tool: 'sync',
                    action,
                    brainStatus: brainData.overallStatus,
                    decision: brainData.decision,
                    commitMatch: brainData.commitMatch,
                    commits: brainData.commits,
                    deployTriggered: deployResult !== null,
                    deployResult,
                    evidence: evidence.endpoints.map(e => ({ name: e.name, ok: e.ok, status: e.status })),
                    nextAction: brainData.nextAction,
                    timestamp: new Date().toISOString(),
                });
            }
            default:
                return publicJson({
                    ok: false,
                    error: `Unknown tool '${tool}'. Available: github, render, supabase, evidence, credentials, brain, deploy, sync`,
                }, 400);
        }
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
// ─── UNIFIED DASHBOARD ──────────────────────────────────────────────────
export async function handleDashboard() {
    try {
        const [brain, evidence, credentials] = await Promise.all([
            assessDeploymentBrain(),
            ProductionEvidence.generateFullEvidence(),
            CredentialSync.discoverAllCredentials(),
        ]);
        return publicJson({
            ok: true,
            brain,
            evidence: {
                endpoints: evidence.endpoints.map(e => ({
                    name: e.name,
                    ok: e.ok,
                    status: e.status,
                    latencyMs: e.latencyMs,
                    error: e.error,
                })),
                commitMatch: evidence.commitMatch,
                commits: evidence.commits,
                allEndpointsOk: evidence.allEndpointsOk,
                healthStatus: evidence.healthStatus,
            },
            credentials: {
                summary: credentials.summary,
                gaps: credentials.gaps,
                recommendations: credentials.recommendations,
            },
            timestamp: new Date().toISOString(),
        });
    }
    catch (err) {
        return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
    }
}
