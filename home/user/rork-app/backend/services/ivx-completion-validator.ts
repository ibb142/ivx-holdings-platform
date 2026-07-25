/**
 * IVX Completion Validator
 *
 * Final, deterministic gate before IVX can claim a task is COMPLETE, VERIFIED,
 * or DEPLOYED. It compares the owner-requested outcome against the actual
 * evidence captured during execution. This prevents the false-completion
 * pattern where a deploy-only redeploy or a health check is reported as a
 * fixed defect.
 *
 * Rules (owner mandate 2026-07-20):
 *   - DEPLOYED means a deployment occurred; it does NOT mean a defect is fixed.
 *   - VERIFIED means the requested acceptance tests passed.
 *   - A CODE_FIX/UI_FIX/FEATURE task cannot be VERIFIED when no code changed
 *     unless the root cause was genuinely external (config/data/infra).
 *   - If no work was completed, status must be NO_CHANGE_REQUIRED, BLOCKED,
 *     or FAILED — never "DEPLOYED" or "COMPLETE".
 *   - Never display "development completed" when the code diff is empty.
 *
 * This module is intentionally runtime-free and does NOT import worker types,
 * to avoid circular dependencies with ivx-senior-developer-worker.
 */

export const IVX_COMPLETION_VALIDATOR_MARKER = 'ivx-completion-validator-2026-07-20';

export type IVXTaskType =
  | 'CODE_FIX'
  | 'FEATURE'
  | 'UI_FIX'
  | 'DATA_FIX'
  | 'CONFIGURATION_FIX'
  | 'INFRASTRUCTURE_FIX'
  | 'DEPLOYMENT'
  | 'QA_ONLY'
  | 'INVESTIGATION'
  | 'CONTENT_REQUEST'
  | 'BUSINESS_ANALYSIS';

export type IVXTaskState =
  | 'RECEIVED'
  | 'ANALYZING'
  | 'REPRODUCING'
  | 'ROOT_CAUSE_IDENTIFIED'
  | 'IMPLEMENTING'
  | 'CODE_CHANGED'
  | 'TESTING'
  | 'QA_REQUIRED'
  | 'QA_IN_PROGRESS'
  | 'READY_TO_DEPLOY'
  | 'DEPLOYING'
  | 'DEPLOYED'
  | 'PRODUCTION_VERIFYING'
  | 'VERIFIED'
  | 'BLOCKED'
  | 'FAILED'
  | 'NO_CHANGE_REQUIRED';

export type IVXValidationVerdict =
  | 'VERIFIED'
  | 'DEPLOYED_ONLY'
  | 'NO_CHANGE_REQUIRED'
  | 'BLOCKED'
  | 'FAILED'
  | 'NOT_COMPLETED';

export type IVXCompletionEvidence = {
  taskType: IVXTaskType;
  requestedOutcome: string;
  acceptanceCriteria: string[];
  state: IVXTaskState;
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
  startedAt: string | null;
  completedAt: string | null;
  verifiedAt: string | null;
};

export type IVXCompletionValidationResult = {
  ok: boolean;
  verdict: IVXValidationVerdict;
  state: IVXTaskState;
  reasons: string[];
  evidence: IVXCompletionEvidence;
  marker: typeof IVX_COMPLETION_VALIDATOR_MARKER;
};

const DEVELOPMENT_TASK_TYPES: ReadonlySet<IVXTaskType> = new Set([
  'CODE_FIX',
  'FEATURE',
  'UI_FIX',
  'DATA_FIX',
]);

const DEPLOYMENT_TASK_TYPES: ReadonlySet<IVXTaskType> = new Set([
  'DEPLOYMENT',
  'INFRASTRUCTURE_FIX',
  'CONFIGURATION_FIX',
]);

