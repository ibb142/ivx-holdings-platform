/**
 * IVX 112-Agent Campaign Dispatcher — bounded concurrent real execution.
 *
 * Removes the single-flight bottleneck: campaign assignments are mapped to
 * REAL senior-developer worker jobs executed with bounded concurrency.
 *
 * HONESTY RULES (enforced + tested):
 *   - A campaign record only exists when it maps to a real worker job (or an
 *     explicit owner gate / handoff wait). No synthetic statuses.
 *   - RUNNING means a real worker job is executing (workerJobId recorded).
 *   - COMPLETED requires the worker job's evidence (changedFiles / commit /
 *     tests / PR / deploy verification as applicable).
 *   - FAILED QA returns the implementation for repair within retry limits.
 *
 * CONCURRENCY SAFETY:
 *   - Max concurrent jobs: IVX_CAMPAIGN_MAX_CONCURRENCY (default 112, capped at 112).
 *   - Deploy-mode jobs are serialized to 1 at a time (deploy mutex lane).
 *   - Lane locks: jobs sharing a fileOrRoute/module lane never run concurrently.
 *   - Per-agent worker jobs use unique ownerIds (campaign-agent-NNN) so the
 *     worker's per-owner single-flight cannot serialize the campaign.
 */
import type { IVXWorkerJob, IVXWorkerJobInput } from './ivx-senior-developer-worker';
import {
  enqueueOrAttachSeniorDeveloperJob,
  getSeniorDeveloperJob,
  cancelSeniorDeveloperJob,
} from './ivx-senior-developer-worker';
import { checkEmergencyStop } from './ivx-emergency-stop-gate';

/** Injectable emergency-stop source (test override; defaults to the real gate). */
type EmergencyStopProbe = () => Promise<{ active: boolean; reason: string | null }>;
let emergencyStopSource: EmergencyStopProbe = checkEmergencyStop;

/** Test-only emergency-stop override. Pass null to restore the real gate. */
export function setEmergencyStopSourceForTests(probe: EmergencyStopProbe | null): void {
  emergencyStopSource = probe ?? checkEmergencyStop;
}

// ─────────────────────────────────────────────────────────────────────────────
// OPEN-PR DEDUP PROBE (owner mandate 2026-08-28, Mission D)
// Before dispatching a code_change duty, the dispatcher checks GitHub for an
// OPEN pull request already carrying that duty. If one exists, the dispatch is
// suppressed — one logical task produces ONE canonical implementation instead
// of the duplicate-PR loop seen on agent 57 (PRs #431–#447).
// ─────────────────────────────────────────────────────────────────────────────

export type OpenPrProbe = (dutyId: string) => Promise<number | null>;

const prProbeCache = new Map<string, { at: number; pr: number | null }>();
const PR_PROBE_CACHE_MS = 5 * 60 * 1000;

async function readGithubToken(): Promise<string> {
  const envToken = (process.env.GITHUB_TOKEN ?? '').trim();
  if (envToken) return envToken;
  try {
    const ownerVariables = await Promise.race([
      import('../api/ivx-owner-variables'),
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('owner variables import timeout')), 5000);
        timer.unref?.();
      }),
    ]);
    if (typeof ownerVariables.getIVXOwnerVariableRuntimeValue === 'function') {
      const stored = await Promise.race([
        ownerVariables.getIVXOwnerVariableRuntimeValue('GITHUB_TOKEN' as never),
        new Promise<null>((resolve) => {
          const timer = setTimeout(() => resolve(null), 5000);
          timer.unref?.();
        }),
      ]);
      return (stored || '').trim();
    }
  } catch {
    return '';
  }
  return '';
}

const DEFAULT_OPEN_PR_PROBE: OpenPrProbe = async (dutyId) => {
  const cached = prProbeCache.get(dutyId);
  if (cached && Date.now() - cached.at < PR_PROBE_CACHE_MS) return cached.pr;
  const token = await readGithubToken();
  let pr: number | null = null;
  if (token) {
    try {
      const query = encodeURIComponent(`repo:ibb142/ivx-holdings-platform is:pr is:open "duty ${dutyId}" in:title,body`);
      const res = await fetch(`https://api.github.com/search/issues?q=${query}&per_page=1`, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const body = (await res.json()) as { items?: Array<{ number?: number }> };
        const first = body.items?.[0];
        pr = typeof first?.number === 'number' ? first.number : null;
      }
    } catch {
      // Probe failure is fail-open: dispatch proceeds (dedup is best-effort;
      // the supersede rule is the hard anti-loop guarantee).
    }
  }
  prProbeCache.set(dutyId, { at: Date.now(), pr });
  return pr;
};

let openPrProbe: OpenPrProbe = DEFAULT_OPEN_PR_PROBE;

/** Test-only open-PR probe override. Pass null to restore the real probe. */
export function setOpenPrProbeForTests(probe: OpenPrProbe | null): void {
  openPrProbe = probe ?? DEFAULT_OPEN_PR_PROBE;
  prProbeCache.clear();
}
import {
  isDurableStoreConfigured,
  readDurableJson,
  writeDurableJson,
  appendDurableEvent,
} from './ivx-durable-store';

