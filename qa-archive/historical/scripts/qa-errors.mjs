import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();

  const allConsoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      allConsoleErrors.push({ text: msg.text().slice(0, 300), url: msg.location()?.url?.slice(0, 100) });
    }
  });

  await page.goto('https://ivxholding.com/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('=== ALL CONSOLE ERRORS (raw) ===');
  allConsoleErrors.forEach((e, i) => {
    console.log(`  [${i+1}] ${e.text}`);
    if (e.url) console.log(`       from: ${e.url}`);
  });
  console.log(`Total: ${allConsoleErrors.length}`);

  await browser.close();
}
main().catch(console.error);
