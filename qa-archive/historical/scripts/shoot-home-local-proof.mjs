import { chromium } from 'playwright-core';
import fs from 'fs';

const SHOTS = 'screenshots/qa-home-sync-2026-07-05';
fs.mkdirSync(SHOTS, { recursive: true });
const exec = '/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

async function shoot(baseUrl, route, name, width, height) {
  const browser = await chromium.launch({
    executablePath: exec,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const t0 = Date.now();
  const url = `${baseUrl}${route}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  } catch (e) {
    console.log(`[${name}] navigation error: ${e.message}`);
  }
  await page.waitForTimeout(4000);

  // Try to click the home tab if visible
  try {
    const homeTab = page.locator('[data-testid="tab-home"], text=Home').first();
    await homeTab.click({ timeout: 3000 });
    await page.waitForTimeout(2000);
  } catch {}

  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  const elapsed = Date.now() - t0;
  const title = await page.title().catch(() => '?');
  const finalUrl = page.url();
  const members = await page.locator('text=/38/i').count().catch(() => 0);
  const investors = await page.locator('text=/6/i').count().catch(() => 0);
  const liveDeals = await page.locator('text=/3/i').count().catch(() => 0);
  const annualReturns = await page.locator('text=/Up to 22%/i').count().catch(() => 0);
  const exploreDeals = await page.locator('text=/Explore Deals/i').count().catch(() => 0);
  const buyShares = await page.locator('text=/Buy Property Shares/i').count().catch(() => 0);
  const jvPartnerships = await page.locator('text=/JV Partnerships/i').count().catch(() => 0);
  const smartInvesting = await page.locator('text=/Smart Investing/i').count().catch(() => 0);
  const investorDashboard = await page.locator('text=/Investor Dashboard/i').count().catch(() => 0);
  await browser.close();
  const stat = fs.statSync(`${SHOTS}/${name}.png`);
  console.log(JSON.stringify({
    name, width, height, elapsed, title, finalUrl, bytes: stat.size,
    members, investors, liveDeals, annualReturns, exploreDeals,
    buyShares, jvPartnerships, smartInvesting, investorDashboard,
  }, null, 2));
}

await shoot('http://localhost:8082', '/home', '01-android-home-local', 412, 915);
await shoot('http://localhost:8082', '/home', '02-android-home-local-tablet', 768, 1024);
console.log('DONE');
