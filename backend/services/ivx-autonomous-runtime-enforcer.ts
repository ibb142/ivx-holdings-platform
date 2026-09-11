import { RefillBackoff } from './ivx-refill-backoff';
import { createEmptyClaimCooldown } from './ivx-empty-claim-cooldown';
import { ensureTechnicalScheduleSeeded } from './ivx-technical-schedule';
import { createRefillWakeup } from './ivx-refill-wakeup';
import { refillFleetBatches, preparedContinuityAllowed, POSTGRES_FLEET_CLAIM_BATCH_SIZE } from './ivx-fleet-refill-batches';
import { enforceAutonomous112RuntimeTruth, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS } from './ivx-autonomous-truth-control';
import { getAllExecutionStates, updateExecutionState } from './ivx-agent-runtime';
import { runRealEngineeringCycle, type RealEngineeringCycleResult } from './ivx-agent-real-engineering-cycle';
import {
  getAllTasks,
  heartbeatTasksBatch,
  leaseNextTasksBatch,
  startLeasedTasksBatch,
  releaseLease,
  type Task,
} from './ivx-autonomous-task-engine';
import {
  ensureAutonomousManagerBacklog,
  getAutonomousWorkManagerStatus,
} from './ivx-autonomous-work-manager';
import {
  getAutonomousDecisionQualityStatus,
  runAutonomousDecisionQualityLoop,
} from './ivx-autonomous-decision-quality';
import {
  getAutonomousSemantic360Status,
  runAutonomousSemantic360,
} from './ivx-autonomous-semantic-360';
import { autonomousRuntimeEnforcerEnabled } from './ivx-autonomous-control-policy';
import {
  postgresAtomicQueueSelected,
  autonomousWorkerInstanceId,
  readPostgresFleetLeaseRows,
  releasePostgresWorkerInstanceTasks,
} from './ivx-postgres-autonomous-task-store';
import {
  ensureLandingP0BacklogSeeded,
  ensureLandingP0PatrolSeeded,
  isLandingPatrolTask,
  isLandingP0MissionActive,
  LANDING_P0_PATROL_PREFIX,
  LANDING_P0_PREFIX,
  LANDING_P0_REPAIR_PREFIX,
} from './ivx-landing-p0-backlog';
import {
  getLandingPatrolIntervalMs,
  getLandingPatrolLiveStates,
  IVX_LANDING_CONTINUOUS_PATROL_MARKER,
  runLandingPatrolSession,
} from './ivx-landing-continuous-patrol';

export const IVX_AUTONOMOUS_RUNTIME_ENFORCER_MARKER = 'ivx-autonomous-runtime-enforcer-2026-09-08-hard-112-v6';
export const IVX_AUTONOMOUS_REFILL_INTERVAL_MS = 5_000;
export const IVX_AUTONOMOUS_FLEET_SIZE = 112;

let timer: ReturnType<typeof setInterval> | null = null;
let bootKick: ReturnType<typeof setTimeout> | null = null;
let stopping = false;
let leaseMirrorTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let refillTimer: ReturnType<typeof setInterval> | null = null;
let stopInFlight: Promise<number> | null = null;
let enforcerRunInFlight: Promise<void> | null = null;
let leaseMirrorInFlight: Promise<void> | null = null;
let heartbeatRefreshInFlight: Promise<void> | null = null;
let refillInFlight: Promise<void> | null = null;
const refillBackoff = new RefillBackoff();
const emptyClaimCooldown = createEmptyClaimCooldown(IVX_AUTONOMOUS_REFILL_INTERVAL_MS);
let startedAt: string | null = null;
let lastRunAt: string | null = null;
let lastOk: boolean | null = null;
let lastRecovered: number[] = [];
let lastError: string | null = null;
let continuityEnabled = false;
let landingMissionActive = false;
let refillStarted = 0;
let refillCompleted = 0;
let refillObserved = 0;
let refillFailed = 0;
let refillIdle = 0;
let refillBlocked = 0;
let lastIdleLogAt = 0;
let lastHeartbeatRefreshAt: string | null = null;
let lastHeartbeatRefreshCount = 0;
let lastLeaseMirrorAt: string | null = null;
let lastLeaseMirrorCount = 0;
const continuityRuns = new Map<string, Promise<void>>();
const mirroredAgentIds = new Set<string>();

