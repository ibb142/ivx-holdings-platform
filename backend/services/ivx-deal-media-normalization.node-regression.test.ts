import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicLandingDeals } from '../api/ivx-public-features';

const mockDeals = [
  { id: 'deal-01', title: 'Deal 1', videos: ['video1.mp4'] },
  { id: 'deal-02', title: 'Deal 2' },
];

describe('normalizePublicLandingDeals', () => {
  test('should ensure video URLs have MIME type video/mp4', () => {
    const result = normalizePublicLandingDeals(mockDeals);
    assert.deepEqual(result[0].videos, [{ url: 'video1.mp4', mime: 'video/mp4' }]);
    assert.deepEqual(result[1].videos, []);
  });
});
