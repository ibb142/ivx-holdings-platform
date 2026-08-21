/** IVX Forgot Password E2E: candidate UI + live production auth contract. */
import { test, expect, type Page } from '@playwright/test';

const PROD_BASE = process.env.E2E_BASE_URL ?? 'https://ivxholding.com';
const UI_BASE = process.env.FORGOT_PASSWORD_BASE_URL ?? PROD_BASE;
const QA_EMAIL = `qa-e2e-fp-${Date.now()}@ivxholding.com`;

async function openPortalForgotView(page: Page): Promise<void> {
  await page.goto(UI_BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'My Portal' }).first().click();
  await expect(page.locator('#portal-login-view')).toBeVisible({ timeout: 15000 });
  await page.locator('#portal-forgot-link-line a').click();
  await expect(page.locator('#portal-forgot-view')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#portal-forgot-form')).toBeVisible();
}

test.describe('Forgot Password — candidate landing portal', () => {
  test('Sign In view exposes Forgot password and toggles both ways', async ({ page }) => {
    await openPortalForgotView(page);
    await expect(page.locator('#portal-forgot-email')).toBeVisible();
    await expect(page.locator('#portal-forgot-btn')).toHaveText(/Send Reset Link/);
    await page.locator('#portal-forgot-view').getByText('Back to sign in').click();
    await expect(page.locator('#portal-forgot-view')).toBeHidden();
    await expect(page.locator('#portal-login-view')).toBeVisible();
  });

  test('email input validation rejects an invalid email', async ({ page }) => {
    await openPortalForgotView(page);
    await page.evaluate(() => (document.getElementById('portal-forgot-form') as HTMLFormElement | null)?.setAttribute('novalidate', 'novalidate'));
    await page.locator('#portal-forgot-email').fill('not-an-email');
    await page.locator('#portal-forgot-btn').click();
    await expect(page.locator('#portal-forgot-error')).toBeVisible();
    await expect(page.locator('#portal-forgot-error')).toHaveText(/Enter a valid email/);
  });

  test('real reset request: production Supabase recover accepts request', async ({ request }) => {
    const cfgResp = await request.get(PROD_BASE + '/ivx-config.json');
    expect(cfgResp.ok()).toBeTruthy();
    const cfg = await cfgResp.json() as Record<string, string>;
    const supabaseUrl = cfg.SUPABASE_URL || cfg.supabaseUrl || cfg.IVX_SUPABASE_URL;
    const anonKey = cfg.SUPABASE_ANON_KEY || cfg.supabaseAnonKey || cfg.IVX_SUPABASE_ANON_KEY;
    expect(supabaseUrl).toMatch(/^https:\/\//);
    expect(anonKey).toBeTruthy();
    const response = await request.post(supabaseUrl.replace(/\/+$/, '') + '/auth/v1/recover', {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
      data: { email: QA_EMAIL, gotrue_meta_security: {}, redirect_to: PROD_BASE + '/reset-password.html' },
    });
    expect(response.status()).toBe(200);
  });
});

test.describe('Forgot Password — production reset-password.html', () => {
  test('missing recovery params is rejected as incomplete/expired', async ({ page }) => {
    await page.goto(PROD_BASE + '/reset-password.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.status')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.status')).toContainText(/incomplete or expired/i);
  });
  test('invalid recovery code is rejected', async ({ page }) => {
    await page.goto(PROD_BASE + '/reset-password.html?code=definitely-invalid-code', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.status')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.status')).toContainText(/Could not verify your recovery link/i);
  });
});
