/**
 * IVX Deployment Brain
 *
 * Central decision engine that ties together all deployment tools:
 *   - Determines what is stale (commit drift)
 *   - Decides what needs to deploy
 *   - Identifies what failed
 *   - Determines what can self-repair
 *   - Decides when rollback is needed
 *   - Decides when owner approval is required
 *   - Produces a unified dashboard state
 */
import * as GitHubTool from './github-tool';
import * as RenderTool from './render-tool';
import * as SupabaseTool from './supabase-tool';
import * as ProductionEvidence from './production-evidence';
import * as CredentialSync from './credential-sync';
// ─── Brain Logic ──────────────────────────────────────────────────────
export async function assessDeploymentBrain() {
    const errors = [];
    const blockers = [];
    const platforms = [];
    // ─── 1. Check Credentials ──────────────────────────────────────────
    const credResult = await CredentialSync.discoverAllCredentials();
    const credentialStatus = {
        total: credResult.summary.total,
        valid: credResult.summary.valid,
        missing: credResult.summary.missing,
        failed: credResult.summary.failed,
    };
    const hasMinimumCredentials = credResult.summary.valid >= 4; // Need at least GITHUB_TOKEN, RENDER_API_KEY, RENDER_SERVICE_ID, SUPABASE_URL
    if (!hasMinimumCredentials) {
        errors.push(...credResult.gaps);
        blockers.push('Minimum deployment credentials not available');
    }
    // ─── 2. Check GitHub ───────────────────────────────────────────────
    const github = await GitHubTool.getFullGitHubStatus();
    platforms.push({
        platform: 'github',
        ok: github.ok,
        configured: github.ok,
        error: github.error,
        details: {
            commit: github.commit?.shortSha ?? null,
            branchCount: github.branches?.length ?? 0,
            canPush: github.permissions?.canPush ?? false,
        },
    });
    if (!github.ok && github.error) {
        errors.push(`GitHub: ${github.error}`);
    }
    // ─── 3. Check Render ───────────────────────────────────────────────
    const render = await RenderTool.getFullRenderStatus();
    const renderDeploys = render.deploys ?? [];
    platforms.push({
        platform: 'render',
        ok: render.ok,
        configured: render.service !== undefined,
        error: render.error,
        details: {
            serviceName: render.service?.name ?? null,
            latestDeployId: renderDeploys[0]?.id ?? null,
            latestDeployStatus: renderDeploys[0]?.status ?? null,
            deployCount: renderDeploys.length,
            autoDeploy: render.autoDeployEnabled ?? false,
        },
    });
    if (!render.ok && render.error) {
        errors.push(`Render: ${render.error}`);
    }
    // ─── 4. Check Supabase ─────────────────────────────────────────────
    const supabase = await SupabaseTool.testConnections();
    platforms.push({
        platform: 'supabase',
        ok: supabase.ok,
        configured: supabase.connections?.some(c => c.ok) ?? false,
        error: supabase.error,
        details: {
            connections: supabase.connections?.map(c => ({
                type: c.type,
                ok: c.ok,
            })) ?? [],
        },
    });
    if (!supabase.ok && supabase.error) {
        errors.push(`Supabase: ${supabase.error}`);
    }
    // ─── 6. Production Evidence ────────────────────────────────────────
    const evidence = await ProductionEvidence.generateFullEvidence();
    const productionSha = evidence.commits.find(c => c.source === 'Production')?.shortSha ?? null;
    const githubSha = evidence.commits.find(c => c.source === 'GitHub HEAD')?.shortSha ?? null;
    const renderSha = evidence.commits.find(c => c.source === 'Render Deploy')?.shortSha ?? null;
    // ─── 7. Brain Decision ─────────────────────────────────────────────
    const commitMatch = evidence.commitMatch;
    const deployInProgress = renderDeploys.some(d => d.status === 'triggered' || d.status === 'building' || d.status === 'pre_deploy');
    let overallStatus = 'unverified';
    let decision = 'waiting';
    let nextAction = 'Verify credentials and run a full deployment cycle';
    let autoRepairAvailable = false;
    let ownerApprovalRequired = false;
    // Check for broken state
    if (!hasMinimumCredentials) {
        overallStatus = 'broken';
        decision = 'credential_issue';
        nextAction = 'Configure required deployment credentials (GITHUB_TOKEN, RENDER_API_KEY, RENDER_SERVICE_ID)';
        ownerApprovalRequired = true;
    }
    else if (errors.length > 0 && blockers.length > 0) {
        overallStatus = 'broken';
        decision = 'blocked';
        nextAction = `Resolve blockers: ${blockers.join('; ')}`;
        ownerApprovalRequired = true;
    }
    else if (deployInProgress) {
        overallStatus = 'degraded';
        decision = 'waiting';
        nextAction = 'Deploy in progress — monitoring';
    }
    else if (!commitMatch && githubSha && productionSha) {
        const ghShort = githubSha;
        const prodShort = productionSha;
        overallStatus = 'stale';
        decision = 'deploy_now';
        nextAction = `Production (${prodShort}) is behind GitHub (${ghShort}). Trigger deploy.`;
        autoRepairAvailable = true;
    }
    else if (evidence.allEndpointsOk && commitMatch) {
        overallStatus = 'healthy';
        decision = 'healthy';
        nextAction = 'All systems operational. No action needed.';
    }
    else if (errors.length > 0) {
        overallStatus = 'degraded';
        decision = 'waiting';
        nextAction = `${errors.length} errors detected. Review and resolve.`;
    }
    // Calculate commits behind
    let commitsBehind = null;
    if (evidence.endpoints.some(e => e.name === 'API Health' && e.ok)) {
        commitsBehind = commitMatch ? 0 : null; // Can't calculate exact without full commit history
    }
    return {
        timestamp: new Date().toISOString(),
        overallStatus,
        decision,
        commitMatch,
        commitsBehind,
        commits: {
            github: githubSha,
            render: renderSha,
            production: productionSha,
        },
        platforms,
        deployInProgress,
        latestDeploy: {
            id: renderDeploys[0]?.id ?? null,
            status: renderDeploys[0]?.status ?? null,
            duration: renderDeploys[0]?.duration ?? null,
        },
        credentials: credentialStatus,
        errors,
        blockers,
        nextAction,
        autoRepairAvailable,
        ownerApprovalRequired,
    };
}
// ─── Quick Health Check ───────────────────────────────────────────────
export async function quickHealthCheck() {
    const errors = [];
    const [prodHealth, githubHead] = await Promise.all([
        ProductionEvidence.compareCommits().catch(() => ({ commits: [], match: false })),
        GitHubTool.getLatestCommit().catch(() => ({ ok: false, error: 'GitHub unreachable' })),
    ]);
    let renderReachable = false;
    try {
        const renderKey = (process.env.RENDER_API_KEY ?? '').trim();
        if (renderKey) {
            const res = await fetch('https://api.render.com/v1/owners', {
                headers: { Authorization: `Bearer ${renderKey}` },
                signal: AbortSignal.timeout(10000),
            });
            renderReachable = res.ok;
        }
    }
    catch {
        // ignore
    }
    if (!prodHealth.match)
        errors.push('Commit mismatch between GitHub and production');
    if (!githubHead.ok)
        errors.push('GitHub unreachable');
    return {
        ok: errors.length === 0,
        commitMatch: prodHealth.match,
        productionAlive: prodHealth.commits.some(c => c.source === 'Production' && c.shortSha !== null),
        githubReachable: githubHead.ok,
        renderReachable,
        errors,
    };
}
