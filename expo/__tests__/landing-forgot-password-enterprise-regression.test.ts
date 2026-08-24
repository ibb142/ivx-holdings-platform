import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const landing = readFileSync(resolve(import.meta.dir, '../ivxholding-landing/index.html'), 'utf8');
const portal = readFileSync(resolve(import.meta.dir, '../ivxholding-landing/ivx-portal-20260822.js'), 'utf8');
const bridge = readFileSync(resolve(import.meta.dir, '../ivxholding-landing/ivx-lazy-bridge-20260822.js'), 'utf8');
const reset = readFileSync(resolve(import.meta.dir, '../ivxholding-landing/reset-password.html'), 'utf8');

describe('Landing + Forgot Password enterprise regression gate', () => {
  it('keeps the public Forgot Password entry and dedicated reset view reachable', () => {
    expect(landing).toContain('Forgot password?');
    expect(landing).toContain('id="portal-forgot-view"');
    expect(landing).toContain('id="portal-forgot-form"');
    expect(landing).toContain('handleForgotPasswordSubmit(event)');
    expect(landing).toContain('/ivx-lazy-bridge-20260822.js');
  });

  it('keeps the lazy bridge wired to the versioned portal runtime', () => {
    expect(bridge).toContain("loadScript('/ivx-portal-20260822.js')");
    expect(bridge).toContain('window.toggleForgotPassword');
    expect(bridge).toContain('window.handleForgotPasswordSubmit');
  });

  it('uses Supabase password recovery with the canonical production reset redirect', () => {
    expect(portal).toContain('resetPasswordForEmail');
    expect(portal).toContain("'/reset-password.html'");
    expect(portal).toContain("'https://ivxholding.com/reset-password.html'");
    expect(portal).toContain('/rate limit|user not found|does not exist|email not confirmed/i');
    expect(portal).toContain("email.toLowerCase()");
  });

  it('keeps a real reset page with password-update capability and password controls', () => {
    expect(reset).toContain('updateUser');
    expect(reset.toLowerCase()).toContain('password');
    expect(reset).toContain('https://ivxholding.com');
  });

  it('does not expose a service-role key in the public landing recovery runtime', () => {
    expect(portal).not.toContain('service_role');
    expect(portal).not.toContain('SUPABASE_SERVICE_ROLE');
  });
});
