import { test, expect } from '@playwright/test';

test('Reels navigation reaches a healthy feed and advances decoded video frames', async ({ page }, info) => {
  const navigation = await page.goto('/');
  expect(navigation?.ok()).toBe(true);
  await page.locator('#ivxReelsBtn').click();
  const modal = page.locator('#ivxReels');
  await expect(modal).toBeVisible();
  const observations: Array<{ status: number; degraded: boolean; videoCount: number; healthy: boolean }> = [];
  try {
    // Observe the app's own bounded host retries. A failed response is evidence
    // of degradation, never enough to pass this playback acceptance test.
    const healthyFeed = page.waitForResponse(async response => {
      const url = new URL(response.url());
      if (url.pathname !== '/api/reels' || url.searchParams.get('type') !== 'reel') return false;
      const body = await response.json().catch(() => null);
      const degraded = !body || body.ok === false || body.degraded === true || body.data_available === false
        || body.code === 'PUBLIC_DATA_UNAVAILABLE' || response.headers()['x-ivx-data-state'] === 'unavailable';
      const videoCount = Array.isArray(body?.videos) ? body.videos.length : 0;
      const healthy = response.ok() && !degraded && videoCount > 0;
      observations.push({ status: response.status(), degraded, videoCount, healthy });
      return healthy;
    }, { timeout: 20_000 });
    await Promise.all([healthyFeed, modal.getByRole('button', { name: 'Project Reels', exact: true }).click()]);
    const video = modal.locator('.ivxr-slide video').first();
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
      element.readyState >= 2 && element.videoWidth > 0 && !element.paused && !element.error), { timeout: 8_000 }).toBe(true);
    const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 5_000 }).toBeGreaterThan(before + 0.2);
    if (observations.some(value => !value.healthy)) {
      info.annotations.push({ type: 'recovered-feed', description: 'Playback recovered through app retries; initial feed availability was degraded.' });
    }
  } finally {
    await info.attach('feed-health', { contentType: 'application/json', body: JSON.stringify({ observations }) });
  }
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
