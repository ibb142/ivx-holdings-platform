import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
import { readPostgresFleetProcessObservation } from '../services/ivx-postgres-autonomous-task-store';
import { resolveProductionSha } from '../services/ivx-landing-p0-backlog';

export async function handleFleetHaGet(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); } catch { return ownerOnlyJson({ ok: false, error: 'Owner authentication required' }, 401); }
  const commitSha = resolveProductionSha();
  try {
    const observation = await readPostgresFleetProcessObservation();
    const age = Date.now() - Date.parse(observation.measuredAt);
    if (!Number.isFinite(age) || age < -10_000 || age > 30_000) throw new Error('Stale process observation');
    const current = observation.instances.filter(i => i.commitSha === commitSha && !i.draining
      && i.sharedState && i.sharedWorkerQueue && Date.now() - Date.parse(i.lastSeenAt) >= -5_000 && Date.now() - Date.parse(i.lastSeenAt) <= 45_000);
    const api = current.filter(i => i.role === 'api' && i.processRole === 'api');
    const workers = current.filter(i => i.role === 'worker' && i.processRole === 'worker');
    return ownerOnlyJson({ ok: true, marker: 'ivx-api-worker-ha-2026-09-08-v1',
      measuredAt: observation.measuredAt, commitSha, requiredInstancesPerRole: 2,
      ready: api.length >= 2 && workers.length >= 2, apiInstances: api, workerInstances: workers,
      scope: 'API and worker process redundancy with shared PostgreSQL state',
      recoveryTestRequired: true, databaseFailoverTested: false });
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Shared process observation unavailable', commitSha,
      ready: false, measuredAt: null, apiInstances: [], workerInstances: [] }, 503);
  }
}
