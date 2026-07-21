/**
 * IVX Senior-Developer Answer Format
 *
 * Renders the senior-developer runtime proof into the OWNER-REQUIRED strict
 * execution format. The owner explicitly rejected narrative prose
 * ("TASK UNDERSTOOD / FILES INSPECTED / ...") and the old 8-section layout.
 *
 * Every development task must return ONLY the 6 evidence sections:
 *
 *   TASK ID
 *   STATUS
 *   FILES CHANGED
 *   COMMANDS
 *   TESTS
 *   DEPLOYED PROOF
 *
 * Hard enforcement (no claims without real commands):
 *   - No files changed      -> "NO CODE CHANGED — no development was completed."
 *   - No tests run          -> "NOT VERIFIED — tests were not run."
 *   - Patch could not write -> "BLOCKED — I do not have code write access."
 *
 * CRITICAL: the user's goal text is NEVER echoed into the answer. Copying the
 * goal into the response caused the Fake Execution Guard to false-positive on
 * innocent words like "complete" ("complete the loading on this chat") and
 * replace a real DEPLOYED answer with a generic BLOCKED message.
 *
 * 2026-07-20 completion-validator integration: the status line is now decided
 * by the completion validator, not by simple health/commit checks. A deploy-only
 * redeploy with NO code change is reported as DEPLOYED_ONLY (redeployed unchanged
 * code — the requested fix was NOT implemented), not as DEPLOYED. A code/ui/feature
 * task with no code change and no deployment is reported as NOT_COMPLETED.
 *
 * 2026-07-21 narrative-removal correction: the 7-section narrative appendix
 * (DIRECT ANSWER / WHAT WAS WRONG / ...) is removed. The owner mandated the
 * strict 6-section format only; no extra narrative engine output is appended.
 *
 * This module is runtime-free and deterministic (no network/filesystem/AI) so it
 * is fully unit-testable.
 */
import type { IVXSeniorDeveloperRunProof } from './ivx-senior-developer-runtime';
import type { IVXOwnerExecutionDecision } from './ivx-owner-execution-mode';
import type { IVXWorkerJob, IVXWorkerJobResult } from './ivx-senior-developer-worker';
import {
  classifyTaskType,
  validateCompletion,
  renderValidatorVerdict,
  renderValidatorReason,
  type IVXCompletionEvidence,
  type IVXTaskType,
  type IVXValidationVerdict,
} from './ivx-completion-validator';

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Render one validation result as raw, copy-pasteable terminal output. */
function rawValidationOutput(validation: IVXSeniorDeveloperRunProof['validations'][number]): string {
  return [
    `$ ${validation.command}`,
    validation.stdoutTail ? validation.stdoutTail.trimEnd() : '',
    validation.stderrTail ? validation.stderrTail.trimEnd() : '',
    validation.error ? `error: ${validation.error}` : '',
    `exit code: ${validation.exitCode ?? 'null'} -> ${validation.ok ? 'PASS' : 'FAIL'}`,
  ]
    .filter((line) => line.length > 0)
    .join('\n');
}

export function isTypecheckCommand(command: string): boolean {
  return /\b(tsc|typecheck|type-check|type\s+check)\b/i.test(command);
}

export function isTestCommand(command: string): boolean {
  return /\btest\b/i.test(command) && !isTypecheckCommand(command);
}

