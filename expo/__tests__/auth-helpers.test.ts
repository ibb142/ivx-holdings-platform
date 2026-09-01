import { describe, expect, test } from 'bun:test';
import {
  isAdminRole,
  normalizeRole,
  validateEmail,
  validatePassword,
  validatePhone,
  sanitizeEmail,
} from '../lib/auth-helpers';

describe('isAdminRole', () => {
  test('returns true for owner', () => {
    expect(isAdminRole('owner')).toBe(true);
  });

  test('returns true for ceo', () => {
    expect(isAdminRole('ceo')).toBe(true);
  });

  test('returns true for staff', () => {
    expect(isAdminRole('staff')).toBe(true);
  });

  test('returns true for manager', () => {
    expect(isAdminRole('manager')).toBe(true);
  });

  test('returns true for analyst', () => {
    expect(isAdminRole('analyst')).toBe(true);
  });

  test('returns false for investor', () => {
    expect(isAdminRole('investor')).toBe(false);
  });

  test('returns false for null', () => {
    expect(isAdminRole(null)).toBe(false);
  });

  test('returns false for undefined', () => {
    expect(isAdminRole(undefined)).toBe(false);
  });

  test('returns false for empty string', () => {
    expect(isAdminRole('')).toBe(false);
  });

  test('returns false for unknown role', () => {
    expect(isAdminRole('xyzunknown')).toBe(false);
  });
});

describe('normalizeRole', () => {
  test('returns investor for null', () => {
    expect(normalizeRole(null)).toBe('investor');
  });

  test('returns investor for undefined', () => {
    expect(normalizeRole(undefined)).toBe('investor');
  });

  test('returns investor for empty string', () => {
    expect(normalizeRole('')).toBe('investor');
  });

  test('returns investor for unknown string', () => {
    expect(normalizeRole('random')).toBe('investor');
  });

  test('returns owner for owner', () => {
    expect(normalizeRole('owner')).toBe('owner');
  });

  test('returns analyst for analyst', () => {
    expect(normalizeRole('analyst')).toBe('analyst');
  });
});

describe('validateEmail', () => {
  test('accepts valid email', () => {
    expect(validateEmail('user@example.com')).toBe(true);
  });

  test('accepts email with subdomain', () => {
    expect(validateEmail('user@mail.example.com')).toBe(true);
  });

  test('accepts email with plus', () => {
    expect(validateEmail('user+tag@example.com')).toBe(true);
  });

  test('rejects empty string', () => {
    expect(validateEmail('')).toBe(false);
  });

  test('rejects no @', () => {
    expect(validateEmail('userexample.com')).toBe(false);
  });

  test('rejects no domain', () => {
    expect(validateEmail('user@')).toBe(false);
  });

  test('rejects spaces', () => {
    expect(validateEmail('user @example.com')).toBe(false);
  });

  test('rejects double @', () => {
    expect(validateEmail('user@@example.com')).toBe(false);
  });
});

describe('validatePassword', () => {
  test('accepts strong password', () => {
    const result = validatePassword('MyP4ssword123');
    expect(result.valid).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test('rejects short password', () => {
    const result = validatePassword('Aa1');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('12 characters');
  });

  test('rejects no uppercase', () => {
    const result = validatePassword('mypassword123');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('uppercase');
  });

  test('rejects no number', () => {
    const result = validatePassword('MyLongPassword');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('number');
  });

  test('accepts exactly 12 chars with requirements', () => {
    const result = validatePassword('Abcdefghijk1');
    expect(result.valid).toBe(true);
  });
});

describe('validatePhone', () => {
  test('accepts US phone number', () => {
    expect(validatePhone('+1 555 123 4567')).toBe(true);
  });

  test('accepts phone with dashes', () => {
    expect(validatePhone('555-123-4567')).toBe(true);
  });

  test('accepts phone with parens', () => {
    expect(validatePhone('(555) 123-4567')).toBe(true);
  });

  test('rejects too short', () => {
    expect(validatePhone('12345')).toBe(false);
  });

  test('rejects letters', () => {
    expect(validatePhone('abcdefghij')).toBe(false);
  });
});

describe('sanitizeEmail', () => {
  test('trims whitespace', () => {
    expect(sanitizeEmail('  user@example.com  ')).toBe('user@example.com');
  });

  test('lowercases', () => {
    expect(sanitizeEmail('User@Example.COM')).toBe('user@example.com');
  });

  test('trims and lowercases', () => {
    expect(sanitizeEmail('  USER@TEST.com ')).toBe('user@test.com');
  });
});