const ACTIVE_TASK_STATES = new Set([
  'LEASED', 'RUNNING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS',
  'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING',
]);

export type ContinuityOutcome = 'completed' | 'observed' | 'blocked' | 'idle' | 'failed';
type AgentContinuityRecord = { outcome: ContinuityOutcome; action: string; taskId: string | null; module: string | null; productiveMinutes: number; evidenceIds: string[]; at: string; error: string | null };
const lastOutcomeByAgent = new Map<number, AgentContinuityRecord>();
const refillWakeup = createRefillWakeup({
  now: Date.now,
  schedule: (callback, delay) => { const timer = setTimeout(callback, delay); timer.unref?.(); return timer; },
  cancel: clearTimeout,
  run: () => { if (!stopping && continuityEnabled) void refillAllAvailableAgents(); },
});

function refillDelayMs(outcome: ContinuityOutcome): number {
  if (outcome === 'failed') return 30_000;
  if (outcome === 'idle' || outcome === 'observed') {
    const idle = Number.parseInt(process.env.IVX_CONTINUITY_IDLE_DELAY_MS ?? '', 10);
    return Number.isFinite(idle) && idle >= 1_000 ? Math.min(idle, 60_000) : 15_000;
  }
  const configured = Number.parseInt(process.env.IVX_CONTINUITY_REFILL_DELAY_MS ?? '', 10);
  return Number.isFinite(configured) && configured >= 100 ? Math.min(configured, 30_000) : 250;
}

/**
 * The IVX production fleet is exactly 112 logical execution lanes. Capacity is
 * a runtime invariant, not a tuning default. An absent, malformed, or lower
 * environment value must never silently downgrade the fleet to 12 (or any other
 * partial count). Pause/stop/disable controls remain the explicit mechanisms for
 * intentionally reducing work.
 */
export function getContinuityMaxConcurrency(): number {
  const configured = Number.parseInt(process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY ?? '', 10);
  return configured === IVX_AUTONOMOUS_FLEET_SIZE ? configured : IVX_AUTONOMOUS_FLEET_SIZE;
}

export function classifyContinuityResult(result: { ok: boolean; action: string; taskId: string | null; states: string[]; evidenceIds?: string[] }): ContinuityOutcome {
  if (!result.ok) return 'failed';
  if (result.action === 'NO_TASK_AVAILABLE') return 'idle';
  if (result.action === 'PATROL_SESSION_ENDED') {
    if (!result.taskId) return 'failed';
    return result.evidenceIds?.some(id => typeof id === 'string' && id.trim()) ? 'observed' : 'idle';
  }
  if (result.action === 'PATROL_SESSION_LOST') return 'failed';
  if (result.states.includes('ALREADY_VERIFIED')) return 'idle';
  if (!result.taskId) return 'failed';
  if (result.action === 'TASK_BLOCKED') return 'blocked';
  if (result.action === 'TASK_COMPLETED' || result.action === 'TASK_OWNER_GATE') return 'completed';
  return 'failed';
}

let ownerAllowedAgentNumbers = new Set<number>();

function ownerAllowsAgent(agentId: string): boolean {
  const state = getAllExecutionStates().find((row) => row.agentId === agentId);
  return Boolean(state && ownerAllowedAgentNumbers.has(state.agentNumber));
}

