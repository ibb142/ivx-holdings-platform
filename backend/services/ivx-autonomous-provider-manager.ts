import { getIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';

export const IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER = 'ivx-autonomous-provider-manager-2026-09-05-v1';

const SUPABASE_MANAGEMENT_API = 'https://api.supabase.com/v1';
const RENDER_API = 'https://api.render.com/v1';
const DEFAULT_PROJECT_REF = 'kvclcdjmjghndxsngfzb';
const DEFAULT_RENDER_SERVICE_ID = 'srv-d7t9ivreo5us73ftose0';
const MIN_REPAIR_INTERVAL_MS = 5 * 60_000;

let lastRunAt: string | null = null;
let lastOk: boolean | null = null;
let lastError: string | null = null;
let lastRepairAt: string | null = null;
let lastManagementHttp: number | null = null;
let lastRenderHttp: number | null = null;
let lastDataPlaneHttp: number | null = null;
let lastAction = 'never-run';
let inFlight: Promise<ProviderManagerStatus> | null = null;

type ProviderManagerStatus = {
  marker: string;
  ok: boolean;
  action: string;
  managementHttp: number | null;
  renderHttp: number | null;
  dataPlaneHttp: number | null;
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

async function runInternal(reason: 'boot' | 'interval' | 'manual'): Promise<ProviderManagerStatus> {
  const at = new Date().toISOString();
  lastRunAt = at;
  const supabaseUrl = env('EXPO_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL') || env('IVX_SUPABASE_URL');
  const processManagementToken = env('SUPABASE_ACCESS_TOKEN');
  const ownerManagementToken = await getIVXOwnerVariableRuntimeValue('SUPABASE_ACCESS_TOKEN').catch(() => '');
  const managementToken = processManagementToken || ownerManagementToken.trim();
  const serviceRoleKey = await runtimeSecret('SUPABASE_SERVICE_ROLE_KEY');

  lastManagementHttp = await verifyManagementToken(managementToken);
  lastDataPlaneHttp = await verifyDataPlane(supabaseUrl, serviceRoleKey);

  if (lastManagementHttp === 200 && lastDataPlaneHttp === 200) {
    lastOk = true;
    lastError = null;
    lastAction = 'providers-healthy';
    return { marker: IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER, ok: true, action: lastAction, managementHttp: lastManagementHttp, renderHttp: lastRenderHttp, dataPlaneHttp: lastDataPlaneHttp, repaired: false, error: null, at };
  }

  const canRepair = Boolean(ownerManagementToken.trim() && serviceRoleKey);
  const recentRepair = lastRepairAt ? Date.now() - Date.parse(lastRepairAt) < MIN_REPAIR_INTERVAL_MS : false;
  if (!canRepair || recentRepair) {
    lastOk = false;
    lastError = !canRepair ? 'secure_provider_credentials_unavailable' : 'repair_backoff_active';
    lastAction = 'degraded-no-write';
    return { marker: IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER, ok: false, action: lastAction, managementHttp: lastManagementHttp, renderHttp: lastRenderHttp, dataPlaneHttp: lastDataPlaneHttp, repaired: false, error: lastError, at };
  }

  lastRenderHttp = await repairRenderRuntime({ managementToken: ownerManagementToken.trim(), serviceRoleKey });
  const renderOk = [200, 201, 202].includes(lastRenderHttp);
  lastOk = renderOk;
  lastAction = renderOk ? 'render-runtime-repaired' : 'render-runtime-repair-failed';
  lastError = renderOk ? null : `render_env_sync_http_${lastRenderHttp}`;
  if (renderOk) lastRepairAt = at;

  const log = renderOk ? console.log : console.error;
  log('[IVX Autonomous Provider Manager]', {
    reason,
    action: lastAction,
    managementHttp: lastManagementHttp,
    dataPlaneHttp: lastDataPlaneHttp,
    renderHttp: lastRenderHttp,
    secretValuesReturned: false,
  });

  return { marker: IVX_AUTONOMOUS_PROVIDER_MANAGER_MARKER, ok: renderOk, action: lastAction, managementHttp: lastManagementHttp, renderHttp: lastRenderHttp, dataPlaneHttp: lastDataPlaneHttp, repaired: renderOk, error: lastError, at };
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
    lastAction,
    policy: 'Self-repair IVX-owned Render/Supabase runtime bindings from backend env or encrypted Owner Variables; never log or return secrets; rate-limit provider mutations.',
  };
}
