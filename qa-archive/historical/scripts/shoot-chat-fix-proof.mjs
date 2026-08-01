import { chromium } from 'playwright-core';
import fs from 'fs';

const SHOTS = 'screenshots/qa-chat-fix-2026-07-05';
fs.mkdirSync(SHOTS, { recursive: true });
const exec = '/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const EMAIL = 'iperez4242@gmail.com';
const PASSWORD = 'X146corp@1x146corp$$1';

async function shoot(url, name, width, height) {
  const browser = await chromium.launch({
    executablePath: exec,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  const elapsed = Date.now() - t0;
  const title = await page.title().catch(() => '?');
  await browser.close();
  const stat = fs.statSync(`${SHOTS}/${name}.png`);
  console.log(`${name}: ${width}x${height} ${elapsed}ms title="${title}" bytes=${stat.size}`);
}

await shoot('https://chat.ivxholding.com', '01-landing-desktop', 1440, 900);
await shoot('https://chat.ivxholding.com', '02-landing-android', 412, 915);
await shoot('https://chat.ivxholding.com', '03-landing-ios', 390, 844);
console.log('DONE');
