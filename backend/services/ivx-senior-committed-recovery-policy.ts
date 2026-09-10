type CommittedJob = {
  status: string;
  startedAt?: string | null;
  lastHeartbeatAt?: string | null;
  leaseExpiresAt?: string | null;
  result?: { commitSha?: string | null; prMerged?: boolean } | null;
};

const RECOVERABLE_STATUSES = new Set([
  'queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying',
]);

/** A persisted commit owns the next action even if an earlier retry left the
 * phase behind. Recovery only acquires an expired physical lease; it never
 * recodes the task or certifies the commit's PR/CI/production evidence.
 */
export function isCommittedRecoveryCandidate(job: CommittedJob, now: number, staleAfterMs: number): boolean {
  if (!RECOVERABLE_STATUSES.has(job.status) || !job.result?.commitSha || job.result.prMerged === true) return false;
  const activityAt = Date.parse(job.lastHeartbeatAt ?? job.startedAt ?? '');
  if (!Number.isFinite(activityAt) || now - activityAt < staleAfterMs) return false;
  if (job.leaseExpiresAt != null) {
    const expiresAt = Date.parse(job.leaseExpiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt > now) return false;
  }
  return true;
}

/** A failure after commit publication must preserve the durable checkpoint.
 * Transient failures resume verification; other failures retain the evidence
 * in BLOCKED. Neither path creates a new coding attempt.
 */
export function committedFailurePatch<T extends { commitSha?: string | null }>(
  job: { status: string; result?: T | null }, message: string, transient: boolean, now: string,
) {
  if (!RECOVERABLE_STATUSES.has(job.status) || !job.result?.commitSha) return null;
  return {
    status: transient ? 'committing' as const : 'blocked' as const,
    stage: transient ? 'COMMITTING' as const : 'FAILED' as const,
    stageDetail: transient
      ? `Committed work retained for verification recovery: ${message}`
      : `Committed work blocked with evidence preserved: ${message}`,
    error: message,
    finishedAt: transient ? null : now,
    result: transient ? job.result : {
      ...job.result, ok: false, finalStatus: 'BLOCKED' as const,
      endToEndProductionComplete: false, error: message,
    },
  };
}
