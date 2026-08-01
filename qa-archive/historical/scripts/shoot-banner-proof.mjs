import { chromium } from 'playwright-core';
import fs from 'fs';

const SHOTS = 'screenshots/qa-banner-final-2026-07-05';
fs.mkdirSync(SHOTS, { recursive: true });
const exec = '/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

async function shootChat(url, name, width, height) {
  const browser = await chromium.launch({
    executablePath: exec,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  const title = await page.title().catch(() => '?');
  await browser.close();
  const stat = fs.statSync(`${SHOTS}/${name}.png`);
  console.log(`${name}: ${width}x${height} title="${title}" bytes=${stat.size}`);
}

await shootChat('https://chat.ivxholding.com', '01-chat-desktop-banner', 1440, 900);
await shootChat('https://chat.ivxholding.com', '02-chat-android-banner', 412, 915);
await shootChat('https://chat.ivxholding.com', '03-chat-ios-banner', 390, 844);
console.log('DONE');
