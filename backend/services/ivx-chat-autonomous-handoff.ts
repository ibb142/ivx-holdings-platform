/**
 * IVX Chat -> Autonomous Developer Handoff
 * Owner execution commands route to the real Senior Developer Worker.
 */
import { classifyOwnerExecutionCommand, type IVXOwnerExecutionDecision } from './ivx-owner-execution-mode';
import {
  enqueueOrAttachSeniorDeveloperJob,
  getSeniorDeveloperJob,
  type IVXWorkerJob,
  type IVXWorkerJobInput,
  type IVXWorkerJobStage,
  type IVXWorkerJobStatus,
} from './ivx-senior-developer-worker';
import { recordOwnerAuthorization, isOwnerAuthorized, getOwnerAuthorization } from './ivx-owner-authorization-store';

const BUILD_INTENT_PATTERNS: RegExp[] = [
  /\bbuild (?:an? )?(?:new )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration)\b/i,
  /\bcreate (?:an? )?(?:new )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration|function)\b/i,
  /\b(?:add|implement) (?:an? |the |this |that |new )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration|function)\b/i,
  /\bmodify (?:the )?code\b/i,
  /\bchange (?:the )?code\b/i,
  /\bedit (?:the )?(?:code|file|files)\b/i,
  /\bwrite (?:the )?code\b/i,
  /\brefactor\b/i,
  /\bfix (?:the |this |a |an )?(?:bug|issue|error|crash|defect|regression|code|app|module|screen|page)\b/i,
  /\b(?:bug ?fix|hotfix)\b/i,
  /\b(?:patch|repair) (?:the |this )?(?:bug|issue|error|crash|code|feature|app|module|screen|page)\b/i,
  /\brun (?:the )?senior developer\b/i,
  /\bstart (?:a |the )?(?:module|app|feature) from scratch\b/i,
  /\bdeploy (?:this|it|to production|the app|the build)\b/i,
  /\bship (?:this|it|to production)\b/i,
  /\bcomplete (?:this |the )?(?:coding |development )?task\b/i,
  /\baudit (?:the )?(?:codebase|code|source|repo|repository|files|backend|frontend)\b/i,
  /\binspect (?:the )?(?:codebase|code|source|repo|repository|files)\b/i,
];

const CONVERSATION_OVERRIDE: RegExp[] = [
  /\bwhat (?:is|are|was|were|do|does|did|can|could|should|would)\b/i,
  /\bexplain\b/i,
  /\bhow (?:do|does|did|can|could|would|to)\b/i,
  /\bwhy\b/i,
  /\btell me about\b/i,
  /\bdescribe\b/i,
  /\brecommend\b/i,
  /\bsuggest\b/i,
  /\bwhat (?:architecture|design|approach|pattern)\b/i,
  /\bwhat.*your name\b/i,
  /\bwho (?:are|is) you\b/i,
];

export type AutonomousExecutionIntent = {
  isExecutionCommand: boolean;
  requiresApproval: boolean;
  approvalCategories: string[];
  autoExecute: boolean;
  matchedBuildIntent: boolean;
  matchedTrigger: string[];
  reason: string;
  executionMode: 'read_only' | 'code_change' | 'deploy';
  templateMode: string;
};

function noExecution(reason: string): AutonomousExecutionIntent {
  return { isExecutionCommand: false, requiresApproval: false, approvalCategories: [], autoExecute: false, matchedBuildIntent: false, matchedTrigger: [], reason, executionMode: 'read_only', templateMode: 'NEW_FEATURE' };
}

export function detectAutonomousExecutionIntent(message: string): AutonomousExecutionIntent {
  const trimmed = message.trim();
  if (!trimmed) return noExecution('Empty message.');

  const decision: IVXOwnerExecutionDecision = classifyOwnerExecutionCommand(trimmed);
  const matchedBuildIntent = BUILD_INTENT_PATTERNS.some((pattern) => pattern.test(trimmed));
  const explicitExecution = decision.isOwnerExecutionCommand || matchedBuildIntent;

  // Explicit mutation/execution always wins over conversational wording.
  // "Explain why this crashes and fix it" must execute, while pure questions stay chat-only.
  if (!explicitExecution && CONVERSATION_OVERRIDE.some((pattern) => pattern.test(trimmed))) {
    return noExecution('Conversational question - stays in LLM chat.');
  }
  if (!explicitExecution) return noExecution('Not an execution command - normal chat.');

  const lowerMsg = trimmed.toLowerCase();
  let executionMode: 'read_only' | 'code_change' | 'deploy' = 'code_change';
  if (/\bdeploy\b|\bship\b|\bto production\b|\bto live\b/i.test(lowerMsg)) {
    executionMode = 'deploy';
  } else if (/\baudit\b|\binspect\b|\breview\b|\bdiagnos/i.test(lowerMsg)
    && !/\bfix\b|\brepair\b|\bpatch\b|\bimplement\b|\bmodify\b|\bchange\b|\bedit\b|\bdeploy\b|\bship\b/i.test(lowerMsg)) {
    executionMode = 'read_only';
  }

  let templateMode = 'NEW_FEATURE';
  if (/\bfix\b|\bbug\b|\brepair\b|\bcrash\b|\bregression\b/i.test(lowerMsg)) templateMode = 'BUG_FIX';
  else if (/\brefactor\b/i.test(lowerMsg)) templateMode = 'REFACTOR';
  else if (/\bapp\b/i.test(lowerMsg) && /\bfrom scratch\b/i.test(lowerMsg)) templateMode = 'NEW_APP_FROM_SCRATCH';
  else if (/\bmodule\b/i.test(lowerMsg) && /\bfrom scratch\b/i.test(lowerMsg)) templateMode = 'NEW_MODULE_FROM_SCRATCH';

  return { isExecutionCommand: true, requiresApproval: decision.requiresApproval, approvalCategories: decision.approvalCategories, autoExecute: decision.autoExecute, matchedBuildIntent, matchedTrigger: decision.matchedTriggers, reason: decision.reason, executionMode, templateMode };
}

