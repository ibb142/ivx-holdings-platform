import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { chromium } from 'playwright';

const url = 'https://ivxholding.com/videos/original/b8788d0c-0558-43fb-a3dd-4ccdc6f441c8/casa-rosario.mp4';
const expectedHash = 'a52d9d83ace9c8c2d83ea3e7edda99ad591dd34c025e533093b5e7da88bf2c9c';
const proof = { scope: 'isolated decoding of the authorized temporary QA clip',
  sourceSha: process.env.GITHUB_SHA, temporary: true, originalTourRestored: false,
  phase4Certified: false, startedAt: new Date().toISOString(), results: [] };
let server;
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /^video\/mp4\b/);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256, expectedHash);
  proof.sha256 = sha256;
  server = createServer((req, res) => {
    if (req.url === '/clip.mp4') {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length });
      res.end(bytes);
    } else {
      const source = req.url === '/public' ? url : '/clip.mp4';
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<video muted playsinline preload="auto" src="${source}"></video>`);
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const channel of ['chromium', 'chrome']) {
    let browser;
    try {
      browser = await chromium.launch(channel === 'chrome' ? { channel: 'chrome' } : {});
      for (const source of ['local-exact-bytes', 'public-object']) {
        const result = { channel, browserVersion: browser.version(), source, passed: false };
        const page = await browser.newPage();
        try {
          await page.goto(origin + (source === 'public-object' ? '/public' : '/'), { waitUntil: 'domcontentloaded' });
          result.codecSupport = await page.locator('video').evaluate(v => v.canPlayType('video/mp4; codecs="avc1.42E01E, mp4a.40.2"'));
          await page.waitForFunction(() => { const v = document.querySelector('video'); return v.readyState >= 2 || !!v.error; }, null, { timeout: 15_000 });
          result.media = await page.locator('video').evaluate(v => ({ readyState: v.readyState, width: v.videoWidth,
            height: v.videoHeight, duration: v.duration, errorCode: v.error?.code ?? null, errorMessage: v.error?.message ?? null }));
          assert.equal(result.media.errorCode, null, 'CLIP_DECODE_ERROR');
          assert.equal(result.media.width, 640);
          assert.equal(result.media.height, 360);
          await page.locator('video').evaluate(v => v.play());
          await page.waitForFunction(() => document.querySelector('video').currentTime > 0.25, null, { timeout: 5_000 });
          result.passed = true;
        } catch (error) { result.error = error.message; }
        finally { proof.results.push(result); await page.close(); }
      }
    } catch (error) { proof.results.push({ channel, passed: false, error: error.message }); }
    finally { await browser?.close(); }
  }
  proof.passed = proof.results.length === 4 && proof.results.every(result => result.passed);
} catch (error) { proof.error = error.message; proof.passed = false; }
finally {
  if (server) await new Promise(resolve => server.close(resolve));
  proof.completedAt = new Date().toISOString();
  await mkdir('qa/evidence/casa-temporary-video', { recursive: true });
  await writeFile('qa/evidence/casa-temporary-video/browser-proof.json', JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
  if (!proof.passed) process.exitCode = 1;
}
