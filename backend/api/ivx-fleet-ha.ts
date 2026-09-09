import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import type { FleetInstance } from '../../expo/shared/ivx/fleet-signals';
import { readFleetDashboardSignals } from '../services/ivx-fleet-dashboard-signals';

export async function handleFleetHaGet(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); } catch { return ownerOnlyJson({ ok: false, error: 'Owner authentication required' }, 401); }
  const observation = await readFleetDashboardSignals();
  const instances = observation.instances as Array<FleetInstance & { processRole?: string; sharedState?: boolean; sharedWorkerQueue?: boolean; draining?: boolean }>;
  const current = instances.filter(i => i.commitSha === observation.commitSha && !i.draining
    && i.sharedState && i.sharedWorkerQueue && Date.now() - Date.parse(i.lastSeenAt) >= -5_000 && Date.now() - Date.parse(i.lastSeenAt) <= 45_000);
  const api = current.filter(i => i.role === 'api' && i.processRole === 'api');
  const workers = current.filter(i => i.role === 'worker' && i.processRole === 'worker');
  return ownerOnlyJson({ ok: observation.status === 'AVAILABLE', marker: 'ivx-api-worker-ha-2026-09-08-v1',
    measuredAt: observation.measuredAt, commitSha: observation.commitSha, requiredInstancesPerRole: 2,
    ready: api.length >= 2 && workers.length >= 2, apiInstances: api, workerInstances: workers,
    fleet: observation.counts, scope: 'API and worker process redundancy with shared PostgreSQL state',
    recoveryTestRequired: true, databaseFailoverTested: false }, observation.status === 'AVAILABLE' ? 200 : 503);
}
