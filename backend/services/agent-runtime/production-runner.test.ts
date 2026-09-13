import { test, expect } from 'bun:test';
import { dispatchProductionAutonomousTask as run } from './production-runner';
import { persistCoderCandidate } from '../ivx-coder-candidate-evidence';
import type { CandidateAcquisition, CandidateSave } from '../ivx-candidate-store';

const context = { eventId: 'event', ownerId: 'worker', targetVersion: 1, timeToLiveMs: 1000, attempt: 2 };
const candidate = { eventId: 'event', agentId: 'IA-10', taskType: 'qa', rootCause: 'Observed failure', hypothesis: 'Check cause', gitSha: 'a'.repeat(40), version: 1 };
function fixture() {
  const saved: unknown[] = [], failures: unknown[] = [];
  return { saved, failures, store: {
    acquireLock: async (): Promise<CandidateAcquisition> => ({ acquired: true, token: 'private-token', version: 1, expiresAt: new Date(Date.now() + 1000).toISOString() }),
    saveCandidateWithLease: async (...args: unknown[]): Promise<CandidateSave> => { saved.push(args); return { success: true, duplicate: false }; },
    recordPhaseFailure: async (...args: unknown[]) => { failures.push(args); return { success: true as const, failureId: '1' }; },
  } };
}
test('only the candidate store commits evidence with the original owner/token/version', async () => {
  const f = fixture(); const result = await run(context, async () => candidate, f.store);
  expect(result.status).toBe('COMMITTED'); expect(f.saved).toEqual([[candidate, 'worker', 'private-token']]);
  expect(JSON.stringify(result)).not.toContain('private-token'); expect(f.failures).toHaveLength(0);
});
test('contended or completed claims never launch another executor', async () => {
  for (const [errorType, status] of [['LEASE_HELD_BY_ANOTHER_ACTIVE_WORKER', 'CONTENDED'], ['EVENT_ALREADY_COMPLETED_IMMUTABLE', 'ALREADY_RECORDED']] as const) {
    const f = fixture(); f.store.acquireLock = async () => ({ acquired: false, errorType });
    let executions = 0; const result = await run(context, async () => { executions++; return candidate; }, f.store);
    expect(result.status).toBe(status); expect(executions).toBe(0); expect(f.saved).toHaveLength(0);
  }
});
test('simultaneous dispatchers respect one authoritative claim', async () => {
  const f = fixture(); let claimed = false, executions = 0;
  const acquire = f.store.acquireLock;
  f.store.acquireLock = async () => { if (claimed) return { acquired: false, errorType: 'LEASE_HELD_BY_ANOTHER_ACTIVE_WORKER' }; claimed = true; return acquire(); };
  const results = await Promise.all(Array.from({ length: 20 }, () => run(context, async () => { executions++; return candidate; }, f.store)));
  expect(executions).toBe(1); expect(results.filter(r => r.status === 'COMMITTED')).toHaveLength(1); expect(f.saved).toHaveLength(1);
});
test('late results after timeout cannot commit, even if executor ignores cancellation', async () => {
  const f = fixture(); let resolve!: (v: typeof candidate) => void; let signal!: AbortSignal;
  const pending = run({ ...context, timeToLiveMs: 15 }, s => { signal = s; return new Promise(r => { resolve = r; }); }, f.store);
  const result = await pending; expect(result.errorType).toBe('CANDIDATE_PHASE_TIMEOUT'); expect(signal.aborted).toBe(true);
  resolve(candidate); await Promise.resolve(); expect(f.saved).toHaveLength(0);
  expect(f.failures).toEqual([['event', 'CANDIDATE_EVIDENCE', 'CANDIDATE_PHASE_TIMEOUT', 2]]);
});
test('a blocked event loop cannot save evidence before an overdue timer runs', async () => {
  const f = fixture(); let signal!: AbortSignal;
  const result = await run({ ...context, timeToLiveMs: 10 }, async s => {
    signal = s;
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    return candidate;
  }, f.store);
  expect(result.errorType).toBe('CANDIDATE_PHASE_TIMEOUT');
  expect(signal.aborted).toBe(true); expect(f.saved).toHaveLength(0);
});
test('a delayed acquisition cannot launch evidence production after the local deadline', async () => {
  const f = fixture(); let executions = 0;
  const acquire = f.store.acquireLock;
  f.store.acquireLock = async () => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    return acquire();
  };
  const result = await run({ ...context, timeToLiveMs: 10 }, async () => { executions++; return candidate; }, f.store);
  expect(result.errorType).toBe('CANDIDATE_PHASE_TIMEOUT');
  expect(executions).toBe(0); expect(f.saved).toHaveLength(0);
});
test('the first owner cancellation remains the cause while acquisition finishes', async () => {
  const f = fixture(); const controller = new AbortController();
  const acquire = f.store.acquireLock;
  f.store.acquireLock = async () => {
    controller.abort();
    await new Promise(resolve => setTimeout(resolve, 25));
    return acquire();
  };
  const result = await run({ ...context, timeToLiveMs: 10, signal: controller.signal }, async () => candidate, f.store);
  expect(result.errorType).toBe('CANDIDATE_PHASE_CANCELLED');
  expect(f.failures).toEqual([['event', 'CANDIDATE_EVIDENCE', 'CANDIDATE_PHASE_CANCELLED', 2]]);
  expect(f.saved).toHaveLength(0);
});
test('a synchronous executor abort and throw leaves no unhandled cancellation rejection', async () => {
  const f = fixture(); const controller = new AbortController();
  const result = await run({ ...context, signal: controller.signal }, () => {
    controller.abort();
    throw Error('PRIVATE_EXECUTOR_MESSAGE');
  }, f.store);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(result.errorType).toBe('CANDIDATE_PHASE_CANCELLED');
  expect(f.saved).toHaveLength(0);
  expect(JSON.stringify(result)).not.toContain('PRIVATE_EXECUTOR_MESSAGE');
});
test('a successful commit acknowledgement after timeout is retained without replay', async () => {
  const f = fixture(); let saves = 0;
  f.store.saveCandidateWithLease = async () => {
    saves++;
    await new Promise(resolve => setTimeout(resolve, 25));
    return { success: true, duplicate: false };
  };
  const result = await run({ ...context, timeToLiveMs: 10 }, async () => candidate, f.store);
  expect(result.status).toBe('COMMITTED'); expect(saves).toBe(1);
  expect(f.failures).toHaveLength(0);
});
test('owner cancellation before acquisition performs no work or lease write', async () => {
  const f = fixture(); let claimed = false; f.store.acquireLock = async () => { claimed = true; throw Error('unexpected'); };
  const controller = new AbortController(); controller.abort();
  expect((await run({ ...context, signal: controller.signal }, async () => candidate, f.store)).errorType).toBe('CANDIDATE_PHASE_CANCELLED'); expect(claimed).toBe(false);
});
test('owner cancellation during evidence production prevents save', async () => {
  const f = fixture(); const controller = new AbortController();
  const result = await run({ ...context, signal: controller.signal }, async () => { controller.abort(); return candidate; }, f.store);
  expect(result.status).toBe('FAILED'); expect(f.saved).toHaveLength(0);
});
test('an executor cannot replace the claimed event or version', async () => {
  for (const patch of [{ eventId: 'other' }, { version: 2 }]) {
    const f = fixture(); expect((await run(context, async () => ({ ...candidate, ...patch }), f.store)).errorType).toBe('CANDIDATE_IDENTITY_MISMATCH'); expect(f.saved).toHaveLength(0);
  }
});
test('an uncertain commit is never retried and failure-log refusal remains visible', async () => {
  const f = fixture(); let saves = 0;
  f.store.saveCandidateWithLease = async () => { saves++; return { success: false, errorType: 'CANDIDATE_DATABASE_OUTCOME_UNKNOWN', outcomeUnknown: true }; };
  const store = { ...f.store, recordPhaseFailure: async () => ({ success: false as const, errorType: 'CANDIDATE_DATABASE_REJECTED', outcomeUnknown: false }) };
  const result = await run(context, async () => candidate, store);
  expect(result.outcomeUnknown).toBe(true); expect(result.failureRecord?.success).toBe(false); expect(saves).toBe(1);
});
test('unexpected executor and journal errors do not expose private messages', async () => {
  const f = fixture(); const store = { ...f.store, recordPhaseFailure: async () => { throw Error('PASSWORD'); } };
  const result = await run(context, async () => { throw Error('PASSWORD'); }, store);
  expect(result.status).toBe('FAILED'); expect(result.failureRecord?.success).toBe(false); expect(JSON.stringify(result)).not.toContain('PASSWORD');
});
test('invalid local budget or attempt is rejected before touching the database', async () => {
  const f = fixture(); let calls = 0; f.store.acquireLock = async () => { calls++; throw Error('unexpected'); };
  for (const patch of [{ timeToLiveMs: 300001 }, { timeToLiveMs: 0 }, { attempt: -1 }, { attempt: NaN }]) expect((await run({ ...context, ...patch }, async () => candidate, f.store)).status).toBe('FAILED');
  expect(calls).toBe(0);
});
test('real coder diagnosis is fenced, source-attributed and remains a candidate', async () => {
  const f = fixture(); let authority = 0;
  const input = { jobId: 'job-10', agentId: 'ivx_holdings_10', workerInstanceId: 'worker', attempt: 2,
    proof: { rootCause: 'Observed import failure', technicalPlan: 'Resolve missing import', startingSha: 'b'.repeat(40), filesInspected: ['backend/api/a.ts'] },
    assertAuthority: async () => { authority++; } };
  const dispatcher: typeof run = (ctx, execute) => run(ctx, execute, f.store);
  const result = await persistCoderCandidate(input, dispatcher);
  expect(result.status).toBe('COMMITTED'); expect(authority).toBe(1);
  const evidence = (f.saved[0] as unknown[])[0] as typeof candidate;
  expect(evidence.version).toBe(0); expect(evidence.gitSha).toBe(input.proof.startingSha); expect(evidence.hypothesis).toBe(input.proof.technicalPlan);
  const again = await persistCoderCandidate({ ...input, attempt: 3 }, dispatcher);
  expect('eventId' in result && 'eventId' in again && result.eventId !== again.eventId).toBe(true);
});
test('missing source proof/identity or lost parent authority never becomes saved evidence', async () => {
  const f = fixture(); const input = { jobId: 'job', agentId: 'IA-10', workerInstanceId: 'worker', attempt: 1,
    proof: { rootCause: 'root', technicalPlan: 'plan', startingSha: 'b'.repeat(40), filesInspected: ['file.ts'] }, assertAuthority: async () => { throw Error('LOST_LEASE'); } };
  const dispatcher: typeof run = (ctx, execute) => run(ctx, execute, f.store);
  expect((await persistCoderCandidate(input, dispatcher)).status).toBe('FAILED');
  expect((await persistCoderCandidate({ ...input, agentId: null }, dispatcher)).status).toBe('NOT_APPLICABLE');
  expect((await persistCoderCandidate({ ...input, proof: { ...input.proof, filesInspected: [] } }, dispatcher)).status).toBe('NOT_APPLICABLE'); expect(f.saved).toHaveLength(0);
});
