import { getIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';

export const IVX_GITHUB_ACTIONS_EXTERNAL_SUPERVISOR_MARKER =
  'ivx-github-actions-external-supervisor-v1-2026-08-30';

const REPO = process.env.IVX_GITHUB_REPO || 'ibb142/ivx-holdings-platform';
const API = 'https://api.github.com';
const INTERVAL_MS = 60_000;
const QUEUE_STORM_THRESHOLD = 12;
const MAX_QUEUE_AGE_MS = 5 * 60_000;

const CRITICAL_WORKFLOWS = new Set([
  'IVX Dashboard + IA Chat End-to-End Certificate',
  'IVX Owner Sign In + Home Android Certificate',
  'IVX E2E Acceptance Pipeline',
  'IVX QA Suite',
  'IVX CI',
  'IVX 10/10 Full Certification',
]);

const EXPENDABLE_BACKGROUND_PATTERNS = [
  /watchdog/i,
  /radar/i,
  /early warning/i,
  /utilization/i,
  /no[- ]idle/i,
  /production enforcer/i,
  /timer/i,
  /patrol/i,
  /discovery/i,
  /self[- ]heal/i,
];

type WorkflowRun = {
  id: number;
  name: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  head_branch: string | null;
  created_at: string;
  updated_at: string;
};

type QueueSnapshot = {
  checkedAt: string;
  mainSha: string | null;
  queued: number;
  inProgress: number;
  oldestQueuedAgeMs: number;
  storm: boolean;
  cancelledRunIds: number[];
  preservedCriticalRunIds: number[];
  tokenAvailable: boolean;
  error: string | null;
};

let lastSnapshot: QueueSnapshot | null = null;
let running = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function getToken(): Promise<string> {
  return (process.env.GITHUB_TOKEN || process.env.IVX_GITHUB_TOKEN || (await getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN')) || '').trim();
}

async function gh<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`GitHub ${init.method || 'GET'} ${path} -> HTTP ${response.status}`);
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function ageMs(createdAt: string): number {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) ? Math.max(0, Date.now() - created) : 0;
}

function isExpendable(run: WorkflowRun, mainSha: string | null): boolean {
  if (CRITICAL_WORKFLOWS.has(run.name)) return false;
  if (run.head_branch !== 'main') return true;
  if (mainSha && run.head_sha !== mainSha) return true;
  if (run.event === 'schedule') return true;
  return EXPENDABLE_BACKGROUND_PATTERNS.some((pattern) => pattern.test(run.name));
}

async function cancelRun(runId: number, token: string): Promise<boolean> {
  if (!token) return false;
  try {
    await gh<void>(`/repos/${REPO}/actions/runs/${runId}/cancel`, token, { method: 'POST' });
    return true;
  } catch (error) {
    console.warn('[IVX Actions External Supervisor] cancel failed', {
      runId,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function runGitHubActionsExternalSupervision(): Promise<QueueSnapshot> {
  const token = await getToken();
  const cancelledRunIds: number[] = [];
  const preservedCriticalRunIds: number[] = [];
  try {
    const ref = await gh<{ object: { sha: string } }>(`/repos/${REPO}/git/ref/heads/main`, token);
    const mainSha = ref.object.sha || null;
    const queuedData = await gh<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${REPO}/actions/runs?branch=main&status=queued&per_page=100`, token,
    );
    const runningData = await gh<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${REPO}/actions/runs?branch=main&status=in_progress&per_page=100`, token,
    );
    const queued = queuedData.workflow_runs || [];
    const inProgress = runningData.workflow_runs || [];
    const oldestQueuedAgeMs = queued.reduce((max, run) => Math.max(max, ageMs(run.created_at)), 0);
    const storm = queued.length >= QUEUE_STORM_THRESHOLD || oldestQueuedAgeMs >= MAX_QUEUE_AGE_MS;

    if (storm) {
      for (const run of queued) {
        if (CRITICAL_WORKFLOWS.has(run.name) && (!mainSha || run.head_sha === mainSha)) {
          preservedCriticalRunIds.push(run.id);
          continue;
        }
        if (isExpendable(run, mainSha) && await cancelRun(run.id, token)) {
          cancelledRunIds.push(run.id);
        }
      }

      // A stale in-progress job on an old SHA can monopolize the only runner.
      // Cancel only when it is not critical and no longer matches current main.
      for (const run of inProgress) {
        if (mainSha && run.head_sha !== mainSha && isExpendable(run, mainSha)) {
          if (await cancelRun(run.id, token)) cancelledRunIds.push(run.id);
        }
      }
    }

    lastSnapshot = {
      checkedAt: new Date().toISOString(),
      mainSha,
      queued: queued.length,
      inProgress: inProgress.length,
      oldestQueuedAgeMs,
      storm,
      cancelledRunIds,
      preservedCriticalRunIds,
      tokenAvailable: Boolean(token),
      error: null,
    };
    console.log('[IVX Actions External Supervisor]', lastSnapshot);
    return lastSnapshot;
  } catch (error) {
    lastSnapshot = {
      checkedAt: new Date().toISOString(),
      mainSha: null,
      queued: 0,
      inProgress: 0,
      oldestQueuedAgeMs: 0,
      storm: false,
      cancelledRunIds,
      preservedCriticalRunIds,
      tokenAvailable: Boolean(token),
      error: error instanceof Error ? error.message : String(error),
    };
    console.warn('[IVX Actions External Supervisor] cycle failed', lastSnapshot);
    return lastSnapshot;
  }
}

export function getGitHubActionsExternalSupervisorStatus(): QueueSnapshot | null {
  return lastSnapshot;
}

export function startGitHubActionsExternalSupervisor(): void {
  if (running) return;
  running = true;
  const boot = setTimeout(() => { void runGitHubActionsExternalSupervision(); }, 15_000);
  boot.unref?.();
  timer = setInterval(() => { void runGitHubActionsExternalSupervision(); }, INTERVAL_MS);
  timer.unref?.();
}

export function stopGitHubActionsExternalSupervisorForTests(): void {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}
