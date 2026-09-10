import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const sha = process.env.GITHUB_SHA;
assert.match(sha || '', /^[a-f0-9]{40}$/);
const assets = ['ivx-invest.js', 'ivx-home-feed.js', 'ivx-reels.js', 'ivx-styles.css'];
const hash = (body) => createHash('sha256').update(body).digest('hex');
const expected = new Map(await Promise.all(assets.map(async (file) => [file, hash(await readFile(`expo/ivxholding-landing/${file}`))])));
let stable = 0;
for (let attempt = 0; attempt < 120; attempt++) {
  try {
    const response = await fetch('https://api.ivxholding.com/health', { signal: AbortSignal.timeout(10_000) });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.commit, sha);
    for (const file of assets) {
      const response = await fetch(`https://ivxholding.com/${file}?qa=${sha}`, { signal: AbortSignal.timeout(10_000) });
      assert.equal(response.status, 200);
      assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected.get(file), `Static asset ${file} is not this commit`);
    }
    if (++stable === 6) { console.log(`Backend and frontend verified at ${sha}`); process.exit(0); }
  } catch { stable = 0; }
  await new Promise((resolve) => setTimeout(resolve, 5000));
}
throw new Error('Production backend/frontend did not stabilize on this exact commit');
