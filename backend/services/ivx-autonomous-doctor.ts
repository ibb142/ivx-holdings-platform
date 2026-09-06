import { getAllExecutionStates, enableAgent, resumeAgent } from './ivx-agent-runtime';
import { campaignDispatcherControl, startCampaignDispatcher } from './ivx-campaign-dispatcher';
import { setSchedulerEnabled } from './ivx-autonomous-scheduler';
import {
  enforceAutonomous112RuntimeTruth,
  getAutonomousTruthSnapshot,
  IVX_AUTONOMOUS_ALWAYS_ON_24X7,
} from './ivx-autonomous-truth-control';
import {
  ensureAutonomousManagerBacklog,
  IVX_AUTONOMOUS_FLEET_SIZE,
} from './ivx-autonomous-work-manager';

export const IVX_AUTONOMOUS_DOCTOR_MARKER = 'ivx-autonomous-doctor-24x7-2026-09-06-v1';
const DOCTOR_INTERVAL_MS = Math.max(10_000, Math.min(60_000, Number.parseInt(process.env.IVX_AUTONOMOUS_DOCTOR_INTERVAL_MS ?? '15000', 10) || 15_000));
const RECOVERY_POLL_MS = 3_000;
const RECOVERY_POLLS = 4;
const RETRY_CONCURRENCY = 8;

type DoctorDiagnosis = {
  code: string;
  severity: 'critical' | 'high' | 'medium';
  detail: string;
  affectedAgents: number[];
};

type DoctorStatus = {
  marker: string;
  startedAt: string | null;
  lastRunAt: string | null;
  lastHealthyAt: string | null;
  lastRepairAt: string | null;
  lastRepairCompletedAt: string | null;
  lastError: string | null;
  consecutiveUnhealthy: number;
  totalRuns: number;
  totalRepairs: number;
  totalRepairFailures: number;
  inFlight: boolean;
  lastDiagnosis: DoctorDiagnosis[];
  lastCertification: null | {
    certified: boolean;
    working: number;
    total: number;
    freshHeartbeat: number;
    stale: number;
    blocked: number;
    unknown: number;
  };
};

let timer: ReturnType<typeof setInterval> | null = null;
let bootTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;
let startedAt: string | null = null;
let lastRunAt: string | null = null;
let lastHealthyAt: string | null = null;
let lastRepairAt: string | null = null;
let lastRepairCompletedAt: string | null = null;
let lastError: string | null = null;
let consecutiveUnhealthy = 0;
let totalRuns = 0;
let totalRepairs = 0;
let totalRepairFailures = 0;
let lastDiagnosis: DoctorDiagnosis[] = [];
let lastCertification: DoctorStatus['lastCertification'] = null;

