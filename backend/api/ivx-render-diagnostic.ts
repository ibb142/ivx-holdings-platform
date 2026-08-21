/**
 * Owner-only Render deploy diagnostic.
 *
 * Runs inside the backend and reads Render credentials from process.env or the
 * encrypted Owner Variables runtime bridge. Secrets are never returned.
 */
import { auditIVXRenderRuntimeAccess } from '../services/ivx-senior-developer-runtime';
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
  const apiKey = (process.env.RENDER_API_KEY ?? '').trim() || await getIVXOwnerVariableRuntimeValue('RENDER_API_KEY');
  const serviceId = (process.env.RENDER_SERVICE_ID ?? '').trim() || await getIVXOwnerVariableRuntimeValue('RENDER_SERVICE_ID');
  return { apiKey, serviceId };
}

type DeployItem = {
  id?: string;
  status?: string;
  trigger?: string;
  finishedAt?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  commit?: { id?: string; message?: string; createdAt?: string } | null;
  commitSha?: string | null;
  commitMessage?: string | null;
  commitCreatedAt?: string | null;
  branch?: string | null;
  image?: { ref?: string } | null;
  failureReason?: string | null;
};

function normalizeDeploy(raw: unknown): DeployItem {
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
    finishedAt: typeof entry.finishedAt === 'string' ? entry.finishedAt : null,
    createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : null,
    updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
    commit: commitObj as DeployItem['commit'],
    commitSha: commitObj && typeof commitObj.id === 'string' ? commitObj.id : null,
    commitMessage: commitObj && typeof commitObj.message === 'string' ? commitObj.message : null,
    commitCreatedAt: commitObj && typeof commitObj.createdAt === 'string' ? commitObj.createdAt : null,
    branch: typeof entry.branch === 'string' ? entry.branch : null,
    image: (entry.image && typeof entry.image === 'object') ? entry.image as DeployItem['image'] : null,
    failureReason: typeof entry.failureReason === 'string' ? entry.failureReason : null,
  };
}

async function callRender(path: string, apiKey: string): Promise<{ ok: boolean; status: number; body: unknown; error?: string }> {
  try {
    const response = await fetch(`${RENDER_API_BASE}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try { parsed = JSON.parse(text); } catch { parsed = { raw: text.slice(0, 4000) }; }
    }
    return { ok: response.ok, status: response.status, body: parsed };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function readRenderEnvPresence(body: unknown): Record<string, { present: boolean; length: number }> {
  const wanted = ['OWNER_NEW_PASSWORD', 'IVX_OWNER_PASSWORD', 'JWT_SECRET', 'APP_SECRET', 'IVX_OWNER_VARIABLES_ENCRYPTION_KEY'];
  const result = Object.fromEntries(wanted.map((key) => [key, { present: false, length: 0 }])) as Record<string, { present: boolean; length: number }>;
  if (!Array.isArray(body)) return result;
  for (const raw of body) {
    const wrapper = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const entry = wrapper.envVar && typeof wrapper.envVar === 'object' ? wrapper.envVar as Record<string, unknown> : wrapper;
    const key = typeof entry.key === 'string' ? entry.key : '';
    if (!(key in result)) continue;
    const value = typeof entry.value === 'string' ? entry.value : '';
    result[key] = { present: value.length > 0, length: value.length };
  }
  return result;
}

export async function handleIVXRenderDiagnosticRequest(request: Request): Promise<Response> {
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

  const url = new URL(request.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '5', 10) || 5, 1), 20);
  const [serviceResult, deploysResult, envVarsResult] = await Promise.all([
    callRender(`/services/${encodeURIComponent(serviceId)}`, apiKey),
    callRender(`/services/${encodeURIComponent(serviceId)}/deploys?limit=${limit}`, apiKey),
    callRender(`/services/${encodeURIComponent(serviceId)}/env-vars`, apiKey),
  ]);

  const deploysArray: unknown[] = Array.isArray(deploysResult.body) ? deploysResult.body : [];
  const deploys = deploysArray.map(normalizeDeploy);
  const latest = deploys[0];
  const envPresence = readRenderEnvPresence(envVarsResult.body);

  let latestEvents: unknown = null;
  if (latest?.id) {
    const eventsResult = await callRender(`/services/${encodeURIComponent(serviceId)}/deploys/${encodeURIComponent(latest.id)}/events?limit=20`, apiKey);
    latestEvents = eventsResult.ok ? eventsResult.body : { error: `events_http_${eventsResult.status}` };
  }

  const serviceInfo = (serviceResult.ok && serviceResult.body && typeof serviceResult.body === 'object')
    ? serviceResult.body as Record<string, unknown>
    : null;

  return ownerOnlyJson({
    ok: deploysResult.ok && envVarsResult.ok,
    credentials: credentialReport,
    renderAudit,
    ownerAuthEnvPresence: envPresence,
    envVarsHttpStatus: envVarsResult.status,
    service: serviceInfo ? {
      id: serviceInfo.id,
      name: serviceInfo.name,
      type: serviceInfo.type,
      branch: (serviceInfo as { branch?: string }).branch ?? null,
      repo: (serviceInfo as { repo?: string }).repo ?? null,
      autoDeploy: (serviceInfo as { autoDeploy?: string }).autoDeploy ?? null,
      suspended: (serviceInfo as { suspended?: string }).suspended ?? null,
    } : { error: `service_http_${serviceResult.status}` },
    latestDeploy: latest ? {
      id: latest.id,
      status: latest.status,
      trigger: latest.trigger,
      commitSha: latest.commitSha,
      commitMessage: latest.commitMessage,
      finishedAt: latest.finishedAt,
      createdAt: latest.createdAt,
      updatedAt: latest.updatedAt,
      failureReason: latest.failureReason,
    } : null,
    recentDeploys: deploys.map((d) => ({ id: d.id, status: d.status, trigger: d.trigger, commitSha: d.commitSha, commitMessage: d.commitMessage, finishedAt: d.finishedAt, createdAt: d.createdAt, failureReason: d.failureReason })),
    latestDeployEvents: latestEvents,
    deploysHttpStatus: deploysResult.status,
    runtime: { node: process.version, platform: process.platform, timestamp: new Date().toISOString(), deploymentMarker: process.env.DEPLOYMENT_MARKER ?? null },
    secretValuesReturned: false,
  });
}
