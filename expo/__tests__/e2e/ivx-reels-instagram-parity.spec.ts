import { test, expect } from '@playwright/test';

const API_BASE = process.env.E2E_API_URL ?? 'https://ivx-holdings-platform.onrender.com';

test.describe('IVX Reels Instagram-style production parity', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('landing stays clean and Reels completes the core vertical-video journey', async ({ page, request }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    // Real backend feed must be available and contain playable content.
    const feedResponse = await request.get(`${API_BASE}/api/ivx/video-platform/feed?limit=6&viewer_id=qa-reels-e2e`);
    expect(feedResponse.ok(), `feed HTTP ${feedResponse.status()}`).toBeTruthy();
    const feed = await feedResponse.json();
    const feedVideos = Array.isArray(feed?.videos) ? feed.videos : Array.isArray(feed) ? feed : [];
    expect(feedVideos.length).toBeGreaterThan(0);

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('body')).toBeVisible();

    // Preserve the latest modern landing surface: no horizontal overflow and no
    // legacy page-level spinner visible after initial load settles.
    await page.waitForTimeout(1200);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(2);
    await expect(page.locator('h1')).toContainText(/Real Estate Opportunities/i);
    expect(await page.locator('.spinner:visible').count()).toBe(0);

    // Reels must be discoverable from the landing surface and open full-screen.
    const reelsButton = page.locator('#ivxReelsBtn');
    await expect(reelsButton).toBeVisible({ timeout: 15_000 });
    await reelsButton.click();
    await expect(page.locator('#ivxReels.open')).toBeVisible({ timeout: 10_000 });

    const slides = page.locator('.ivxr-slide');
    await expect(slides.first()).toBeVisible({ timeout: 15_000 });
    const slideCount = await slides.count();
    expect(slideCount).toBeGreaterThan(0);
    expect(await page.locator('.ivxr-slide video').count()).toBeGreaterThan(0);

    // Instagram-style rail must expose the core engagement affordances.
    expect(await page.locator('.ivxr-act').count()).toBeGreaterThanOrEqual(4);

    // At most one player may be active/playing at a time.
    await page.waitForTimeout(1000);
    const playingBefore = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLVideoElement>('.ivxr-slide video'))
        .filter((video) => !video.paused && !video.ended).length,
    );
    expect(playingBefore).toBeLessThanOrEqual(1);

    // Mute/unmute must change the active player's state.
    const mute = page.locator('.ivxr-mute').first();
    await expect(mute).toBeVisible();
    const mutedBefore = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('.ivxr-slide.active video')
        ?? document.querySelector<HTMLVideoElement>('.ivxr-slide video');
      return video?.muted ?? null;
    });
    await mute.click();
    await page.waitForTimeout(250);
    const mutedAfter = await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>('.ivxr-slide.active video')
        ?? document.querySelector<HTMLVideoElement>('.ivxr-slide video');
      return video?.muted ?? null;
    });
    expect(mutedBefore).not.toBeNull();
    expect(mutedAfter).not.toBe(mutedBefore);

    // Vertical swipe/scroll must snap to the next reel and still keep one-player discipline.
    if (slideCount > 1) {
      const feedScroller = page.locator('.ivxr-feed');
      const beforeIndex = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('.ivxr-slide'));
        const active = document.querySelector('.ivxr-slide.active');
        return all.indexOf(active as Element);
      });
      await feedScroller.evaluate((el) => el.scrollBy({ top: window.innerHeight, behavior: 'instant' }));
      await page.waitForTimeout(900);
      const after = await page.evaluate(() => {
        const all = Array.from(document.querySelectorAll('.ivxr-slide'));
        const active = document.querySelector('.ivxr-slide.active');
        const playing = Array.from(document.querySelectorAll<HTMLVideoElement>('.ivxr-slide video'))
          .filter((video) => !video.paused && !video.ended).length;
        return { index: all.indexOf(active as Element), playing };
      });
      expect(after.index).not.toBe(beforeIndex);
      expect(after.playing).toBeLessThanOrEqual(1);
    }

    // A visible engagement action must respond to user input instead of being a dead control.
    const firstAction = page.locator('.ivxr-act').first();
    const classBefore = await firstAction.getAttribute('class');
    await firstAction.click();
    await page.waitForTimeout(350);
    const classAfter = await firstAction.getAttribute('class');
    expect(classAfter).not.toBeNull();
    expect(classAfter).not.toBe(classBefore);

    // Escape closes the full-screen experience cleanly.
    await page.keyboard.press('Escape');
    await expect(page.locator('#ivxReels.open')).toHaveCount(0);

    // Ignore browser-policy/media autoplay warnings, but fail on real JS exceptions.
    expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    const seriousConsoleErrors = consoleErrors.filter((msg) =>
      !/autoplay|play\(\) request|favicon|net::ERR_BLOCKED_BY_CLIENT/i.test(msg),
    );
    expect(seriousConsoleErrors, seriousConsoleErrors.join('\n')).toEqual([]);
  });
});
