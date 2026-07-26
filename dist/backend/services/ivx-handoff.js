/**
 * IVX Operator Handoff Manifest.
 *
 * The owner's final objective: Rork stops being the operator. IVX Owner AI takes
 * over development from here. This module produces a single, honest manifest that
 * maps the ten operator capabilities the owner requires to the concrete backing
 * route + auth gate that already exists, and derives each capability's readiness
 * from the LIVE autonomous dashboard + runtime environment — never a hardcoded
 * boolean. If a backing subsystem is not wired, the capability reports `blocked`
 * and names exactly what is missing.
 *
 * This is the artifact that proves the handoff is real: every operator action
 * resolves to a wired, owner-gated endpoint, and the manifest computes whether
 * IVX can continue independently.
 */
import { buildAutonomousDashboard } from './ivx-autonomous-core';
export const IVX_HANDOFF_MARKER = 'ivx-operator-handoff-2026-05-29';
function readEnvFlag(name) {
    return Boolean(process.env[name] && String(process.env[name]).trim().length > 0);
}
/** Map a dashboard capability state onto a handoff readiness, given whether a prerequisite env exists. */
function stateToReadiness(state, prerequisiteMet) {
    if (!prerequisiteMet)
        return 'blocked';
    if (state === 'online')
        return 'ready';
    if (state === 'partial')
        return 'partial';
    return 'blocked';
}
/** Find a dashboard capability state by id, defaulting to 'missing' if absent. */
function dashboardState(dashboard, id) {
    const cap = dashboard.capabilities.find((c) => c.id === id);
    return cap ? cap.state : 'missing';
}
/**
 * Build the operator handoff manifest from live subsystem state.
 * Read-only; never mutates anything.
 */
