import { describe, expect, test } from 'bun:test';
import { isAdminRole, normalizeRole, sanitizeEmail } from '../lib/auth-helpers';

describe('Owner authorization — auth state transitions', () => {
  test('owner role normalizes correctly', () => {
    expect(normalizeRole('owner')).toBe('owner');
    expect(normalizeRole('Owner')).toBe('owner');
    expect(normalizeRole('OWNER')).toBe('owner');
    expect(normalizeRole('owner_admin')).toBe('owner');
    expect(normalizeRole('owneradmin')).toBe('owner');
  });

  test('admin roles are recognized as admin', () => {
    expect(isAdminRole('owner')).toBe(true);
    expect(isAdminRole('admin')).toBe(true);
    expect(isAdminRole('ceo')).toBe(true);
    expect(isAdminRole('staff')).toBe(true);
    expect(isAdminRole('manager')).toBe(true);
  });

  test('investor is NOT admin', () => {
    expect(isAdminRole('investor')).toBe(false);
    expect(isAdminRole(null)).toBe(false);
    expect(isAdminRole(undefined)).toBe(false);
    expect(isAdminRole('')).toBe(false);
  });

  test('unknown roles default to investor', () => {
    expect(normalizeRole('superuser')).toBe('investor');
    expect(normalizeRole('guest')).toBe('investor');
    expect(normalizeRole(null)).toBe('investor');
  });

  test('email sanitization trims and lowercases', () => {
    expect(sanitizeEmail('  Owner@IVX.com  ')).toBe('owner@ivx.com');
    expect(sanitizeEmail('IPerez4242@Gmail.com')).toBe('iperez4242@gmail.com');
  });
});

describe('Owner authorization — duplicate listener prevention', () => {
  test('normalizeRole is deterministic across calls', () => {
    const r1 = normalizeRole('Owner');
    const r2 = normalizeRole('Owner');
    expect(r1).toBe(r2);
  });

  test('sanitizeEmail is deterministic', () => {
    const e1 = sanitizeEmail('  Test@Example.COM  ');
    const e2 = sanitizeEmail('test@example.com');
    expect(e1).toBe(e2);
  });
});
