import { getIVXOwnerVariableRuntimeValue } from '../api/ivx-owner-variables';
import { runGlobalCertificationSupervision } from './ivx-global-certification-supervisor';

export const IVX_GITHUB_ACTIONS_EXTERNAL_SUPERVISOR_MARKER = 'ivx-github-actions-external-supervisor-v3-organism-2026-08-30';
export const IVX_AUTONOMOUS_ORGANISM_MARKER = 'ivx-autonomous-organism-v1-2026-08-30';

const REPO = process.env.IVX_GITHUB_REPO || 'ibb142/ivx-holdings-platform';
const API = 'https://api.github.com';
const API_BASE = (process.env.IVX_API_BASE || 'https://api.ivxholding.com').replace(/\/$/, '');
const INTERVAL_MS = 60_000;
const QUEUE_STORM_THRESHOLD = 12;
const MAX_QUEUE_AGE_MS = 5 * 60_000;
const MAX_CURRENT_SHA_PUSH_RUNS = 6;
const EXTERNAL_TARGETS = [
  'https://ivxholding.com',
  'https://www.ivxholding.com',
  'https://chat.ivxholding.com',
  `${API_BASE}/health`,
  `${API_BASE}/version`,
];

const CRITICAL_WORKFLOWS = new Set([
  'IVX Dashboard + IA Chat End-to-End Certificate',
  'IVX Owner Sign In + Home Android Certificate',
  'IVX E2E Acceptance Pipeline',
  'IVX QA Suite',
  'IVX CI',
  'IVX 10/10 Full Certification',
]);

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

type Probe = {
  target: string;
  ok: boolean;
  status: number | null;
  latencyMs: number;
  error: string | null;
};

export type OrganismSnapshot = {
  marker: typeof IVX_AUTONOMOUS_ORGANISM_MARKER;
  overall: 'GREEN' | 'YELLOW' | 'RED';
  brain: {
    ok: boolean;
    mainSha: string | null;
    certification: string | null;
    error: string | null;
  };
  heart: {
    ok: boolean;
    health: Probe;
    version: Probe;
  };
  circulation: {
    ok: boolean;
    agents: Probe;
    dashboard: Probe;
  };
  senses: {
    ok: boolean;
    targets: Probe[];
  };
  immune: {
    ok: boolean;
    queueStorm: boolean;
    queued: number;
    inProgress: number;
    cancelledRunIds: number[];
    error: string | null;
  };
};

export type QueueSnapshot = {
  checkedAt: string;
  mainSha: string | null;
  queued: number;
  inProgress: number;
  oldestQueuedAgeMs: number;
  currentShaPushQueued: number;
  storm: boolean;
  fanoutExceeded: boolean;
  cancelledRunIds: number[];
  preservedCriticalRunIds: number[];
  tokenAvailable: boolean;
  error: string | null;
  organism: OrganismSnapshot | null;
};

let lastSnapshot: QueueSnapshot | null = null;
let running = false;
let cycleRunning = false;
let timer: ReturnType<typeof setInterval> | null = null;

