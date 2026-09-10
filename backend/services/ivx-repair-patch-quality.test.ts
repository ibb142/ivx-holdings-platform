import { expect, it } from 'bun:test';
import { assertRepairPatchQuality } from './ivx-repair-patch-quality';

const task = 'fleet-reasoning:incident';
const regression = { path: 'backend/api/worker.test.ts', oldText: '', newText: 'test("recovers", () => expect(recover()).toBe(true));' };
it('rejects the observed diagnostic-only repair even with a test file', () => {
  const patch = { path: 'backend/api/worker.ts', oldText: "if (!snapshot) return unavailable();", newText: "if (!snapshot) { console.error('Snapshot unavailable'); return unavailable(); }" };
  expect(() => assertRepairPatchQuality(task, [patch, regression])).toThrow('REPAIR_NOT_FUNCTIONAL');
});
it('requires a changed regression test with a changed implementation', () => {
  const patch = { path: 'backend/services/worker.ts', oldText: 'return queue.shift();', newText: 'return await queue.claim();' };
  expect(() => assertRepairPatchQuality(task, [patch])).toThrow('REPAIR_REGRESSION_TEST_REQUIRED');
  expect(() => assertRepairPatchQuality('landing-remediation:unit', [patch, regression])).not.toThrow();
});
it('does not prohibit an explicit owner task to improve diagnostics', () => {
  expect(() => assertRepairPatchQuality('owner-request', [{ path: 'backend/api/worker.ts', oldText: '', newText: 'console.info("observed");' }])).not.toThrow();
});
it('also requires regression coverage for diagnostic BUG_FIX jobs without a Landing task prefix', () => {
  const patch = { path: 'backend/api/worker.ts', oldText: 'const cacheTtl = 120;', newText: 'const cacheTtl = 180;' };
  expect(() => assertRepairPatchQuality('ivx-worker-incident', [patch], '[TEMPLATE_MODE:BUG_FIX] Repair a slow endpoint')).toThrow('REPAIR_REGRESSION_TEST_REQUIRED');
  expect(() => assertRepairPatchQuality('ivx-worker-incident', [patch], '[AUTONOMOUS_DIAGNOSTIC_DATA] Repair observed failure')).toThrow('REPAIR_REGRESSION_TEST_REQUIRED');
});
