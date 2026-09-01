import { enforceAutonomous112RuntimeTruth, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS } from './ivx-autonomous-truth-control';
import { executeAgentRun, getAllExecutionStates } from './ivx-agent-runtime';

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

function startContinuityRun(agentId: string, agentNumber: number): void {
  if (!canRunContinuity(agentId)) return;
  const taskId = `continuity-${Date.now()}-${String(agentNumber).padStart(3, '0')}`;
  refillStarted += 1;
  let succeeded = false;
  const promise = executeAgentRun(agentId, 'audit', {
    __taskId: taskId,
    __runId: `ivx-continuity-${new Date().toISOString().slice(0, 10)}`,
    __workflow: 'ivx-autonomous-runtime-enforcer',
    missionType: 'continuous_no_idle_sla',
    readOnly: true,
    requireEvidence: true,
    realExecutionOnly: true,
    simulatedSuccessAllowed: false,
    agentNumber,
    instruction: 'Perform the next real low-risk evidence-backed audit within your allowed capability. Do not mutate production, do not fabricate success, and return a verifiable source/tool result.',
  }).then((result) => {
    succeeded = Boolean(
      result.ok
      && result.runRecord?.finalStatus === 'completed'
      && result.runRecord?.simulated === false
      && result.runRecord?.sourceReference
      && result.runRecord?.toolResultId,
    );
    if (succeeded) refillCompleted += 1;
    else {
      refillFailed += 1;
      console.error('[IVX Autonomous 112 Continuity] real refill failed', {
        agentNumber,
        agentId,
        error: result.error ?? result.runRecord?.error ?? 'missing verifiable runtime evidence',
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

async function run(reason: 'boot' | 'interval'): Promise<void> {
  lastRunAt = new Date().toISOString();
  try {
    const result = await enforceAutonomous112RuntimeTruth();
    lastOk = result.ok;
    lastRecovered = result.recovered;
    lastError = null;
    continuityEnabled = Boolean(
      result.snapshot.autonomous.schedulerEnabled
      && !result.snapshot.autonomous.dispatcherPaused
      && !result.snapshot.autonomous.emergencyStop,
    );
    refillRecoveredAgents(result.recovered);
    console.log('[IVX Autonomous 112 Runtime Enforcer]', {
      reason,
      ok: result.ok,
      action: result.action,
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
    truthPolicy: 'Idle/stale/unknown agents receive real read-only executeAgentRun work with durable evidence; owner/system stop, pause, disable and failed-health states are respected.',
  };
}
