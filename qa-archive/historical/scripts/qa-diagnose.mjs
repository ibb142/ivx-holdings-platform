import { chromium } from '@playwright/test';

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  const failedRequests = [];
  page.on('requestfailed', req => {
    failedRequests.push({ url: req.url(), error: req.failure()?.errorText });
  });
  page.on('response', res => {
    if (res.status() === 404) {
      failedRequests.push({ url: res.url(), error: 'HTTP 404', status: res.status() });
    }
  });

  await page.goto('https://ivxholding.com/', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // Diagnose black sections
  const blackSectionInfo = await page.evaluate(() => {
    const elements = document.querySelectorAll('section, div, header, footer');
    const blackElements = [];
    elements.forEach(el => {
      const style = window.getComputedStyle(el);
      const bg = style.backgroundColor;
      const bgImage = style.backgroundImage;
      // Check for black/dark backgrounds
      if ((bg === 'rgb(0, 0, 0)' || bg === '#000000' || bg === '#000') ||
          (bg.startsWith('rgb(0, 0, 0') && !bgImage || bgImage === 'none')) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 100 && rect.height > 100) {
          blackElements.push({
            tag: el.tagName,
            id: el.id || null,
            className: (el.className || '').toString().slice(0, 80),
            bg: bg,
            bgImage: bgImage !== 'none' ? bgImage.slice(0, 80) : null,
            width: rect.width,
            height: rect.height,
            top: rect.top + window.scrollY,
            hasChildren: el.children.length > 0,
            childCount: el.children.length,
            innerHTML_length: el.innerHTML.length,
            textPreview: el.textContent?.slice(0, 100).trim() || null,
          });
        }
      }
    });
    return blackElements;
  });

  console.log('=== BLACK SECTIONS ===');
  blackSectionInfo.forEach((s, i) => {
    console.log(`  [${i+1}] <${s.tag}> id="${s.id}" class="${s.className}"`);
    console.log(`      bg: ${s.bg}  size: ${s.width}x${s.height}  top: ${s.top}`);
    console.log(`      children: ${s.childCount}  innerHTML: ${s.innerHTML_length} chars`);
    console.log(`      text: ${s.textPreview}`);
    console.log('');
  });

  // Check section IDs more carefully
  const allSections = await page.evaluate(() => {
    const sections = document.querySelectorAll('section[id], div[id]');
    return Array.from(sections).map(s => ({
      id: s.id,
      tag: s.tagName,
      top: s.getBoundingClientRect().top + window.scrollY,
      height: s.getBoundingClientRect().height,
      visible: s.getBoundingClientRect().height > 0,
    })).filter(s => s.id);
  });

  console.log('=== ALL SECTIONS WITH IDs ===');
  allSections.forEach(s => {
    console.log(`  ${s.tag} #${s.id}  top=${Math.round(s.top)}  height=${Math.round(s.height)}  visible=${s.visible}`);
  });

  // Check for deals section specifically
  const dealsInfo = await page.evaluate(() => {
    const deals = document.getElementById('deals') || document.getElementById('live-deals') || document.querySelector('[class*="deal"]');
    if (!deals) return { found: false };
    const rect = deals.getBoundingClientRect();
    return {
      found: true,
      id: deals.id,
      className: deals.className?.toString().slice(0, 60),
      top: rect.top + window.scrollY,
      height: rect.height,
    };
  });
  console.log('\n=== DEALS SECTION ===');
  console.log(JSON.stringify(dealsInfo, null, 2));

  // List all 404s and failed requests
  console.log('\n=== FAILED/404 REQUESTS ===');
  failedRequests.forEach((f, i) => {
    console.log(`  [${i+1}] ${f.error}: ${f.url.slice(0, 120)}`);
  });

  // Check if videos are loading properly
  const videoStatus = await page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.map((v, i) => ({
      index: i,
      src: v.src?.slice(-80) || 'none',
      poster: v.poster?.slice(-50) || 'none',
      paused: v.paused,
      readyState: v.readyState,
      networkState: v.networkState,
      error: v.error ? v.error.code : null,
      currentSrc: v.currentSrc?.slice(-80) || 'none',
    }));
  });
  console.log('\n=== VIDEO STATUS ===');
  videoStatus.forEach(v => {
    console.log(`  [${v.index}] readyState=${v.readyState} networkState=${v.networkState} paused=${v.paused} error=${v.error}`);
    console.log(`       src: ${v.src}`);
    console.log(`       poster: ${v.poster}`);
  });

  await browser.close();
}

main().catch(console.error);
