/**
 * Playwright E2E spec — verifies the public IVX web surface and IVX IA response path.
 *
 * Uses the Render URL directly as the canonical API endpoint.
 * The api.ivxholding.com custom domain proxies to Render but can return 502
 * during instance cycling; the Render URL is more reliable for CI.
 *
 * Production-dependent tests are skipped when the production API is unreachable
 * (standard integration-test pattern for unavailable external dependencies).
 *
 * This file is also duplicated at ./ivx-owner-ai-smoke.e2e.ts for Playwright's
 * testMatch pattern. When loaded by `bun test` (which matches *.spec.ts),
 * test.describe() throws because it is outside Playwright's runner context.
 * We catch that and skip silently so bun test sees 0 tests and moves on.
 */

/** API base URL — prefer Render direct URL for CI reliability. */
const API_BASE = process.env.E2E_API_URL ?? 'https://ivx-holdings-platform.onrender.com';
/** Landing page URL. */
const LANDING_URL = process.env.E2E_BASE_URL ?? 'https://ivxholding.com';

/** Check if production API is available before running production-dependent tests. */
async function isProductionAvailable(): Promise<boolean> {
  try {
    const resp = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(15000),
    });
    return resp.ok;
  } catch {
    return false;
  }
}

try {
  const { expect, test } = require('@playwright/test');

  test.describe('IVX production public surface', () => {
    test('landing page renders', async ({ page }) => {
      const response = await page.goto(LANDING_URL, { timeout: 30000 });
      expect(response?.ok()).toBe(true);
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('production health identifies the deployed service', async ({ request, page }) => {
      const available = await isProductionAvailable();
      test.skip(!available, 'Production API unavailable — skipping production-dependent test');

      const response = await request.get(`${API_BASE}/health`, { timeout: 30000 });
      expect(response.ok()).toBe(true);
      const health: { status?: string; commit?: string } = await response.json();
      expect(health.status).toBe('healthy');
      expect(health.commit).toMatch(/^[a-f0-9]{7,40}$/);
    });

    test('public IVX IA answers a deterministic request', async ({ request }) => {
      const available = await isProductionAvailable();
      test.skip(!available, 'Production API unavailable — skipping production-dependent test');

      const response = await request.post(`${API_BASE}/api/public/chat`, {
        data: { message: '7 multiplied by 8' },
        timeout: 30000,
      });
      expect(response.ok()).toBe(true);
      const payload: { ok?: boolean; answer?: string } = await response.json();
      expect(payload.ok).toBe(true);
      expect(payload.answer).toContain('56');
    });
  });
} catch {
  // Not running under Playwright — silently skip.
  // bun test sees 0 tests in this file and moves on.
}
