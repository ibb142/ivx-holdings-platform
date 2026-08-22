/**
 * Phase 14: IVX response control tests — 6 controlled tests against the
 * completion validator + narrative engine, proving honest status reporting.
 */
import { describe, expect, test } from 'bun:test';
import { classifyTaskType, validateCompletion } from './ivx-completion-validator';
import { buildSeniorDeveloperNarrative } from './ivx-senior-developer-narrative';
import { createExecutionRecord } from './ivx-execution-record';

describe('IVX Response Control — 6 Tests', () => {
  test('TEST 1: feature fix with no code change must NOT report VERIFIED', () => {
    const taskType = classifyTaskType('Fix chat loading scroll to latest');
    expect(['CODE_FIX', 'UI_FIX']).toContain(taskType);
    const result = validateCompletion({
      taskType,
      requestedOutcome: 'Fix chat loading',
      acceptanceCriteria: ['Opens on latest'],
      state: 'DEPLOYED',
      previousVerdict: null,
      filesChanged: [],
      testsPassed: true,
      testsRun: true,
      typecheckPassed: true,
      typecheckRun: true,
      buildPassed: true,
      buildRun: true,
      commitSha: 'abc',
      deployId: 'dep-1',
      productionHealthOk: true,
      commitMatch: true,
      featureVerificationOk: null,
      error: null,
      startedAt: '',
      completedAt: '',
      verifiedAt: null,
    });
    expect(result.verdict).not.toBe('VERIFIED');
    expect(['DEPLOYED_ONLY', 'NOT_COMPLETED']).toContain(result.verdict);
  });

  test('TEST 2: deploy unchanged code may report DEPLOYED_ONLY, not FIXED or VERIFIED', () => {
    const result = validateCompletion({
      taskType: 'CODE_FIX',
      requestedOutcome: 'Fix chat',
      acceptanceCriteria: [],
      state: 'DEPLOYED',
      previousVerdict: null,
      filesChanged: [],
      testsPassed: true,
      testsRun: true,
      typecheckPassed: true,
      typecheckRun: true,
      buildPassed: true,
      buildRun: true,
      commitSha: 'abc',
      deployId: 'dep-1',
      productionHealthOk: true,
      commitMatch: true,
      featureVerificationOk: null,
      error: null,
      startedAt: '',
      completedAt: '',
      verifiedAt: null,
    });
    expect(result.verdict).toBe('DEPLOYED_ONLY');
    const record = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'Fix chat' });
    const narrative = buildSeniorDeveloperNarrative({ record, verdict: result.verdict, verdictReason: result.reasons.join('; ') });
    expect(narrative.text).toContain('NOT implemented');
  });

  test('TEST 3: health passed but feature verification failed — must state feature verification failed', () => {
    const result = validateCompletion({
      taskType: 'UI_FIX',
      requestedOutcome: 'Fix scroll',
      acceptanceCriteria: ['No visible jump'],
      state: 'PRODUCTION_VERIFYING',
      previousVerdict: null,
      filesChanged: [],
      testsPassed: true,
      testsRun: true,
      typecheckPassed: true,
      typecheckRun: true,
      buildPassed: true,
      buildRun: true,
      commitSha: 'abc',
      deployId: 'dep-1',
      productionHealthOk: true,
      commitMatch: true,
      featureVerificationOk: false,
      error: null,
      startedAt: '',
      completedAt: '',
      verifiedAt: null,
    });
    expect(result.verdict).not.toBe('VERIFIED');
    const record = createExecutionRecord({ task_id: 't', task_type: 'UI_FIX', user_request: 'Fix scroll' });
    const narrative = buildSeniorDeveloperNarrative({ record, verdict: result.verdict, verdictReason: result.reasons.join('; ') });
    expect(narrative.text.toLowerCase()).toMatch(/not implemented|not completed|feature verification/);
  });

  test('TEST 4: real code change but device QA failed — must report NOT_COMPLETED, not complete', () => {
    const result = validateCompletion({
      taskType: 'CODE_FIX',
      requestedOutcome: 'Fix chat',
      acceptanceCriteria: [],
      state: 'PRODUCTION_VERIFYING',
      previousVerdict: null,
      filesChanged: ['expo/app/ivx/chat.tsx'],
      testsPassed: true,
      testsRun: true,
      typecheckPassed: true,
      typecheckRun: true,
      buildPassed: true,
      buildRun: true,
      commitSha: 'abc',
      deployId: 'dep-1',
      productionHealthOk: true,
      commitMatch: true,
      featureVerificationOk: false,
      error: null,
      startedAt: '',
      completedAt: '',
      verifiedAt: null,
    });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('NOT_COMPLETED');
    expect(result.reasons.join(' ')).toMatch(/behavior failed|feature verification/i);
  });

  test('TEST 5: complete evidence → VERIFIED with exact evidence', () => {
    const result = validateCompletion({
      taskType: 'CODE_FIX',
      requestedOutcome: 'Fix chat',
      acceptanceCriteria: ['Opens on latest'],
      state: 'VERIFIED',
      previousVerdict: null,
      filesChanged: ['expo/app/ivx/chat.tsx'],
      testsPassed: true,
      testsRun: true,
      typecheckPassed: true,
      typecheckRun: true,
      buildPassed: true,
      buildRun: true,
      commitSha: 'abc123',
      deployId: 'dep-1',
      productionHealthOk: true,
      commitMatch: true,
      featureVerificationOk: true,
      error: null,
      startedAt: '',
      completedAt: '',
      verifiedAt: '',
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(result.ok).toBe(true);
  });

  test('TEST 6: technical explanation → INVESTIGATION, no fabricated execution', () => {
    const taskType = classifyTaskType('Explain why the chat opens on old messages');
    expect(taskType).toBe('INVESTIGATION');
    const record = createExecutionRecord({ task_id: 't', task_type: 'INVESTIGATION', user_request: 'Explain why chat opens on old messages' });
    record.status = 'VERIFIED';
    record.root_cause = 'The DB query loaded the full history ascending with no limit, so the FlatList had to lay out hundreds of items before scroll-to-latest could anchor.';
    const narrative = buildSeniorDeveloperNarrative({ record, verdict: 'VERIFIED', verdictReason: 'investigation complete' });
    expect(narrative.inventedActionsDetected).toEqual([]);
    expect(narrative.text).toContain('Investigation tasks do not require a code change');
  });
});
