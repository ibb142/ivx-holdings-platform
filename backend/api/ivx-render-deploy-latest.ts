/**
 * Owner-only Render "deploy latest commit" trigger.
 *
 * Reads Render credentials from process.env or the encrypted Owner Variables
 * runtime bridge, then POSTs to Render's deploys endpoint. Secrets are never
 * returned to the client.
 */
import { auditIVXRenderRuntimeAccess } from '../services/ivx-senior-developer-runtime';
import { extractRenderApiKey, extractRenderServiceId } from '../services/ivx-render-credentials';
import { getIVXOwnerVariableRuntimeValue, inspectIVXOwnerVariableRuntimeReadiness } from './ivx-owner-variables';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

const RENDER_API_BASE = 'https://api.render.com/v1';

export function OPTIONS(): Response {
  return ownerOnlyOptions();
}

function maskSecret(value: string | undefined): string {
  if (!value) return 'missing';
  if (value.length <= 8) return '***';
  return `${value.slice(0, 4)}…${value.slice(-2)} (len=${value.length})`;
}

async function readRenderRuntimeCredentials(): Promise<{ apiKey: string; serviceId: string }> {
  // FINAL CLOSEOUT 2026-08-23: normalize raw values through the credential
  // extractors — env/owner-variable values may carry annotation labels around
  // the real `rnd_…` key / `srv-…` id, which produced Render 401s.
  const envKey = extractRenderApiKey(process.env.RENDER_API_KEY);
  const apiKey = envKey || extractRenderApiKey(await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY'));
  const envService = extractRenderServiceId(process.env.RENDER_SERVICE_ID);
  const serviceId = envService || extractRenderServiceId(await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID'));
  return { apiKey, serviceId };
}

type RenderDeployResponse = {
  id?: string;
  status?: string;
  trigger?: string;
  createdAt?: string | null;
  finishedAt?: string | null;
  updatedAt?: string | null;
  commit?: { id?: string; message?: string; createdAt?: string } | null;
  failureReason?: string | null;
};

function normalizeDeploy(raw: unknown): RenderDeployResponse {
  const entry = (raw && typeof raw === 'object' && 'deploy' in (raw as Record<string, unknown>))
    ? (raw as { deploy: Record<string, unknown> }).deploy
    : (raw as Record<string, unknown>) || {};
  const commitObj = (entry.commit && typeof entry.commit === 'object')
    ? (entry.commit as Record<string, unknown>)
    : null;
  return {
    id: typeof entry.id === 'string' ? entry.id : undefined,
    status: typeof entry.status === 'string' ? entry.status : undefined,
    trigger: typeof entry.trigger === 'string' ? entry.trigger : undefined,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
    finishedAt: typeof entry.finishedAt === 'string' ? entry.finishedAt : null,
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    commit: commitObj as RenderDeployResponse['commit'],
    failureReason: typeof entry.failureReason === 'string' ? entry.failureReason : null,
  };
}

export async function handleIVXRenderDeployLatestRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unauthorized';
    return ownerOnlyJson({ ok: false, error: message }, 401);
  }

  const { apiKey, serviceId } = await readRenderRuntimeCredentials();
  const [apiKeyReadiness, serviceIdReadiness, renderAudit] = await Promise.all([
    inspectIVXOwnerVariableRuntimeReadiness('RENDER_API_KEY'),
    inspectIVXOwnerVariableRuntimeReadiness('RENDER_SERVICE_ID'),
    auditIVXRenderRuntimeAccess(),
  ]);

  const credentialReport = {
    renderApiKey: {
      present: apiKeyReadiness.present,
      length: apiKeyReadiness.length,
      source: apiKeyReadiness.source,
      processEnvPresent: apiKeyReadiness.processEnvPresent,
      ownerVariablesStorePresent: apiKeyReadiness.ownerVariablesStorePresent,
      maskedEnvOnly: maskSecret(process.env.RENDER_API_KEY),
    },
    renderServiceId: {
      present: serviceIdReadiness.present,
      length: serviceIdReadiness.length,
      source: serviceIdReadiness.source,
      processEnvPresent: serviceIdReadiness.processEnvPresent,
      ownerVariablesStorePresent: serviceIdReadiness.ownerVariablesStorePresent,
      value: serviceId ? `${serviceId.slice(0, 4)}…${serviceId.slice(-4)}` : 'missing',
    },
  };

  if (!apiKey || !serviceId) {
    return ownerOnlyJson({
      ok: false,
      error: 'missing_render_credentials',
      credentials: credentialReport,
      renderAudit,
      hint: 'RENDER_API_KEY and RENDER_SERVICE_ID must be readable from process.env or the encrypted Owner Variables runtime bridge.',
      runtime: { node: process.version, platform: process.platform, timestamp: new Date().toISOString() },
    }, 500);
  }

  let clearCache: 'do_not_clear' | 'clear' = 'do_not_clear';
  try {
    if (request.method === 'POST') {
      const ct = request.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const body = await request.json().catch(() => null) as { clearCache?: boolean } | null;
        if (body && body.clearCache === true) clearCache = 'clear';
      }
    }
  } catch {
    // ignore body parse errors
  }

  const startedAt = new Date().toISOString();
  let triggerStatus = 0;
  let triggerOk = false;
  let triggerErr: string | null = null;
  let parsed: unknown = null;

  try {
    const response = await fetch(`${RENDER_API_BASE}/services/${encodeURIComponent(serviceId)}/deploys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ clearCache }),
    });
    triggerStatus = response.status;
    triggerOk = response.ok;
    const text = await response.text();
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 4000) }; }
    }
  } catch (err) {
    triggerErr = err instanceof Error ? err.message : String(err);
  }

  if (!triggerOk) {
    return ownerOnlyJson({
      ok: false,
      error: triggerErr ? 'render_api_network_error' : `render_api_http_${triggerStatus}`,
      credentials: credentialReport,
      renderAudit,
      renderResponse: parsed,
      networkError: triggerErr,
      startedAt,
      runtime: {
        node: process.version,
        platform: process.platform,
        timestamp: new Date().toISOString(),
        deploymentMarker: process.env.DEPLOYMENT_MARKER ?? null,
      },
    }, triggerStatus >= 400 && triggerStatus < 600 ? triggerStatus : 502);
  }

  const deploy = normalizeDeploy(parsed);
  const commitSha = deploy.commit && typeof deploy.commit.id === 'string' ? deploy.commit.id : null;
  const commitMessage = deploy.commit && typeof deploy.commit.message === 'string' ? deploy.commit.message : null;

  return ownerOnlyJson({
    ok: true,
    credentials: credentialReport,
    renderAudit,
    deploy: {
      id: deploy.id ?? null,
      status: deploy.status ?? null,
      trigger: deploy.trigger ?? null,
      commitSha,
      commitMessage,
      createdAt: deploy.createdAt,
      finishedAt: deploy.finishedAt,
      updatedAt: deploy.updatedAt,
      failureReason: deploy.failureReason,
    },
    clearCache,
    startedAt,
    runtime: {
      node: process.version,
      platform: process.platform,
      timestamp: new Date().toISOString(),
      deploymentMarker: process.env.DEPLOYMENT_MARKER ?? null,
    },
  });
}
