import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicLandingDeals } from './ivx-public-features';

const mockDeals = [
  { id: 'deal-01', title: 'Deal 1', videos: ['video1.mp4', 'video2.webm'] },
  { id: 'deal-02', title: 'Deal 2', photos: ['image1.jpg', 'image2.png'] },
];

describe('normalizePublicLandingDeals', () => {
  test('should include videos property', () => {
    const result = normalizePublicLandingDeals(mockDeals);
    assert.deepEqual(result[0].videos, [{ mime_type: 'video/mp4', video: 'video1.mp4' }, { mime_type: 'video/unknown', video: 'video2.webm' }]);
    assert.deepEqual(result[1].videos, []);
    assert.deepEqual(result[1].images, [{ mime_type: 'image/jpg', image: 'image1.jpg' }, { mime_type: 'image/png', image: 'image2.png' }]);
  });
});
