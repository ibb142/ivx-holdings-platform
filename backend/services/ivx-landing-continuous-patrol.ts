/**
 * IVX Landing continuous patrol.
 *
 * A patrol task is a durable, reusable assignment owned by exactly one IA.
 * Each lease performs ONE real Landing observation, persists evidence, then
 * releases the lease immediately. The fleet refill can therefore give the IA
 * another repair/audit/patrol task instead of holding a RUNNING lane asleep
 * between observations. Waiting time is never counted as productive work.
 */
import {
  getAllTasks,
  recordLeasedTaskEvidence,
  releaseLease,
  type Task,
} from './ivx-autonomous-task-engine';
import {
  LANDING_P0_PATROL_PREFIX,
  LANDING_P0_PREFIX,
  LANDING_P0_REPAIR_PREFIX,
  landingPatrolUnitFor,
  parseLandingPatrolTaskKey,
  resolveProductionSha,
} from './ivx-landing-p0-backlog';
import { executeLandingUnit } from './ivx-landing-p0-executor';
import { landingTaskEvidence } from './ivx-landing-task-evidence';
import {
  postgresAtomicQueueSelected,
  readPostgresFleetLeaseRows,
} from './ivx-postgres-autonomous-task-store';

export const IVX_LANDING_CONTINUOUS_PATROL_MARKER = 'ivx-landing-continuous-patrol-2026-09-08-nonblocking-v3';

const DEFAULT_PATROL_INTERVAL_MS = 5 * 1000;
const MIN_PATROL_INTERVAL_MS = 1 * 1000;
const MAX_PATROL_INTERVAL_MS = 60 * 60 * 1000;

export type LandingPatrolLiveState = {
  agentNumber: number;
  agentId: string;
  taskId: string;
  sourceSha: string;
  startedAt: string;
  lastObservationAt: string | null;
  lastUnitId: string | null;
  lastStatus: 'PASS' | 'FAIL' | 'BLOCKED' | 'ERROR' | null;
  observations: number;
  productiveSeconds: number;
  persistenceErrors: number;
  lastError: string | null;
};

export type LandingPatrolSessionResult = {
  ok: boolean;
  action: 'PATROL_SESSION_ENDED' | 'PATROL_SESSION_LOST';
  taskId: string;
  module: string | null;
  startedAt: string;
  finishedAt: string;
  evidenceIds: string[];
  productiveMinutes: number;
  error: string | null;
};

const liveByAgent = new Map<number, LandingPatrolLiveState>();

function nowIso(): string {
  return new Date().toISOString();
}

export function getLandingPatrolIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const configured = Number.parseInt(env.IVX_LANDING_PATROL_INTERVAL_MS ?? '', 10);
  if (!Number.isFinite(configured)) return DEFAULT_PATROL_INTERVAL_MS;
  return Math.max(MIN_PATROL_INTERVAL_MS, Math.min(MAX_PATROL_INTERVAL_MS, configured));
}

export function getLandingPatrolLiveStates(): LandingPatrolLiveState[] {
  return [...liveByAgent.values()]
    .map((state) => ({ ...state }))
    .sort((a, b) => a.agentNumber - b.agentNumber);
}

export type LandingFleetProof = {
  marker: string;
  generatedAt: string;
  sourceSha: string;
  exact112Working: boolean;
  activeRows: number;
  distinctTasks: number;
  distinctHolders: number;
  distinctAssignedAgents: number;
  ownTaskMatches: number;
  freshHeartbeats: number;
  workerIdentities: number;
  missingAgents: number[];
  duplicateAssignedAgents: number[];
  assignmentMismatches: Array<{ assignedAgentNumber: number | null; leaseHolder: string; taskId: string }>;
  freshnessWindowSeconds: 60;
  evidenceRule: string;
};

function holderAgentNumber(holder: string): number | null {
  const match = /^agent:ivx_holdings_(\d{1,3})$/.exec(holder);
  if (!match) return null;
  const number = Number.parseInt(match[1], 10);
  return number >= 1 && number <= 112 ? number : null;
}

