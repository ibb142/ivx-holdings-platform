import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import { IVXAuthServiceUnavailableError } from '../../expo/shared/ivx';
import { liveFleetAgentStatus, parseLiveFleetPayload, type LiveFleetPayload } from '../../expo/shared/ivx/live-fleet-dashboard';
import { ALL_AGENT_CONTRACTS } from '../services/ivx-agent-contracts';
import { getAgentByNumber } from '../services/ivx-enterprise-master-registry';
import { readFleetDashboardSignals } from '../services/ivx-fleet-dashboard-signals';
import { createDashboardReadCache } from '../services/ivx-dashboard-read-cache';

// The existing reader uses the observer lane and authoritative task leases.
// Coalesce concurrent polls; this view never reads the execution history ledger.
const readLive = createDashboardReadCache(readFleetDashboardSignals, value => value.status === 'AVAILABLE', 1000);

export async function handleLiveFleetDashboardRequest(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); }
  catch (error) {
    const unavailable = error instanceof IVXAuthServiceUnavailableError;
    const missing = error instanceof Error && /missing bearer/i.test(error.message);
    return ownerOnlyJson({ ok: false, error: unavailable ? 'AUTH_SERVICE_UNAVAILABLE' : 'OWNER_AUTH_REQUIRED' }, unavailable ? 503 : missing ? 401 : 403);
  }
  try {
    const { value: fleetSignals } = await readLive();
    if (fleetSignals.status !== 'AVAILABLE' || !fleetSignals.measuredAt) throw new Error('Unavailable fleet observation');
    const byNumber = new Map(fleetSignals.agents.map(signal => [signal.agentNumber, signal]));
    const payload: LiveFleetPayload = { ok: true, dashboard: {
      marker: 'ivx-live-fleet-dashboard-2026-09-13', view: 'live',
      generatedAt: fleetSignals.measuredAt, registryCount: ALL_AGENT_CONTRACTS.length,
      historyAvailable: false, fleetSignals,
      agents: ALL_AGENT_CONTRACTS.map(contract => {
        const signal = byNumber.get(contract.agentNumber);
        if (!signal) throw new Error('Incomplete fleet observation');
        const meta = getAgentByNumber(contract.agentNumber);
        return {
          agentNumber: contract.agentNumber, agentId: contract.agentId, name: contract.agentName,
          department: meta?.functionalGroup ?? String(contract.divisionId),
          primaryResponsibility: meta?.mission ?? contract.mission,
          status: liveFleetAgentStatus(signal), currentTask: signal.activeTaskId,
          lastActivityTime: signal.heartbeatAt, lastSourceReference: signal.evidence?.source ?? null,
          lastEvidenceSha: signal.evidence?.contentHash ?? null, signals: signal,
        };
      }),
    } };
    parseLiveFleetPayload(payload);
    return ownerOnlyJson(payload);
  } catch {
    return ownerOnlyJson({ ok: false, error: 'FLEET_TELEMETRY_UNAVAILABLE', retryable: true }, 503);
  }
}
