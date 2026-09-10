import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicLandingDeals } from './ivx-public-features';

const mockDeals = [
  { id: 'deal-01', title: 'Deal 1', videos: ['video1.mp4'] },
  { id: 'deal-02', title: 'Deal 2' },
];

describe('normalizePublicLandingDeals', () => {
  test('should fallback to media videos if videos array is empty', () => {
    const dealsWithMedia = [
      { id: 'deal-03', title: 'Deal 3', media: { videos: ['video2.mp4'] } },
      { id: 'deal-04', title: 'Deal 4', media: {} },
    ];
    const result = normalizePublicLandingDeals(dealsWithMedia);
    assert.deepEqual(result[0].videos, ['video2.mp4']);
    assert.deepEqual(result[1].videos, []);
  });

  test('should include videos property', () => {
    const result = normalizePublicLandingDeals(mockDeals);
    assert.deepEqual(result[0].videos, ['video1.mp4']);
    assert.deepEqual(result[1].videos, []);
  });
});
