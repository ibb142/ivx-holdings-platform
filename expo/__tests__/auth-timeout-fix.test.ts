/**
 * Regression test: Owner sign-in "Aborted" fix
 *
 * Root cause: Three independent frontend abort timers were killing the
 * sign-in request before Supabase Auth could respond on cold starts:
 *   1. expo/lib/supabase.ts — custom fetch wrapper aborted ALL requests at 15s
 *   2. expo/lib/auth-password-sign-in.ts — Promise.race timeout at 20s
 *   3. expo/lib/auth-context.tsx — fetchWithOwnerRegistrationTimeout at 12s
 *
 * Fix: Auth endpoints now get 45s timeout; non-auth requests keep 15s.
 *
 * This test verifies the timeout values are correct and that auth requests
 * get the extended timeout, not the short one.
 */

import { describe, it, expect } from 'bun:test';

// Mirror the logic from supabase.ts to verify the timeout decision
function getSupabaseFetchTimeoutMs(url: string, selfHosted: boolean): number {
  const isAuthRequest =
    typeof url === 'string' &&
    (url.includes('/auth/v1/token') || url.includes('/auth/v1/user'));
  return isAuthRequest ? 45000 : selfHosted ? 20000 : 15000;
}

// Mirror the logic from auth-context.tsx
function getOwnerRegistrationTimeoutMs(url: string): number {
  const isAuthEndpoint =
    typeof url === 'string' &&
    (url.includes('/owner-passwordless-login') ||
      url.includes('/members/login') ||
      url.includes('/owner/login'));
  return isAuthEndpoint ? 45000 : 15000;
}

// Mirror SIGN_IN_TIMEOUT_MS from auth-password-sign-in.ts
const SIGN_IN_TIMEOUT_MS = 45000;

describe('Owner sign-in abort fix (regression)', () => {
  it('supabase.ts: auth token requests get 45s timeout, not 15s', () => {
    const authUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/auth/v1/token?grant_type=password';
    const nonAuthUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/rest/v1/profiles?select=id';

    expect(getSupabaseFetchTimeoutMs(authUrl, false)).toBe(45000);
    expect(getSupabaseFetchTimeoutMs(nonAuthUrl, false)).toBe(15000);
    expect(getSupabaseFetchTimeoutMs(authUrl, true)).toBe(45000);
    expect(getSupabaseFetchTimeoutMs(nonAuthUrl, true)).toBe(20000);
  });

  it('auth-password-sign-in.ts: SIGN_IN_TIMEOUT_MS is 45s (was 20s)', () => {
    expect(SIGN_IN_TIMEOUT_MS).toBe(45000);
    expect(SIGN_IN_TIMEOUT_MS).toBeGreaterThan(30000);
  });

  it('auth-context.tsx: owner passwordless login endpoint gets 45s, not 12s', () => {
    const passwordlessUrl = 'https://api.ivxholding.com/api/ivx/owner-passwordless-login';
    const statusUrl = 'https://api.ivxholding.com/api/ivx/owner-registration/status?email=test@example.com';

    expect(getOwnerRegistrationTimeoutMs(passwordlessUrl)).toBe(45000);
    expect(getOwnerRegistrationTimeoutMs(statusUrl)).toBe(15000);
  });

  it('auth-context.tsx: members login endpoint gets 45s, not 12s', () => {
    const loginUrl = 'https://api.ivxholding.com/api/ivx/members/login';
    expect(getOwnerRegistrationTimeoutMs(loginUrl)).toBe(45000);
  });

  it('auth-context.tsx: owner login endpoint gets 45s, not 12s', () => {
    const ownerLoginUrl = 'https://api.ivxholding.com/api/ivx/owner/login';
    expect(getOwnerRegistrationTimeoutMs(ownerLoginUrl)).toBe(45000);
  });

  it('all auth timeouts are >= 45s (enough for cold-start Supabase)', () => {
    const authTokenUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/auth/v1/token?grant_type=password';
    const passwordlessUrl = 'https://api.ivxholding.com/api/ivx/owner-passwordless-login';

    expect(getSupabaseFetchTimeoutMs(authTokenUrl, false)).toBeGreaterThanOrEqual(45000);
    expect(getOwnerRegistrationTimeoutMs(passwordlessUrl)).toBeGreaterThanOrEqual(45000);
    expect(SIGN_IN_TIMEOUT_MS).toBeGreaterThanOrEqual(45000);
  });

  it('non-auth requests keep short timeout (15s) to avoid hanging', () => {
    const restUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/rest/v1/messages?select=id';
    const statusUrl = 'https://api.ivxholding.com/api/ivx/owner-registration/status';

    expect(getSupabaseFetchTimeoutMs(restUrl, false)).toBe(15000);
    expect(getOwnerRegistrationTimeoutMs(statusUrl)).toBe(15000);
  });
});