function sourceSha(): string {
  return process.env.RENDER_GIT_COMMIT
    ?? process.env.GITHUB_SHA
    ?? process.env.COMMIT_SHA
    ?? process.env.SOURCE_VERSION
    ?? 'runtime-unknown-sha';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function diagnose(snapshot: Awaited<ReturnType<typeof getAutonomousTruthSnapshot>>): DoctorDiagnosis[] {
  const rows = snapshot.agents.rows;
  const diagnoses: DoctorDiagnosis[] = [];
  if (rows.length !== IVX_AUTONOMOUS_FLEET_SIZE) {
    diagnoses.push({
      code: 'FLEET_SIZE_MISMATCH',
      severity: 'critical',
      detail: `Expected ${IVX_AUTONOMOUS_FLEET_SIZE} IA runtime rows, found ${rows.length}`,
      affectedAgents: [],
    });
  }
  if (snapshot.degraded) {
    diagnoses.push({
      code: 'TRUTH_DEPENDENCY_DEGRADED',
      severity: 'critical',
      detail: snapshot.degradedDependencies.join(','),
      affectedAgents: [],
    });
  }
  if (!snapshot.autonomous.schedulerEnabled || snapshot.autonomous.dispatcherPaused) {
    diagnoses.push({
      code: 'CONTROL_PLANE_NOT_RUNNING',
      severity: 'critical',
      detail: `scheduler=${snapshot.autonomous.schedulerEnabled} dispatcherPaused=${snapshot.autonomous.dispatcherPaused}`,
      affectedAgents: [],
    });
  }
  if (snapshot.autonomous.emergencyStop) {
    diagnoses.push({
      code: 'EMERGENCY_STOP_ACTIVE',
      severity: 'critical',
      detail: 'Emergency stop is active; doctor will not override it automatically.',
      affectedAgents: [],
    });
  }
  for (const status of ['BLOCKED', 'STALE', 'UNKNOWN', 'IDLE'] as const) {
    const affected = rows.filter((row) => row.status === status).map((row) => row.agentNumber);
    if (affected.length) {
      diagnoses.push({
        code: `AGENTS_${status}`,
        severity: status === 'IDLE' ? 'high' : 'critical',
        detail: `${affected.length} IA are ${status}`,
        affectedAgents: affected,
      });
    }
  }
  const noFreshHeartbeat = rows.filter((row) => !row.heartbeatFresh).map((row) => row.agentNumber);
  if (noFreshHeartbeat.length) {
    diagnoses.push({
      code: 'HEARTBEAT_GAP',
      severity: 'critical',
      detail: `${noFreshHeartbeat.length} IA lack a fresh runtime/dispatcher heartbeat`,
      affectedAgents: noFreshHeartbeat,
    });
  }
  return diagnoses;
}

function rememberSnapshot(snapshot: Awaited<ReturnType<typeof getAutonomousTruthSnapshot>>): void {
  lastCertification = {
    certified: snapshot.certification.continuousRuntimeCertified,
    working: snapshot.agents.counts.working,
    total: snapshot.agents.counts.total,
    freshHeartbeat: snapshot.agents.counts.freshHeartbeat,
    stale: snapshot.agents.counts.stale,
    blocked: snapshot.agents.counts.blocked,
    unknown: snapshot.agents.counts.unknown,
  };
  lastDiagnosis = diagnose(snapshot);
}

async function retryAgentsBounded(agentNumbers: readonly number[]): Promise<{ attempted: number; failed: number; errors: string[] }> {
  let attempted = 0;
  let failed = 0;
  const errors: string[] = [];
  for (let offset = 0; offset < agentNumbers.length; offset += RETRY_CONCURRENCY) {
    const batch = agentNumbers.slice(offset, offset + RETRY_CONCURRENCY);
    const results = await Promise.all(batch.map(async (agentNumber) => {
      attempted += 1;
      try {
        await campaignDispatcherControl('retry_agent', agentNumber);
        return null;
      } catch (error) {
        failed += 1;
        return `IA-${agentNumber}:${error instanceof Error ? error.message : String(error)}`;
      }
    }));
    for (const error of results) if (error) errors.push(error.slice(0, 240));
  }
  return { attempted, failed, errors: errors.slice(0, 20) };
}

async function repairFleet(snapshot: Awaited<ReturnType<typeof getAutonomousTruthSnapshot>>): Promise<void> {
  if (snapshot.autonomous.emergencyStop) return;
  totalRepairs += 1;
  lastRepairAt = new Date().toISOString();

  if (IVX_AUTONOMOUS_ALWAYS_ON_24X7) {
    await setSchedulerEnabled(true);
    startCampaignDispatcher();
  }

  // First use the canonical truth enforcer so control-plane recovery remains centralized.
  await enforceAutonomous112RuntimeTruth();

  const states = getAllExecutionStates();
  for (const state of states) {
    if (IVX_AUTONOMOUS_ALWAYS_ON_24X7 && state.disabledState) enableAgent(state.agentId);
    if (IVX_AUTONOMOUS_ALWAYS_ON_24X7 || !state.pauseState) resumeAgent(state.agentId);
  }

  const lanes = getAllExecutionStates()
    .filter((state) => state.agentNumber != null && !state.disabledState && state.health !== 'failed')
    .map((state) => ({ agentId: state.agentId, agentNumber: state.agentNumber as number }));

  // Critical ordering: create/refill real work BEFORE retrying idle lanes.
  // This prevents 112 workers from waking up, finding no task, and going idle again.
  const backlog = await ensureAutonomousManagerBacklog({ sourceSha: sourceSha(), agents: lanes });
  if (!backlog.ok) throw new Error(`autonomous_manager_backlog_failed:${backlog.errors}`);

  const refreshed = await getAutonomousTruthSnapshot();
  const unhealthyAgents = refreshed.agents.rows
    .filter((row) => row.status !== 'WORKING' || !row.heartbeatFresh)
    .map((row) => row.agentNumber);

  const retry = await retryAgentsBounded(unhealthyAgents);
  if (retry.failed > 0) {
    console.error('[IVX Autonomous Doctor] targeted retry failures', retry);
  }

  // Resume-all is intentionally after backlog creation and targeted retries.
  // The doctor therefore repairs both control state and actual per-lane work supply.
  await campaignDispatcherControl('resume_all');
  lastRepairCompletedAt = new Date().toISOString();
}

async function runDoctorOnce(reason: 'boot' | 'interval'): Promise<void> {
  totalRuns += 1;
  lastRunAt = new Date().toISOString();
  try {
    let snapshot = await getAutonomousTruthSnapshot();
    rememberSnapshot(snapshot);
    if (snapshot.certification.continuousRuntimeCertified) {
      lastHealthyAt = new Date().toISOString();
      consecutiveUnhealthy = 0;
      lastError = null;
      return;
    }

    consecutiveUnhealthy += 1;
    console.warn('[IVX Autonomous Doctor] diagnosis', {
      reason,
      consecutiveUnhealthy,
      working: snapshot.agents.counts.working,
      total: snapshot.agents.counts.total,
      diagnoses: lastDiagnosis.map((row) => ({ code: row.code, affected: row.affectedAgents.length })),
    });

    await repairFleet(snapshot);

    for (let poll = 1; poll <= RECOVERY_POLLS; poll += 1) {
      await sleep(RECOVERY_POLL_MS);
      snapshot = await getAutonomousTruthSnapshot();
      rememberSnapshot(snapshot);
      if (snapshot.certification.continuousRuntimeCertified) {
        lastHealthyAt = new Date().toISOString();
        consecutiveUnhealthy = 0;
        lastError = null;
        console.log('[IVX Autonomous Doctor] fleet recovered', {
          poll,
          working: snapshot.agents.counts.working,
          freshHeartbeat: snapshot.agents.counts.freshHeartbeat,
        });
        return;
      }
    }

    lastError = `fleet_not_certified_after_repair:working=${snapshot.agents.counts.working}/${snapshot.agents.counts.total}:fresh=${snapshot.agents.counts.freshHeartbeat}`;
    totalRepairFailures += 1;
    console.error('[IVX Autonomous Doctor] repair incomplete', { error: lastError, diagnoses: lastDiagnosis });
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    totalRepairFailures += 1;
    console.error('[IVX Autonomous Doctor] cycle failed', { reason, error: lastError });
  }
}

function runDoctor(reason: 'boot' | 'interval'): Promise<void> {
  if (inFlight) return inFlight;
  inFlight = runDoctorOnce(reason).finally(() => { inFlight = null; });
  return inFlight;
}

export function startAutonomousDoctor(): void {
  if (timer || bootTimer) return;
  startedAt = new Date().toISOString();
  bootTimer = setTimeout(() => {
    bootTimer = null;
    void runDoctor('boot');
  }, 8_000);
  bootTimer.unref?.();
  timer = setInterval(() => { void runDoctor('interval'); }, DOCTOR_INTERVAL_MS);
  timer.unref?.();
  console.log('[IVX Autonomous Doctor] 24/7 supervisor armed', {
    marker: IVX_AUTONOMOUS_DOCTOR_MARKER,
    intervalMs: DOCTOR_INTERVAL_MS,
    requiredFleet: IVX_AUTONOMOUS_FLEET_SIZE,
    alwaysOnMandate: IVX_AUTONOMOUS_ALWAYS_ON_24X7,
  });
}

export function getAutonomousDoctorStatus(): DoctorStatus {
  return {
    marker: IVX_AUTONOMOUS_DOCTOR_MARKER,
    startedAt,
    lastRunAt,
    lastHealthyAt,
    lastRepairAt,
    lastRepairCompletedAt,
    lastError,
    consecutiveUnhealthy,
    totalRuns,
    totalRepairs,
    totalRepairFailures,
    inFlight: Boolean(inFlight),
    lastDiagnosis,
    lastCertification,
  };
}
