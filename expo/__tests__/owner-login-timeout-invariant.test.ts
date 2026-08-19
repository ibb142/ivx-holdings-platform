/**
 * Permanent guards for the owner sign-in failure.
 *
 * Three independent defects produced the same user-facing string
 * "Login service temporarily unavailable. Please try again.":
 *
 *   1. DEADLINE INVERSION (backend/hono.ts)
 *      The /api/members/login route was wrapped in a generic 6s deadline while
 *      the handler's own Supabase sign-in budget was 10s. Any sign-in needing
 *      6-10s could never succeed — the wrapper answered 503 first. Correct
 *      password, guaranteed failure, nothing logged.
 *
 *   2. NON-CRITICAL WRITE WAS FATAL (backend/services/ivx-member-database.ts)
 *      `updateMemberLastLogin` was awaited against a 3s reject AFTER the
 *      password was verified and a session existed. A slow `profiles` write
 *      threw and turned a successful login into an HTTP 401.
 *
 *   3. CLIENT MISCLASSIFICATION (expo/lib/auth-context.tsx)
 *      Every non-success response was reported as `service_unavailable` with a
 *      hardcoded status 504 — including a plain 401 wrong password. The error
 *      message carried zero diagnostic signal, which is why this stayed
 *      unexplained for so long.
 *
 * These tests fail the build if any of the three is reintroduced.
 */
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..', '..');

function readRepoFile(relativePath: string): string {
  return readFileSync(join(ROOT, relativePath), 'utf8');
}

function extractMs(source: string, constantName: string): number {
  const match = new RegExp(`${constantName}\\s*=\\s*([0-9_]+)`).exec(source);
  if (!match) throw new Error(`${constantName} not found`);
  return Number(match[1].replace(/_/g, ''));
}

describe('defect 1 — login deadline inversion', () => {
  const hono = readRepoFile('backend/hono.ts');
  const memberDb = readRepoFile('backend/services/ivx-member-database.ts');

  test('the login route has its own deadline, not the generic 6s one', () => {
    expect(hono).toContain('LOGIN_HARD_TIMEOUT_MS');
    const loginRoute = /app\.post\('\/api\/members\/login'[\s\S]{0,900}/.exec(hono)?.[0] ?? '';
    expect(loginRoute).toContain('LOGIN_HARD_TIMEOUT_MS');
  });

  test('withTimeout accepts a per-route timeout', () => {
    expect(hono).toMatch(/timeoutMs:\s*number\s*=\s*SB_HARD_TIMEOUT_MS/);
    expect(hono).toMatch(/setTimeout\(\(\)\s*=>\s*resolve\(fallback\(\)\),\s*timeoutMs\)/);
  });

  test('INVARIANT: outer route deadline is strictly greater than the inner budget', () => {
    const outer = extractMs(hono, 'LOGIN_HARD_TIMEOUT_MS');
    const inner = extractMs(memberDb, 'MEMBER_LOGIN_INNER_BUDGET_MS');
    expect(outer).toBeGreaterThan(inner);
  });

  test('the inner budget leaves real headroom (>= 5s margin)', () => {
    const outer = extractMs(hono, 'LOGIN_HARD_TIMEOUT_MS');
    const inner = extractMs(memberDb, 'MEMBER_LOGIN_INNER_BUDGET_MS');
    expect(outer - inner).toBeGreaterThanOrEqual(5_000);
  });

  test('the Supabase sign-in race uses the shared constant, not a literal', () => {
    const memberDbSource = readRepoFile('backend/services/ivx-member-database.ts');
    expect(memberDbSource).not.toContain('Supabase sign-in timed out after 10s');
    expect(memberDbSource).toMatch(/setTimeout\(\s*\n?\s*\(\)\s*=>\s*reject\([\s\S]{0,120}MEMBER_LOGIN_INNER_BUDGET_MS/);
  });
});

describe('defect 2 — bookkeeping must never fail a verified login', () => {
  const memberDb = readRepoFile('backend/services/ivx-member-database.ts');

  test('updateMemberLastLogin is fire-and-forget in the success path', () => {
    expect(memberDb).toContain('void updateMemberLastLogin(userId).catch(() => {});');
  });

  test('updateMemberLastLogin is never awaited in a throwing race', () => {
    expect(memberDb).not.toMatch(/await Promise\.race\(\[\s*\n?\s*updateMemberLastLogin\(userId\)/);
  });
});

describe('defect 3 — honest client classification', () => {
  const authContext = readRepoFile('expo/lib/auth-context.tsx');

  test('login classifies by real HTTP status', () => {
    expect(authContext).toContain('classifyServerLoginStatus');
  });

  test('a 401 is reported as invalid credentials, not service_unavailable', () => {
    expect(authContext).toMatch(/status === 401\) return \{ failureReason: 'invalid_credentials'/);
  });

  test('a 429 is reported as rate limited', () => {
    expect(authContext).toMatch(/status === 429\) return \{ failureReason: 'rate_limited'/);
  });

  test('a 5xx or transport failure is the only service_unavailable path', () => {
    expect(authContext).toMatch(/status === 0 \|\| status >= 500\) return \{ failureReason: 'service_unavailable', retryable: true \}/);
  });

  test('the hardcoded 504 status is gone', () => {
    expect(authContext).not.toContain('supabaseErrorStatus: 504');
  });

  test('a retryable failure is retried once with backoff', () => {
    expect(authContext).toContain('postMemberLoginWithRetry');
    expect(authContext).toContain('LOGIN_RETRY_BACKOFF_MS');
  });

  test('a definitive failure is not retried against other base URLs', () => {
    expect(authContext).toMatch(/if \(!outcome\.retryable\) \{\s*\n\s*break;/);
  });
});

describe('classifier behaviour', () => {
  const cases: { status: number; expected: string; retryable: boolean }[] = [
    { status: 401, expected: 'invalid_credentials', retryable: false },
    { status: 403, expected: 'verification_required', retryable: false },
    { status: 429, expected: 'rate_limited', retryable: false },
    { status: 500, expected: 'service_unavailable', retryable: true },
    { status: 503, expected: 'service_unavailable', retryable: true },
    { status: 504, expected: 'service_unavailable', retryable: true },
    { status: 0, expected: 'service_unavailable', retryable: true },
  ];

  for (const testCase of cases) {
    test(`HTTP ${testCase.status} -> ${testCase.expected}`, async () => {
      const { classifyServerLoginStatus } = await import('../lib/auth-context');
      const result = classifyServerLoginStatus(testCase.status, 'server message');
      expect(result.failureReason).toBe(testCase.expected as never);
      expect(result.retryable).toBe(testCase.retryable);
    });
  }
});