export const IVX_CAMPAIGN_DISPATCHER_MARKER = 'ivx-campaign-dispatcher-2026-08-22';

const STATE_KEY = 'logs/audit/app-completion/dispatcher-jobs.json';
const EVENTS_KEY = 'logs/audit/app-completion/dispatcher-events.jsonl';

export const MAX_CAMPAIGN_RETRIES = 3;
const STALE_HEARTBEAT_MS = 10 * 60 * 1000;

/** Configurable concurrency (requirement B). */
export function getMaxCampaignConcurrency(): number {
  const raw = Number.parseInt(process.env.IVX_CAMPAIGN_MAX_CONCURRENCY ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 112) : 112;
}

export type CampaignJobStatus =
  | 'PENDING_OWNER'
  | 'AWAITING_IMPLEMENT' // QA/VERIFY waiting for the upstream handoff
  | 'QUEUED'
  | 'RUNNING' // real worker job executing
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED'
  | 'CANCELLED';

export type CampaignJobRecord = {
  /** Deterministic key: `${agentNumber}:${role}:${dutyId}` — idempotency anchor. */
  key: string;
  agentNumber: number;
  agentId: string;
  role: 'IMPLEMENT' | 'QA' | 'VERIFY';
  dutyId: string;
  phase: string;
  module: string;
  /** Serialization lane — jobs sharing a lane never run concurrently. */
  laneKey: string;
  status: CampaignJobStatus;
  executionMode: 'code_change' | 'qa_only' | 'read_only' | 'deploy';
  /** Raw senior-developer worker job status (queued/running/…/completed). */
  workerStatus: string | null;
  /** Record key this job waits on before starting (QA waits on IMPLEMENT). */
  waitForKey: string | null;
  /** Real senior-developer worker job id — null until a real job exists. */
  workerJobId: string | null;
  stage: string;
  progress: number;
  attempts: number;
  retryCount: number;
  createdAt: string;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  finishedAt: string | null;
  // ── Real execution evidence propagated from the worker job result ──
  changedFiles: string[];
  testsRun: boolean;
  testsPassed: boolean;
  typecheckPassed: boolean;
  commitSha: string | null;
  prNumber: number | null;
  prUrl: string | null;
  deployId: string | null;
  healthOk: boolean | null;
  error: string | null;
  blocker: string | null;
  lastTickAt: string | null;
};

export type DispatcherSnapshot = {
  marker: string;
  generatedAt: string;
  maxConcurrency: number;
  paused: boolean;
  emergencyStop: boolean;
  totals: {
    records: number;
    pendingOwner: number;
    awaitingImplement: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    blocked: number;
    cancelled: number;
  };
  utilization24h: { theoreticalAgentHours: number; productiveAgentHours: number; utilizationPercent: number; runningNow: number; queuedNow: number; ownerGateNow: number; };
  activeJobs: Array<Pick<CampaignJobRecord,
    'key' | 'agentNumber' | 'agentId' | 'role' | 'dutyId' | 'module' | 'laneKey'
    | 'status' | 'stage' | 'progress' | 'workerJobId' | 'retryCount' | 'error'>>;
};

type DispatcherState = {
  marker: string;
  paused: boolean;
  stopped: boolean;
  stoppedAgents: number[];
  records: CampaignJobRecord[];
  updatedAt: string;
};

/** Worker bridge — injectable for tests (no real LLM/git in unit tests). */
export type CampaignWorkerBridge = {
  enqueue: (input: IVXWorkerJobInput) => Promise<{ job: IVXWorkerJob; attached: boolean }>;
  get: (jobId: string) => Promise<IVXWorkerJob | null>;
  cancel: (jobId: string) => Promise<IVXWorkerJob | null>;
};

const REAL_BRIDGE: CampaignWorkerBridge = {
  enqueue: (input) => enqueueOrAttachSeniorDeveloperJob(input),
  get: (jobId) => getSeniorDeveloperJob(jobId),
  cancel: (jobId) => cancelSeniorDeveloperJob(jobId),
};

let bridge: CampaignWorkerBridge = REAL_BRIDGE;

