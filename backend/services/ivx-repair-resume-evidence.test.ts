import { expect, test } from 'bun:test';
import { assertRepairResumeEvidence } from './ivx-repair-resume-evidence';
import { readFileSync } from 'node:fs';

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

test('scheduler resume requires real failing and passing regression receipts', () => {
  expect(() => assertRepairResumeEvidence('scheduler-repair:sha:scope', 'Restore observed behavior', [])).toThrow('REPAIR_REGRESSION_EVIDENCE_MISSING');
  expect(() => assertRepairResumeEvidence('scheduler-repair:sha:scope', 'Restore observed behavior', [baseline, patched])).not.toThrow();
});

test('worker resume checks the durable task identity before merge, not its generic worker job ID', () => {
  const source = readFileSync(new URL('./ivx-senior-developer-worker.ts', import.meta.url), 'utf8');
  const calls = source.match(/assertRepairResumeEvidence\([^;]+;/g) ?? [];
  expect(calls).toHaveLength(1);
  // Execute the production call with the real guard. Missing receipts must
  // stop a resumed repair even when its human-readable goal has no marker.
  const check = new Function('assertRepairResumeEvidence', 'job', 'jobId', calls[0]);
  for (const taskId of ['scheduler-repair:sha:scope', 'fleet-reasoning:incident']) {
    const job = { input: { taskId, goal: 'Restore observed behavior' }, result: { validationEvidence: [] as typeof baseline[] } };
    expect(() => check(assertRepairResumeEvidence, job, 'ivx-worker-generic')).toThrow('REPAIR_REGRESSION_EVIDENCE_MISSING');
    job.result.validationEvidence = [baseline, patched as typeof baseline];
    expect(() => check(assertRepairResumeEvidence, job, 'ivx-worker-generic')).not.toThrow();
  }
});
