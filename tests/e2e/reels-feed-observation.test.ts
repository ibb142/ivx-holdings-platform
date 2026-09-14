import test from 'node:test';
import assert from 'node:assert/strict';
import { canDeferReelsPlayback, observeReelsFeed } from './reels-feed-observation.ts';

const videos = [{ id: 'synthetic-reel', video_url: 'https://media.test/fixture.mp4' }];

test('an available cached feed remains visibly degraded in playback metadata', () => {
  for (const flags of [{ degraded: true }, { status: 'DEGRADED' }]) {
    const observation = observeReelsFeed(200, { ok: true, data_available: true, videos, ...flags });
    assert.equal(observation.playbackCandidate, true);
    assert.equal(observation.degraded, true, 'Preserve the degraded observation in the report');
    assert.equal(observation.dataAvailable, true);
    assert.equal(observation.unavailable, false);
  }
});

test('HTTP 200 and a video list cannot override an unavailable dependency', () => {
  for (const flags of [
    { degraded: true }, { status: 'DEGRADED' }, { data_available: false },
    { degraded: true, data_available: false },
    { ok: false, data_available: true },
    { code: 'PUBLIC_DATA_UNAVAILABLE', data_available: true },
    { degraded: true, data_available: 'true' },
  ]) {
    const observation = observeReelsFeed(200, { videos, ...flags });
    assert.equal(observation.playbackCandidate, false, JSON.stringify(flags));
    assert.equal(observation.unavailable, true);
  }
  assert.equal(observeReelsFeed(200, { videos, data_available: true }, 'unavailable').playbackCandidate, false);
});

test('empty, malformed and non-success responses never qualify for playback', () => {
  for (const body of [null, undefined, '<html>upstream error</html>', [], {}, { videos: {} },
    { videos: [], data_available: true, degraded: true }]) {
    assert.equal(observeReelsFeed(200, body).playbackCandidate, false);
  }
  for (const status of [401, 403, 429, 503]) {
    assert.equal(observeReelsFeed(status, { ok: true, videos, data_available: true }).playbackCandidate, false);
  }
});

test('the canonical legacy response remains a candidate without invented availability flags', () => {
  const observation = observeReelsFeed(200, { ok: true, videos });
  assert.equal(observation.playbackCandidate, true);
  assert.equal(observation.degraded, false);
  assert.equal(observation.dataAvailable, null);
  assert.equal(observation.videoCount, 1);
});

test('smoke playback can be deferred only when every retry explicitly reports unavailable HTTP 200 data', () => {
  const unavailable = observeReelsFeed(200, { data_available: false, videos: [] });
  for (const body of [{ degraded: true }, { status: 'DEGRADED' },
    { ok: false, code: 'PUBLIC_DATA_UNAVAILABLE', data_available: false }]) {
    assert.equal(canDeferReelsPlayback([unavailable, observeReelsFeed(200, body)]), true);
  }
  assert.equal(canDeferReelsPlayback([observeReelsFeed(200, { videos: [] }, 'unavailable')]), true);
  assert.equal(canDeferReelsPlayback([]), false, 'No response is a routing or network failure');
  for (const observation of [
    observeReelsFeed(503, { data_available: false }),
    observeReelsFeed(401, { degraded: true }),
    observeReelsFeed(200, { code: 'AUTH_GATEWAY_DENIED', degraded: true }),
    observeReelsFeed(200, { videos: [] }),
    observeReelsFeed(200, null),
    observeReelsFeed(200, { degraded: true, data_available: 'false' }),
    observeReelsFeed(200, { degraded: 'true', data_available: false }),
    observeReelsFeed(200, { degraded: true, data_available: true, videos }),
    observeReelsFeed(200, { degraded: true, data_available: true, videos: [] }),
  ]) {
    assert.equal(canDeferReelsPlayback([unavailable, observation]), false, JSON.stringify(observation));
  }
});