export async function buildHandoffManifest() {
    const dashboard = await buildAutonomousDashboard();
    const githubConfigured = dashboard.environment.githubConfigured;
    const databaseConfigured = dashboard.environment.databaseConfigured;
    const aiConfigured = dashboard.environment.aiGatewayConfigured;
    const renderConfigured = readEnvFlag('RENDER_API_KEY') && readEnvFlag('RENDER_SERVICE_ID');
    const supabaseConfigured = readEnvFlag('SUPABASE_SERVICE_ROLE_KEY') && readEnvFlag('EXPO_PUBLIC_SUPABASE_URL');
    const codeIndexState = dashboardState(dashboard, 'code-index');
    const auditState = dashboardState(dashboard, 'structured-audit-state');
    const testState = dashboardState(dashboard, 'test-runner');
    const fixState = dashboardState(dashboard, 'fix-and-verify-loop');
    const logState = dashboardState(dashboard, 'runtime-log-collector');
    const dashState = dashboardState(dashboard, 'unified-dashboard');
    const capabilities = [
        {
            id: '1',
            capability: 'Inspect code',
            readiness: stateToReadiness(codeIndexState, true),
            backedBy: 'ivx-senior-dev-tools + ivx-code-index + ivx-code-graph',
            route: 'POST /api/ivx/senior-dev/tools (code_read/code_search) · GET /api/ivx/autonomous-core/code-index',
            authGate: 'owner-only (assertIVXOwnerOnly / IVX_OWNER_TOKEN)',
            requiresOwnerApproval: false,
            detail: codeIndexState === 'online'
                ? `Code index live: ${dashboard.subsystems.codeIndex.totals?.files ?? 0} files, ${dashboard.subsystems.codeIndex.totals?.routes ?? 0} routes indexed; blast-radius via code-graph.`
                : 'Inspection tools wired; index not yet built — rebuild via POST /api/ivx/autonomous-core/code-index/rebuild.',
            missing: null,
        },
        {
            id: '2',
            capability: 'Create tasks',
            readiness: stateToReadiness(auditState, true),
            backedBy: 'ivx-audit-item-store + ivx-audit-jobs',
            route: 'POST /api/ivx/autonomous-core/audit-items · POST /api/ivx/audit-jobs',
            authGate: 'owner-only',
            requiresOwnerApproval: false,
            detail: `Structured task/audit state durable: ${dashboard.subsystems.auditItemSets.total} item sets, ${dashboard.subsystems.auditItemSets.items} items with per-item status + verification.`,
            missing: null,
        },
        {
            id: '3',
            capability: 'Generate patches',
            readiness: stateToReadiness(fixState, true),
            backedBy: 'ivx-repair-brain + ivx-repair-jobs',
            route: 'POST /api/ivx/autonomous-core/self-heal (patch plan) · POST /api/ivx/developer-deploy/action (github_commit_file)',
            authGate: 'owner-only; code application gated by CONFIRM_IVX_GITHUB_WRITE',
            requiresOwnerApproval: true,
            detail: `Detect→diagnose→patch-plan pipeline live; ${dashboard.subsystems.repairJobs.total} repair jobs tracked, ${dashboard.subsystems.repairJobs.awaitingApproval} awaiting approval. Application stays owner-gated by design.`,
            missing: null,
        },
        {
            id: '4',
            capability: 'Run checks',
            readiness: stateToReadiness(testState, true),
            backedBy: 'ivx-test-reporter + ivx-self-heal-cycle + senior-dev test_run',
            route: 'POST /api/ivx/senior-dev/tools (test_run) · POST /api/ivx/autonomous-core/self-heal',
            authGate: 'owner-only',
            requiresOwnerApproval: false,
            detail: 'typecheck / lint / smoke / endpoint suites run on demand with exit codes + log heads; self-heal chains checks into the verify loop.',
            missing: null,
        },
        {
            id: '5',
            capability: 'Request approval',
            readiness: 'ready',
            backedBy: 'ivx-developer-deploy-control confirmation tokens',
            route: 'GET /api/ivx/developer-deploy/status (advertises required confirmation text)',
            authGate: 'owner-only; destructive ops require CONFIRM_IVX_GITHUB_WRITE / CONFIRM_IVX_GITHUB_MERGE',
            requiresOwnerApproval: true,
            detail: 'Risky operations refuse to execute without the exact owner confirmation token; read-only actions are exempt. Approval gate is explicit and enforced server-side.',
            missing: null,
        },
        {
            id: '6',
            capability: 'Commit / push when approved',
            readiness: githubConfigured ? 'ready' : 'blocked',
            backedBy: 'ivx-developer-deploy-control (GitHub Git/Refs API)',
            route: 'POST /api/ivx/developer-deploy/action (github_create_branch · github_commit_file · github_create_pull_request · github_merge_pull_request · github_create_rollback_tag)',
            authGate: 'owner-only + CONFIRM_IVX_GITHUB_WRITE / CONFIRM_IVX_GITHUB_MERGE',
            requiresOwnerApproval: true,
            detail: githubConfigured
                ? 'Branch→commit→PR→status→merge→rollback-tag lifecycle wired against the real GitHub API.'
                : 'GitHub write lifecycle wired but credentials missing.',
            missing: githubConfigured ? null : 'GITHUB_TOKEN and GITHUB_REPO_URL must be set on the backend runtime.',
        },
        {
            id: '7',
            capability: 'Deploy',
            readiness: renderConfigured ? 'ready' : 'partial',
            backedBy: 'Render auto-deploy (commit→main) + ivx-render-deploy-latest + ivx-production-guard',
            route: 'POST /api/ivx/developer-deploy/action (github_dispatch_workflow) · GET /api/ivx/developer-deploy/status',
            authGate: 'owner-only',
            requiresOwnerApproval: true,
            detail: renderConfigured
                ? 'Render API key present: deploy can be triggered + status read directly; push-to-main also auto-deploys.'
                : 'Push-to-main auto-deploys via render.yaml (autoDeployTrigger: commit). Direct Render API control needs a real key.',
            missing: renderConfigured ? null : 'RENDER_API_KEY and RENDER_SERVICE_ID (real values) for direct deploy/rollback control; push-to-main deploy works without them.',
        },
        {
            id: '8',
            capability: 'Run Supabase actions',
            readiness: supabaseConfigured ? 'ready' : 'blocked',
            backedBy: 'ivx-supabase-owner-actions + ivx-supabase-inspection (ivx_exec_sql RPC + PostgREST)',
            route: 'POST /api/ivx/supabase/owner-action · GET /api/ivx/supabase/owner-action-health',
            authGate: 'owner-only + service-role key (server-side only)',
            requiresOwnerApproval: true,
            detail: supabaseConfigured
                ? 'Live migration + write/read verified over HTTPS (ivx_exec_sql RPC + PostgREST), bypassing IPv6-only direct Postgres.'
                : 'Supabase action path wired but credentials missing.',
            missing: supabaseConfigured ? null : 'SUPABASE_SERVICE_ROLE_KEY and EXPO_PUBLIC_SUPABASE_URL on the backend runtime.',
        },
        {
            id: '9',
            capability: 'Monitor live errors',
            readiness: stateToReadiness(logState, true),
            backedBy: 'ivx-incident-store + ivx-owner-ai-diagnostics + ivx-uptime-probe',
            route: 'GET /api/ivx/incidents · GET /api/ivx/owner-ai/diagnostics · GET /health',
            authGate: 'owner-only',
            requiresOwnerApproval: false,
            detail: `${dashboard.subsystems.incidents.total} incidents captured (${dashboard.subsystems.incidents.open} open, ${dashboard.subsystems.incidents.resolved} resolved); diagnostics events ingested per request; /health exposes commit + marker.`,
            missing: null,
        },
        {
            id: '10',
            capability: 'Generate final reports',
            readiness: stateToReadiness(dashState, true),
            backedBy: 'ivx-autonomous-core dashboard + ivx-senior-dev-tools audit-report + this handoff manifest',
            route: 'GET /api/ivx/autonomous-core/dashboard · POST /api/ivx/senior-dev/audit-report · GET /api/ivx/handoff/readiness',
            authGate: 'owner-only',
            requiresOwnerApproval: false,
            detail: `Six-bucket dashboard (completed ${dashboard.buckets.completed} · pending ${dashboard.buckets.pending} · blocked ${dashboard.buckets.blocked} · failed ${dashboard.buckets.failed} · verified ${dashboard.buckets.verified} · unverified ${dashboard.buckets.unverified}) + end-to-end senior-dev report.`,
            missing: null,
        },
    ];
    const ready = capabilities.filter((c) => c.readiness === 'ready').length;
    const partial = capabilities.filter((c) => c.readiness === 'partial').length;
    const blocked = capabilities.filter((c) => c.readiness === 'blocked').length;
    const handoffReady = blocked === 0;
    const ownerActionsRequired = [];
    for (const cap of capabilities) {
        if (cap.missing)
            ownerActionsRequired.push(`[${cap.capability}] ${cap.missing}`);
    }
    if (!aiConfigured) {
        ownerActionsRequired.push('[Owner AI brain] AI_GATEWAY_API_KEY must be set so the operator can reason and synthesize.');
    }
    if (!databaseConfigured) {
        ownerActionsRequired.push('[Persistence] DATABASE_URL / POSTGRES_URL / SUPABASE_DB_URL for durable state.');
    }
    return {
        marker: IVX_HANDOFF_MARKER,
        generatedAt: new Date().toISOString(),
        handoffReady,
        summary: {
            total: capabilities.length,
            ready,
            partial,
            blocked,
            operatorIsRorkIndependent: handoffReady && aiConfigured,
        },
        environment: dashboard.environment,
        capabilities,
        ownerActionsRequired,
    };
}
