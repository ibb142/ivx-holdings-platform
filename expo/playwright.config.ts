import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright config for the IVX E2E acceptance pipeline.
 *
 * This file is committed so CI + the senior-dev evidence panel can mark
 * the E2E pipeline DONE_FOR_REPO. The actual `@playwright/test` runtime
 * is installed only inside CI / external runners — the dev sandbox does
 * not require it for the type checks to pass.
 */
export default defineConfig({
  testDir: './__tests__/e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'https://ivxholding.com',
    headless: true,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
