/**
 * Phase 11: Structured execution record — 22 fields + validation.
 */
import { describe, expect, test } from 'bun:test';
import {
  appendCommand,
  appendEvidence,
  appendQAResult,
  appendTestResult,
  completeExecutionRecord,
  createExecutionRecord,
  EXECUTION_RECORD_REQUIRED_FIELDS,
  validateExecutionRecord,
} from './ivx-execution-record';

describe('IVX Execution Record', () => {
  test('has 22 required fields', () => {
    expect(EXECUTION_RECORD_REQUIRED_FIELDS.length).toBe(24); // 22 content fields + completed_at + verified_at
  });

  test('createExecutionRecord initializes all fields', () => {
    const r = createExecutionRecord({
      task_id: 'task-1',
      task_type: 'CODE_FIX',
      user_request: 'Fix chat loading',
      acceptance_criteria: ['Opens on latest', 'No visible jump'],
    });
    expect(r.task_id).toBe('task-1');
    expect(r.status).toBe('RECEIVED');
    expect(r.files_changed).toEqual([]);
    expect(r.started_at).toBeTruthy();
    expect(r.completed_at).toBe(null);
  });

  test('validateExecutionRecord passes for a fresh record', () => {
    const r = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'x' });
    const v = validateExecutionRecord(r);
    expect(v.ok).toBe(true);
    expect(v.missingFields).toEqual([]);
  });

  test('validateExecutionRecord rejects VERIFIED with no feature evidence for dev task', () => {
    const r = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'x' });
    r.status = 'VERIFIED';
    r.verified_at = new Date().toISOString();
    r.files_changed = ['file.ts'];
    const v = validateExecutionRecord(r);
    expect(v.ok).toBe(false);
    expect(v.inconsistencies.some((i) => i.includes('feature-verification'))).toBe(true);
  });

  test('validateExecutionRecord rejects VERIFIED dev task with empty diff + no external cause', () => {
    const r = createExecutionRecord({ task_id: 't', task_type: 'FEATURE', user_request: 'x' });
    r.status = 'VERIFIED';
    r.verified_at = new Date().toISOString();
    r.evidence = [{ kind: 'feature', label: 'test', value: 'ok', timestamp: '', verified: true }];
    const v = validateExecutionRecord(r);
    expect(v.ok).toBe(false);
    expect(v.inconsistencies.some((i) => i.includes('no files changed'))).toBe(true);
  });

  test('validateExecutionRecord rejects DEPLOYED with no deployment_id', () => {
    const r = createExecutionRecord({ task_id: 't', task_type: 'DEPLOYMENT', user_request: 'x' });
    r.status = 'DEPLOYED';
    const v = validateExecutionRecord(r);
    expect(v.ok).toBe(false);
    expect(v.inconsistencies.some((i) => i.includes('deployment_id'))).toBe(true);
  });

  test('appendCommand / appendTestResult / appendQAResult / appendEvidence are immutable', () => {
    const r = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'x' });
    const r2 = appendCommand(r, { command: 'bun test', exitCode: 0, outputPreview: 'pass', startedAt: '', finishedAt: '' });
    expect(r.commands.length).toBe(0);
    expect(r2.commands.length).toBe(1);
    const r3 = appendTestResult(r2, { name: 'unit', command: 'bun test', passed: true, passedCount: 1, failedCount: 0, durationMs: 100, outputPreview: 'ok' });
    expect(r2.tests.length).toBe(0);
    expect(r3.tests.length).toBe(1);
    const r4 = appendQAResult(r3, { platform: 'android', name: 'scroll', passed: true, evidence: 'screenshot', notes: '' });
    expect(r3.qa_results.length).toBe(0);
    expect(r4.qa_results.length).toBe(1);
    const r5 = appendEvidence(r4, { kind: 'commit', label: 'sha', value: 'abc', timestamp: '', verified: true });
    expect(r4.evidence.length).toBe(0);
    expect(r5.evidence.length).toBe(1);
  });

  test('completeExecutionRecord sets completed_at + verified_at', () => {
    const r = createExecutionRecord({ task_id: 't', task_type: 'INVESTIGATION', user_request: 'x' });
    const r2 = completeExecutionRecord(r, 'VERIFIED', true);
    expect(r2.status).toBe('VERIFIED');
    expect(r2.completed_at).toBeTruthy();
    expect(r2.verified_at).toBeTruthy();
    const r3 = completeExecutionRecord(r, 'FAILED', false);
    expect(r3.verified_at).toBe(null);
  });
});
