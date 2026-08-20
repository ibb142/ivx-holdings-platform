import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const EXPO_ROOT = join(__dirname, '..');
const REPO_ROOT = join(EXPO_ROOT, '..');

const landingForgot = readFileSync(join(EXPO_ROOT, 'ivxholding-landing', 'forgot-password.html'), 'utf8');
const landingReset = readFileSync(join(EXPO_ROOT, 'ivxholding-landing', 'reset-password.html'), 'utf8');
const lazyBridge = readFileSync(join(EXPO_ROOT, 'ivxholding-landing', 'ivx-lazy-bridge.js'), 'utf8');
const appForgot = readFileSync(join(EXPO_ROOT, 'app', 'forgot-password.tsx'), 'utf8');
const appReset = readFileSync(join(EXPO_ROOT, 'app', 'reset-password.tsx'), 'utf8');
const authCard = readFileSync(join(EXPO_ROOT, 'components', 'IVXAuthCard.tsx'), 'utf8');
const memberApi = readFileSync(join(REPO_ROOT, 'backend', 'api', 'ivx-members.ts'), 'utf8');
const memberDb = readFileSync(join(REPO_ROOT, 'backend', 'services', 'ivx-member-database.ts'), 'utf8');

describe('IVX password recovery — landing + app bank-grade contract', () => {
  it('exposes a visible forgot-password entry from the landing investment login', () => {
    expect(lazyBridge).toContain("link.id = 'invest-forgot-password-link'");
    expect(lazyBridge).toContain("link.textContent = 'Forgot password?'");
    expect(lazyBridge).toContain("link.href = '/forgot-password.html'");
    expect(lazyBridge).toContain("loginTab.classList.contains('active') ? 'block' : 'none'");
    expect(lazyBridge).toContain("'?email=' + encodeURIComponent(email)");
  });

  it('uses a dedicated landing recovery page with generic anti-enumeration messaging', () => {
    expect(landingForgot).toContain('Forgot password?');
    expect(landingForgot).toContain('we never reveal whether an email is registered');
    expect(landingForgot).toContain("resetPasswordForEmail(target,{redirectTo:redirectTo})");
    expect(landingForgot).toContain("window.location.origin+'/reset-password.html'");
    expect(landingForgot).toContain('If an account exists for that email, a secure reset link has been sent.');
    expect(landingForgot).not.toContain('resetToken');
    expect(landingForgot).not.toContain('service_role');
  });

  it('retains a secure landing reset completion page', () => {
    expect(landingReset).toContain('exchangeCodeForSession(code)');
    expect(landingReset).toContain("sb.auth.updateUser({ password: p1 })");
    expect(landingReset).toContain('Minimum 12 characters');
    expect(landingReset).toContain('Recovery session expired');
  });

  it('retains app forgot-password and reset-password routes', () => {
    expect(appForgot).toContain('forgot-password-screen');
    expect(appForgot).toContain('supabase.auth.resetPasswordForEmail');
    expect(appForgot).toContain('getPasswordResetRedirectUrl');
    expect(appForgot).toContain('forgot-password-submit');
    expect(appReset).toContain('reset-password');
    expect(appReset).toContain('updateUser');
  });

  it('keeps a visible forgot-password action in the unified app auth card', () => {
    expect(authCard).toContain('Forgot password?');
    expect(authCard).toContain('handleForgotPassword');
    expect(authCard).toContain('resetPasswordForEmail');
  });

  it('never returns a fallback reset token or recovery channel from the public member endpoint', () => {
    const handlerStart = memberApi.indexOf('export async function handleMemberForgotPassword');
    const handlerEnd = memberApi.indexOf('// POST /api/members/reset-password', handlerStart);
    expect(handlerStart).toBeGreaterThanOrEqual(0);
    expect(handlerEnd).toBeGreaterThan(handlerStart);
    const publicHandler = memberApi.slice(handlerStart, handlerEnd);

    expect(publicHandler).toContain('await requestMemberPasswordReset(email)');
    expect(publicHandler).toContain('If an account exists for that email, a reset link has been sent.');
    expect(publicHandler).not.toContain('resetToken:');
    expect(publicHandler).not.toContain('channel:');
    expect(publicHandler).not.toContain('jsonResponse(result');

    // The internal fallback service may mint a single-use token, but the public
    // handler above must never serialize it to an unauthenticated caller.
    expect(memberDb).toContain('resetToken?: string');
  });
});
