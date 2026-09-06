import { enforceAutonomous112RuntimeTruth, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS } from './ivx-autonomous-truth-control';
import { getAllExecutionStates, updateExecutionState } from './ivx-agent-runtime';
import { runRealEngineeringCycle } from './ivx-agent-real-engineering-cycle';
import { getAllTasks, heartbeat as heartbeatTask } from './ivx-autonomous-task-engine';
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

let timer: ReturnType<typeof setInterval> | null = null;
let leaseMirrorTimer: ReturnType<typeof setInterval> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let enforcerRunInFlight: Promise<void> | null = null;
let leaseMirrorInFlight: Promise<void> | null = null;
let heartbeatRefreshInFlight: Promise<void> | null = null;
let startedAt: string | null = null;
let lastRunAt: string | null = null;
let lastOk: boolean | null = null;
let lastRecovered: number[] = [];
let lastError: string | null = null;
let continuityEnabled = false;
let refillStarted = 0;
let refillCompleted = 0;
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
const DEFAULT_CONTINUITY_MAX_CONCURRENCY = 12;

const ACTIVE_TASK_STATES = new Set([
  'LEASED', 'RUNNING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS',
  'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING',
]);

export type ContinuityOutcome = 'completed' | 'blocked' | 'idle' | 'failed';
type AgentContinuityRecord = { outcome: ContinuityOutcome; action: string; taskId: string | null; module: string | null; productiveMinutes: number; at: string; error: string | null };
const lastOutcomeByAgent = new Map<number, AgentContinuityRecord>();

function refillDelayMs(outcome: ContinuityOutcome): number {
  if (outcome === 'failed') return 30_000;
  if (outcome === 'idle') {
    const idle = Number.parseInt(process.env.IVX_CONTINUITY_IDLE_DELAY_MS ?? '', 10);
    return Number.isFinite(idle) && idle >= 1_000 ? Math.min(idle, 60_000) : 15_000;
  }
  const configured = Number.parseInt(process.env.IVX_CONTINUITY_REFILL_DELAY_MS ?? '', 10);
  return Number.isFinite(configured) && configured >= 100 ? Math.min(configured, 30_000) : 250;
}

export function getContinuityMaxConcurrency(): number {
  const configured = Number.parseInt(process.env.IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY ?? '', 10);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_CONTINUITY_MAX_CONCURRENCY;
  return Math.min(configured, 112);
}

export function classifyContinuityResult(result: { ok: boolean; action: string; taskId: string | null; states: string[] }): ContinuityOutcome {
  if (!result.ok) return 'failed';
  if (result.action === 'NO_TASK_AVAILABLE') return 'idle';
  if (result.states.includes('ALREADY_VERIFIED')) return 'idle';
  if (!result.taskId) return 'failed';
  if (result.action === 'TASK_BLOCKED') return 'blocked';
  if (result.action === 'TASK_COMPLETED' || result.action === 'TASK_OWNER_GATE') return 'completed';
  return 'failed';
}

