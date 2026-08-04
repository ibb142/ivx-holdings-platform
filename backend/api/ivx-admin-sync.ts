/**
 * IVX Admin Sync — owner-only, one-shot delivery chain:
 *
 *   Workspace → GitHub push → Render deploy → live /health verification
 *
 *   POST /api/ivx/admin/sync-github
 *
 * Runs the existing `expo/sync-github.mjs` push server-side using the backend's
 * own GITHUB_TOKEN / GITHUB_REPO_URL (branch GITHUB_BRANCH || main), re-reads the
 * branch ref to confirm the pushed HEAD SHA, triggers a Render deploy via
 * RENDER_API_KEY / RENDER_SERVICE_ID, then polls the live /health endpoint
 * (PRODUCTION_BASE_URL) and compares its reported commit SHA to GitHub HEAD.
 *
 * No credentials are accepted from the request body and none are ever returned;
 * any incidental secret occurrence in script output is redacted.
 *
 * Returns the owner's exact field set:
 *   SYNC_HTTP_STATUS, GITHUB_PUSHED, GITHUB_HEAD_SHA, GITHUB_COMMIT_URL,
 *   RENDER_DEPLOY_TRIGGERED, RENDER_DEPLOY_ID, RENDER_STATUS,
 *   HEALTH_HTTP_STATUS, PRODUCTION_HEALTH_SHA, MATCH_GITHUB_TO_HEALTH, FINAL_STATUS
 * On failure additionally:
 *   FAILED_AT, RAW_ERROR, MISSING_ENV, NEXT_OWNER_ACTION
 */

import { spawn } from 'child_process';
import * as path from 'path';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getIVXOwnerVariableRuntimeValue } from './ivx-owner-variables';

export const IVX_ADMIN_SYNC_MARKER = 'ivx-admin-sync-github-v1';

const RENDER_API_BASE_URL = 'https://api.render.com/v1';

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

function readObjectInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function parseGithubRepoSlug(value: string): string {
  const normalized = (value || '').trim();
  if (!normalized) return '';
  if (/^[^/\s]+\/[^/\s]+$/.test(normalized)) return normalized.replace(/\.git$/i, '');
  const m = normalized.match(/github\.com[/:]([^/\s]+)\/([^/.\s]+)(?:\.git)?/i);
  return m ? `${m[1]}/${m[2]}` : '';
}

async function readEnvOrOwnerVar(envName: string): Promise<string> {
  const direct = (process.env[envName] ?? '').trim();
  if (direct) return direct;
  try {
    const v = await getIVXOwnerVariableRuntimeValue(envName as Parameters<typeof getIVXOwnerVariableRuntimeValue>[0]);
    return (v ?? '').trim();
  } catch {
    return '';
  }
}

async function readGithubCreds(): Promise<{ token: string; repoUrl: string; repoSlug: string; branch: string }> {
  const token = await readEnvOrOwnerVar('GITHUB_TOKEN');
  const repoUrl = (process.env.GITHUB_REPO_URL ?? '').trim()
    || (process.env.GITHUB_REPO ?? '').trim()
    || await readEnvOrOwnerVar('GITHUB_REPO_URL');
  const branch = (process.env.GITHUB_BRANCH ?? '').trim() || 'main';
  return { token, repoUrl, repoSlug: parseGithubRepoSlug(repoUrl), branch };
}

async function githubApi(token: string, urlPath: string): Promise<{ ok: boolean; status: number; data: unknown }> {
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

function refSha(res: { ok: boolean; data: unknown }): string | null {
  if (!res.ok || !res.data || typeof res.data !== 'object') return null;
  const obj = (res.data as { object?: { sha?: string } }).object;
  return obj?.sha ?? null;
}

function runSyncGithubScript(env: NodeJS.ProcessEnv, message: string, timeoutMs: number): Promise<{ exitCode: number; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const scriptPath = path.resolve(process.cwd(), 'expo/sync-github.mjs');
    const args = [scriptPath, '--message', message];
    const child = spawn(process.execPath, args, {
      env,
      cwd: path.resolve(process.cwd(), 'expo'),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { child.kill('SIGKILL'); } catch (err) { console.error('[ivx-admin-sync] Failed to kill timed-out child process:', err); } }, timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += String(chunk); if (stdout.length > 200_000) stdout = stdout.slice(-200_000); });
    child.stderr.on('data', (chunk) => { stderr += String(chunk); if (stderr.length > 50_000) stderr = stderr.slice(-50_000); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ exitCode: code ?? -1, stdout, stderr, timedOut }); });
    child.on('error', (err) => { clearTimeout(timer); resolve({ exitCode: -1, stdout, stderr: stderr + String(err?.message ?? err), timedOut }); });
  });
}

