import { describe, expect, test } from 'bun:test';
import { resolveWorkerExecutionMode } from './ivx-senior-developer-worker';
import { summarizeAutonomousCoderProof, finalizeResultWithStateRecord, type IVXWorkerJob } from '../services/ivx-senior-developer-worker';
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
    healthResponse: { endpoint: 'https://api.ivxholding.com/health', httpStatus: 200, commitSha: 'after-sha', ok: true },
    versionResponse: { endpoint: 'https://api.ivxholding.com/version', httpStatus: 200, commitSha: 'after-sha', ok: true },
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
    stageTrace: null,
    taskPlan: null,
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
  test('persists failed and successful validation receipts through the terminal execution record without raw output', () => {
    const proof = autonomousProof({
      finalStatus: 'BLOCKED', executionMode: 'code_change', error: 'Regression still fails',
      commitSha: null, filesChanged: [], testsPassed: false, productionVerified: false,
      healthOk: false, deployRequested: false, deployApproved: false, deployId: null,
      commandsRun: [
        { command: 'node --import tsx --test backend/check.test.ts', ok: false, exitCode: 1, stdoutTail: 'private output fixture', stderrTail: 'ReferenceError: describe is not defined', durationMs: 150 },
        { command: 'node /app/node_modules/typescript/bin/tsc --noEmit backend/check.test.ts', ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 300 },
      ],
    });
    const summary = summarizeAutonomousCoderProof('job-receipts', proof);
    const job: IVXWorkerJob = {
      jobId: 'job-receipts', ownerId: 'owner-proof', status: 'testing', stage: 'TESTING', progressPercent: 50, stageDetail: 'validating',
      createdAt: '2026-07-24T23:59:00.000Z', startedAt: '2026-07-24T23:59:30.000Z', finishedAt: null, cancelledAt: null,
      attempts: 1, result: null, error: null,
      input: { goal: proof.goal, ownerApproved: true, approvePatch: true, approveGitDeploy: false, validationMode: 'focused', systemMode: false, ownerApprovedAction: null, executionMode: 'code_change' },
    };
    const stored = JSON.parse(JSON.stringify(finalizeResultWithStateRecord(job, summary)));
    expect(stored.finalStatus).toBe('BLOCKED');
    expect(stored.ok).toBe(false);
    expect(stored.validationEvidence.map((r: { kind: string }) => r.kind)).toEqual(['test', 'typecheck']);
    expect(stored.executionRecord.commands.map((r: { exit_code: number }) => r.exit_code)).toEqual([1, 0]);
    expect(stored.executionRecord.tests).toHaveLength(1);
    expect(stored.executionRecord.tests[0].passed).toBe(false);
    expect(stored.executionRecord.tests[0].duration_ms).toBe(150);
    expect(stored.executionRecord.started_at).toBe(Date.parse(job.startedAt!));
    expect(stored.executionRecord.files_inspected).toEqual(proof.filesInspected);
    expect(stored.validationEvidence[0].stdoutHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain('private output fixture');
    expect(JSON.stringify(stored)).not.toContain('ReferenceError: describe is not defined');
  });

  test('does not count typechecking a test filename as execution of that test', () => {
    const result = summarizeAutonomousCoderProof('job-typecheck-only', autonomousProof({
      finalStatus: 'BLOCKED', commandsRun: [{ command: 'node /app/node_modules/typescript/bin/tsc --noEmit backend/example.test.ts', ok: true, exitCode: 0, stdoutTail: '', stderrTail: '', durationMs: 9 }],
    }));
    expect(result.testsRun).toBe(false);
    expect(result.typecheckRun).toBe(true);
    expect(result.validationEvidence?.[0].kind).toBe('typecheck');
  });

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

  test('accepts a resumed code_change proof already merged to main even when filesChanged was lost on restart', () => {
    const result = summarizeAutonomousCoderProof('job-resume-merged', autonomousProof({
      executionMode: 'code_change',
      filesChanged: [],
      prMerged: true,
      prMergeCommitSha: 'after-sha',
      resumedFromRestart: true,
      deployApproved: false,
      deployRequested: false,
      deployId: null,
      deployStatus: null,
      productionVerified: false,
      healthOk: false,
      healthResponse: null,
      versionResponse: null,
    }));
    expect(result.finalStatus).toBe('COMPLETE');
    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
  });

  test('accepts only fresh deploy proof on main with a live Render deployment and new live commit parity', () => {
    const result = summarizeAutonomousCoderProof('job-fresh', autonomousProof());
    expect(result.finalStatus).toBe('COMPLETE');
    expect(result.ok).toBe(true);
    expect(result.endToEndProductionComplete).toBe(true);
    expect(result.commitMatch).toBe(true);
  });

  test('rejects a deploy proof committed to ivx-autonomous even if all other evidence appears valid', () => {
    const result = summarizeAutonomousCoderProof('job-wrong-branch', autonomousProof({ branch: 'ivx-autonomous' }));
    expect(result.finalStatus).toBe('FAILED');
    expect(result.error).toContain('approved production branch main');
  });

  test('rejects a deploy proof without both endpoint receipts', () => {
    const missingVersion = summarizeAutonomousCoderProof('job-no-version', autonomousProof({ versionResponse: null }));
    expect(missingVersion.finalStatus).toBe('FAILED');
    expect(missingVersion.error).toContain('/version');
  });

  test('rejects a deploy proof without a real Render deployment ID or live status', () => {
    const missingId = summarizeAutonomousCoderProof('job-no-deploy-id', autonomousProof({ deployId: null }));
    const pending = summarizeAutonomousCoderProof('job-pending-deploy', autonomousProof({ deployStatus: 'build_in_progress' }));
    expect(missingId.finalStatus).toBe('FAILED');
    expect(missingId.error).toContain('Render deployment ID');
    expect(pending.finalStatus).toBe('FAILED');
    expect(pending.error).toContain('Render live status');
  });
});
