import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { forwardLandingPreviewRoute, installLandingPreviewRoutes } from './landing-preview-route.mjs';

async function server(handler) {
  const instance = createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  return { url: new URL(`http://127.0.0.1:${instance.address().port}`),
    close: () => new Promise(resolve => { instance.close(resolve); instance.closeAllConnections(); }) };
}
const launch = () => chromium.launch(process.env.LANDING_QA_BROWSER_CHANNEL
  ? { channel: process.env.LANDING_QA_BROWSER_CHANNEL } : {});

test('an aborted media route cannot be continued again after its delayed preview lookup', async () => {
  let release, announce, activeRoute, runtimeRequests = 0;
  const lookupStarted = new Promise(resolve => { announce = resolve; });
  const lookupReleased = new Promise(resolve => { release = resolve; });
  const preview = await server(async (_req, res) => { announce(); await lookupReleased; res.writeHead(404).end(); });
  const runtime = await server((_req, res) => { runtimeRequests++; res.end('runtime media'); });
  const browser = await launch();
  const failures = [];
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route(runtime.url.origin + '/**', async route => {
      activeRoute = route;
      try { await forwardLandingPreviewRoute(context, preview.url, route); }
      catch (error) { failures.push(error.message); }
    });
    const aborted = page.waitForEvent('requestfailed');
    await page.evaluate(url => { void fetch(url).catch(() => {}); }, runtime.url.origin + '/video.mp4');
    await lookupStarted;
    // The route reaches its terminal state while the asynchronous lookup is
    // outstanding, matching the already-handled state reported by browser CI.
    await activeRoute.abort('aborted');
    assert.equal((await aborted).failure().errorText, 'net::ERR_ABORTED');
    release();
    await context.unrouteAll({ behavior: 'wait' });
    assert.deepEqual(failures, []);
    assert.equal(runtimeRequests, 0, 'A cancelled read must not escape to the origin');
    await context.close();
  } finally { release(); await browser.close(); await preview.close(); await runtime.close(); }
});

test('static preview responses and runtime HTTP failures retain their actual contents and status', async () => {
  const preview = await server((req, res) => {
    if (req.url === '/asset.js') res.writeHead(200, { 'content-type': 'text/javascript' }).end('reviewed source');
    else res.writeHead(404).end();
  });
  const runtime = await server((_req, res) => res.writeHead(503, { 'access-control-allow-origin': '*' }).end('runtime unavailable'));
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await context.route(runtime.url.origin + '/**', route => forwardLandingPreviewRoute(context, preview.url, route));
    const page = await context.newPage();
    const source = await page.goto(runtime.url.origin + '/asset.js');
    assert.equal(source.status(), 200); assert.equal(await source.text(), 'reviewed source');
    const failure = await page.evaluate(async url => {
      const response = await fetch(url); return { status: response.status, body: await response.text() };
    }, runtime.url.origin + '/api/reels');
    assert.deepEqual(failure, { status: 503, body: 'runtime unavailable' });
    await context.unrouteAll({ behavior: 'wait' }); await context.close();
  } finally { await browser.close(); await preview.close(); await runtime.close(); }
});

test('live routing errors and write attempts remain failures', async () => {
  const active = new Error('Route is already handled!');
  const request = { method: () => 'GET', url: () => 'https://fixture.invalid/video.mp4', failure: () => null };
  const context = { request: { fetch: async () => ({ status: () => 404, dispose: async () => {} }) } };
  const route = { request: () => request, continue: async () => { throw active; } };
  await assert.rejects(forwardLandingPreviewRoute(context, new URL('http://127.0.0.1:4175'), route), error => error === active);
  request.failure = () => ({ errorText: 'net::ERR_ABORTED' });
  const unexpected = new Error('Unrelated routing failure');
  route.continue = async () => { throw unexpected; };
  await assert.rejects(forwardLandingPreviewRoute(context, new URL('http://127.0.0.1:4175'), route), error => error === unexpected);
  request.method = () => 'POST';
  await assert.rejects(forwardLandingPreviewRoute(context, new URL('http://127.0.0.1:4175'), route), /cannot perform public writes/);
});

test('preview routing sends only existing static files to the preview server', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'ivx-preview-routing-'));
  await mkdir(path.join(root, 'assets'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>reviewed page</title>');
  await writeFile(path.join(root, 'assets', 'app.js'), 'reviewed script');
  const previewReads = [], runtimeReads = [];
  const preview = await server((req, res) => {
    previewReads.push(req.url);
    if (req.url === '/') res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>reviewed page</title>');
    else if (req.url.startsWith('/assets/app.js')) res.end('reviewed script');
    else res.writeHead(404).end();
  });
  const runtime = await server((req, res) => {
    runtimeReads.push(req.url);
    res.writeHead(req.url.startsWith('/api/') ? 503 : 404).end('real origin response');
  });
  const browser = await launch();
  try {
    const context = await browser.newContext();
    await installLandingPreviewRoutes(context, runtime.url.origin, preview.url, root);
    const page = await context.newPage();
    assert.equal((await page.goto(runtime.url.origin)).status(), 200);
    const results = await page.evaluate(async () => {
      const result = [];
      for (const url of ['/assets/app.js?v=reviewed', '/api/reels?type=reel', '/videos/missing.mp4', '/missing.js']) {
        const response = await fetch(url);
        result.push({ status: response.status, body: await response.text() });
      }
      return result;
    });
    assert.deepEqual(results, [
      { status: 200, body: 'reviewed script' },
      { status: 503, body: 'real origin response' },
      { status: 404, body: 'real origin response' },
      { status: 404, body: 'real origin response' },
    ]);
    assert.deepEqual(previewReads, ['/', '/assets/app.js?v=reviewed'], 'Dynamic and missing assets must not wait for a local preview lookup');
    assert.ok(runtimeReads.includes('/api/reels?type=reel'));
    assert.ok(runtimeReads.includes('/videos/missing.mp4'));
    await context.unrouteAll({ behavior: 'wait' }); await context.close();

    const registered = [];
    await installLandingPreviewRoutes({ route: async (match, handler) => registered.push({ match, handler }) },
      runtime.url.origin, preview.url, root);
    const guard = registered.find(route => route.match === runtime.url.origin + '/**');
    assert.ok(guard, 'Preview must retain its public-write guard');
    await assert.rejects(guard.handler({ request: () => ({ method: () => 'POST' }),
      fallback: async () => assert.fail('A public write must not reach the origin') }), /cannot perform public writes/);
  } finally { await browser.close(); await preview.close(); await runtime.close(); await rm(root, { recursive: true, force: true }); }
});
