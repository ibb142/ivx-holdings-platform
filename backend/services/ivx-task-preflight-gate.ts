import { getIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';

export const IVX_TASK_PREFLIGHT_GATE_MARKER = 'ivx-task-preflight-gate-v3-2026-08-30';

const REPO = process.env.IVX_GITHUB_REPO || 'ibb142/ivx-holdings-platform';
const GITHUB_API = 'https://api.github.com';
const API_BASE = (process.env.IVX_API_BASE || 'https://api.ivxholding.com').replace(/\/$/, '');
const CACHE_MS = 30_000;
const QUEUE_MAX = 12;
const QUEUE_MAX_AGE_MS = 5 * 60_000;

export type TaskPreflightState = {
  marker: typeof IVX_TASK_PREFLIGHT_GATE_MARKER;
  checkedAt: string;
  open: boolean;
  mainSha: string | null;
  productionSha: string | null;
  productionHealthy: boolean;
  queueHealthy: boolean;
  supervisorHealthy: boolean;
  queued: number;
  inProgress: number;
  oldestQueuedAgeMs: number;
  blockers: string[];
  warnings: string[];
  reasons: string[];
};

export type TaskPreflightDecision = {
  ok: boolean;
  mode: 'normal' | 'recovery';
  state: TaskPreflightState;
  error: string | null;
};

let state: TaskPreflightState = {
  marker: IVX_TASK_PREFLIGHT_GATE_MARKER,
  checkedAt: new Date(0).toISOString(),
  open: false,
  mainSha: null,
  productionSha: null,
  productionHealthy: false,
  queueHealthy: false,
  supervisorHealthy: false,
  queued: 0,
  inProgress: 0,
  oldestQueuedAgeMs: 0,
  blockers: ['preflight_not_initialized'],
  warnings: [],
  reasons: ['preflight_not_initialized'],
};

let refreshInFlight: Promise<TaskPreflightState> | null = null;

async function getGithubToken(): Promise<string> {
  return (
    process.env.GITHUB_TOKEN
    || process.env.IVX_GITHUB_TOKEN
    || (await getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN'))
    || ''
  ).trim();
}

async function gh<T>(path: string, token: string): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${GITHUB_API}${path}`, {
    headers,
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new Error(`GitHub ${path} -> HTTP ${response.status}`);
  return await response.json() as T;
}

function normalizeProductionSha(payload: any): string | null {
  for (const value of [payload?.commit, payload?.sha, payload?.version?.commit, payload?.git?.commit, payload?.sourceVersion]) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function ageMs(createdAt: string): number {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) ? Math.max(0, Date.now() - created) : 0;
}

export function updateTaskPreflightGate(next: {
  mainSha: string | null;
  productionSha: string | null;
  productionHealthy: boolean;
  queueHealthy: boolean;
  supervisorHealthy: boolean;
  queued: number;
  inProgress: number;
  oldestQueuedAgeMs: number;
  blockers?: string[];
  warnings?: string[];
}): TaskPreflightState {
  const blockers = [...(next.blockers || [])];
  const warnings = [...(next.warnings || [])];
  if (!next.mainSha) blockers.push('main_sha_unknown');
  if (!next.productionSha) blockers.push('production_sha_unknown');
  if (next.mainSha && next.productionSha && next.mainSha !== next.productionSha) blockers.push('production_not_on_main_sha');
  if (!next.productionHealthy) blockers.push('production_unhealthy');
  if (!next.supervisorHealthy) blockers.push('autonomous_supervisor_unhealthy');
  if (!next.queueHealthy) warnings.push('github_queue_unhealthy');
  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)];
  state = {
    marker: IVX_TASK_PREFLIGHT_GATE_MARKER,
    checkedAt: new Date().toISOString(),
    open: uniqueBlockers.length === 0,
    mainSha: next.mainSha,
    productionSha: next.productionSha,
    productionHealthy: next.productionHealthy,
    queueHealthy: next.queueHealthy,
    supervisorHealthy: next.supervisorHealthy,
    queued: next.queued,
    inProgress: next.inProgress,
    oldestQueuedAgeMs: next.oldestQueuedAgeMs,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    reasons: [...uniqueBlockers, ...uniqueWarnings],
  };
  return state;
}

async function refreshNow(): Promise<TaskPreflightState> {
  const token = await getGithubToken();
  try {
    const [ref, queuedData, runningData, healthResponse, versionResponse] = await Promise.all([
      gh<{ object: { sha: string } }>(`/repos/${REPO}/git/ref/heads/main`, token),
      gh<{ workflow_runs: Array<{ created_at: string }> }>(`/repos/${REPO}/actions/runs?branch=main&status=queued&per_page=100`, token),
      gh<{ total_count: number; workflow_runs: unknown[] }>(`/repos/${REPO}/actions/runs?branch=main&status=in_progress&per_page=100`, token),
      fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(8_000) }),
      fetch(`${API_BASE}/version`, { signal: AbortSignal.timeout(8_000) }),
    ]);

    const healthPayload = await healthResponse.json().catch(() => ({}));
    const versionPayload = await versionResponse.json().catch(() => ({}));
    const productionSha = normalizeProductionSha(versionPayload) || normalizeProductionSha(healthPayload);
    const queuedRuns = queuedData.workflow_runs || [];
    const queued = queuedRuns.length;
    const inProgress = Number(runningData.total_count || runningData.workflow_runs?.length || 0);
    const oldestQueuedAgeMs = queuedRuns.reduce((max, run) => Math.max(max, ageMs(run.created_at)), 0);
    const queueHealthy = queued < QUEUE_MAX && oldestQueuedAgeMs < QUEUE_MAX_AGE_MS;

    let supervisorHealthy = false;
    try {
      const supervisor = await import('./ivx-github-actions-external-supervisor');
      const snapshot = supervisor.getGitHubActionsExternalSupervisorStatus();
      supervisorHealthy = Boolean(snapshot && !snapshot.error);
    } catch {
      supervisorHealthy = false;
    }

    return updateTaskPreflightGate({
      mainSha: ref.object.sha || null,
      productionSha,
      productionHealthy: healthResponse.ok && Boolean((healthPayload as any)?.ok ?? true),
      queueHealthy,
      supervisorHealthy,
      queued,
      inProgress,
      oldestQueuedAgeMs,
    });
  } catch (error) {
    return updateTaskPreflightGate({
      mainSha: state.mainSha,
      productionSha: state.productionSha,
      productionHealthy: false,
      queueHealthy: false,
      supervisorHealthy: false,
      queued: state.queued,
      inProgress: state.inProgress,
      oldestQueuedAgeMs: state.oldestQueuedAgeMs,
      blockers: [`preflight_refresh_failed:${error instanceof Error ? error.message : String(error)}`],
    });
  }
}

export async function refreshTaskPreflightGate(force = false): Promise<TaskPreflightState> {
  const last = Date.parse(state.checkedAt);
  if (!force && Number.isFinite(last) && Date.now() - last < CACHE_MS) return state;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = refreshNow().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

export function getTaskPreflightGate(): TaskPreflightState {
  return state;
}

export function isRecoveryTask(taskName: string, workflow = ''): boolean {
  const value = `${taskName} ${workflow}`.toLowerCase();
  return /(deploy|repair|recovery|self[- ]heal|queue|certificate|certification|rollback|restore)/.test(value);
}

export async function requireTaskPreflightGate(taskName = 'autonomous_task', workflow = ''): Promise<TaskPreflightDecision> {
  const current = await refreshTaskPreflightGate();
  const recovery = isRecoveryTask(taskName, workflow);

  if (current.open) return { ok: true, mode: recovery ? 'recovery' : 'normal', state: current, error: null };

  // Recovery work must remain possible when production SHA parity is broken;
  // otherwise the preflight would deadlock the exact tasks needed to heal it.
  // It still fails closed when the supervisor itself is unavailable.
  if (recovery && current.supervisorHealthy) {
    return { ok: true, mode: 'recovery', state: current, error: null };
  }

  return {
    ok: false,
    mode: recovery ? 'recovery' : 'normal',
    state: current,
    error: `${taskName} blocked by IVX P0 preflight: ${current.blockers.join(', ') || 'unknown'}`,
  };
}
