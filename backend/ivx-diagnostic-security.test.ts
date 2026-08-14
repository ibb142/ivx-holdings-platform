/**
 * Regression tests for diagnostic endpoint security.
 *
 * Verifies that unauthenticated requests to diagnostic endpoints return 401
 * and do not leak sensitive information (credential names, bank details,
 * key prefixes, service IDs, runtime env var presence, etc.).
 *
 * Run AFTER security changes are deployed:
 *   bun test backend/ivx-diagnostic-security.test.ts
 *
 * These tests make real HTTP requests to the production API.
 */
import { describe, test, expect } from 'bun:test';

const BASE = process.env.API_BASE_URL ?? 'https://api.ivxholding.com';

const DIAGNOSTIC_ENDPOINTS = [
  '/api/tool/render-status',
  '/api/tool/github-status',
  '/api/ivx/chat-debug',
  '/api/ivx/deploy-tools/credentials',
  '/api/ivx/deploy-tools/dashboard',
  '/api/ivx/deploy-tools/evidence',
  '/api/ivx/deploy-tools/brain',
  '/api/ivx/deploy-tools/github',
  '/api/ivx/deploy-tools/render',
  '/api/ivx/deploy-tools/supabase',
  '/api/ivx/render-diagnostic',
  '/api/ivx/verify/env-status',
  '/api/ivx/runtime-variables',
  '/api/ivx/runtime-variables/audit',
];

const SENSITIVE_PATTERNS = [
  'routingNumber',
  'accountNumber',
  'swiftCode',
  'bankName',
  'beneficiaryAddress',
  'keyPrefix',
  'credentialSource',
  'requestedCredentialPresentByNameOnly',
  'runtimeMissingEnvNames',
  'serviceIdSuffix',
  'keyLoaded',
  'credentialLoaded',
  'credentialValid',
  'baseUrl',
  'endpoint',
  'startup',
  'providerHealth',
  'errors',
];

describe('Diagnostic endpoint security regression tests', () => {
  for (const endpoint of DIAGNOSTIC_ENDPOINTS) {
    test(`unauthenticated GET ${endpoint} returns 401/403`, async () => {
      const res = await fetch(`${BASE}${endpoint}`, {
        headers: { 'Content-Type': 'application/json' },
      });
      expect([401, 403]).toContain(res.status);

      const body = await res.json().catch(() => ({}));
      expect(body.ok).toBe(false);

      // Verify no sensitive information is leaked in the 401 response
      const bodyStr = JSON.stringify(body);
      for (const pattern of SENSITIVE_PATTERNS) {
        expect(bodyStr).not.toContain(pattern);
      }
    });
  }

  test('wire-instructions does not return bank details to unauthenticated requests', async () => {
    const res = await fetch(`${BASE}/api/ivx/wire-instructions`);
    // Unauthenticated users get 200 with a preview (bank name + CTA), NOT 401.
    // Sensitive details (routing, account, SWIFT) must never appear.
    expect(res.status).toBe(200);

    const body = await res.json().catch(() => ({}));
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('routingNumber');
    expect(bodyStr).not.toContain('accountNumber');
    expect(bodyStr).not.toContain('swiftCode');
    expect(bodyStr).not.toContain('U.S. Century Bank');
  });

  test('chat-debug does not return key prefixes or provider internals', async () => {
    const res = await fetch(`${BASE}/api/ivx/chat-debug`);
    expect([401, 403]).toContain(res.status);

    const body = await res.json().catch(() => ({}));
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('keyPrefix');
    expect(bodyStr).not.toContain('keyLoaded');
    expect(bodyStr).not.toContain('credentialLoaded');
    expect(bodyStr).not.toContain('baseUrl');
    expect(bodyStr).not.toContain('openai.com');
  });

  test('render-status does not expose credential presence or service IDs', async () => {
    const res = await fetch(`${BASE}/api/tool/render-status`);
    expect([401, 403]).toContain(res.status);

    const body = await res.json().catch(() => ({}));
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('requestedCredentialPresentByNameOnly');
    expect(bodyStr).not.toContain('runtimeMissingEnvNames');
    expect(bodyStr).not.toContain('serviceIdSuffix');
    expect(bodyStr).not.toContain('credentialSource');
  });

  test('health endpoint does not expose seniorDeveloper blockers count', async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);

    const body = await res.json();
    const bodyStr = JSON.stringify(body);
    expect(bodyStr).not.toContain('seniorDeveloper');
    expect(bodyStr).not.toContain('blockers');
  });
});
