import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.', testMatch: 'dashboard-acceptance.spec.ts', timeout: 35_000,
  forbidOnly: Boolean(process.env.CI), retries: 0, workers: 1,
  reporter: [['list']],
  outputDir: '../../qa/evidence/dashboard-acceptance',
  // Owner cookies/tokens must not be copied into public trace artifacts.
  use: { ...devices['Desktop Chrome'], trace: 'off', screenshot: 'off', video: 'off',
    ...(process.env.IVX_OWNER_STORAGE_STATE ? { storageState: process.env.IVX_OWNER_STORAGE_STATE } : {}) },
});
