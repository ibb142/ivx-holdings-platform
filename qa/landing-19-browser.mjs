import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const unit = process.argv[2];
const supported = ['reels.autoplay-controls-browser', 'reels.engagement-browser', 'reels.scroll-navigation-browser', 'reels.production-render-browser', 'a11y.touch-targets-browser', 'a11y.contrast-focus-browser', 'perf.console-network-browser', 'e2e.production-browser-suite'];
assert.ok(supported.includes(unit), `Unsupported unit ${unit}`);
const base = process.env.LANDING_URL || 'https://ivxholding.com';
const browser = await chromium.launch();
const checks = [];
let error;
let failurePage, failureSignals;
let diagnostics;
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    const errors = [], failures = [];
    const mediaResponses = [];
    failurePage = page;
    failureSignals = { width, errors, failures, mediaResponses };
    page.on('response', (r) => {
      const url = new URL(r.url());
      if (/\/api\/reels(?:\/|$)|\/media\/reels\/|\/videos\//.test(url.pathname)) {
        mediaResponses.push({ path: url.pathname, status: r.status(), type: r.headers()['content-type'] });
      }
    });
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r) => { if (r.failure()?.errorText !== 'net::ERR_ABORTED') failures.push(`${r.method()} ${new URL(r.url()).pathname}: ${r.failure()?.errorText}`); });
    page.on('response', (r) => { if (r.status() >= 400) failures.push(`HTTP ${r.status()} ${new URL(r.url()).pathname}`); });
    await page.addInitScript(() => {
      window.__qaLongTasks = [];
      new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__qaLongTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
    });
    if (process.env.LANDING_PREVIEW_SOURCE) {
      const preview = new URL(process.env.LANDING_PREVIEW_SOURCE);
      assert.equal(preview.hostname, '127.0.0.1');
      // Serve reviewed PR files under the real page origin so the public API's
      // actual CORS policy still applies. Never use this as deployed evidence.
      await context.route(new URL(base).origin + '/**', async (route) => {
        const request = route.request(), url = new URL(request.url());
        assert.ok(['GET', 'HEAD'].includes(request.method()), 'Static preview cannot perform public writes');
        const response = await context.request.fetch(preview.origin + url.pathname + url.search, { method: request.method() });
        // Media and API routes managed by the existing edge are not static
        // repository files. Preserve their real public responses in preview.
        if (response.status() === 404) return route.continue();
        await route.fulfill({ response });
      });
    }
    if (unit === 'reels.engagement-browser') {
      // Isolated browser interaction fixture. No public likes, comments or
      // shares are posted; this unit certifies browser request/response wiring.
      let liked = false;
      const comments = [];
      page.on('dialog', (dialog) => dialog.accept('QA fixture'));
      await page.route('**/api/projects/*/*', async (route) => {
        const request = route.request(), path = new URL(request.url()).pathname;
        if (!/\/(like|comments|share)$/.test(path)) return route.continue();
        let payload = {};
        if (request.method() === 'POST') payload = request.postDataJSON();
        let data;
        if (path.endsWith('/like')) { assert.equal(request.method(), 'POST'); assert.ok(payload.guest_id); liked = !liked; data = { liked, like_count: Number(liked) }; }
        if (path.endsWith('/comments')) {
          if (request.method() === 'POST') { assert.ok(payload.body); comments.push({ id: 'qa-only', body: payload.body, guest_name: 'QA fixture', created_at: new Date().toISOString() }); }
          data = { success: true, comments, comment: comments.at(-1), comment_count: comments.length };
        }
        if (path.endsWith('/share')) { assert.equal(request.method(), 'POST'); assert.match(payload.share_url, /\?video=/); data = { share_count: 1 }; }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
      });
    }
    if (process.env.LANDING_PREVIEW_SOURCE && unit === 'reels.scroll-navigation-browser') {
      let releaseOldChannel;
      const changedChannel = new Promise((resolve) => { releaseOldChannel = resolve; });
      let heldInitial = false;
      await page.route('https://api.ivxholding.com/api/reels?**', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('type') === 'reel') {
          releaseOldChannel();
          return route.continue();
        }
        if (!heldInitial && url.searchParams.get('limit') === '6' && !url.searchParams.has('type') && !url.searchParams.has('channel')) {
          heldInitial = true;
          let timer;
          await Promise.race([changedChannel, new Promise((resolve) => { timer = setTimeout(resolve, 5000); })]);
          clearTimeout(timer);
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ videos: [{ id: 'stale-channel-fixture', title: 'Stale channel response', video_url: 'https://ivxholding.com/qa-stale-channel.mp4' }] }) });
        }
        return route.continue();
      });
    }
    if (process.env.LANDING_PREVIEW_SOURCE && unit === 'reels.production-render-browser') {
      // Reproduce the observed startup failure before accepting the real feed.
      let injectedUnavailable = false;
      await page.route('https://api.ivxholding.com/api/reels', async (route) => {
        if (injectedUnavailable || route.request().method() !== 'GET') return route.continue();
        injectedUnavailable = true;
        await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"isolated startup recovery fixture"}' });
      });
    }
    const response = await page.goto(base, { waitUntil: 'domcontentloaded' });
    assert.equal(response.status(), 200);
    await page.locator('#properties-grid .live-deal-card').first().waitFor({ state: 'visible' });
    if (unit.startsWith('reels.') || unit === 'e2e.production-browser-suite') {
      const preview = page.locator('#homeFeedReel');
      await preview.scrollIntoViewIfNeeded();
      await page.waitForFunction(() => { const v = document.querySelector('#homeFeedReel'); return v?.readyState >= 2 && v.videoWidth > 0 && !v.error; });
      if (unit === 'reels.production-render-browser') {
        const before = await preview.evaluate((v) => v.currentTime);
        await page.waitForFunction((t) => document.querySelector('#homeFeedReel').currentTime > t + 0.2, before);
      } else {
        await page.locator('#ivxReelsBtn').click();
        const modal = page.locator('#ivxReels');
        await modal.waitFor({ state: 'visible' });
        await modal.getByRole('button', { name: 'Project Reels', exact: true }).click();
        const slide = modal.locator('.ivxr-slide').first(), video = slide.locator('video');
        await page.waitForFunction(() => { const v = document.querySelector('#ivxReels .ivxr-slide video'); return v?.readyState >= 2 && !v.paused && v.videoWidth > 0; });
        if (unit === 'reels.autoplay-controls-browser') {
          const before = await video.evaluate((v) => v.muted);
          await slide.locator('.mute').click();
          assert.equal(await video.evaluate((v) => v.muted), !before);
          await video.click({ position: { x: 60, y: 150 } });
          await page.waitForFunction(() => document.querySelector('#ivxReels .ivxr-slide video').paused);
          await video.click({ position: { x: 60, y: 150 } });
          await page.waitForFunction(() => !document.querySelector('#ivxReels .ivxr-slide video').paused);
        }
        if (process.env.LANDING_PREVIEW_SOURCE && unit === 'reels.autoplay-controls-browser') {
          const originalSource = await video.getAttribute('src');
          assert.ok(originalSource, 'A decoded reel must have its own media source');
          await video.evaluate((v) => v.dispatchEvent(new Event('error')));
          assert.equal(await video.getAttribute('src'), originalSource, 'A media error must not substitute footage from another reel');
          await slide.getByRole('button', { name: 'Video failed — tap to retry', exact: true }).click();
          await page.waitForFunction(() => { const v = document.querySelector('#ivxReels .ivxr-slide video'); return v?.readyState >= 2 && !v.paused && v.videoWidth > 0; });
        }
        if (unit === 'reels.engagement-browser') {
          await slide.locator('.like').click();
          await page.waitForFunction(() => document.querySelector('#ivxReels .like').classList.contains('on'));
          await slide.locator('.cmt').click();
          await modal.locator('[data-r="cmtText"]').fill('Isolated QA interaction');
          await modal.locator('[data-r="cmtSend"]').click();
          await modal.locator('[data-r="sheetBody"]').getByText('Isolated QA interaction').waitFor();
          await modal.locator('[data-r="sheetClose"]').click();
          const shared = page.waitForResponse((r) => /\/share$/.test(new URL(r.url()).pathname) && r.request().method() === 'POST');
          await slide.locator('.shr').click();
          assert.equal((await shared).status(), 200);
          checks.push({ width, scope: 'isolated engagement UI fixture; no public writes' });
        }
        if (unit === 'reels.scroll-navigation-browser' || unit === 'e2e.production-browser-suite') {
          assert.ok(await modal.locator('.ivxr-slide').count() >= 2);
          await modal.locator('.ivxr-slide').nth(1).scrollIntoViewIfNeeded();
          await page.waitForFunction(() => document.querySelector('#ivxReels .ivxr-slide video').paused);
          await modal.locator('[data-r="close"]').click();
          await modal.waitFor({ state: 'hidden' });
          assert.notEqual(await page.evaluate(() => document.body.style.overflow), 'hidden');
          await page.reload({ waitUntil: 'domcontentloaded' });
          assert.equal(await page.locator('h1').count(), 1);
        }
      }
    }
    if (unit === 'a11y.touch-targets-browser') {
      const small = await page.locator('a,button,[role="button"]').evaluateAll((elements) => elements.flatMap((e) => {
        const r = e.getBoundingClientRect(), s = getComputedStyle(e);
        if (!r.width || !r.height || s.visibility === 'hidden' || s.display === 'inline') return [];
        return r.width < 44 || r.height < 44 ? [{ tag: e.tagName, id: e.id, width: r.width, height: r.height }] : [];
      }));
      assert.deepEqual(small, [], 'Every non-inline touch target must be at least 44 by 44 CSS pixels');
    }
    if (unit === 'a11y.contrast-focus-browser') {
      assert.ok(process.env.AXE_SOURCE, 'axe-core must be installed for actual contrast measurement');
      // Measure the settled interface, after finite entrance animations finish.
      await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running' || !Number.isFinite(animation.effect.getComputedTiming().endTime)));
      await page.addScriptTag({ content: await readFile(process.env.AXE_SOURCE, 'utf8') });
      const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: ['color-contrast'] })).violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) })));
      assert.deepEqual(violations, [], 'Color contrast violations');
      await page.keyboard.press('Tab');
      const focus = await page.evaluate(() => { const e = document.activeElement, s = getComputedStyle(e); return { tag: e.tagName, outline: parseFloat(s.outlineWidth), style: s.outlineStyle }; });
      assert.notEqual(focus.tag, 'BODY'); assert.ok(focus.outline >= 2 && focus.style !== 'none');
      await page.getByRole('link', { name: /Start Investor Intake/i }).first().focus();
      await page.keyboard.press('Enter');
      await page.locator('#funnel-overlay').waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await page.locator('#funnel-overlay').waitFor({ state: 'hidden' });
    }
    if (unit === 'perf.console-network-browser') {
      await page.locator('footer').scrollIntoViewIfNeeded();
      await page.locator('#properties-grid').scrollIntoViewIfNeeded();
      await page.waitForTimeout(2000);
      const durations = await page.evaluate(() => window.__qaLongTasks);
      assert.ok(durations.every((ms) => ms <= 2000), 'A main-thread task exceeded 2 seconds');
      assert.ok(durations.reduce((a, b) => a + b, 0) <= 10000, 'Total long-task time exceeded 10 seconds');
      assert.deepEqual(failures, [], 'Failed network requests');
      assert.deepEqual(errors, [], 'Browser console errors');
    } else assert.deepEqual(errors.filter((e) => !e.startsWith('Failed to load resource:')), [], 'Runtime errors');
    checks.push({ width, passed: true });
    await context.unrouteAll({ behavior: 'wait' });
    await context.close();
  }
} catch (e) {
  error = e.stack || e.message;
  process.exitCode = 1;
  diagnostics = { ...failureSignals };
  try {
    diagnostics.homeVideo = await failurePage.locator('#homeFeedReel').evaluate((v) => ({
      currentSrc: v.currentSrc, readyState: v.readyState, networkState: v.networkState,
      paused: v.paused, currentTime: v.currentTime, width: v.videoWidth,
      error: v.error && { code: v.error.code, message: v.error.message },
      sources: [...v.querySelectorAll('source')].map((s) => ({ src: s.src, type: s.type })),
      retryVisible: Boolean(v.parentNode.querySelector('.ivx-home-reel-retry:not([hidden])')),
    }));
  } catch (diagnosticError) { diagnostics.captureError = diagnosticError.message; }
}
finally {
  for (const context of browser.contexts()) await context.unrouteAll({ behavior: 'wait' });
  await browser.close();
  const result = { unit, sourceSha: process.env.GITHUB_SHA, passed: !error, checks, error, diagnostics, completedAt: new Date().toISOString() };
  result.sha256 = createHash('sha256').update(JSON.stringify(result)).digest('hex');
  await mkdir('evidence/landing-19', { recursive: true });
  await writeFile(`evidence/landing-19/${unit}.json`, JSON.stringify(result));
  console.log(JSON.stringify(result));
}
