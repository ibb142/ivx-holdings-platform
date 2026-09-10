import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { assertPrivateRepairScope, publicRepairGoal } from './ivx-private-repair-boundary';
const privateGoal = '[TEMPLATE_MODE:BUG_FIX] [OWNER_AUDIT:synthetic:row] Private acceptance text';
test('private task metadata is replaced before public PR formatting', () => {
  assert.equal(publicRepairGoal(privateGoal), 'Scoped application repair');
  assert.equal(publicRepairGoal('[TEMPLATE_MODE:BUG_FIX] Automated incident with private probe details'), 'Scoped application repair');
  assert.equal(publicRepairGoal('[AUTONOMOUS_DIAGNOSTIC_DATA] Private diagnostic observations'), 'Scoped application repair');
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
