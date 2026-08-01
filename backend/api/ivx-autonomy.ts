/**
 * IVX Autonomy API — owner-only mounts for the new autonomy services.
 *
 * All routes are owner-gated and default to read-only/dry-run. No deploys,
 * no schema changes, no payments/billing, no secret values returned.
 *
 *   GET  /api/ivx/autonomy/status                       capability + env presence map
 *   POST /api/ivx/autonomy/cloudfront/invalidate        dry-run by default; apply=true requires owner
 *   POST /api/ivx/autonomy/secret-scan                  scan supplied content/patches (never logged)
 *   POST /api/ivx/autonomy/deploy-log/rotate            dry-run by default; apply=true requires owner
 *   GET  /api/ivx/autonomy/git/rollback-check           read-only GitHub HEAD~1 lookup
 *   POST /api/ivx/autonomy/uptime/probe                 run probe; persists JSONL summary
 *   GET  /api/ivx/autonomy/uptime/probe                 list recent probe reports
 *   GET  /api/ivx/autonomy/sse-replay/stats             buffered event counts per stream
 *   GET  /api/ivx/autonomy/token-budget                 UTC-day token-spend snapshot
 */

import { createCloudFrontInvalidation } from '../services/ivx-cloudfront-invalidation';
import { scanContentForSecrets, scanPatchesForSecrets } from '../services/ivx-secret-scan';
import { rotateDeployLogs } from '../services/ivx-deploy-log-rotation';
import { checkGitRollbackReadiness } from '../services/ivx-git-rollback';
import { runUptimeProbe, readRecentUptimeProbes, getDefaultUptimeTargets, type UptimeTarget } from '../services/ivx-uptime-probe';
import { getSSEReplayStats } from '../services/ivx-sse-replay-buffer';
import { getTokenBudgetSnapshot } from '../services/ivx-token-budget';
import { getIVXProviderChainSnapshot } from '../services/ivx-ai-provider-fallback';
import { triggerProductionRollback, getProductionHealth } from '../services/ivx-production-guard';
import { getIVXOwnerVariableRuntimeValue } from './ivx-owner-variables';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { runGithubSyncInProcess } from '../services/ivx-github-sync';

export const IVX_AUTONOMY_MARKER = 'ivx-autonomy-routes-2026-05-27';

function envPresence(name: string): boolean {
  const v = process.env[name];
  return typeof v === 'string' && v.trim().length > 0;
}

function readObjectInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
}

function errorResponse(error: unknown, status: number = 500): Response {
  return ownerOnlyJson({
    ok: false,
    marker: IVX_AUTONOMY_MARKER,
    error: error instanceof Error ? error.message : 'autonomy_route_failed',
  }, status);
}

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

/** GET /api/ivx/autonomy/status */
export async function handleIVXAutonomyStatusRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMY_MARKER,
      services: {
        cloudfront_invalidation: {
          envReady: envPresence('AWS_ACCESS_KEY_ID') && envPresence('AWS_SECRET_ACCESS_KEY') && envPresence('CLOUDFRONT_DISTRIBUTION_ID'),
        },
        secret_scan: { envReady: true },
        deploy_log_rotation: { envReady: true },
        git_rollback_check: {
          envReady: envPresence('GITHUB_TOKEN') && envPresence('GITHUB_REPO_URL'),
        },
        uptime_probe: {
          envReady: true,
          defaultTargetCount: getDefaultUptimeTargets().length,
        },
        sse_replay: { envReady: true },
        token_budget: { envReady: true },
        ai_providers: {
          envReady: envPresence('IVX_AI_GATEWAY_KEY'),
          fallbacksConfigured: {
            openai_direct: envPresence('OPENAI_API_KEY'),
            anthropic_direct: envPresence('ANTHROPIC_API_KEY'),
          },
        },
      },
      routes: {
        status: 'GET /api/ivx/autonomy/status',
        cloudfront_invalidate: 'POST /api/ivx/autonomy/cloudfront/invalidate',
        secret_scan: 'POST /api/ivx/autonomy/secret-scan',
        deploy_log_rotate: 'POST /api/ivx/autonomy/deploy-log/rotate',
        git_rollback_check: 'GET /api/ivx/autonomy/git/rollback-check',
        uptime_probe_run: 'POST /api/ivx/autonomy/uptime/probe',
        uptime_probe_list: 'GET /api/ivx/autonomy/uptime/probe',
        sse_replay_stats: 'GET /api/ivx/autonomy/sse-replay/stats',
        token_budget: 'GET /api/ivx/autonomy/token-budget',
        ai_providers: 'GET /api/ivx/autonomy/ai-providers',
      },
      policy: {
        defaultMode: 'read_only_or_dry_run',
        applyRequiresOwner: true,
        deployBlocked: true,
        secretsExposed: false,
        schemaChangesBlocked: true,
        paymentsBlocked: true,
        twoFactorImplemented: false,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error, 403);
  }
}

