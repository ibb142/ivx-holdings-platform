/**
 * IVX Duplicate Worker Prevention
 *
 * Owner mandate 2026-07-20 Phase 12: audit whether duplicate jobs are being
 * created and fix task deduplication, idempotency keys, worker leasing, job
 * ownership, retry identification, parent/child task relationships, and
 * duplicate evidence rejection.
 *
 * Do not count duplicate redeploys as separate completed development tasks.
 */

export const IVX_DUPLICATE_WORKER_PREVENTION_MARKER = 'ivx-duplicate-worker-prevention-2026-07-20';

/**
 * Idempotency key computed from the owner request. Two identical requests
 * (same owner + same normalized goal + same approval context) produce the
 * same idempotency key, so the second one attaches to the first job instead
 * of creating a duplicate.
 */
export function computeIdempotencyKey(input: {
  ownerId: string;
  goal: string;
  approvalPhrase?: string | null;
  executionMode?: string | null;
}): string {
  const normalizedGoal = input.goal
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .trim()
    .slice(0, 500);
  const approval = input.approvalPhrase ? 'approved' : 'unapproved';
  const mode = input.executionMode ?? 'default';
  return `idem:${input.ownerId}:${mode}:${approval}:${hashString(normalizedGoal)}`;
}

function hashString(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h).toString(36);
}

/**
 * Leasing: a worker lease grants a single worker exclusive ownership of a job
 * for a bounded duration. If the worker dies, the lease expires and another
 * worker may claim the job. This prevents two workers from processing the
 * same job simultaneously.
 */
export type IVXWorkerLease = {
  jobId: string;
  workerId: string;
  acquiredAt: string;
  expiresAt: string;
  heartbeatAt: string;
};

export type IVXLeaseStore = {
  acquire(jobId: string, workerId: string, ttlMs: number): IVXWorkerLease | null;
  renew(jobId: string, workerId: string, ttlMs: number): IVXWorkerLease | null;
  release(jobId: string, workerId: string): boolean;
  current(jobId: string): IVXWorkerLease | null;
};

/**
 * In-memory lease store (sufficient for single-instance Render; for
 * multi-instance, swap for a Redis-backed store).
 */
export function createInMemoryLeaseStore(): IVXLeaseStore {
  const leases = new Map<string, IVXWorkerLease>();

  function now(): string {
    return new Date().toISOString();
  }

  function expired(lease: IVXWorkerLease): boolean {
    return new Date(lease.expiresAt).getTime() < Date.now();
  }

  return {
    acquire(jobId, workerId, ttlMs) {
      const existing = leases.get(jobId);
      if (existing && !expired(existing) && existing.workerId !== workerId) {
        return null; // held by another worker
      }
      const lease: IVXWorkerLease = {
        jobId,
        workerId,
        acquiredAt: now(),
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        heartbeatAt: now(),
      };
      leases.set(jobId, lease);
      return lease;
    },
    renew(jobId, workerId, ttlMs) {
      const existing = leases.get(jobId);
      if (!existing || existing.workerId !== workerId) {
        return null;
      }
      const lease: IVXWorkerLease = {
        ...existing,
        expiresAt: new Date(Date.now() + ttlMs).toISOString(),
        heartbeatAt: now(),
      };
      leases.set(jobId, lease);
      return lease;
    },
    release(jobId, workerId) {
      const existing = leases.get(jobId);
      if (!existing || existing.workerId !== workerId) {
        return false;
      }
      leases.delete(jobId);
      return true;
    },
    current(jobId) {
      const existing = leases.get(jobId);
      if (!existing) return null;
      if (expired(existing)) {
        leases.delete(jobId);
        return null;
      }
      return existing;
    },
  };
}

/**
 * Duplicate evidence rejection. When a worker produces a result with the same
 * commitSha + deployId + filesChanged as a prior job, the evidence is a
 * duplicate and must NOT be counted as a separate completed development task.
 */
export type IVXEvidenceFingerprint = {
  commitSha: string | null;
  deployId: string | null;
  filesChanged: string[];
  finalStatus: string;
};

export function fingerprintEvidence(input: IVXEvidenceFingerprint): string {
  const files = [...input.filesChanged].sort().join(',');
  return `ev:${input.commitSha ?? 'none'}:${input.deployId ?? 'none'}:${files}:${input.finalStatus}`;
}

export type IVXDedupResult = {
  isDuplicate: boolean;
  priorJobId: string | null;
  reason: string;
};

/**
 * Check whether a new result's evidence fingerprint matches a prior job's
 * fingerprint. If so, the new result is a duplicate and must be rejected as a
 * separate completed development task.
 */
export function checkDuplicateEvidence(
  newFingerprint: string,
  priorFingerprints: { jobId: string; fingerprint: string }[],
): IVXDedupResult {
  const match = priorFingerprints.find((p) => p.fingerprint === newFingerprint);
  if (match) {
    return {
      isDuplicate: true,
      priorJobId: match.jobId,
      reason: `Evidence fingerprint matches prior job ${match.jobId} — this is a duplicate redeploy, not a new completed development task.`,
    };
  }
  return { isDuplicate: false, priorJobId: null, reason: 'Unique evidence fingerprint.' };
}

/**
 * Parent/child task relationship. A child task (e.g. a retry) must reference
 * its parent task id so the ledger can group them and avoid counting retries
 * as separate completions.
 */
export type IVXTaskRelationship = {
  taskId: string;
  parentTaskId: string | null;
  retryOf: string | null;
};

export function isRetry(relationship: IVXTaskRelationship): boolean {
  return relationship.retryOf !== null;
}

/**
 * Normalize a worker stage string for retry identification. A retry should
 * have the same normalized goal as its parent.
 */
export function normalizeGoalForRetry(goal: string): string {
  // Strip runId parentheticals like "(run-1784565002)" that make otherwise-
  // identical prompts look unique.
  return goal
    .replace(/\(run[-_]?\d+\)/gi, '')
    .replace(/\(qa[-_]?final[-_]?\d+\)/gi, '')
    .replace(/\(focus[-_]?verified[-_]?<[^>]*>\)/gi, '')
    .replace(/\(validator[-_]?check[-_]?\d+\)/gi, '')
    .replace(/\(honesty[-_]?final[-_]?\d+\)/gi, '')
    .replace(/\(live[-_]?honesty[-_]?check[-_]?\d+\)/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
