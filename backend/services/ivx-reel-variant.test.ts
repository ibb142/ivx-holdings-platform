import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { reelVariantFileName } from './ivx-reel-variant';
test('advertised compatibility URL maps to the existing WebM file', () => {
  assert.equal(reelVariantFileName('c0725a70.webm'), 'c0725a70.webm');
  assert.equal(reelVariantFileName('c0725a70'), 'c0725a70.webm');
  for (const bad of ['../c0725a70', 'c0725a70.mp4', 'c0725a70.webm.webm', '']) assert.equal(reelVariantFileName(bad), null);
});
