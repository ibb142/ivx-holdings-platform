import { test, expect, errors } from '@playwright/test';
import { canDeferReelsPlayback, observeReelsFeed } from './reels-feed-observation';

test('Reels navigation reaches an available feed and advances decoded video frames', async ({ page }, info) => {
  const navigation = await page.goto('/');
  expect(navigation?.ok()).toBe(true);
  await page.locator('#ivxReelsBtn').click();
  const modal = page.locator('#ivxReels');
  await expect(modal).toBeVisible();
  const observations: Array<ReturnType<typeof observeReelsFeed>> = [];
  // Production certification explicitly requires playback; smoke runs can
  // report an unavailable dependency as SKIPPED with the observed evidence.
  const requirePlayback = process.env.IVX_REELS_REQUIRE_PLAYBACK !== undefined
    && process.env.IVX_REELS_REQUIRE_PLAYBACK !== '0';
  let playbackVerified = false;
  try {
    // Give the application's bounded retries a chance to recover first.
    const availableFeed = page.waitForResponse(async response => {
      const url = new URL(response.url());
      if (url.pathname !== '/api/reels' || url.searchParams.get('type') !== 'reel') return false;
      const body = await response.json().catch(() => null);
      const observation = observeReelsFeed(response.status(), body, response.headers()['x-ivx-data-state']);
      observations.push(observation);
      return observation.playbackCandidate;
    }, { timeout: 20_000 });
    // Only handle the response wait timeout. Navigation, click, HTTP and
    // playback failures are not classified as a skippable dependency outage.
    const feedResult = availableFeed.then(() => null, error => error);
    await modal.getByRole('button', { name: 'Project Reels', exact: true }).click();
    const feedError = await feedResult;
    if (feedError) {
      test.skip(!requirePlayback && feedError instanceof errors.TimeoutError
        && canDeferReelsPlayback(observations),
      'REELS_DEPENDENCY_UNAVAILABLE: HTTP 200 reports no usable data after app retries; playback remains unverified.');
      throw feedError;
    }
    const video = modal.locator('.ivxr-slide video').first();
    await expect(video).toBeVisible();
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) =>
      element.readyState >= 2 && element.videoWidth > 0 && !element.paused && !element.error), { timeout: 8_000 }).toBe(true);
    const before = await video.evaluate((element: HTMLVideoElement) => element.currentTime);
    await expect.poll(() => video.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 5_000 }).toBeGreaterThan(before + 0.2);
    playbackVerified = true;
    if (observations.some(value => !value.playbackCandidate)) {
      info.annotations.push({ type: 'recovered-feed', description: 'Playback recovered through app retries; initial feed availability was degraded.' });
    }
    if (observations.some(value => value.playbackCandidate && value.degraded)) {
      info.annotations.push({ type: 'degraded-feed', description: 'Decoded playback was verified using available data; dependency degradation remains recorded.' });
    }
  } finally {
    await info.attach('feed-health', { contentType: 'application/json', body: JSON.stringify({
      mode: requirePlayback ? 'required-playback' : 'smoke', playbackVerified, observations,
    }) });
  }
});

const outageScenarios: Array<{ name: string; status: number; body: Record<string, unknown>; headers: Record<string, string> }> = [
  { name: 'degraded HTTP 200', status: 200, body: { degraded: true, videos: [] }, headers: {} },
  { name: 'unavailable HTTP 200', status: 200, body: { data_available: false, videos: [] }, headers: {} },
  { name: 'unavailable response header', status: 200, body: { videos: [] }, headers: { 'x-ivx-data-state': 'unavailable' } },
  { name: 'dependency HTTP 503', status: 503, body: { ok: false, code: 'PUBLIC_DATA_UNAVAILABLE', videos: [] }, headers: {} },
];
for (const scenario of outageScenarios) {
  test(`a controlled ${scenario.name} exposes retry without claiming playable video`, async ({ page }, info) => {
    await info.attach('controlled-feed-response', { contentType: 'application/json', body: JSON.stringify(scenario) });
    // Isolate the outage from production dependencies, including the homepage
    // feed and analytics requested before the Reels modal opens.
    const pageOrigin = new URL(String(info.project.use.baseURL)).origin;
    await page.route(url => url.origin !== pageOrigin && !url.pathname.startsWith('/api/'), route => route.abort());
    await page.route(url => url.pathname.startsWith('/api/'), route => route.fulfill({
      status: 503, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: false, degraded: true, data_available: false, videos: [], blocks: [] }),
    }));
    // Playwright uses the last matching route, so this specific response wins.
    await page.route(/\/api\/reels(?:\?|$)/, route => route.fulfill({
      status: scenario.status, contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'x-ivx-data-state', ...scenario.headers },
      body: JSON.stringify(scenario.body),
    }));
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.locator('#ivxReelsBtn').click();
    const modal = page.locator('#ivxReels');
    await modal.getByRole('button', { name: 'Project Reels', exact: true }).click();
    await expect(modal.getByText('Feed failed to load.', { exact: false })).toBeVisible({ timeout: 20_000 });
    await expect(modal.getByRole('button', { name: 'Retry', exact: true })).toBeVisible();
    await expect(modal.locator('.ivxr-slide video')).toHaveCount(0);
  });
}
