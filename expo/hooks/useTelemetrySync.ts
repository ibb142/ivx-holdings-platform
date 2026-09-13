import { visibleFleetSignals } from '../shared/ivx/fleet-signals';
import type { AutonomousOpsDashboard, DashboardStreamMeta } from '../src/modules/ivx-owner-ai/services/ivxAutonomousOpsService';

/** Derived on each render: reconnect state is reactive, while retained rows are
 * historical display data until a complete, current evidence sample arrives. */
export function useTelemetrySync(data: AutonomousOpsDashboard | null, state: DashboardStreamMeta['state'], now: number) {
  const observed = visibleFleetSignals(data?.fleetSignals, now);
  const signals = observed && observed.commitSha === data?.backendCommitSha ? observed : null;
  const isNetworkReconnecting = ['CONNECTING', 'AUTHENTICATING', 'RECONNECTING', 'ERROR'].includes(state);
  const displayStatus = !signals ? 'TELEMETRY_DEGRADED · PRODUCTIVITY UNKNOWN'
    : state === 'LIVE' ? 'TELEMETRY LIVE' : 'RECENT SNAPSHOT · RECONNECTING';
  return { agents: data?.agents ?? [], signals, displayStatus, isNetworkReconnecting };
}