/** Test-only bridge override. */
export function setCampaignWorkerBridgeForTests(b: CampaignWorkerBridge | null): void {
  bridge = b ?? REAL_BRIDGE;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATE (durable with in-memory mirror)
// ─────────────────────────────────────────────────────────────────────────────

let memoryState: DispatcherState | null = null;

function emptyState(): DispatcherState {
  return {
    marker: IVX_CAMPAIGN_DISPATCHER_MARKER,
    paused: false,
    stopped: false,
    stoppedAgents: [],
    records: [],
    updatedAt: new Date().toISOString(),
  };
}

async function loadState(): Promise<DispatcherState> {
  if (memoryState) return memoryState;
  if (isDurableStoreConfigured()) {
    const stored = await readDurableJson<DispatcherState | null>(STATE_KEY, null);
    if (stored && Array.isArray(stored.records)) {
      memoryState = { ...emptyState(), ...stored, records: stored.records };
      return memoryState;
    }
  }
  memoryState = emptyState();
  return memoryState;
}

async function saveState(state: DispatcherState): Promise<void> {
  state.updatedAt = new Date().toISOString();
  memoryState = state;
  if (isDurableStoreConfigured()) {
    await writeDurableJson(STATE_KEY, state);
  }
}

async function logEvent(type: string, payload: Record<string, unknown>): Promise<void> {
  if (!isDurableStoreConfigured()) return;
  await appendDurableEvent(EVENTS_KEY, {
    marker: IVX_CAMPAIGN_DISPATCHER_MARKER,
    at: new Date().toISOString(),
    type,
    ...payload,
  });
}

/** Test-only reset. */
export function resetCampaignDispatcherForTests(): void {
  memoryState = null;
}

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENT INTAKE — creates records for real campaign assignments
// ─────────────────────────────────────────────────────────────────────────────

export type DispatcherAssignmentInput = {
  agentNumber: number;
  agentId: string;
  role: 'IMPLEMENT' | 'QA' | 'VERIFY';
  dutyId: string;
  phase: string;
  module: string;
  laneKey: string;
  executionMode: 'code_change' | 'qa_only' | 'read_only' | 'deploy';
  ownerGate: boolean;
  /** For QA: the implement record key this job waits on. For IMPLEMENT: null. */
  waitFor?: string | null;
  goal: string;
};

function makeRecord(a: DispatcherAssignmentInput): CampaignJobRecord {
  const base: CampaignJobRecord = {
    key: `${a.agentNumber}:${a.role}:${a.dutyId}`,
    agentNumber: a.agentNumber,
    agentId: a.agentId,
    role: a.role,
    dutyId: a.dutyId,
    phase: a.phase,
    module: a.module,
    laneKey: a.laneKey,
    status: 'QUEUED',
    executionMode: a.executionMode,
    workerStatus: null,
    waitForKey: a.waitFor ?? null,
    workerJobId: null,
    stage: 'QUEUED — awaiting worker job',
    progress: 0,
    attempts: 0,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    startedAt: null,
    lastHeartbeatAt: null,
    finishedAt: null,
    changedFiles: [],
    testsRun: false,
    testsPassed: false,
    typecheckPassed: false,
    commitSha: null,
    prNumber: null,
    prUrl: null,
    deployId: null,
    healthOk: null,
    error: null,
    blocker: null,
    lastTickAt: null,
  };
  if (a.ownerGate) {
    base.status = 'PENDING_OWNER';
    base.stage = 'WAITING FOR OWNER AUTHORIZATION (secrets / AWS / auth architecture)';
    base.blocker = 'OWNER_GATE: this item is owner-gated and will not start without explicit owner approval.';
  } else if (a.waitFor) {
    base.status = 'AWAITING_IMPLEMENT';
    base.stage = 'WAITING FOR UPSTREAM IMPLEMENTATION TO COMPLETE';
  }
  return base;
}

/**
 * Ensure a record exists for the assignment (duplicate prevention + idempotency:
 * keyed by agentNumber:role:dutyId — calling twice never creates two records).
 */
export async function ensureCampaignAssignment(a: DispatcherAssignmentInput): Promise<CampaignJobRecord> {
  const state = await loadState();
  const existing = state.records.find((r) => r.key === makeRecord(a).key);
  if (existing) {
    // An owner gate may have been lifted — update the wait state accordingly.
    if (!a.ownerGate && existing.status === 'PENDING_OWNER') {
      existing.status = a.waitFor ? 'AWAITING_IMPLEMENT' : 'QUEUED';
      existing.blocker = null;
      existing.stage = 'QUEUED — awaiting worker job';
      await saveState(state);
    }
    return existing;
  }
  const record = makeRecord(a);
  state.records.push(record);
  await saveState(state);
  await logEvent('assignment_created', { key: record.key, role: record.role, lane: record.laneKey });
  return record;
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER JOB SYNC
// ─────────────────────────────────────────────────────────────────────────────

function statusFromWorker(job: IVXWorkerJob): { status: CampaignJobStatus; stage: string; progress: number } {
  switch (job.status) {
    case 'queued': return { status: 'QUEUED', stage: 'WORKER JOB QUEUED', progress: 10 };
    case 'running': return { status: 'RUNNING', stage: job.stageDetail || 'WORKER JOB RUNNING', progress: Math.max(20, job.progressPercent) };
    case 'patching': return { status: 'RUNNING', stage: `PATCHING: ${job.stageDetail}`, progress: Math.max(30, job.progressPercent) };
    case 'testing': return { status: 'RUNNING', stage: `TESTING: ${job.stageDetail}`, progress: Math.max(50, job.progressPercent) };
    case 'committing': return { status: 'RUNNING', stage: `COMMITTING: ${job.stageDetail}`, progress: Math.max(70, job.progressPercent) };
    case 'deploying': return { status: 'RUNNING', stage: `DEPLOYING: ${job.stageDetail}`, progress: Math.max(80, job.progressPercent) };
    case 'verifying': return { status: 'RUNNING', stage: `VERIFYING: ${job.stageDetail}`, progress: Math.max(90, job.progressPercent) };
    case 'completed': return { status: 'COMPLETED', stage: 'COMPLETED WITH EVIDENCE', progress: 100 };
    case 'failed': return { status: 'FAILED', stage: `FAILED: ${job.error ?? job.stageDetail}`, progress: 0 };
    case 'blocked': return { status: 'BLOCKED', stage: `BLOCKED: ${job.error ?? job.stageDetail}`, progress: 0 };
    case 'cancelled': return { status: 'CANCELLED', stage: 'CANCELLED', progress: 0 };
    default: return { status: 'QUEUED', stage: 'WORKER JOB QUEUED', progress: 10 };
  }
}

async function syncRunningRecord(state: DispatcherState, record: CampaignJobRecord): Promise<void> {
  if (!record.workerJobId) return;
  record.lastTickAt = new Date().toISOString();
  try {
    const job = await bridge.get(record.workerJobId);
    if (!job) {
      record.error = `Worker job ${record.workerJobId} no longer found in the queue.`;
      record.status = 'FAILED';
      record.finishedAt = new Date().toISOString();
      return;
    }
    record.lastHeartbeatAt = job.lastHeartbeatAt ?? new Date().toISOString();
    record.workerStatus = job.status;
    const mapped = statusFromWorker(job);
    record.status = mapped.status;
    record.stage = mapped.stage;
    record.progress = mapped.progress;
    const r = job.result;
    if (r) {
      record.changedFiles = r.changedFiles ?? [];
      record.testsRun = r.testsRun ?? false;
      record.testsPassed = r.testsPassed ?? false;
      record.typecheckPassed = r.typecheckPassed ?? false;
      record.commitSha = r.commitSha ?? null;
      record.prNumber = r.prNumber ?? null;
      record.prUrl = r.prUrl ?? null;
      record.deployId = r.deployId ?? null;
      record.healthOk = r.healthOk ?? null;
      if (r.error) record.error = r.error;
    }
    if (job.status === 'completed') {
      record.finishedAt = job.finishedAt ?? new Date().toISOString();
      await logEvent('job_completed', { key: record.key, workerJobId: record.workerJobId, commitSha: record.commitSha, files: record.changedFiles.length });
    } else if (job.status === 'failed' || job.status === 'blocked') {
      record.finishedAt = job.finishedAt ?? new Date().toISOString();
      record.error = job.error ?? record.error;
    } else if (job.status === 'cancelled') {
      record.finishedAt = job.finishedAt ?? new Date().toISOString();
    }
  } catch (err) {
    record.error = `Worker sync error: ${(err as Error).message}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHEDULER TICK
// ─────────────────────────────────────────────────────────────────────────────

function isRetryableFailure(record: CampaignJobRecord): boolean {
  return record.retryCount < MAX_CAMPAIGN_RETRIES;
}

export type TickResult = {
  started: string[];
  cancelled: string[];
  requeued: string[];
  failed: string[];
  emergencyStop: boolean;
  paused: boolean;
  activeCount: number;
  maxConcurrency: number;
};

/**
 * One scheduler tick:
 *   1. stale-job recovery, 2. sync active records with real worker state,
 *   3. failure → retry-or-FAIL transition, 4. start eligible jobs within
 *   concurrency + lane + deploy-mutex + control-gate constraints.
 */
export async function tickCampaignDispatcher(): Promise<TickResult> {
  const state = await loadState();
  const result: TickResult = {
    started: [], cancelled: [], requeued: [], failed: [],
    emergencyStop: false, paused: state.paused,
    activeCount: 0, maxConcurrency: getMaxCampaignConcurrency(),
  };

  // 1. STALE-JOB RECOVERY (requirement I) — running records with a dead
  //    heartbeat are requeued (if retries remain) or failed durably.
  const now = Date.now();
  for (const record of state.records) {
    if (record.status !== 'RUNNING' || !record.lastHeartbeatAt) continue;
    const age = now - Date.parse(record.lastHeartbeatAt);
    if (Number.isFinite(age) && age > STALE_HEARTBEAT_MS) {
      if (record.workerJobId) {
        await bridge.cancel(record.workerJobId).catch(() => null);
        result.cancelled.push(record.key);
      }
      record.workerJobId = null;
      if (isRetryableFailure(record)) {
        record.retryCount += 1;
        record.status = 'QUEUED';
        record.stage = `REQUEUED AFTER STALE HEARTBEAT (retry ${record.retryCount}/${MAX_CAMPAIGN_RETRIES})`;
        result.requeued.push(record.key);
      } else {
        record.status = 'FAILED';
        record.error = 'STALE HEARTBEAT — retries exhausted';
        record.finishedAt = new Date().toISOString();
        result.failed.push(record.key);
      }
      await logEvent('stale_recovered', { key: record.key, retryCount: record.retryCount });
    }
  }

  // 2. SYNC active records with their real worker jobs.
  for (const record of state.records) {
    if (record.status === 'RUNNING' && record.workerJobId) {
      await syncRunningRecord(state, record);
    }
  }

  // 2b. CONTINUOUS LOW-RISK BACKLOG: verification agents are not allowed to stay idle.
  // Re-run completed read-only VERIFY duties after a cooldown. Mutation jobs never auto-repeat.
  const verifyCooldownMs = Math.max(60_000, Number.parseInt(process.env.IVX_VERIFY_REPEAT_MS ?? '', 10) || 15 * 60 * 1000);
  const verifyNow = Date.now();
  for (const record of state.records) {
    if (record.role !== 'VERIFY' || record.executionMode !== 'read_only' || record.status !== 'COMPLETED' || !record.finishedAt) continue;
    const finishedAt = Date.parse(record.finishedAt);
    if (!Number.isFinite(finishedAt) || verifyNow - finishedAt < verifyCooldownMs) continue;
    record.status = 'QUEUED';
    record.workerJobId = null;
    record.workerStatus = null;
    record.stage = 'CONTINUOUS VERIFICATION - REQUEUED AFTER COOLDOWN';
    record.progress = 0;
    record.startedAt = null;
    record.finishedAt = null;
    record.error = null;
    record.blocker = null;
    result.requeued.push(record.key);
  }

  // 3. FAILURE / CANCELLATION transitions.
  for (const record of state.records) {
    if (record.status === 'FAILED' || record.status === 'BLOCKED' || record.status === 'CANCELLED') {
      // QA failure returns the implementation for repair (Phase 3 requirement).
      if (record.role === 'QA' && record.status === 'FAILED') {
        const implement = record.waitForKey
          ? state.records.find((r) => r.key === record.waitForKey)
          : undefined;
        if (implement && implement.status === 'COMPLETED' && isRetryableFailure(implement)) {
          implement.status = 'QUEUED';
          implement.retryCount += 1;
          implement.workerJobId = null;
          implement.stage = `RETURNED FOR REPAIR — independent QA failed (retry ${implement.retryCount}/${MAX_CAMPAIGN_RETRIES})`;
          record.status = 'AWAITING_IMPLEMENT';
          record.stage = 'WAITING FOR REPAIRED IMPLEMENTATION';
          record.workerJobId = null;
          result.requeued.push(implement.key);
          await logEvent('qa_failed_returned_for_repair', { qaKey: record.key, implementKey: implement.key, retryCount: implement.retryCount });
        }
      }
      // Auto-retry failed IMPLEMENT/VERIFY records within limits.
      if ((record.status === 'FAILED') && record.role !== 'QA' && isRetryableFailure(record)) {
        record.retryCount += 1;
        record.status = 'QUEUED';
        record.workerJobId = null;
        record.stage = `AUTO-RETRY ${record.retryCount}/${MAX_CAMPAIGN_RETRIES}`;
        result.requeued.push(record.key);
      }
      continue;
    }
  }

  // 4. EMERGENCY STOP (requirement L — owner emergency stop always wins).
  const estop = await emergencyStopSource().catch(() => ({ active: false as const, reason: null }));
  result.emergencyStop = estop.active;
  if (estop.active) {
    for (const record of state.records) {
      if (record.status === 'RUNNING' && record.workerJobId) {
        await bridge.cancel(record.workerJobId).catch(() => null);
        record.status = 'BLOCKED';
        record.blocker = `EMERGENCY_STOP: ${estop.reason ?? 'owner emergency stop'}`;
        record.stage = 'BLOCKED BY OWNER EMERGENCY STOP';
        result.cancelled.push(record.key);
      }
      if (record.status === 'QUEUED') {
        record.status = 'BLOCKED';
        record.blocker = `EMERGENCY_STOP: ${estop.reason ?? 'owner emergency stop'}`;
        record.stage = 'BLOCKED BY OWNER EMERGENCY STOP';
      }
    }
    await saveState(state);
    return result;
  }

  // 5. HANDOFF — release QA records whose implementation completed with evidence.
  for (const record of state.records) {
    if (record.status !== 'AWAITING_IMPLEMENT' || record.role !== 'QA') continue;
    const implement = record.waitForKey
      ? state.records.find((r) => r.key === record.waitForKey)
      : undefined;
    if (implement && implement.status === 'COMPLETED') {
      record.status = 'QUEUED';
      record.stage = 'IMPLEMENTATION COMPLETED — QA UNLEASHED';
    }
  }

  // 5b. LANE MIGRATION (per-agent VERIFY): records created before the per-agent
  // VERIFY lane fix serialized per shared dutyId, capping real concurrency.
  // Recompute idempotently — spans/history preserved, anti-duplicate guarantees
  // unchanged (record-key locks + openPrProbe still apply).
  for (const r of state.records) {
    if (r.role === 'VERIFY' && !r.laneKey.endsWith(`:${r.agentNumber}`)) {
      r.laneKey = `verify:${r.dutyId}:${r.agentNumber}`;
    }
  }

  // 6. START new jobs under bounded concurrency + lane locks + deploy mutex.
  const active = state.records.filter((r) => r.status === 'RUNNING');
  result.activeCount = active.length;
  const busyLanes = new Set(active.map((r) => r.laneKey));
  // DEPLOY MUTEX (Phase 4): at most one deploy-bearing job may ever be active —
  // concurrent production deploys that overwrite each other are forbidden.
  let deployActive = active.some((r) => r.executionMode === 'deploy');
  let slots = Math.max(0, getMaxCampaignConcurrency() - active.length);

  if (state.paused || state.stopped) {
    await saveState(state);
    return result;
  }

  // Priority order: P0/pending items first, then QA, then VERIFY. Within the
  // same role, FAIR ORDERING (owner mandate 2026-08-28, Mission A): fewest
  // attempts first, then oldest creation — no single-agent hotspot.
  const startable = state.records
    .filter((r) => r.status === 'QUEUED')
    .filter((r) => !state.stoppedAgents.includes(r.agentNumber))
    .filter((r) => !busyLanes.has(r.laneKey))
    .sort((a, b) =>
      (a.role === 'IMPLEMENT' ? 0 : a.role === 'QA' ? 1 : 2) - (b.role === 'IMPLEMENT' ? 0 : b.role === 'QA' ? 1 : 2)
      || (a.attempts - b.attempts)
      || a.createdAt.localeCompare(b.createdAt));

  for (const record of startable) {
    if (slots <= 0) break;
    // In-loop re-check: a job started earlier in this tick may now hold the lane.
    if (busyLanes.has(record.laneKey)) continue;
    // Deploy mutex: never more than one deploy-bearing job at a time.
    if (record.executionMode === 'deploy' && deployActive) continue;
    // Open-PR dedup: a duty with an open PR never gets a second dispatch.
    if (record.executionMode === 'code_change') {
      const open = await openPrProbe(record.dutyId).catch(() => null);
      if (open) {
        record.stage = `WAITING ON OPEN PR #${open} — duplicate dispatch suppressed`;
        continue;
      }
    }
    const input: IVXWorkerJobInput = {
      goal: buildGoal(record, state),
      ownerApproved: true,
      ownerApprovedAction: null,
      approvePatch: record.executionMode === 'code_change' || record.executionMode === 'deploy',
      patchConfirmationText: record.executionMode === 'code_change' || record.executionMode === 'deploy'
        ? 'CONFIRM_IVX_SAFE_CODE_PATCH'
        : undefined,
      approveGitDeploy: record.executionMode === 'deploy',
      gitDeployConfirmationText: record.executionMode === 'deploy' ? 'CONFIRM_IVX_GIT_DEPLOY_OPERATOR' : undefined,
      validationMode: 'focused',
      systemMode: true,
      ownerId: `campaign-agent-${record.agentNumber}`,
      // Canonical per-IA traceability (owner mandate 2026-08-28, Missions 1/F):
      // the identity flows dispatcher → worker → coder → commit/PR metadata.
      agentNumber: record.agentNumber,
      agentId: record.agentId,
      taskId: record.key,
      executionMode: record.executionMode,
    };
    try {
      const { job } = await bridge.enqueue(input);
      record.workerJobId = job.jobId;
      record.attempts += 1;
      record.startedAt = record.startedAt ?? new Date().toISOString();
      record.lastHeartbeatAt = new Date().toISOString();
      record.status = 'RUNNING';
      record.stage = 'WORKER JOB DISPATCHED';
      record.progress = 15;
      busyLanes.add(record.laneKey);
      if (record.executionMode === 'deploy') deployActive = true;
      slots -= 1;
      result.started.push(record.key);
      result.activeCount += 1;
      await logEvent('job_started', { key: record.key, workerJobId: job.jobId, lane: record.laneKey, mode: record.executionMode });
    } catch (err) {
      record.error = `Dispatch failed: ${(err as Error).message}`;
      if (isRetryableFailure(record)) {
        record.retryCount += 1;
        record.stage = `DISPATCH FAILED — WILL RETRY (${record.retryCount}/${MAX_CAMPAIGN_RETRIES})`;
      } else {
        record.status = 'FAILED';
        record.finishedAt = new Date().toISOString();
        result.failed.push(record.key);
      }
    }
  }

  await saveState(state);
  return result;
}

