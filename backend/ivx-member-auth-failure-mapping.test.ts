/**
 * Regression lock for the two P0 faults found by live production QA on 2026-08-19.
 *
 * FAULT 1 — a member with the CORRECT password was told it was wrong.
 *   `loginMember` bounded the Supabase call with an inner timeout that REJECTED.
 *   The rejection fell through to the function's outer catch, which returned
 *   `{ success: false, message: 'Supabase sign-in timed out after 8000ms' }`, and
 *   `handleMemberLogin` mapped every non-success result to HTTP 401. So whenever
 *   upstream auth was slow, a valid member received "invalid credentials" — and the
 *   app latched that into an auth-error state. Measured live:
 *     http=401 t=14.2s message="Supabase sign-in timed out after 8000ms"
 *
 * FAULT 2 — registration hung forever.
 *   `/api/members/register` had rate limiting but NO deadline, and every Supabase
 *   call inside `registerMember` was unbounded. Measured live: no response after
 *   180s. The sign-up form simply never came back.
 *
 * These tests assert the CONTRACT that fixes both: an infrastructure timeout is a
 * retryable 503 that never impersonates a credential verdict, and every internal
 * budget string stays internal.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const memberDb = readFileSync(join(ROOT, 'backend/services/ivx-member-database.ts'), 'utf8');
const membersApi = readFileSync(join(ROOT, 'backend/api/ivx-members.ts'), 'utf8');
const hono = readFileSync(join(ROOT, 'backend/hono.ts'), 'utf8');

describe('FAULT 1 — an upstream timeout must never read as a bad password', () => {
  it('the login result type can express an infrastructure fault', () => {
    expect(memberDb).toContain("errorCode?: 'auth_upstream_timeout'");
    expect(memberDb).toContain('retryable?: boolean');
  });

  it('the timeout is raised as an internal sentinel, not a user-facing string', () => {
    expect(memberDb).toContain('SIGN_IN_TIMEOUT_SENTINEL');
    // The old code built the member-visible message out of the budget constant.
    expect(memberDb).not.toContain('`Supabase sign-in timed out after ${MEMBER_LOGIN_INNER_BUDGET_MS}ms`');
  });

  it('the timeout branch returns a retryable code and a human message', () => {
    const branch = memberDb.slice(memberDb.indexOf('if (message === SIGN_IN_TIMEOUT_SENTINEL)'));
    expect(branch).toContain("errorCode: 'auth_upstream_timeout'");
    expect(branch).toContain('retryable: true');
    expect(branch).toContain('Please try again in a moment.');
  });

  it('a transient upstream stall is retried once before giving up', () => {
    expect(memberDb).toContain('retrying once');
  });

  it('the route maps the infrastructure fault to 503, not 401', () => {
    expect(membersApi).toContain("result.errorCode === 'auth_upstream_timeout'");
    expect(membersApi).toContain('503');
    // The old one-liner collapsed every failure into 401.
    expect(membersApi).not.toContain('result.success ? 200 : (result.requiresVerification ? 403 : 401)');
  });

  it('a genuine bad password is still a 401', () => {
    expect(membersApi).toContain('return jsonResponse(result, 401);');
    expect(memberDb).toContain("message: 'Invalid email or password.'");
  });
});

describe('FAULT 2 — registration must always answer', () => {
  it('registration has a hard deadline constant', () => {
    expect(hono).toContain('REGISTER_HARD_TIMEOUT_MS');
  });

  it('the deadline is actually applied to the register route', () => {
    const route = hono.slice(
      hono.indexOf("app.post('/api/members/register'"),
      hono.indexOf("app.post('/api/members/send-email-code'"),
    );
    expect(route).toContain('withTimeout');
    expect(route).toContain('REGISTER_HARD_TIMEOUT_MS');
  });

  it('the deadline responds 503 retryable rather than hanging', () => {
    const route = hono.slice(
      hono.indexOf("app.post('/api/members/register'"),
      hono.indexOf("app.post('/api/members/send-email-code'"),
    );
    expect(route).toContain('REGISTRATION_TIMEOUT');
    expect(route).toContain('retryable: true');
    expect(route).toContain('status: 503');
  });

  it('registration is given more budget than login (it writes several records)', () => {
    const reg = /REGISTER_HARD_TIMEOUT_MS = (\d+)_000/.exec(hono);
    const login = /LOGIN_HARD_TIMEOUT_MS = (\d+)_000/.exec(hono);
    expect(reg).not.toBeNull();
    expect(login).not.toBeNull();
    expect(Number(reg?.[1])).toBeGreaterThan(Number(login?.[1]));
  });
});

describe('Live QA harness must stay runnable by the owner', () => {
  const qa = readFileSync(join(ROOT, 'scripts/ivx-live-qa.mjs'), 'utf8');

  it('covers all four audited areas', () => {
    for (const area of ['landing', 'register', 'signin', 'wire']) {
      expect(qa).toContain(`'${area}'`);
    }
  });

  it('guards the exact regressions above', () => {
    expect(qa).toContain('always answers (never hangs)');
    expect(qa).toContain('401 is a real credential verdict, not a disguised timeout');
    expect(qa).toContain('no internal timeout string leaked to the member');
  });

  it('checks that wire details never leak to an anonymous caller', () => {
    expect(qa).toContain('no account number exposed to anonymous');
    expect(qa).toContain('no routing number exposed to anonymous');
    expect(qa).toContain('forged token cannot unlock instructions');
  });

  it('exits non-zero when any gate fails, so CI can depend on it', () => {
    expect(qa).toContain('process.exit(failed === 0 ? 0 : 1)');
  });
});
