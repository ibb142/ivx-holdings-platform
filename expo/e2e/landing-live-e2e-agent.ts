import { test, expect } from '@playwright/test';

test('IVX LANDING-125 Invest Now flow', async ({ page }) => {
  await page.goto('https://ivxlanding.example.com');

  // Simulate user clicking on 'Invest Now' button
  await page.click('text="Invest Now"');

  // Simulate user filling in investment details
  await page.fill('#investment-amount', '1000');
  await page.click('#submit-investment');

  // Verify navigation to the allowed flow
  await expect(page).toHaveURL(/.*flow-allowed/);
  await expect(page.locator('#confirmation-message')).toHaveText('Investment Successful');
});
