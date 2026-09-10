import { expect, test } from 'bun:test';
import { resumeIVXAutonomousCoderFromCiWait, type IVXCiCheckEvidence } from './services/ivx-autonomous-coder';

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
