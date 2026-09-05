import { enforceAutonomous112RuntimeTruth, IVX_AUTONOMOUS_TRUTH_ENFORCER_INTERVAL_MS } from './ivx-autonomous-truth-control';
import { getAllExecutionStates } from './ivx-agent-runtime';
import { runRealEngineeringCycle } from './ivx-agent-real-engineering-cycle';
import { getAllTasks, heartbeat as heartbeatTask } from './ivx-autonomous-task-engine';
import {
  ensureAutonomousManagerBacklog,
  ensureAutonomousWorkBlockForAgent,
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
const continuityRuns = new Map<string, Promise<void>>();

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
 * Renew only REAL task-engine leases that belong to agents with an actually
 * executing continuity promise. This is not a synthetic busy signal: a task
 * must already be in a lease-bearing active state with the real lease holder.
 * It prevents long inspections/AI/tool calls from becoming falsely STALE simply
 * because the cycle originally heartbeated only once.
 */
async function refreshInFlightTaskHeartbeats(): Promise<number> {
  if (!continuityEnabled || continuityRuns.size === 0) return 0;
  const byId = new Map(getAllExecutionStates().map((state) => [state.agentId, state.agentNumber]));
  const activeAgentNumbers = new Set<number>();
  for (const agentId of continuityRuns.keys()) {
    const number = byId.get(agentId);
    if (typeof number === 'number') activeAgentNumbers.add(number);
  }
  const activeStates = new Set(['LEASED', 'RUNNING', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS', 'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING']);
  const tasks = await getAllTasks();
  let refreshed = 0;
  for (const task of tasks) {
    if (task.assignedAgentNumber == null || !activeAgentNumbers.has(task.assignedAgentNumber)) continue;
    if (!activeStates.has(task.state) || !task.leaseHolder) continue;
    const result = await heartbeatTask(task.taskId, task.leaseHolder).catch(() => ({ ok: false, error: 'heartbeat exception' }));
    if (result.ok) refreshed += 1;
  }
  lastHeartbeatRefreshAt = new Date().toISOString();
  lastHeartbeatRefreshCount = refreshed;
  return refreshed;
}

function startContinuityRun(agentId: string, agentNumber: number): void {
  if (!canRunContinuity(agentId)) return;
  refillStarted += 1;
  let outcome: ContinuityOutcome = 'failed';
  const sourceSha = currentSourceSha();
  const promise = ensureAutonomousWorkBlockForAgent({ agentId, agentNumber, sourceSha })
    .then((plan) => {
      if (!plan.ok) throw new Error(`Autonomous Manager failed to plan IA-${agentNumber}: ${plan.error ?? 'unknown planning error'}`);
      return runRealEngineeringCycle({ agentId, agentNumber, sourceSha });
    })
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
      const next = setTimeout(() => { if (canRunContinuity(agentId)) startContinuityRun(agentId, agentNumber); }, refillDelayMs(outcome));
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
    if (state.agentNumber != null && canRunContinuity(state.agentId)) startContinuityRun(state.agentId, state.agentNumber);
  }
}

async function run(reason: 'boot' | 'interval'): Promise<void> {
  lastRunAt = new Date().toISOString();
  try {
    // Refresh real leases BEFORE strict truth evaluation so a genuinely active
    // long cycle is not misclassified stale at the 60-second boundary.
    await refreshInFlightTaskHeartbeats();
    const result = await enforceAutonomous112RuntimeTruth();
    lastOk = result.ok;
    lastRecovered = result.recovered;
    lastError = null;

    continuityEnabled = Boolean(!result.snapshot.autonomous.dispatcherPaused && !result.snapshot.autonomous.emergencyStop);

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
      refillBlocked,
      refillIdle,
      refillFailed,
      heartbeatRefreshCount: lastHeartbeatRefreshCount,
      semantic360,
      decisionQuality,
      autonomousManager: getAutonomousWorkManagerStatus(),
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
    refillBlocked,
    refillIdle,
    refillFailed,
    lastHeartbeatRefreshAt,
    lastHeartbeatRefreshCount,
    successfulRefillDelayMs: refillDelayMs('completed'),
    idleRefillDelayMs: refillDelayMs('idle'),
    failedRefillBackoffMs: refillDelayMs('failed'),
    agentsByOutcome: getContinuityOutcomeCounts(),
    semantic360: getAutonomousSemantic360Status(),
    decisionQuality: getAutonomousDecisionQualityStatus(),
    autonomousManager: getAutonomousWorkManagerStatus(),
    truthPolicy: 'Autonomous Manager audits/plans real work blocks. Semantic 360 verifies runtime-capable connections. Decision Quality measures durable outcomes. Long-running continuity work renews only existing real task-engine leases held by active continuity runs; promise count alone is never proof of work. Idle/ALREADY_VERIFIED is never counted as completed work; owner/system stop, pause, disable and failed-health states are respected.',
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
