import { chromium } from 'playwright-core';
import fs from 'fs';

const SHOTS = 'screenshots/qa-no-loading-2026-07-05';
fs.mkdirSync(SHOTS, { recursive: true });
const exec = '/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

async function shoot(url, name, width, height) {
  const browser = await chromium.launch({
    executablePath: exec,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  // Capture immediately to prove no loading screen
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  const elapsed = Date.now() - t0;
  const title = await page.title().catch(() => '?');
  // Check for any "Loading" text in the DOM
  const loadingVisible = await page.locator('text=Loading IVX').count().catch(() => 0);
  await browser.close();
  const stat = fs.statSync(`${SHOTS}/${name}.png`);
  console.log(`${name}: ${width}x${height} ${elapsed}ms title="${title}" loadingText=${loadingVisible} bytes=${stat.size}`);
}

await shoot('https://chat.ivxholding.com', '01-chat-desktop-instant', 1440, 900);
await shoot('https://chat.ivxholding.com', '02-chat-android-instant', 412, 915);
await shoot('https://chat.ivxholding.com', '03-chat-ios-instant', 390, 844);
console.log('DONE');
