import { describe, expect, test } from 'bun:test';
import { decideRetry, isTransientFailure, planTaskRetry, retryAfterMs, retryDelayMs, RetryQuota, taskRetryDue, FLEET_RETRY_BUDGET_MS } from './ivx-retry-policy';

describe('Fleet retry safety', () => {
  test('spreads exponential retry delays including retries at the cap', () => {
    expect([1, 2, 3].map((n) => retryDelayMs(n, 1000, 30_000, () => 0.5))).toEqual([500, 1000, 2000]);
    expect(retryDelayMs(20, 1000, 30_000, () => 0.1)).toBe(3000);
    expect(retryDelayMs(20, 1000, 30_000, () => 0.9)).toBe(27000);
  });
  test('honors zero retries and refuses Retry-After beyond the total budget', () => {
    const policy = { retriesUsed: 0, maxRetries: 0, startedAtMs: 100, nowMs: 100, maxElapsedMs: 1000 };
    expect(decideRetry(policy)).toEqual({ retry: false, reason: 'attempt_budget' });
    expect(decideRetry({ ...policy, maxRetries: 3, retryAfterMs: 2000 })).toEqual({ retry: false, reason: 'time_budget' });
    expect(retryAfterMs('3')).toBe(3000);
    expect(retryAfterMs('Wed, 09 Sep 2026 00:00:03 GMT', Date.parse('2026-09-09T00:00:00Z'))).toBe(3000);
  });
  test('does not retry auth, validation, or permanent failures', () => {
    for (const status of [400, 401, 403, 404, 422]) expect(isTransientFailure('temporarily unavailable', status)).toBe(false);
    for (const status of [408, 429, 500, 502, 503]) expect(isTransientFailure('upstream failure', status)).toBe(true);
    expect(isTransientFailure(new Error('fetch failed'))).toBe(true);
    expect(isTransientFailure(new Error('tests failed'))).toBe(false);
  });
  test('retains retry schedule and budgets across serialization/restart without a lease', () => {
    const now = Date.now();
    const planned = planTaskRetry({ retryCount: 0, maxRetries: 2 }, now, () => 0.5);
    const restored = JSON.parse(JSON.stringify({ ...planned, maxRetries: 2 }));
    expect(restored.state).toBe('RETRYING');
    expect(restored.leaseHolder).toBeNull();
    expect(taskRetryDue(restored, now + 499)).toBe(false);
    expect(taskRetryDue(restored, now + 500)).toBe(true);
    const second = { ...planTaskRetry(restored, now + 1000, () => 0.5), maxRetries: 2 };
    expect(planTaskRetry(second, now + 2000).state).toBe('FAILED');
    expect(planTaskRetry(restored, now + FLEET_RETRY_BUDGET_MS).error).toContain('time_budget');
  });
  test('bounds a simultaneous 112-agent retry storm and refills the quota', () => {
    let now = 0;
    const quota = new RetryQuota(30, 2, () => now);
    expect(Array.from({ length: 112 }, () => quota.take()).filter(Boolean)).toHaveLength(30);
    now = 500;
    expect(quota.take()).toBe(true);
    expect(quota.take()).toBe(false);
  });
});
