import { test, expect } from '@playwright/test';

test('mobile navigation responds and the canonical feed reaches the rendered page', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const feedResponse = page.waitForResponse(response =>
    new URL(response.url()).pathname === '/api/ivx/video-platform/home-feed' && response.ok(),
  { timeout: 30_000 });
  // Observe a possible network failure immediately while navigation is pending.
  void feedResponse.catch(() => {});
  const navigation = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(navigation?.status()).toBe(200);
  const menu = page.getByRole('button', { name: 'Toggle navigation menu' });
  await expect(menu).toBeVisible();
  await menu.tap();
  await expect(page.locator('.nav-links')).toBeVisible();
  await expect(page.getByRole('link', { name: 'My Portal', exact: true })).toBeVisible();
  await menu.tap();
  await expect(page.locator('.nav-links')).toBeHidden();

  const response = await feedResponse;
  const feed = await response.json();
  expect(response.headers()['x-ivx-data-state']).not.toBe('unavailable');
  expect(feed.code).not.toBe('PUBLIC_DATA_UNAVAILABLE');
  expect(feed.data_available).not.toBe(false);
  expect(feed.degraded === true && feed.data_available !== true).toBe(false);
  expect(Array.isArray(feed.blocks)).toBe(true);
  expect(feed.blocks.length).toBeGreaterThan(0);
  const videos = feed.blocks.filter(block => block.type === 'video' && block.video);
  expect(videos.length).toBeGreaterThan(0);

  // Only cards created from the API count; the static hero video cannot pass.
  const card = page.locator('.ivx-hf-video[data-ivx-home-feed-video]').first();
  await expect(card).toBeAttached();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toBeVisible();
  const renderedIds = await page.locator('.ivx-hf-video').evaluateAll(cards =>
    cards.map(element => element.getAttribute('data-ivx-home-feed-video')));
  expect(renderedIds).toEqual(expect.arrayContaining(videos.map(block => String(block.video.id))));
  await expect(card.locator('.ivx-hf-name')).not.toBeEmpty();
  expect(errors).toEqual([]);
  await testInfo.attach('mobile-feed-observation', {
    body: JSON.stringify({
      observedAt: new Date().toISOString(),
      testSourceSha: process.env.GITHUB_SHA ?? null,
      landingUrl: page.url(),
      device: testInfo.project.name,
      feedHttp: response.status(),
      blockCount: feed.blocks.length,
      renderedVideoCount: renderedIds.length,
      scope: 'Mobile browser navigation and live feed rendering; native authenticated Home and video playback are separate gates.',
    }, null, 2),
    contentType: 'application/json',
  });
  await testInfo.attach('mobile-feed-screen', { body: await page.screenshot(), contentType: 'image/png' });
});
