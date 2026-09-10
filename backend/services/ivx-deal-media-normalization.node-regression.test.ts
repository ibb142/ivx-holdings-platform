import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicLandingDeals } from '../api/ivx-public-features';

const mockDeals = [
  { id: 'deal-01', title: 'Deal 1', videos: ['video1.mp4'] },
  { id: 'deal-02', title: 'Deal 2', videos: ['video2.mp4'] },
];

describe('Video MIME Normalization', () => {
  test('should return videos with MIME type video/*', () => {
    const result = normalizePublicLandingDeals(mockDeals);
    assert.equal(result[0].videos[0].mime, 'video/*');
    assert.equal(result[1].videos[0].mime, 'video/*');
  });
});