export type AutonomousHandoffResult = {
  ok: boolean;
  jobId: string | null;
  status: IVXWorkerJobStatus | null;
  stage: IVXWorkerJobStage | null;
  progressPercent: number | null;
  attached: boolean;
  error: string | null;
  intent: AutonomousExecutionIntent;
};

export async function createAutonomousJobFromChat(message: string, ownerId: string, conversationId: string | null): Promise<AutonomousHandoffResult> {
  const intent = detectAutonomousExecutionIntent(message);
  if (!intent.isExecutionCommand) return { ok: false, jobId: null, status: null, stage: null, progressPercent: null, attached: false, error: 'Not an execution command.', intent };

  const alreadyAuthorized = isOwnerAuthorized(ownerId, message);
  if (intent.requiresApproval && !alreadyAuthorized) {
    return { ok: false, jobId: null, status: null, stage: null, progressPercent: null, attached: false, error: `Owner approval required for: ${intent.approvalCategories.join(', ')}. Reply with /confirm to approve.`, intent };
  }

  if (!alreadyAuthorized && !intent.requiresApproval) {
    recordOwnerAuthorization({ taskId: `chat-${Date.now()}`, ownerId, goal: message.trim(), approvalPhrase: 'auto_execute_safe_scope' });
  } else if (alreadyAuthorized) {
    const existingAuth = getOwnerAuthorization(ownerId, message);
    console.log(`[IVXChatHandoff] authorization_reused: taskId=${existingAuth?.taskId} owner=${ownerId}`);
  }

  const jobInput: IVXWorkerJobInput = {
    goal: message.trim(), ownerApproved: true, approvePatch: true,
    approveGitDeploy: intent.executionMode === 'deploy', validationMode: 'focused', systemMode: true,
    ownerApprovedAction: null, ownerId, conversationId, executionMode: intent.executionMode,
  };

  try {
    const result = await enqueueOrAttachSeniorDeveloperJob(jobInput);
    const job = result.job;
    return { ok: true, jobId: job.jobId, status: job.status, stage: job.stage, progressPercent: job.progressPercent, attached: result.attached, error: null, intent };
  } catch (error) {
    return { ok: false, jobId: null, status: null, stage: null, progressPercent: null, attached: false, error: error instanceof Error ? error.message : 'Failed to create autonomous job.', intent };
  }
}

export async function getAutonomousJobStatus(jobId: string): Promise<IVXWorkerJob | null> {
  try { return await getSeniorDeveloperJob(jobId); } catch { return null; }
}

export function formatAutonomousTaskSsePayload(result: AutonomousHandoffResult): Record<string, unknown> {
  return { type: 'response.autonomous_task', ok: result.ok, jobId: result.jobId, status: result.status, stage: result.stage, progressPercent: result.progressPercent, attached: result.attached, error: result.error, intent: { isExecutionCommand: result.intent.isExecutionCommand, requiresApproval: result.intent.requiresApproval, approvalCategories: result.intent.approvalCategories, autoExecute: result.intent.autoExecute, executionMode: result.intent.executionMode, templateMode: result.intent.templateMode } };
}

export function formatAutonomousTaskMessage(result: AutonomousHandoffResult): string {
  if (!result.ok) {
    if (result.intent.requiresApproval) return ['AUTONOMOUS TASK: APPROVAL REQUIRED', `Task: ${result.intent.reason}`, `Approval categories: ${result.intent.approvalCategories.join(', ')}`, '', 'Reply with /confirm to approve and start the real autonomous job.', 'The job will execute through the real Senior Developer Worker pipeline:', 'inspect -> patch -> test -> commit -> push -> deploy -> verify'].join('\n');
    return `AUTONOMOUS TASK: BLOCKED\nReason: ${result.error}`;
  }
  const lines = ['AUTONOMOUS TASK CREATED', `JOB_ID: ${result.jobId}`, `STATUS: ${result.status}`, `STAGE: ${result.stage}`, `PROGRESS: ${result.progressPercent}%`];
  if (result.attached) lines.push('NOTE: Attached to an existing active job for this owner.');
  lines.push('', 'The Senior Developer Worker is now executing this task.', 'Real progress will be tracked from the worker queue.', `Poll: GET /api/ivx/senior-developer/worker/jobs/${result.jobId}`);
  return lines.join('\n');
}

export function formatJobStatusMessage(job: IVXWorkerJob): string {
  const lines = [`JOB_ID: ${job.jobId}`, `STATUS: ${job.status}`, `STAGE: ${job.stage}`, `PROGRESS: ${job.progressPercent}%`];
  if (job.stageDetail) lines.push(`DETAIL: ${job.stageDetail}`);
  if (job.result) {
    const r = job.result;
    lines.push('', '--- RESULT ---', `COMMIT_SHA: ${r.commitSha ?? 'none'}`, `DEPLOY_ID: ${r.deployId ?? 'none'}`, `HEALTH_STATUS: ${r.healthStatus ?? 'none'}`, `TESTS: ${r.testsRun ? (r.testsPassed ? 'passed' : 'failed') : 'not run'}`, `FILES_CHANGED: ${r.changedFiles.length > 0 ? r.changedFiles.join(', ') : 'none'}`, `FINAL_STATUS: ${r.finalStatus}`);
  }
  if (job.error) lines.push(`ERROR: ${job.error}`);
  return lines.join('\n');
}
