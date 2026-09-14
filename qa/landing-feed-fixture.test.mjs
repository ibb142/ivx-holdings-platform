import test from 'node:test';
import assert from 'node:assert/strict';
import { installLandingFeedFixture, fixtureCatalog, FIXTURE_SCOPE } from './landing-feed-fixture.mjs';
import { checkPublicFeed } from './landing-public-feed-check.mjs';

test('synthetic feed cannot be installed without the exact local preview', async () => {
  for (const source of [undefined, 'https://ivxholding.com', 'http://localhost:4175', 'http://127.0.0.1:8080']) {
    await assert.rejects(installLandingFeedFixture({ route: () => assert.fail('route registered') }, source, Buffer.from('media')));
  }
});

test('fixture serves only scoped reads and keeps synthetic telemetry off production', async () => {
  const routes = [];
  await installLandingFeedFixture({ route: async (match, handler) => routes.push({ match, handler }) },
    'http://127.0.0.1:4175', Buffer.from('media'));
  const api = routes.find(r => r.match(new URL('https://api.ivxholding.com/api/reels')));
  async function request(path, method = 'GET') {
    let result;
    await api.handler({ request: () => ({ url: () => 'https://api.ivxholding.com' + path, method: () => method }),
      fulfill: async value => { result = value; }, fallback: async () => { result = 'network'; },
      abort: async () => { result = 'blocked'; } });
    return result;
  }
  const feed = JSON.parse((await request('/api/reels')).body);
  assert.equal(feed.qa_fixture, FIXTURE_SCOPE);
  assert.equal(feed.videos.length, 2);
  assert.deepEqual(JSON.parse((await request('/api/ivx/video-platform/home-feed')).body).blocks, fixtureCatalog().blocks);
  assert.equal(await request('/health'), 'network');
  assert.equal(await request('/api/owner/control', 'POST'), 'blocked');
  assert.equal((await request('/api/ivx/video-platform/events', 'POST')).status, 204);
  assert.equal(routes.some(r => r.match(new URL('https://unrelated.example/api/reels'))), false);
});

test('live gate rejects HTTP-200 outage payloads, empty data and synthetic evidence', async () => {
  for (const body of [{ data_available: false }, { degraded: true }, { error: 'unavailable' },
    { qa_fixture: FIXTURE_SCOPE }, { videos: [], blocks: [] }]) {
    await assert.rejects(checkPublicFeed(async () => Response.json({ videos: [{ id: '1' }], blocks: [{ type: 'deal' }], ...body })));
  }
  await assert.rejects(checkPublicFeed(async () => Response.json({ videos: [{ id: '1' }], blocks: [{}] },
    { headers: { 'x-ivx-qa-fixture': FIXTURE_SCOPE } })));
  const result = await checkPublicFeed(async () => Response.json({ videos: [{ id: '1' }], blocks: [{ type: 'deal' }] }));
  assert.equal(result.scope, 'live-public-feed');
  assert.equal(result.checks.length, 2);
});