function redactSecretsFromString(input: string, secrets: string[]): string {
  let out = input;
  for (const s of secrets) {
    if (s && s.length >= 6) out = out.split(s).join('***');
  }
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

type RenderTriggerResult = {
  triggered: boolean;
  deployId: string | null;
  status: string | null;
  autoDeployFallback: boolean;
  apiError: string | null;
};

async function triggerRenderDeploy(apiKey: string, serviceId: string, commitSha: string | null): Promise<RenderTriggerResult> {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  const url = `${RENDER_API_BASE_URL}/services/${encodeURIComponent(serviceId)}/deploys`;
  const post = async (body: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: unknown }> => {
    try {
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      let data: unknown = null;
      try { data = await r.json(); } catch { data = null; }
      return { ok: r.ok, status: r.status, data };
    } catch (err) {
      return { ok: false, status: 0, data: { error: err instanceof Error ? err.message : 'network_error' } };
    }
  };

  let response = await post(commitSha ? { commitId: commitSha } : {});
  const commitNotYetIngested = (resp: { status: number; data: unknown }): boolean =>
    resp.status === 404 && JSON.stringify(resp.data ?? '').toLowerCase().includes('does not have a commit');
  for (let attempt = 0; attempt < 4 && commitNotYetIngested(response); attempt += 1) {
    await sleep(2500);
    response = await post(commitSha ? { commitId: commitSha } : {});
  }
  if (commitNotYetIngested(response)) {
    response = await post({});
  }

  if (!response.ok) {
    return {
      triggered: false,
      deployId: null,
      status: 'auto_deploy_on_commit',
      autoDeployFallback: true,
      apiError: `Render deploy trigger failed: ${response.status} ${JSON.stringify(response.data ?? '').slice(0, 300)}`,
    };
  }
  const data = (response.data && typeof response.data === 'object' ? response.data : {}) as Record<string, unknown>;
  const deploy = (data.deploy && typeof data.deploy === 'object' ? data.deploy : {}) as Record<string, unknown>;
  const deployId = (typeof data.id === 'string' && data.id) || (typeof deploy.id === 'string' && deploy.id) || null;
  const status = (typeof data.status === 'string' && data.status) || (typeof deploy.status === 'string' && deploy.status) || 'accepted';
  return { triggered: true, deployId, status, autoDeployFallback: false, apiError: null };
}

type HealthProbe = { httpStatus: number; sha: string | null; matched: boolean };

async function probeProductionHealth(baseUrl: string, expectedSha: string | null, attempts: number): Promise<HealthProbe> {
  const url = `${baseUrl.replace(/\/+$/, '')}/health`;
  let last: HealthProbe = { httpStatus: 0, sha: null, matched: false };
  for (let i = 0; i < attempts; i += 1) {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json' } });
      let data: unknown = null;
      try { data = await r.json(); } catch { data = null; }
      const sha = data && typeof data === 'object' && typeof (data as { commit?: string }).commit === 'string'
        ? (data as { commit: string }).commit.trim()
        : null;
      const matched = Boolean(expectedSha && sha && sha !== 'unknown' && sha === expectedSha);
      last = { httpStatus: r.status, sha: sha ?? null, matched };
      if (matched) return last;
    } catch {
      last = { httpStatus: 0, sha: null, matched: false };
    }
    if (i < attempts - 1) await sleep(5000);
  }
  return last;
}

/**
 * POST /api/ivx/admin/sync-github
 *
 * Owner-only. Body: { message?: string; timeoutMs?: number; healthAttempts?: number }
 */
