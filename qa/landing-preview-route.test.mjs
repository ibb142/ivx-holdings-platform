import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from 'playwright';
import { installLandingPreviewRoute } from './landing-preview-route.mjs';

test('public API and media retain their real responses without a static-preview lookup', async () => {
  const previewPaths = [], edgePaths = [];
  const preview = createServer((req, res) => {
    previewPaths.push(req.url);
    if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<title>Branch preview</title>'); }
    else { res.statusCode = 404; res.end(); }
  });
  const edge = createServer((req, res) => {
    edgePaths.push(req.url);
    // These bytes test HTTP routing only; they are not playable-media evidence.
    if (req.url.startsWith('/api/')) { res.statusCode = 503; res.setHeader('Retry-After', '3'); }
    else if (req.headers.range) { res.statusCode = 206; res.setHeader('Content-Range', 'bytes 0-3/4'); }
    res.end('edge');
  });
  preview.listen(0, '127.0.0.1'); edge.listen(0, '127.0.0.1');
  await Promise.all([once(preview, 'listening'), once(edge, 'listening')]);
  let browser;
  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const origin = 'http://127.0.0.1:' + edge.address().port;
    await installLandingPreviewRoute(context, origin, 'http://127.0.0.1:' + preview.address().port);
    const page = await context.newPage();
    await page.goto(origin);
    assert.equal(await page.title(), 'Branch preview');
    const results = await page.evaluate(async () => {
      const paths = ['/api/reels', '/videos/proof.mp4', '/media/reels/proof.mp4', '/unregistered.txt'];
      return Promise.all(paths.map(async path => {
        const r = await fetch(path, { headers: path.endsWith('.mp4') ? { Range: 'bytes=0-3' } : {} });
        return { path, status: r.status, retryAfter: r.headers.get('retry-after'), text: await r.text() };
      }));
    });
    assert.deepEqual(results.map(r => r.status), [503, 206, 206, 200]);
    assert.ok(results.every(r => r.text === 'edge'));
    assert.equal(results[0].retryAfter, '3', 'A real API error must not become a passing fixture');
    assert.deepEqual(edgePaths.sort(), results.map(r => r.path).sort());
    assert.deepEqual(previewPaths.sort(), ['/', '/unregistered.txt'], 'Public reads must not wait for a local static 404');
    await context.unrouteAll({ behavior: 'wait' });
    await context.close();
  } finally {
    await browser?.close();
    preview.closeAllConnections(); edge.closeAllConnections();
    await Promise.all([new Promise(resolve => preview.close(resolve)), new Promise(resolve => edge.close(resolve))]);
  }
});

test('preview routing still rejects public writes before any forwarding', async () => {
  let handler, forwarded = 0;
  await installLandingPreviewRoute({ route: async (_pattern, callback) => { handler = callback; },
    request: { fetch: async () => { forwarded++; } } }, 'https://site.invalid', 'http://127.0.0.1:4175');
  await assert.rejects(handler({ request: () => ({ method: () => 'POST', url: () => 'https://site.invalid/api/write' }) }), /cannot perform public writes/);
  assert.equal(forwarded, 0);
});
