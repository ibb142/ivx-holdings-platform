import { describe, expect, test } from 'bun:test';
import { isRetryableError, getBackoffDelay } from '../lib/canonical-query-utils';

describe('isRetryableError', () => {
  test('returns false for 400 errors', () => {
    expect(isRetryableError({ code: '400', message: 'Bad Request' })).toBe(false);
  });

  test('returns false for 401 errors', () => {
    expect(isRetryableError({ code: '401', message: 'Unauthorized' })).toBe(false);
  });

  test('returns false for 403 errors', () => {
    expect(isRetryableError({ code: '403', message: 'Forbidden' })).toBe(false);
  });

  test('returns false for 404 errors', () => {
    expect(isRetryableError({ code: '404', message: 'Not Found' })).toBe(false);
  });

  test('returns true for 500 errors', () => {
    expect(isRetryableError({ code: '500', message: 'Internal Server Error' })).toBe(true);
  });

  test('returns true for timeout errors', () => {
    expect(isRetryableError({ code: 'TIMEOUT', message: 'Request timed out' })).toBe(true);
  });

  test('returns true for network errors', () => {
    expect(isRetryableError({ code: 'NETWORK_ERROR', message: 'network request failed' })).toBe(true);
  });

  test('returns false for aborted requests', () => {
    expect(isRetryableError({ code: 'ABORTED', message: 'Request aborted' })).toBe(false);
  });

  test('returns false for null/undefined', () => {
    expect(isRetryableError(null)).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});

describe('getBackoffDelay', () => {
  test('returns increasing delays for higher attempts', () => {
    const d0 = getBackoffDelay(0);
    const d1 = getBackoffDelay(1);
    const d2 = getBackoffDelay(2);
    expect(d0).toBeLessThanOrEqual(d1 + 50);
    expect(d1).toBeLessThanOrEqual(d2 + 50);
  });

  test('respects max delay', () => {
    const delay = getBackoffDelay(20, 800, 8000);
    expect(delay).toBeLessThanOrEqual(8000 + 2400);
  });

  test('returns a positive number', () => {
    const delay = getBackoffDelay(0);
    expect(delay).toBeGreaterThan(0);
  });
});
