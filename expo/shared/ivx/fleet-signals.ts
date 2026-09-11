/** Shared transport contract. Presence, allocation and productivity are independent. */
export type FleetPatrolObservation = {
  taskId: string; evidenceId: string; outcome: 'PASS' | 'FAIL' | 'BLOCKED';
  source: string; contentHash: string; commitSha: string;
  startedAt: string; completedAt: string; recordedAt: string;
};
export type AgentFleetSignal = {
  agentNumber: number; heartbeatAt: string | null; heartbeatFresh: boolean;
  heartbeatSource: 'agent_state' | 'task_lease' | null;
  assignedTasks: number; running: boolean; activeTaskId: string | null;
  productive: boolean; evidence: { taskId: string; evidenceId: string; source: string; contentHash: string; createdAt: string; commitSha: string } | null;
  observation?: FleetPatrolObservation | null;
};
export type FleetInstance = { instanceId: string; role: 'api' | 'worker'; commitSha: string; serviceId: string; lastSeenAt: string };
export type FleetDashboardSignals = {
  marker: 'ivx-fleet-signals-2026-09-08-v1'; status: 'AVAILABLE' | 'UNKNOWN'; measuredAt: string | null;
  commitSha: string; maxAgeMs: number; evidenceWindowMs: number; error: string | null;
  counts: { heartbeat: number | null; assigned: number | null; running: number | null; productive: number | null; observed?: number | null };
  agents: AgentFleetSignal[]; instances: FleetInstance[];
};

/** Expire evidence even when a disconnected client still has its last snapshot. */
export function visibleFleetSignals(signals: FleetDashboardSignals | null | undefined, now = Date.now()): FleetDashboardSignals | null {
  if (!signals || signals.status !== 'AVAILABLE' || signals.agents.length !== 112) return null;
  const age = now - Date.parse(signals.measuredAt ?? '');
  if (!Number.isFinite(age) || age < -1000 || age > Math.min(signals.maxAgeMs, 15_000)) return null;
  const ids = new Set(signals.agents.map(a => a.agentNumber));
  if (ids.size !== 112 || signals.agents.some(a => !Number.isInteger(a.agentNumber) || a.agentNumber < 1 || a.agentNumber > 112)) return null;
  const counts = {
    heartbeat: signals.agents.filter(a => a.heartbeatFresh).length,
    assigned: signals.agents.filter(a => a.assignedTasks > 0).length,
    running: signals.agents.filter(a => a.running).length,
    productive: signals.agents.filter(a => a.productive && a.evidence?.commitSha === signals.commitSha).length,
  };
  if (Object.entries(counts).some(([key, count]) => count !== signals.counts[key as keyof typeof counts])) return null;
  if (signals.counts.observed != null) {
    const observations = signals.agents.filter(a => a.observation);
    if (observations.length !== signals.counts.observed || observations.some(a => {
      const o = a.observation!;
      const age = now - Date.parse(o.completedAt), storedAge = now - Date.parse(o.recordedAt);
      return o.commitSha !== signals.commitSha || !o.taskId || !o.evidenceId
        || !['PASS', 'FAIL', 'BLOCKED'].includes(o.outcome)
        || !Number.isFinite(age) || age < 0 || age > 120_000
        || !Number.isFinite(storedAge) || storedAge < 0 || storedAge > 120_000;
    })) return null;
  }
  return signals;
}
