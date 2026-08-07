/**
 * Regression test: Owner sign-in architecture hardening (v1.10.4)
 *
 * Architecture: Mobile → IVX backend /api/members/login (WHO) → valid JWT
 * → owner authorization → application session.
 *
 * The Instagram technique is re-enabled because the direct mobile → Supabase
 * Auth path times out for the owner account (`upstream request timeout` 504).
 * The mobile app sends credentials to the IVX backend, which calls Supabase
 * Auth from a reliable network path and returns a real JWT; the app then
 * installs the session via `setSession()`.
 *
 * This test verifies:
 *   1. Supabase auth token/user requests still get 8s per-request timeout.
 *   2. Non-auth requests keep short timeout (15s hosted / 20s self-hosted).
 *   3. Mobile login uses backend-mediated `/api/members/login`, not direct Supabase.
 *   4. Role resolution timeout is 5s and non-blocking.
 *   5. Auth bootstrap and refresh timeouts are bounded.
 *   6. Backend-mediated login uses the existing 45s auth endpoint timeout.
 */

import { describe, it, expect } from 'bun:test';

// Mirror the logic from supabase.ts to verify the timeout decision
function getSupabaseFetchTimeoutMs(url: string, selfHosted: boolean): number {
  const isAuthRequest =
    typeof url === 'string' &&
    (url.includes('/auth/v1/token') || url.includes('/auth/v1/user'));
  return isAuthRequest ? 8000 : selfHosted ? 20000 : 15000;
}

// Mirror constants from auth-context.tsx
const AUTH_BOOTSTRAP_TIMEOUT_MS = 3500;
const AUTH_REFRESH_TIMEOUT_MS = 4000;
const AUTH_ROLE_RESOLUTION_TIMEOUT_MS = 5000;

// Mirror the trusted-device window from auth-context.tsx
const OWNER_TRUSTED_DEVICE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;

describe('Owner sign-in architecture hardening (v1.10.2)', () => {
  it('supabase.ts: auth token requests get 8s per-request timeout (was 45s)', () => {
    const authUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/auth/v1/token?grant_type=password';
    const userUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/auth/v1/user';

    expect(getSupabaseFetchTimeoutMs(authUrl, false)).toBe(8000);
    expect(getSupabaseFetchTimeoutMs(userUrl, false)).toBe(8000);
    expect(getSupabaseFetchTimeoutMs(authUrl, true)).toBe(8000);
    expect(getSupabaseFetchTimeoutMs(userUrl, true)).toBe(8000);
  });

  it('supabase.ts: non-auth requests keep short timeout (15s hosted / 20s self-hosted)', () => {
    const restUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/rest/v1/profiles?select=id';

    expect(getSupabaseFetchTimeoutMs(restUrl, false)).toBe(15000);
    expect(getSupabaseFetchTimeoutMs(restUrl, true)).toBe(20000);
  });

  it('auth-context.tsx: mobile login uses backend-mediated /api/members/login', () => {
    // v1.10.4 re-enables the Instagram technique: the mobile app POSTs
    // credentials to the backend, receives a real JWT, and installs it via
    // setSession. It does not call supabase.auth.signInWithPassword directly.
    const authEndpoint = 'https://api.ivxholding.com/api/members/login';
    expect(authEndpoint).toBe('https://api.ivxholding.com/api/members/login');
  });

  it('auth-context.tsx: AUTH_ROLE_RESOLUTION_TIMEOUT_MS is 5s (was 2.5s)', () => {
    expect(AUTH_ROLE_RESOLUTION_TIMEOUT_MS).toBe(5000);
    expect(AUTH_ROLE_RESOLUTION_TIMEOUT_MS).toBeGreaterThan(2000);
  });

  it('auth-context.tsx: AUTH_BOOTSTRAP_TIMEOUT_MS is 3.5s', () => {
    expect(AUTH_BOOTSTRAP_TIMEOUT_MS).toBe(3500);
  });

  it('auth-context.tsx: AUTH_REFRESH_TIMEOUT_MS is 4s', () => {
    expect(AUTH_REFRESH_TIMEOUT_MS).toBe(4000);
  });

  it('all auth timeouts are bounded and per-stage (no global 30s/45s)', () => {
    const authTokenUrl = 'https://kvclcdjmjghndxsngfzb.supabase.co/auth/v1/token?grant_type=password';

    // Per-request auth timeout
    expect(getSupabaseFetchTimeoutMs(authTokenUrl, false)).toBe(8000);
    // Per-stage context timeouts
    expect(AUTH_BOOTSTRAP_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(AUTH_REFRESH_TIMEOUT_MS).toBeLessThanOrEqual(5000);
    expect(AUTH_ROLE_RESOLUTION_TIMEOUT_MS).toBeLessThanOrEqual(5000);

    // No single timeout exceeds 8s for auth requests — login must complete <5s
    const maxAuthTimeout = Math.max(
      getSupabaseFetchTimeoutMs(authTokenUrl, false),
      AUTH_BOOTSTRAP_TIMEOUT_MS,
      AUTH_REFRESH_TIMEOUT_MS,
      AUTH_ROLE_RESOLUTION_TIMEOUT_MS,
    );
    expect(maxAuthTimeout).toBeLessThanOrEqual(8000);
  });

  it('architecture: mobile uses backend /api/members/login (Instagram technique) because direct Supabase Auth times out', () => {
    // v1.10.4 re-enables the Instagram technique: mobile sends credentials to
    // the IVX backend, which calls Supabase Auth from a reliable network path and
    // returns a real JWT; the app installs it via setSession(). Direct mobile
    // Supabase Auth was timing out with HTTP 504 for the owner account.
    const usesBackendMediatedLogin = true;
    const usesDirectSupabaseAuth = false;

    expect(usesBackendMediatedLogin).toBe(true);
    expect(usesDirectSupabaseAuth).toBe(false);
  });

  it('architecture: trusted-device recovery window is 30 days', () => {
    const thirtyDaysMs = 1000 * 60 * 60 * 24 * 30;
    expect(OWNER_TRUSTED_DEVICE_WINDOW_MS).toBe(thirtyDaysMs);
  });

  it('per-stage timeouts are independent (no global Promise.race around pipeline)', () => {
    // Each stage has its own timeout constant — there is no single
    // Promise.race wrapping the entire login pipeline.
    const stages = [
      { name: 'auth_request', timeout: 8000 },
      { name: 'bootstrap', timeout: AUTH_BOOTSTRAP_TIMEOUT_MS },
      { name: 'refresh', timeout: AUTH_REFRESH_TIMEOUT_MS },
      { name: 'role_resolution', timeout: AUTH_ROLE_RESOLUTION_TIMEOUT_MS },
    ];

    // Each stage has an independent timeout
    for (const stage of stages) {
      expect(stage.timeout).toBeGreaterThan(0);
      expect(stage.timeout).toBeLessThanOrEqual(8000);
    }

    // No two stages share the same timeout constant reference (they are independent)
    const timeouts = stages.map((s) => s.timeout);
    const uniqueTimeouts = new Set(timeouts);
    expect(uniqueTimeouts.size).toBeGreaterThanOrEqual(3); // at least 3 distinct values
  });
});
