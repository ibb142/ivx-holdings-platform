import { enforceAutonomous112RuntimeTruth, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS } from './ivx-autonomous-truth-control';
import { getAllExecutionStates } from './ivx-agent-runtime';
import { runRealEngineeringCycle } from './ivx-agent-real-engineering-cycle';
import { archiveTasksForOtherShas } from './ivx-autonomous-task-engine';

let timer: ReturnType<typeof setInterval> | null = null;
let startedAt: string | null = null;
let lastRunAt: string | null = null;
let lastOk: boolean | null = null;
let lastRecovered: number[] = [];
let lastError: string | null = null;
/**
 * Continuity is ON by default (IVX_CONTINUITY_DEFAULT=off to change) and is only
 * switched off by a SUCCESSFUL truth snapshot that reports dispatcher pause or
 * emergency stop. A transient exception (Supabase timeout during a redeploy storm)
 * must never idle 112 agents — on 2026-09-04 it did, for every boot.
 */
let continuityEnabled = (process.env.IVX_CONTINUITY_DEFAULT ?? 'on').trim().toLowerCase() !== 'off';
let lastArchiveAt = 0;
let lastArchiveResult: { archived: number; shas: string[]; remaining: number; at: string } | null = null;
const ARCHIVE_THROTTLE_MS = 10 * 60 * 1000;
let refillStarted = 0;
let refillCompleted = 0;
let refillFailed = 0;
let refillIdle = 0;
let refillBlocked = 0;
let lastIdleLogAt = 0;
const continuityRuns = new Map<string, Promise<void>>();

export type ContinuityOutcome = 'completed' | 'blocked' | 'idle' | 'failed';
type AgentContinuityRecord = { outcome: ContinuityOutcome; action: string; taskId: string | null; module: string | null; productiveMinutes: number; at: string; error: string | null };
const lastOutcomeByAgent = new Map<number, AgentContinuityRecord>();

/**
 * Refill cadence (owner invariant: an available IA must not sit idle while
 * eligible backlog exists):
 *   completed/blocked → immediate re-lease (default 250ms, env >= 100ms)
 *   idle (no eligible task) → 15s (backlog is re-seeded on SHA change)
 *   failed → 30s backoff
 */
function refillDelayMs(outcome: ContinuityOutcome): number {
  if (outcome === 'failed') return 30_000;
  if (outcome === 'idle') {
    const idle = Number.parseInt(process.env.IVX_CONTINUITY_IDLE_DELAY_MS ?? '', 10);
    return Number.isFinite(idle) && idle >= 1_000 ? Math.min(idle, 60_000) : 15_000;
  }
  const configured = Number.parseInt(process.env.IVX_CONTINUITY_REFILL_DELAY_MS ?? '', 10);
  return Number.isFinite(configured) && configured >= 100 ? Math.min(configured, 30_000) : 250;
}

/** Classify a cycle result truthfully: only durable work with a real taskId counts. */
export function classifyContinuityResult(result: { ok: boolean; action: string; taskId: string | null; states: string[] }): ContinuityOutcome {
  if (!result.ok) return 'failed';
  if (result.action === 'NO_TASK_AVAILABLE') return 'idle';
  // A durable rerun of an already-VERIFIED task is not new work — it is a drained lane.
  if (result.states.includes('ALREADY_VERIFIED')) return 'idle';
  if (!result.taskId) return 'failed';
  if (result.action === 'TASK_BLOCKED') return 'blocked';
  if (result.action === 'TASK_COMPLETED' || result.action === 'TASK_OWNER_GATE') return 'completed';
  return 'failed';
}

