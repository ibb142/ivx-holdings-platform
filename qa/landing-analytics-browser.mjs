import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the shipped analytics lifecycle with an isolated public-key setup.
// The fake Supabase origin is intercepted in full; no analytics reach a database.
export async function verifyAnalyticsReload(page, base) {
  const source = await readFile('expo/ivxholding-landing/ivx-app.js', 'utf8');
  const begin = source.indexOf('  var _analyticsQueue = [];');
  const end = source.indexOf('  var _funnelOrigOpen = window.openFunnel;', begin);
  assert.ok(begin >= 0 && end > begin);
  const origin = 'https://ivx-qa-fixture.supabase.co';
  const fixturePath = '/qa-analytics-lifecycle';
  const fixtureUrl = new URL(fixturePath, base).href;
  const requests = [];
  await page.route(origin + '/**', async route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ path: url.pathname, search: url.search, method: request.method(), headers: request.headers(), body: request.postData() });
    await route.fulfill({
      status: request.method() === 'OPTIONS' ? 204 : 201,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'apikey, content-type, prefer, authorization',
        'content-type': 'application/json'
      },
      body: ''
    });
  });
  await page.route(fixtureUrl, route => route.fulfill({
    status: 200, contentType: 'text/html',
    body: '<!doctype html><title>Isolated analytics reload QA</title><h1>Analytics fixture</h1>'
  }));
  const globals = `
    var SUPABASE_URL = ${JSON.stringify(origin)};
    var SUPABASE_ANON_KEY = 'sb_publishable_isolated_analytics_fixture';
    var SESSION_ID = 'qa-isolated', VISIT_COUNT = 1, FUNNEL_STEP = 0, ENGAGEMENT_SCORE = 0;
    var UTM_DATA = {}, GEO_DATA = null, PAGE_START = Date.now();
    function isPlaceholder(value) { return !value || value.indexOf('__IVX_') === 0; }
  `;
  await page.addInitScript({ content: `if (location.pathname === ${JSON.stringify(fixturePath)}) { (function() { ${globals}\n${source.slice(begin, end)}\n})(); }` });
  await page.goto(fixtureUrl, { waitUntil: 'domcontentloaded' });
  const delivered = page.waitForResponse(response => {
    const request = response.request();
    return request.url().startsWith(origin) && request.method() === 'POST' &&
      (request.postData() || '').includes('"session_end"');
  }, { timeout: 10_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal((await delivered).status(), 201, 'Exit analytics must survive a real reload with wildcard CORS');
  const posted = requests.filter(request => request.method === 'POST');
  assert.ok(posted.length > 0);
  for (const request of posted) {
    assert.equal(request.path, '/rest/v1/landing_analytics');
    assert.equal(request.search, '');
    assert.equal(request.headers.apikey, 'sb_publishable_isolated_analytics_fixture');
    assert.equal(request.headers.authorization, undefined);
    assert.ok(Array.isArray(JSON.parse(request.body)));
  }
}