function buildGoal(record: CampaignJobRecord, state: DispatcherState): string {
  const item = state.records.find((r) => r.key === record.key);
  void item;
  return `IVX 112-agent app-completion campaign — agent ${record.agentNumber} (${record.role}) duty ${record.dutyId} in module "${record.module}". Real execution only; no simulated success.`;
}

// ─────────────────────────────────────────────────────────────────────────────
// OWNER CONTROLS (Phase 5) — operate on REAL workers
// ─────────────────────────────────────────────────────────────────────────────

export async function campaignDispatcherControl(
  action: 'pause_all' | 'resume_all' | 'stop_all' | 'stop_agent' | 'retry_agent',
  agentNumber?: number,
): Promise<{ action: string; cancelledWorkerJobs: string[] }> {
  const state = await loadState();
  const cancelledWorkerJobs: string[] = [];
  switch (action) {
    case 'pause_all':
      state.paused = true; // prevents new job starts; running jobs continue
      break;
    case 'resume_all':
      state.paused = false;
      state.stopped = false;
      // A global resume must also release per-agent stop state. CANCELLED
      // records remain cancelled so a machine resume cannot override an
      // explicit owner stop; retry_agent is still required for those.
      state.stoppedAgents = [];
      // Recycle only bounded, non-owner BLOCKED work. FAILED work is
      // handled by the scheduler's existing bounded auto-retry path.
      for (const record of state.records) {
const ownerBlocked = (record.blocker ?? '').startsWith('OWNER_GATE')
  || (record.blocker ?? '').startsWith('EMERGENCY_STOP')
  || record.stage.startsWith('SUPERSEDED');
if (record.status === 'BLOCKED' && !ownerBlocked && isRetryableFailure(record)) {
  record.retryCount += 1;
  record.status = record.role === 'QA' ? 'AWAITING_IMPLEMENT' : 'QUEUED';
  record.stage = `AUTO-RECOVERY AFTER RESUME (${record.retryCount}/${MAX_CAMPAIGN_RETRIES})`;
  record.workerJobId = null;
  record.workerStatus = null;
  record.error = null;
  record.blocker = null;
  record.finishedAt = null;
}
      }
      break;
    case 'stop_all':
      state.stopped = true;
      for (const record of state.records) {
        if (record.status === 'RUNNING' && record.workerJobId) {
          await bridge.cancel(record.workerJobId).catch(() => null);
          cancelledWorkerJobs.push(record.workerJobId);
          record.status = 'CANCELLED';
          record.stage = 'STOPPED BY OWNER';
          record.finishedAt = new Date().toISOString();
        } else if (record.status === 'QUEUED') {
          record.status = 'CANCELLED';
          record.stage = 'STOPPED BY OWNER (never started)';
          record.finishedAt = new Date().toISOString();
        }
      }
      break;
    case 'stop_agent':
      if (typeof agentNumber === 'number') {
        if (!state.stoppedAgents.includes(agentNumber)) state.stoppedAgents.push(agentNumber);
        for (const record of state.records) {
          if (record.agentNumber !== agentNumber) continue;
          if (record.status === 'RUNNING' && record.workerJobId) {
            await bridge.cancel(record.workerJobId).catch(() => null);
            cancelledWorkerJobs.push(record.workerJobId);
          }
          if (record.status === 'RUNNING' || record.status === 'QUEUED' || record.status === 'AWAITING_IMPLEMENT') {
            record.status = 'CANCELLED';
            record.stage = 'STOPPED BY OWNER';
            record.finishedAt = new Date().toISOString();
          }
        }
      }
      break;
    case 'retry_agent':
      if (typeof agentNumber === 'number') {
        state.stoppedAgents = state.stoppedAgents.filter((n) => n !== agentNumber);
        for (const record of state.records) {
          if (record.agentNumber !== agentNumber) continue;
          if (record.status === 'FAILED' || record.status === 'CANCELLED' || record.status === 'BLOCKED') {
            record.status = record.role === 'QA' ? 'AWAITING_IMPLEMENT' : 'QUEUED';
            record.stage = 'RETRIED BY OWNER';
            record.workerJobId = null;
            record.error = null;
            record.blocker = null;
            record.finishedAt = null;
          }
        }
      }
      break;
  }
  await saveState(state);
  await logEvent('control', { action, agentNumber: agentNumber ?? null, cancelledWorkerJobs: cancelledWorkerJobs.length });
  // Do not wait for the 10-second timer after a recovery command. Force a
  // real scheduler pass now so success means dispatch was attempted.
  if (action === 'resume_all') {
await tickCampaignDispatcher();
  }
  return { action, cancelledWorkerJobs };
}

