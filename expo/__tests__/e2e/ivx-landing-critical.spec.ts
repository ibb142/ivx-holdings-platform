const LANDING_URL = process.env.E2E_BASE_URL ?? 'https://ivxholding.com';

try {
  const { expect, test } = require('@playwright/test');

  test.describe('IVX landing critical member surface', () => {
    test('Reels launcher opens the full-screen first-party Reels surface', async ({ page }) => {
      const response = await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      expect(response?.ok()).toBe(true);

      const launcher = page.locator('#ivxReelsBtn');
      await expect(launcher).toBeVisible({ timeout: 15_000 });
      await launcher.click();

      const reels = page.locator('#ivxReels');
      await expect(reels).toHaveClass(/open/, { timeout: 10_000 });
      await expect(reels).toBeVisible();
      await expect(reels.locator('.ivxr-feed')).toBeVisible();
    });

    test('registration and sign-in entry points are present on the public landing', async ({ page }) => {
      const response = await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      expect(response?.ok()).toBe(true);

      await expect(page.getByText('Become an IVX Member', { exact: false }).first()).toBeVisible();
      await expect(page.getByText('Free Member Registration', { exact: false }).first()).toBeVisible();
      await expect(page.getByText('Investor Portal', { exact: false }).first()).toBeAttached();
      await expect(page.getByText('Sign in to invest', { exact: false }).first()).toBeAttached();
    });

    test('anonymous landing wire surface keeps bank details behind authenticated app access', async ({ page }) => {
      const response = await page.goto(LANDING_URL, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      expect(response?.ok()).toBe(true);

      const wireHeading = page.getByText('Send funds directly by bank wire', { exact: false }).first();
      await expect(wireHeading).toBeVisible();

      const bodyText = await page.locator('body').innerText();
      const wireStart = bodyText.indexOf('Send funds directly by bank wire');
      expect(wireStart).toBeGreaterThanOrEqual(0);
      const wireSlice = bodyText.slice(wireStart, wireStart + 1_500);

      expect(wireSlice).toContain('Get Wire Instructions in App');
      expect(wireSlice).toContain('Bank details are sensitive');
      expect(wireSlice).toContain('full account number is available only in the authenticated app or via investor relations');
      expect(wireSlice.match(/\b\d{7,17}\b/g) ?? []).toHaveLength(0);
      expect(wireSlice.match(/\b\d{9}\b/g) ?? []).toHaveLength(0);
    });
  });
} catch {
  // bun test can discover *.spec.ts outside Playwright; skip silently there.
}
