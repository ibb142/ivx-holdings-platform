#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const agentNumber = Number(process.env.AGENT_NUMBER || process.argv[2]);
const agentId = process.env.AGENT_ID || `ivx_holdings_${agentNumber}`;
const baseUrl = (process.env.LANDING_URL || 'https://ivxholding.com').replace(/\/$/, '');
const sourceSha = process.env.GITHUB_SHA || 'local';
if (!Number.isInteger(agentNumber) || agentNumber < 1 || agentNumber > 112) {
  throw new Error('AGENT_NUMBER must be 1..112');
}

const evidence = [];
const consoleErrors = [];
const failedRequests = [];
const startedAt = new Date().toISOString();
let browser;

function record(name, passed, detail, severity = 'P1') {
  evidence.push({ name, passed: Boolean(passed), severity, detail: String(detail || '') });
}

async function http(path, init = {}) {
  const response = await fetch(path.startsWith('http') ? path : `${baseUrl}${path}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(20_000),
    ...init,
  });
  return response;
}

async function common(page) {
  const response = await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForTimeout(2_000);
  record('landing-http-200', response?.status() === 200, `HTTP ${response?.status()}`, 'P0');
  record('document-title', (await page.title()).trim().length >= 20, await page.title());
  record('primary-heading', await page.locator('h1').count() === 1, `h1=${await page.locator('h1').count()}`);
  record('no-horizontal-overflow', await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1), 'document width fits viewport', 'P0');
}

async function funnel(page) {
  const cta = page.getByRole('link', { name: /start investor intake/i }).first();
  record('primary-cta-visible', await cta.isVisible(), 'Start Investor Intake visible', 'P0');
  await cta.click();
  const dialogText = await page.locator('body').innerText();
  record('intake-opens', /STEP 1 OF 2/i.test(dialogText), 'Investor intake step 1 opened', 'P0');
  record('goal-options', await page.getByText(/Passive Income/i).count() > 0, 'Goal choices rendered');
  record('intake-close-control', await page.getByRole('button', { name: /close|×/i }).count() > 0, 'Close control exists');
}

async function advertising(page) {
  const before = await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name));
  record('no-obvious-pii-in-resource-urls', !before.some((url) => /%40|email=|phone=/i.test(url)), 'Resource URLs contain no obvious PII', 'P0');
  const cookieBanner = page.locator('#cookie-banner');
  await cookieBanner.waitFor({ state: 'visible', timeout: 5_000 }).catch(() => {});
  record('cookie-banner-visible', await cookieBanner.isVisible().catch(() => false), 'Consent prompt visible', 'P0');
  const essentials = page.getByRole('button', { name: /Essentials Only/i });
  if (await essentials.count()) await essentials.click();
  const consent = await page.evaluate(() => Object.entries(localStorage).filter(([key]) => /consent|cookie/i.test(key)));
  record('essential-consent-persisted', consent.length > 0, JSON.stringify(consent).slice(0, 500));
  record('marketing-copy-has-risk-language', /risk|loss of principal/i.test(await page.locator('body').innerText()), 'Risk language present');
}

async function seo(page) {
  const data = await page.evaluate(() => ({
    description: document.querySelector('meta[name="description"]')?.content || '',
    canonical: document.querySelector('link[rel="canonical"]')?.href || '',
    ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
    ogImage: document.querySelector('meta[property="og:image"]')?.content || '',
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map((el) => el.textContent),
  }));
  record('meta-description', data.description.length >= 70, data.description);
  record('canonical-apex', data.canonical === `${baseUrl}/` || data.canonical === baseUrl, data.canonical, 'P0');
  record('open-graph-complete', Boolean(data.ogTitle && data.ogImage), `${data.ogTitle} | ${data.ogImage}`);
  let valid = data.jsonLd.length > 0;
  for (const item of data.jsonLd) try { JSON.parse(item); } catch { valid = false; }
  record('structured-data-valid-json', valid, `blocks=${data.jsonLd.length}`);
}

async function performance(page) {
  const metrics = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    return { domContentLoadedMs: nav?.domContentLoadedEventEnd || 0, loadMs: nav?.loadEventEnd || 0, resources: resources.length, transferBytes: resources.reduce((sum, entry) => sum + (entry.transferSize || 0), 0) };
  });
  record('dom-content-loaded-under-5s', metrics.domContentLoadedMs > 0 && metrics.domContentLoadedMs < 5_000, JSON.stringify(metrics), 'P0');
  record('resource-count-under-120', metrics.resources < 120, JSON.stringify(metrics));
  record('transfer-under-8mb', metrics.transferBytes < 8 * 1024 * 1024, `${metrics.transferBytes} bytes`);
  record('images-have-dimensions', await page.evaluate(() => [...document.images].filter((img) => img.complete && img.naturalWidth > 0).every((img) => Boolean(img.width && img.height))), 'Loaded images expose rendered dimensions');
}

async function accessibility(page) {
  const a11y = await page.evaluate(() => {
    const visible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    };
    const accessibleName = (el) => Boolean(
      (el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.title)?.trim()
      || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`))
      || el.closest('label')
    );
    const smallTargetElements = [...document.querySelectorAll('a,button')].filter((el) => {
      if (!visible(el) || getComputedStyle(el).display === 'inline') return false;
      const r = el.getBoundingClientRect();
      return r.width < 24 || r.height < 24;
    });
    return {
      unnamedButtons: [...document.querySelectorAll('button')].filter((el) => visible(el) && !accessibleName(el)).length,
      unnamedInputs: [...document.querySelectorAll('input:not([type="hidden"]),textarea,select')].filter((el) => visible(el) && !accessibleName(el)).length,
      missingAlt: [...document.images].filter((img) => visible(img) && !img.hasAttribute('alt')).length,
      smallTargets: smallTargetElements.length,
      smallTargetDetails: smallTargetElements.slice(0, 20).map((el) => {
        const r = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || null,
          className: typeof el.className === 'string' ? el.className : null,
          text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 80),
          width: Math.round(r.width * 10) / 10,
          height: Math.round(r.height * 10) / 10,
        };
      }),
    };
  });
  record('buttons-have-accessible-name', a11y.unnamedButtons === 0, JSON.stringify(a11y), 'P0');
  record('inputs-have-accessible-name', a11y.unnamedInputs === 0, JSON.stringify(a11y));
  record('images-have-alt', a11y.missingAlt === 0, JSON.stringify(a11y));
  record('touch-targets', a11y.smallTargets === 0, JSON.stringify(a11y));
}