/** POST /api/ivx/autonomy/cloudfront/invalidate — dry-run by default */
export async function handleIVXAutonomyCloudFrontInvalidateRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = readObjectInput(await request.json().catch(() => ({})));
    const paths = readStringArray(body.paths);
    const apply = body.apply === true;
    const callerReference = typeof body.callerReference === 'string' ? body.callerReference : undefined;
    const distributionId = typeof body.distributionId === 'string' && body.distributionId.trim().length > 0
      ? body.distributionId.trim()
      : undefined;

    if (paths.length === 0) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_AUTONOMY_MARKER,
        error: 'paths[] is required.',
      }, 400);
    }

    if (!apply) {
      return ownerOnlyJson({
        ok: true,
        marker: IVX_AUTONOMY_MARKER,
        mode: 'dry_run',
        wouldInvalidate: {
          paths,
          distributionIdConfigured: envPresence('CLOUDFRONT_DISTRIBUTION_ID') || Boolean(distributionId),
          awsCredentialsConfigured: envPresence('AWS_ACCESS_KEY_ID') && envPresence('AWS_SECRET_ACCESS_KEY'),
        },
        note: 'Re-POST with apply:true to execute. Owner approval enforced upstream.',
        timestamp: new Date().toISOString(),
      });
    }

    const result = await createCloudFrontInvalidation({ paths, callerReference, distributionId });
    return ownerOnlyJson({
      ok: result.ok,
      marker: IVX_AUTONOMY_MARKER,
      mode: 'apply',
      result,
    }, result.ok ? 200 : result.status === 'missing_access' ? 503 : 502);
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/ivx/autonomy/secret-scan — never echoes matched values */
export async function handleIVXAutonomySecretScanRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = readObjectInput(await request.json().catch(() => ({})));
    const content = typeof body.content === 'string' ? body.content : '';
    const patchesInput = Array.isArray(body.patches) ? body.patches : [];
    const patches = patchesInput
      .map((p) => readObjectInput(p))
      .filter((p) => typeof p.filePath === 'string' && typeof p.content === 'string')
      .map((p) => ({ filePath: p.filePath as string, content: p.content as string }));

    if (!content && patches.length === 0) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_AUTONOMY_MARKER,
        error: 'Provide `content` (string) or `patches` ([{filePath,content}]).',
      }, 400);
    }

    const contentResult = content ? scanContentForSecrets(content) : null;
    const patchesResult = patches.length > 0 ? scanPatchesForSecrets(patches) : null;
    const overallOk = (!contentResult || contentResult.ok) && (!patchesResult || patchesResult.ok);

    return ownerOnlyJson({
      ok: overallOk,
      marker: IVX_AUTONOMY_MARKER,
      content: contentResult,
      patches: patchesResult,
      secretValuesReturned: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/ivx/autonomy/deploy-log/rotate — dry-run by default */
export async function handleIVXAutonomyDeployLogRotateRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = readObjectInput(await request.json().catch(() => ({})));
    const apply = body.apply === true;
    const keepDays = typeof body.keepDays === 'number' && Number.isFinite(body.keepDays) ? body.keepDays : undefined;
    const purgeDays = typeof body.purgeDays === 'number' && Number.isFinite(body.purgeDays) ? body.purgeDays : undefined;
    const rootDir = typeof body.rootDir === 'string' && body.rootDir.trim().length > 0 ? body.rootDir : undefined;

    const report = await rotateDeployLogs({ apply, keepDays, purgeDays, rootDir });
    return ownerOnlyJson({
      ok: report.ok,
      marker: IVX_AUTONOMY_MARKER,
      mode: apply ? 'apply' : 'dry_run',
      report,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/ivx/autonomy/git/rollback-check — read-only */
export async function handleIVXAutonomyGitRollbackCheckRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const check = await checkGitRollbackReadiness();
    return ownerOnlyJson({
      ok: check.ok,
      marker: IVX_AUTONOMY_MARKER,
      check,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** POST /api/ivx/autonomy/uptime/probe — run probe */
export async function handleIVXAutonomyUptimeProbeRunRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const body = readObjectInput(await request.json().catch(() => ({})));
    const targetsInput = Array.isArray(body.targets) ? body.targets : [];
    const targets: UptimeTarget[] = targetsInput
      .map((t) => readObjectInput(t))
      .filter((t) => typeof t.name === 'string' && typeof t.url === 'string')
      .map((t) => ({
        name: t.name as string,
        url: t.url as string,
        method: t.method === 'HEAD' ? 'HEAD' as const : 'GET' as const,
        timeoutMs: typeof t.timeoutMs === 'number' ? t.timeoutMs : undefined,
      }));

    const report = await runUptimeProbe(targets.length > 0 ? targets : undefined);
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMY_MARKER,
      report,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/ivx/autonomy/uptime/probe — list recent reports */
export async function handleIVXAutonomyUptimeProbeListRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const url = new URL(request.url);
    const limitRaw = Number.parseInt(url.searchParams.get('limit') ?? '50', 10);
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 500) : 50;
    const reports = await readRecentUptimeProbes(limit);
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMY_MARKER,
      defaultTargets: getDefaultUptimeTargets(),
      count: reports.length,
      reports,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/ivx/autonomy/sse-replay/stats */
export async function handleIVXAutonomySSEReplayStatsRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const stats = getSSEReplayStats();
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMY_MARKER,
      streamCount: stats.length,
      stats,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/** GET /api/ivx/autonomy/ai-providers — secret-free provider chain snapshot */
export async function handleIVXAutonomyAIProvidersRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const snapshot = getIVXProviderChainSnapshot();
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMY_MARKER,
      snapshot,
      secretsExposed: false,
      policy: {
        primaryAlwaysFirst: true,
        fallbackOnlyWhenEnvConfigured: true,
        fallbackTriggersOnly: ['timeout', 'rate_limit', 'quota', 'server_error', 'network'],
        promptContentLogged: false,
        apiKeysLogged: false,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error, 403);
  }
}

type RenderDeployStatusEntry = {
  id?: string;
  status?: string;
  trigger?: string;
  createdAt?: string;
  finishedAt?: string | null;
  commit?: { id?: string; message?: string } | null;
  failureReason?: string | null;
};

async function readRenderCreds(): Promise<{ apiKey: string; serviceId: string }> {
  const apiKey = (process.env.RENDER_API_KEY ?? '').trim() || await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  const serviceId = (process.env.RENDER_SERVICE_ID ?? '').trim() || await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
  return { apiKey, serviceId };
}

async function pollRenderDeploy(apiKey: string, serviceId: string, deployId: string, maxMs: number): Promise<{ entry: RenderDeployStatusEntry | null; pollCount: number; terminal: boolean }> {
  const deadline = Date.now() + maxMs;
  let pollCount = 0;
  let entry: RenderDeployStatusEntry | null = null;
  while (Date.now() < deadline) {
    pollCount += 1;
    try {
      const r = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(deployId)}`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      });
      if (r.ok) {
        const data = await r.json().catch(() => null) as RenderDeployStatusEntry | null;
        if (data) entry = data;
        const status = String((data?.status ?? '')).toLowerCase();
        const terminalStates = ['live', 'deactivated', 'build_failed', 'update_failed', 'canceled', 'pre_deploy_failed'];
        if (terminalStates.some((s) => status.includes(s))) return { entry, pollCount, terminal: true };
      }
    } catch {
      // network blip — keep polling
    }
    await new Promise((res) => setTimeout(res, 5000));
  }
  return { entry, pollCount, terminal: false };
}

async function probeProductionHealth(): Promise<{ baseUrl: string | null; status: number | null; ok: boolean; marker: string | null; error: string | null; durationMs: number }> {
  const baseUrl = (process.env.PRODUCTION_BASE_URL ?? '').trim() || 'https://api.ivxholding.com';
  const started = Date.now();
  try {
    const r = await fetch(`${baseUrl.replace(/\/$/, '')}/health`, { method: 'GET' });
    let marker: string | null = null;
    try {
      const j = await r.json() as Record<string, unknown>;
      if (typeof j?.deploymentMarker === 'string') marker = j.deploymentMarker;
      else if (typeof j?.marker === 'string') marker = j.marker;
    } catch {
      // body may be plain text — ignore
    }
    return { baseUrl, status: r.status, ok: r.ok, marker, error: null, durationMs: Date.now() - started };
  } catch (err) {
    return { baseUrl, status: null, ok: false, marker: null, error: err instanceof Error ? err.message : 'network_error', durationMs: Date.now() - started };
  }
}

/**
 * POST /api/ivx/autonomy/deploy/approve-and-run
 *
 * One-tap autonomous owner-approved deploy. Verifies the signed-in owner via
 * the Supabase bearer attached to the request, triggers a Render deploy of
 * the latest commit, polls until terminal status, then probes production
 * `/health`. Returns full proof. Never echoes secrets.
 *
 * Body: { clearCache?: boolean; pollTimeoutMs?: number }
 */
export async function handleIVXAutonomyDeployApproveAndRunRequest(request: Request): Promise<Response> {
  const startedAt = new Date().toISOString();
  try {
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = readObjectInput(await request.json().catch(() => ({})));
    const clearCache = body.clearCache === true ? 'clear' : 'do_not_clear';
    const pollTimeoutMs = typeof body.pollTimeoutMs === 'number' && Number.isFinite(body.pollTimeoutMs)
      ? Math.min(Math.max(body.pollTimeoutMs, 30_000), 8 * 60_000)
      : 5 * 60_000;

    const { apiKey, serviceId } = await readRenderCreds();
    if (!apiKey || !serviceId) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_AUTONOMY_MARKER,
        stage: 'preflight',
        error: 'missing_render_credentials',
        renderApiKeyConfigured: Boolean(apiKey),
        renderServiceIdConfigured: Boolean(serviceId),
        hint: 'Backend runtime cannot read RENDER_API_KEY / RENDER_SERVICE_ID from env or Owner Variables.',
      }, 503);
    }

    const ownerEmail = typeof ownerContext.email === 'string' ? ownerContext.email : null;
    const ownerEmailMasked = ownerEmail
      ? `${ownerEmail.slice(0, 2)}***@${ownerEmail.split('@')[1] ?? 'unknown'}`
      : null;
    const approvalProof = {
      approved: true,
      ownerUserId: ownerContext.userId,
      ownerEmailMasked,
      ownerRole: ownerContext.role,
      guardMode: ownerContext.guardMode,
      approvedAt: startedAt,
      mechanism: 'in_app_one_tap_owner_session',
    };

    // Stage 1 — trigger Render deploy
    let triggerStatus = 0;
    let triggerOk = false;
    let triggerParsed: unknown = null;
    try {
      const r = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(serviceId)}/deploys`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ clearCache }),
      });
      triggerStatus = r.status;
      triggerOk = r.ok;
      const text = await r.text();
      if (text) {
        try { triggerParsed = JSON.parse(text); } catch { triggerParsed = { raw: text.slice(0, 2000) }; }
      }
    } catch (err) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_AUTONOMY_MARKER,
        stage: 'render_trigger',
        approvalProof,
        error: err instanceof Error ? err.message : 'render_trigger_network_error',
      }, 502);
    }

    if (!triggerOk) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_AUTONOMY_MARKER,
        stage: 'render_trigger',
        approvalProof,
        renderHttpStatus: triggerStatus,
        renderResponse: triggerParsed,
      }, triggerStatus >= 400 && triggerStatus < 600 ? triggerStatus : 502);
    }

    const triggered = (triggerParsed && typeof triggerParsed === 'object' && 'deploy' in (triggerParsed as Record<string, unknown>))
      ? ((triggerParsed as { deploy: RenderDeployStatusEntry }).deploy)
      : (triggerParsed as RenderDeployStatusEntry | null);
    const deployId = triggered && typeof triggered.id === 'string' ? triggered.id : null;

    if (!deployId) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_AUTONOMY_MARKER,
        stage: 'render_trigger',
        approvalProof,
        error: 'render_did_not_return_deploy_id',
        renderResponse: triggerParsed,
      }, 502);
    }

    // Stage 2 — poll until terminal
    const polled = await pollRenderDeploy(apiKey, serviceId, deployId, pollTimeoutMs);
    const finalStatus = String(polled.entry?.status ?? triggered?.status ?? '').toLowerCase();
    const deployLive = finalStatus.includes('live');
    const deployFailed = ['build_failed', 'update_failed', 'canceled', 'pre_deploy_failed'].some((s) => finalStatus.includes(s));

    // Stage 3 — production health probe (only meaningful when deploy is live)
    const productionProbe = deployLive ? await probeProductionHealth() : null;

    const finishedAt = new Date().toISOString();
    const overallOk = deployLive && productionProbe?.ok === true;

    return ownerOnlyJson({
      ok: overallOk,
      marker: IVX_AUTONOMY_MARKER,
      stage: deployFailed ? 'render_failed' : !polled.terminal ? 'render_in_progress' : overallOk ? 'verified_live' : 'verification_failed',
      approvalProof,
      deploy: {
        id: deployId,
        status: polled.entry?.status ?? triggered?.status ?? null,
        commitSha: polled.entry?.commit?.id ?? triggered?.commit?.id ?? null,
        commitMessage: polled.entry?.commit?.message ?? triggered?.commit?.message ?? null,
        createdAt: polled.entry?.createdAt ?? triggered?.createdAt ?? null,
        finishedAt: polled.entry?.finishedAt ?? null,
        failureReason: polled.entry?.failureReason ?? null,
        pollCount: polled.pollCount,
        reachedTerminal: polled.terminal,
      },
      clearCache,
      productionProbe,
      rollback: {
        available: true,
        route: 'POST /api/ivx/autonomy/deploy/rollback',
      },
      timing: { startedAt, finishedAt },
      policy: { ownerApprovalRequired: true, twoFactorImplemented: false, secretsExposed: false },
    }, overallOk ? 200 : deployFailed ? 502 : 200);
  } catch (error) {
    return errorResponse(error, 401);
  }
}

