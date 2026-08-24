/**
 * IVX Landing — Forgot Password E2E.
 * Real /recover request is asserted against production Supabase. The reset page
 * also gets a deterministic browser test for a valid recovery session so the
 * change-password path cannot regress silently.
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

  test('valid recovery fragment establishes session, updates password, then signs out', async ({ page }) => {
    await page.route('**/supabase.min.js', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/javascript',
        body: `
          window.__ivxRecoveryCalls = [];
          window.supabase = {
            createClient: function () {
              return { auth: {
                setSession: async function (tokens) { window.__ivxRecoveryCalls.push(['setSession', tokens]); return { data: { session: { user: { email: 'qa-recovery@ivxholding.com' } } }, error: null }; },
                getUser: async function () { return { data: { user: { email: 'qa-recovery@ivxholding.com' } }, error: null }; },
                getSession: async function () { return { data: { session: { user: { email: 'qa-recovery@ivxholding.com' } } }, error: null }; },
                updateUser: async function (attrs) { window.__ivxRecoveryCalls.push(['updateUser', attrs]); return { data: { user: { email: 'qa-recovery@ivxholding.com' } }, error: null }; },
                signOut: async function (opts) { window.__ivxRecoveryCalls.push(['signOut', opts]); return { error: null }; },
                verifyOtp: async function () { return { data: {}, error: null }; },
                exchangeCodeForSession: async function () { return { data: {}, error: null }; }
              }};
            }
          };
        `,
      });
    });
    await page.route('**/ivx-config.json', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ supabaseUrl: 'https://example.supabase.co', supabaseAnonKey: 'sb_publishable_test' }) });
    });

    await page.goto(BASE + '/reset-password.html#access_token=test-access&refresh_token=test-refresh&type=recovery', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('#form')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('#account')).toContainText('qa-recovery@ivxholding.com');
    await page.locator('#p1').fill('EnterprisePass123');
    await page.locator('#p2').fill('EnterprisePass123');
    await page.locator('#submit').click();
    await expect(page.locator('#done')).toBeVisible();
    await expect(page.locator('#status')).toContainText(/Password updated successfully/i);
    const calls = await page.evaluate(() => (window as any).__ivxRecoveryCalls);
    expect(calls[0][0]).toBe('setSession');
    expect(calls.some((c: any[]) => c[0] === 'updateUser' && c[1].password === 'EnterprisePass123')).toBeTruthy();
    expect(calls.some((c: any[]) => c[0] === 'signOut')).toBeTruthy();
  });
});
