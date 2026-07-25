import { describe, expect, test } from 'bun:test';
import { resolveWorkerExecutionMode } from './ivx-senior-developer-worker';
import { summarizeAutonomousCoderProof } from '../services/ivx-senior-developer-worker';
import type { IVXAutonomousCoderProof } from '../services/ivx-autonomous-coder';

function autonomousProof(overrides: Partial<IVXAutonomousCoderProof> = {}): IVXAutonomousCoderProof {
  return {
    marker: 'ivx-autonomous-coder-2026-07-19',
    taskId: 'task-proof',
    goal: 'Fix the public chat response and deploy it.',
    executionMode: 'deploy',
    approvalPolicy: 'owner_gated',
    ownerId: 'owner-proof',
    startingSha: 'before-sha',
    filesInspected: ['backend/api/public-chat.ts'],
    rootCause: 'HTTP 409 makes a completed blocker look like a transport failure.',
    technicalPlan: 'Return a renderable completed chat turn.',
    iterations: [],
    finalPatch: [],
    filesChanged: ['backend/api/public-chat.ts'],
    commandsRun: [{ command: 'bun test focused', ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 1 }],
    testsPassed: true,
    typecheckPassed: true,
    buildRun: false,
    commitSha: 'after-sha',
    commitUrl: 'https://github.com/ibb142/rork-global-real-estate-invest/commit/after-sha',
    branch: 'main',
    deployApproved: true,
    deployRequested: true,
    deployId: 'dep-new',
    deployStatus: 'live',
    productionVerified: true,
    liveCommit: 'after-sha',
    healthOk: true,
    iterationCount: 1,
    durationMs: 1,
    finalStatus: 'COMPLETED',
    error: null,
    generatedAt: '2026-07-25T00:00:00.000Z',
    secretValuesReturned: false,
    patchAuthoredBy: 'ivx_llm',
    llmCallCount: 1,
    estimatedTokensUsed: 1,
    tokenBudgetExceeded: false,
    rollbackTriggered: false,
    rollbackCommitSha: null,
    rollbackError: null,
    ...overrides,
  };
}

describe('resolveWorkerExecutionMode', () => {
  test('routes an owner-approved production mutation through deploy even when no mode was supplied', () => {
    expect(resolveWorkerExecutionMode(undefined, true, true)).toBe('deploy');
  });

  test('routes an approved patch without deployment through the code-change executor', () => {
    expect(resolveWorkerExecutionMode(undefined, true, false)).toBe('code_change');
  });

  test('does not allow a QA mode to downgrade an owner-approved production mutation', () => {
    expect(resolveWorkerExecutionMode('qa_only', true, true)).toBe('deploy');
  });

  test('preserves an explicit safe read-only mode without mutation approvals', () => {
    expect(resolveWorkerExecutionMode('read_only', false, false)).toBe('read_only');
  });
});

describe('summarizeAutonomousCoderProof', () => {
  test('rejects reused starting commit evidence for a code-changing deploy', () => {
    const result = summarizeAutonomousCoderProof('job-stale', autonomousProof({ commitSha: 'before-sha', liveCommit: 'before-sha' }));
    expect(result.finalStatus).toBe('FAILED');
    expect(result.ok).toBe(false);
    expect(result.endToEndProductionComplete).toBe(false);
    expect(result.error).toContain('reused its starting commit SHA');
  });

  test('rejects a completed code-changing deploy that reports no changed files', () => {
    const result = summarizeAutonomousCoderProof('job-no-files', autonomousProof({ filesChanged: [] }));
    expect(result.finalStatus).toBe('FAILED');
    expect(result.error).toContain('produced no changed files');
  });

  test('accepts only fresh deploy proof with new live commit parity', () => {
    const result = summarizeAutonomousCoderProof('job-fresh', autonomousProof());
    expect(result.finalStatus).toBe('COMPLETE');
    expect(result.ok).toBe(true);
    expect(result.endToEndProductionComplete).toBe(true);
    expect(result.commitMatch).toBe(true);
  });
});
