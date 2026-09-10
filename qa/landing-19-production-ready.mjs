import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sha = process.env.GITHUB_SHA;
assert.match(sha || '', /^[a-f0-9]{40}$/);
const assets = ['ivx-invest.js', 'ivx-home-feed.js', 'ivx-reels.js', 'ivx-styles.css', 'ivx-web-vitals.js', 'ivx-app.js'];
const hash = (body) => createHash('sha256').update(body).digest('hex');
const csp = (html) => html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1];
const sourceHtml = await readFile('expo/ivxholding-landing/index.html', 'utf8');
const bootstrap = (html) => [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map((m) => m[1]).find((s) => s.includes("var v = document.getElementById('homeFeedReel')"));
const expectedBootstrap = bootstrap(sourceHtml);
assert.ok(expectedBootstrap, 'Reviewed source must initialize its homepage reel');
const expectedCsp = csp(sourceHtml);
assert.ok(expectedCsp, 'Reviewed source must define its document CSP');
const expected = new Map(await Promise.all(assets.map(async (file) => [file, hash(await readFile(`expo/ivxholding-landing/${file}`))])));
let stable = 0, lastReason = '';
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    const response = await fetch('https://api.ivxholding.com/health', { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.commit, sha);
    const documentResponse = await fetch(`https://ivxholding.com/?qa=${sha}`, { signal: AbortSignal.timeout(10_000) });
    assert.equal(documentResponse.status, 200);
    const publishedHtml = await documentResponse.text();
    assert.equal(csp(publishedHtml), expectedCsp, 'Document CSP is not this commit');
    assert.equal(hash(bootstrap(publishedHtml) || ''), hash(expectedBootstrap), 'Homepage reel initialization is not this commit');
    for (const file of assets) {
      const response = await fetch(`https://ivxholding.com/${file}?qa=${sha}`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected.get(file), `Static asset ${file} is not this commit`);
    }
    if (++stable === 6) { console.log(`Backend and frontend verified at ${sha}`); process.exit(0); }
  } catch (error) {
    stable = 0;
    const reason = error.message || String(error);
    if (reason !== lastReason) { console.log('Waiting for published revision: ' + reason); lastReason = reason; }
  }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
throw new Error('Production backend/frontend did not stabilize on this exact commit');
