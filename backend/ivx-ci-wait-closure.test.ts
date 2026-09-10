import { expect, test } from 'bun:test';
import { resumeIVXAutonomousCoderFromCiWait, type IVXCiCheckEvidence } from './services/ivx-autonomous-coder';

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
