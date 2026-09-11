import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicLandingDeals } from '../api/ivx-public-features';

const mockDeals = [
  { id: 'deal-01', title: 'Deal 1', videos: ['https://example.com/video1.mp4'] },
  { id: 'deal-02', title: 'Deal 2', videos: ['https://example.com/video2.mp4'] },
];

describe('normalizePublicLandingDeals', () => {
  test('should set correct MIME type for video files', () => {
    const result = normalizePublicLandingDeals(mockDeals);
    assert.deepEqual(result[0].videos, [{ url: 'https://example.com/video1.mp4', mimeType: 'video/mp4' }]);
    assert.deepEqual(result[1].videos, [{ url: 'https://example.com/video2.mp4', mimeType: 'video/mp4' }]);
  });
});
