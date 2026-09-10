import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertRepairPatchQuality } from './ivx-repair-patch-quality';

const sha = 'a'.repeat(40);
const unrelatedRepair = [
  { path: 'backend/services/ivx-deal-matching-engine.ts', oldText: 'const weightSum = dims.reduce(sum, 0);', newText: 'if (deal.mediaCount > 0) dims.push({ score: 100, weight: 0.1 });\nconst weightSum = dims.reduce(sum, 0);' },
  { path: 'backend/services/ivx-deal-matching-engine.node-regression.test.ts', oldText: '', newText: 'import { test } from "node:test"; import assert from "node:assert/strict"; test("video fit", () => assert(scoreWithVideo > scoreWithoutVideo));' },
];

test('rejects the observed matching-score patch for each deal-video defect before file writes', () => {
  for (const unit of ['deals.videos-present', 'media.deal-videos-resolvable', 'media.deal-videos-mime']) {
    assert.throws(() => assertRepairPatchQuality(`landing-remediation:${sha}:${unit}`, unrelatedRepair), /REPAIR_DEFECT_SCOPE_VIOLATION/);
  }
});

test('preserves a repair of the actual public media response and its Node regression', () => {
  assert.doesNotThrow(() => assertRepairPatchQuality(`landing-remediation:${sha}:deals.videos-present`, [
    { path: 'backend/api/ivx-public-features.ts', oldText: 'return row;', newText: 'return normalizeDealMedia(row);' },
    { path: 'backend/api/ivx-public-features.node-regression.test.ts', oldText: '', newText: 'import { test } from "node:test"; test("existing video reference is exposed", verifyPublicResponse);' },
  ]));
});

test('does not let a video repair change its acceptance probe, CI or an unrelated test', () => {
  for (const path of ['backend/services/ivx-landing-p0-executor.ts', '.github/workflows/ivx-qa.yml', 'backend/services/ivx-deal-matching-engine.node-regression.test.ts', 'backend/api/../services/ivx-deal-matching-engine.ts']) {
    assert.throws(() => assertRepairPatchQuality(`landing-remediation:${sha}:deals.videos-present`, [
      { path: 'backend/api/ivx-public-features.ts', oldText: 'return row;', newText: 'return normalizeDealMedia(row);' },
      { path, oldText: '', newText: 'export const changed = true;' },
      { path: 'backend/api/ivx-public-features.node-regression.test.ts', oldText: '', newText: 'test("regression", verify);' },
    ]), /REPAIR_DEFECT_SCOPE_VIOLATION/);
  }
});
