import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: 'landing-mobile-public.spec.mjs',
  timeout: 45_000,
  expect: { timeout: 20_000 },
  forbidOnly: true,
  retries: 0,
  workers: 1,
  outputDir: '../test-results/mobile-browser',
  reporter: [['list'], ['html', { outputFolder: 'evidence/mobile-browser', open: 'never' }]],
  use: {
    baseURL: process.env.LANDING_BASE ?? 'https://ivxholding.com',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'android-chrome', use: { ...devices['Pixel 7'] } },
    { name: 'iphone-webkit', use: { ...devices['iPhone 13'] } },
  ],
});
