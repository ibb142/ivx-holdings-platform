import { test, expect } from '@playwright/test';

test('Reels navigation loads a healthy feed and advances decoded video frames', async ({ page }, info) => {
  const navigation = await page.goto('/');
  expect(navigation?.ok()).toBe(true);
  await page.locator('#ivxReelsBtn').click();
  const modal = page.locator('#ivxReels');
  await expect(modal).toBeVisible();
  const feedResponse = page.waitForResponse(response => {
    const url = new URL(response.url());
    return url.pathname === '/api/reels' && url.searchParams.get('type') === 'reel';
  });
  await modal.getByRole('button', { name: 'Project Reels', exact: true }).click();
  const response = await feedResponse;
  expect(response.ok(), 'The feed requested by the page must succeed').toBe(true);
  const body = await response.json();
  const degraded = body.degraded === true || body.data_available === false
    || body.code === 'PUBLIC_DATA_UNAVAILABLE' || response.headers()['x-ivx-data-state'] === 'unavailable';
  await info.attach('feed-health', { contentType: 'application/json', body: JSON.stringify({
    status: response.status(), degraded, videoCount: Array.isArray(body.videos) ? body.videos.length : null,
  }) });
  expect(degraded, 'Degraded media cannot certify playback').toBe(false);
  const video = modal.locator('.ivxr-slide video').first();
  await expect(video).toBeVisible();
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
    element.readyState >= 2 && element.videoWidth > 0 && !element.paused && !element.error), { timeout: 15_000 }).toBe(true);
  const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
  await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 10_000 }).toBeGreaterThan(before + 0.2);
});

test('a controlled degraded feed exposes retry without claiming playable video', async ({ page }) => {
  await page.route(/\/api\/reels(?:\?|$)/, route => route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ ok: false, degraded: true, data_available: false, videos: [] }),
  }));
  await page.goto('/');
  await page.locator('#ivxReelsBtn').click();
  const modal = page.locator('#ivxReels');
  await modal.getByRole('button', { name: 'Project Reels', exact: true }).click();
  await expect(modal.getByText('Feed failed to load.', { exact: false })).toBeVisible({ timeout: 20_000 });
  await expect(modal.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
  await expect(modal.locator('.ivxr-slide video')).toHaveCount(0);
});
