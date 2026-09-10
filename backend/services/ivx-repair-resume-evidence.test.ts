import { expect, test } from 'bun:test';
import { assertRepairResumeEvidence } from './ivx-repair-resume-evidence';

const goal = '[TEMPLATE_MODE:BUG_FIX] Restore observed behavior';
const baseline = { command: 'node --import tsx --test backend/regression.test.ts', phase: 'regression_baseline', ok: false, exitCode: 1, stdoutHash: 'a'.repeat(64), stderrHash: 'b'.repeat(64) };
const patched = { ...baseline, phase: undefined, ok: true, exitCode: 0, stdoutHash: 'c'.repeat(64) };

test('permits a resumed repair only with ordered receipts for the same regression', () => {
  expect(() => assertRepairResumeEvidence('ivx-worker-fixture', goal, [baseline, patched])).not.toThrow();
});

test('blocks legacy green-only repairs and missing or unrelated regression evidence', () => {
  for (const receipts of [[], [patched], [baseline], [patched, baseline], [baseline, { ...patched, command: 'node --test backend/other.test.ts' }], [baseline, { ...patched, stdoutHash: '' }], [{ ...baseline, exitCode: null }, patched]]) {
    expect(() => assertRepairResumeEvidence('ivx-worker-fixture', goal, receipts)).toThrow('REPAIR_REGRESSION_EVIDENCE_MISSING');
  }
});

test('preserves ordinary owner tasks outside the diagnostic repair gate', () => {
  expect(() => assertRepairResumeEvidence('owner-task', 'Create requested content', [])).not.toThrow();
});