function canRunContinuity(agentId: string): boolean {
  if (!continuityEnabled || continuityRuns.has(agentId)) return false;
  if (continuityRuns.size >= getContinuityMaxConcurrency()) return false;
  const state = getAllExecutionStates().find((row) => row.agentId === agentId);
  if (!state) return false;
  return !state.pauseState
    && !state.disabledState
    && state.health !== 'failed'
    && state.availability === 'available'
    && !state.activeTaskId;
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
  const tasks = await getAllTasks();
  const states = getAllExecutionStates();
  const stateByNumber = new Map(states.map((state) => [state.agentNumber, state]));
  const activeByAgent = new Map<number, string>();

  for (const task of tasks) {
    if (task.assignedAgentNumber == null || !task.leaseHolder || !ACTIVE_TASK_STATES.has(task.state)) continue;
    if (!activeByAgent.has(task.assignedAgentNumber)) activeByAgent.set(task.assignedAgentNumber, task.taskId);
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
  const byId = new Map(getAllExecutionStates().map((state) => [state.agentId, state.agentNumber]));
  const activeAgentNumbers = new Set<number>();
  for (const agentId of continuityRuns.keys()) {
    const number = byId.get(agentId);
    if (typeof number === 'number') activeAgentNumbers.add(number);
  }
  const tasks = await getAllTasks();
  let refreshed = 0;
  for (const task of tasks) {
    if (task.assignedAgentNumber == null || !activeAgentNumbers.has(task.assignedAgentNumber)) continue;
    if (!ACTIVE_TASK_STATES.has(task.state) || !task.leaseHolder) continue;
    const result = await heartbeatTask(task.taskId, task.leaseHolder).catch(() => ({ ok: false, error: 'heartbeat exception' }));
    if (result.ok) refreshed += 1;
  }
  lastHeartbeatRefreshAt = new Date().toISOString();
  lastHeartbeatRefreshCount = refreshed;
  return refreshed;
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

function startContinuityRun(agentId: string, agentNumber: number): void {
  if (!canRunContinuity(agentId)) return;
  refillStarted += 1;
  let outcome: ContinuityOutcome = 'failed';
  const sourceSha = currentSourceSha();

  // Lease-first: the fleet-level manager already maintains the durable backlog.
  // Do not make every IA perform another planning/read pass before it can lease.
  const promise = runRealEngineeringCycle({ agentId, agentNumber, sourceSha })
    .then((result) => {
      outcome = classifyContinuityResult(result);
      lastOutcomeByAgent.set(agentNumber, {
        outcome,
        action: result.action,
        taskId: result.taskId,
        module: result.module,
        productiveMinutes: result.productiveMinutes,
        at: new Date().toISOString(),
        error: result.error,
      });
      if (outcome === 'completed') refillCompleted += 1;
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
      lastOutcomeByAgent.set(agentNumber, { outcome: 'failed', action: 'EXCEPTION', taskId: null, module: null, productiveMinutes: 0, at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
      console.error('[IVX Autonomous 112 Continuity] refill exception', { agentNumber, agentId, error: error instanceof Error ? error.message : String(error) });
    })
    .finally(() => {
      continuityRuns.delete(agentId);
      mirroredAgentIds.delete(agentId);
      const state = getAllExecutionStates().find((row) => row.agentId === agentId);
      if (state && !state.pauseState && !state.disabledState && state.activeTaskId) {
        updateExecutionState(agentId, { availability: 'available', activeTaskId: null });
      }
      const next = setTimeout(() => { if (canRunContinuity(agentId)) startContinuityRun(agentId, agentNumber); }, refillDelayMs(outcome));
      next.unref?.();
    });
  continuityRuns.set(agentId, promise);
  void runLeaseMirror();
}

function refillRecoveredAgents(agentNumbers: number[]): void {
  if (!continuityEnabled || agentNumbers.length === 0) return;
  const byNumber = new Map(getAllExecutionStates().map((state) => [state.agentNumber, state]));
  for (const agentNumber of agentNumbers) {
    if (continuityRuns.size >= getContinuityMaxConcurrency()) break;
    const state = byNumber.get(agentNumber);
    if (state) startContinuityRun(state.agentId, agentNumber);
  }
}

function refillAllAvailableAgents(): void {
  if (!continuityEnabled) return;
  for (const state of getAllExecutionStates()) {
    if (continuityRuns.size >= getContinuityMaxConcurrency()) break;
    if (state.agentNumber != null && canRunContinuity(state.agentId)) startContinuityRun(state.agentId, state.agentNumber);
  }
}

async function runOnce(reason: 'boot' | 'interval'): Promise<void> {
  lastRunAt = new Date().toISOString();
  try {
    await runLeaseMirror();
    const result = await enforceAutonomous112RuntimeTruth();
    lastOk = result.ok;
    lastRecovered = result.recovered;
    lastError = null;

    continuityEnabled = Boolean(!result.snapshot.autonomous.dispatcherPaused && !result.snapshot.autonomous.emergencyStop);

    // Start/recover the 112 real engineering lanes BEFORE heavier semantic,
    // decision-quality, and backlog planning. Existing queued work can therefore
    // be leased immediately instead of waiting behind a fleet-wide planning pass.
    refillRecoveredAgents(result.recovered);
    refillAllAvailableAgents();
    void runLeaseMirror();

    const sourceSha = currentSourceSha();
    let semantic360 = getAutonomousSemantic360Status();
    let decisionQuality = getAutonomousDecisionQualityStatus();
    if (continuityEnabled) {
      await runAutonomousSemantic360(sourceSha);
      semantic360 = getAutonomousSemantic360Status();
      await runAutonomousDecisionQualityLoop(sourceSha);
      decisionQuality = getAutonomousDecisionQualityStatus();
      const lanes = getAllExecutionStates()
        .filter((state) => state.agentNumber != null && !state.pauseState && !state.disabledState && state.health !== 'failed')
        .map((state) => ({ agentId: state.agentId, agentNumber: state.agentNumber as number }));
      await ensureAutonomousManagerBacklog({ sourceSha, agents: lanes });
    }

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
      continuityInFlight: continuityRuns.size,
      refillStarted,
      refillCompleted,
      refillBlocked,
      refillIdle,
      refillFailed,
      leaseMirrorCount: lastLeaseMirrorCount,
      heartbeatRefreshCount: lastHeartbeatRefreshCount,
      semantic360,
      decisionQuality,
      autonomousManager: getAutonomousWorkManagerStatus(),
    });

    // Heartbeats are also renewed by a dedicated timer independent of this
    // heavier supervisor loop. This call provides an extra post-cycle refresh.
    void runHeartbeatRefresh();
  } catch (error) {
    lastOk = false;
    lastRecovered = [];
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[IVX Autonomous 112 Runtime Enforcer] failed', { reason, error: lastError, continuityPreserved: continuityEnabled });
  }
}

function run(reason: 'boot' | 'interval'): Promise<void> {
  if (enforcerRunInFlight) return enforcerRunInFlight;
  enforcerRunInFlight = runOnce(reason).finally(() => {
    enforcerRunInFlight = null;
  });
  return enforcerRunInFlight;
}

export function startAutonomous112RuntimeEnforcer(): void {
  if (timer) return;
  startedAt = new Date().toISOString();
  const bootKick = setTimeout(() => { void run('boot'); }, 5_000);
  bootKick.unref?.();
  timer = setInterval(() => { void run('interval'); }, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS);
  timer.unref?.();

  // Dedicated 10s mirror is independent from slow semantic/QA supervisor work.
  // It never manufactures work: only real lease-bearing task-engine records are mirrored.
  leaseMirrorTimer = setInterval(() => { void runLeaseMirror(); }, 10_000);
  leaseMirrorTimer.unref?.();

  // Dedicated durable heartbeat renewal is also independent from the slow
  // semantic/decision/backlog supervisor path. It only renews lease-bearing
  // tasks owned by currently running continuity lanes and never fabricates work.
  heartbeatTimer = setInterval(() => { void runHeartbeatRefresh(); }, 20_000);
  heartbeatTimer.unref?.();
}

export function getAutonomous112RuntimeEnforcerStatus() {
  return {
    running: Boolean(timer),
    supervisoryRunInFlight: Boolean(enforcerRunInFlight),
    leaseMirrorRunning: Boolean(leaseMirrorTimer),
    leaseMirrorInFlight: Boolean(leaseMirrorInFlight),
    heartbeatTimerRunning: Boolean(heartbeatTimer),
    heartbeatRefreshInFlight: Boolean(heartbeatRefreshInFlight),
    startedAt,
    intervalMs: IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS,
    lastRunAt,
    lastOk,
    lastRecovered,
    lastError,
    continuityEnabled,
    continuityMaxConcurrency: getContinuityMaxConcurrency(),
    continuityInFlight: continuityRuns.size,
    refillStarted,
    refillCompleted,
    refillBlocked,
    refillIdle,
    refillFailed,
    lastLeaseMirrorAt,
    lastLeaseMirrorCount,
    lastHeartbeatRefreshAt,
    lastHeartbeatRefreshCount,
    successfulRefillDelayMs: refillDelayMs('completed'),
    idleRefillDelayMs: refillDelayMs('idle'),
    failedRefillBackoffMs: refillDelayMs('failed'),
    agentsByOutcome: getContinuityOutcomeCounts(),
    semantic360: getAutonomousSemantic360Status(),
    decisionQuality: getAutonomousDecisionQualityStatus(),
    autonomousManager: getAutonomousWorkManagerStatus(),
    truthPolicy: 'Autonomous Manager maintains real work blocks. Continuity is lease-first and bounded by IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY (default 12, maximum 112). Only durable active tasks with a real leaseHolder are mirrored into agent-runtime busy/activeTaskId every 10 seconds; continuity promise count alone is never proof of work. Semantic 360 and Decision Quality remain fail-closed. Durable task leases are renewed on an independent 20-second heartbeat timer restricted to currently running continuity lanes. Idle/ALREADY_VERIFIED is never counted as completed work; owner/system stop, pause, disable and failed-health states are respected.',
  };
}

export function getContinuityOutcomeCounts(): Record<ContinuityOutcome | 'inFlight' | 'unknown', number> {
  const counts: Record<ContinuityOutcome | 'inFlight' | 'unknown', number> = { completed: 0, blocked: 0, idle: 0, failed: 0, inFlight: continuityRuns.size, unknown: 0 };
  const states = getAllExecutionStates();
  for (const state of states) {
    if (state.agentNumber == null) { counts.unknown += 1; continue; }
    const record = lastOutcomeByAgent.get(state.agentNumber);
    if (!record) counts.unknown += 1; else counts[record.outcome] += 1;
  }
  return counts;
}

export function getContinuityOutcomes(): Array<AgentContinuityRecord & { agentNumber: number }> {
  return [...lastOutcomeByAgent.entries()].map(([agentNumber, record]) => ({ agentNumber, ...record })).sort((a, b) => a.agentNumber - b.agentNumber);
}
