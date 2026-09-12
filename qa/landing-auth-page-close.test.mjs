import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { closeForwardedAuthPage } from './landing-auth-page-close.mjs';

test('page closure waits for an in-flight forwarded response and keeps context isolation installed', async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext();
    let guarded = 0;
    await context.route('**/*', async route => { guarded++; await route.abort(); });
    const page = await context.newPage();
    await page.setContent('<title>Isolated route lifecycle</title>');
    let started, release, fulfilled = false;
    const startedRequest = new Promise(resolve => { started = resolve; });
    const responseReady = new Promise(resolve => { release = resolve; });
    await page.route('https://qa.supabase.co/**', async route => {
      started(); await responseReady;
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"local":true}', headers: { 'access-control-allow-origin': '*' } });
      fulfilled = true;
    });
    await page.evaluate(() => { void fetch('https://qa.supabase.co/auth/v1/user').catch(() => {}); });
    await startedRequest;
    const closing = closeForwardedAuthPage(page);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(page.isClosed(), false, 'Closing a page before fulfillment recreates the CI race');
    release(); await closing;
    assert.equal(fulfilled, true);
    assert.equal(page.isClosed(), true);
    // The context guard remains for later pages; no hosted request can escape
    // while the page-scoped forwarding handler has been removed.
    const next = await context.newPage();
    await next.setContent('<title>Guard retained</title>');
    await next.evaluate(() => fetch('https://qa.supabase.co/auth/v1/user').catch(() => null));
    assert.equal(guarded, 1);
    await closeForwardedAuthPage(next);
    await context.close();
  } finally { await browser.close(); }
});

test('a route-drain failure remains a rejection and the page is still closed', async () => {
  let closed = false;
  await assert.rejects(closeForwardedAuthPage({
    unrouteAll: async options => { assert.equal(options.behavior, 'wait'); throw new Error('forwarding failed'); },
    close: async () => { closed = true; },
  }), /forwarding failed/);
  assert.equal(closed, true);
});