function canRunContinuity(agentId: string): boolean {
  if (!continuityEnabled || !ownerAllowsAgent(agentId) || continuityRuns.has(agentId)) return false;
  if (continuityRuns.size >= getContinuityMaxConcurrency()) return false;
  const state = getAllExecutionStates().find((row) => row.agentId === agentId);
  if (!state) return false;
  return !state.pauseState
    && !state.disabledState
    && state.health !== 'failed'
    && state.availability === 'available'
    && !state.activeTaskId;
}

function canStartPreparedContinuity(agentId: string): boolean {
  return preparedContinuityAllowed({
    enabled: continuityEnabled && ownerAllowsAgent(agentId), stopping,
    hasLocalRun: continuityRuns.has(agentId),
    atCapacity: continuityRuns.size >= getContinuityMaxConcurrency(),
    state: getAllExecutionStates().find((row) => row.agentId === agentId),
  });
}

function currentSourceSha(): string {
  return process.env.RENDER_GIT_COMMIT
    ?? process.env.GITHUB_SHA
    ?? process.env.COMMIT_SHA
    ?? 'runtime-unknown-sha';
}

/**
 * Mirror only REAL lease-bearing task-engine work into the in-memory agent
 * runtime. This closes the truth bridge without fabricating busy status:
 * continuity promise count is ignored; an agent becomes busy only when the
 * durable task engine proves an active task with a real leaseHolder.
 *
 * One durable read updates all 112 in-memory heartbeats, avoiding 112 Supabase
 * writes merely to prove liveness. Durable task heartbeats are still renewed
 * separately so leases themselves remain valid.
 */
async function syncRuntimeWorkingFromTaskLeases(): Promise<number> {
  if (!continuityEnabled) return 0;
  const tasks = postgresAtomicQueueSelected()
    ? await readPostgresFleetLeaseRows()
    : await getAllTasks();
  const states = getAllExecutionStates();
  const stateByNumber = new Map(states.map((state) => [state.agentNumber, state]));
  const stateById = new Map(states.map((state) => [state.agentId, state]));
  const activeByAgent = new Map<number, string>();
  const nowMs = Date.now();

  for (const task of tasks) {
    if (!task.leaseHolder || !ACTIVE_TASK_STATES.has(task.state)) continue;
    const heartbeatMs = Date.parse(task.lastHeartbeatAt ?? '');
    const expiryMs = Date.parse(task.leaseExpiresAt ?? '');
    if (!Number.isFinite(heartbeatMs) || heartbeatMs < nowMs - 60_000) continue;
    if (!Number.isFinite(expiryMs) || expiryMs <= nowMs) continue;
    const leasedAgentId = task.leaseHolder.startsWith('agent:') ? task.leaseHolder.slice('agent:'.length) : null;
    const leasedAgentNumber = leasedAgentId ? stateById.get(leasedAgentId)?.agentNumber ?? null : null;
    const agentNumber = leasedAgentNumber ?? task.assignedAgentNumber;
    if (agentNumber == null) continue;
    if (!activeByAgent.has(agentNumber)) activeByAgent.set(agentNumber, task.taskId);
  }

  const nowMirrored = new Set<string>();
  for (const [agentNumber, taskId] of activeByAgent.entries()) {
    const state = stateByNumber.get(agentNumber);
    if (!state || state.pauseState || state.disabledState || state.health === 'failed') continue;
    updateExecutionState(state.agentId, { availability: 'busy', activeTaskId: taskId });
    nowMirrored.add(state.agentId);
  }

  for (const agentId of mirroredAgentIds) {
    if (nowMirrored.has(agentId)) continue;
    const state = states.find((row) => row.agentId === agentId);
    if (!state || state.pauseState || state.disabledState) continue;
    if (state.activeTaskId && ![...activeByAgent.values()].includes(state.activeTaskId)) {
      updateExecutionState(agentId, { availability: 'available', activeTaskId: null });
    }
  }

  mirroredAgentIds.clear();
  for (const agentId of nowMirrored) mirroredAgentIds.add(agentId);
  lastLeaseMirrorAt = new Date().toISOString();
  lastLeaseMirrorCount = nowMirrored.size;
  return nowMirrored.size;
}

