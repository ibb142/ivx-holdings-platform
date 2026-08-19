/**
 * Guards the sign-in single point of failure.
 *
 * OBSERVED PRODUCTION FAILURE (verified live, not theorised):
 *
 *   POST https://api.ivxholding.com/api/members/login
 *     -> HTTP 503 in ~6.1s, three consecutive probes
 *     -> {"success":false,"message":"Login service temporarily unavailable. Please try again."}
 *
 *   POST https://kvclcdjmjghndxsngfzb.supabase.co/auth/v1/token?grant_type=password
 *     -> HTTP 400 invalid_credentials in 0.25s (healthy, fast)
 *
 * Supabase - the actual auth authority - was perfectly healthy the whole time.
 * The login gateway is only a convenience wrapper around that SAME project, yet
 * the client treated it as the ONLY way in. One server-side outage therefore
 * equalled a total sign-in outage: a correct password on a healthy account was
 * rejected with "temporarily unavailable".
 *
 * The ~6.1s timing is the signature of the generic 6s route deadline being
 * shorter than the login handler's own 8s Supabase budget, so the wrapper
 * always answered first. The repo fixes that with LOGIN_HARD_TIMEOUT_MS (20s),
 * but the client must not depend on any server deploy to let its owner in.
 *
 * These tests fail the build if sign-in ever becomes gateway-only again, or if
 * the fallback ever starts masking a genuine credential rejection.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { shouldFallBackToDirectSupabase } from '../lib/auth-context';

const authContext = readFileSync(join(import.meta.dir, '..', 'lib', 'auth-context.tsx'), 'utf8');

describe('the login gateway is not a single point of failure', () => {
  test('login falls back to the direct Supabase password grant', () => {
    expect(authContext).toContain('shouldFallBackToDirectSupabase');
    expect(authContext).toContain('signInWithEmailPassword(freshClient, normalizedEmail, password)');
  });

  test('the direct fallback installs a real session', () => {
    expect(authContext).toContain('resolvedSession = direct.session');
  });

  test('a gateway session, when present, is still preferred', () => {
    expect(authContext).toContain('serverSessionUsable');
    expect(authContext).toMatch(/if \(serverSessionUsable\) \{/);
  });
});

describe('the fallback must never mask a real credential answer', () => {
  const definitive: { status: number; reason: string }[] = [
    { status: 400, reason: 'invalid_credentials' },
    { status: 401, reason: 'invalid_credentials' },
    { status: 403, reason: 'verification_required' },
    { status: 429, reason: 'rate_limited' },
  ];

  for (const item of definitive) {
    test(`HTTP ${item.status} (${item.reason}) is surfaced, not retried directly`, () => {
      expect(
        shouldFallBackToDirectSupabase({
          failureReason: item.reason as never,
          status: item.status,
        }),
      ).toBe(false);
    });
  }

  const outage: number[] = [0, 500, 502, 503, 504];
  for (const status of outage) {
    test(`HTTP ${status} (outage/transport) does fall back`, () => {
      expect(
        shouldFallBackToDirectSupabase({ failureReason: 'service_unavailable', status }),
      ).toBe(true);
    });
  }

  test('no answer at all from any gateway falls back', () => {
    expect(shouldFallBackToDirectSupabase(null)).toBe(true);
  });

  test('the exact production 503 that locked the owner out now falls back', () => {
    expect(
      shouldFallBackToDirectSupabase({ failureReason: 'service_unavailable', status: 503 }),
    ).toBe(true);
  });
});