async function security(page) {
  const response = await http('/');
  const headers = Object.fromEntries(response.headers);
  record('content-security-policy', Boolean(headers['content-security-policy']), JSON.stringify(headers), 'P0');
  record('anti-clickjacking', /frame-ancestors/i.test(headers['content-security-policy'] || '') || Boolean(headers['x-frame-options']), JSON.stringify(headers), 'P0');
  record('nosniff', headers['x-content-type-options'] === 'nosniff', JSON.stringify(headers));
  record('https-only', page.url().startsWith('https://'), page.url(), 'P0');
}

async function legal(page) {
  const body = await page.locator('body').innerText();
  record('risk-of-loss', /loss of principal/i.test(body), 'Loss-of-principal disclosure visible', 'P0');
  record('no-guaranteed-return', !/guaranteed (return|roi|profit)/i.test(body), 'No guaranteed return language', 'P0');
  for (const path of ['/privacy.html', '/terms.html', '/disclosures.html', '/legal.html']) {
    const response = await http(path);
    record(`legal-${path.slice(1)}-reachable`, response.status === 200, `${path} HTTP ${response.status}`, 'P0');
  }
}

async function content(page) {
  const body = await page.locator('body').innerText();
  record('deal-count-consistent', /3 LIVE/i.test(body) && /3 live opportunities/i.test(body), 'Three published live opportunities shown');
  record('android-message-consistent', !(/Android app live now/i.test(body) && /Android apps are launching soon/i.test(body)), 'Live/coming-soon language must not conflict', 'P0');
  record('contact-email-visible', /investors@ivxholding\.com/i.test(body), 'Investor relations email visible');
  record('contact-phone-visible', /305.*300.*1500/.test(body), 'Investor relations phone visible');
}

async function deals(page) {
  const cards = page.locator('[class*="deal-card"], [data-deal-id]');
  const body = await page.locator('body').innerText();
  record('three-deals-visible', /Jacksonville/i.test(body) && /Perez Residence/i.test(body) && /Casa Rosario/i.test(body), 'All three deals rendered', 'P0');
  record('deal-actions-visible', await page.getByRole('link', { name: /Invest Now/i }).count() >= 3, 'Invest Now appears for deals', 'P0');
  record('no-broken-loaded-images', await page.evaluate(() => [...document.images].filter((img) => img.complete).every((img) => img.naturalWidth > 0)), 'All completed images decoded', 'P0');
  record('deal-card-dom-present', await cards.count() >= 3, `deal-like nodes=${await cards.count()}`);
}

async function chat(page) {
  record('chat-input-visible', await page.getByRole('textbox', { name: /Ask about investor intake/i }).isVisible(), 'Investor chat input visible', 'P0');
  record('chat-send-visible', await page.getByRole('button', { name: /Send/i }).isVisible(), 'Send button visible');
  record('human-support-visible', await page.getByRole('button', { name: /Request Live Investor Support/i }).isVisible(), 'Human escalation visible');
  record('chat-does-not-cover-primary-cta', await page.evaluate(() => { const cta = [...document.querySelectorAll('a')].find((el) => /Start Investor Intake/i.test(el.textContent || '')); const chat = document.querySelector('#investor-chat,.landing-chat-shell,[class*="landing-chat"]'); if (!cta || !chat) return true; const a = cta.getBoundingClientRect(), b = chat.getBoundingClientRect(); return a.bottom <= b.top || a.top >= b.bottom || a.right <= b.left || a.left >= b.right; }), 'Chat and primary CTA do not overlap');
}

