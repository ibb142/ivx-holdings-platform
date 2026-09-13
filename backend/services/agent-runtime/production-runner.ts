import { CandidateStore, type CandidateLesson, type CandidateFailureRecord } from '../ivx-candidate-store';

type Store = Pick<typeof CandidateStore, 'acquireLock' | 'saveCandidateWithLease' | 'recordPhaseFailure'>;
export type CandidateRunResult = {
  status: 'COMMITTED' | 'CONTENDED' | 'ALREADY_RECORDED' | 'FAILED';
  eventId: string;
  duplicate?: boolean;
  errorType?: string;
  outcomeUnknown?: boolean;
  failureRecord?: CandidateFailureRecord;
};
export interface AutonomousTaskContext {
  eventId: string;
  ownerId: string;
  targetVersion: number;
  timeToLiveMs: number;
  attempt: number;
  signal?: AbortSignal;
}

/** Run a bounded candidate-evidence phase. The primary job keeps its existing
 * queue lease, heartbeat and owner authority. This lease never authorizes code
 * execution, deployment, or writes outside the candidate store. */
export async function dispatchProductionAutonomousTask(
  context: AutonomousTaskContext,
  execute: (signal: AbortSignal) => Promise<CandidateLesson>,
  store: Store = CandidateStore,
): Promise<CandidateRunResult> {
  const { eventId, ownerId, targetVersion, timeToLiveMs, attempt } = context;
  if (!Number.isInteger(attempt) || attempt < 0 || attempt > 2_147_483_647
    || !Number.isInteger(timeToLiveMs) || timeToLiveMs < 1 || timeToLiveMs > 300_000) {
    return { status: 'FAILED', eventId, errorType: 'INVALID_RUN_CONTEXT', outcomeUnknown: false };
  }
  const startedAt = performance.now();
  const cancellation = new AbortController();
  let stopReason = 'CANDIDATE_PHASE_CANCELLED';
  const stop = (reason: string) => {
    if (cancellation.signal.aborted) return;
    stopReason = reason;
    cancellation.abort();
  };
  const cancel = () => stop('CANDIDATE_PHASE_CANCELLED');
  context.signal?.addEventListener('abort', cancel, { once: true });
  if (context.signal?.aborted) cancel();
  // Start before acquisition: pool/network delay consumes the local budget.
  // PostgreSQL still owns the authoritative expiry and final write fence.
  const timeout = setTimeout(() => stop('CANDIDATE_PHASE_TIMEOUT'), timeToLiveMs);
  const stopped = () => {
    // A blocked event loop can resume promises before its overdue timer fires.
    // Use elapsed monotonic time at both execution and persistence boundaries.
    if (performance.now() - startedAt >= timeToLiveMs) stop('CANDIDATE_PHASE_TIMEOUT');
    return cancellation.signal.aborted;
  };
  const fail = async (errorType: string, outcomeUnknown = false): Promise<CandidateRunResult> => {
    let failureRecord: CandidateFailureRecord;
    try { failureRecord = await store.recordPhaseFailure(eventId, 'CANDIDATE_EVIDENCE', errorType, attempt); }
    catch { failureRecord = { success: false, errorType: 'FAILURE_RECORD_OUTCOME_UNKNOWN', outcomeUnknown: true }; }
    return { status: 'FAILED', eventId, errorType, outcomeUnknown, failureRecord };
  };
  let acquired = false;
  let writeStarted = false;
  try {
    if (stopped()) return { status: 'FAILED', eventId, errorType: stopReason, outcomeUnknown: false };
    const lease = await store.acquireLock(eventId, ownerId, targetVersion, timeToLiveMs);
    if (!lease.acquired) {
      if (lease.errorType === 'EVENT_ALREADY_COMPLETED_IMMUTABLE') return { status: 'ALREADY_RECORDED', eventId };
      if (lease.errorType === 'LEASE_HELD_BY_ANOTHER_ACTIVE_WORKER') return { status: 'CONTENDED', eventId };
      return fail(lease.errorType, lease.outcomeUnknown ?? false);
    }
    acquired = true;
    if (stopped()) return fail(stopReason);
    let rejectCancelled: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      rejectCancelled = () => reject(new Error('CANDIDATE_PHASE_STOPPED'));
      cancellation.signal.addEventListener('abort', rejectCancelled, { once: true });
    });
    let candidate: CandidateLesson;
    try {
      // Attach both rejection handlers before invoking caller code, which can
      // abort and throw synchronously even with a Promise-returning signature.
      const execution = Promise.resolve().then(() => {
        if (stopped()) throw new Error('CANDIDATE_PHASE_STOPPED');
        return execute(cancellation.signal);
      });
      candidate = await Promise.race([execution, cancelled]);
    }
    finally { if (rejectCancelled) cancellation.signal.removeEventListener('abort', rejectCancelled); }
    if (stopped()) return fail(stopReason);
    if (candidate.eventId !== eventId || candidate.version !== targetVersion) return fail('CANDIDATE_IDENTITY_MISMATCH');
    // Do not race or retry this write: a lost acknowledgement can follow COMMIT.
    writeStarted = true;
    const saved = await store.saveCandidateWithLease(candidate, ownerId, lease.token);
    if (!saved.success) return fail(saved.errorType, saved.outcomeUnknown ?? false);
    return { status: 'COMMITTED', eventId, duplicate: saved.duplicate };
  } catch {
    return fail(stopped() ? stopReason : 'CANDIDATE_EXECUTION_EXCEPTION', !acquired || writeStarted);
  } finally {
    clearTimeout(timeout);
    context.signal?.removeEventListener('abort', cancel);
  }
}
