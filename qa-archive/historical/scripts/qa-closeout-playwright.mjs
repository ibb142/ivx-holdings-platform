import { chromium, devices } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const OUT_DIR = '/home/user/rork-app/qa-evidence';
fs.mkdirSync(OUT_DIR, { recursive: true });

const BASE_URL = 'https://ivxholding.com';
const VIEWPORTS = [
  { name: 'mobile', viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2 },
  { name: 'desktop', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 },
];

async function captureLanding() {
  const results = [];
  const browser = await chromium.launch({ headless: true });

  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({
      viewport: vp.viewport,
      deviceScaleFactor: vp.deviceScaleFactor,
      recordVideo: { dir: path.join(OUT_DIR, `video-${vp.name}`), size: vp.viewport },
    });
    const page = await context.newPage();
    const consoleErrors = [];
    const pageErrors = [];
    page.on('console', msg => {
      if (msg.type() === 'error' || msg.type() === 'warning') {
        consoleErrors.push({ type: msg.type(), text: msg.text() });
      }
    });
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('requestfailed', req => consoleErrors.push({ type: 'network', text: `${req.url()} | ${req.failure()?.errorText}` }));

    try {
      await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      const screenshotPath = path.join(OUT_DIR, `landing-${vp.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true });

      const title = await page.title();
      const sections = await page.locator('section').count();
      const emptySections = await page.evaluate(() => {
        let count = 0;
        document.querySelectorAll('section').forEach(s => {
          if (!s.innerText.trim() && !s.querySelector('img') && !s.querySelector('video')) count++;
        });
        return count;
      });
      const reelsBtn = await page.locator('#ivxReelsBtn').count();
      const reelsOverlay = await page.locator('#ivxReels').count();
      const navLinks = await page.locator('nav a').count();
      const ctaCount = await page.locator('a, button').filter({ hasText: /Get Started|Invest Now|Join|Sign up|Start Earning/i }).count();
      const viewportWidth = await page.evaluate(() => window.innerWidth);
      const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      const horizontalScroll = docWidth > viewportWidth + 1;

      results.push({
        viewport: vp.name,
        screenshot: screenshotPath,
        title,
        sections,
        emptySections,
        reelsBtn,
        reelsOverlay,
        navLinks,
        ctaCount,
        horizontalScroll,
        consoleErrors: consoleErrors.length,
        pageErrors: pageErrors.length,
        consoleSample: consoleErrors.slice(0, 5),
        pageErrorSample: pageErrors.slice(0, 5),
      });

      // Reels interaction test on mobile/desktop
      if (reelsBtn > 0 && vp.name !== 'tablet') {
        try {
          await page.locator('#ivxReelsBtn').click({ timeout: 5000 });
          await page.waitForTimeout(1500);
          const reelsOpen = await page.locator('#ivxReels.open').count();
          const slideCount = await page.locator('.ivxr-slide').count();
          const videoCount = await page.locator('.ivxr-slide video').count();
          const activeVideo = await page.evaluate(() => {
            const v = document.querySelector('.ivxr-slide.active video') || document.querySelector('.ivxr-slide video');
            return v ? { paused: v.paused, muted: v.muted, currentTime: v.currentTime, src: v.src || v.querySelector('source')?.src } : null;
          });
          const reelsShot = path.join(OUT_DIR, `reels-${vp.name}.png`);
          await page.screenshot({ path: reelsShot, fullPage: false });
          results.push({ viewport: vp.name, reelsOpen, slideCount, videoCount, activeVideo, reelsShot });
          // Swipe test: scroll down through slides
          if (slideCount > 1) {
            const feed = await page.locator('.ivxr-feed');
            if (await feed.count()) {
              await feed.evaluate(el => el.scrollBy({ top: 600, behavior: 'instant' }));
              await page.waitForTimeout(800);
              const afterVideo = await page.evaluate(() => {
                const v = document.querySelector('.ivxr-slide.active video') || document.querySelectorAll('.ivxr-slide video')[1];
                return v ? { paused: v.paused, muted: v.muted, currentTime: v.currentTime } : null;
              });
              results.push({ viewport: vp.name, swipeTest: 'performed', afterVideo });
            }
          }
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        } catch (e) {
          results.push({ viewport: vp.name, reelsError: e.message });
        }
      }
    } catch (e) {
      results.push({ viewport: vp.name, error: e.message });
    } finally {
      await context.close();
    }
  }

  await browser.close();
  fs.writeFileSync(path.join(OUT_DIR, 'landing-audit.json'), JSON.stringify(results, null, 2));
  return results;
}

captureLanding().then(r => {
  console.log(JSON.stringify(r, null, 2));
}).catch(e => {
  console.error('FATAL:', e);
  process.exit(1);
});
