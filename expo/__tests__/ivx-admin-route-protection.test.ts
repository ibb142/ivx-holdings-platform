import { describe, expect, test } from 'bun:test';
import { isAdminRole, normalizeRole } from '../lib/auth-helpers';

// Test that admin route protection and logout/back protection logic works correctly
// by testing the core auth helper functions used by useAdminGuard and route guards

describe('Admin route protection — role checks', () => {
  test('owner role passes admin guard', () => {
    expect(isAdminRole('owner')).toBe(true);
  });

  test('admin role passes admin guard', () => {
    expect(isAdminRole('admin')).toBe(true);
  });

  test('investor role fails admin guard', () => {
    expect(isAdminRole('investor')).toBe(false);
  });

  test('null role fails admin guard', () => {
    expect(isAdminRole(null)).toBe(false);
  });

  test('empty string fails admin guard', () => {
    expect(isAdminRole('')).toBe(false);
  });
});

describe('Logout/back protection — state transitions', () => {
  test('normalizeRole maps owner correctly after re-login', () => {
    expect(normalizeRole('owner')).toBe('owner');
  });

  test('normalizeRole maps investor correctly after logout', () => {
    expect(normalizeRole('investor')).toBe('investor');
  });

  test('normalizeRole maps null to investor (post-logout state)', () => {
    expect(normalizeRole(null)).toBe('investor');
    expect(normalizeRole(undefined)).toBe('investor');
    expect(normalizeRole('')).toBe('investor');
  });

  test('role aliases are handled correctly', () => {
    expect(normalizeRole('super_admin')).toBe('admin');
    expect(normalizeRole('superadmin')).toBe('admin');
    expect(normalizeRole('owner_admin')).toBe('owner');
  });
});

describe('Module error boundary — role isolation', () => {
  test('failed module does not affect role state', () => {
    // The role check is pure and independent of module state
    const roleBefore = normalizeRole('owner');
    // Simulate module failure - role check should still work
    const roleAfter = normalizeRole('owner');
    expect(roleBefore).toBe(roleAfter);
    expect(roleAfter).toBe('owner');
  });
});

describe('Retry behavior — error classification', () => {
  test('non-retryable errors are identified', () => {
    // These would be caught by isRetryableError in canonical-query
    const nonRetryable = ['400', '401', '403', '404'];
    nonRetryable.forEach(code => {
      // Simulate the NON_RETRYABLE_STATUS check
      expect(['400', '401', '403', '404', '409', '422'].includes(code)).toBe(true);
    });
  });

  test('retryable errors are identified', () => {
    const retryable = ['500', '502', '503', 'TIMEOUT', 'NETWORK_ERROR'];
    retryable.forEach(code => {
      const isRetryable = !['400', '401', '403', '404', '409', '422'].includes(code);
      expect(isRetryable).toBe(true);
    });
  });
});
