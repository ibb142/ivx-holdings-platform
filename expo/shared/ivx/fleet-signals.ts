/** Shared transport contract. Presence, allocation and productivity are independent. */
export type AgentFleetSignal = {
  agentNumber: number; heartbeatAt: string | null; heartbeatFresh: boolean;
  heartbeatSource: 'agent_state' | 'task_lease' | null;
  assignedTasks: number; running: boolean; activeTaskId: string | null;
  productive: boolean; evidence: { taskId: string; evidenceId: string; source: string; contentHash: string; createdAt: string; commitSha: string } | null;
};
export type FleetInstance = { instanceId: string; role: 'api' | 'worker'; commitSha: string; serviceId: string; lastSeenAt: string };
export type FleetDashboardSignals = {
  marker: 'ivx-fleet-signals-2026-09-08-v1'; status: 'AVAILABLE' | 'UNKNOWN'; measuredAt: string | null;
  commitSha: string; maxAgeMs: number; evidenceWindowMs: number; error: string | null;
  counts: { heartbeat: number | null; assigned: number | null; running: number | null; productive: number | null };
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
  return signals;
}
