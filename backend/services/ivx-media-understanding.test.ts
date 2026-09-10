import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoAttachments } from './ivx-media-understanding';

describe('extractVideoAttachments', () => {
  it('should detect video URLs', () => {
    const input = {
      videos: [{ url: 'https://example.com/video.mp4', name: 'Sample Video', mimeType: 'video/mp4' }]
    };
    const result = extractVideoAttachments(input);
    assert.equal(result.length, 1);
    assert.equal(result[0].url, 'https://example.com/video.mp4');
  });

  it('should return empty for non-video input', () => {
    const input = { files: [{ url: 'https://example.com/image.jpg', mimeType: 'image/jpeg' }] };
    const result = extractVideoAttachments(input);
    assert.equal(result.length, 0);
  });

  it('should handle empty input gracefully', () => {
    const result = extractVideoAttachments({});
    assert.equal(result.length, 0);
  });
});