function runLeaseMirror(): Promise<void> {
  if (leaseMirrorInFlight) return leaseMirrorInFlight;
  leaseMirrorInFlight = syncRuntimeWorkingFromTaskLeases()
    .catch((error) => {
      console.error('[IVX Autonomous 112 Lease Mirror] failed', { error: error instanceof Error ? error.message : String(error) });
    })
    .then(() => undefined)
    .finally(() => { leaseMirrorInFlight = null; });
  return leaseMirrorInFlight;
}

async function refreshInFlightTaskHeartbeats(): Promise<number> {
  if (!continuityEnabled || continuityRuns.size === 0) return 0;
  const activeWorkerIds = new Set([...continuityRuns.keys()].map((agentId) => `agent:${agentId}`));
  const tasks = postgresAtomicQueueSelected()
    ? await readPostgresFleetLeaseRows()
    : await getAllTasks();
  const leases: Array<{ taskId: string; workerId: string }> = [];
  for (const task of tasks) {
    if (!task.leaseHolder || !activeWorkerIds.has(task.leaseHolder)) continue;
    if ('workerInstanceId' in task && task.workerInstanceId !== autonomousWorkerInstanceId()) continue;
    if (!ACTIVE_TASK_STATES.has(task.state) || !task.leaseHolder) continue;
    leases.push({ taskId: task.taskId, workerId: task.leaseHolder });
  }
  const batch = await heartbeatTasksBatch(leases);
  lastHeartbeatRefreshAt = new Date().toISOString();
  lastHeartbeatRefreshCount = batch.refreshed;
  return batch.refreshed;
}

function runHeartbeatRefresh(): Promise<void> {
  if (heartbeatRefreshInFlight) return heartbeatRefreshInFlight;
  heartbeatRefreshInFlight = refreshInFlightTaskHeartbeats()
    .catch((error) => {
      console.error('[IVX Autonomous 112 Heartbeat Refresh] failed', { error: error instanceof Error ? error.message : String(error) });
    })
    .then(() => undefined)
    .finally(() => { heartbeatRefreshInFlight = null; });
  return heartbeatRefreshInFlight;
}

