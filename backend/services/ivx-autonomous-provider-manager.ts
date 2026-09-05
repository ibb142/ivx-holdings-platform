import { GetCallerIdentityCommand, STSClient } from '@aws-sdk/client-sts';
import { getIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';

export const IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER = 'ivx-autonomous-provider-manager-2026-09-06-v3-four-provider-control-plane';

const SUPABASE_MANAGEMENT_API = 'https://api.supabase.com/v1';
const RENDER_API = 'https://api.render.com/v1';
const GITHUB_API = 'https://api.github.com';
const DEFAULT_PROJECT_REF = 'kvclcdjmjghndxsngfzb';
const DEFAULT_RENDER_SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const DEFAULT_GITHUB_OWNER = 'ibb142';
const DEFAULT_GITHUB_REPO = 'ivx-holdings-platform';
const RECOVERY_WORKFLOW = 'ivx-supabase-management-restart.yml';
const MIN_REPAIR_INTERVAL_MS = 5 * 60_000;

let lastRunAt: string | null = null;
let lastOk: boolean | null = null;
let lastError: string | null = null;
let lastRepairAt: string | null = null;
let lastManagementHttp: number | null = null;
let lastRenderHttp: number | null = null;
let lastRenderControlHttp: number | null = null;
let lastDataPlaneHttp: number | null = null;
let lastGithubHttp: number | null = null;
let lastGithubDispatchHttp: number | null = null;
let lastAwsOk: boolean | null = null;
let lastAwsIdentityPresent: boolean | null = null;
let lastAction = 'never-run';
let inFlight: Promise<ProviderManagerStatus> | null = null;

type ProviderManagerStatus = {
  marker: string;
  ok: boolean;
  action: string;
  providers: {
    github: { ok: boolean; http: number | null; credentialAvailable: boolean };
    render: { ok: boolean; http: number | null; credentialAvailable: boolean };
    supabase: { ok: boolean; managementHttp: number | null; dataPlaneHttp: number | null; managementCredentialAvailable: boolean; serviceRoleAvailable: boolean };
    aws: { ok: boolean; identityPresent: boolean; credentialAvailable: boolean };
  };
  managementHttp: number | null;
  renderHttp: number | null;
  renderControlHttp: number | null;
  dataPlaneHttp: number | null;
  githubHttp: number | null;
  githubDispatchHttp: number | null;
  awsOk: boolean | null;
  repaired: boolean;
  error: string | null;
  at: string;
};

function env(name: string): string {
  return (process.env[name] ?? '').trim();
}

async function runtimeSecret(name: string): Promise<string> {
  return env(name) || (await getIVXOwnerVariableRuntimeValue(name).catch(() => '')).trim();
}

function projectRef(): string {
  const url = env('EXPO_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL') || env('IVX_SUPABASE_URL');
  const match = url.match(/^https:\/\/([a-z0-9]+)\.supabase\.co/i);
  return match?.[1] || env('SUPABASE_PROJECT_REF') || DEFAULT_PROJECT_REF;
}

async function verifyHttp(url: string, token: string, header = 'Authorization'): Promise<number> {
  if (!token) return 0;
  try {
    const response = await fetch(url, {
      headers: { [header]: header === 'Authorization' ? `Bearer ${token}` : token, Accept: 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

async function verifyManagementToken(token: string): Promise<number> {
  return verifyHttp(`${SUPABASE_MANAGEMENT_API}/projects/${projectRef()}`, token);
}

async function verifyDataPlane(url: string, serviceRoleKey: string): Promise<number> {
  if (!url || !serviceRoleKey) return 0;
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/rest/v1/ivx_agent_states?select=agent_id&limit=1`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` },
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

async function verifyGithub(token: string): Promise<number> {
  const owner = env('GITHUB_OWNER') || DEFAULT_GITHUB_OWNER;
  const repo = env('GITHUB_REPO') || DEFAULT_GITHUB_REPO;
  return verifyHttp(`${GITHUB_API}/repos/${owner}/${repo}`, token);
}

async function verifyRenderControl(token: string): Promise<number> {
  const serviceId = env('RENDER_SERVICE_ID') || DEFAULT_RENDER_SERVICE_ID;
  return verifyHttp(`${RENDER_API}/services/${encodeURIComponent(serviceId)}`, token);
}

async function verifyAwsIdentity(accessKeyId: string, secretAccessKey: string, sessionToken: string, region: string): Promise<{ ok: boolean; identityPresent: boolean }> {
  if (!accessKeyId || !secretAccessKey) return { ok: false, identityPresent: false };
  try {
    const client = new STSClient({
      region: region || 'us-east-1',
      credentials: { accessKeyId, secretAccessKey, ...(sessionToken ? { sessionToken } : {}) },
    });
    const result = await client.send(new GetCallerIdentityCommand({}));
    client.destroy();
    return { ok: Boolean(result.Account && result.Arn), identityPresent: Boolean(result.Account && result.Arn) };
  } catch {
    return { ok: false, identityPresent: false };
  }
}

async function repairRenderRuntime(input: { managementToken: string; serviceRoleKey: string }): Promise<number> {
  const renderKey = await runtimeSecret('RENDER_API_KEY');
  const serviceId = env('RENDER_SERVICE_ID') || DEFAULT_RENDER_SERVICE_ID;
  if (!renderKey || !serviceId || !input.managementToken || !input.serviceRoleKey) return 0;
  try {
    const response = await fetch(`${RENDER_API}/services/${encodeURIComponent(serviceId)}/env-vars`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${renderKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify([
        { key: 'SUPABASE_ACCESS_TOKEN', value: input.managementToken },
        { key: 'SUPABASE_SERVICE_ROLE_KEY', value: input.serviceRoleKey },
      ]),
      signal: AbortSignal.timeout(15_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

async function dispatchGithubRecoveryWorkflow(githubToken: string): Promise<number> {
  if (!githubToken) return 0;
  const owner = env('GITHUB_OWNER') || DEFAULT_GITHUB_OWNER;
  const repo = env('GITHUB_REPO') || DEFAULT_GITHUB_REPO;
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${RECOVERY_WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

function status(at: string, repaired = false, availability?: { github: boolean; render: boolean; management: boolean; serviceRole: boolean; aws: boolean }): ProviderManagerStatus {
  const a = availability ?? { github: false, render: false, management: false, serviceRole: false, aws: false };
  return {
    marker: IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER,
    ok: Boolean(lastOk),
    action: lastAction,
    providers: {
      github: { ok: lastGithubHttp === 200, http: lastGithubHttp, credentialAvailable: a.github },
      render: { ok: lastRenderControlHttp === 200, http: lastRenderControlHttp, credentialAvailable: a.render },
      supabase: { ok: lastManagementHttp === 200 && lastDataPlaneHttp === 200, managementHttp: lastManagementHttp, dataPlaneHttp: lastDataPlaneHttp, managementCredentialAvailable: a.management, serviceRoleAvailable: a.serviceRole },
      aws: { ok: Boolean(lastAwsOk), identityPresent: Boolean(lastAwsIdentityPresent), credentialAvailable: a.aws },
    },
    managementHttp: lastManagementHttp,
    renderHttp: lastRenderHttp,
    renderControlHttp: lastRenderControlHttp,
    dataPlaneHttp: lastDataPlaneHttp,
    githubHttp: lastGithubHttp,
    githubDispatchHttp: lastGithubDispatchHttp,
    awsOk: lastAwsOk,
    repaired,
    error: lastError,
    at,
  };
}

async function runInternal(reason: 'boot' | 'interval' | 'manual'): Promise<ProviderManagerStatus> {
  const at = new Date().toISOString();
  lastRunAt = at;
  const supabaseUrl = env('EXPO_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL') || env('IVX_SUPABASE_URL');
  const [ownerManagementToken, serviceRoleKey, githubToken, renderKey, awsAccessKeyId, awsSecretAccessKey, awsSessionToken] = await Promise.all([
    getIVXOwnerVariableRuntimeValue('SUPABASE_ACCESS_TOKEN').catch(() => ''),
    runtimeSecret('SUPABASE_SERVICE_ROLE_KEY'),
    runtimeSecret('GITHUB_TOKEN'),
    runtimeSecret('RENDER_API_KEY'),
    runtimeSecret('AWS_ACCESS_KEY_ID'),
    runtimeSecret('AWS_SECRET_ACCESS_KEY'),
    runtimeSecret('AWS_SESSION_TOKEN'),
  ]);
  const managementToken = env('SUPABASE_ACCESS_TOKEN') || ownerManagementToken.trim();
  const awsRegion = env('AWS_REGION') || (await runtimeSecret('AWS_REGION')) || 'us-east-1';
  const availability = {
    github: Boolean(githubToken),
    render: Boolean(renderKey),
    management: Boolean(managementToken),
    serviceRole: Boolean(serviceRoleKey),
    aws: Boolean(awsAccessKeyId && awsSecretAccessKey),
  };

  const [managementHttp, dataPlaneHttp, githubHttp, renderControlHttp, aws] = await Promise.all([
    verifyManagementToken(managementToken),
    verifyDataPlane(supabaseUrl, serviceRoleKey),
    verifyGithub(githubToken),
    verifyRenderControl(renderKey),
    verifyAwsIdentity(awsAccessKeyId, awsSecretAccessKey, awsSessionToken, awsRegion),
  ]);
  lastManagementHttp = managementHttp;
  lastDataPlaneHttp = dataPlaneHttp;
  lastGithubHttp = githubHttp;
  lastRenderControlHttp = renderControlHttp;
  lastAwsOk = aws.ok;
  lastAwsIdentityPresent = aws.identityPresent;

  const supabaseOk = managementHttp === 200 && dataPlaneHttp === 200;
  const controlPlaneOk = githubHttp === 200 && renderControlHttp === 200 && aws.ok;
  if (supabaseOk && controlPlaneOk) {
    lastOk = true;
    lastError = null;
    lastAction = 'all-provider-control-planes-healthy';
    return status(at, false, availability);
  }

  const recentRepair = lastRepairAt ? Date.now() - Date.parse(lastRepairAt) < MIN_REPAIR_INTERVAL_MS : false;
  if (!supabaseOk && !recentRepair && managementToken && serviceRoleKey && renderKey) {
    lastRenderHttp = await repairRenderRuntime({ managementToken, serviceRoleKey });
    if ([200, 201, 202].includes(lastRenderHttp)) {
      lastRepairAt = at;
      lastOk = false;
      lastError = 'render_rebind_completed_reverification_required';
      lastAction = 'render-runtime-repaired-direct';
      console.warn('[IVX Autonomous Provider Manager]', { reason, action: lastAction, managementHttp, dataPlaneHttp, githubHttp, renderControlHttp, awsOk: aws.ok, renderHttp: lastRenderHttp, secretValuesReturned: false });
      return status(at, true, availability);
    }
  }

  if (!supabaseOk && !recentRepair && githubToken) {
    lastGithubDispatchHttp = await dispatchGithubRecoveryWorkflow(githubToken);
    if (lastGithubDispatchHttp === 204) {
      lastRepairAt = at;
      lastOk = false;
      lastError = 'github_recovery_dispatched_waiting_for_rebind';
      lastAction = 'github-secret-recovery-dispatched';
      console.warn('[IVX Autonomous Provider Manager]', { reason, action: lastAction, managementHttp, dataPlaneHttp, githubHttp, renderControlHttp, awsOk: aws.ok, githubDispatchHttp: lastGithubDispatchHttp, secretValuesReturned: false });
      return status(at, true, availability);
    }
  }

  lastOk = false;
  const degraded = [
    githubHttp === 200 ? null : `github_http_${githubHttp}`,
    renderControlHttp === 200 ? null : `render_http_${renderControlHttp}`,
    managementHttp === 200 ? null : `supabase_management_http_${managementHttp}`,
    dataPlaneHttp === 200 ? null : `supabase_data_http_${dataPlaneHttp}`,
    aws.ok ? null : 'aws_sts_unhealthy',
  ].filter(Boolean);
  lastAction = recentRepair ? 'provider-degraded-backoff' : 'provider-control-plane-degraded';
  lastError = degraded.join(';');
  console.error('[IVX Autonomous Provider Manager]', { reason, action: lastAction, githubHttp, renderControlHttp, managementHttp, dataPlaneHttp, awsOk: aws.ok, secretValuesReturned: false });
  return status(at, false, availability);
}

export function runAutonomousProviderManager(reason: 'boot' | 'interval' | 'manual' = 'manual'): Promise<ProviderManagerStatus> {
  if (inFlight) return inFlight;
  inFlight = runInternal(reason).finally(() => { inFlight = null; });
  return inFlight;
}

export function getAutonomousProviderManagerStatus() {
  return {
    marker: IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER,
    running: Boolean(inFlight),
    lastRunAt,
    lastOk,
    lastError,
    lastRepairAt,
    lastManagementHttp,
    lastRenderHttp,
    lastRenderControlHttp,
    lastDataPlaneHttp,
    lastGithubHttp,
    lastGithubDispatchHttp,
    lastAwsOk,
    lastAwsIdentityPresent,
    lastAction,
    policy: 'Autonomous continuously audits GitHub, Render, Supabase Management API/data plane, and AWS STS. Secrets are read only from backend environment or encrypted Owner Variables. GitHub Actions secrets are intentionally non-exportable; Autonomous may consume them only by dispatching owner-approved recovery workflows. No secret values are logged or returned. Provider mutations are rate-limited.',
  };
}
