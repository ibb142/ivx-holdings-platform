import { expect, test } from 'bun:test';
import { resumeIVXAutonomousCoderFromCiWait, type IVXCiCheckEvidence } from './services/ivx-autonomous-coder';

const passedChecks = (): IVXCiCheckEvidence[] => ['qa-suite', 'typecheck', 'lint', 'scan-secrets'].map(context => ({
  context, checkRunName: context, matched: true, status: 'completed', conclusion: 'success', detailsUrl: null,
}));
const absentCheck: IVXCiCheckEvidence = {
  context: 'Senior Developer + 12 IA autonomy invariants', checkRunName: null,
  matched: false, status: 'not_reported', conclusion: null, detailsUrl: null,
};
const resumeFixture = {
  taskId: 'durable-ci-wait', goal: 'repair an application defect', ownerId: 'fixture',
  commitSha: 'a'.repeat(40), prNumber: 123, branch: 'repair-fixture',
  testsPassed: true, typecheckPassed: true, ciPollIntervalMs: 0,
};

for (const merged of [false, true]) {
  test(`recovered ${merged ? 'merged' : 'open'} PR retains its original CI grace period`, async () => {
    let merges = 0;
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...resumeFixture, ciWaitStartedAt: new Date(Date.now() - 15 * 60_000).toISOString(),
      prStateFn: async () => ({ state: merged ? 'closed' : 'open', merged, mergeCommitSha: merged ? 'b'.repeat(40) : null }),
      requiredChecksFn: async () => [...passedChecks(), {
        context: 'Browser / ${{ matrix.unit }}', checkRunName: 'Browser / ${{ matrix.unit }}',
        matched: true, status: 'completed', conclusion: 'skipped', detailsUrl: null, conditionalSkipVerified: true,
      }, absentCheck],
      sleepFn: async () => { throw new Error('CI grace must not restart after recovery'); },
      mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'b'.repeat(40) }; },
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(proof.prMerged).toBe(true);
    expect(proof.ciWaitMs).toBeGreaterThanOrEqual(15 * 60_000);
    expect(proof.ciCheckEvidence?.at(-1)?.conclusion).toBe('not_applicable');
    expect(proof.ciCheckEvidence?.at(-2)?.conclusion).toBe('skipped');
    expect(merges).toBe(merged ? 0 : 1);
  });
}

test('recovery does not restart the deadline for a check still running', async () => {
  let merges = 0;
  const proof = await resumeIVXAutonomousCoderFromCiWait({
    ...resumeFixture, ciWaitStartedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
    requiredChecksFn: async () => [{ ...passedChecks()[0], status: 'in_progress', conclusion: null }],
    sleepFn: async () => { throw new Error('CI deadline must not restart after recovery'); },
    mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'b'.repeat(40) }; },
  });
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(proof.error).toContain('TIMED OUT');
  expect(proof.ciChecksGreen).toBe(false);
  expect(proof.ciWaitMs).toBeGreaterThanOrEqual(60 * 60_000);
  expect(merges).toBe(0);
});

test('losing the worker lease while fetching green checks prevents merging', async () => {
  let cancelled = false;
  let merges = 0;
  const proof = await resumeIVXAutonomousCoderFromCiWait({
    ...resumeFixture, isCanceled: () => cancelled,
    prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
    requiredChecksFn: async () => { cancelled = true; return passedChecks(); },
    mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'b'.repeat(40) }; },
  });
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(proof.error).toContain('CI_WAIT_INTERRUPTED');
  expect(proof.ciChecksGreen).toBe(false);
  expect(merges).toBe(0);
});

test('an interrupted CI sleeper exits without another GitHub request', async () => {
  let cancelled = false;
  let polls = 0;
  const proof = await resumeIVXAutonomousCoderFromCiWait({
    ...resumeFixture, isCanceled: () => cancelled,
    prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
    requiredChecksFn: async () => { polls++; return [{ ...passedChecks()[0], status: 'in_progress', conclusion: null }]; },
    sleepFn: async () => { if (cancelled) throw new Error('Interrupted wait kept polling'); cancelled = true; },
    mergeFn: async () => { throw new Error('Interrupted work must never merge'); },
  });
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(proof.error).toContain('CI_WAIT_INTERRUPTED');
  expect(polls).toBe(1);
});

