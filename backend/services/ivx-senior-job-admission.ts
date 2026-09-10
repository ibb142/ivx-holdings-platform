type Job = { jobId: string; ownerId: string; status: string; createdAt: string; lastHeartbeatAt?: string | null };
type Dependencies<T extends Job> = {
  read: () => Promise<{ jobs: T[] }>;
  claim: (job: T) => Promise<T | null>;
  claimed: Set<string>;
  active: ReadonlySet<string>;
  staleAfterMs: number;
  stopped: () => boolean;
};

/** Share concurrent selection reads and reserve locally BEFORE the durable claim.
 * Four claim requests can be in flight, while up to 112 admitted jobs may execute.
 * Only PostgreSQL's returned lease authorizes execution across processes.
 */
export function createSeniorJobAdmission<T extends Job>(deps: Dependencies<T>) {
  let reading: Promise<{ jobs: T[] }> | null = null;
  const claimLanes: Promise<unknown>[] = Array.from({ length: 4 }, () => Promise.resolve());
  let nextLane = 0;
  return async (): Promise<T | null> => {
    if (deps.stopped()) return null;
    reading ??= deps.read().finally(() => { reading = null; });
    const queue = await reading;
    if (deps.stopped()) return null;
    const busyOwners = new Set(queue.jobs.filter(job => deps.claimed.has(job.jobId)
      || (job.status !== 'queued' && deps.active.has(job.status)
        && Date.now() - Date.parse(job.lastHeartbeatAt ?? job.createdAt) < deps.staleAfterMs)).map(job => job.ownerId));
    const job = queue.jobs.find(row => row.status === 'queued' && !deps.claimed.has(row.jobId) && !busyOwners.has(row.ownerId));
    if (!job) return null;
    deps.claimed.add(job.jobId);
    const lane = nextLane++ % claimLanes.length;
    const result = claimLanes[lane].then(() => deps.stopped() ? null : deps.claim(job));
    claimLanes[lane] = result.catch(() => undefined);
    try {
      const claimed = await result;
      if (!claimed) deps.claimed.delete(job.jobId);
      return claimed;
    } catch (error) {
      deps.claimed.delete(job.jobId);
      throw error;
    }
  };
}
