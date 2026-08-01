import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const OUT_DIR = '/home/user/rork-app/qa-evidence';
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = 'https://ivxholding.com';
const API = 'https://api.ivxholding.com';

async function testReels() {
  const results = [];

  // 1. API-level verification
  const feedRes = await fetch(`${API}/api/ivx/video-platform/feed?limit=12&viewer_id=qa-browser-${Date.now()}`, {
    headers: { 'Accept': 'application/json' }
  });
  const feedText = await feedRes.text();
  let feed = {};
  try { feed = JSON.parse(feedText); } catch (e) { feed = { parseError: e.message }; }
  results.push({
    check: 'feed-api',
    status: feedRes.status,
    videoCount: Array.isArray(feed.videos) ? feed.videos.length : 0,
    feed_type: feed.feed_type,
    ordering: feed.ordering,
    firstVideo: feed.videos?.[0]?.id,
  });

  // 2. Media URL reachability
  const mediaChecks = [];
  if (feed.videos) {
    for (const v of feed.videos.slice(0, 6)) {
      const videoUrl = v.video_url || v.url || v.hls_url || v.mp4_url;
      const thumbUrl = v.thumbnail_url || v.thumbnail;
      if (videoUrl) {
        try {
          const r = await fetch(videoUrl, { method: 'GET', headers: { Range: 'bytes=0-1023' } });
          mediaChecks.push({ type: 'video', url: videoUrl, status: r.status, ok: r.ok });
        } catch (e) {
          mediaChecks.push({ type: 'video', url: videoUrl, error: e.message });
        }
      }
      if (thumbUrl) {
        try {
          const r = await fetch(thumbUrl, { method: 'HEAD' });
          mediaChecks.push({ type: 'thumbnail', url: thumbUrl, status: r.status, ok: r.ok });
        } catch (e) {
          mediaChecks.push({ type: 'thumbnail', url: thumbUrl, error: e.message });
        }
      }
    }
  }
  results.push({ check: 'media-urls', mediaChecks });

  // 3. Browser-level verification
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    recordVideo: { dir: path.join(OUT_DIR, 'video-reels'), size: { width: 390, height: 844 } },
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => pageErrors.push(err.message));

  await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(1000);

  // Open reels
  await page.locator('#ivxReelsBtn').click({ timeout: 10000 });
  await page.waitForTimeout(1500);
  const reelsOpen = await page.locator('#ivxReels.open').count() > 0;
  const slideCount = await page.locator('.ivxr-slide').count();
  const videoCount = await page.locator('.ivxr-slide video').count();
  const activeSlides = await page.locator('.ivxr-slide.active').count();

  results.push({ check: 'open-reels', reelsOpen, slideCount, videoCount, activeSlides });

  // Mute/unmute
  const muteBtn = await page.locator('.ivxr-mute').first();
  let muteChanged = false;
  if (await muteBtn.count()) {
    const before = await page.evaluate(() => {
      const v = document.querySelector('.ivxr-slide.active video') || document.querySelector('.ivxr-slide video');
      return v ? v.muted : null;
    });
    await muteBtn.click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => {
      const v = document.querySelector('.ivxr-slide.active video') || document.querySelector('.ivxr-slide video');
      return v ? v.muted : null;
    });
    muteChanged = before !== after;
    results.push({ check: 'mute-toggle', before, after, muteChanged });
  }

  // Like button
  const likeBtn = await page.locator('.ivxr-act').filter({ has: page.locator('i') }).first();
  let likeToggled = false;
  if (await likeBtn.count()) {
    const beforeClass = await likeBtn.getAttribute('class');
    await likeBtn.click();
    await page.waitForTimeout(300);
    const afterClass = await likeBtn.getAttribute('class');
    likeToggled = beforeClass !== afterClass;
    results.push({ check: 'like-button', beforeClass, afterClass, likeToggled });
  }

  // Swipe through all slides
  const swipeResults = [];
  for (let i = 0; i < Math.min(slideCount, 8); i++) {
    const feed = await page.locator('.ivxr-feed');
    const activeBefore = await page.evaluate(() => {
      const slides = document.querySelectorAll('.ivxr-slide');
      const active = document.querySelector('.ivxr-slide.active');
      return { total: slides.length, activeIndex: Array.from(slides).indexOf(active) };
    });
    await feed.evaluate(el => el.scrollBy({ top: window.innerHeight, behavior: 'instant' }));
    await page.waitForTimeout(700);
    const activeAfter = await page.evaluate(() => {
      const slides = document.querySelectorAll('.ivxr-slide');
      const active = document.querySelector('.ivxr-slide.active');
      const playing = Array.from(document.querySelectorAll('.ivxr-slide video')).map(v => !v.paused);
      return { total: slides.length, activeIndex: Array.from(slides).indexOf(active), playingVideos: playing.filter(Boolean).length };
    });
    swipeResults.push({ step: i, activeBefore, activeAfter });
  }
  results.push({ check: 'swipe-through', swipeResults });

  // Verify exactly one active player
  const oneActive = swipeResults.every(r => r.activeAfter.playingVideos <= 1);
  results.push({ check: 'one-active-player', oneActive, maxPlayingObserved: Math.max(...swipeResults.map(r => r.activeAfter.playingVideos)) });

  // Close reels
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  const reelsClosed = await page.locator('#ivxReels.open').count() === 0;
  results.push({ check: 'close-reels', reelsClosed });

  await page.screenshot({ path: path.join(OUT_DIR, 'reels-mobile-final.png'), fullPage: false });
  results.push({ check: 'console-errors', count: consoleErrors.length, sample: consoleErrors.slice(0, 5) });
  results.push({ check: 'page-errors', count: pageErrors.length, sample: pageErrors.slice(0, 5) });

  await context.close();
  await browser.close();

  fs.writeFileSync(path.join(OUT_DIR, 'reels-audit.json'), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
}

testReels().catch(e => { console.error('FATAL:', e); process.exit(1); });