/** Canonical fail-closed proof for the current 112-lane Landing assignment. */
export async function buildLandingFleetProof(sourceSha = resolveProductionSha(), nowMs = Date.now()): Promise<LandingFleetProof> {
  const familyPrefixes = [
    `${LANDING_P0_PREFIX}${sourceSha}:`,
    `${LANDING_P0_REPAIR_PREFIX}${sourceSha}:`,
    `${LANDING_P0_PATROL_PREFIX}${sourceSha}:`,
  ];
  const rows = postgresAtomicQueueSelected()
    ? (await readPostgresFleetLeaseRows()).map((row) => ({ ...row }))
    : (await getAllTasks())
      .filter((task) => task.leaseHolder && task.lastHeartbeatAt)
      .map((task) => ({
        taskId: task.taskId,
        idempotencyKey: task.idempotencyKey,
        state: task.state,
        assignedAgentNumber: task.assignedAgentNumber,
        leaseHolder: task.leaseHolder as string,
        workerInstanceId: null,
        lastHeartbeatAt: task.lastHeartbeatAt as string,
        leaseExpiresAt: task.leaseExpiresAt,
      }));
  const active = rows.filter((row) => familyPrefixes.some((prefix) => row.idempotencyKey.startsWith(prefix)));
  const taskIds = new Set(active.map((row) => row.taskId));
  const holders = new Set(active.map((row) => row.leaseHolder));
  const assigned = new Set(active.map((row) => row.assignedAgentNumber).filter((value): value is number => value !== null));
  const instances = new Set(active.map((row) => row.workerInstanceId).filter((value): value is string => Boolean(value)));
  const countsByAssigned = new Map<number, number>();
  let ownTaskMatches = 0;
  let freshHeartbeats = 0;
  const assignmentMismatches: LandingFleetProof['assignmentMismatches'] = [];
  for (const row of active) {
    if (row.assignedAgentNumber !== null) countsByAssigned.set(row.assignedAgentNumber, (countsByAssigned.get(row.assignedAgentNumber) ?? 0) + 1);
    const holderNumber = holderAgentNumber(row.leaseHolder);
    if (holderNumber !== null && holderNumber === row.assignedAgentNumber) ownTaskMatches += 1;
    else assignmentMismatches.push({ assignedAgentNumber: row.assignedAgentNumber, leaseHolder: row.leaseHolder, taskId: row.taskId });
    const heartbeatMs = Date.parse(row.lastHeartbeatAt);
    const expiryMs = Date.parse(row.leaseExpiresAt ?? '');
    if (row.state === 'RUNNING' && Number.isFinite(heartbeatMs) && heartbeatMs <= nowMs && heartbeatMs >= nowMs - 60_000 && Number.isFinite(expiryMs) && expiryMs > nowMs) freshHeartbeats += 1;
  }
  const missingAgents = Array.from({ length: 112 }, (_, index) => index + 1).filter((agentNumber) => !assigned.has(agentNumber));
  const duplicateAssignedAgents = [...countsByAssigned.entries()].filter(([, count]) => count > 1).map(([agentNumber]) => agentNumber).sort((a, b) => a - b);
  const workerIdentityGate = postgresAtomicQueueSelected() ? active.every(row => Boolean(row.workerInstanceId?.trim())) : true;
  const exact112Working = active.length === 112
    && taskIds.size === 112
    && holders.size === 112
    && assigned.size === 112
    && ownTaskMatches === 112
    && freshHeartbeats === 112
    && missingAgents.length === 0
    && duplicateAssignedAgents.length === 0
    && workerIdentityGate;
  return {
    marker: IVX_LANDING_CONTINUOUS_PATROL_MARKER,
    generatedAt: new Date(nowMs).toISOString(),
    sourceSha,
    exact112Working,
    activeRows: active.length,
    distinctTasks: taskIds.size,
    distinctHolders: holders.size,
    distinctAssignedAgents: assigned.size,
    ownTaskMatches,
    freshHeartbeats,
    workerIdentities: instances.size,
    missingAgents,
    duplicateAssignedAgents,
    assignmentMismatches: assignmentMismatches.slice(0, 20),
    freshnessWindowSeconds: 60,
    evidenceRule: '112 active current-SHA Landing rows + 112 task IDs + 112 lease holders + 112 assigned agents + holder=assignment + heartbeat <=60s + one worker process',
  };
}

