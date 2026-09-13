/**
 * IVX Landing — Forgot Password E2E.
 * Real /recover request is asserted against production Supabase. The reset page
 * also gets a deterministic browser test for a valid recovery session so the
 * change-password path cannot regress silently.
 */
import { test, expect, type Page } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL ?? 'https://ivxholding.com';
const QA_EMAIL = `qa-e2e-fp-${Date.now()}@ivxholding.com`;

function networkFailureCode(errorText?: string): string {
  return errorText?.match(/^net::[A-Z0-9_]+$/)?.[0] ?? 'REQUEST_FAILED';
}

const recoveryNetwork = new WeakMap<Page, Array<Record<string, unknown>>>();
test.beforeEach(async ({ page }) => {
  const events: Array<Record<string, unknown>> = [];
  const startedAt = Date.now();
  recoveryNetwork.set(page, events);
  const pathFor = (url: string) => {
    const parsed = new URL(url);
    return /\/(ivx-config\.json|api\/landing-config|auth\/v1\/recover)$/.test(parsed.pathname)
      ? parsed.origin + parsed.pathname : null;
  };
  page.on('response', response => {
    const path = pathFor(response.url());
    if (path) events.push({ path, status: response.status(), elapsedMs: Date.now() - startedAt });
  });
  page.on('requestfailed', request => {
    const path = pathFor(request.url());
    if (path) events.push({ path, failed: true, code: networkFailureCode(request.failure()?.errorText), elapsedMs: Date.now() - startedAt });
  });
});
test.afterEach(async ({ page }, info) => {
  if (info.status === info.expectedStatus) return;
  const diagnostic = { network: (recoveryNetwork.get(page) || []).slice(-12),
    forgotErrorVisible: await page.locator('#portal-forgot-error').isVisible().catch(() => false),
    forgotSuccessVisible: await page.locator('#portal-forgot-success').isVisible().catch(() => false) };
  console.log('RECOVERY_DIAGNOSTIC ' + JSON.stringify(diagnostic));
});

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
    // Allow setup, the existing 20s application deadline and the UI assertion.
    // An aborted request still fails immediately; a longer test is not a retry.
    test.setTimeout(45000);
    await openPortalForgotView(page);
    await page.locator('#portal-forgot-email').fill(QA_EMAIL);
    const [request] = await Promise.all([
      page.waitForRequest(
        (r) => new URL(r.url()).pathname === '/auth/v1/recover' && r.method() === 'POST',
        { timeout: 10000 }, // Configuration readiness is bounded at 8s.
      ),
      page.locator('#portal-forgot-btn').click(),
    ]);
    // request.response() resolves to null on transport failure. Waiting only
    // for a response event hid the application's abort behind a second timeout.
    const response = await request.response();
    expect(response, `Supabase recovery transport failed: ${networkFailureCode(request.failure()?.errorText)}`).not.toBeNull();
    if (!response) throw new Error('Supabase recovery returned no HTTP response');
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
    await expect(page.locator('.status')).toContainText(/Could not verify your recovery link/i, { timeout: 20000 });
  });

  test('a stalled recovery exchange ends with an error and never reveals the password form', async ({ page }) => {
    await page.route('**/supabase.min.js', async route => {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: `window.supabase={createClient:()=>({auth:{exchangeCodeForSession:()=>new Promise(()=>{})}})};` });
    });
    await page.goto(BASE + '/reset-password.html?code=stalled-exchange', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('.status')).toContainText(/Verification timed out/i, { timeout: 20000 });
    await expect(page.locator('#form')).toBeHidden();
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
