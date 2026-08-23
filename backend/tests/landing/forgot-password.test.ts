import { chromium } from 'playwright';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('https://ivxholding.com/login');

  await page.click('text=Forgot Password');
  await page.fill('input[name="email"]', 'user@example.com');
  await page.click('button[type="submit"]');

  const confirmationMessage = await page.textContent('#confirmation');
  console.assert(confirmationMessage.includes('Password reset link sent'), 'Forgot password flow failed');

  await browser.close();
})();