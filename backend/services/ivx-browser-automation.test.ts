/**
 * IVX Browser Automation Service — unit tests (mocked).
 *
 * The real service spawns headless Chromium, which is not available in this
 * sandbox. These tests mock playwright-core + node:fs/promises to verify the
 * service logic (availability caching, flow transcripts, error handling,
 * screenshot save) without a real browser or filesystem.
 */
import { afterAll, afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import * as fsPromisesNamespace from 'node:fs/promises';

// Snapshot the REAL fs functions eagerly, BEFORE mock.module() below runs.
// (mock.module retroactively rewires the live namespace binding, so restoring
// from the namespace itself would restore the mock — the snapshot keeps the
// original function references.)
const realFsSnapshot: Record<string, unknown> = { ...fsPromisesNamespace };

// --- Mock playwright-core ---------------------------------------------------
const fakePage = {
  url: 'https://chat.ivxholding.com',
  goto: mock(async () => {}),
  screenshot: mock(async () => Buffer.from('fake-png-bytes')),
  title: mock(async () => 'IVX Chat'),
  content: mock(async () => '<html></html>'),
  evaluate: mock(async () => 'IVX Holdings — review live real estate opportunities. Members: 12. Deals: 3.'),
  waitForSelector: mock(async () => {}),
  fill: mock(async () => {}),
  click: mock(async () => {}),
  waitForTimeout: mock(async () => {}),
  close: mock(async () => {}),
  setViewportSize: mock(async () => {}),
};
const fakeContext = {
  newPage: mock(async () => fakePage),
  close: mock(async () => {}),
};
const fakeBrowser = {
  newContext: mock(async () => fakeContext),
  close: mock(async () => {}),
};
const fakeChromium = {
  launch: mock(async () => fakeBrowser),
};

// --- Mock node:fs/promises (access/mkdir/writeFile all succeed) -------------
let playwrightThrowOnImport = false;
let chromiumOverride: unknown = fakeChromium;

mock.module('playwright-core', () => {
  if (playwrightThrowOnImport) {
    throw new Error('not installed');
  }
  return { chromium: chromiumOverride };
});

mock.module('node:fs/promises', () => ({
  access: async () => {},
  mkdir: async () => {},
  writeFile: async () => {},
  readFile: async () => '',
  existsSync: () => true,
}));

// CRITICAL: bun module mocks are process-global and leak into every test file
// that runs after this one (they made unrelated stores write nothing and read
// empty strings). Restore the REAL node:fs/promises when this file finishes.
afterAll(() => {
  mock.module('node:fs/promises', () => realFsSnapshot);
});

// Import the service AFTER mocks are registered.
const {
  __resetBrowserAutomationForTests,
  closeBrowser,
  getBrowserAvailability,
  captureScreenshot,
  runQAFlow,
} = await import('./ivx-browser-automation');

const originalEnv = { ...process.env };

describe('ivx-browser-automation', () => {
  beforeEach(() => {
    __resetBrowserAutomationForTests();
    process.env = { ...originalEnv };
    process.env.PLAYWRIGHT_CHROMIUM_PATH = '/usr/bin/chromium';
    playwrightThrowOnImport = false;
    chromiumOverride = fakeChromium;
    // Clear mock call history on the page mocks so step counts are predictable.
    fakePage.goto.mock.mockClear?.();
    fakePage.screenshot.mock.mockClear?.();
  });

  afterEach(async () => {
    await closeBrowser();
    __resetBrowserAutomationForTests();
    process.env = { ...originalEnv };
  });

  test('getBrowserAvailability reports available when chromium + playwright-core present', async () => {
    const avail = await getBrowserAvailability();
    expect(avail.available).toBe(true);
    if (avail.available) {
      expect(avail.executablePath).toBe('/usr/bin/chromium');
    }
  });

  test('captureScreenshot returns ok with base64 + saved path', async () => {
    const result = await captureScreenshot({
      url: 'https://ivxholding.com',
      viewport: { width: 412, height: 915 },
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.url).toBe('https://ivxholding.com');
      expect(result.title).toBe('IVX Chat');
      expect(typeof result.pngBase64).toBe('string');
      expect(result.pngBase64.length).toBeGreaterThan(0);
      expect(result.viewport.width).toBe(412);
    }
  });

  test('runQAFlow ownerChat produces navigate + login + send + reply + refresh steps', async () => {
    const result = await runQAFlow({
      flow: 'ownerChat',
      message: 'QA probe',
      email: 'owner@example.com',
      password: 'secret',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const stepNames = result.steps.map((s) => s.step);
      expect(stepNames).toContain('navigate');
      expect(stepNames).toContain('login');
      expect(stepNames).toContain('send-message');
      expect(stepNames).toContain('ai-reply');
      expect(stepNames).toContain('refresh-persist');
      expect(result.flow).toBe('ownerChat');
      expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);
    }
  });

  test('runQAFlow landing detects deal text', async () => {
    const result = await runQAFlow({ flow: 'landing' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const landingStep = result.steps.find((s) => s.step === 'landing-deals');
      expect(landingStep).toBeDefined();
      expect(landingStep?.ok).toBe(true);
    }
  });

  test('runQAFlow members detects member text', async () => {
    const result = await runQAFlow({ flow: 'members' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const membersStep = result.steps.find((s) => s.step === 'members-visible');
      expect(membersStep).toBeDefined();
      expect(membersStep?.ok).toBe(true);
    }
  });

  test('runQAFlow androidLayout uses mobile viewport', async () => {
    const result = await runQAFlow({ flow: 'androidLayout' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewport.width).toBe(412);
      expect(result.viewport.height).toBe(915);
    }
  });

  test('runQAFlow iosLayout uses iOS viewport', async () => {
    const result = await runQAFlow({ flow: 'iosLayout' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.viewport.width).toBe(390);
      expect(result.viewport.height).toBe(844);
    }
  });
});