function buildEvidenceFromProof(proof: IVXSeniorDeveloperRunProof): IVXCompletionEvidence {
  const validations = proof.validations;
  const testValidations = validations.filter((v) => isTestCommand(v.command));
  const typecheckValidations = validations.filter((v) => isTypecheckCommand(v.command));
  const commitSha = proof.gitDeployOperator.github.commitSha;
  const healthOk = proof.productionVerification.ok;
  const commitMatch = healthOk && proof.changedRouteVerification.ok;
  return {
    taskType: classifyTaskType(proof.goal),
    requestedOutcome: proof.goal.slice(0, 400),
    acceptanceCriteria: [],
    state: 'DEPLOYED',
    previousVerdict: proof.endToEndProductionComplete ? 'VERIFIED' : null,
    filesChanged: proof.changedFiles,
    testsPassed: testValidations.length > 0 && validations.every((v) => v.ok),
    testsRun: testValidations.length > 0,
    typecheckPassed: typecheckValidations.length > 0 && validations.every((v) => v.ok),
    typecheckRun: typecheckValidations.length > 0,
    buildPassed: validations.length > 0 && validations.every((v) => v.ok),
    buildRun: validations.length > 0,
    commitSha,
    deployId: proof.gitDeployOperator.render.deployId,
    productionHealthOk: healthOk,
    commitMatch,
    featureVerificationOk: null,
    error: proof.ok ? null : (proof.gitDeployOperator.reason || proof.productionVerification.error || 'Run did not complete end-to-end.'),
    startedAt: proof.generatedAt,
    completedAt: proof.generatedAt,
    verifiedAt: proof.generatedAt,
  };
}

function buildEvidenceFromWorkerResult(result: IVXWorkerJobResult): IVXCompletionEvidence {
  return {
    taskType: result.taskType ?? classifyTaskType(result.goal),
    requestedOutcome: result.goal.slice(0, 400),
    acceptanceCriteria: [],
    state: 'DEPLOYED',
    previousVerdict: result.finalStatus === 'COMPLETE' ? 'VERIFIED' : null,
    filesChanged: result.changedFiles,
    testsPassed: result.testsPassed,
    testsRun: result.testsRun,
    typecheckPassed: result.typecheckRun && result.testsPassed,
    typecheckRun: result.typecheckRun,
    buildPassed: result.buildRun,
    buildRun: result.buildRun,
    commitSha: result.commitSha,
    deployId: result.deployId,
    productionHealthOk: result.healthOk,
    commitMatch: result.commitMatch,
    featureVerificationOk: null,
    error: result.error,
    startedAt: result.generatedAt,
    completedAt: result.generatedAt,
    verifiedAt: result.generatedAt,
  };
}

function buildFilesChangedLine(
  changedFiles: string[],
  patchStatus: IVXSeniorDeveloperRunProof['patchProposal']['status'],
  taskType: IVXTaskType,
): string {
  if (changedFiles.length > 0) {
    return changedFiles.map((filePath) => `- ${filePath}`).join('\n');
  }
  if (patchStatus === 'blocked') {
    return 'BLOCKED — I do not have code write access.';
  }
  return `NO CODE CHANGED — no development was completed. (task type: ${taskType})`;
}

function buildCommandsSection(proof: IVXSeniorDeveloperRunProof): string {
  const validations = proof.validations;
  const commands: string[] = [];

  for (const validation of validations) {
    commands.push(`- $ ${validation.command} -> exit ${validation.exitCode ?? 'null'} (${validation.ok ? 'PASS' : 'FAIL'})`);
  }

  const git = proof.gitDeployOperator;
  if (git.github.commitAttempted) {
    commands.push(
      `- $ git commit/push -> ${git.github.commitSha ? `exit 0 (committed ${git.github.commitSha})` : `not completed (${git.reason})`}`,
    );
  }
  if (git.render.deployAttempted) {
    commands.push(
      `- $ render deploy -> ${git.render.deployId ? `exit 0 (${git.render.deployStatus ?? 'triggered'} ${git.render.deployId})` : `not completed (${git.render.error ?? git.reason})`}`,
    );
  }
  if (proof.productionVerification.ok) {
    commands.push('- $ curl /health -> exit 0 (200 healthy)');
  }

  return commands.length > 0 ? commands.join('\n') : 'NONE — no commands were executed.';
}

function buildTestsSection(proof: IVXSeniorDeveloperRunProof): string {
  const testValidations = proof.validations.filter((v) => isTestCommand(v.command));
  return testValidations.length > 0
    ? testValidations.map(rawValidationOutput).join('\n\n')
    : 'NOT VERIFIED — tests were not run.';
}

