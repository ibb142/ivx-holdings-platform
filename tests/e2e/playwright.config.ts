import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'reels-acceptance.spec.ts', timeout: 45_000,
  forbidOnly: Boolean(process.env.CI), retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../../qa/evidence/reels-acceptance', open: 'never' }]],
  use: { ...devices['Desktop Chrome'], channel: 'chrome',
    baseURL: process.env.LANDING_BASE ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