function canRunContinuity(agentId: string): boolean {
  if (!continuityEnabled || continuityRuns.has(agentId)) return false;
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

function startContinuityRun(agentId: string, agentNumber: number): void {
  if (!canRunContinuity(agentId)) return;
  refillStarted += 1;
  let outcome: ContinuityOutcome = 'failed';
  const promise = runRealEngineeringCycle({
    agentId,
    agentNumber,
    sourceSha: currentSourceSha(),
  }).then((result) => {
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
      // Idle is not a failure: log it once a minute (aggregate), never per agent.
      const now = Date.now();
      if (now - lastIdleLogAt > 60_000) {
        lastIdleLogAt = now;
        console.log('[IVX Autonomous 112 Continuity] no eligible task for some agents (backlog drained or gated)', { sampleAgent: agentNumber, action: result.action, refillIdle });
      }
    } else {
      refillFailed += 1;
      console.error('[IVX Autonomous 112 Continuity] real engineering refill failed', {
        agentNumber,
        agentId,
        action: result.action,
        taskId: result.taskId,
        error: result.error ?? 'engineering cycle did not complete durable work',
      });
    }
  }).catch((error) => {
    refillFailed += 1;
    lastOutcomeByAgent.set(agentNumber, { outcome: 'failed', action: 'EXCEPTION', taskId: null, module: null, productiveMinutes: 0, at: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) });
    console.error('[IVX Autonomous 112 Continuity] refill exception', {
      agentNumber,
      agentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }).finally(() => {
    continuityRuns.delete(agentId);
    const delay = refillDelayMs(outcome);
    const next = setTimeout(() => {
      if (canRunContinuity(agentId)) startContinuityRun(agentId, agentNumber);
    }, delay);
    next.unref?.();
  });
  continuityRuns.set(agentId, promise);
}

function refillRecoveredAgents(agentNumbers: number[]): void {
  if (!continuityEnabled || agentNumbers.length === 0) return;
  const byNumber = new Map(getAllExecutionStates().map((state) => [state.agentNumber, state]));
  for (const agentNumber of agentNumbers) {
    const state = byNumber.get(agentNumber);
    if (state) startContinuityRun(state.agentId, agentNumber);
  }
}

function refillAllAvailableAgents(): void {
  if (!continuityEnabled) return;
  // Stagger the wave (150ms apart → 112 agents over ~17s): every lease is a full
  // ledger write behind one mutex, so a simultaneous burst at boot only queues on
  // the lock and saturates the durable store.
  let index = 0;
  for (const state of getAllExecutionStates()) {
    if (state.agentNumber == null || !canRunContinuity(state.agentId)) continue;
    const { agentId, agentNumber } = state;
    if (continuityRuns.has(agentId)) continue;
    const kick = setTimeout(() => {
      if (canRunContinuity(agentId)) startContinuityRun(agentId, agentNumber);
    }, Math.min(index, 111) * 150);
    kick.unref?.();
    index += 1;
  }
}

/** Move previous-deploy tasks out of the hot ledger document (throttled; never deletes). */
async function maybeArchiveObsoleteShaTasks(): Promise<void> {
  const now = Date.now();
  if (now - lastArchiveAt < ARCHIVE_THROTTLE_MS) return;
  lastArchiveAt = now;
  const sha = currentSourceSha();
  if (sha === 'runtime-unknown-sha') return;
  try {
    const result = await archiveTasksForOtherShas(sha);
    lastArchiveResult = { ...result, at: new Date().toISOString() };
    if (result.archived > 0) console.log('[IVX Autonomous 112 Runtime Enforcer] archived obsolete-SHA tasks', lastArchiveResult);
  } catch (error) {
    console.error('[IVX Autonomous 112 Runtime Enforcer] archive failed', { error: error instanceof Error ? error.message : String(error) });
  }
}

async function run(reason: 'boot' | 'interval'): Promise<void> {
  lastRunAt = new Date().toISOString();
  try {
    const result = await enforceAutonomous112RuntimeTruth();
    lastOk = result.ok;
    lastRecovered = result.recovered;
    lastError = null;

    // Continuity work must not collapse because the higher-level scheduler
    // reports disabled during a transient/bootstrap mismatch. Explicit owner
    // safety controls still win: dispatcher pause and emergency stop both
    // disable all refill activity immediately.
    continuityEnabled = Boolean(
      !result.snapshot.autonomous.dispatcherPaused
      && !result.snapshot.autonomous.emergencyStop,
    );

    refillRecoveredAgents(result.recovered);
    refillAllAvailableAgents();
    void maybeArchiveObsoleteShaTasks();
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
    });
  } catch (error) {
    // Keep the last-known owner intent; a failed truth read is not a stop order.
    lastOk = false;
    lastRecovered = [];
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[IVX Autonomous 112 Runtime Enforcer] failed (continuity keeps last-known state)', { reason, error: lastError, continuityEnabled });
    refillAllAvailableAgents();
    void maybeArchiveObsoleteShaTasks();
  }
}

export function startAutonomous112RuntimeEnforcer(): void {
  if (timer) return;
  startedAt = new Date().toISOString();
  const bootKick = setTimeout(() => { void run('boot'); }, 5_000);
  bootKick.unref?.();
  timer = setInterval(() => { void run('interval'); }, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS);
  timer.unref?.();
}

export function getAutonomous112RuntimeEnforcerStatus() {
  return {
    running: Boolean(timer),
    startedAt,
    intervalMs: IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS,
    lastRunAt,
    lastOk,
    lastRecovered,
    lastError,
    continuityEnabled,
    continuityInFlight: continuityRuns.size,
    refillStarted,
    refillCompleted,
    refillBlocked,
    refillIdle,
    refillFailed,
    successfulRefillDelayMs: refillDelayMs('completed'),
    idleRefillDelayMs: refillDelayMs('idle'),
    failedRefillBackoffMs: refillDelayMs('failed'),
    agentsByOutcome: getContinuityOutcomeCounts(),
    lastArchive: lastArchiveResult,
    truthPolicy: 'Idle/stale/unknown and available agents receive real durable engineering-cycle work; completed agents re-lease immediately; idle (no eligible task) and ALREADY_VERIFIED reruns are never counted as completed work; owner/system stop, pause, disable and failed-health states are respected.',
  };
}

/** Per-agent latest continuity outcome (truthful working/blocked/idle/failed split). */
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