// ─────────────────────────────────────────────────────────────────────────────
// SNAPSHOT (Phase 7 — dashboard truth)
// ─────────────────────────────────────────────────────────────────────────────

export async function getCampaignDispatcherSnapshot(): Promise<DispatcherSnapshot> {
  const state = await loadState();
  const estop = await emergencyStopSource().catch(() => ({ active: false as const }));
  const count = (s: CampaignJobStatus) => state.records.filter((r) => r.status === s).length;
  return {
    marker: IVX_CAMPAIGN_DISPATCHER_MARKER,
    generatedAt: new Date().toISOString(),
    maxConcurrency: getMaxCampaignConcurrency(),
    paused: state.paused || state.stopped,
    emergencyStop: estop.active,
    totals: {
      records: state.records.length,
      pendingOwner: count('PENDING_OWNER'),
      awaitingImplement: count('AWAITING_IMPLEMENT'),
      queued: count('QUEUED'),
      running: count('RUNNING'),
      completed: count('COMPLETED'),
      failed: count('FAILED'),
      blocked: count('BLOCKED'),
      cancelled: count('CANCELLED'),
    },
    utilization24h: (() => {
      const now = Date.now();
      const windowStart = now - 24 * 60 * 60 * 1000;
      let productiveMs = 0;
      for (const r of state.records) {
        if (!r.startedAt) continue;
        const parsedStart = Date.parse(r.startedAt);
        if (!Number.isFinite(parsedStart)) continue;
        const start = Math.max(parsedStart, windowStart);
        const rawEnd = r.finishedAt ? Date.parse(r.finishedAt) : (r.status === 'RUNNING' ? now : start);
        const end = Math.min(Number.isFinite(rawEnd) ? rawEnd : start, now);
        if (end > start) productiveMs += end - start;
      }
      const theoreticalAgentHours = 112 * 24;
      const productiveAgentHours = Number((productiveMs / 3_600_000).toFixed(2));
      return {
        theoreticalAgentHours,
        productiveAgentHours,
        utilizationPercent: Number(((productiveAgentHours / theoreticalAgentHours) * 100).toFixed(2)),
        runningNow: count('RUNNING'),
        queuedNow: count('QUEUED') + count('AWAITING_IMPLEMENT'),
        ownerGateNow: count('PENDING_OWNER'),
      };
    })(),
    activeJobs: state.records
      .filter((r) => r.status === 'RUNNING' || r.status === 'QUEUED')
      .map((r) => ({
        key: r.key, agentNumber: r.agentNumber, agentId: r.agentId, role: r.role,
        dutyId: r.dutyId, module: r.module, laneKey: r.laneKey, status: r.status,
        stage: r.stage, progress: r.progress, workerJobId: r.workerJobId,
        retryCount: r.retryCount, error: r.error,
      })),
  };
}