async function capture(page) {
  const inputs = await page.locator('input[required], textarea[required]').count();
  record('required-fields-exist', inputs > 0, `required controls=${inputs}`);
  record('forms-have-submit', await page.locator('button[type="submit"],input[type="submit"]').count() > 0, 'Submit control exists', 'P0');
  record('email-input-semantics', await page.locator('input[type="email"]').count() > 0, 'Email uses type=email');
  record('phone-autocomplete', await page.locator('input[type="tel"]').count() > 0, 'Phone uses type=tel');
}

async function apk(page) {
  const apk = page.locator('a[href$=".apk"]').first();
  const href = await apk.getAttribute('href');
  record('apk-link-present', Boolean(href), href || 'missing', 'P0');
  if (href) {
    const response = await http(href, { method: 'HEAD' });
    record('apk-download-http-200', response.status === 200, `HTTP ${response.status}`, 'P0');
    record('apk-content-type', /android|octet-stream/i.test(response.headers.get('content-type') || ''), response.headers.get('content-type') || 'missing', 'P0');
  }
  record('no-stale-apk-copy', !/v1\.10\.(13|14)\.apk/i.test(await page.content()), 'Known stale APK versions absent');
}

async function deploy(page) {
  const apex = await http('/?ivx_qa_query=preserve');
  record('apex-query-preserved', apex.url.includes('ivx_qa_query=preserve'), apex.url);
  const www = await fetch('https://www.ivxholding.com/?ivx_qa_query=preserve', { redirect: 'follow', signal: AbortSignal.timeout(20_000) });
  record('www-redirects-to-apex', new URL(www.url).hostname === 'ivxholding.com', www.url, 'P0');
  record('www-query-preserved', www.url.includes('ivx_qa_query=preserve'), www.url);
  record('html-cache-policy', /no-cache|no-store|max-age=0/i.test(apex.headers.get('cache-control') || ''), apex.headers.get('cache-control') || 'missing');
}

async function adversarial(page) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  record('reload-survives', await page.locator('h1').count() === 1, 'Landing survives reload', 'P0');
  const links = await page.locator('a[href]').evaluateAll((els) => els.map((el) => el.getAttribute('href')));
  record('no-javascript-links', !links.some((href) => /^javascript:/i.test(href || '')), 'No javascript: links', 'P0');
  record('no-empty-public-anchors', !links.some((href) => href === ''), 'No empty href values');
  record('no-runtime-page-errors', consoleErrors.length === 0, consoleErrors.join(' | '), 'P0');
}

const groups = [funnel, advertising, seo, performance, accessibility, security, legal, content, deals, chat, capture, apk, deploy, adversarial];
const groupIndex = Math.min(groups.length - 1, Math.floor((agentNumber - 1) / 8));

try {
  browser = await chromium.launch({ headless: true });
  const widths = [320, 360, 375, 390, 414, 768, 1024, 1280];
  const width = widths[(agentNumber - 1) % widths.length];
  const page = await browser.newPage({ viewport: { width, height: width < 600 ? 844 : 900 }, deviceScaleFactor: 1 });
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', (error) => consoleErrors.push(error.message));
  page.on('requestfailed', (request) => failedRequests.push({
    method: request.method(),
    url: request.url(),
    resourceType: request.resourceType(),
    error: request.failure()?.errorText || '',
  }));
  await common(page);
  await groups[groupIndex](page);
  // Background API feeds are independently verified by the prepare gate and
  // feature assertions. Browser teardown routinely aborts media/fetch requests;
  // only failed assets required to render the document are a global P0 here.
  const criticalFailures = failedRequests.filter((item) =>
    ['document', 'script', 'stylesheet', 'font', 'image'].includes(item.resourceType)
      && item.error !== 'net::ERR_ABORTED');
  record(
    'no-critical-request-failures',
    criticalFailures.length === 0,
    criticalFailures.slice(0, 20).map((item) => `${item.method} ${item.url} ${item.error}`).join(' | '),
    'P0',
  );
  await page.close();
} catch (error) {
  record('runner-completed', false, error instanceof Error ? error.stack || error.message : String(error), 'P0');
} finally {
  await browser?.close().catch(() => {});
}

const failures = evidence.filter((item) => !item.passed);
const result = {
  certificate: 'IVX Landing live E2E per-agent evidence',
  agentNumber,
  agentId,
  group: groups[groupIndex].name,
  viewport: [320, 360, 375, 390, 414, 768, 1024, 1280][(agentNumber - 1) % 8],
  sourceSha,
  baseUrl,
  startedAt,
  completedAt: new Date().toISOString(),
  passed: failures.length === 0,
  checks: evidence.length,
  failures: failures.length,
  p0Failures: failures.filter((item) => item.severity === 'P0').length,
  evidence,
};
result.sha256 = createHash('sha256').update(JSON.stringify(result)).digest('hex');
await mkdir('evidence/landing-live-e2e', { recursive: true });
const output = `evidence/landing-live-e2e/agent-${String(agentNumber).padStart(3, '0')}.json`;
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result, null, 2));
if (!result.passed) process.exitCode = 1;