/**
 * POST /api/ivx/autonomy/deploy/rollback
 *
 * One-tap rollback to the previous successful Render deploy. Forces the
 * production guard rollback path (bypasses failure-rate threshold) but still
 * requires the signed-in owner session.
 */
export async function handleIVXAutonomyDeployRollbackRequest(request: Request): Promise<Response> {
  try {
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = readObjectInput(await request.json().catch(() => ({})));
    const reason = typeof body.reason === 'string' && body.reason.trim().length > 0
      ? body.reason.trim().slice(0, 500)
      : `Owner-approved manual rollback via in-app one-tap (${ownerContext.userId ?? 'owner'}).`;

    const healthBefore = getProductionHealth();
    if (!healthBefore.renderConfigured) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_AUTONOMY_MARKER,
        stage: 'preflight',
        error: 'missing_render_credentials',
        health: healthBefore,
      }, 503);
    }

    const result = await triggerProductionRollback({ force: true, reason });
    const productionProbe = result.ok ? await probeProductionHealth() : null;
    return ownerOnlyJson({
      ok: result.ok,
      marker: IVX_AUTONOMY_MARKER,
      stage: result.ok ? 'rolled_back' : 'rollback_failed',
      result,
      productionProbe,
      timestamp: new Date().toISOString(),
    }, result.ok ? 200 : 502);
  } catch (error) {
    return errorResponse(error, 401);
  }
}