for (const ciWaitStartedAt of ['invalid', new Date(Date.now() + 60 * 60_000).toISOString()]) {
  test(`invalid or future CI checkpoint does not manufacture elapsed time: ${ciWaitStartedAt}`, async () => {
    let polls = 0;
    let sleeps = 0;
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      ...resumeFixture, ciWaitStartedAt,
      prStateFn: async () => ({ state: 'closed', merged: true, mergeCommitSha: 'b'.repeat(40) }),
      requiredChecksFn: async () => { polls++; return polls === 1 ? [...passedChecks(), absentCheck] : passedChecks(); },
      sleepFn: async () => { sleeps++; },
    });
    expect(proof.finalStatus).toBe('COMPLETED');
    expect(sleeps).toBe(1);
    expect(proof.ciWaitMs).toBeLessThan(60_000);
  });
}

test('elapsed grace never approves a failed required check', async () => {
  let merges = 0;
  const proof = await resumeIVXAutonomousCoderFromCiWait({
    ...resumeFixture, ciWaitStartedAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
    requiredChecksFn: async () => [...passedChecks(), absentCheck, { ...passedChecks()[0], context: 'e2e', conclusion: 'failure' }],
    mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'b'.repeat(40) }; },
  });
  expect(proof.finalStatus).toBe('BLOCKED');
  expect(proof.ciChecksGreen).toBe(false);
  expect(merges).toBe(0);
});

test('waits for conditional omission verification before attempting a merge', async () => {
  let verified = false;
  let polls = 0;
  let merges = 0;
  const proof = await resumeIVXAutonomousCoderFromCiWait({
    taskId: 'conditional-wait-fixture', goal: 'repair a defect', ownerId: 'fixture',
    commitSha: 'a'.repeat(40), prNumber: 123, branch: 'repair-fixture',
    testsPassed: true, typecheckPassed: true, ciWaitTimeoutMs: 1000, ciPollIntervalMs: 0,
    prStateFn: async () => ({ state: 'open', merged: false, mergeCommitSha: null }),
    requiredChecksFn: async () => { polls++; return [
      { context: 'qa-suite', checkRunName: 'qa-suite', matched: true, status: 'completed', conclusion: 'success', detailsUrl: null },
      { context: 'Browser / ${{ matrix.unit }}', checkRunName: 'Browser / ${{ matrix.unit }}', matched: true, status: 'completed', conclusion: 'skipped', detailsUrl: null,
        conditionalSkipPending: !verified, conditionalSkipVerified: verified },
    ]; },
    sleepFn: async () => { expect(merges).toBe(0); verified = true; },
    mergeFn: async () => { expect(verified).toBe(true); merges++; return { merged: true, mergeCommitSha: 'b'.repeat(40) }; },
  });
  expect(polls).toBe(2);
  expect(merges).toBe(1);
  expect(proof.ciChecksGreen).toBe(true);
  expect(proof.ciCheckEvidence?.[1].conclusion).toBe('skipped');
});

for (const state of ['closed', 'unknown'] as const) {
  test(`CI wait releases a repair when its PR becomes ${state}`, async () => {
    let changed = false;
    let polls = 0;
    let sleeps = 0;
    let merges = 0;
    const proof = await resumeIVXAutonomousCoderFromCiWait({
      taskId: 'ci-closure-fixture', goal: 'repair an application defect', ownerId: 'fixture-owner',
      commitSha: 'a'.repeat(40), prNumber: 123, branch: 'repair-fixture',
      testsPassed: true, typecheckPassed: true, ciWaitTimeoutMs: 1000, ciPollIntervalMs: 0,
      prStateFn: async () => ({ state: changed ? state : 'open', merged: false, mergeCommitSha: null }),
      requiredChecksFn: async (): Promise<IVXCiCheckEvidence[]> => {
        polls++;
        return [{ context: 'qa-suite', checkRunName: 'qa-suite', matched: true,
          status: polls === 1 ? 'in_progress' : 'completed', conclusion: polls === 1 ? null : 'success', detailsUrl: null }];
      },
      sleepFn: async () => { sleeps++; changed = true; },
      mergeFn: async () => { merges++; return { merged: true, mergeCommitSha: 'b'.repeat(40) }; },
    });
    expect(proof.finalStatus).toBe('BLOCKED');
    expect(proof.error).toContain(state === 'closed' ? 'CLOSED without merging' : 'state is unknown');
    expect(proof.ciChecksGreen).toBe(false);
    expect(polls).toBe(1);
    expect(sleeps).toBe(1);
    expect(merges).toBe(0);
  });
}