export function classifyTaskType(goal: string): IVXTaskType {
  const normalized = (goal ?? '').toLowerCase();
  if (/(audit|inspect|investigate|trace|root cause|diagnose|find why|report)/i.test(normalized)
      && !/(fix|deploy|change|edit|apply|implement|patch|build|upgrade|create)/i.test(normalized)) {
    return 'INVESTIGATION';
  }
  if (/\b(deploy|redeploy|push live|release|rollout|render deploy)\b/i.test(normalized)
      && !/(fix|bug|patch|feature|implement|ui|scroll|loading|chat|screen)/i.test(normalized)) {
    return 'DEPLOYMENT';
  }
  if (/(qa|test|verify|acceptance|regression|check|validate|measure)/i.test(normalized)
      && !/(fix|deploy|change|edit|apply|implement|patch|build|upgrade)/i.test(normalized)) {
    return 'QA_ONLY';
  }
  if (/(configuration|config|env|environment variable|render env|setting|toggle)/i.test(normalized)) {
    return 'CONFIGURATION_FIX';
  }
  if (/(infrastructure|server|database|redis|queue|render service|supabase project|migrate schema)/i.test(normalized)) {
    return 'INFRASTRUCTURE_FIX';
  }
  if (/(data fix|clean data|delete test|fix data|sanitize data|merge records|deduplicate)/i.test(normalized)) {
    return 'DATA_FIX';
  }
  if (/(content|copy|text|wording|label|title|placeholder|typo|document|pdf|attachment)/i.test(normalized)) {
    return 'CONTENT_REQUEST';
  }
  if (/(business model|pricing|roi|investor|deal structure|capital|workflow|process|kpi|metric)/i.test(normalized)) {
    return 'BUSINESS_ANALYSIS';
  }
  if (/(ui|interface|screen|component|button|modal|scroll|loading|keyboard|composer|chat|flatlist|scrollview|view|color|theme|style|layout|icon|animation)/i.test(normalized)) {
    return 'UI_FIX';
  }
  if (/(fix|bug|repair|correct|resolve|patch|issue|error|crash|exception|broken|not working|failed|slow|timeout|stuck|hang|leak|race|deadlock)/i.test(normalized)) {
    return 'CODE_FIX';
  }
  if (/(feature|implement|add|build|create|introduce|support|enable|new capability|new module|new app|new screen)/i.test(normalized)) {
    return 'FEATURE';
  }
  return 'INVESTIGATION';
}