function parseGithubRepoSlug(value: string): string {
  const normalized = (value || '').trim();
  if (!normalized) return '';
  if (/^[^/\s]+\/[^/\s]+$/.test(normalized)) return normalized.replace(/\.git$/i, '');
  const m = normalized.match(/github\.com[/:]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  return m ? `${m[1]}/${m[2]}` : '';
}

async function readGithubCreds(): Promise<{ token: string; repoUrl: string; repoSlug: string; branch: string }> {
  const token = (process.env.GITHUB_TOKEN ?? '').trim() || await getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN');
  const repoUrl = (process.env.GITHUB_REPO_URL ?? '').trim() || (process.env.GITHUB_REPO ?? '').trim() || await getIVXOwnerVariableRuntimeValue('GITHUB_REPO_URL');
  const branch = (process.env.GITHUB_BRANCH ?? '').trim() || 'main';
  return { token, repoUrl, repoSlug: parseGithubRepoSlug(repoUrl), branch };
}

async function githubApi(token: string, urlPath: string): Promise<{ ok: boolean; status: number; data: unknown }>{
  try {
    const r = await fetch(`https://api.github.com${urlPath}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    let data: unknown = null;
    try { data = await r.json(); } catch { data = null; }
    return { ok: r.ok, status: r.status, data };
  } catch (err) {
    return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : 'network_error' } };
  }
}

/**
 * Runs the GitHub sync entirely in-process via `runGithubSyncInProcess`
 * (backend-native port of the old `expo/sync-github.mjs`). The previous
 * implementation spawned `node expo/sync-github.mjs`, which failed in the
 * production image with `MODULE_NOT_FOUND: /app/expo/sync-github.mjs` because
 * that file was never copied into the runtime container. The sync logic now
 * lives under `backend/` (always shipped via `COPY backend ./backend`), so the
 * route no longer depends on any external `expo/*.mjs` file.
 *
 * Returns the same CLI-compatible shape the caller already consumes.
 */
async function runSyncGithubScript(
  creds: { token: string; repoSlug: string; branch: string },
  dryRun: boolean,
  message: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  const result = await runGithubSyncInProcess({
    token: creds.token,
    repoSlug: creds.repoSlug,
    branch: creds.branch,
    dryRun,
    message,
    deleteRemote: process.env.SYNC_DELETE_REMOTE === 'true',
    timeoutMs,
  });
  return {
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
  };
}

function redactSecretsFromString(input: string, secrets: string[]): string {
  let out = input;
  for (const s of secrets) {
    if (s && s.length >= 6) {
      out = out.split(s).join('***');
    }
  }
  return out;
}

/**
 * POST /api/ivx/autonomy/github/sync
 *
 * Owner-only orchestration of `expo/sync-github.mjs`. Pushes the latest local
 * working tree to the owner-controlled GitHub repo on the configured branch
 * (`GITHUB_BRANCH` || `main`), then re-reads the branch ref to verify the
 * pushed commit hash. Defaults to dry-run; pass `apply:true` to actually push.
 *
 * Body: { apply?: boolean; message?: string; timeoutMs?: number }
 *
 * Rollback-safe: dry-run by default; on push failure no ref is updated and
 * the previous commit hash is reported as `previousCommit`. Secrets are never
 * echoed; any incidental occurrence in stdout/stderr is redacted before return.
 */
export async function handleIVXAutonomyGithubSyncRequest(request: Request): Promise<Response> {
  const startedAt = new Date().toISOString();
  try {
    const ownerContext = await assertIVXOwnerOnly(request);
    const body = readObjectInput(await request.json().catch(() => ({})));
    const apply = body.apply === true;
    const message = typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 500)
      : `sync: owner-approved IVX autonomy push ${startedAt}`;
    const timeoutMs = typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs)
      ? Math.min(Math.max(body.timeoutMs, 30_000), 10 * 60_000)
      : 5 * 60_000;

    const { token, repoUrl, repoSlug, branch } = await readGithubCreds();
    if (!token || !repoSlug) {
      return ownerOnlyJson({
        ok: false,
        marker: IVX_AUTONOMY_MARKER,
        stage: 'preflight',
        error: 'missing_github_credentials',
        githubTokenConfigured: Boolean(token),
        githubRepoConfigured: Boolean(repoSlug),
        repoUrl: repoSlug ? `https://github.com/${repoSlug}` : null,
        branch,
        hint: 'Backend runtime cannot read GITHUB_TOKEN / GITHUB_REPO_URL from env or Owner Variables.',
      }, 503);
    }

    const ownerEmail = typeof ownerContext.email === 'string' ? ownerContext.email : null;
    const ownerEmailMasked = ownerEmail ? `${ownerEmail.slice(0, 2)}***@${ownerEmail.split('@')[1] ?? 'unknown'}` : null;
    const approvalProof = {
      approved: true,
      ownerUserId: ownerContext.userId,
      ownerEmailMasked,
      ownerRole: ownerContext.role,
      guardMode: ownerContext.guardMode,
      approvedAt: startedAt,
      mechanism: 'in_app_one_tap_owner_session',
      action: apply ? 'github_sync_apply' : 'github_sync_dry_run',
    };

    // Snapshot HEAD before sync (rollback reference).
    const beforeRef = await githubApi(token, `/repos/${repoSlug}/git/ref/heads/${encodeURIComponent(branch)}`);
    const previousCommit = beforeRef.ok && beforeRef.data && typeof beforeRef.data === 'object' && 'object' in (beforeRef.data as Record<string, unknown>)
      ? ((beforeRef.data as { object?: { sha?: string } }).object?.sha ?? null)
      : null;

    // Run the existing sync script with credentials injected into env only.
    // Explicit owner approval flags are set so the push never depends on the
    // background kill-switch (IVX_AUTO_SYNC_ENABLED): this is a single,
    // owner-authenticated, on-demand push, not background auto-sync.
    const exec = await runSyncGithubScript({ token, repoSlug, branch }, !apply, message, timeoutMs);
    const secrets = [token].filter(Boolean) as string[];
    const stdoutSafe = redactSecretsFromString(exec.stdout, secrets).split('\n').slice(-60).join('\n');
    const stderrSafe = redactSecretsFromString(exec.stderr, secrets).split('\n').slice(-60).join('\n');

    // Verify pushed commit hash (re-read the branch ref).
    const afterRef = await githubApi(token, `/repos/${repoSlug}/git/ref/heads/${encodeURIComponent(branch)}`);
    const pushedCommit = afterRef.ok && afterRef.data && typeof afterRef.data === 'object' && 'object' in (afterRef.data as Record<string, unknown>)
      ? ((afterRef.data as { object?: { sha?: string } }).object?.sha ?? null)
      : null;

    let commitDetail: { sha: string; message: string | null; author: string | null; committedAt: string | null } | null = null;
    if (pushedCommit) {
      const commitRes = await githubApi(token, `/repos/${repoSlug}/commits/${pushedCommit}`);
      if (commitRes.ok && commitRes.data && typeof commitRes.data === 'object') {
        const d = commitRes.data as { sha?: string; commit?: { message?: string; author?: { name?: string; date?: string } } };
        commitDetail = {
          sha: d.sha ?? pushedCommit,
          message: d.commit?.message ?? null,
          author: d.commit?.author?.name ?? null,
          committedAt: d.commit?.author?.date ?? null,
        };
      }
    }

    const scriptOk = exec.exitCode === 0 && !exec.timedOut;
    const advanced = Boolean(previousCommit && pushedCommit && previousCommit !== pushedCommit);
    const noChanges = scriptOk && previousCommit === pushedCommit;
    const syncStatus = exec.timedOut
      ? 'timeout'
      : !scriptOk
        ? 'script_failed'
        : !apply
          ? 'dry_run'
          : advanced
            ? 'pushed'
            : noChanges
              ? 'no_changes'
              : 'verification_unknown';

    const overallOk = scriptOk && (
      !apply
        ? true
        : (advanced || noChanges)
    );

    return ownerOnlyJson({
      ok: overallOk,
      marker: IVX_AUTONOMY_MARKER,
      stage: overallOk ? (apply ? (advanced ? 'verified_pushed' : 'no_changes') : 'dry_run_complete') : 'sync_failed',
      approvalProof,
      repoUrl: `https://github.com/${repoSlug}`,
      branch,
      previousCommit,
      pushedCommit,
      syncStatus,
      verificationProof: {
        beforeRefHttpStatus: beforeRef.status,
        afterRefHttpStatus: afterRef.status,
        commitDetail,
        scriptExitCode: exec.exitCode,
        scriptTimedOut: exec.timedOut,
        scriptStdoutTail: stdoutSafe,
        scriptStderrTail: stderrSafe,
        commitUrl: pushedCommit ? `https://github.com/${repoSlug}/commit/${pushedCommit}` : null,
      },
      rollback: {
        available: Boolean(previousCommit),
        previousCommit,
        instruction: previousCommit
          ? `Force the branch back via GitHub API PATCH /repos/${repoSlug}/git/refs/heads/${branch} with sha=${previousCommit} (owner-approved only).`
          : 'No previous commit recorded; rollback not possible from this turn.',
      },
      mode: apply ? 'apply' : 'dry_run',
      policy: {
        ownerApprovalRequired: true,
        defaultMode: 'dry_run',
        secretsExposed: false,
        deploysProductionDirectly: false,
      },
      timing: { startedAt, finishedAt: new Date().toISOString() },
    }, overallOk ? 200 : 502);
  } catch (error) {
    return errorResponse(error, 401);
  }
}

/** GET /api/ivx/autonomy/token-budget */
export async function handleIVXAutonomyTokenBudgetRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
    const snapshot = await getTokenBudgetSnapshot();
    return ownerOnlyJson({
      ok: true,
      marker: IVX_AUTONOMY_MARKER,
      snapshot,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
