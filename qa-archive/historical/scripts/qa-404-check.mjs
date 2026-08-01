import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const allRequests = [];
  page.on('response', res => {
    if (res.status() >= 400) {
      allRequests.push({ url: res.url(), status: res.status() });
    }
  });

  await page.goto('https://ivxholding.com/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('=== ALL 4xx/5xx RESPONSES ===');
  allRequests.forEach((r, i) => {
    console.log(`  [${i+1}] ${r.status}: ${r.url}`);
  });
  console.log(`Total: ${allRequests.length}`);

  await browser.close();
}
main().catch(console.error);
