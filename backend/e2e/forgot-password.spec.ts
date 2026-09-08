import { test, expect } from '@playwright/test';

test('Forgot password flow', async ({ page }) => {
  await page.goto('https://yourapp.com/login');

  await page.click('text=Forgot Password');
  await page.fill('input[name="email"]', 'testuser@example.com');
  await page.click('text=Submit');

  await page.waitForSelector('text=Check your email for a reset link');

  // Simulate receiving the email and navigating to reset link (mocked)
  await page.goto('https://yourapp.com/reset-password?token=mockToken');

  await page.fill('input[name="newPassword"]', 'NewPass123!');
  await page.click('text=Reset Password');

  // Verify success message and redirected to login
  await page.waitForSelector('text=Your password has been reset');
  expect(page.url()).toContain('/login');
});
