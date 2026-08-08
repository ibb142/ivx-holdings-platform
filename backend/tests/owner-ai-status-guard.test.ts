import { describe, it, expect } from 'bun:test';
import { handleIVXOwnerAIProxyStatus, handleIVXOwnerAIPublicStatus } from '../api/ivx-owner-ai';

/**
 * Block 1 — Secure the exposed owner status route.
 *
 * /api/ivx/owner-ai/status must require a valid owner JWT for internal details.
 * Unauthenticated → 401, non-owner → 403, valid owner → 200.
 * /api/ivx/owner-ai/public-status is the minimal public-safe endpoint.
 */
describe('Block 1 — owner-ai/status auth guard', () => {
  it('returns 401 when no bearer token is provided', async () => {
    const req = new Request('https://api.ivxholding.com/api/ivx/owner-ai/status');
    const res = await handleIVXOwnerAIProxyStatus(req);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toBeDefined();
  });

  it('returns 401 when Authorization header is empty', async () => {
    const req = new Request('https://api.ivxholding.com/api/ivx/owner-ai/status', {
      headers: { Authorization: '' },
    });
    const res = await handleIVXOwnerAIProxyStatus(req);
    expect(res.status).toBe(401);
  });

  it('returns 401 for an invalid bearer token', async () => {
    const req = new Request('https://api.ivxholding.com/api/ivx/owner-ai/status', {
      headers: { Authorization: 'Bearer invalid-token-xyz' },
    });
    const res = await handleIVXOwnerAIProxyStatus(req);
    expect([401, 403]).toContain(res.status);
  });

  it('returns 403 for an authenticated non-owner token', async () => {
    // A random non-owner JWT — the guard should reject it.
    // In CI (no Supabase URL), the auth guard hits a 15s internal timeout before
    // returning 401/403. Bun's default test timeout is 5s, so we extend it here.
    const fakeJwt = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })) + '.' +
      btoa(JSON.stringify({ sub: 'non-owner-user', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })) +
      '.';
    const req = new Request('https://api.ivxholding.com/api/ivx/owner-ai/status', {
      headers: { Authorization: 'Bearer ' + fakeJwt },
    });
    const res = await handleIVXOwnerAIProxyStatus(req);
    expect([401, 403]).toContain(res.status);
  }, 20000);

  it('does not leak secrets, credentials, or env values on rejection', async () => {
    const req = new Request('https://api.ivxholding.com/api/ivx/owner-ai/status');
    const res = await handleIVXOwnerAIProxyStatus(req);
    const text = await res.text();
    // Must not contain key material, env values, file paths, or deployment controls.
    expect(text).not.toContain('IVX_AI_GATEWAY_KEY');
    expect(text).not.toContain('vck_');
    expect(text).not.toContain('sk-');
    expect(text).not.toContain('service_role');
    expect(text).not.toContain('SUPABASE_SERVICE_ROLE');
    expect(text).not.toContain('/var/task/');
    expect(text).not.toContain('process.env');
  });
});

describe('Block 1 — owner-ai/public-status public-safe endpoint', () => {
  it('returns 200 without authentication', () => {
    const res = handleIVXOwnerAIPublicStatus();
    expect(res.status).toBe(200);
  });

  it('returns minimal fields only (no credentials, no internal paths)', async () => {
    const res = handleIVXOwnerAIPublicStatus();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.aiProviderReady).toBeDefined();
    expect(body.model).toBeDefined();
    // Must not expose internal details.
    expect(body.runtime).toBeUndefined();
    expect(body.runtimeV2).toBeUndefined();
    expect(body.auditLogging).toBeUndefined();
    expect(body.deploymentMarker).toBeUndefined();
    expect(body.rollbackPath).toBeUndefined();
  });

  it('does not leak secrets in public-status', async () => {
    const res = handleIVXOwnerAIPublicStatus();
    const text = await res.text();
    expect(text).not.toContain('IVX_AI_GATEWAY_KEY');
    expect(text).not.toContain('vck_');
    expect(text).not.toContain('sk-');
    expect(text).not.toContain('service_role');
  });
});
