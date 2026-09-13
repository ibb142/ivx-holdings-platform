import { visibleFleetSignals, type AgentFleetSignal, type FleetDashboardSignals } from './fleet-signals';

export type LiveFleetStatus = 'RUNNING' | 'ASSIGNED' | 'IDLE' | 'UNKNOWN';
export type LiveFleetAgent = {
  agentNumber: number; agentId: string; name: string; department: string;
  primaryResponsibility: string; status: LiveFleetStatus; currentTask: string | null;
  lastActivityTime: string | null; lastSourceReference: string | null; lastEvidenceSha: string | null;
  signals: AgentFleetSignal;
};
export type LiveFleetPayload = {
  ok: true;
  dashboard: {
    marker: string; view: 'live'; generatedAt: string; registryCount: number;
    fleetSignals: FleetDashboardSignals; agents: LiveFleetAgent[];
    historyAvailable: false;
  };
};

export function liveFleetAgentStatus(signal: AgentFleetSignal): LiveFleetStatus {
  if (signal.running) return 'RUNNING';
  if (signal.assignedTasks > 0) return 'ASSIGNED';
  return signal.heartbeatFresh ? 'IDLE' : 'UNKNOWN';
}

/** Reject incomplete rosters and snapshots whose source time has expired. */
export function parseLiveFleetPayload(value: unknown, now = Date.now()): LiveFleetPayload {
  const payload = value as LiveFleetPayload | null;
  const dashboard = payload?.dashboard;
  const signals = dashboard?.fleetSignals;
  if (payload?.ok !== true || dashboard?.view !== 'live' || dashboard.registryCount !== 112
    || !Array.isArray(dashboard.agents) || dashboard.agents.length !== 112
    || !signals || !Array.isArray(signals.agents) || !signals.counts
    || !Number.isFinite(signals.maxAgeMs) || signals.maxAgeMs <= 0
    || !/^[a-f0-9]{40}$/i.test(signals.commitSha)
    || dashboard.generatedAt !== signals.measuredAt || !visibleFleetSignals(signals, now)) {
    throw new Error('La telemetría está incompleta o desactualizada.');
  }
  const byNumber = new Map(signals.agents.map(signal => [signal.agentNumber, signal]));
  const ids = new Set<number>();
  const agentIds = new Set<string>();
  for (const agent of dashboard.agents) {
    const signal = byNumber.get(agent.agentNumber);
    if (!signal || ids.has(agent.agentNumber) || agentIds.has(agent.agentId)
      || typeof agent.agentId !== 'string' || !agent.agentId || typeof agent.name !== 'string' || !agent.name
      || agent.status !== liveFleetAgentStatus(signal) || agent.currentTask !== signal.activeTaskId) {
      throw new Error('El registro de la flota no coincide con la telemetría.');
    }
    ids.add(agent.agentNumber); agentIds.add(agent.agentId);
  }
  return payload;
}

export function currentLiveFleet(payload: LiveFleetPayload | null, error: string | null, now = Date.now()): LiveFleetPayload['dashboard'] | null {
  if (!payload || error) return null;
  try { return parseLiveFleetPayload(payload, now).dashboard; } catch { return null; }
}

/** The deadline includes token retrieval and body decoding, not just HTTP headers. */
export async function fetchLiveFleet(options: {
  url: string; getToken: () => Promise<string | null>; signal: AbortSignal;
  fetch?: typeof fetch; timeoutMs?: number;
}): Promise<LiveFleetPayload> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    stop = () => { controller.abort(); reject(new Error('FLEET_REQUEST_CANCELLED')); };
    options.signal.addEventListener('abort', stop, { once: true });
    if (options.signal.aborted) stop();
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error('La telemetría tardó demasiado. Se reintentará.'));
    }, options.timeoutMs ?? 10_000);
  });
  const request = async () => {
    const token = await options.getToken();
    if (controller.signal.aborted) throw new Error('FLEET_REQUEST_CANCELLED');
    if (!token) throw new Error('Inicia sesión como owner para ver la flota.');
    const response = await (options.fetch ?? fetch)(options.url, {
      headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
    });
    const body = await response.json();
    if (!response.ok || body?.ok !== true) {
      if (response.status === 401 || response.status === 403) throw new Error('La sesión no permite consultar la flota.');
      throw new Error('Telemetría no disponible. Se reintentará.');
    }
    return parseLiveFleetPayload(body);
  };
  try { return await Promise.race([request(), cancelled]); }
  finally { clearTimeout(timer); options.signal.removeEventListener('abort', stop); }
}
