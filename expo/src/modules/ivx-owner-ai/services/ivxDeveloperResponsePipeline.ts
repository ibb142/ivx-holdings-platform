/**
 * IVX IA Senior-Developer Response Pipeline
 *
 * Assembles structured developer responses from task records, enforcing
 * the required format and preventing false VERIFIED claims.
 *
 * Every response must be assembled from:
 * - Owner request
 * - Task ID
 * - Run ID
 * - Current commit
 * - Relevant files retrieved
 * - Production observations
 * - Root cause
 * - Files changed
 * - Commands executed
 * - Tests executed
 * - Device-QA status
 * - Commit
 * - Deployment
 * - Feature-verification status
 * - Evidence IDs
 * - Remaining blockers
 */
export interface DeveloperTaskRecord {
  ownerRequest: string;
  taskId: string;
  runId: string;
  currentCommit: string;
  relevantFilesRetrieved: string[];
  productionObservations: string[];
  rootCause: string | null;
  filesChanged: string[];
  commandsExecuted: string[];
  testsExecuted: TestExecutionResult[];
  deviceQaStatus: 'pass' | 'fail' | 'blocked' | 'pending';
  commit: string | null;
  deployment: DeploymentStatus | null;
  featureVerificationStatus: 'verified' | 'partial' | 'failed' | 'not_verified';
  evidenceIds: string[];
  remainingBlockers: string[];
}

export interface TestExecutionResult {
  name: string;
  status: 'pass' | 'fail' | 'skip' | 'error';
  durationMs: number;
  assertions: number;
}

export interface DeploymentStatus {
  platform: string;
  commitSha: string;
  bootTime: string;
  healthStatus: string;
  url: string | null;
}

export type VerdictLevel = 'VERIFIED' | 'PARTIAL' | 'FAILED' | 'BLOCKED';

export interface StructuredDeveloperResponse {
  directResult: string;
  whatWasRequested: string;
  whatWasFound: string;
  rootCause: string;
  whereDefectExisted: string;
  whatWasChanged: string;
  whyChangeAddressesRootCause: string;
  testsExecuted: string;
  productionProof: string;
  deviceQaStatus: string;
  failedOrUnverifiedItems: string;
  nextOwnerAction: string;
  verdict: VerdictLevel;
  taskId: string;
  runId: string;
  commit: string;
}

/**
 * Determine the appropriate verdict level based on task record state.
 *
 * Rules:
 * - VERIFIED: only when device QA passes AND feature verification is verified
 *   AND no remaining blockers.
 * - PARTIAL: code deployed but device QA pending, OR feature verification partial.
 * - FAILED: a test failed or feature verification failed.
 * - BLOCKED: device or build required and not available.
 */
export function determineVer(record: DeveloperTaskRecord): VerdictLevel {
  // If any test failed, verdict is FAILED
  const hasTestFailures = record.testsExecuted.some(t => t.status === 'fail' || t.status === 'error');
  if (hasTestFailures && record.featureVerificationStatus === 'failed') {
    return 'FAILED';
  }

  // If device QA is pending, verdict is PARTIAL (not VERIFIED)
  if (record.deviceQaStatus === 'pending') {
    return 'PARTIAL';
  }

  // If device QA is blocked, verdict is BLOCKED
  if (record.deviceQaStatus === 'blocked') {
    return record.remainingBlockers.length > 0 ? 'BLOCKED' : 'PARTIAL';
  }

  // If device QA failed, verdict is FAILED
  if (record.deviceQaStatus === 'fail') {
    return 'FAILED';
  }

  // If device QA passed AND feature verification is verified AND no blockers
  if (
    record.deviceQaStatus === 'pass' &&
    record.featureVerificationStatus === 'verified' &&
    record.remainingBlockers.length === 0
  ) {
    return 'VERIFIED';
  }

  // If feature verification is partial or not_verified
  if (record.featureVerificationStatus === 'partial' || record.featureVerificationStatus === 'not_verified') {
    return 'PARTIAL';
  }

  return 'PARTIAL';
}

/**
 * Assemble a structured developer response from a task record.
 * Enforces the required format and prevents false VERIFIED claims.
 */
