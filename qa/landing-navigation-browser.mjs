import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';

const base = (process.env.LANDING_URL || 'http://127.0.0.1:8080').replace(/\/$/, '');
const width = Number(process.env.VIEWPORT_WIDTH || 390);
const sha = process.env.GITHUB_SHA || 'local';
const live = process.env.VERIFY_PRODUCTION === 'true';
const checks = [];
const startedAt = new Date().toISOString();
const browser = await chromium.launch({ headless: true });
async function productionCommit() {
  const response = await fetch('https://api.ivxholding.com/health', { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200, 'Production API must be healthy');
  const health = await response.json();
  assert.equal(health.ok, true);
  assert.equal(health.commit, sha, 'Production commit changed during browser QA');
  return health.commit;
}
try {
  if (live) await productionCommit();
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  page.setDefaultTimeout(15_000);
  const response = await page.goto(`${base}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  assert.equal(response.status(), 200);
  await page.waitForFunction(() => typeof window.openFunnel === 'function');
  checks.push('landing loaded');
  const cta = page.getByRole('link', { name: /Start Investor Intake/i }).first();
  const modal = page.locator('#funnel-overlay');
  await cta.click();
  await modal.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#funnel-step-1').isVisible(), true);
  assert.equal(await page.evaluate(() => document.body.style.overflow), 'hidden');
  checks.push('intake opens and locks background scroll');
  await modal.locator('.funnel-close').click();
  await modal.waitFor({ state: 'hidden' });
  assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
  checks.push('close button restores page scroll');
  await cta.click();
  await modal.waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  await modal.waitFor({ state: 'hidden' });
  checks.push('Escape closes the modal');
  // Exercise actual browser history across a public legal route, without submitting user data.
  await page.goto(`${base}/privacy.html`, { waitUntil: 'domcontentloaded' });
  await page.goBack({ waitUntil: 'domcontentloaded' });
  assert.equal(new URL(page.url()).pathname, '/');
  await cta.click();
  await modal.waitFor({ state: 'visible' });
  await modal.locator('.funnel-close').click();
  await modal.waitFor({ state: 'hidden' });
  checks.push('browser Back restores working intake controls');
  if (live) await productionCommit();
} catch (error) {
  checks.push({ failed: error.message });
  process.exitCode = 1;
} finally {
  await browser.close();
  const result = { unit: 'navigation.back-modals-browser', agentNumber: 4, sourceSha: sha,
    environment: live ? 'production' : 'local', base, viewportWidth: width, startedAt,
    completedAt: new Date().toISOString(), passed: !process.exitCode, checks };
  result.sha256 = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  await mkdir('evidence/landing-navigation', { recursive: true });
  await writeFile(`evidence/landing-navigation/${width}.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
