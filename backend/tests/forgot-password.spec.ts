import { test, expect } from '@playwright/test';

test.describe('Forgot Password Flow', () => {
  test('User should be able to request password reset', async ({ page }) => {
    await page.goto('https://yourapp.com/login');
    await page.click('text=Forgot Password');
    await page.fill('input[name="email"]', 'user@example.com');
    await page.click('text=Submit');
    const successMessage = await page.locator('text=Check your email for a reset link');
    await expect(successMessage).toBeVisible();
  });
});
