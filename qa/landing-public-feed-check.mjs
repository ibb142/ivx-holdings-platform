import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';

export async function checkPublicFeed(fetchImpl = fetch) {
  const checks = [];
  for (const [endpoint, collection] of [['/api/reels?limit=2', 'videos'], ['/api/ivx/video-platform/home-feed?limit=4', 'blocks']]) {
    const response = await fetchImpl('https://api.ivxholding.com' + endpoint, { signal: AbortSignal.timeout(12_000) });
    assert.equal(response.status, 200, `${endpoint}: HTTP ${response.status}`);
    assert.match(response.headers.get('content-type') || '', /application\/json/i, `${endpoint}: JSON required`);
    assert.equal(response.headers.get('x-ivx-qa-fixture'), null, 'Synthetic responses cannot certify the public feed');
    assert.notEqual(response.headers.get('x-ivx-data-state'), 'unavailable', `${endpoint}: unavailable`);
    const body = await response.json();
    assert.ok(!body.qa_fixture && body.data_available !== false && body.degraded !== true
      && !body.error && body.code !== 'PUBLIC_DATA_UNAVAILABLE', `${endpoint}: public data unavailable`);
    assert.ok(Array.isArray(body[collection]) && body[collection].length > 0, `${endpoint}: empty ${collection}`);
    checks.push({ endpoint, count: body[collection].length });
  }
  return { scope: 'live-public-feed', checks };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await checkPublicFeed())); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
