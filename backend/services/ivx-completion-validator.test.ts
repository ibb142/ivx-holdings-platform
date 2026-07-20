import { describe, expect, test } from 'bun:test';
import {
  classifyTaskType,
  validateCompletion,
  renderValidatorVerdict,
  renderValidatorReason,
  type IVXCompletionEvidence,
} from './ivx-completion-validator';

function baseEvidence(overrides: Partial<IVXCompletionEvidence> = {}): IVXCompletionEvidence {
  return {
    taskType: 'CODE_FIX',
    requestedOutcome: 'Fix chat loading and open on latest message.',
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
    commitSha: 'abc1234',
    deployId: 'dep_1',
    productionHealthOk: true,
    commitMatch: true,
    featureVerificationOk: null,
    error: null,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    verifiedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('classifyTaskType', () => {
  test('CODE_FIX for backend/api fix/bug prompt', () => {
    expect(classifyTaskType('Fix the broken health route and add a regression test')).toBe('CODE_FIX');
  });
  test('UI_FIX for chat/scroll/loading prompt', () => {
    expect(classifyTaskType('Fix chat loading and scroll to latest')).toBe('UI_FIX');
  });
  test('UI_FIX for keyboard/chat UI prompt', () => {
    expect(classifyTaskType('Chat scroll position is wrong when keyboard opens')).toBe('UI_FIX');
  });
  test('DEPLOYMENT for redeploy prompt without fix language', () => {
    expect(classifyTaskType('redeploy the production service now')).toBe('DEPLOYMENT');
  });
  test('INVESTIGATION for audit-only prompt', () => {
    expect(classifyTaskType('audit the chat ordering and report only')).toBe('INVESTIGATION');
  });
  test('QA_ONLY for test/verify prompt', () => {
    expect(classifyTaskType('run QA tests and verify the chat module')).toBe('QA_ONLY');
  });
});

describe('validateCompletion — owner mandate 2026-07-20', () => {
  test('CODE_FIX with real file change + deploy + health -> VERIFIED', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['expo/app/ivx/chat.tsx'] }));
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('VERIFIED');
    expect(result.state).toBe('VERIFIED');
  });

  test('CODE_FIX with no code change but deploy + health -> DEPLOYED_ONLY (not VERIFIED)', () => {
    const result = validateCompletion(baseEvidence());
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('DEPLOYED_ONLY');
    expect(result.state).toBe('DEPLOYED');
    expect(result.reasons[0]).toMatch(/Development task requested but no code changed/);
  });

  test('UI_FIX with no code change but deploy + health -> DEPLOYED_ONLY', () => {
    const result = validateCompletion(baseEvidence({ taskType: 'UI_FIX' }));
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('DEPLOYED_ONLY');
  });

  test('FEATURE with no code change but deploy + health -> DEPLOYED_ONLY', () => {
    const result = validateCompletion(baseEvidence({ taskType: 'FEATURE' }));
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('DEPLOYED_ONLY');
  });

  test('CODE_FIX with no code change and no deploy -> NOT_COMPLETED', () => {
    const result = validateCompletion(baseEvidence({ deployId: null, productionHealthOk: false, commitMatch: false }));
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('NOT_COMPLETED');
    expect(result.state).toBe('NO_CHANGE_REQUIRED');
  });

  test('DEPLOYMENT task with redeploy + health -> VERIFIED', () => {
    const result = validateCompletion(baseEvidence({ taskType: 'DEPLOYMENT' }));
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('VERIFIED');
  });

  test('INVESTIGATION task needs no code change -> VERIFIED', () => {
    const result = validateCompletion(baseEvidence({ taskType: 'INVESTIGATION', deployId: null, productionHealthOk: false, commitMatch: false }));
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('VERIFIED');
  });

  test('QA_ONLY with passing tests -> VERIFIED', () => {
    const result = validateCompletion(baseEvidence({ taskType: 'QA_ONLY', filesChanged: [], deployId: null, productionHealthOk: false, commitMatch: false }));
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('VERIFIED');
  });

  test('QA_ONLY with no tests -> NOT_COMPLETED', () => {
    const result = validateCompletion(baseEvidence({ taskType: 'QA_ONLY', filesChanged: [], testsRun: false, testsPassed: false, deployId: null, productionHealthOk: false, commitMatch: false }));
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('NOT_COMPLETED');
  });

  test('CODE_FIX with file change but tests failed -> NOT_COMPLETED', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['expo/app/ivx/chat.tsx'], testsPassed: false }));
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('NOT_COMPLETED');
  });

  test('CODE_FIX with file change but no deploy -> NOT_COMPLETED', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['expo/app/ivx/chat.tsx'], deployId: null, productionHealthOk: false, commitMatch: false }));
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('NOT_COMPLETED');
  });

  test('rejects VERIFIED if previous verdict lacks feature verification', () => {
    const result = validateCompletion(baseEvidence({ previousVerdict: 'VERIFIED', featureVerificationOk: false }));
    expect(result.ok).toBe(false);
    expect(result.reasons.some((r) => r.includes('Previous VERIFIED claim'))).toBe(true);
  });

  test('renderValidatorVerdict returns concise status strings', () => {
    expect(renderValidatorVerdict('VERIFIED')).toBe('VERIFIED');
    expect(renderValidatorVerdict('DEPLOYED_ONLY')).toBe('DEPLOYED_ONLY');
    expect(renderValidatorVerdict('NO_CHANGE_REQUIRED')).toBe('NO_CHANGE_REQUIRED');
    expect(renderValidatorVerdict('NOT_COMPLETED')).toBe('NOT_COMPLETED');
  });

  test('renderValidatorReason explains DEPLOYED_ONLY honestly', () => {
    const reason = renderValidatorReason('DEPLOYED_ONLY', ['no code changed']);
    expect(reason).toMatch(/redeploy occurred/);
    expect(reason).toMatch(/NOT implemented/);
  });
});
