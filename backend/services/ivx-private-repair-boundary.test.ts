import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { assertPrivateRepairScope, isApprovedLandingRepairPath, publicRepairGoal } from './ivx-private-repair-boundary';
const privateGoal = '[TEMPLATE_MODE:BUG_FIX] [OWNER_AUDIT:synthetic:row] Private acceptance text';
test('private task metadata is replaced before public PR formatting', () => {
  assert.equal(publicRepairGoal(privateGoal), 'Scoped application repair');
  assert.equal(publicRepairGoal('Public application repair'), 'Public application repair');
});
test('private writes require an explicit file set', () => {
  assert.throws(() => assertPrivateRepairScope(privateGoal, undefined, ['app.ts']), /SCOPE_MISSING/);
  assert.throws(() => assertPrivateRepairScope(privateGoal, [], ['app.ts']), /SCOPE_MISSING/);
});
test('private patches accept only exact authorized paths', () => {
  assert.doesNotThrow(() => assertPrivateRepairScope(privateGoal, ['app.ts','qa/check.ts'], ['qa/check.ts']));
  for (const p of ['other.ts','../app.ts','/app.ts','dir/../app.ts','qa\\check.ts','./app.ts']) {
    assert.throws(() => assertPrivateRepairScope(privateGoal, ['app.ts','qa/check.ts'], [p]), /SCOPE_VIOLATION/);
  }
});
test('an invalid scope fails closed and ordinary tasks keep existing behavior', () => {
  assert.throws(() => assertPrivateRepairScope(privateGoal, ['../app.ts'], ['../app.ts']), /SCOPE_MISSING/);
  assert.doesNotThrow(() => assertPrivateRepairScope('Public task', undefined, ['app.ts']));
});

test('approved landing repairs can edit their exact QA and static source files', () => {
  for (const file of ['qa/landing-live-e2e-agent.mjs', 'expo/ivxholding-landing/index.html', 'expo/ivxholding-landing/ivx-app.js', 'expo/ivxholding-landing/ivx-styles.css']) {
    assert.equal(isApprovedLandingRepairPath(privateGoal, [file], file), true);
  }
});
test('ordinary tasks and missing approvals cannot open additional source formats', () => {
  const file = 'qa/landing-live-e2e-agent.mjs';
  assert.equal(isApprovedLandingRepairPath('Public task', [file], file), false);
  assert.throws(() => isApprovedLandingRepairPath(privateGoal, undefined, file), /SCOPE_MISSING/);
  assert.throws(() => isApprovedLandingRepairPath(privateGoal, ['qa/landing-other.mjs'], file), /SCOPE_VIOLATION/);
});
test('landing source exception never accepts arbitrary scripts, workflows, or traversal', () => {
  for (const file of ['qa/arbitrary.mjs', '.github/workflows/deploy.yml', 'expo/deploy-s3-direct.mjs', 'expo/ivxholding-landing/config.env']) {
    assert.equal(isApprovedLandingRepairPath(privateGoal, [file], file), false);
  }
  for (const file of ['qa/../landing-check.mjs', '/qa/landing-check.mjs', 'qa\\landing-check.mjs']) {
    assert.throws(() => isApprovedLandingRepairPath(privateGoal, [file], file), /SCOPE_MISSING/);
  }
});
