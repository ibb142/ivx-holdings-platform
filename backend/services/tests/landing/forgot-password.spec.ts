
import { test, expect } from '@playwright/test';

// Mock EMAIL for the test
const TEST_EMAIL = 'test@example.com';

// Reset link with token placeholder
const RESET_LINK = 'https://ivxholding.com/reset-password?token=';

// Helper to simulate email sending and token extraction
async function getResetPasswordToken(email: string): Promise<string> {
  // Simulate backend for email send
  await sendResetEmail(email);
  return 'mock-token'; // Replace with actual token extraction logic
}

test('forgot password flow', async ({ page }) => {
  await page.goto('https://ivxholding.com/forgot-password');

  // Fill email input
  await page.fill('input[name="email"]', TEST_EMAIL);

  // Submit form
  await page.click('button[type="submit"]');

  // Verify success message
  await expect(page.locator('[data-testid="password-reset-email-sent"]').textContent()).toContain('Check your email');

  // Simulate email and extract token
  const token = await getResetPasswordToken(TEST_EMAIL);

  // Open reset link with token
  await page.goto(RESET_LINK + token);

  // Verify reset page loads correctly
  await expect(page.locator('text=Reset your password')).toBeVisible();
});

async function sendResetEmail(email: string) {
  // Mock function: simulate backend email sending logic
  // This should call actual backend service
  console.log(`Simulating sending reset email to ${email}`);
}

