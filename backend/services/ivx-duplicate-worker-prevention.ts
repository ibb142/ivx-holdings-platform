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

// ─────────────────────────────────────────────────────────────────────────────
// PER-OWNER TASK SCOPE MATCHING (single-flight attach safety)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Chat handoffs append attachment metadata to worker goals. Strip it before
 * comparing task scope so a re-sent command with the same screenshot still
 * matches its own running job.
 */
const ATTACHMENT_CONTEXT_MARKER = 'OWNER ATTACHMENTS FOR THIS ENGINEERING TASK:';

/** Words that carry no task identity. */
const SCOPE_STOPWORDS = new Set([
  'the', 'a', 'an', 'this', 'that', 'these', 'those', 'it', 'its', 'is', 'are',
  'was', 'were', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'now',
  'please', 'i', 'you', 'my', 'our', 'me', 'do', 'can', 'could', 'will',
  'would', 'should', 'with', 'end', 'end-to-end', 'e2e',
]);

/**
 * Words that can only form a follow-up/confirmation command (never a new
 * task on their own). A goal made exclusively of these words attaches.
 */
const FOLLOW_UP_WORDS = new Set([
  'yes', 'ok', 'okay', 'go', 'ahead', 'proceed', 'continue', 'do', 'it', 'run',
  'keep', 'going', 'again', 'repeat', 'retry', 'resume', 'confirm', 'now',
  'please', 'task', 'job',
]);

function isFollowUpCommand(normalizedGoal: string): boolean {
  const plain = normalizedGoal
    .replace(/[^a-z0-9\s/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!plain) return false;
  if (plain.startsWith('/confirm')) return true;
  const words = plain.split(' ').filter(Boolean);
  return words.length > 0 && words.every((word) => FOLLOW_UP_WORDS.has(word));
}

function scopeTokens(goal: string): Set<string> {
  return new Set(
    goal
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !SCOPE_STOPWORDS.has(token)),
  );
}

/**
 * Decide whether a new owner command belongs to the owner's currently active
 * job (attach/reuse) or is a DIFFERENT task that must be enqueued separately.
 *
 * Rules:
 *   - identical normalized goals (attachment context stripped) → same task
 *   - short follow-up/confirmation commands → same task
 *   - token-set Jaccard similarity >= 0.5 → same task
 *   - anything else → different task (never attach, never lose the command)
 */
export function isSameTaskScope(newGoal: string, activeGoal: string): boolean {
  const stripContext = (goal: string): string => goal.split(ATTACHMENT_CONTEXT_MARKER)[0];
  const a = normalizeGoalForRetry(stripContext(newGoal ?? ''));
  const b = normalizeGoalForRetry(stripContext(activeGoal ?? ''));
  if (!a || !b) return false;
  if (a === b) return true;
  if (isFollowUpCommand(a)) return true;

  const tokensA = scopeTokens(a);
  const tokensB = scopeTokens(b);
  if (tokensA.size === 0 || tokensB.size === 0) return false;
  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection += 1;
  const union = new Set([...tokensA, ...tokensB]).size;
  return intersection / union >= 0.5;
}