export async function handleIVXAdminSyncGithubSyncRequest(request: Request): Promise<Response> {
  const startedAt = new Date().toISOString();
  try {
    await assertIVXOwnerOnly(request);
    const body = readObjectInput(await request.json().catch(() => ({})));
    const message = typeof body.message === 'string' && body.message.trim().length > 0
      ? body.message.trim().slice(0, 500)
      : `sync: owner-approved GitHub→Render delivery ${startedAt}`;
    const timeoutMs = typeof body.timeoutMs === 'number' && Number.isFinite(body.timeoutMs)
      ? Math.min(Math.max(body.timeoutMs, 30_000), 10 * 60_000)
      : 5 * 60_000;
    const healthAttempts = typeof body.healthAttempts === 'number' && Number.isFinite(body.healthAttempts)
      ? Math.min(Math.max(Math.trunc(body.healthAttempts), 1), 60)
      : 24;

    const { token, repoUrl, repoSlug, branch } = await readGithubCreds();
    const renderApiKey = await readEnvOrOwnerVar('RENDER_API_KEY');
    const renderServiceId = await readEnvOrOwnerVar('RENDER_SERVICE_ID');
    const productionBaseUrl = await readEnvOrOwnerVar('PRODUCTION_BASE_URL');

    // Preflight: GitHub credentials are mandatory; without them nothing can ship.
    if (!token || !repoSlug) {
      const missing = [
        ...(!token ? ['GITHUB_TOKEN'] : []),
        ...(!repoSlug ? ['GITHUB_REPO_URL'] : []),
      ];
      return ownerOnlyJson({
        marker: IVX_ADMIN_SYNC_MARKER,
        SYNC_HTTP_STATUS: 0,
        GITHUB_PUSHED: 'NO',
        GITHUB_HEAD_SHA: null,
        GITHUB_COMMIT_URL: null,
        RENDER_DEPLOY_TRIGGERED: 'NO',
        RENDER_DEPLOY_ID: null,
        RENDER_STATUS: null,
        HEALTH_HTTP_STATUS: 0,
        PRODUCTION_HEALTH_SHA: null,
        MATCH_GITHUB_TO_HEALTH: 'NO',
        FINAL_STATUS: 'FAILED',
        FAILED_AT: 'preflight_github_credentials',
        RAW_ERROR: 'Backend runtime cannot read GitHub credentials from env or Owner Variables.',
        MISSING_ENV: missing,
        NEXT_OWNER_ACTION: 'Set GITHUB_TOKEN and GITHUB_REPO_URL on the backend (Render env) and retry.',
      }, 503);
    }

    // 1. Snapshot HEAD before push (rollback reference).
    const beforeRef = await githubApi(token, `/repos/${repoSlug}/git/ref/heads/${encodeURIComponent(branch)}`);
    const previousCommit = refSha(beforeRef);

    // 2. Run the existing sync script with credentials injected via env only.
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      IVX_AUTO_SYNC_ENABLED: 'true',
      GITHUB_TOKEN: token,
      GITHUB_REPO_URL: repoUrl,
      GITHUB_REPO: repoSlug,
      GITHUB_BRANCH: branch,
    };
    const exec = await runSyncGithubScript(childEnv, message, timeoutMs);
    const secrets = [token, renderApiKey].filter((s): s is string => Boolean(s) && s.length >= 6);
    const stdoutTail = redactSecretsFromString(exec.stdout, secrets).split('\n').slice(-40).join('\n');
    const stderrTail = redactSecretsFromString(exec.stderr, secrets).split('\n').slice(-40).join('\n');
    const scriptOk = exec.exitCode === 0 && !exec.timedOut;
    const syncHttpStatus = exec.timedOut ? 504 : scriptOk ? 200 : 500;

    // 3. Re-read branch ref to confirm the pushed HEAD SHA.
    const afterRef = await githubApi(token, `/repos/${repoSlug}/git/ref/heads/${encodeURIComponent(branch)}`);
    const githubHeadSha = refSha(afterRef);
    const advanced = Boolean(previousCommit && githubHeadSha && previousCommit !== githubHeadSha);
    const noChanges = scriptOk && Boolean(githubHeadSha) && previousCommit === githubHeadSha;
    const githubPushed = scriptOk && Boolean(githubHeadSha) && (advanced || noChanges);
    const githubCommitUrl = githubHeadSha ? `https://github.com/${repoSlug}/commit/${githubHeadSha}` : null;

    if (!githubPushed) {
      return ownerOnlyJson({
        marker: IVX_ADMIN_SYNC_MARKER,
        SYNC_HTTP_STATUS: syncHttpStatus,
        GITHUB_PUSHED: 'NO',
        GITHUB_HEAD_SHA: githubHeadSha,
        GITHUB_COMMIT_URL: githubCommitUrl,
        RENDER_DEPLOY_TRIGGERED: 'NO',
        RENDER_DEPLOY_ID: null,
        RENDER_STATUS: null,
        HEALTH_HTTP_STATUS: 0,
        PRODUCTION_HEALTH_SHA: null,
        MATCH_GITHUB_TO_HEALTH: 'NO',
        FINAL_STATUS: 'FAILED',
        FAILED_AT: exec.timedOut ? 'github_push_timeout' : 'github_push',
        RAW_ERROR: (stderrTail || stdoutTail || 'sync-github.mjs did not advance the branch ref.').slice(0, 1200),
        MISSING_ENV: [],
        NEXT_OWNER_ACTION: 'Inspect the sync output below; verify GITHUB_TOKEN has push scope on the repo and the branch is not protected.',
        previousCommit,
        scriptExitCode: exec.exitCode,
        scriptStdoutTail: stdoutTail,
        scriptStderrTail: stderrTail,
        timing: { startedAt, finishedAt: new Date().toISOString() },
      }, 502);
    }

    // 4. Trigger Render deploy (best-effort; push-to-main auto-deploy is the fallback).
    let render: RenderTriggerResult = { triggered: false, deployId: null, status: 'not_configured', autoDeployFallback: true, apiError: null };
    const renderMissing: string[] = [];
    if (renderApiKey && renderServiceId) {
      render = await triggerRenderDeploy(renderApiKey, renderServiceId, githubHeadSha);
    } else {
      if (!renderApiKey) renderMissing.push('RENDER_API_KEY');
      if (!renderServiceId) renderMissing.push('RENDER_SERVICE_ID');
      render.apiError = `Render API not configured (${renderMissing.join(', ')}); relying on push-to-main auto-deploy.`;
    }

    // 5. Poll live /health and compare its commit SHA against GitHub HEAD.
    let health: HealthProbe = { httpStatus: 0, sha: null, matched: false };
    if (productionBaseUrl) {
      health = await probeProductionHealth(productionBaseUrl, githubHeadSha, healthAttempts);
    }

    const matched = health.matched;
    const finalStatus = matched
      ? 'VERIFIED_LIVE_GITHUB_TO_RENDER_COMPLETE'
      : 'PARTIAL';

    const payload: Record<string, unknown> = {
      marker: IVX_ADMIN_SYNC_MARKER,
      SYNC_HTTP_STATUS: syncHttpStatus,
      GITHUB_PUSHED: 'YES',
      GITHUB_HEAD_SHA: githubHeadSha,
      GITHUB_COMMIT_URL: githubCommitUrl,
      RENDER_DEPLOY_TRIGGERED: render.triggered ? 'YES' : (render.autoDeployFallback ? 'AUTO_DEPLOY_ON_COMMIT' : 'NO'),
      RENDER_DEPLOY_ID: render.deployId,
      RENDER_STATUS: render.status,
      HEALTH_HTTP_STATUS: health.httpStatus,
      PRODUCTION_HEALTH_SHA: health.sha,
      MATCH_GITHUB_TO_HEALTH: matched ? 'YES' : 'NO',
      FINAL_STATUS: finalStatus,
      previousCommit,
      changed: advanced,
      timing: { startedAt, finishedAt: new Date().toISOString() },
    };

    if (!matched) {
      payload.FAILED_AT = !productionBaseUrl
        ? 'health_verification_no_base_url'
        : health.httpStatus === 0
          ? 'health_unreachable'
          : 'health_sha_mismatch_or_pending';
      payload.RAW_ERROR = !productionBaseUrl
        ? 'PRODUCTION_BASE_URL is not readable by the backend runtime, so /health could not be verified.'
        : health.httpStatus === 0
          ? `Could not reach ${productionBaseUrl.replace(/\/+$/, '')}/health within ${healthAttempts} attempts.`
          : `Live /health commit ${health.sha ?? 'unknown'} did not match GitHub HEAD ${githubHeadSha} (deploy may still be in progress).`;
      payload.MISSING_ENV = [
        ...(!productionBaseUrl ? ['PRODUCTION_BASE_URL'] : []),
        ...renderMissing,
      ];
      payload.NEXT_OWNER_ACTION = !productionBaseUrl
        ? 'Set PRODUCTION_BASE_URL on the backend, then re-call this endpoint to verify /health.'
        : 'Wait for the Render deploy to finish, then re-call this endpoint; /health will report the new commit once live.';
      if (render.apiError) payload.RENDER_API_NOTE = render.apiError;
    }

    return ownerOnlyJson(payload, matched ? 200 : 202);
  } catch (error) {
    return ownerOnlyJson({
      marker: IVX_ADMIN_SYNC_MARKER,
      SYNC_HTTP_STATUS: 0,
      GITHUB_PUSHED: 'NO',
      GITHUB_HEAD_SHA: null,
      GITHUB_COMMIT_URL: null,
      RENDER_DEPLOY_TRIGGERED: 'NO',
      RENDER_DEPLOY_ID: null,
      RENDER_STATUS: null,
      HEALTH_HTTP_STATUS: 0,
      PRODUCTION_HEALTH_SHA: null,
      MATCH_GITHUB_TO_HEALTH: 'NO',
      FINAL_STATUS: 'FAILED',
      FAILED_AT: 'owner_auth_or_unexpected_error',
      RAW_ERROR: error instanceof Error ? error.message.slice(0, 500) : 'admin_sync_failed',
      MISSING_ENV: [],
      NEXT_OWNER_ACTION: 'Call this endpoint with a valid owner session (Authorization: Bearer <IVX_OWNER_TOKEN>).',
    }, 401);
  }
}
