import type { Task } from './ivx-autonomous-task-engine';
import { fleetTaskSignals, FLEET_EVIDENCE_WINDOW_MS } from './ivx-fleet-slo';
import { resolveProductionSha } from './ivx-landing-p0-backlog';
import { readPostgresFleetDashboardObservation, readPostgresPatrolObservations } from './ivx-postgres-autonomous-task-store';
import type { PatrolObservation } from './ivx-autonomous-recovery-health';
import { verifiedPatrolObservations } from './ivx-fleet-patrol-observations';

export const FLEET_SIGNAL_MAX_AGE_MS = 15_000;
import type { AgentFleetSignal, FleetDashboardSignals, FleetInstance } from '../../expo/shared/ivx/fleet-signals';
export type { AgentFleetSignal, FleetDashboardSignals } from '../../expo/shared/ivx/fleet-signals';
type Observation = {
  measuredAt: string; states: Array<{ agentNumber: number; lastHeartbeatAt: string | null }>;
  assignments: Array<{ agentNumber: number; taskCount: number }>; activeTasks: Task[];
  instances: FleetInstance[];
  patrolObservations?: PatrolObservation[];
};
export function buildFleetDashboardSignals(raw: unknown, sha: string, now = Date.now()): FleetDashboardSignals {
  const value = raw as Observation;
  if (!/^[a-f0-9]{40}$/i.test(sha) || !value || !Array.isArray(value.states) || !Array.isArray(value.assignments)
    || !Array.isArray(value.activeTasks) || value.activeTasks.length > 1000 || !Array.isArray(value.instances)) throw new Error('Incomplete fleet observation');
  const measured = Date.parse(value.measuredAt);
  if (!Number.isFinite(measured) || measured > now + 1000 || now - measured > FLEET_SIGNAL_MAX_AGE_MS) throw new Error('Stale fleet observation');
  const agents: AgentFleetSignal[] = Array.from({ length: 112 }, (_, i) => ({ agentNumber: i + 1, heartbeatAt: null,
    heartbeatFresh: false, heartbeatSource: null, assignedTasks: 0, running: false, activeTaskId: null, productive: false, evidence: null }));
  const heartbeat = (a: AgentFleetSignal, at: string | null, source: AgentFleetSignal['heartbeatSource']) => {
    const timestamp = Date.parse(at ?? '');
    if (!Number.isFinite(timestamp) || timestamp > measured || timestamp <= Date.parse(a.heartbeatAt ?? '1970-01-01')) return;
    a.heartbeatAt = at; a.heartbeatFresh = measured - timestamp <= 60_000; a.heartbeatSource = source;
  };
  for (const row of value.states) { const a = agents[row.agentNumber - 1]; if (a) heartbeat(a, row.lastHeartbeatAt, 'agent_state'); }
  for (const row of value.assignments) {
    const a = agents[row.agentNumber - 1];
    if (!a || !Number.isInteger(row.taskCount) || row.taskCount < 0) throw new Error('Invalid assignment observation');
    a.assignedTasks = row.taskCount;
  }
  for (const task of value.activeTasks) {
    const s = fleetTaskSignals(task, measured, sha); const a = agents[s.agentNumber - 1];
    if (!a || !s.activeLease) continue;
    heartbeat(a, task.lastHeartbeatAt, 'task_lease');
    a.running ||= s.running;
    if (!a.activeTaskId || s.running) a.activeTaskId = task.taskId;
    if (s.evidence) {
      a.productive = true;
      a.evidence = { taskId: task.taskId, evidenceId: s.evidence.evidenceId, source: s.evidence.source,
        contentHash: s.evidence.contentHash, createdAt: s.evidence.createdAt, commitSha: sha };
    }
  }
  const observations = value.patrolObservations === undefined ? null : verifiedPatrolObservations(value.patrolObservations, sha, measured);
  for (const a of agents) a.observation = observations?.get(a.agentNumber) ?? null;
  return { marker: 'ivx-fleet-signals-2026-09-08-v1', status: 'AVAILABLE', measuredAt: value.measuredAt, commitSha: sha,
    maxAgeMs: FLEET_SIGNAL_MAX_AGE_MS, evidenceWindowMs: FLEET_EVIDENCE_WINDOW_MS, error: null, agents,
    counts: { heartbeat: agents.filter(a => a.heartbeatFresh).length, assigned: agents.filter(a => a.assignedTasks > 0).length,
      running: agents.filter(a => a.running).length, productive: agents.filter(a => a.productive).length,
      observed: observations?.size ?? null },
    instances: value.instances };
}
/** Optional patrol reads cannot stall the primary dashboard or amplify an outage. */
export function createFleetDashboardReader(deps: {
  base: () => Promise<unknown>; patrol: (sha: string) => Promise<PatrolObservation[]>;
  sha: () => string; now: () => number;
}) {
  let pending: Promise<void> | null = null, nextReadAt = 0;
  let latest: { sha: string; startedAt: number; rows: PatrolObservation[] } | null = null;
  return async (): Promise<FleetDashboardSignals> => {
    const sha = deps.sha(), startedAt = deps.now();
    if (!pending && startedAt >= nextReadAt) {
      nextReadAt = startedAt + FLEET_SIGNAL_MAX_AGE_MS;
      pending = Promise.resolve().then(() => deps.patrol(sha))
        .then(rows => { latest = { sha, startedAt, rows }; })
        .catch(() => { latest = null; })
        .finally(() => { pending = null; });
    }
    try {
      const base = await deps.base(), now = deps.now();
      const patrol = latest?.sha === sha && now >= latest.startedAt && now - latest.startedAt <= FLEET_SIGNAL_MAX_AGE_MS
        ? latest.rows : undefined;
      return buildFleetDashboardSignals({ ...(base as Observation),
        ...(patrol ? { patrolObservations: patrol } : {}) }, sha, now);
    } catch { return { marker: 'ivx-fleet-signals-2026-09-08-v1', status: 'UNKNOWN', measuredAt: null, commitSha: sha,
      maxAgeMs: FLEET_SIGNAL_MAX_AGE_MS, evidenceWindowMs: FLEET_EVIDENCE_WINDOW_MS, error: 'Shared fleet observation unavailable',
      counts: { heartbeat: null, assigned: null, running: null, productive: null, observed: null }, agents: [], instances: [] }; }
  };
}
export const readFleetDashboardSignals = createFleetDashboardReader({ base: readPostgresFleetDashboardObservation,
  patrol: readPostgresPatrolObservations, sha: resolveProductionSha, now: Date.now });
