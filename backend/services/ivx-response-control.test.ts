/**
 * Phase 14: IVX response control tests — controlled tests against the
 * completion validator + narrative engine, proving honest status reporting.
 */
import { describe, expect, test } from 'bun:test';
import { classifyTaskType, validateCompletion } from './ivx-completion-validator';
import { buildSeniorDeveloperNarrative } from './ivx-senior-developer-narrative';
import { createExecutionRecord } from './ivx-execution-record';

describe('IVX Response Control — fail-closed completion', () => {
  test('feature fix with no code change must NOT report VERIFIED', () => {
    const taskType = classifyTaskType('Fix chat loading scroll to latest');
    expect(['CODE_FIX', 'UI_FIX']).toContain(taskType);
    const result = validateCompletion({
      taskType, requestedOutcome: 'Fix chat loading', acceptanceCriteria: ['Opens on latest'], state: 'DEPLOYED', previousVerdict: null,
      filesChanged: [], testsPassed: true, testsRun: true, typecheckPassed: true, typecheckRun: true,
      buildPassed: true, buildRun: true, commitSha: 'abc', deployId: 'dep-1', productionHealthOk: true,
      commitMatch: true, featureVerificationOk: null, error: null, startedAt: '', completedAt: '', verifiedAt: null,
    });
    expect(result.verdict).not.toBe('VERIFIED');
    expect(['DEPLOYED_ONLY', 'NOT_COMPLETED']).toContain(result.verdict);
  });

  test('deploy unchanged code is DEPLOYED_ONLY', () => {
    const result = validateCompletion({
      taskType: 'CODE_FIX', requestedOutcome: 'Fix chat', acceptanceCriteria: [], state: 'DEPLOYED', previousVerdict: null,
      filesChanged: [], testsPassed: true, testsRun: true, typecheckPassed: true, typecheckRun: true,
      buildPassed: true, buildRun: true, commitSha: 'abc', deployId: 'dep-1', productionHealthOk: true,
      commitMatch: true, featureVerificationOk: null, error: null, startedAt: '', completedAt: '', verifiedAt: null,
    });
    expect(result.verdict).toBe('DEPLOYED_ONLY');
    const record = createExecutionRecord({ task_id: 't', task_type: 'CODE_FIX', user_request: 'Fix chat' });
    const narrative = buildSeniorDeveloperNarrative({ record, verdict: result.verdict, verdictReason: result.reasons.join('; ') });
    expect(narrative.text).toContain('NOT implemented');
  });

  test('health passed but feature verification failed is not VERIFIED', () => {
    const result = validateCompletion({
      taskType: 'UI_FIX', requestedOutcome: 'Fix scroll', acceptanceCriteria: ['No visible jump'], state: 'PRODUCTION_VERIFYING', previousVerdict: null,
      filesChanged: [], testsPassed: true, testsRun: true, typecheckPassed: true, typecheckRun: true,
      buildPassed: true, buildRun: true, commitSha: 'abc', deployId: 'dep-1', productionHealthOk: true,
      commitMatch: true, featureVerificationOk: false, error: null, startedAt: '', completedAt: '', verifiedAt: null,
    });
    expect(result.verdict).not.toBe('VERIFIED');
  });

  test('real code change but device QA failed is NOT_COMPLETED', () => {
    const result = validateCompletion({
      taskType: 'CODE_FIX', requestedOutcome: 'Fix chat', acceptanceCriteria: [], state: 'PRODUCTION_VERIFYING', previousVerdict: null,
      filesChanged: ['expo/app/ivx/chat.tsx'], testsPassed: true, testsRun: true, typecheckPassed: true, typecheckRun: true,
      buildPassed: true, buildRun: true, commitSha: 'abc', deployId: 'dep-1', productionHealthOk: true,
      commitMatch: true, featureVerificationOk: false, error: null, startedAt: '', completedAt: '', verifiedAt: null,
    });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('NOT_COMPLETED');
  });

  test('code change without deploy cannot be certified complete', () => {
    const result = validateCompletion({
      taskType: 'CODE_FIX', requestedOutcome: 'Fix autonomous status', acceptanceCriteria: ['Merged and live'], state: 'COMMITTING', previousVerdict: null,
      filesChanged: ['backend/services/ivx-autonomous-coder.ts'], testsPassed: true, testsRun: true, typecheckPassed: true, typecheckRun: true,
      buildPassed: true, buildRun: true, commitSha: 'abc123', deployId: null, productionHealthOk: false,
      commitMatch: false, featureVerificationOk: null, error: null, startedAt: '', completedAt: '', verifiedAt: null,
    });
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('NOT_COMPLETED');
  });

  test('complete evidence is VERIFIED', () => {
    const result = validateCompletion({
      taskType: 'CODE_FIX', requestedOutcome: 'Fix chat', acceptanceCriteria: ['Opens on latest'], state: 'VERIFIED', previousVerdict: null,
      filesChanged: ['expo/app/ivx/chat.tsx'], testsPassed: true, testsRun: true, typecheckPassed: true, typecheckRun: true,
      buildPassed: true, buildRun: true, commitSha: 'abc123', deployId: 'dep-1', productionHealthOk: true,
      commitMatch: true, featureVerificationOk: true, error: null, startedAt: '', completedAt: '', verifiedAt: '',
    });
    expect(result.verdict).toBe('VERIFIED');
    expect(result.ok).toBe(true);
  });
});
