/**
 * IVX Completion Validator
 *
 * Prevents false completion claims by comparing user-requested outcomes
 * against actual execution evidence.
 *
 * Pure — no I/O, no AI, fully unit-testable.
 */

export const IVX_COMPLETION_VALIDATOR_MARKER =
  'ivx-completion-validator-2026-08-22-fail-closed';

export type IVXTaskType =
  | 'CODE_FIX'
  | 'UI_FIX'
  | 'FEATURE'
  | 'DEPLOYMENT'
  | 'INVESTIGATION'
  | 'QA_ONLY'
  | 'CONFIGURATION_FIX'
  | 'INFRASTRUCTURE_FIX';

export type IVXCompletionEvidence = {
  taskType: string;
  requestedOutcome: string;
  acceptanceCriteria: string[];
  state: string;
  previousVerdict: string | null;
  filesChanged: string[];
  testsPassed: boolean;
  testsRun: boolean;
  typecheckPassed: boolean;
  typecheckRun: boolean;
  buildPassed: boolean;
  buildRun: boolean;
  commitSha: string | null;
  deployId: string | null;
  productionHealthOk: boolean;
  commitMatch: boolean;
  featureVerificationOk: boolean | null;
  error: string | null;
  startedAt: string;
  completedAt: string;
  verifiedAt: string | null;
};

export type IVXCompletionValidatorInput = {
  userRequest: string;
  acceptanceCriteria: string[];
  taskType: string;
  filesChanged: string[];
  testsRun: boolean;
  testsPassed: boolean;
  testNames: string[];
  commitSha: string | null;
  deployId: string | null;
  healthOk: boolean;
  featureVerificationOk: boolean | null;
  productionCommitMatches: boolean;
  taskStartedAt: number;
  earliestEvidenceAt: number | null;
  reusedEvidence: boolean;
  deviceQAPerformed: boolean;
  requestedBehaviorTested: boolean;
};

export type IVXValidationVerdict =
  | 'VERIFIED'
  | 'DEPLOYED_ONLY'
  | 'HEALTH_ONLY'
  | 'NOT_COMPLETED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'FAILED'
  | 'NO_CHANGE_REQUIRED';

export type IVXCompletionValidatorResult = {
  verdict: IVXValidationVerdict;
  ok: boolean;
  state: string;
  reasons: string[];
  remainingWork: string[];
};

export function classifyTaskType(prompt: string): IVXTaskType {
  const lower = prompt.toLowerCase();
  const requestsImplementation = /\b(fix|repair|resolve|patch|change|update|add|create|build|implement)\b/.test(lower);
  const requestsFix = /\b(fix|repair|resolve|patch)\b/.test(lower);
  if (lower.includes('redeploy') || (lower.includes('deploy') && !requestsImplementation)) return 'DEPLOYMENT';
  if (lower.includes('audit') || lower.includes('inspect') || lower.includes('report only') || lower.includes('explain')) return 'INVESTIGATION';
  if (requestsImplementation) {
    if (lower.includes('chat') || lower.includes('scroll') || lower.includes('keyboard') || lower.includes('loading') || lower.includes('ui')) return 'UI_FIX';
    if (requestsFix) return 'CODE_FIX';
    if (lower.includes('add') || lower.includes('create') || lower.includes('build') || lower.includes('implement')) return 'FEATURE';
    return 'CODE_FIX';
  }
  if (lower.includes('qa') || lower.includes('verify') || lower.includes('test the')) return 'QA_ONLY';
  if (lower.includes('chat') || lower.includes('scroll') || lower.includes('keyboard') || lower.includes('loading') || lower.includes('ui')) return 'UI_FIX';
  return 'CODE_FIX';
}

export function renderValidatorVerdict(verdict: string): string {
  return verdict;
}

export function renderValidatorReason(verdict: string, reasons: string[]): string {
  if (verdict === 'DEPLOYED_ONLY') {
    return `A redeploy occurred but the fix was NOT implemented. Reasons: ${reasons.join('; ')}.`;
  }
  if (verdict === 'NOT_COMPLETED') {
    return `The task was NOT completed. Reasons: ${reasons.join('; ')}.`;
  }
  if (verdict === 'PARTIAL') {
    return `The task is partially complete. Reasons: ${reasons.join('; ')}.`;
  }
  return `Verdict: ${verdict}. Reasons: ${reasons.join('; ')}.`;
}

function fail(reason: string, remaining: string): IVXCompletionValidatorResult {
  return {
    verdict: 'NOT_COMPLETED',
    ok: false,
    state: 'NOT_COMPLETED',
    reasons: [reason],
    remainingWork: [remaining],
  };
}

/**
 * Fail-closed completion contract for IVX development work.
 * A code task is VERIFIED only when the evidence proves the complete chain:
 * code changed -> tests -> typecheck -> commit -> deploy -> production health
 * -> exact production commit parity -> requested behavior verification (when
 * a behavior verifier has supplied a value).
 */
