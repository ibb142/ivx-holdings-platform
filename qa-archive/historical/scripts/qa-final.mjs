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
  const expected404s = []; // /api/reels, /api/members/authoritative-count are expected
  
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrors.push(msg.text().slice(0, 200));
  });
  page.on('response', res => {
    if (res.status() === 404) {
      const url = res.url();
      // Expected 404s: new endpoints not yet deployed
      if (url.includes('/api/reels') || url.includes('/api/members/authoritative-count')) {
        expected404s.push(url.slice(0, 80));
      } else if (!url.includes('supabase.co') && !url.includes('linkedin')) {
        networkFailures.push(`404: ${url.slice(0, 100)}`);
      }
    }
  });
  page.on('requestfailed', req => {
    const url = req.url();
    // Video ERR_ABORTED is expected IntersectionObserver behavior
    if (url.includes('/videos/original/') && req.failure()?.errorText === 'net::ERR_ABORTED') return;
    networkFailures.push(`${req.failure()?.errorText}: ${url.slice(0, 100)}`);
  });
  
  try {
    await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);
    
    // Check for horizontal overflow
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    const clientWidth = await page.evaluate(() => document.documentElement.clientWidth);
    const hasOverflow = scrollWidth > clientWidth + 2;
    
    // Check sections (only count visible major sections)
    const sections = await page.evaluate(() => {
      const ids = ['properties', 'reels', 'how-it-works', 'trust', 'reviews', 'credibility', 'waitlist'];
      return ids.filter(id => {
        const el = document.getElementById(id);
        return el && el.getBoundingClientRect().height > 0;
      });
    });
    
    // Check CTAs
    const ctaCount = await page.evaluate(() => {
      return document.querySelectorAll('a[href*="capture"], a[href*="join"], button[class*="btn"]').length;
    });
    
    // Check reel section
    const reelInfo = await page.evaluate(() => {
      const reelSection = document.getElementById('reels');
      if (!reelSection) return { exists: false, videos: 0, cards: 0, posters: 0 };
      const videos = reelSection.querySelectorAll('video');
      const cards = reelSection.querySelectorAll('.ivx-reel-card').length;
      const posters = Array.from(videos).filter(v => v.poster && v.poster.length > 0).length;
      return { exists: true, videos: videos.length, cards, posters };
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
    
    // Check images are loading
    const imageInfo = await page.evaluate(() => {
      const imgs = Array.from(document.querySelectorAll('img'));
      return {
        total: imgs.length,
        complete: imgs.filter(i => i.complete && i.naturalWidth > 0).length,
        broken: imgs.filter(i => i.complete && i.naturalWidth === 0).length,
      };
    });
    
    // Test CTA navigation
    let ctaWorks = false;
    try {
      const cta = await page.locator('a[href*="capture"]').first();
      if (cta) {
        const href = await cta.getAttribute('href');
        ctaWorks = href !== null && href.length > 0;
      }
    } catch {}
    
    // Check all videos have posters (poster-first rendering)
    const videoInfo = await page.evaluate(() => {
      const videos = Array.from(document.querySelectorAll('video'));
      return videos.map(v => ({
        hasPoster: v.poster && v.poster.length > 0,
        paused: v.paused,
        readyState: v.readyState,
      }));
    });
    const allVideosHavePosters = videoInfo.every(v => v.hasPoster);
    
    // Check for unexpected console errors (excluding 404s for undeployed endpoints)
    const unexpectedErrors = consoleErrors.filter(e => 
      !e.includes('404') && 
      !e.includes('reels') && 
      !e.includes('authoritative-count') &&
      !e.includes('landing_analytics')
    );
    
    const result = {
      viewport: vp.name,
      dimensions: `${vp.width}x${vp.height}`,
      pageLoaded: true,
      hasOverflow,
      sectionsFound: sections,
      sectionsCount: sections.length,
      ctaCount,
      reelExists: reelInfo.exists,
      reelVideos: reelInfo.videos,
      reelCards: reelInfo.cards,
      reelPosters: reelInfo.posters,
      allVideosHavePosters,
      brandColors,
      scrollStable,
      imageInfo,
      ctaWorks,
      videoInfo,
      consoleErrors: consoleErrors.length,
      unexpectedConsoleErrors: unexpectedErrors.length,
      expected404s: expected404s.length,
      networkFailures: networkFailures.length,
      networkFailureList: networkFailures.slice(0, 3),
      pass: !hasOverflow && sections.length >= 4 && scrollStable && ctaWorks && allVideosHavePosters && unexpectedErrors.length === 0,
    };
    
    results.push(result);
    
    // Take screenshot
    await page.screenshot({ path: `/home/user/rork-app/qa-screenshots/qa-final-${vp.name.replace(/\s/g, '-').toLowerCase()}.png`, fullPage: false });
    
    console.log(`[${vp.name}] ${result.pass ? 'PASS' : 'FAIL'} - overflow=${hasOverflow} sections=${sections.length} posters=${reelInfo.posters}/${reelInfo.videos} CTAs=${ctaCount} scrollStable=${scrollStable} unexpectedErrors=${unexpectedErrors.length}`);
    
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
  
  console.log('=== IVX AUTONOMOUS QA — FINAL CROSS-VIEWPORT ===');
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
  
  console.log('=== DETAILED RESULTS ===');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
