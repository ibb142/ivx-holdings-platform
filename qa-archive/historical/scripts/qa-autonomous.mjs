import { chromium } from '@playwright/test';

const URL = 'https://ivxholding.com/';
const VIEWPORTS = [
  { name: 'iPhone Safari', width: 390, height: 844, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  { name: 'Android Chrome', width: 360, height: 800, userAgent: 'Mozilla/5.0 (Linux; Android 14; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36' },
  { name: 'Tablet', width: 768, height: 1024, userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1' },
  { name: 'Desktop Chrome', width: 1920, height: 1080, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
];

const results = [];

async function runViewport(browser, vp) {
  const context = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    userAgent: vp.userAgent,
  });
  const page = await context.newPage();
  
  const consoleErrors = [];
  const networkFailures = [];
  const consoleWarnings = [];
  
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
    if (msg.type() === 'warning') consoleWarnings.push(msg.text().slice(0, 150));
  });
  page.on('requestfailed', req => {
    networkFailures.push(req.url().slice(0, 100) + ' - ' + (req.failure()?.errorText || 'unknown'));
  });
  
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Check for horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const hasOverflow = scrollWidth > clientWidth + 2;
    
    // Check sections
    const sections = await page.evaluate(() => {
      const ids = ['properties', 'deals', 'reels', 'invest'];
      return ids.filter(id => document.getElementById(id) !== null);
    });
    
    // Check CTAs
    const ctaCount = await page.evaluate(() => {
      return document.querySelectorAll('a[href*="capture"], a[href*="join"], button[class*="btn"]').length;
    });
    
    // Check reel section
    const reelInfo = await page.evaluate(() => {
      const reelSection = document.getElementById('reels');
      if (!reelSection) return { exists: false, videos: 0, cards: 0 };
      const videos = reelSection.querySelectorAll('video').length;
      const cards = reelSection.querySelectorAll('[class*="vx-card"], [class*="reel-card"], [class*="story-card"]').length;
      return { exists: true, videos, cards };
    });
    
    // Check brand colors
    const brandColors = await page.evaluate(() => {
      const styles = document.documentElement.innerHTML;
      return {
        gold: (styles.match(/#FFD700/gi) || []).length,
        green: (styles.match(/#00C48C/gi) || []).length,
        red: (styles.match(/#FF4D4D/gi) || []).length,
        blue: (styles.match(/#4A90D9/gi) || []).length,
      };
    });
    
    // Check page jumping (scroll position stability)
    const scrollStable = await page.evaluate(async () => {
      const before = window.scrollY;
      await new Promise(r => setTimeout(r, 500));
      const after = window.scrollY;
      return Math.abs(after - before) < 5;
    });
    
    // Check no black sections (background colors)
    const blackSections = await page.evaluate(() => {
      const sections = document.querySelectorAll('section, div');
      let blackCount = 0;
      sections.forEach(s => {
        const style = window.getComputedStyle(s);
        const bg = style.backgroundColor;
        if (bg === 'rgb(0, 0, 0)' || bg === '#000000' || bg === '#000') {
          const rect = s.getBoundingClientRect();
          if (rect.width > 100 && rect.height > 100) blackCount++;
        }
      });
      return blackCount;
    });
    
    // Check image heights stability
    const imageHeights = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return imgs.slice(0, 10).map(img => ({
        src: img.src.slice(-30),
        height: img.offsetHeight,
        complete: img.complete,
      }));
    });
    
    // Test navigation - click a CTA
    let ctaWorks = false;
    try {
      const cta = await page.locator('a[href*="capture"]').first();
      if (cta) {
        const href = await cta.getAttribute('href');
        ctaWorks = href !== null;
      }
    } catch {}
    
    // Check video elements
    const videoInfo = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      return videos.map(v => ({
        src: v.src ? v.src.slice(-50) : 'none',
        poster: v.poster ? v.poster.slice(-30) : 'none',
        paused: v.paused,
        readyState: v.readyState,
      }));
    });
    
    const result = {
      viewport: vp.name,
      width: vp.width,
      height: vp.height,
      pageLoaded: true,
      hasOverflow,
      scrollWidth,
      clientWidth,
      sectionsFound: sections,
      ctaCount,
      reelExists: reelInfo.exists,
      reelVideos: reelInfo.videos,
      reelCards: reelInfo.cards,
      brandColors,
      scrollStable,
      blackSections,
      imageHeights: imageHeights.length,
      imagesComplete: imageHeights.filter(i => i.complete).length,
      ctaWorks,
      videoInfo,
      consoleErrors: consoleErrors.length,
      consoleErrorSamples: consoleErrors.slice(0, 3),
      consoleWarnings: consoleWarnings.length,
      networkFailures: networkFailures.length,
      networkFailureSamples: networkFailures.slice(0, 3),
      pass: !hasOverflow && sections.length >= 3 && scrollStable && blackSections === 0,
    };
    
    results.push(result);
    
    // Take screenshot
    await page.screenshot({ path: `/home/user/rork-app/qa-screenshots/qa-${vp.name.replace(/\s/g, '-').toLowerCase()}.png`, fullPage: false });
    
    console.log(`[${vp.name}] ${result.pass ? 'PASS' : 'FAIL'} - overflow=${hasOverflow} sections=${sections.length} errors=${consoleErrors.length} network=${networkFailures.length}`);
    
  } catch (err) {
    console.log(`[${vp.name}] ERROR: ${err.message}`);
    results.push({
      viewport: vp.name,
      pageLoaded: false,
      error: err.message,
      pass: false,
    });
  }
  
  await context.close();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  
  console.log('=== IVX AUTONOMOUS QA — CROSS-VIEWPORT ===');
  console.log('');
  
  for (const vp of VIEWPORTS) {
    await runViewport(browser, vp);
  }
  
  await browser.close();
  
  console.log('');
  console.log('=== SUMMARY ===');
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`Pass: ${passed}/${results.length}`);
  console.log(`Fail: ${failed}/${results.length}`);
  console.log('');
  
  // Print detailed results as JSON
  console.log('=== DETAILED RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