export function validateCompletion(
  input: IVXCompletionEvidence,
): IVXCompletionValidatorResult {
  const reasons: string[] = [];
  const remainingWork: string[] = [];

  const isCodeTask =
    input.taskType === 'CODE_FIX' ||
    input.taskType === 'FEATURE' ||
    input.taskType === 'UI_FIX';

  if (input.error) {
    return {
      verdict: 'FAILED', ok: false, state: 'FAILED',
      reasons: [`Execution recorded an error: ${input.error}`],
      remainingWork: ['Resolve the execution error and rerun the task from a clean evidence chain.'],
    };
  }

  if (input.previousVerdict === 'VERIFIED' && input.featureVerificationOk === false) {
    reasons.push('Previous VERIFIED claim lacked feature verification — cannot re-verify without it.');
    remainingWork.push('Perform feature verification on the requested behavior.');
  }

  if (isCodeTask) {
    if (input.filesChanged.length === 0) {
      if (input.deployId) {
        reasons.push('Development task requested but no code changed — this is a redeploy, not a fix.');
        remainingWork.push('Make the requested code change before deploying.');
        return { verdict: 'DEPLOYED_ONLY', ok: false, state: 'DEPLOYED', reasons, remainingWork };
      }
      return {
        verdict: 'NOT_COMPLETED', ok: false, state: 'NO_CHANGE_REQUIRED',
        reasons: ['No code was changed and no deployment occurred.'],
        remainingWork: ['Perform the requested development work.'],
      };
    }

    if (!input.testsRun) return fail('Tests were not run for a code task.', 'Run the relevant regression tests.');
    if (!input.testsPassed) return fail('Tests failed for a code task.', 'Fix the failing tests and rerun them.');

    if (!input.typecheckRun) return fail('Typecheck was not run for a code task.', 'Run TypeScript typecheck for the changed code.');
    if (!input.typecheckPassed) return fail('Typecheck failed for a code task.', 'Resolve the type errors and rerun typecheck.');

    if (!input.commitSha) return fail('Code changed and passed local validation but no commit SHA exists.', 'Create a traceable commit before claiming completion.');

    if (!input.deployId) return fail('Code was changed and committed but not deployed.', 'Deploy the merged change and capture the deployment ID.');

    if (!input.productionHealthOk) {
      return {
        verdict: 'PARTIAL', ok: false, state: 'PARTIAL',
        reasons: ['Code changed and deployed but production health is not confirmed.'],
        remainingWork: ['Verify production /health successfully.'],
      };
    }

    if (!input.commitMatch) {
      return fail(
        'Production commit does not exactly match the certified code commit.',
        'Wait for or redeploy the exact certified SHA, then verify /version parity.',
      );
    }

    if (input.featureVerificationOk === false) {
      return fail(
        'The requested behavior failed production feature verification.',
        'Fix the behavior and rerun the end-to-end verification.',
      );
    }

    if (reasons.length > 0) {
      return { verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED', reasons, remainingWork };
    }

    return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
  }

  if (input.taskType === 'DEPLOYMENT') {
    if (!input.deployId) return fail('Deployment task has no deployment ID.', 'Trigger the deployment and capture its deployment ID.');
    if (!input.productionHealthOk) return fail('Deployment is not production-healthy.', 'Verify production /health.');
    if (!input.commitMatch) return fail('Deployment SHA does not match the expected commit.', 'Verify exact /version SHA parity.');
    return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
  }

  if (input.taskType === 'INVESTIGATION') {
    return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
  }

  if (input.taskType === 'QA_ONLY') {
    if (input.testsRun && input.testsPassed) {
      return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
    }
    return fail('QA tests not run or not passing.', 'Run the QA tests and preserve the evidence.');
  }

  if (
    input.filesChanged.length > 0 &&
    input.commitSha &&
    input.deployId &&
    input.productionHealthOk &&
    input.commitMatch
  ) {
    return { verdict: 'VERIFIED', ok: true, state: 'VERIFIED', reasons: [], remainingWork: [] };
  }

  return {
    verdict: 'NOT_COMPLETED', ok: false, state: 'NOT_COMPLETED',
    reasons: ['Task not completed.'],
    remainingWork: ['Perform the requested work and provide complete execution evidence.'],
  };
}

export function buildNotCompletedMessage(
  result: IVXCompletionValidatorResult,
): string {
  const lines: string[] = [];
  lines.push(`STATUS: NOT COMPLETED`);
  lines.push('');
  lines.push('REASONS:');
  for (const reason of result.reasons) lines.push(` - ${reason}`);
  lines.push('');
  lines.push('REMAINING WORK:');
  for (const work of result.remainingWork) lines.push(` - ${work}`);
  return lines.join('\n');
}
