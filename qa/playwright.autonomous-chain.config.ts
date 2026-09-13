import { defineConfig, devices } from '@playwright/test';

// Explicit configuration: this test sends a real owner command. It must never
// be discovered by expo/playwright.config.ts or retried as a flaky smoke test.
export default defineConfig({
  testDir: './e2e',
  testMatch: 'complete-autonomous-chain.spec.ts',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  repeatEach: 1,
  forbidOnly: true,
  timeout: 45 * 60_000,
  expect: { timeout: 60_000 },
  reporter: [['line']],
  outputDir: './evidence/autonomous-chain/runner',
  use: { baseURL: 'https://chat.ivxholding.com', headless: true, actionTimeout: 30_000,
    navigationTimeout: 60_000, trace: 'off', screenshot: 'off', video: 'off' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
