import { describe, expect, test } from 'bun:test';
import {
  buildSeniorDeveloperExecutionAnswer,
  isTestCommand,
  isTypecheckCommand,
} from './ivx-senior-developer-answer-format';
import type { IVXSeniorDeveloperRunProof } from './ivx-senior-developer-runtime';
import type { IVXOwnerExecutionDecision } from './ivx-owner-execution-mode';

function makeProof(overrides: Partial<IVXSeniorDeveloperRunProof> = {}): IVXSeniorDeveloperRunProof {
  const base = {
    ok: true,
    jobId: 'job_test_1',
    goal: 'Fix the broken health route and add a regression test.',
    repoBrain: {
      indexedFileCount: 1200,
      indexedDirectoryCount: 80,
      keyFiles: ['backend/hono.ts', 'backend/api/ivx-owner-ai.ts'],
    },
    patchProposal: {
      status: 'proposed',
      operations: [
        { path: 'backend/hono.ts', summary: 'add /health guard' },
      ],
      diffPreview: '',
    },
    changedFiles: ['backend/hono.ts'],
    validations: [
      {
        command: 'bun test backend/hono.test.ts',
        ok: true,
        exitCode: 0,
        durationMs: 120,
        stdoutTail: '12 pass\n0 fail',
        stderrTail: '',
        error: null,
      },
      {
        command: 'bun run typecheck',
        ok: true,
        exitCode: 0,
        durationMs: 300,
        stdoutTail: 'tsc --noEmit clean',
        stderrTail: '',
        error: null,
      },
    ],
    gitDeployOperator: {
      status: 'executed',
      github: { commitAttempted: true, commitSha: 'abc1234', branch: 'main', reason: '' },
      render: { deployAttempted: true, deployId: 'dep_1', deployStatus: 'live', error: null },
      reason: 'executed',
    },
    productionVerification: { ok: true },
    changedRouteVerification: { ok: true },
  };
  return { ...base, ...overrides } as unknown as IVXSeniorDeveloperRunProof;
}

const autoDecision: IVXOwnerExecutionDecision = {
  isOwnerExecutionCommand: true,
  autoExecute: true,
  requiresApproval: false,
  approvalCategories: [],
  reason: 'non-destructive',
  systemMode: true,
  matchedTriggers: ['fix this'],
  safeCategories: [],
};

const requiredHeaders = [
  'TASK ID:',
  'STATUS:',
  'FILES CHANGED:',
  'COMMANDS:',
  'TESTS:',
  'DEPLOYED PROOF:',
];

describe('command classification', () => {
  test('typecheck vs test commands are distinguished', () => {
    expect(isTypecheckCommand('bun run typecheck')).toBe(true);
    expect(isTypecheckCommand('tsc --noEmit')).toBe(true);
    expect(isTestCommand('bun test foo.test.ts')).toBe(true);
    expect(isTestCommand('bun run typecheck')).toBe(false);
  });
});

describe('buildSeniorDeveloperExecutionAnswer — strict 6-section format', () => {
  test('emits the exact owner-required section headers in order', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(makeProof(), autoDecision);
    let cursor = -1;
    for (const header of requiredHeaders) {
      const idx = answer.indexOf(header);
      expect(idx).toBeGreaterThan(cursor);
      cursor = idx;
    }
  });

  test('does NOT echo the user goal into the answer (no false guard positives)', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({ goal: 'complete the loading on this chat after deploy' }),
      autoDecision,
    );
    expect(answer).not.toContain('complete the loading');
    expect(answer).not.toContain('TASK UNDERSTOOD');
    expect(answer).not.toContain('FILES INSPECTED');
  });

  test('never contains the old narrative prose', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(makeProof(), autoDecision);
    expect(answer).not.toContain('Owner Execution Mode — executing end-to-end');
    expect(answer).not.toContain('Files inspected: indexed');
  });

  test('shows real changed files and raw test output', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(makeProof(), autoDecision);
    expect(answer).toContain('backend/hono.ts');
    expect(answer).toContain('12 pass');
    expect(answer).toContain('0 fail');
    // Typecheck is a command, not a test; its command line appears in COMMANDS.
    expect(answer).toContain('bun run typecheck');
  });

  test('STATUS is VERIFIED when code changed, commit + deploy executed, and production verified', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(makeProof(), autoDecision);
    expect(answer).toContain('STATUS:\nVERIFIED');
  });

  test('STATUS is NOT_COMPLETED when files changed but tests were not run', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({ validations: [] } as unknown as Partial<IVXSeniorDeveloperRunProof>),
      autoDecision,
    );
    expect(answer).toContain('STATUS:\nNOT_COMPLETED');
    expect(answer).toContain('completion verdict: NOT_COMPLETED');
    expect(answer).not.toMatch(/STATUS:\nDEPLOYED(?:\n| )/);
    expect(answer).toContain('NOT VERIFIED — tests were not run.');
  });

  test('STATUS is NOT_COMPLETED when a validation failed', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({
        validations: [
          {
            command: 'bun test backend/hono.test.ts',
            ok: false,
            exitCode: 1,
            durationMs: 120,
            stdoutTail: '11 pass\n1 fail',
            stderrTail: '',
            error: null,
          },
        ],
      } as unknown as Partial<IVXSeniorDeveloperRunProof>),
      autoDecision,
    );
    expect(answer).not.toMatch(/STATUS:\nDEPLOYED(?:\n| )/);
    expect(answer).toContain('STATUS:\nNOT_COMPLETED');
    expect(answer).toContain('completion verdict: NOT_COMPLETED');
  });

  test('STATUS is NOT_COMPLETED when files changed but not deployed', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({
        gitDeployOperator: {
          status: 'blocked_missing_credentials',
          github: { commitAttempted: false, commitSha: null, branch: null, reason: 'no token' },
          render: { deployAttempted: false, deployId: null, deployStatus: null, error: null },
          reason: 'no token',
        },
      } as unknown as Partial<IVXSeniorDeveloperRunProof>),
      autoDecision,
    );
    expect(answer).toContain('STATUS:\nNOT_COMPLETED');
    expect(answer).toContain('completion verdict: NOT_COMPLETED');
  });
});

