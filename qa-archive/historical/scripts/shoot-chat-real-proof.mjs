import { chromium } from 'playwright-core';
import fs from 'fs';

const SHOTS = 'screenshots/qa-chat-real-proof-2026-07-05';
fs.mkdirSync(SHOTS, { recursive: true });
const exec = '/home/user/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome';

const EMAIL = 'iperez4242@gmail.com';
const PASSWORD = 'X146corp@1x146corp$$1';

async function shootChatRoom(name, width, height) {
  const browser = await chromium.launch({
    executablePath: exec,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage({ viewport: { width, height } });

  try {
    await page.goto('https://chat.ivxholding.com/ivx/chat', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(1200);

    // Try login if fields present
    const emailInput = page.locator('input[type="email"]').first();
    if (await emailInput.isVisible().catch(() => false)) {
      await emailInput.fill(EMAIL);
      await page.locator('input[type="password"]').first().fill(PASSWORD);
      await page.locator('button[type="submit"]').first().click();
      await page.waitForTimeout(2500);
    }

    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });

    const title = await page.title().catch(() => '?');
    const loadingText = await page.locator('text=Loading IVX').count().catch(() => 0);
    const scrollToLatestVisible = await page.locator('[data-testid="ivx-owner-chat-scroll-to-latest"]').count().catch(() => 0);
    const lastMessageVisible = await page.locator('text=/few seconds ago|just now|minutes ago|Today at/').first().isVisible().catch(() => false);
    const stat = fs.statSync(`${SHOTS}/${name}.png`);

    console.log(JSON.stringify({ name, viewport: `${width}x${height}`, title, loadingText, scrollToLatestVisible, lastMessageVisible, bytes: stat.size }));
  } catch (error) {
    console.log(`${name} failed: ${error.message}`);
    await page.screenshot({ path: `${SHOTS}/${name}-error.png`, fullPage: false }).catch(() => {});
  } finally {
    await browser.close();
  }
}

await shootChatRoom('01-desktop', 1440, 900);
await shootChatRoom('02-android', 412, 915);
await shootChatRoom('03-ios', 390, 844);
console.log('DONE');
