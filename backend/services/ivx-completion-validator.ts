/**
 * IVX Completion Validator
 *
 * Prevents false completion claims by comparing user-requested outcomes
 * against actual execution evidence. The validator rejects VERIFIED
 * when:
 *   - The requested outcome was not tested
 *   - The diff is empty for a code task
 *   - Tests are unrelated to the defect
 *   - Only /health was checked
 *   - Only a deployment occurred
 *   - The production commit does not contain the change
 *   - The same old evidence is reused for a new task
 *   - Evidence timestamps predate the task
 *   - A job claims success with no measurable output
 *
 * Pure — no I/O, no AI, fully unit-testable.
 */

export const IVX_COMPLETION_VALIDATOR_MARKER =
  'ivx-completion-validator-2026-07-22';

export type IVXValidationVerdict =
  | 'VERIFIED'
  | 'DEPLOYED_ONLY'
  | 'HEALTH_ONLY'
  | 'NOT_COMPLETED'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'FAILED'
  | 'NO_CHANGE';

export type IVXCompletionValidatorInput = {
  /** The user's original request text. */
  userRequest: string;
  /** Acceptance criteria the owner defined (if any). */
  acceptanceCriteria: string[];
  /** Task type from the classifier. */
  taskType: string;
  /** Whether any files were changed. */
  filesChanged: string[];
  /** Whether tests were run and what the result was. */
  testsRun: boolean;
  testsPassed: boolean;
  testNames: string[];
  /** Whether a commit was created. */
  commitSha: string | null;
  /** Whether a deployment occurred. */
  deployId: string | null;
  /** Whether /health was checked and returned 200. */
  healthOk: boolean;
  /** Whether feature-specific verification was performed. */
  featureVerificationOk: boolean | null;
  /** Whether the production commit contains the change. */
  productionCommitMatches: boolean;
  /** Timestamp when the task started. */
  taskStartedAt: number;
  /** Timestamp of the earliest evidence (commit, test, deploy). */
  earliestEvidenceAt: number | null;
  /** Whether any prior task used the same commit + deployId. */
  reusedEvidence: boolean;
  /** Whether device/browser QA was performed. */
  deviceQAPerformed: boolean;
  /** Whether the requested behavior was explicitly tested. */
  requestedBehaviorTested: boolean;
};

export type IVXCompletionValidatorResult = {
  verdict: IVXValidationVerdict;
  ok: boolean;
  reasons: string[];
  remainingWork: string[];
};

/**
 * Validate whether a task can honestly claim completion.
 * This is the final gate before IVX can announce success.
 */