export async function runLandingPatrolSession(input: {
  task: Task;
  agentId: string;
  agentNumber: number;
  sourceSha: string;
  shouldContinue: () => boolean;
}): Promise<LandingPatrolSessionResult> {
  const parsed = parseLandingPatrolTaskKey(input.task.idempotencyKey);
  const workerId = `agent:${input.agentId}`;
  const startedAt = input.task.startedAt ?? nowIso();
  const evidenceIds: string[] = [];
  let task = structuredClone(input.task) as Task;
  let lastUnitId: string | null = null;
  let productiveSeconds = 0;
  let lostError: string | null = null;

  if (!parsed || parsed.sha !== input.sourceSha || parsed.agentNumber !== input.agentNumber) {
    await releaseLease(task.taskId, workerId).catch(() => undefined);
    return {
      ok: false,
      action: 'PATROL_SESSION_LOST',
      taskId: task.taskId,
      module: null,
      startedAt,
      finishedAt: nowIso(),
      evidenceIds,
      productiveMinutes: 0,
      error: 'Patrol task identity does not match its source SHA and assigned IA.',
    };
  }

  const state: LandingPatrolLiveState = {
    agentNumber: input.agentNumber,
    agentId: input.agentId,
    taskId: task.taskId,
    sourceSha: input.sourceSha,
    startedAt,
    lastObservationAt: null,
    lastUnitId: null,
    lastStatus: null,
    observations: Math.max(0, task.recordsChanged ?? 0),
    productiveSeconds: 0,
    persistenceErrors: 0,
    lastError: null,
  };
  liveByAgent.set(input.agentNumber, state);

  try {
    // ONE real observation per lease. Never sleep while holding fleet capacity.
    if (input.shouldContinue()) {
      const observationNumber = Math.max(0, task.recordsChanged ?? 0);
      const unit = landingPatrolUnitFor(input.agentNumber, observationNumber);
      lastUnitId = unit.unitId;
      const execution = await executeLandingUnit(unit, {
        agentId: input.agentId,
        agentNumber: input.agentNumber,
        taskId: task.taskId,
        sourceSha: input.sourceSha,
        productionSha: resolveProductionSha(),
        repair: false,
      });
      productiveSeconds += execution.full.productive_seconds;
      const evidence = landingTaskEvidence(execution.record, `continuous-patrol:${unit.unitId}`,
        unit.check.kind === 'ci' ? 'test_result' : 'production_verification');

      try {
        const persisted = await recordLeasedTaskEvidence({
          task,
          workerId,
          evidence,
          maxRetainedEvidence: 24,
          nextObservationAt: new Date(Date.now() + getLandingPatrolIntervalMs()).toISOString(),
        });
        if (!persisted.ok || !persisted.task) {
          state.persistenceErrors += 1;
          state.lastError = persisted.error ?? 'Patrol observation was not persisted.';
          lostError = state.lastError;
        } else {
          task = persisted.task;
          if (persisted.evidenceId) {
            evidenceIds.push(persisted.evidenceId);
            if (execution.record.status === 'FAIL') {
              const { routePersistedLandingFailure } = await import('./ivx-landing-repair-router');
              await routePersistedLandingFailure({ taskId: task.taskId, evidenceId: persisted.evidenceId, agentId: input.agentId, record: execution.record });
            }
          }
          state.lastError = null;
        }
      } catch (error) {
        state.persistenceErrors += 1;
        state.lastError = error instanceof Error ? error.message : String(error);
        lostError = state.lastError;
      }

      state.lastObservationAt = execution.record.completed_at;
      state.lastUnitId = unit.unitId;
      state.lastStatus = execution.record.status;
      state.observations = Math.max(state.observations + 1, task.recordsChanged ?? 0);
      state.productiveSeconds = Math.round(productiveSeconds * 10) / 10;
      liveByAgent.set(input.agentNumber, { ...state });
      console.log('[IVX Landing 24/7 Patrol] observation', {
        agentNumber: input.agentNumber,
        taskId: task.taskId,
        unit: unit.unitId,
        status: execution.record.status,
        productiveSeconds: execution.record.productive_seconds,
        observation: state.observations,
        persisted: state.lastError === null,
        leasePolicy: 'release_after_observation',
      });
    }
  } finally {
    if (!lostError && task.state === 'RUNNING') await releaseLease(task.taskId, workerId).catch(() => undefined);
    liveByAgent.delete(input.agentNumber);
  }

  return {
    ok: lostError === null,
    action: lostError ? 'PATROL_SESSION_LOST' : 'PATROL_SESSION_ENDED',
    taskId: task.taskId,
    module: lastUnitId,
    startedAt,
    finishedAt: nowIso(),
    evidenceIds,
    productiveMinutes: Math.round((productiveSeconds / 60) * 10) / 10,
    error: lostError,
  };
}
