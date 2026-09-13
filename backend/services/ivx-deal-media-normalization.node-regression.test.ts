import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicLandingDeals } from '../api/ivx-public-features';

const mockDeals = [
  { id: 'deal-01', title: 'Deal 1', videos: ['video1.mp4'], reels: ['reel1.mp4'] },
  { id: 'deal-02', title: 'Deal 2', reels: ['reel2.mp4'] },
];

describe('normalizePublicLandingDeals with reels', () => {
  test('should include videos and reels property', () => {
    const result = normalizePublicLandingDeals(mockDeals);
    assert.deepEqual(result[0].videos, [{ mime_type: 'video/mp4', video: 'video1.mp4' }, { mime_type: 'video/mp4', video: 'reel1.mp4' }]);
    assert.deepEqual(result[1].videos, [{ mime_type: 'video/mp4', video: 'reel2.mp4' }]);
  });
});