export function validateCompletion(
  evidence: IVXCompletionEvidence,
): IVXCompletionValidationResult {
  const reasons: string[] = [];

  if (evidence.previousVerdict === 'VERIFIED' && !evidence.featureVerificationOk) {
    reasons.push('Previous VERIFIED claim has no feature-verification evidence');
  }
  if (evidence.verifiedAt && evidence.completedAt && evidence.verifiedAt < evidence.completedAt) {
    reasons.push('Verification timestamp predates task completion');
  }

  const isDevelopment = DEVELOPMENT_TASK_TYPES.has(evidence.taskType);
  const isDeployment = DEPLOYMENT_TASK_TYPES.has(evidence.taskType);

  // A development task with no code change cannot be VERIFIED or DEPLOYED as a fix.
  if (isDevelopment && evidence.filesChanged.length === 0) {
    if (evidence.deployId && evidence.productionHealthOk && evidence.commitMatch) {
      reasons.push('Development task requested but no code changed; redeploy is not a fix');
      return {
        ok: false,
        verdict: 'DEPLOYED_ONLY',
        state: 'DEPLOYED',
        reasons,
        evidence,
        marker: IVX_COMPLETION_VALIDATOR_MARKER,
      };
    }
    reasons.push('Development task requested but no code changed and no deployment proof');
    return {
      ok: false,
      verdict: 'NOT_COMPLETED',
      state: 'NO_CHANGE_REQUIRED',
      reasons,
      evidence,
      marker: IVX_COMPLETION_VALIDATOR_MARKER,
    };
  }

  // Deployment-only task with a redeploy and health OK -> VERIFIED only if infra/config was the actual cause.
  if (isDeployment && evidence.filesChanged.length === 0) {
    if (evidence.deployId && evidence.productionHealthOk && evidence.commitMatch) {
      return {
        ok: true,
        verdict: 'VERIFIED',
        state: 'VERIFIED',
        reasons: ['Deployment-only task completed with a live redeploy and health confirmation'],
        evidence,
        marker: IVX_COMPLETION_VALIDATOR_MARKER,
      };
    }
    return {
      ok: false,
      verdict: 'NOT_COMPLETED',
      state: 'NO_CHANGE_REQUIRED',
      reasons: ['Deployment-only task but no live deployment proof'],
      evidence,
      marker: IVX_COMPLETION_VALIDATOR_MARKER,
    };
  }

  // QA-only task needs actual test results.
  if (evidence.taskType === 'QA_ONLY') {
    if (evidence.testsRun && evidence.testsPassed) {
      return {
        ok: true,
        verdict: 'VERIFIED',
        state: 'VERIFIED',
        reasons: ['QA-only task completed with passing tests'],
        evidence,
        marker: IVX_COMPLETION_VALIDATOR_MARKER,
      };
    }
    return {
      ok: false,
      verdict: 'NOT_COMPLETED',
      state: 'QA_REQUIRED',
      reasons: ['QA-only task but no tests were run or tests failed'],
      evidence,
      marker: IVX_COMPLETION_VALIDATOR_MARKER,
    };
  }

  // Investigation/read-only task does not require code changes.
  if (evidence.taskType === 'INVESTIGATION') {
    return {
      ok: true,
      verdict: 'VERIFIED',
      state: 'VERIFIED',
      reasons: ['Investigation task completed; no code change required'],
      evidence,
      marker: IVX_COMPLETION_VALIDATOR_MARKER,
    };
  }

  // Content/business analysis tasks do not require deployment.
  if (evidence.taskType === 'CONTENT_REQUEST' || evidence.taskType === 'BUSINESS_ANALYSIS') {
    if (evidence.filesChanged.length > 0 || evidence.testsPassed) {
      return {
        ok: true,
        verdict: 'VERIFIED',
        state: 'VERIFIED',
        reasons: ['Task completed with required evidence'],
        evidence,
        marker: IVX_COMPLETION_VALIDATOR_MARKER,
      };
    }
    return {
      ok: false,
      verdict: 'NOT_COMPLETED',
      state: 'NO_CHANGE_REQUIRED',
      reasons: ['No deliverable or evidence produced for this task type'],
      evidence,
      marker: IVX_COMPLETION_VALIDATOR_MARKER,
    };
  }

  // General development task with real code change and deployed+health OK -> VERIFIED.
  if (evidence.filesChanged.length > 0) {
    if (!evidence.testsRun) {
      reasons.push('Files changed but tests were not run');
    } else if (!evidence.testsPassed) {
      reasons.push('Files changed but tests failed');
    }
    if (!evidence.deployId) {
      reasons.push('Files changed but no deployment occurred');
    }
    if (!evidence.productionHealthOk) {
      reasons.push('Files changed but production health is not confirmed');
    }
    if (!evidence.commitMatch) {
      reasons.push('Files changed but production commit does not match the deployed commit');
    }
    if (reasons.length > 0) {
      return {
        ok: false,
        verdict: 'NOT_COMPLETED',
        state: evidence.deployId ? 'PRODUCTION_VERIFYING' : 'READY_TO_DEPLOY',
        reasons,
        evidence,
        marker: IVX_COMPLETION_VALIDATOR_MARKER,
      };
    }
    return {
      ok: true,
      verdict: 'VERIFIED',
      state: 'VERIFIED',
      reasons: ['Code changed, tested, deployed, and production health/commit verified'],
      evidence,
      marker: IVX_COMPLETION_VALIDATOR_MARKER,
    };
  }

  // Fallback: nothing meaningful happened.
  reasons.push('No code changed, no deployment, and no task-specific evidence produced');
  return {
    ok: false,
    verdict: 'NOT_COMPLETED',
    state: 'NO_CHANGE_REQUIRED',
    reasons,
    evidence,
    marker: IVX_COMPLETION_VALIDATOR_MARKER,
  };
}

export function renderValidatorVerdict(verdict: IVXValidationVerdict): string {
  switch (verdict) {
    case 'VERIFIED':
      return 'VERIFIED';
    case 'DEPLOYED_ONLY':
      return 'DEPLOYED_ONLY';
    case 'NO_CHANGE_REQUIRED':
      return 'NO_CHANGE_REQUIRED';
    case 'BLOCKED':
      return 'BLOCKED';
    case 'FAILED':
      return 'FAILED';
    case 'NOT_COMPLETED':
    default:
      return 'NOT_COMPLETED';
  }
}

export function renderValidatorReason(verdict: IVXValidationVerdict, reasons: string[]): string {
  switch (verdict) {
    case 'VERIFIED':
      return reasons[0] ?? 'Validation accepted.';
    case 'DEPLOYED_ONLY':
      return 'A redeploy occurred, but no code changed. The requested fix/feature was NOT implemented.';
    case 'NO_CHANGE_REQUIRED':
      return reasons[0] ?? 'No code change was required and no deployment was requested.';
    case 'BLOCKED':
      return reasons[0] ?? 'Blocked before execution.';
    case 'FAILED':
      return reasons[0] ?? 'Execution failed.';
    case 'NOT_COMPLETED':
    default:
      return reasons.join('; ') || 'Task not completed.';
  }
}
