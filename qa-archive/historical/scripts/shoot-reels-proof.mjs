import { chromium } from 'playwright-core';
import fs from 'fs';

const SHOTS = 'screenshots/qa-reels-sync-2026-07-12';
fs.mkdirSync(SHOTS, { recursive: true });

async function shoot(url, name, width, height) {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const logs = [];
  page.on('console', msg => logs.push(`[console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => logs.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', req => logs.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText}`));
  const t0 = Date.now();

  try {
    await page.goto(`${url}/(tabs)/(home)/home`, { waitUntil: 'networkidle', timeout: 30000 });
  } catch {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  }
  await page.waitForTimeout(3000);

  try {
    const reelsBtn = page.locator('[data-testid="home-reels-button"]').first();
    await reelsBtn.click({ timeout: 5000 });
    await page.waitForTimeout(7000);
  } catch (e) {
    logs.push(`[reels-click] failed: ${e.message}`);
  }

  const checks = {
    fullScreenVideo: await page.locator('[data-testid^="video-item-"]').count(),
    channelDeals: await page.locator('text=/Deals/i').count(),
    channelInvestments: await page.locator('text=/Investments/i').count(),
    channelBuyers: await page.locator('text=/Buyers/i').count(),
    channelSellers: await page.locator('text=/Sellers/i').count(),
    likeBtn: await page.locator('[data-testid^="video-like-"]').count(),
    commentBtn: await page.locator('[data-testid^="video-comment-"]').count(),
    shareBtn: await page.locator('[data-testid^="video-share-"]').count(),
    saveBtn: await page.locator('[data-testid^="video-save-"]').count(),
    followBtn: await page.locator('[data-testid^="video-follow-"]').count(),
    viewDealBtn: await page.locator('[data-testid^="video-view-deal-"]').count(),
    investBtn: await page.locator('[data-testid^="video-invest-"]').count(),
    roiText: await page.locator('text=/ROI/i').count(),
    minInvestText: await page.locator('text=/MIN INVEST/i').count(),
    minOwnershipText: await page.locator('text=/MIN OWNERSHIP/i').count(),
  };

  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  const elapsed = Date.now() - t0;
  const title = await page.title().catch(() => '?');
  const finalUrl = page.url();
  const stat = fs.statSync(`${SHOTS}/${name}.png`);
  fs.writeFileSync(`${SHOTS}/${name}-logs.json`, JSON.stringify(logs, null, 2));
  await browser.close();
  console.log(JSON.stringify({
    name, width, height, elapsed, title, finalUrl, bytes: stat.size, checks,
  }, null, 2));
}

await shoot('https://chat.ivxholding.com', '01-android-reels', 412, 915);
console.log('DONE');
