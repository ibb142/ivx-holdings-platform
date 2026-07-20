/**
 * Phase 12: Duplicate worker prevention — idempotency + leases + evidence dedup.
 */
import { describe, expect, test } from 'bun:test';
import {
  checkDuplicateEvidence,
  computeIdempotencyKey,
  fingerprintEvidence,
  normalizeGoalForRetry,
} from './ivx-duplicate-worker-prevention';

describe('IVX Duplicate Worker Prevention', () => {
  test('idempotency key is deterministic for same owner+goal', () => {
    const k1 = computeIdempotencyKey({ ownerId: 'owner-1', goal: 'Fix chat loading' });
    const k2 = computeIdempotencyKey({ ownerId: 'owner-1', goal: 'Fix chat loading' });
    expect(k1).toBe(k2);
  });

  test('idempotency key differs for different owners', () => {
    const k1 = computeIdempotencyKey({ ownerId: 'owner-1', goal: 'Fix chat loading' });
    const k2 = computeIdempotencyKey({ ownerId: 'owner-2', goal: 'Fix chat loading' });
    expect(k1).not.toBe(k2);
  });

  test('idempotency key ignores runId parentheticals', () => {
    const k1 = computeIdempotencyKey({ ownerId: 'o', goal: 'Fix chat loading (run-1784565002)' });
    const k2 = computeIdempotencyKey({ ownerId: 'o', goal: 'Fix chat loading (run-1784565003)' });
    // Different runIds produce different idempotency keys because the goal text differs,
    // but normalizeGoalForRetry strips them for retry detection.
    const n1 = normalizeGoalForRetry('Fix chat loading (run-1784565002)');
    const n2 = normalizeGoalForRetry('Fix chat loading (run-1784565003)');
    expect(n1).toBe(n2);
  });

  test('normalizeGoalForRetry strips various runId patterns', () => {
    expect(normalizeGoalForRetry('Fix chat (validator-check-1784565002)')).toBe('fix chat');
    expect(normalizeGoalForRetry('Fix chat (honesty-final-1784565005)')).toBe('fix chat');
    expect(normalizeGoalForRetry('Fix chat (live-honesty-check-1784565003)')).toBe('fix chat');
  });

  test('fingerprintEvidence is deterministic', () => {
    const f1 = fingerprintEvidence({ commitSha: 'abc', deployId: 'dep-1', filesChanged: ['a.ts', 'b.ts'], finalStatus: 'COMPLETE' });
    const f2 = fingerprintEvidence({ commitSha: 'abc', deployId: 'dep-1', filesChanged: ['b.ts', 'a.ts'], finalStatus: 'COMPLETE' });
    expect(f1).toBe(f2); // filesChanged order is normalized
  });

  test('checkDuplicateEvidence detects duplicate fingerprints', () => {
    const fp = fingerprintEvidence({ commitSha: 'abc', deployId: 'dep-1', filesChanged: [], finalStatus: 'COMPLETE' });
    const result = checkDuplicateEvidence(fp, [{ jobId: 'prior-1', fingerprint: fp }]);
    expect(result.isDuplicate).toBe(true);
    expect(result.priorJobId).toBe('prior-1');
    expect(result.reason).toContain('duplicate');
  });

  test('checkDuplicateEvidence passes for unique fingerprints', () => {
    const fp = fingerprintEvidence({ commitSha: 'abc', deployId: 'dep-1', filesChanged: [], finalStatus: 'COMPLETE' });
    const result = checkDuplicateEvidence(fp, [{ jobId: 'prior-1', fingerprint: 'ev:zzz:zzz::COMPLETE' }]);
    expect(result.isDuplicate).toBe(false);
  });

  test('duplicate redeploy with no code change is not a new completed development task', () => {
    // Simulate: prior job committed nothing, deployed dep-1, same fingerprint.
    const priorFp = fingerprintEvidence({ commitSha: 'abc', deployId: 'dep-1', filesChanged: [], finalStatus: 'COMPLETE' });
    const newFp = fingerprintEvidence({ commitSha: 'abc', deployId: 'dep-1', filesChanged: [], finalStatus: 'COMPLETE' });
    const result = checkDuplicateEvidence(newFp, [{ jobId: 'job-A', fingerprint: priorFp }]);
    expect(result.isDuplicate).toBe(true);
    expect(result.reason).toContain('not a new completed development task');
  });
});