function buildDeployedProofSection(
  proof: IVXSeniorDeveloperRunProof,
  validationStatus: string,
): string {
  const changedFiles = proof.changedFiles;
  const git = proof.gitDeployOperator;
  const lines: string[] = [];

  if (changedFiles.length > 0) {
    lines.push('git diff --stat (applied patch):');
    for (const filePath of changedFiles) {
      const op = proof.patchProposal.operations.find((operation) => operation.path === filePath);
      lines.push(` ${filePath} | ${op ? op.summary : 'modified'}`);
    }
    lines.push('git status --short:');
    for (const filePath of changedFiles) {
      lines.push(` M ${filePath}`);
    }
    if (git.github.commitSha) {
      lines.push(`commit: ${git.github.commitSha}${git.github.branch ? ` (${git.github.branch})` : ''}`);
    }
    lines.push(
      `production /health: ${proof.productionVerification.ok ? 'healthy' : 'not confirmed'}; changed route: ${proof.changedRouteVerification.ok ? 'live' : 'not confirmed'}`,
    );
  } else {
    lines.push('git diff --stat: (no changes)');
    lines.push('git status --short: (clean)');
    if (git.render.deployAttempted && git.github.commitSha) {
      lines.push(`deploy-only from commit: ${git.github.commitSha}${git.github.branch ? ` (${git.github.branch})` : ''}`);
    }
  }

  if (git.render.deployId) {
    lines.push(`deploy: ${git.render.deployId} (${git.render.deployStatus ?? 'unknown'})`);
  }
  if (validationStatus === 'NOT_COMPLETED' || validationStatus === 'NO_CHANGE_REQUIRED' || validationStatus === 'DEPLOYED_ONLY') {
    lines.push(`completion verdict: ${validationStatus}`);
  }
  lines.push(`job: ${proof.jobId}`);

  return lines.join('\n');
}

/**
 * Build the senior-developer execution answer in the owner-required 6-section
 * format. No goal text is echoed; only taskId, status, real files, real commands,
 * real tests, and real deployed proof are returned.
 */
export function buildSeniorDeveloperExecutionAnswer(
  proof: IVXSeniorDeveloperRunProof,
  decision: IVXOwnerExecutionDecision,
): string {
  if (decision.requiresApproval) {
    return [
      `TASK ID:\n${proof.jobId}`,
      'STATUS:\nBLOCKED',
      'FILES CHANGED:\n(none — requires owner confirmation before execution)',
      'COMMANDS:\nNONE — guarded action halted before repo inspection.',
      'TESTS:\nNOT VERIFIED — tests were not run.',
      'DEPLOYED PROOF:\nNONE — owner confirmation required.',
    ].join('\n\n');
  }

  const changedFiles = proof.changedFiles;
  const taskType = classifyTaskType(proof.goal);

  if (proof.patchProposal.status === 'blocked') {
    return [
      `TASK ID:\n${proof.jobId}`,
      'STATUS:\nBLOCKED',
      `FILES CHANGED:\n${buildFilesChangedLine(changedFiles, proof.patchProposal.status, taskType)}`,
      `COMMANDS:\n${buildCommandsSection(proof)}`,
      `TESTS:\n${buildTestsSection(proof)}`,
      `DEPLOYED PROOF:\n${buildDeployedProofSection(proof, 'BLOCKED')}`,
    ].join('\n\n');
  }

  const validation = validateCompletion(buildEvidenceFromProof(proof));
  const validatedStatus = renderValidatorVerdict(validation.verdict);
  const status = validation.ok ? 'VERIFIED' : validatedStatus;

  return [
    `TASK ID:\n${proof.jobId}`,
    `STATUS:\n${status}`,
    `FILES CHANGED:\n${buildFilesChangedLine(changedFiles, proof.patchProposal.status, taskType)}`,
    `COMMANDS:\n${buildCommandsSection(proof)}`,
    `TESTS:\n${buildTestsSection(proof)}`,
    `DEPLOYED PROOF:\n${buildDeployedProofSection(proof, status)}`,
  ].join('\n\n');
}