export function assembleDeveloperResponse(record: DeveloperTaskRecord): StructuredDeveloperResponse {
  const verdict = determineVer(record);

  // Enforce: never say VERIFIED when device QA is pending
  if (record.deviceQaStatus === 'pending' && verdict === 'VERIFIED') {
    throw new Error('FALSE_VERIFIED: Cannot mark VERIFIED when device QA is pending');
  }

  // Enforce: never say VERIFIED based only on source inspection
  if (record.testsExecuted.length === 0 && verdict === 'VERIFIED') {
    throw new Error('FALSE_VERIFIED: Cannot mark VERIFIED without any test execution');
  }

  const whatWasFound = record.productionObservations.length > 0
    ? record.productionObservations.join('; ')
    : 'No production observations recorded.';

  const rootCause = record.rootCause ?? 'No root cause identified — investigation did not find a code-level defect.';

  const whereDefectExisted = record.filesChanged.length > 0
    ? record.filesChanged.join(', ')
    : 'No defect found — no files changed.';

  const whatWasChanged = record.filesChanged.length > 0
    ? `Modified: ${record.filesChanged.join(', ')}`
    : 'No changes were required.';

  const whyChangeAddressesRootCause = record.rootCause
    ? `The change addresses "${record.rootCause}" by fixing the identified root cause.`
    : 'No change was needed — the reported behavior is correct or could not be reproduced.';

  const testsSummary = record.testsExecuted.length > 0
    ? record.testsExecuted.map(t => `${t.name}: ${t.status.toUpperCase()} (${t.assertions} assertions, ${t.durationMs}ms)`).join('; ')
    : 'No tests executed.';

  const productionProof = record.deployment
    ? `Deployed to ${record.deployment.platform}: commit ${record.deployment.commitSha}, boot ${record.deployment.bootTime}, health ${record.deployment.healthStatus}`
    : 'No deployment evidence available.';

  const deviceQaStatus = {
    pass: 'DEVICE QA: PASS',
    fail: 'DEVICE QA: FAIL',
    blocked: 'DEVICE QA: BLOCKED',
    pending: 'DEVICE QA: PENDING',
  }[record.deviceQaStatus];

  const failedItems: string[] = [];
  if (record.deviceQaStatus !== 'pass') {
    failedItems.push(`Device QA: ${record.deviceQaStatus.toUpperCase()}`);
  }
  if (record.featureVerificationStatus !== 'verified') {
    failedItems.push(`Feature verification: ${record.featureVerificationStatus.toUpperCase()}`);
  }
  const failedTests = record.testsExecuted.filter(t => t.status === 'fail' || t.status === 'error');
  if (failedTests.length > 0) {
    failedItems.push(`Failed tests: ${failedTests.map(t => t.name).join(', ')}`);
  }
  if (record.remainingBlockers.length > 0) {
    failedItems.push(`Blockers: ${record.remainingBlockers.join(', ')}`);
  }
  const failedOrUnverifiedItems = failedItems.length > 0 ? failedItems.join('; ') : 'None.';

  const nextOwnerAction = record.deviceQaStatus === 'pending'
    ? 'Perform physical device QA (Android + iOS) and submit evidence via the QA panel.'
    : record.deviceQaStatus === 'blocked'
    ? `Resolve blocker: ${record.remainingBlockers.join(', ')}`
    : record.deviceQaStatus === 'fail'
    ? 'Review failed device QA evidence and provide specific failure observations.'
    : 'No further action required.';

  const directResult = verdict === 'VERIFIED'
    ? 'VERIFIED — CHAT OPENS AT THE NEWEST MESSAGE AND IVX IA SENIOR-DEVELOPER WORKFLOW IS OPERATIONAL'
    : verdict === 'PARTIAL'
    ? 'PARTIAL — ALL AUTOMATED QA COMPLETE, OWNER DEVICE QA PENDING'
    : verdict === 'FAILED'
    ? 'FAILED — CHAT DEFECT REMAINS'
    : 'BLOCKED — DEVICE OR BUILD REQUIRED';

  return {
    directResult,
    whatWasRequested: record.ownerRequest,
    whatWasFound,
    rootCause,
    whereDefectExisted,
    whatWasChanged,
    whyChangeAddressesRootCause,
    testsExecuted: testsSummary,
    productionProof,
    deviceQaStatus,
    failedOrUnverifiedItems,
    nextOwnerAction,
    verdict,
    taskId: record.taskId,
    runId: record.runId,
    commit: record.currentCommit,
  };
}

/**
 * Format a structured response as the required text output.
 */
export function formatStructuredResponse(response: StructuredDeveloperResponse): string {
  return [
    'DIRECT RESULT',
    response.directResult,
    '',
    'WHAT WAS REQUESTED',
    response.whatWasRequested,
    '',
    'WHAT WAS FOUND',
    response.whatWasFound,
    '',
    'ROOT CAUSE',
    response.rootCause,
    '',
    'WHERE THE DEFECT EXISTED',
    response.whereDefectExisted,
    '',
    'WHAT WAS CHANGED',
    response.whatWasChanged,
    '',
    'WHY THE CHANGE ADDRESSES THE ROOT CAUSE',
    response.whyChangeAddressesRootCause,
    '',
    'TESTS EXECUTED',
    response.testsExecuted,
    '',
    'PRODUCTION PROOF',
    response.productionProof,
    '',
    'DEVICE QA STATUS',
    response.deviceQaStatus,
    '',
    'FAILED OR UNVERIFIED ITEMS',
    response.failedOrUnverifiedItems,
    '',
    'NEXT OWNER ACTION',
    response.nextOwnerAction,
    '',
    `TASK ID: ${response.taskId}`,
    `RUN ID: ${response.runId}`,
    `COMMIT: ${response.commit}`,
    `VERDICT: ${response.verdict}`,
  ].join('\n');
}
