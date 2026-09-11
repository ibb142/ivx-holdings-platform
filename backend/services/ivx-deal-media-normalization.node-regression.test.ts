import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePublicLandingDeals } from '../api/ivx-public-features';

describe('normalizePublicLandingDeals', () => {
  test('should normalize video MIME types', () => {
    const mockDeals = [
      { id: 'deal-01', title: 'Deal 1', videos: ['https://ivxholding.com/videos/original/video1.mp4'] },
      { id: 'deal-02', title: 'Deal 2', videos: ['https://ivxholding.com/videos/original/video2.mov'] },
    ];
    const expected = [
      {
        id: 'deal-01',
        title: 'Deal 1',
        videos: [
          { url: 'https://ivxholding.com/videos/original/video1.mp4', mimeType: 'video/mp4' }
        ]
      },
      {
        id: 'deal-02',
        title: 'Deal 2',
        videos: [
          { url: 'https://ivxholding.com/videos/original/video2.mov', mimeType: 'unknown' }
        ]
      }
    ];
    const result = normalizePublicLandingDeals(mockDeals);
    assert.deepEqual(result, expected);
  });
});
