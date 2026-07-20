/**
 * Phase 7+10: Narrative engine — 7 sections, no invented actions.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildSeniorDeveloperNarrative,
  detectForbiddenVaguePhrases,
  detectInventedActions,
} from './ivx-senior-developer-narrative';
import { createExecutionRecord, appendEvidence, appendTestResult } from './ivx-execution-record';

describe('IVX Senior Developer Narrative Engine', () => {
  test('produces 7 sections', () => {
    const record = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'Fix chat' });
    const out = buildSeniorDeveloperNarrative({ record, verdict: 'NOT_COMPLETED', verdictReason: 'no code changed' });
    expect(out.sections.length).toBe(7);
    expect(out.sections[0]).toContain('DIRECT ANSWER');
    expect(out.sections[6]).toContain('WHAT IS STILL NOT VERIFIED');
  });

  test('DEPLOYED_ONLY verdict says fix NOT implemented', () => {
    const record = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'Fix chat' });
    const out = buildSeniorDeveloperNarrative({ record, verdict: 'DEPLOYED_ONLY', verdictReason: 'redeploy only' });
    expect(out.text).toContain('NOT implemented');
  });

  test('detects forbidden vague phrases', () => {
    expect(detectForbiddenVaguePhrases('Everything is working now')).toContain('everything is working');
    expect(detectForbiddenVaguePhrases('Fully complete')).toContain('fully complete');
    expect(detectForbiddenVaguePhrases('The fix is applied')).toEqual([]);
  });

  test('detects invented actions: claims VERIFIED but record is not VERIFIED', () => {
    const record = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'x' });
    record.status = 'BLOCKED';
    const invented = detectInventedActions('The task is VERIFIED and complete.', record);
    expect(invented.some((i) => i.includes('Claims VERIFIED but record'))).toBe(true);
  });

  test('detects invented actions: claims fixed but no files changed for dev task', () => {
    const record = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'x' });
    const invented = detectInventedActions('The bug is fixed.', record);
    expect(invented.some((i) => i.includes('Claims "fixed" but no files'))).toBe(true);
  });

  test('VERIFIED narrative with real evidence has no invented actions', () => {
    let record = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'Fix chat scroll' });
    record.status = 'VERIFIED';
    record.root_cause = 'scrollToEnd called before layout';
    record.files_changed = ['expo/app/ivx/chat.tsx'];
    record = appendEvidence(record, { kind: 'feature', label: 'scroll-to-latest', value: 'verified on device', timestamp: '', verified: true });
    record = appendTestResult(record, { name: 'chat-fix', command: 'bun test', passed: true, passedCount: 9, failedCount: 0, durationMs: 200, outputPreview: 'pass' });
    const out = buildSeniorDeveloperNarrative({ record, verdict: 'VERIFIED', verdictReason: 'all evidence present' });
    expect(out.inventedActionsDetected).toEqual([]);
  });

  test('NOT_COMPLETED narrative lists missing device QA', () => {
    const record = createExecutionRecord({ task_id: 't', task_type: 'UI_FIX', user_request: 'Fix scroll' });
    const out = buildSeniorDeveloperNarrative({ record, verdict: 'NOT_COMPLETED', verdictReason: 'no code changed' });
    expect(out.text).toContain('android device QA was not performed');
    expect(out.text).toContain('ios device QA was not performed');
  });
});
