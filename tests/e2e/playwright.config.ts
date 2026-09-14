import { defineConfig, devices } from '@playwright/test';

const preview = process.env.IVX_REELS_PREVIEW === '1';

export default defineConfig({
  testDir: '.', testMatch: 'reels-acceptance.spec.ts', timeout: 45_000,
  forbidOnly: Boolean(process.env.CI), retries: 0,
  reporter: [['list'], ['html', { outputFolder: '../../qa/evidence/reels-acceptance', open: 'never' }]],
  webServer: preview ? {
    command: 'bun qa/landing-19-preview.mjs', cwd: '../..',
    url: 'http://127.0.0.1:4175', timeout: 15_000, reuseExistingServer: false,
  } : undefined,
  use: { ...devices['Desktop Chrome'], channel: 'chrome',
    baseURL: preview ? 'http://127.0.0.1:4175' : process.env.LANDING_BASE ?? 'http://127.0.0.1:4173',
    trace: 'retain-on-failure', screenshot: 'only-on-failure' },
});
