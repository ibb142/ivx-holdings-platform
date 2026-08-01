import { chromium } from 'playwright-core';
import fs from 'fs';

const SHOTS = 'screenshots/qa-home-sync-2026-07-05';
fs.mkdirSync(SHOTS, { recursive: true });
const exec = '/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

async function shoot(url, name, width, height, attempts = ['/(tabs)/(home)/home', '/(tabs)/home', '/home']) {
  const browser = await chromium.launch({
    executablePath: exec,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const t0 = Date.now();

  let loadedUrl = url;
  for (const path of attempts) {
    try {
      await page.goto(`${url}${path}`, { waitUntil: 'networkidle', timeout: 30000 });
      loadedUrl = `${url}${path}`;
      break;
    } catch {
      console.log(`[${name}] failed to load ${url}${path}`);
    }
  }

  await page.waitForTimeout(4000);

  // Try to click the home tab if it exists
  try {
    const homeTab = page.locator('[data-testid="tab-home"], [role="tab"]:has-text("Home"), a:has-text("Home")').first();
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

await shoot('https://chat.ivxholding.com', '01-android-home', 412, 915);
await shoot('https://chat.ivxholding.com', '02-android-home-tablet', 768, 1024);
console.log('DONE');
