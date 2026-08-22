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

describe('validateCompletion — fail-closed senior developer contract', () => {
  test('CODE_FIX with complete evidence chain -> VERIFIED', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['expo/app/ivx/chat.tsx'] }));
    expect(result.ok).toBe(true);
    expect(result.verdict).toBe('VERIFIED');
  });

  test('no code change but deploy -> DEPLOYED_ONLY', () => {
    const result = validateCompletion(baseEvidence());
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('DEPLOYED_ONLY');
  });

  test('code task without tests cannot complete', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['backend/a.ts'], testsRun: false }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/Tests were not run/);
  });

  test('code task without typecheck cannot complete', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['backend/a.ts'], typecheckRun: false }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/Typecheck was not run/);
  });

  test('code task without commit cannot complete', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['backend/a.ts'], commitSha: null }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/no commit SHA/i);
  });

  test('code task without deploy cannot complete', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['backend/a.ts'], deployId: null }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/not deployed/i);
  });

  test('production SHA mismatch is a hard failure', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['backend/a.ts'], commitMatch: false }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/does not exactly match/i);
  });

  test('failed feature verification cannot complete', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['backend/a.ts'], featureVerificationOk: false }));
    expect(result.ok).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/behavior failed/i);
  });

  test('execution error fails closed even if other evidence looks green', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['backend/a.ts'], error: 'CI failed' }));
    expect(result.ok).toBe(false);
    expect(result.verdict).toBe('FAILED');
  });

  test('DEPLOYMENT requires deploy, health and exact SHA', () => {
    expect(validateCompletion(baseEvidence({ taskType: 'DEPLOYMENT' })).ok).toBe(true);
    expect(validateCompletion(baseEvidence({ taskType: 'DEPLOYMENT', commitMatch: false })).ok).toBe(false);
  });

  test('INVESTIGATION needs no mutation', () => {
    const result = validateCompletion(baseEvidence({ taskType: 'INVESTIGATION', deployId: null, productionHealthOk: false, commitMatch: false }));
    expect(result.ok).toBe(true);
  });

  test('QA_ONLY requires passing tests', () => {
    expect(validateCompletion(baseEvidence({ taskType: 'QA_ONLY', deployId: null })).ok).toBe(true);
    expect(validateCompletion(baseEvidence({ taskType: 'QA_ONLY', testsRun: false, deployId: null })).ok).toBe(false);
  });

  test('rejects previous VERIFIED claim when feature verification failed', () => {
    const result = validateCompletion(baseEvidence({ filesChanged: ['backend/a.ts'], previousVerdict: 'VERIFIED', featureVerificationOk: false }));
    expect(result.ok).toBe(false);
  });

  test('render helpers remain concise', () => {
    expect(renderValidatorVerdict('VERIFIED')).toBe('VERIFIED');
    const reason = renderValidatorReason('DEPLOYED_ONLY', ['no code changed']);
    expect(reason).toMatch(/redeploy occurred/);
    expect(reason).toMatch(/NOT implemented/);
  });
});