async function getToken(): Promise<string> {
  return (
    process.env.GITHUB_TOKEN
    || process.env.IVX_GITHUB_TOKEN
    || (await getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN'))
    || ''
  ).trim();
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
  return await response.json() as T;
}

async function probe(target: string): Promise<Probe> {
  const started = Date.now();
  try {
    const response = await fetch(target, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': 'IVX-Autonomous-Organism/1.0' },
    });
    return {
      target,
      ok: response.ok,
      status: response.status,
      latencyMs: Date.now() - started,
      error: null,
    };
  } catch (error) {
    return {
      target,
      ok: false,
      status: null,
      latencyMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function ageMs(createdAt: string): number {
  const created = Date.parse(createdAt);
  return Number.isFinite(created) ? Math.max(0, Date.now() - created) : 0;
}

function isCriticalCurrent(run: WorkflowRun, mainSha: string | null): boolean {
  return Boolean(
    mainSha
    && run.head_branch === 'main'
    && run.head_sha === mainSha
    && CRITICAL_WORKFLOWS.has(run.name),
  );
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

function newestFirst(runs: WorkflowRun[]): WorkflowRun[] {
  return [...runs].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
}

async function buildOrganismSnapshot(input: {
  mainSha: string | null;
  queued: number;
  inProgress: number;
  storm: boolean;
  cancelledRunIds: number[];
  queueError: string | null;
}): Promise<OrganismSnapshot> {
  const external = await Promise.all(EXTERNAL_TARGETS.map(probe));
  const health = external.find((item) => item.target === `${API_BASE}/health`) || await probe(`${API_BASE}/health`);
  const version = external.find((item) => item.target === `${API_BASE}/version`) || await probe(`${API_BASE}/version`);
  const [agents, dashboard] = await Promise.all([
    probe(`${API_BASE}/api/ivx/agents`),
    probe(`${API_BASE}/api/ivx/agents/app-completion/dashboard`),
  ]);

  let certification: string | null = null;
  let brainError: string | null = null;
  if (input.mainSha) {
    try {
      certification = (await runGlobalCertificationSupervision(input.mainSha)).status;
    } catch (error) {
      brainError = error instanceof Error ? error.message : String(error);
    }
  } else {
    brainError = 'Unable to resolve main SHA.';
  }

  const brainOk = Boolean(input.mainSha && certification && certification !== 'RED' && !brainError);
  const heartOk = health.ok && version.ok;
  const circulationOk = agents.ok && dashboard.ok;
  const sensesOk = external.every((item) => item.ok);
  const immuneOk = !input.queueError && !input.storm;
  const overall: OrganismSnapshot['overall'] =
    (!heartOk || !circulationOk || certification === 'RED')
      ? 'RED'
      : (!brainOk || !sensesOk || !immuneOk)
        ? 'YELLOW'
        : 'GREEN';

  return {
    marker: IVX_AUTONOMOUS_ORGANISM_MARKER,
    overall,
    brain: { ok: brainOk, mainSha: input.mainSha, certification, error: brainError },
    heart: { ok: heartOk, health, version },
    circulation: { ok: circulationOk, agents, dashboard },
    senses: { ok: sensesOk, targets: external },
    immune: {
      ok: immuneOk,
      queueStorm: input.storm,
      queued: input.queued,
      inProgress: input.inProgress,
      cancelledRunIds: input.cancelledRunIds,
      error: input.queueError,
    },
  };
}

export async function runGitHubActionsExternalSupervision(): Promise<QueueSnapshot> {
  const token = await getToken();
  const cancelledRunIds: number[] = [];
  const preservedCriticalRunIds: number[] = [];
  const checkedAt = new Date().toISOString();

  try {
    const ref = await gh<{ object: { sha: string } }>(`/repos/${REPO}/git/ref/heads/main`, token);
    const mainSha = ref.object.sha || null;
    const queuedData = await gh<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${REPO}/actions/runs?branch=main&status=queued&per_page=100`,
      token,
    );
    const runningData = await gh<{ workflow_runs: WorkflowRun[] }>(
      `/repos/${REPO}/actions/runs?branch=main&status=in_progress&per_page=100`,
      token,
    );
    const queued = queuedData.workflow_runs || [];
    const inProgress = runningData.workflow_runs || [];
    const oldestQueuedAgeMs = queued.reduce((max, run) => Math.max(max, ageMs(run.created_at)), 0);
    const currentShaPushRuns = queued.filter(
      (run) => run.event === 'push' && run.head_branch === 'main' && run.head_sha === mainSha,
    );
    const fanoutExceeded = currentShaPushRuns.length > MAX_CURRENT_SHA_PUSH_RUNS;
    const storm = queued.length >= QUEUE_STORM_THRESHOLD
      || oldestQueuedAgeMs >= MAX_QUEUE_AGE_MS
      || fanoutExceeded;

    if (storm) {
      const preservedNames = new Set<string>();
      for (const run of newestFirst(queued)) {
        if (isCriticalCurrent(run, mainSha) && !preservedNames.has(run.name)) {
          preservedNames.add(run.name);
          preservedCriticalRunIds.push(run.id);
          continue;
        }
        if (!isCriticalCurrent(run, mainSha) && await cancelRun(run.id, token)) {
          cancelledRunIds.push(run.id);
        }
      }

      for (const run of inProgress) {
        if (
          mainSha
          && run.head_sha !== mainSha
          && !CRITICAL_WORKFLOWS.has(run.name)
          && await cancelRun(run.id, token)
        ) {
          cancelledRunIds.push(run.id);
        }
      }
    }

    const organism = await buildOrganismSnapshot({
      mainSha,
      queued: queued.length,
      inProgress: inProgress.length,
      storm,
      cancelledRunIds,
      queueError: null,
    });

    lastSnapshot = {
      checkedAt,
      mainSha,
      queued: queued.length,
      inProgress: inProgress.length,
      oldestQueuedAgeMs,
      currentShaPushQueued: currentShaPushRuns.length,
      storm,
      fanoutExceeded,
      cancelledRunIds,
      preservedCriticalRunIds,
      tokenAvailable: Boolean(token),
      error: null,
      organism,
    };

    console.log('[IVX Autonomous Organism]', {
      overall: organism.overall,
      mainSha,
      certification: organism.brain.certification,
      heart: organism.heart.ok,
      circulation: organism.circulation.ok,
      senses: organism.senses.ok,
      immune: organism.immune.ok,
      queueStorm: storm,
      queued: queued.length,
      inProgress: inProgress.length,
      cancelled: cancelledRunIds.length,
    });

    return lastSnapshot;
  } catch (error) {
    const queueError = error instanceof Error ? error.message : String(error);
    const organism = await buildOrganismSnapshot({
      mainSha: null,
      queued: 0,
      inProgress: 0,
      storm: false,
      cancelledRunIds,
      queueError,
    }).catch(() => null);

    lastSnapshot = {
      checkedAt,
      mainSha: null,
      queued: 0,
      inProgress: 0,
      oldestQueuedAgeMs: 0,
      currentShaPushQueued: 0,
      storm: false,
      fanoutExceeded: false,
      cancelledRunIds,
      preservedCriticalRunIds,
      tokenAvailable: Boolean(token),
      error: queueError,
      organism,
    };
    console.warn('[IVX Autonomous Organism] cycle failed', lastSnapshot);
    return lastSnapshot;
  }
}

export function getGitHubActionsExternalSupervisorStatus(): QueueSnapshot | null {
  return lastSnapshot;
}

export function getAutonomousOrganismStatus(): OrganismSnapshot | null {
  return lastSnapshot?.organism || null;
}

export function startGitHubActionsExternalSupervisor(): void {
  if (running) return;
  running = true;

  const execute = async (): Promise<void> => {
    if (cycleRunning) return;
    cycleRunning = true;
    try {
      await runGitHubActionsExternalSupervision();
    } catch (error) {
      console.warn('[IVX Autonomous Organism] unhandled cycle error', {
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      cycleRunning = false;
    }
  };

  const boot = setTimeout(() => { void execute(); }, 15_000);
  boot.unref?.();
  timer = setInterval(() => { void execute(); }, INTERVAL_MS);
  timer.unref?.();
}

export function stopGitHubActionsExternalSupervisorForTests(): void {
  running = false;
  cycleRunning = false;
  if (timer) clearInterval(timer);
  timer = null;
}
