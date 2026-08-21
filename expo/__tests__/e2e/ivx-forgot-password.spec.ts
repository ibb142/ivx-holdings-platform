/**
 * IVX Landing — Forgot Password E2E (Task 2 acceptance).
 *
 * Runs against the deployed landing (E2E_BASE_URL, default
 * https://ivxholding.com). In the QA sandbox it is also run against a local
 * static build of ivxholding-landing/ with the real production Supabase
 * config injected — the reset request still hits the REAL production
 * Supabase auth API (`POST /auth/v1/recover`), which is asserted via network
 * response interception, not just UI state.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'https://ivxholding.com';
const QA_EMAIL = `qa-e2e-fp-${Date.now()}@ivxholding.com`;

async function openPortalForgotView(page: Page): Promise<void> {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('link', { name: 'My Portal' }).first().click();
  await expect(page.locator('#portal-login-view')).toBeVisible({ timeout: 15000 });
  await page.locator('#portal-forgot-link-line a').click();
  await expect(page.locator('#portal-forgot-view')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('#portal-forgot-form')).toBeVisible();
}

test.describe('Forgot Password — landing portal', () => {
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
    // Native `required` blocks submit; bypass it to exercise the JS validation branch.
    await page.evaluate(() => {
      (document.getElementById('portal-forgot-form') as HTMLFormElement | null)?.setAttribute('novalidate', 'novalidate');
    });
    await page.locator('#portal-forgot-email').fill('not-an-email');
    await page.locator('#portal-forgot-btn').click();
    await expect(page.locator('#portal-forgot-error')).toBeVisible();
    await expect(page.locator('#portal-forgot-error')).toHaveText(/Enter a valid email/);
  });

  test('real reset request: Supabase /auth/v1/recover 200 + success state', async ({ page }) => {
    await openPortalForgotView(page);
    await page.locator('#portal-forgot-email').fill(QA_EMAIL);

    const recoverResponse = page.waitForResponse(
      (r) => r.url().includes('/auth/v1/recover') && r.request().method() === 'POST',
      { timeout: 30000 },
    );

    await page.locator('#portal-forgot-btn').click();
    const response = await recoverResponse;
    expect(response.status()).toBe(200);
    // Anti-enumeration: generic success copy, no error surfaced.
    await expect(page.locator('#portal-forgot-success')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#portal-forgot-success')).toContainText(/reset link has been sent/i);
    await expect(page.locator('#portal-forgot-error')).toBeHidden();
  });
});

test.describe('Forgot Password — reset-password.html', () => {
  test('missing recovery params is rejected as incomplete/expired', async ({ page }) => {
    await page.goto(BASE + '/reset-password.html', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.status')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.status')).toContainText(/incomplete or expired/i);
  });

  test('invalid recovery code is rejected', async ({ page }) => {
    await page.goto(BASE + '/reset-password.html?code=definitely-invalid-code', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.status')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.status')).toContainText(/Could not verify your recovery link/i);
  });
});
