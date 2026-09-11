export type OwnerQueueWorkerObservation = {
  worker_id: string; source_sha: string; instance_id: string;
  state: string; last_seen_at: string;
};

type ProviderObservation = { state: string; lastHttpStatus: number | null; lastValidationTime: string | null };

/** A cold process needs an actual completion before claiming work. Failed probes
 * are bounded to one per minute and never run while owner execution is paused. */
export function createOwnerQueueProviderGate(deps: {
  configured: () => boolean; health: () => ProviderObservation;
  validate: () => Promise<unknown>; now?: () => number;
}) {
  let nextProbeAt = 0;
  let probing = false;
  const ready = () => {
    const observed = deps.health();
    return ['PROVIDER_READY', 'FALLBACK_READY'].includes(observed.state)
      && observed.lastHttpStatus === 200 && Number.isFinite(Date.parse(observed.lastValidationTime ?? ''));
  };
  return async (authorized: boolean) => {
    if (!authorized || !deps.configured()) return false;
    if (ready()) return true;
    const now = (deps.now ?? Date.now)();
    if (probing || now < nextProbeAt) return false;
    probing = true;
    nextProbeAt = now + 60_000;
    try { await deps.validate(); return ready(); }
    catch { return false; }
    finally { probing = false; }
  };
}

export function ownerQueueWorkerReadiness(rows: unknown, sourceSha: string, now = Date.now()) {
  if (!Array.isArray(rows) || rows.length > 10 || !/^[a-f0-9]{40}$/.test(sourceSha)) {
    return { ready: false, workers: [], reason: 'Invalid worker observation' };
  }
  const workers = rows.filter((row): row is OwnerQueueWorkerObservation => {
    if (!row || typeof row.worker_id !== 'string' || !row.worker_id || typeof row.instance_id !== 'string' || !row.instance_id) return false;
    const age = now - Date.parse(row.last_seen_at);
    return row.source_sha === sourceSha && row.state === 'ready' && Number.isFinite(age) && age >= -5_000 && age < 75_000;
  });
  const unique = [...new Map(workers.map(row => [row.instance_id, row])).values()];
  return { ready: unique.length > 0, workers: unique, reason: unique.length ? null : 'No fresh authorized worker on this SHA' };
}
