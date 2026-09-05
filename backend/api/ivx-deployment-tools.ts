/**
 * IVX Deployment Tools — Unified API Routes
 *
 * Public endpoints are read-only status/evidence surfaces.
 * Every mutating deployment action is owner-only. Automatic deployment authority
 * belongs to the GitHub Production Deploy Governor; this module must never create
 * a recursive Render redeploy loop from a public/autonomous status call.
 */
import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import * as GitHubTool from '../services/ivx-deployment-tools/github-tool';
import * as RenderTool from '../services/ivx-deployment-tools/render-tool';
import * as SupabaseTool from '../services/ivx-deployment-tools/supabase-tool';
import * as ProductionEvidence from '../services/ivx-deployment-tools/production-evidence';
import * as CredentialSync from '../services/ivx-deployment-tools/credential-sync';
import { assessDeploymentBrain, quickHealthCheck } from '../services/ivx-deployment-tools/deployment-brain';

const PUBLIC_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
} as const;

function publicJson(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: PUBLIC_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
}

export async function handleBrain(): Promise<Response> {
  try {
    const brain = await assessDeploymentBrain();
    return publicJson({ ok: true, brain });
  } catch (err) {
    return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleBrainHealth(): Promise<Response> {
  try {
    const health = await quickHealthCheck();
    return publicJson({ ok: true, health });
  } catch (err) {
    return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleGitHubStatus(): Promise<Response> {
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
  } catch (err) {
    return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleRenderStatus(): Promise<Response> {
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
  } catch (err) {
    return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleRenderDeploy(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, 401);
  }
  try {
    const body = request.method === 'POST'
      ? await request.json().catch(() => ({})) as { clearCache?: boolean }
      : {};
    const result = await RenderTool.triggerDeploy(body.clearCache === true);
    return ownerOnlyJson({ ok: result.ok, error: result.error, deploy: result.deploy ?? null });
  } catch (err) {
    return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleRenderRollback(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, 401);
  }
  try {
    const body = await request.json().catch(() => ({})) as { deployId?: string };
    if (!body.deployId) return ownerOnlyJson({ ok: false, error: 'deployId is required' }, 400);
    const result = await RenderTool.rollbackDeploy(body.deployId);
    return ownerOnlyJson({ ok: result.ok, error: result.error, deploy: result.deploy ?? null });
  } catch (err) {
    return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleRenderAutoDeploy(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, 401);
  }
  try {
    const body = await request.json().catch(() => ({})) as { enabled?: boolean };
    const result = await RenderTool.setAutoDeploy(body.enabled !== false);
    return ownerOnlyJson({ ok: result.ok, error: result.error, autoDeployEnabled: result.autoDeployEnabled ?? null });
  } catch (err) {
    return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleSupabaseStatus(): Promise<Response> {
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
  } catch (err) {
    return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleEvidence(): Promise<Response> {
  try {
    const evidence = await ProductionEvidence.generateFullEvidence();
    return publicJson({ ok: true, evidence });
  } catch (err) {
    return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleCredentials(): Promise<Response> {
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
  } catch (err) {
    return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

/**
 * Unified tool invocation is owner-only because it includes credential metadata
 * and historically exposed Render deploy/rollback/auto-deploy actions. Public
 * callers must use the dedicated read-only GET status surfaces above.
 */
export async function handleInvoke(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : 'unauthorized' }, 401);
  }

  const body = await request.json().catch(() => ({})) as { tool?: unknown; action?: unknown; params?: unknown };
  const tool = typeof body.tool === 'string' ? body.tool.trim().toLowerCase() : '';
  const action = typeof body.action === 'string' ? body.action.trim().toLowerCase() : 'status';
  const params = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>;

  if (!tool) {
    return ownerOnlyJson({ ok: false, error: 'tool is required. Available: github, render, supabase, evidence, credentials, brain, deploy, sync' }, 400);
  }

  try {
    switch (tool) {
      case 'github': {
        if (action === 'status' || action === 'full') {
          const result = await GitHubTool.getFullGitHubStatus();
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        if (action === 'commit') {
          const result = await GitHubTool.getLatestCommit(typeof params.branch === 'string' ? params.branch : undefined);
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        if (action === 'branches') {
          const result = await GitHubTool.getBranches();
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        if (action === 'permissions') {
          const result = await GitHubTool.verifyPermissions();
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        if (action === 'workflows') {
          const result = await GitHubTool.getWorkflowRuns(typeof params.limit === 'number' ? params.limit : 10);
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        if (action === 'secrets') {
          const result = await GitHubTool.getSecrets();
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        return ownerOnlyJson({ ok: false, error: `Unknown action '${action}' for github` }, 400);
      }

      case 'render': {
        if (action === 'status' || action === 'full') {
          const result = await RenderTool.getFullRenderStatus();
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        if (action === 'deploys') {
          const result = await RenderTool.listDeploys(typeof params.limit === 'number' ? params.limit : 5);
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        if (action === 'service') {
          const result = await RenderTool.getService();
          return ownerOnlyJson({ ok: true, tool, action, result });
        }
        if (action === 'deploy') {
          const result = await RenderTool.triggerDeploy(params.clearCache === true);
          return ownerOnlyJson({ ok: result.ok, tool, action, result });
        }
        if (action === 'rollback') {
          const deployId = typeof params.deployId === 'string' ? params.deployId : '';
          if (!deployId) return ownerOnlyJson({ ok: false, error: 'deployId param required for rollback' }, 400);
          const result = await RenderTool.rollbackDeploy(deployId);
          return ownerOnlyJson({ ok: result.ok, tool, action, result });
        }
        if (action === 'auto-deploy') {
          const result = await RenderTool.setAutoDeploy(params.enabled !== false);
          return ownerOnlyJson({ ok: result.ok, tool, action, result });
        }
        return ownerOnlyJson({ ok: false, error: `Unknown action '${action}' for render` }, 400);
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
          return ownerOnlyJson({ ok: true, tool, action, result: { connections, tables, auth, rw, critical } });
        }
        if (action === 'connection') return ownerOnlyJson({ ok: true, tool, action, result: await SupabaseTool.testConnections() });
        if (action === 'tables') return ownerOnlyJson({ ok: true, tool, action, result: await SupabaseTool.listTables() });
        if (action === 'rw') return ownerOnlyJson({ ok: true, tool, action, result: await SupabaseTool.testReadWrite() });
        return ownerOnlyJson({ ok: false, error: `Unknown action '${action}' for supabase` }, 400);
      }

      case 'evidence':
        return ownerOnlyJson({ ok: true, tool, action, evidence: await ProductionEvidence.generateFullEvidence() });

      case 'credentials':
        return ownerOnlyJson({ ok: true, tool, action, creds: await CredentialSync.discoverAllCredentials() });

      case 'brain':
        return ownerOnlyJson({ ok: true, tool, action, brainData: await assessDeploymentBrain() });

      case 'deploy': {
        if (action === 'verify' || action === 'status') {
          const { verifyCommitMatch, getGitHubHeadSha, getProductionHealth } = await import('../services/ivx-enterprise-deployment-engine');
          const [match, github, prod] = await Promise.all([verifyCommitMatch(), getGitHubHeadSha(), getProductionHealth()]);
          return ownerOnlyJson({ ok: true, tool, action, result: { match, github, production: prod } });
        }
        if (action === 'trigger') {
          const { triggerRenderDeploy } = await import('../services/ivx-enterprise-deployment-engine');
          const result = await triggerRenderDeploy(params.clearCache === true);
          return ownerOnlyJson({ ok: result.ok, tool, action, result });
        }
        if (action === 'cycle' || action === 'full') {
          return ownerOnlyJson({
            ok: false,
            deployTriggered: false,
            error: 'Automatic backend deployment cycle disabled. IVX Production Deploy Governor is the single automatic deployment authority.',
          }, 409);
        }
        return ownerOnlyJson({ ok: false, error: `Unknown action '${action}' for deploy` }, 400);
      }

      case 'sync': {
        // Read-only synchronization assessment. Never self-trigger a Render deploy.
        const [brainData, evidence] = await Promise.all([
          assessDeploymentBrain(),
          ProductionEvidence.generateFullEvidence(),
        ]);
        return ownerOnlyJson({
          ok: true,
          tool,
          action,
          brainStatus: brainData.overallStatus,
          decision: brainData.decision,
          commitMatch: brainData.commitMatch,
          commits: brainData.commits,
          deployTriggered: false,
          deployResult: null,
          evidence: evidence.endpoints.map(e => ({ name: e.name, ok: e.ok, status: e.status })),
          nextAction: brainData.nextAction,
          timestamp: new Date().toISOString(),
        });
      }

      default:
        return ownerOnlyJson({ ok: false, error: `Unknown tool '${tool}'. Available: github, render, supabase, evidence, credentials, brain, deploy, sync` }, 400);
    }
  } catch (err) {
    return ownerOnlyJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}

export async function handleDashboard(): Promise<Response> {
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
  } catch (err) {
    return publicJson({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
}