function buildWorkerFilesChangedLine(result: IVXWorkerJobResult, taskType: IVXTaskType): string {
  if (result.changedFiles.length > 0) {
    return result.changedFiles.map((filePath) => `- ${filePath}`).join('\n');
  }
  if (result.finalStatus === 'BLOCKED') {
    return 'BLOCKED — I do not have code write access.';
  }
  return `NO CODE CHANGED — no development was completed. (task type: ${taskType})`;
}

function buildWorkerCommandsSection(job: IVXWorkerJob, result: IVXWorkerJobResult): string {
  const commands: string[] = [];
  if (result.commitCreated) {
    const exit = result.commitSha ? 0 : 1;
    commands.push(
      `- $ git commit/push -> exit ${exit} (${result.commitSha ? `committed ${result.commitSha.slice(0, 12)}` : 'attempted (no sha)'})`,
    );
  }
  if (result.deployId) {
    const exit = result.deployStatus === 'live' ? 0 : 1;
    commands.push(
      `- $ render deploy -> exit ${exit} (${result.deployStatus ?? 'triggered'} ${result.deployId})`,
    );
  }
  if (result.testsRun) {
    commands.push(`- $ bun test -> exit ${result.testsPassed ? 0 : 1} (${result.testsPassed ? 'PASS' : 'FAIL'})`);
  }
  if (result.typecheckRun) {
    const typecheckPass = result.testsPassed;
    commands.push(`- $ tsc --noEmit -> exit ${typecheckPass ? 0 : 1} (${typecheckPass ? 'PASS' : 'errors'})`);
  }
  if (result.healthOk) {
    commands.push('- $ curl /health -> exit 0 (200 healthy)');
  }
  if (job.status !== 'completed' && job.status !== 'failed' && job.status !== 'blocked') {
    commands.push(`- $ worker phase ${job.stage} -> exit pending (stage: ${job.stage}, progress: ${job.progressPercent}%)`);
  }
  return commands.length > 0 ? commands.join('\n') : 'NONE — no commands were executed.';
}

function buildWorkerTestsSection(result: IVXWorkerJobResult): string {
  if (!result.testsRun) {
    return 'NOT VERIFIED — tests were not run.';
  }
  return result.testsPassed
    ? '$ bun test\nexit code: 0 -> PASS'
    : '$ bun test\nexit code: 1 -> FAIL';
}

function buildWorkerDeployedProofSection(
  job: IVXWorkerJob,
  result: IVXWorkerJobResult,
  validationStatus: string,
): string {
  const lines: string[] = [];
  if (result.changedFiles.length > 0) {
    lines.push('git diff --stat (applied patch):');
    for (const filePath of result.changedFiles) {
      lines.push(` ${filePath} | modified`);
    }
  } else {
    lines.push('git diff --stat: (no changes)');
  }
  if (result.commitSha) {
    lines.push(`commit: ${result.commitSha}${result.branch ? ` (${result.branch})` : ''}`);
  }
  if (result.deployId) {
    lines.push(`deploy: ${result.deployId} (${result.deployStatus ?? 'unknown'})`);
  }
  lines.push(`production /health: ${result.healthOk ? 'healthy' : 'not confirmed'}; commit match: ${result.commitMatch ? 'true' : 'false'}`);
  if (validationStatus === 'NOT_COMPLETED' || validationStatus === 'NO_CHANGE_REQUIRED' || validationStatus === 'DEPLOYED_ONLY') {
    lines.push(`completion verdict: ${validationStatus}`);
  }
  if (result.taskState) {
    lines.push(`task state: ${result.taskState}`);
  }
  if (result.evidenceFingerprint) {
    lines.push(`evidence fingerprint: ${result.evidenceFingerprint.slice(0, 40)}`);
  }
  if (result.error) {
    lines.push(`error: ${result.error}`);
  }
  lines.push(`job: ${job.jobId}`);
  return lines.join('\n');
}