function startContinuityRun(agentId: string, agentNumber: number, preparedTask: Task): boolean {
  if (!canStartPreparedContinuity(agentId)) return false;
  refillStarted += 1;
  let outcome: ContinuityOutcome = 'failed';
  const sourceSha = currentSourceSha();

  const cycle: Promise<RealEngineeringCycleResult> = isLandingPatrolTask(preparedTask)
    ? runLandingPatrolSession({
      task: preparedTask,
      agentId,
      agentNumber,
      sourceSha,
      shouldContinue: () => continuityEnabled && ownerAllowsAgent(agentId) && landingMissionActive && currentSourceSha() === sourceSha,
    }).then((result) => ({
      ok: result.ok,
      marker: IVX_LANDING_CONTINUOUS_PATROL_MARKER,
      agentId,
      action: result.action,
      taskId: result.taskId,
      module: result.module,
      sourceSha,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      states: ['RUNNING', 'CONTINUOUS_PATROL', result.ok ? 'QUEUED' : 'LEASE_LOST'],
      evidenceIds: result.evidenceIds,
      defects: [],
      repairTaskIds: [],
      filesInspected: [],
      productiveMinutes: result.productiveMinutes,
      nextTaskAvailable: true,
      error: result.error,
    }))
    : runRealEngineeringCycle({ agentId, agentNumber, sourceSha, preparedTask });
  const promise = cycle
    .then((result) => {
      outcome = classifyContinuityResult(result);
      lastOutcomeByAgent.set(agentNumber, {
        outcome,
        action: result.action,
        taskId: result.taskId,
        module: result.module,
        productiveMinutes: result.productiveMinutes,
        evidenceIds: [...result.evidenceIds],
        at: new Date().toISOString(),
        error: result.error,
      });
      if (outcome === 'completed') refillCompleted += 1;
      else if (outcome === 'observed') refillObserved += 1;
      else if (outcome === 'blocked') refillBlocked += 1;
      else if (outcome === 'idle') {
        refillIdle += 1;
        const now = Date.now();
        if (now - lastIdleLogAt > 60_000) {
          lastIdleLogAt = now;
          console.log('[IVX Autonomous 112 Continuity] Autonomous Manager found no eligible real work for some lanes', { sampleAgent: agentNumber, action: result.action, refillIdle });
        }
      } else {
        refillFailed += 1;
        console.error('[IVX Autonomous 112 Continuity] real engineering refill failed', { agentNumber, agentId, action: result.action, taskId: result.taskId, error: result.error ?? 'engineering cycle did not complete durable work' });
      }
    })
    .catch((error) => {
      outcome = 'failed';
      refillFailed += 1;
      lastOutcomeByAgent.set(agentNumber, { outcome: 'failed', action: 'EXCEPTION', taskId: null, module: null, productiveMinutes: 0, evidenceIds: [], at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
      console.error('[IVX Autonomous 112 Continuity] refill exception', { agentNumber, agentId, error: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => {
      continuityRuns.delete(agentId);
      mirroredAgentIds.delete(agentId);
      const state = getAllExecutionStates().find((row) => row.agentId === agentId);
      if (state && !state.pauseState && !state.disabledState && state.activeTaskId) {
        updateExecutionState(agentId, { availability: 'available', activeTaskId: null });
      }
      if (!stopping) refillWakeup.request(refillDelayMs(outcome));
    });
  continuityRuns.set(agentId, promise);
  void runLeaseMirror();
  return true;
}

function refillAllAvailableAgents(
  requestedSourceSha = currentSourceSha(),
  requestedLandingMission = landingMissionActive,
): Promise<void> {
  if (refillInFlight) return refillInFlight;
  refillInFlight = refillBackoff.run(async () => {
    if (!continuityEnabled) return;
    const remainingCapacity = getContinuityMaxConcurrency() - continuityRuns.size;
    if (remainingCapacity <= 0) return;
    const claimScope = `${requestedSourceSha}:${requestedLandingMission}`;
    const candidates = getAllExecutionStates()
      .filter((state) => state.agentNumber != null && canRunContinuity(state.agentId))
      .filter((state) => emptyClaimCooldown.canClaim(`agent:${state.agentId}`, claimScope))
      .slice(0, remainingCapacity);
    if (candidates.length === 0) return;

    if ((process.env.IVX_SUPABASE_RECOVERY_MODE ?? '').toLowerCase() !== 'true') {
      await ensureTechnicalScheduleSeeded().catch(error => console.warn('[IVX Technical Schedule] refill failed', error instanceof Error ? error.message : String(error)));
    }

    if (requestedLandingMission) {
      const seeded = await ensureLandingP0BacklogSeeded(requestedSourceSha);
      if (seeded.error) console.warn('[IVX Autonomous 112 Seed] backlog degraded; checking existing current-mission work', { error: seeded.error });
      const patrol = await ensureLandingP0PatrolSeeded(requestedSourceSha);
      if (patrol.error) console.warn('[IVX Autonomous 112 Seed] patrol degraded; checking existing current-mission work', { error: patrol.error });
    }
    const missionScope = {
      familyPrefixes: [LANDING_P0_PREFIX, LANDING_P0_REPAIR_PREFIX, LANDING_P0_PATROL_PREFIX],
      activePrefixes: requestedLandingMission
        ? [
          `${LANDING_P0_PREFIX}${requestedSourceSha}:`,
          `${LANDING_P0_REPAIR_PREFIX}${requestedSourceSha}:`,
          `${LANDING_P0_PATROL_PREFIX}${requestedSourceSha}:`,
        ]
        : [],
    };
    if (stopping) return;
    const stateByWorker = new Map(candidates.map((state) => [`agent:${state.agentId}`, state]));
    await refillFleetBatches(candidates.map((state) => ({
      workerId: `agent:${state.agentId}`,
      agentNumber: state.agentNumber,
      options: { missionScope },
    })), {
      batchSize: postgresAtomicQueueSelected() ? POSTGRES_FLEET_CLAIM_BATCH_SIZE : IVX_AUTONOMOUS_FLEET_SIZE,
      lease: async requests => {
        const results = await leaseNextTasksBatch(requests);
        emptyClaimCooldown.observe(requests, results, claimScope);
        return results;
      },
      start: startLeasedTasksBatch,
      release: async ({ taskId, workerId }) => {
        const result = await releaseLease(taskId, workerId);
        if (!result.ok) throw new Error(`Prepared lease release refused: ${result.error}`);
      },
      shouldStop: () => stopping || !continuityEnabled,
      onStarted: result => {
        const state = stateByWorker.get(result.workerId);
        return state?.agentNumber != null && result.task
          ? startContinuityRun(state.agentId, state.agentNumber, result.task)
          : false;
      },
    });
    void runLeaseMirror();
  }).catch((error) => {
    console.error('[IVX Autonomous 112 Batch Refill] failed', { error: error instanceof Error ? error.message : String(error), ...refillBackoff.status() });
  }).finally(() => {
    refillInFlight = null;
  });
  return refillInFlight;
}

async function runOnce(reason: 'boot' | 'interval'): Promise<void> {
  if (stopping) return;
  lastRunAt = new Date().toISOString();
  let controlObserved = false;
  try {
    await runLeaseMirror();
    const result = await enforceAutonomous112RuntimeTruth();
    if (stopping) return;
    lastOk = result.ok;
    lastRecovered = result.recovered;
    lastError = null;

    continuityEnabled = Boolean(result.snapshot.autonomous.ownerControlVerified
      && !result.snapshot.autonomous.dispatcherPaused && !result.snapshot.autonomous.emergencyStop);
    ownerAllowedAgentNumbers = new Set(continuityEnabled
      ? result.snapshot.agents.rows.filter((row) => !row.paused && !row.disabled).map((row) => row.agentNumber)
      : []);
    controlObserved = true;
    const sourceSha = currentSourceSha();
    landingMissionActive = continuityEnabled && await isLandingP0MissionActive();

    await refillAllAvailableAgents(sourceSha, landingMissionActive);
    void runLeaseMirror();

    await refreshAutonomousPlanning(sourceSha, { enabled: continuityEnabled, landingMission: landingMissionActive });
    const semantic360 = getAutonomousSemantic360Status();
    const decisionQuality = getAutonomousDecisionQualityStatus();
    if (continuityEnabled) await refillAllAvailableAgents(sourceSha, landingMissionActive);

    await runLeaseMirror();
    console.log('[IVX Autonomous 112 Runtime Enforcer]', {
      reason,
      ok: result.ok,
      action: result.action,
      schedulerEnabled: result.snapshot.autonomous.schedulerEnabled,
      recovered: result.recovered.length,
      working: result.snapshot.agents.counts.working,
      stale: result.snapshot.agents.counts.stale,
      blocked: result.snapshot.agents.counts.blocked,
      unknown: result.snapshot.agents.counts.unknown,
      continuityEnabled,
      landingMissionActive,
      continuityMaxConcurrency: getContinuityMaxConcurrency(),
      continuityInFlight: continuityRuns.size,
      refillStarted,
      refillCompleted,
      refillObserved,
      refillBlocked,
      refillIdle,
      refillFailed,
      leaseMirrorCount: lastLeaseMirrorCount,
      heartbeatRefreshCount: lastHeartbeatRefreshCount,
      semantic360,
      decisionQuality,
      autonomousManager: getAutonomousWorkManagerStatus(),
    });

    void runHeartbeatRefresh();
  } catch (error) {
    if (!controlObserved) {
      continuityEnabled = false;
      ownerAllowedAgentNumbers.clear();
    }
    lastOk = false;
    lastRecovered = [];
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[IVX Autonomous 112 Runtime Enforcer] failed', { reason, error: lastError, continuityPreserved: continuityEnabled });
  }
}

/** Landing keeps execution priority while the manager maintains its bounded backlog. */
export async function refreshAutonomousPlanning(sourceSha: string, policy: { enabled: boolean; landingMission: boolean }): Promise<void> {
  if (!policy.enabled) return;
  if (!policy.landingMission) {
    await runAutonomousSemantic360(sourceSha);
    await runAutonomousDecisionQualityLoop(sourceSha);
  }
  const lanes = getAllExecutionStates()
    .filter(state => state.agentNumber != null && !state.pauseState && !state.disabledState && state.health !== 'failed')
    .map(state => ({ agentId: state.agentId, agentNumber: state.agentNumber as number }));
  await ensureAutonomousManagerBacklog({ sourceSha, agents: lanes });
}

function run(reason: 'boot' | 'interval'): Promise<void> {
  if (enforcerRunInFlight) return enforcerRunInFlight;
  enforcerRunInFlight = runOnce(reason).finally(() => { enforcerRunInFlight = null; });
  return enforcerRunInFlight;
}

export function startAutonomous112RuntimeEnforcer(): boolean {
  if (stopping) return false;
  if (timer) return true;
  if (!autonomousRuntimeEnforcerEnabled()) {
    continuityEnabled = false;
    console.log('[IVX Autonomous Runtime Enforcer] disabled by explicit control policy');
    return false;
  }
  startedAt = new Date().toISOString();
  bootKick = setTimeout(() => { void run('boot'); }, 5_000);
  bootKick.unref?.();
  timer = setInterval(() => { void run('interval'); }, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS);
  timer.unref?.();

  leaseMirrorTimer = setInterval(() => { void runLeaseMirror(); }, 10_000);
  leaseMirrorTimer.unref?.();

  heartbeatTimer = setInterval(() => { void runHeartbeatRefresh(); }, 20_000);
  heartbeatTimer.unref?.();

  refillTimer = setInterval(() => {
    void runLeaseMirror().finally(() => { void refillAllAvailableAgents(); });
  }, IVX_AUTONOMOUS_REFILL_INTERVAL_MS);
  refillTimer.unref?.();
  return true;
}

export function stopAutonomous112RuntimeEnforcer(): Promise<number> {
  if (stopInFlight) return stopInFlight;
  stopping = true;
  refillWakeup.clear();
  emptyClaimCooldown.clear();
  if (bootKick) clearTimeout(bootKick);
  bootKick = null;
  continuityEnabled = false;
  landingMissionActive = false;
  if (timer) clearInterval(timer);
  if (leaseMirrorTimer) clearInterval(leaseMirrorTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (refillTimer) clearInterval(refillTimer);
  timer = null;
  leaseMirrorTimer = null;
  heartbeatTimer = null;
  refillTimer = null;
  // Let any claim already sent to PostgreSQL settle before releasing this process.
  stopInFlight = Promise.allSettled([refillInFlight, heartbeatRefreshInFlight])
    .then(() => postgresAtomicQueueSelected() ? releasePostgresWorkerInstanceTasks() : 0)
    .catch((error) => {
      console.error('[IVX Autonomous 112 Shutdown] lease release failed', { error: error instanceof Error ? error.message : String(error) });
      return 0;
    })
    .then((released) => {
      console.log('[IVX Autonomous 112 Shutdown] capacity returned to queue', { released });
      return released;
    });
  return stopInFlight;
}

export function getAutonomous112RuntimeEnforcerStatus() {
  return {
    marker: IVX_AUTONOMOUS_RUNTIME_ENFORCER_MARKER,
    running: Boolean(timer),
    enabledByPolicy: autonomousRuntimeEnforcerEnabled(),
    supervisoryRunInFlight: Boolean(enforcerRunInFlight),
    leaseMirrorRunning: Boolean(leaseMirrorTimer),
    leaseMirrorInFlight: Boolean(leaseMirrorInFlight),
    heartbeatTimerRunning: Boolean(heartbeatTimer),
    heartbeatRefreshInFlight: Boolean(heartbeatRefreshInFlight),
    refillTimerRunning: Boolean(refillTimer),
    refillIntervalMs: IVX_AUTONOMOUS_REFILL_INTERVAL_MS,
    startedAt,
    intervalMs: IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS,
    lastRunAt,
    lastOk,
    lastRecovered,
    lastError,
    continuityEnabled,
    landingMissionActive,
    refillInFlight: Boolean(refillInFlight),
    refillRecovery: refillBackoff.status(),
    claimBatchSize: postgresAtomicQueueSelected() ? POSTGRES_FLEET_CLAIM_BATCH_SIZE : IVX_AUTONOMOUS_FLEET_SIZE,
    continuityMaxConcurrency: getContinuityMaxConcurrency(),
    canonicalFleetSize: IVX_AUTONOMOUS_FLEET_SIZE,
    continuityInFlight: continuityRuns.size,
    refillStarted,
    refillCompleted,
    refillObserved,
    refillBlocked,
    refillIdle,
    refillFailed,
    lastLeaseMirrorAt,
    lastLeaseMirrorCount,
    lastHeartbeatRefreshAt,
    lastHeartbeatRefreshCount,
    patrolActive: getLandingPatrolLiveStates().length,
    patrolIntervalMs: getLandingPatrolIntervalMs(),
    successfulRefillDelayMs: refillDelayMs('completed'),
    idleRefillDelayMs: refillDelayMs('idle'),
    failedRefillBackoffMs: refillDelayMs('failed'),
    agentsByOutcome: getContinuityOutcomeCounts(),
    semantic360: getAutonomousSemantic360Status(),
    decisionQuality: getAutonomousDecisionQualityStatus(),
    autonomousManager: getAutonomousWorkManagerStatus(),
    truthPolicy: 'IVX production fleet capacity is a hard 112-lane invariant whenever Autonomous is enabled. Environment drift cannot silently reduce concurrency. Backlog creation, leasing, RUNNING transitions and 20-second lease heartbeats use bounded fleet batches. A dedicated 5-second refill repairs capacity independently from the heavier supervisor. Only durable active tasks with a real leaseHolder are mirrored into busy/activeTaskId; heartbeat alone is never productive evidence. Explicit owner/system pause, stop, disable and failed-health controls remain respected.',
  };
}

export function getContinuityOutcomeCounts(): Record<ContinuityOutcome | 'inFlight' | 'unknown', number> {
  const counts: Record<ContinuityOutcome | 'inFlight' | 'unknown', number> = { completed: 0, observed: 0, blocked: 0, idle: 0, failed: 0, inFlight: continuityRuns.size, unknown: 0 };
  const states = getAllExecutionStates();
  for (const state of states) {
    if (continuityRuns.has(state.agentId)) continue;
    if (state.agentNumber == null) { counts.unknown += 1; continue; }
    const record = lastOutcomeByAgent.get(state.agentNumber);
    if (!record) counts.unknown += 1; else counts[record.outcome] += 1;
  }
  return counts;
}

export function getContinuityOutcomes(): Array<AgentContinuityRecord & { agentNumber: number }> {
  return [...lastOutcomeByAgent.entries()].map(([agentNumber, record]) => ({ agentNumber, ...record, evidenceIds: [...record.evidenceIds] })).sort((a, b) => a.agentNumber - b.agentNumber);
}
