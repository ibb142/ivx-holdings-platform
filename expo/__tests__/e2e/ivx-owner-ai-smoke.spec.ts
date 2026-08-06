/**
 * Playwright E2E spec — verifies the public IVX web surface and IVX IA response path.
 *
 * This file is also duplicated at ./ivx-owner-ai-smoke.e2e.ts for Playwright's
 * testMatch pattern. When loaded by `bun test` (which matches *.spec.ts),
 * test.describe() throws because it is outside Playwright's runner context.
 * We catch that and skip silently so bun test sees 0 tests and moves on.
 */
try {
  const { expect, test } = require('@playwright/test');

  test.describe('IVX production public surface', () => {
    test('landing page renders', async ({ page }) => {
      const response = await page.goto('/');
      expect(response?.ok()).toBe(true);
      await expect(page.locator('body')).not.toBeEmpty();
    });

    test('production health identifies the deployed service', async ({ request }) => {
      const response = await request.get('https://api.ivxholding.com/health');
      expect(response.ok()).toBe(true);
      const health: { status?: string; commit?: string } = await response.json();
      expect(health.status).toBe('healthy');
      expect(health.commit).toMatch(/^[a-f0-9]{7,40}$/);
    });

    test('public IVX IA answers a deterministic request', async ({ request }) => {
      const response = await request.post('https://api.ivxholding.com/api/public/chat', {
        data: { message: '7 multiplied by 8' },
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
