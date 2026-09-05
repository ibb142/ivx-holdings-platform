import { getIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';

export const IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER = 'ivx-autonomous-provider-manager-2026-09-05-v2-github-recovery';

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
let lastDataPlaneHttp: number | null = null;
let lastGithubDispatchHttp: number | null = null;
let lastAction = 'never-run';
let inFlight: Promise<ProviderManagerStatus> | null = null;

type ProviderManagerStatus = {
  marker: string;
  ok: boolean;
  action: string;
  managementHttp: number | null;
  renderHttp: number | null;
  dataPlaneHttp: number | null;
  githubDispatchHttp: number | null;
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

async function verifyManagementToken(token: string): Promise<number> {
  if (!token) return 0;
  try {
    const response = await fetch(`${SUPABASE_MANAGEMENT_API}/projects/${projectRef()}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch {
    return 0;
  }
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

async function dispatchGithubRecoveryWorkflow(): Promise<number> {
  const githubToken = await runtimeSecret('GITHUB_TOKEN');
  if (!githubToken) return 0;
  const owner = env('GITHUB_OWNER') || DEFAULT_GITHUB_OWNER;
  const repo = env('GITHUB_REPO') || DEFAULT_GITHUB_REPO;
  try {
    const response = await fetch(`${GITHUB_API}/repos/${owner}/${repo}/actions/workflows/${RECOVERY_WORKFLOW}/dispatches`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.status;
  } catch {
    return 0;
  }
}

function status(at: string, repaired = false): ProviderManagerStatus {
  return {
    marker: IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER,
    ok: Boolean(lastOk),
    action: lastAction,
    managementHttp: lastManagementHttp,
    renderHttp: lastRenderHttp,
    dataPlaneHttp: lastDataPlaneHttp,
    githubDispatchHttp: lastGithubDispatchHttp,
    repaired,
    error: lastError,
    at,
  };
}

async function runInternal(reason: 'boot' | 'interval' | 'manual'): Promise<ProviderManagerStatus> {
  const at = new Date().toISOString();
  lastRunAt = at;
  const supabaseUrl = env('EXPO_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL') || env('IVX_SUPABASE_URL');
  const processManagementToken = env('SUPABASE_ACCESS_TOKEN');
  const ownerManagementToken = (await getIVXOwnerVariableRuntimeValue('SUPABASE_ACCESS_TOKEN').catch(() => '')).trim();
  const managementToken = processManagementToken || ownerManagementToken;
  const serviceRoleKey = await runtimeSecret('SUPABASE_SERVICE_ROLE_KEY');

  lastManagementHttp = await verifyManagementToken(managementToken);
  lastDataPlaneHttp = await verifyDataPlane(supabaseUrl, serviceRoleKey);

  if (lastManagementHttp === 200 && lastDataPlaneHttp === 200) {
    lastOk = true;
    lastError = null;
    lastAction = 'providers-healthy';
    return status(at);
  }

  const recentRepair = lastRepairAt ? Date.now() - Date.parse(lastRepairAt) < MIN_REPAIR_INTERVAL_MS : false;
  if (recentRepair) {
    lastOk = false;
    lastError = 'repair_backoff_active';
    lastAction = 'degraded-backoff';
    return status(at);
  }

  // First preference: repair directly with credentials already held by this backend.
  if (managementToken && serviceRoleKey) {
    lastRenderHttp = await repairRenderRuntime({ managementToken, serviceRoleKey });
    if ([200, 201, 202].includes(lastRenderHttp)) {
      lastRepairAt = at;
      lastOk = true;
      lastError = null;
      lastAction = 'render-runtime-repaired-direct';
      console.log('[IVX Autonomous Provider Manager]', {
        reason,
        action: lastAction,
        managementHttp: lastManagementHttp,
        dataPlaneHttp: lastDataPlaneHttp,
        renderHttp: lastRenderHttp,
        secretValuesReturned: false,
      });
      return status(at, true);
    }
  }

  // Second preference: if the local Management PAT vanished or is invalid,
  // dispatch the owner-approved GitHub workflow. That workflow can consume the
  // repository secret without exposing it and re-sync it into Render.
  lastGithubDispatchHttp = await dispatchGithubRecoveryWorkflow();
  if (lastGithubDispatchHttp === 204) {
    lastRepairAt = at;
    lastOk = false;
    lastError = 'github_recovery_dispatched_waiting_for_rebind';
    lastAction = 'github-secret-recovery-dispatched';
    console.warn('[IVX Autonomous Provider Manager]', {
      reason,
      action: lastAction,
      managementHttp: lastManagementHttp,
      dataPlaneHttp: lastDataPlaneHttp,
      githubDispatchHttp: lastGithubDispatchHttp,
      secretValuesReturned: false,
    });
    return status(at, true);
  }

  lastOk = false;
  lastAction = 'provider-recovery-blocked';
  lastError = `direct_render_http_${lastRenderHttp ?? 0};github_dispatch_http_${lastGithubDispatchHttp ?? 0}`;
  console.error('[IVX Autonomous Provider Manager]', {
    reason,
    action: lastAction,
    managementHttp: lastManagementHttp,
    dataPlaneHttp: lastDataPlaneHttp,
    renderHttp: lastRenderHttp,
    githubDispatchHttp: lastGithubDispatchHttp,
    secretValuesReturned: false,
  });
  return status(at);
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
    lastDataPlaneHttp,
    lastGithubDispatchHttp,
    lastAction,
    policy: 'Autonomous continuously QA-checks Supabase Management API + data plane. It self-repairs Render directly when credentials are available; if the local Management PAT is missing/invalid, it dispatches the GitHub secret recovery workflow without exposing the secret. Provider mutations are rate-limited.',
  };
}
