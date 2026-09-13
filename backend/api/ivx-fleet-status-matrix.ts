import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import { IVXAuthServiceUnavailableError } from '../../expo/shared/ivx';
import { visibleFleetSignals } from '../../expo/shared/ivx/fleet-signals';
import { readFleetDashboardSignals } from '../services/ivx-fleet-dashboard-signals';
import { ALL_AGENT_CONTRACTS } from '../services/ivx-agent-contracts';

type Dependencies = {
  authorize: (request: Request) => Promise<unknown>;
  read: typeof readFleetDashboardSignals;
  now: () => number;
};

/** Owner-only projection of the existing lease-backed fleet observation. */
export async function handleFleetStatusMatrixRequest(request: Request, deps: Dependencies = {
  authorize: assertIVXOwnerOnly, read: readFleetDashboardSignals, now: Date.now,
}): Promise<Response> {
  try { await deps.authorize(request); }
  catch (error) {
    return ownerOnlyJson({ ok: false, error: 'Fleet telemetry requires verified Owner access.' },
      error instanceof IVXAuthServiceUnavailableError ? 503 : 401);
  }
  let signals;
  try { signals = visibleFleetSignals(await deps.read(), deps.now()); }
  catch { signals = null; }
  if (!signals) return ownerOnlyJson({ ok: false, status: 'UNKNOWN', generatedAt: null,
    fleetSize: ALL_AGENT_CONTRACTS.length, runningCount: null, matrix: [],
    error: 'Fresh shared fleet telemetry is unavailable.' }, 503);

  const byNumber = new Map(signals.agents.map(agent => [agent.agentNumber, agent]));
  const matrix = ALL_AGENT_CONTRACTS.map(contract => {
    const signal = byNumber.get(contract.agentNumber)!;
    const realTimeStatus = !signal.heartbeatAt ? 'NO_TELEMETRY'
      : !signal.heartbeatFresh ? 'STALE'
      : signal.running && signal.activeTaskId ? 'ACTIVE_RUNNING'
      : signal.assignedTasks > 0 ? 'QUEUED' : 'IDLE';
    return { agent_id: contract.agentId, agent_number: contract.agentNumber, agent_name: contract.agentName,
      real_time_execution_status: realTimeStatus, last_heartbeat: signal.heartbeatAt,
      heartbeat_source: signal.heartbeatSource, task_id: signal.activeTaskId,
      assigned_tasks: signal.assignedTasks, productive: signal.productive, evidence: signal.evidence,
      control: signal.control ?? null };
  });
  return ownerOnlyJson({ ok: true, status: 'AVAILABLE', generatedAt: signals.measuredAt,
    servedAt: new Date(deps.now()).toISOString(), commitSha: signals.commitSha,
    fleetSize: matrix.length, runningCount: matrix.filter(row => row.real_time_execution_status === 'ACTIVE_RUNNING').length,
    matrix });
}