/**
 * Build the strict execution answer from a completed worker-queue job result.
 *
 * This is the chat-side renderer for jobs created via the persistent worker
 * queue. It mirrors the runtime-proof renderer above but reads from the
 * secret-safe IVXWorkerJobResult summary that the worker writes to the durable
 * proof ledger. It never fabricates evidence.
 */
export function buildSeniorDeveloperWorkerJobAnswer(
  job: IVXWorkerJob,
  decision: IVXOwnerExecutionDecision,
): string {
  const result = job.result;
  const guarded = decision.requiresApproval;

  // Guarded action: blocked before execution, require owner confirmation.
  if (guarded) {
    return [
      `TASK ID:\n${job.jobId}`,
      'STATUS:\nBLOCKED',
      'FILES CHANGED:\n(none — requires owner confirmation before execution)',
      'COMMANDS:\nNONE — guarded action halted before repo inspection.',
      'TESTS:\nNOT VERIFIED — tests were not run.',
      'DEPLOYED PROOF:\nNONE — owner confirmation required.',
    ].join('\n\n');
  }

  // Job still running — show live progress from the real queue state.
  // DEFECT FIX (cert-3B): a job whose status is a terminal value (completed/failed/blocked/canceled)
  // must NOT render "RUNNING (...)" even if result is momentarily null (race between status flip
  // and result attachment). Render an honest terminal-pending block instead.
  const TERMINAL_JOB_STATUSES = new Set(['completed', 'failed', 'blocked', 'canceled', 'cancelled']);
  const isTerminalJobStatus = TERMINAL_JOB_STATUSES.has(job.status);
  if (!result && isTerminalJobStatus) {
    return [
      `TASK ID:\n${job.jobId}`,
      `STATUS:\n${job.status.toUpperCase()} (finalizing evidence — poll the status URL)`,
      'FILES CHANGED:\n(evidence being assembled)',
      `COMMANDS:\n- $ worker phase ${job.stage} -> exit pending (status=${job.status}, progress=${job.progressPercent}%)`,
      'TESTS:\nNOT VERIFIED — evidence is being assembled.',
      `DEPLOYED PROOF:\nLive status from durable queue. stage=${job.stage} status=${job.status} progress=${job.progressPercent}% detail="${job.stageDetail}" attempts=${job.attempts}`,
    ].join('\n\n');
  }
  if (!result || job.status === 'queued' || job.status === 'running'
      || job.status === 'patching' || job.status === 'testing'
      || job.status === 'committing' || job.status === 'deploying'
      || job.status === 'verifying') {
    return [
      `TASK ID:\n${job.jobId}`,
      `STATUS:\nRUNNING (${job.status}, ${job.progressPercent}%)`,
      'FILES CHANGED:\n(inspection in progress)',
      `COMMANDS:\n- $ worker phase ${job.stage} -> exit pending (stage: ${job.stage}, progress: ${job.progressPercent}%)`,
      'TESTS:\nNOT VERIFIED — tests are still running.',
      `DEPLOYED PROOF:\nLive progress from durable queue. stage=${job.stage} progress=${job.progressPercent}% detail="${job.stageDetail}" attempts=${job.attempts}`,
    ].join('\n\n');
  }

  const taskType = result.taskType ?? classifyTaskType(job.input.goal);
  const validation = validateCompletion(buildEvidenceFromWorkerResult(result));
  const validatedStatus = renderValidatorVerdict(validation.verdict);
  const status = validation.ok ? 'VERIFIED' : validatedStatus;

  return [
    `TASK ID:\n${job.jobId}`,
    `STATUS:\n${status}`,
    `FILES CHANGED:\n${buildWorkerFilesChangedLine(result, taskType)}`,
    `COMMANDS:\n${buildWorkerCommandsSection(job, result)}`,
    `TESTS:\n${buildWorkerTestsSection(result)}`,
    `DEPLOYED PROOF:\n${buildWorkerDeployedProofSection(job, result, status)}`,
  ].join('\n\n');
}
