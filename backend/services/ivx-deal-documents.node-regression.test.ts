import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractDealDocuments } from './ivx-deal-documents';

test('extractDealDocuments correctly identifies image MIME types', () => {
  const input = {
    documents: [
      { url: 'https://example.com/image.jpg', mimeType: 'image/jpeg' },
      { url: 'https://example.com/other.pdf', mimeType: 'application/pdf' }
    ]
  };
  const result = extractDealDocuments(input);
  assert.strictEqual(result.length, 2);
  assert.strictEqual(result[0].mimeType, 'image/jpeg');
  assert.strictEqual(result[1].mimeType, 'application/pdf');
});