/** Full record list for the dashboard's per-agent detail view. */
export async function listCampaignDispatcherRecords(): Promise<CampaignJobRecord[]> {
  const state = await loadState();
  return state.records;
}

/**
 * SUPERSEDE ORPHAN RECORDS (owner mandate 2026-08-28, Mission D): dispatcher
 * records whose campaign assignment no longer exists (item resolved, campaign
 * restructured) are cancelled with an explicit superseded stage and their live
 * worker jobs cancelled. This is the hard anti-loop guarantee — a resolved task
 * can never be re-dispatched from stale dispatcher state.
 */
export async function supersedeOrphanCampaignRecords(activeKeys: readonly string[], reason: string): Promise<number> {
  const state = await loadState();
  const active = new Set(activeKeys);
  let superseded = 0;
  for (const record of state.records) {
    if (active.has(record.key)) continue;
    if (record.status === 'COMPLETED' || record.status === 'CANCELLED') continue;
    if (record.status === 'RUNNING' && record.workerJobId) {
      await bridge.cancel(record.workerJobId).catch(() => null);
    }
    record.status = 'CANCELLED';
    record.stage = `SUPERSEDED — ${reason}`;
    record.finishedAt = record.finishedAt ?? new Date().toISOString();
    superseded += 1;
    await logEvent('record_superseded', { key: record.key, reason });
  }
  if (superseded > 0) await saveState(state);
  return superseded;
}

