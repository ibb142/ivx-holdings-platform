import { describe, expect, it } from 'bun:test';
import { committedFailurePatch, isCommittedRecoveryCandidate } from './ivx-senior-committed-recovery-policy';

const now = Date.parse('2026-09-10T19:00:00Z');
const fixture = () => ({ jobId: 'same-job', taskId: 'same-task', attempts: 3, status: 'running',
  startedAt: new Date(now - 300_000).toISOString(), lastHeartbeatAt: new Date(now - 200_000).toISOString(),
  leaseExpiresAt: new Date(now - 80_000).toISOString(),
  result: { commitSha: 'a'.repeat(40), branch: 'repair-branch', prNumber: null, prMerged: false,
    validationEvidence: [{ command: 'bun test regression.test.ts', exitCode: 0 }], endToEndProductionComplete: false } });

describe('committed senior job recovery', () => {
  it('recovers expired committed work from each active phase, including a queued retry', () => {
    for (const status of ['queued', 'running', 'patching', 'testing', 'committing', 'deploying', 'verifying']) {
      expect(isCommittedRecoveryCandidate({ ...fixture(), status }, now, 90_000)).toBe(true);
    }
  });
  it('preserves live leases, recent activity, merged jobs and terminal decisions', () => {
    const job = fixture();
    for (const change of [
      { leaseExpiresAt: new Date(now + 10_000).toISOString() }, { leaseExpiresAt: 'invalid' },
      { lastHeartbeatAt: new Date(now - 10_000).toISOString() }, { lastHeartbeatAt: 'invalid' },
      { result: null }, { result: { ...job.result, prMerged: true } },
      ...['blocked', 'failed', 'cancelled', 'completed'].map(status => ({ status })),
    ]) expect(isCommittedRecoveryCandidate({ ...job, ...change }, now, 90_000)).toBe(false);
  });
  it('routes a post-commit timeout to verification without changing its identity, evidence or attempt', () => {
    const original = fixture();
    const patch = committedFailurePatch(original, 'GitHub HTTP 503', true, new Date(now).toISOString());
    const next = { ...original, ...patch };
    expect(next.status).toBe('committing');
    expect(next.jobId).toBe(original.jobId);
    expect(next.taskId).toBe(original.taskId);
    expect(next.attempts).toBe(3);
    expect(next.result).toEqual(original.result);
    expect(next.result?.prNumber).toBeNull();
    expect(next.result?.endToEndProductionComplete).toBe(false);
    expect(next.finishedAt).toBeNull();
  });
  it('blocks a permanent post-commit failure with its original proof intact', () => {
    const original = fixture();
    const patch = committedFailurePatch(original, 'required CI failed', false, new Date(now).toISOString());
    expect(patch?.status).toBe('blocked');
    expect(patch?.result).toMatchObject({ ...original.result, finalStatus: 'BLOCKED', ok: false });
    expect(patch?.finishedAt).toBe(new Date(now).toISOString());
    expect(committedFailurePatch({ ...original, result: null }, 'timeout', true, '')).toBeNull();
    expect(committedFailurePatch({ ...original, status: 'cancelled' }, 'timeout', true, '')).toBeNull();
  });
});
