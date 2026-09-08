import { test, expect } from '@playwright/test';

// Test for the forgot-password feature

test('Forgot Password Process', async ({ page }) => {
  // Go to landing page
  await page.goto('https://example.com');

  // Click the forgot password link
  await page.click('text=Forgot Password');

  // Fill in the email address
  await page.fill('input[type=email]', 'user@example.com');

  // Submit the forgot password form
  await page.click('button[type=submit]');

  // Verify confirmation message
  const confirmation = await page.textContent('text=Check your email');
  expect(confirmation).toBeTruthy();
});
