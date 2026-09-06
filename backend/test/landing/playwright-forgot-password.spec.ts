import { test, expect } from '@playwright/test';

// Placeholder values
const baseUrl = 'https://example.com';
const email = 'test@example.com';

// Test for forgot password flow
test('Forgot Password', async ({ page }) => {
  // Navigate to the landing page
  await page.goto(`${baseUrl}/landing`);

  // Click on the 'Forgot Password' link
  await page.click('text=Forgot Password');

  // Fill the email input
  await page.fill('input[name=email]', email);

  // Submit the form
  await page.click('text=Submit');

  // Expect confirmation message
  await expect(page.locator('text=Check your email for password reset instructions')).toBeVisible();
});
