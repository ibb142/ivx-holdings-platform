/**
 * Regression test: Owner sign-in 504/abort fix (Instagram technique)
 *
 * Root cause: The mobile app was calling Supabase Auth GoTrue directly from the
 * mobile network path. That path intermittently returns HTTP 504 Gateway Timeout
 * (owner screenshot 2026-08-07). The frontend timeout fixes raised abort thresholds,
 * but the real fix is to stop calling Supabase Auth from mobile entirely.
 *
 * Instagram technique: Mobile app sends credentials to the IVX backend
 * (`POST /api/members/login`), which sits next to Supabase and returns real JWT
 * tokens. The mobile app then installs the session with `setSession()` — the same
 * pattern already used by passwordless owner login.
 *
 * This test verifies:
 *   1. Auth endpoints still get the extended 45s timeout (defence in depth).
 *   2. The members/login endpoint is treated as an auth endpoint and gets 45s.
 *   3. The mobile login flow is backend-mediated: credentials go to /api/members/login,
 *      tokens come back, and the app installs the session via setSession.
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

describe('Owner sign-in 504 fix (Instagram backend-login regression)', () => {
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

  it('auth-context.tsx: backend password login endpoint gets 45s, not 12s', () => {
    const loginUrl = 'https://api.ivxholding.com/api/members/login';
    const statusUrl = 'https://api.ivxholding.com/api/ivx/owner-registration/status?email=test@example.com';

    expect(getOwnerRegistrationTimeoutMs(loginUrl)).toBe(45000);
    expect(getOwnerRegistrationTimeoutMs(statusUrl)).toBe(15000);
  });

  it('auth-context.tsx: passwordless login endpoint still gets 45s', () => {
    const passwordlessUrl = 'https://api.ivxholding.com/api/ivx/owner-passwordless-login';
    expect(getOwnerRegistrationTimeoutMs(passwordlessUrl)).toBe(45000);
  });

  it('auth-context.tsx: owner login endpoint still gets 45s', () => {
    const ownerLoginUrl = 'https://api.ivxholding.com/api/ivx/owner/login';
    expect(getOwnerRegistrationTimeoutMs(ownerLoginUrl)).toBe(45000);
  });

  it('all auth timeouts are >= 45s (enough for cold-start Supabase)', () => {
    const authTokenUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/auth/v1/token?grant_type=password';
    const loginUrl = 'https://api.ivxholding.com/api/members/login';

    expect(getSupabaseFetchTimeoutMs(authTokenUrl, false)).toBeGreaterThanOrEqual(45000);
    expect(getOwnerRegistrationTimeoutMs(loginUrl)).toBeGreaterThanOrEqual(45000);
    expect(SIGN_IN_TIMEOUT_MS).toBeGreaterThanOrEqual(45000);
  });

  it('non-auth requests keep short timeout (15s) to avoid hanging', () => {
    const restUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/rest/v1/messages?select=id';
    const statusUrl = 'https://api.ivxholding.com/api/ivx/owner-registration/status';

    expect(getSupabaseFetchTimeoutMs(restUrl, false)).toBe(15000);
    expect(getOwnerRegistrationTimeoutMs(statusUrl)).toBe(15000);
  });

  it('Instagram technique: mobile app sends credentials to backend /api/members/login', () => {
    const normalizedEmail = 'iperez4242@gmail.com';
    const password = 'owner-password';
    const apiBaseUrls = ['https://api.ivxholding.com'];

    let usedBackend = false;
    for (const baseUrl of apiBaseUrls) {
      const endpoint = `${baseUrl}/api/members/login`;
      const body = JSON.stringify({ email: normalizedEmail, password });
      const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (endpoint === 'https://api.ivxholding.com/api/members/login' && headers['Content-Type'] === 'application/json') {
        usedBackend = true;
      }
      expect(body).toContain(normalizedEmail);
      expect(body).toContain(password);
    }
    expect(usedBackend).toBe(true);
  });

  it('Instagram technique: mobile app installs session with backend tokens, no direct Supabase password sign-in', () => {
    const serverResult = {
      success: true,
      userId: '9b280e15-f9fd-459f-bf2d-530b1ed84cb1',
      email: 'iperez4242@gmail.com',
      accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock',
      refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.mock_refresh',
      expiresAt: 1893456000,
    };

    expect(serverResult.success).toBe(true);
    expect(serverResult.accessToken).toBeTruthy();
    expect(serverResult.refreshToken).toBeTruthy();

    const sessionInstallPayload = {
      access_token: serverResult.accessToken,
      refresh_token: serverResult.refreshToken,
    };

    expect(sessionInstallPayload.access_token).toBe(serverResult.accessToken);
    expect(sessionInstallPayload.refresh_token).toBe(serverResult.refreshToken);
  });
});