describe('hard enforcement', () => {
  test('no changed files and no deploy -> NO CODE CHANGED and NOT_COMPLETED status', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({
        changedFiles: [],
        patchProposal: { status: 'not_needed', operations: [], diffPreview: '' },
        gitDeployOperator: {
          status: 'ready_owner_approval_required',
          github: { commitAttempted: false, commitSha: null, branch: null },
          render: { deployAttempted: false, deployId: null, deployStatus: null, error: null },
          reason: 'No code change was required and no production deploy was requested this pass.',
        },
      } as unknown as Partial<IVXSeniorDeveloperRunProof>),
      autoDecision,
    );
    expect(answer).toContain('NO CODE CHANGED — no development was completed.');
    expect(answer).toContain('STATUS:\nNOT_COMPLETED');
    expect(answer).toContain('completion verdict: NOT_COMPLETED');
    expect(answer).not.toContain('STATUS:\nBLOCKED');
  });

  test('deploy-only redeploy with no code change for a CODE_FIX -> DEPLOYED_ONLY / NOT_COMPLETED', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({
        changedFiles: [],
        patchProposal: { status: 'not_needed', operations: [], diffPreview: '' },
        gitDeployOperator: {
          status: 'executed',
          github: { commitAttempted: false, commitSha: 'headsha123', branch: 'main' },
          render: { deployAttempted: true, deployId: 'dep_123', deployStatus: 'live', error: null },
          reason: 'Deploy-only: no code change was required; production redeployed.',
        },
      } as unknown as Partial<IVXSeniorDeveloperRunProof>),
      autoDecision,
    );
    expect(answer).toContain('NO CODE CHANGED — no development was completed.');
    expect(answer).toContain('STATUS:\nDEPLOYED_ONLY');
    expect(answer).toContain('- $ render deploy -> exit 0 (live dep_123)');
    expect(answer).toContain('deploy-only from commit: headsha123 (main)');
    expect(answer).toContain('completion verdict: DEPLOYED_ONLY');
    expect(answer).not.toMatch(/STATUS:\nDEPLOYED(?:\n| )/);
  });

  test('deploy-only redeploy with no code change for a DEPLOYMENT task -> VERIFIED', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({
        goal: 'redeploy the production service now',
        changedFiles: [],
        patchProposal: { status: 'not_needed', operations: [], diffPreview: '' },
        gitDeployOperator: {
          status: 'executed',
          github: { commitAttempted: false, commitSha: 'headsha123', branch: 'main' },
          render: { deployAttempted: true, deployId: 'dep_123', deployStatus: 'live', error: null },
          reason: 'Deploy-only: no code change was required; production redeployed.',
        },
      } as unknown as Partial<IVXSeniorDeveloperRunProof>),
      autoDecision,
    );
    expect(answer).toContain('STATUS:\nVERIFIED');
    expect(answer).toContain('- $ render deploy -> exit 0 (live dep_123)');
  });

  test('patch blocked -> BLOCKED status', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({ changedFiles: [], patchProposal: { status: 'blocked', operations: [], diffPreview: 'cannot write' } } as unknown as Partial<IVXSeniorDeveloperRunProof>),
      autoDecision,
    );
    expect(answer).toContain('STATUS:\nBLOCKED');
    expect(answer).toContain('BLOCKED — I do not have code write access.');
  });

  test('no tests run -> NOT VERIFIED', () => {
    const answer = buildSeniorDeveloperExecutionAnswer(
      makeProof({ validations: [] } as unknown as Partial<IVXSeniorDeveloperRunProof>),
      autoDecision,
    );
    expect(answer).toContain('NOT VERIFIED — tests were not run.');
  });

  test('guarded action requiring approval -> BLOCKED with confirmation request', () => {
    const guardedDecision: IVXOwnerExecutionDecision = {
      ...autoDecision,
      autoExecute: false,
      requiresApproval: true,
      approvalCategories: ['delete_data'],
      systemMode: false,
    };
    const answer = buildSeniorDeveloperExecutionAnswer(makeProof(), guardedDecision);
    expect(answer).toContain('STATUS:\nBLOCKED');
    expect(answer).toContain('requires owner confirmation before execution');
  });
});
