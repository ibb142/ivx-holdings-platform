import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractVideoAttachments } from './ivx-media-understanding';

describe('extractVideoAttachments', () => {
  it('should convert http URLs to https', () => {
    const input = { videos: [{ url: 'http://example.com/video.mp4', mimeType: 'video/mp4' }] };
    const result = extractVideoAttachments(input);
    assert.strictEqual(result[0].url, 'https://example.com/video.mp4');
  });
});