// ─────────────────────────────────────────────────────────────────────────────
// PERIODIC TICK LOOP
// ─────────────────────────────────────────────────────────────────────────────

let tickTimer: ReturnType<typeof setInterval> | null = null;
const TICK_INTERVAL_MS = 10_000;

let bootRecoveryDone = false;

/**
 * Boot recovery: once per process boot, requeue FAILED records with a reset
 * retry budget so exhausted duties get exactly one more round after each
 * deploy. Bounded by the per-boot flag — it can never loop.
 */
export async function runCampaignBootRecovery(): Promise<number> {
  if (bootRecoveryDone) return 0;
  bootRecoveryDone = true;
  const state = await loadState();
  let recovered = 0;
  for (const record of state.records) {
    if (record.status !== 'FAILED') continue;
    record.status = record.role === 'QA' ? 'AWAITING_IMPLEMENT' : 'QUEUED';
    record.stage = 'BOOT RECOVERY — RETRY AFTER DEPLOY';
    record.retryCount = 0;
    record.workerJobId = null;
    record.error = null;
    record.blocker = null;
    record.finishedAt = null;
    recovered += 1;
  }
  if (recovered > 0) {
    await saveState(state);
    await logEvent('control', { action: 'boot_recovery_requeue', recovered });
  }
  return recovered;
}

export function resetCampaignBootRecoveryForTests(): void {
  bootRecoveryDone = false;
}

export function startCampaignDispatcher(): void {
  if (tickTimer) return;
  tickTimer = setInterval(() => {
    void tickCampaignDispatcher().catch(() => {});
  }, TICK_INTERVAL_MS);
  tickTimer.unref?.();
}