export function validateCompletion(
  input: IVXCompletionValidatorInput,
): IVXCompletionValidatorResult {
  const reasons: string[] = [];
  const remainingWork: string[] = [];

  const isCodeTask =
    input.taskType === 'CODE_FIX' ||
    input.taskType === 'FEATURE' ||
    input.taskType === 'UI_FIX';

  const isConfigTask =
    input.taskType === 'CONFIGURATION_FIX' ||
    input.taskType === 'INFRASTRUCTURE_FIX';

  // Rule 1: A code task with an empty diff cannot be VERIFIED.
  if (isCodeTask && input.filesChanged.length === 0) {
    reasons.push(
      'The code diff is empty for a code task — no development occurred.',
    );
    remainingWork.push('Inspect the actual code, identify the root cause, and modify the correct files.');
  }

  // Rule 2: Only /health was checked — cannot be VERIFIED from health alone.
  if (input.healthOk && !input.featureVerificationOk && input.filesChanged.length === 0) {
    reasons.push(
      'Only /health was checked — infrastructure health passed but feature verification was not performed.',
    );
    remainingWork.push('Test the exact requested behavior in production, not just /health.');
  }

  // Rule 3: Only a deployment occurred with no code change.
  if (input.deployId && input.filesChanged.length === 0 && !input.featureVerificationOk) {
    reasons.push(
      'Only a deployment occurred with no code change — this is a redeploy, not a fix.',
    );
    remainingWork.push('Make the requested code change before deploying.');
  }

  // Rule 4: Tests are unrelated to the defect.
  if (input.testsRun && input.testsPassed && !input.requestedBehaviorTested) {
    reasons.push(
      'Tests passed but were not related to the requested defect — test the actual requested behavior.',
    );
    remainingWork.push('Write or run a test that verifies the specific requested behavior.');
  }

  // Rule 5: The production commit does not contain the change.
  if (input.commitSha && !input.productionCommitMatches) {
    reasons.push(
      'The production commit does not contain the change — the deployed code does not match.',
    );
    remainingWork.push('Deploy the exact commit that contains the fix.');
  }

  // Rule 6: The same old evidence is reused for a new task.
  if (input.reusedEvidence) {
    reasons.push(
      'The same commit and deployment ID were reused from a prior task — this is not new work.',
    );
    remainingWork.push('Create a new commit with the requested change and deploy it.');
  }

  // Rule 7: Evidence timestamps predate the task.
  if (
    input.earliestEvidenceAt !== null &&
    input.earliestEvidenceAt < input.taskStartedAt
  ) {
    reasons.push(
      'Evidence timestamps predate the task — the evidence is from prior work, not this task.',
    );
    remainingWork.push('Generate fresh evidence (commit, tests, deploy) after the task started.');
  }

  // Rule 8: A job claims success with no measurable output.
  if (
    !input.commitSha &&
    !input.deployId &&
    !input.testsRun &&
    input.filesChanged.length === 0
  ) {
    reasons.push(
      'A job claims success with no measurable output — no commit, no deploy, no tests, no files changed.',
    );
    remainingWork.push('Perform the requested work and generate evidence.');
  }

  // Rule 9: Code task without device QA.
  if (isCodeTask && input.filesChanged.length > 0 && !input.deviceQAPerformed) {
    reasons.push(
      'Device or browser QA was not performed for a UI/code task.',
    );
    remainingWork.push('Test the change on the required platform (Android, iOS, or web).');
  }

  // Rule 10: Feature verification not performed for code tasks with changes.
  if (
    isCodeTask &&
    input.filesChanged.length > 0 &&
    input.featureVerificationOk === null
  ) {
    reasons.push(
      'Feature verification was not performed — cannot claim VERIFIED without it.',
    );
    remainingWork.push('Verify the requested behavior in production after deployment.');
  }

  // Determine verdict
  if (reasons.length === 0) {
    // All checks passed
    if (input.featureVerificationOk === true && input.productionCommitMatches) {
      return {
        verdict: 'VERIFIED',
        ok: true,
        reasons: [],
        remainingWork: [],
      };
    }
    if (input.deployId && input.filesChanged.length > 0) {
      return {
        verdict: 'PARTIAL',
        ok: false,
        reasons: ['Code changed and deployed but feature verification not confirmed.'],
        remainingWork: ['Verify the requested behavior in production.'],
      };
    }
    if (input.deployId && input.filesChanged.length === 0) {
      return {
        verdict: 'DEPLOYED_ONLY',
        ok: false,
        reasons: ['A deployment occurred but no code changed.'],
        remainingWork: ['Make the requested code change.'],
      };
    }
    if (input.healthOk && !input.deployId) {
      return {
        verdict: 'HEALTH_ONLY',
        ok: false,
        reasons: ['Only /health was checked.'],
        remainingWork: ['Perform the requested work.'],
      };
    }
    return {
      verdict: 'NOT_COMPLETED',
      ok: false,
      reasons: ['No evidence of completion.'],
      remainingWork: ['Perform the requested work.'],
    };
  }

  // If we have reasons, the task is not verified
  if (input.filesChanged.length === 0 && !input.deployId) {
    return {
      verdict: 'NOT_COMPLETED',
      ok: false,
      reasons,
      remainingWork,
    };
  }

  if (input.filesChanged.length === 0 && input.deployId) {
    return {
      verdict: 'DEPLOYED_ONLY',
      ok: false,
      reasons,
      remainingWork,
    };
  }

  if (input.filesChanged.length > 0 && !input.featureVerificationOk) {
    return {
      verdict: 'PARTIAL',
      ok: false,
      reasons,
      remainingWork,
    };
  }

  return {
    verdict: 'NOT_COMPLETED',
    ok: false,
    reasons,
    remainingWork,
  };
}

/**
 * Build the "STATUS: NOT COMPLETED" message when validation fails.
 */
export function buildNotCompletedMessage(
  result: IVXCompletionValidatorResult,
): string {
  const lines: string[] = [];
  lines.push(`STATUS: NOT COMPLETED`);
  lines.push('');
  lines.push('REASONS:');
  for (const reason of result.reasons) {
    lines.push(` - ${reason}`);
  }
  lines.push('');
  lines.push('REMAINING WORK:');
  for (const work of result.remainingWork) {
    lines.push(` - ${work}`);
  }
  return lines.join('\n');
}
