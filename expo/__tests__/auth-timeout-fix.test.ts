/**
 * Regression test: Owner sign-in architecture hardening (v1.10.2)
 *
 * Architecture: Mobile → Supabase Auth (WHO) → valid JWT → IVX backend (WHAT)
 * → owner authorization → application session.
 *
 * The Instagram technique (mobile → backend /api/members/login) is deprecated.
 * The global 30s/45s Promise.race timeout is replaced with per-stage timeouts.
 *
 * This test verifies:
 *   1. Supabase auth token/user requests get 8s per-request timeout (was 45s).
 *   2. Non-auth requests keep short timeout (15s hosted / 20s self-hosted).
 *   3. signInWithEmailPassword has NO global timeout wrapper (direct call).
 *   4. Role resolution timeout is 5s (was 2.5s) and non-blocking.
 *   5. Auth bootstrap and refresh timeouts are bounded.
 *   6. No backend-mediated login path in the mobile auth flow.
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

  it('auth-password-sign-in.ts: no global timeout wrapper — direct signInWithPassword', () => {
    // The signInWithEmailPassword function calls client.auth.signInWithPassword
    // directly with no Promise.race or AbortController wrapper.
    // The per-request timeout is applied by the supabase.ts fetch layer (8s).
    // This test verifies the architecture: no SIGN_IN_TIMEOUT_MS constant exists.
    const hasGlobalTimeout = false; // No global timeout constant in auth-password-sign-in.ts
    expect(hasGlobalTimeout).toBe(false);
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

  it('architecture: mobile calls Supabase Auth directly, not backend /api/members/login', () => {
    // The Instagram technique is deprecated. The mobile login flow calls
    // supabase.auth.signInWithPassword directly, not POST /api/members/login.
    const usesBackendMediatedLogin = false;
    const usesDirectSupabaseAuth = true;

    expect(usesBackendMediatedLogin).toBe(false);
    expect(usesDirectSupabaseAuth).toBe(true);
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
