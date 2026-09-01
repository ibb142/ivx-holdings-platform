import { describe, expect, test } from 'bun:test';
import {
  checkAuthRateLimit,
  recordAuthAttempt,
  getRateLimitMessage,
} from '../lib/auth-rate-limiter';

describe('auth-rate-limiter', () => {
  const testId = () => `test-${Date.now()}-${Math.random()}`;

  test('allows first attempt', () => {
    const id = testId();
    const result = checkAuthRateLimit(id);
    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(5);
    expect(result.lockedUntilMs).toBe(0);
  });

  test('decrements remaining attempts on failure', () => {
    const id = testId();
    recordAuthAttempt(id, false);
    const result = checkAuthRateLimit(id);
    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(4);
  });

  test('clears attempts on success', () => {
    const id = testId();
    recordAuthAttempt(id, false);
    recordAuthAttempt(id, false);
    recordAuthAttempt(id, true);
    const result = checkAuthRateLimit(id);
    expect(result.allowed).toBe(true);
    expect(result.remainingAttempts).toBe(5);
  });

  test('locks after 5 failures', () => {
    const id = testId();
    for (let i = 0; i < 5; i++) {
      recordAuthAttempt(id, false);
    }
    const result = checkAuthRateLimit(id);
    expect(result.allowed).toBe(false);
    expect(result.remainingAttempts).toBe(0);
    expect(result.lockedUntilMs).toBeGreaterThan(Date.now());
  });

  test('getRateLimitMessage returns sensible string', () => {
    const futureMs = Date.now() + 5 * 60 * 1000;
    const msg = getRateLimitMessage(futureMs);
    expect(msg).toContain('minute');
    expect(msg).toContain('Too many');
  });

  test('getRateLimitMessage handles 1 minute', () => {
    const futureMs = Date.now() + 60 * 1000;
    const msg = getRateLimitMessage(futureMs);
    expect(msg).toContain('1 minute');
    expect(msg).not.toContain('minutes');
  });
});
