import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoAttachments } from './ivx-media-understanding';

describe('extractVideoAttachments', () => {
  test('should resolve proper video URLs from input', () => {
    const input = {
      videoUrl: 'http://example.com/video.mp4',
      videoName: 'Sample Video',
      videoMime: 'video/mp4',
    };

    const result = extractVideoAttachments(input);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].url, 'http://example.com/video.mp4');
    assert.strictEqual(result[0].name, 'Sample Video');
    assert.strictEqual(result[0].mimeType, 'video/mp4');
  });
});
