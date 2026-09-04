import { enforceAutonomous112RuntimeTruth, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS } from './ivx-autonomous-truth-control';
import { getAllExecutionStates } from './ivx-agent-runtime';
import { runRealEngineeringCycle } from './ivx-agent-real-engineering-cycle';

let timer: ReturnType<typeof setInterval> | null = null;
let startedAt: string | null = null;
let lastRunAt: string | null = null;
let lastOk: boolean | null = null;
let lastRecovered: number[] = [];
let lastError: string | null = null;
let continuityEnabled = false;
let refillStarted = 0;
let refillCompleted = 0;
let refillFailed = 0;
const continuityRuns = new Map<string, Promise<void>>();

function refillDelayMs(ok: boolean): number {
  if (!ok) return 30_000;
  const configured = Number.parseInt(process.env.IVX_CONTINUITY_REFILL_DELAY_MS ?? '', 10);
  return Number.isFinite(configured) && configured >= 500 ? Math.min(configured, 30_000) : 2_000;
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
  let succeeded = false;
  const promise = runRealEngineeringCycle({
    agentId,
    agentNumber,
    sourceSha: currentSourceSha(),
  }).then((result) => {
    succeeded = Boolean(
      result.ok
      && (result.action === 'TASK_COMPLETED' || result.action === 'TASK_OWNER_GATE')
      && result.taskId,
    );
    if (succeeded) refillCompleted += 1;
    else {
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
    console.error('[IVX Autonomous 112 Continuity] refill exception', {
      agentNumber,
      agentId,
      error: error instanceof Error ? error.message : String(error),
    });
  }).finally(() => {
    continuityRuns.delete(agentId);
    const delay = refillDelayMs(succeeded);
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
  for (const state of getAllExecutionStates()) {
    if (state.agentNumber != null && canRunContinuity(state.agentId)) {
      startContinuityRun(state.agentId, state.agentNumber);
    }
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
      refillFailed,
    });
  } catch (error) {
    continuityEnabled = false;
    lastOk = false;
    lastRecovered = [];
    lastError = error instanceof Error ? error.message : String(error);
    console.error('[IVX Autonomous 112 Runtime Enforcer] failed', { reason, error: lastError });
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
    refillFailed,
    successfulRefillDelayMs: refillDelayMs(true),
    failedRefillBackoffMs: refillDelayMs(false),
    truthPolicy: 'Idle/stale/unknown and available agents receive real durable engineering-cycle work; owner/system stop, pause, disable and failed-health states are respected.',
  };
}
