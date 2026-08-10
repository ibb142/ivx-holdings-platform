/**
 * IVX Chat → Autonomous Developer Handoff
 *
 * When an authenticated owner sends an execution command in IVX IA Chat
 * ("fix this bug", "deploy this", "implement this feature"), the chat backend
 * must route the request to the REAL Senior Developer Worker instead of
 * generating LLM narrative text.
 *
 * This module is the bridge: it detects execution intent, creates a real
 * worker job via enqueueOrAttachSeniorDeveloperJob, and returns the real
 * job ID + status. No LLM-generated task IDs, no simulated progress.
 *
 * Flow:
 *   owner chat message
 *   → detectAutonomousExecutionIntent(message)
 *   → createAutonomousJobFromChat(message, ownerId, conversationId)
 *   → enqueueOrAttachSeniorDeveloperJob()
 *   → real IVXWorkerJob with real jobId, status, stage
 *   → SSE response with autonomous_task event
 *
 * The chat UI then polls GET /api/ivx/senior-developer/worker/jobs/:jobId
 * for real progress — never LLM-invented status.
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

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build/development intent patterns — same set as the frontend
 * seniorDeveloperBuildIntent.ts. A match routes the message to the worker
 * instead of the conversational LLM. Patterns are deliberately flexible to
 * catch natural phrasing like "implement this API endpoint", "build a new
 * module", "audit the codebase".
 */
const BUILD_INTENT_PATTERNS: RegExp[] = [
  /\bbuild (?:an? )?(?:new )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration)\b/i,
  /\bcreate (?:an? )?(?:new )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration|function)\b/i,
  /\b(?:add|implement) (?:an? |the |this |that |new )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration|function)\b/i,
  /\bmodify (?:the )?code\b/i,
  /\bchange (?:the )?code\b/i,
  /\bedit (?:the )?(?:code|file|files)\b/i,
  /\bwrite (?:the )?code\b/i,
  /\brefactor\b/i,
  /\bfix (?:the |this |a |an )?(?:bug|issue|error|crash|defect|regression)\b/i,
  /\b(?:bug ?fix|hotfix)\b/i,
  /\b(?:patch|repair) (?:the |this )?(?:bug|issue|error|crash|code|feature|app|module)\b/i,
  /\brun (?:the )?senior developer\b/i,
  /\bstart (?:a |the )?(?:module|app|feature) from scratch\b/i,
  /\bdeploy (?:this|it|to production|the app|the build)\b/i,
  /\bship (?:this|it|to production)\b/i,
  /\bcomplete (?:this |the )?(?:coding |development )?task\b/i,
  /\baudit (?:the )?(?:codebase|code|source|repo|repository|files|backend|frontend)\b/i,
  /\binspect (?:the )?(?:codebase|code|source|repo|repository|files)\b/i,
];

/** Conversational patterns that should NOT trigger handoff. */
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
  /** Suggested worker execution mode. */
  executionMode: 'read_only' | 'code_change' | 'deploy';
  /** Suggested template mode for the worker. */
  templateMode: string;
};

/**
 * Detect whether a chat message is an autonomous execution command.
 * Combines the owner-execution-mode classifier with build-intent patterns.
 * Conversational questions are never misrouted to the worker.
 */
export function detectAutonomousExecutionIntent(message: string): AutonomousExecutionIntent {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      isExecutionCommand: false,
      requiresApproval: false,
      approvalCategories: [],
      autoExecute: false,
      matchedBuildIntent: false,
      matchedTrigger: [],
      reason: 'Empty message.',
      executionMode: 'read_only',
      templateMode: 'NEW_FEATURE',
    };
  }

  // Conversational override — questions and explanations stay in chat.
  for (const pattern of CONVERSATION_OVERRIDE) {
    if (pattern.test(trimmed)) {
      return {
        isExecutionCommand: false,
        requiresApproval: false,
        approvalCategories: [],
        autoExecute: false,
        matchedBuildIntent: false,
        matchedTrigger: [],
        reason: 'Conversational question — stays in LLM chat.',
        executionMode: 'read_only',
        templateMode: 'NEW_FEATURE',
      };
    }
  }

  // Owner execution command classification
  const decision: IVXOwnerExecutionDecision = classifyOwnerExecutionCommand(trimmed);

  // Build intent patterns
  let matchedBuildIntent = false;
  for (const pattern of BUILD_INTENT_PATTERNS) {
    if (pattern.test(trimmed)) {
      matchedBuildIntent = true;
      break;
    }
  }

  const isExecutionCommand = decision.isOwnerExecutionCommand || matchedBuildIntent;
  if (!isExecutionCommand) {
    return {
      isExecutionCommand: false,
      requiresApproval: false,
      approvalCategories: [],
      autoExecute: false,
      matchedBuildIntent: false,
      matchedTrigger: [],
      reason: 'Not an execution command — normal chat.',
      executionMode: 'read_only',
      templateMode: 'NEW_FEATURE',
    };
  }

  // Determine execution mode
  const lowerMsg = trimmed.toLowerCase();
  let executionMode: 'read_only' | 'code_change' | 'deploy' = 'code_change';
  if (/\bdeploy\b/i.test(lowerMsg) || /\bship\b/i.test(lowerMsg) || /\bto production\b/i.test(lowerMsg) || /\bto live\b/i.test(lowerMsg)) {
    executionMode = 'deploy';
  } else if (/\baudit\b/i.test(lowerMsg) || /\binspect\b/i.test(lowerMsg) || /\breview\b/i.test(lowerMsg) || /\bdiagnos/i.test(lowerMsg)) {
    executionMode = 'read_only';
  }

  // Determine template mode
  let templateMode = 'NEW_FEATURE';
  if (/\bfix\b/i.test(lowerMsg) || /\bbug\b/i.test(lowerMsg) || /\brepair\b/i.test(lowerMsg)) {
    templateMode = 'BUG_FIX';
  } else if (/\brefactor\b/i.test(lowerMsg)) {
    templateMode = 'REFACTOR';
  } else if (/\bapp\b/i.test(lowerMsg) && /\bfrom scratch\b/i.test(lowerMsg)) {
    templateMode = 'NEW_APP_FROM_SCRATCH';
  } else if (/\bmodule\b/i.test(lowerMsg) && /\bfrom scratch\b/i.test(lowerMsg)) {
    templateMode = 'NEW_MODULE_FROM_SCRATCH';
  }

  return {
    isExecutionCommand: true,
    requiresApproval: decision.requiresApproval,
    approvalCategories: decision.approvalCategories,
    autoExecute: decision.autoExecute,
    matchedBuildIntent,
    matchedTrigger: decision.matchedTriggers,
    reason: decision.reason,
    executionMode,
    templateMode,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Job creation
// ─────────────────────────────────────────────────────────────────────────────

export type AutonomousHandoffResult = {
  ok: boolean;
  jobId: string | null;
  status: IVXWorkerJobStatus | null;
  stage: IVXWorkerJobStage | null;
  progressPercent: number | null;
  attached: boolean;
  error: string | null;
  /** The intent that triggered the handoff. */
  intent: AutonomousExecutionIntent;
};

/**
 * Create a real autonomous worker job from a chat message.
 * The caller MUST have already verified owner authentication.
 *
 * For safe (auto-execute) commands, the job is created with ownerApproved=true.
 * For risky commands (requires approval), the job is NOT created — instead
 * a "requires approval" result is returned so the chat can ask the owner.
 */
export async function createAutonomousJobFromChat(
  message: string,
  ownerId: string,
  conversationId: string | null,
): Promise<AutonomousHandoffResult> {
  const intent = detectAutonomousExecutionIntent(message);

  if (!intent.isExecutionCommand) {
    return {
      ok: false,
      jobId: null,
      status: null,
      stage: null,
      progressPercent: null,
      attached: false,
      error: 'Not an execution command.',
      intent,
    };
  }

  // P0 FIX (owner mandate 2026-08-10): Authorization persistence.
  // If the owner already authorized this task scope, reuse the authorization.
  // Do NOT re-ask for the same task unless scope materially changes.
  const alreadyAuthorized = isOwnerAuthorized(ownerId, message);

  // Risky commands require explicit owner approval — but if the owner already
  // authorized the same scope, skip the approval gate and proceed.
  if (intent.requiresApproval && !alreadyAuthorized) {
    return {
      ok: false,
      jobId: null,
      status: null,
      stage: null,
      progressPercent: null,
      attached: false,
      error: `Owner approval required for: ${intent.approvalCategories.join(', ')}. Reply with /confirm to approve.`,
      intent,
    };
  }

  // Record the authorization so retries/recovery don't re-ask.
  if (!alreadyAuthorized) {
    recordOwnerAuthorization({
      taskId: `chat-${Date.now()}`,
      ownerId,
      goal: message.trim(),
      approvalPhrase: 'auto_execute',
    });
  } else {
    const existingAuth = getOwnerAuthorization(ownerId, message);
    console.log(`[IVXChatHandoff] authorization_reused: taskId=${existingAuth?.taskId} owner=${ownerId} — no re-ask for same scope`);
  }

  // Create the real worker job
  const jobInput: IVXWorkerJobInput = {
    goal: message.trim(),
    ownerApproved: true,
    approvePatch: true,
    approveGitDeploy: intent.executionMode === 'deploy',
    validationMode: 'focused',
    systemMode: true,
    ownerApprovedAction: null,
    ownerId,
    conversationId,
    executionMode: intent.executionMode,
  };

  try {
    const result = await enqueueOrAttachSeniorDeveloperJob(jobInput);
    const job = result.job;
    return {
      ok: true,
      jobId: job.jobId,
      status: job.status,
      stage: job.stage,
      progressPercent: job.progressPercent,
      attached: result.attached,
      error: null,
      intent,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Failed to create autonomous job.';
    return {
      ok: false,
      jobId: null,
      status: null,
      stage: null,
      progressPercent: null,
      attached: false,
      error: errorMsg,
      intent,
    };
  }
}

/**
 * Get the current status of an autonomous job by ID.
 * Used by the chat to poll for real progress.
 */
export async function getAutonomousJobStatus(jobId: string): Promise<IVXWorkerJob | null> {
  try {
    return await getSeniorDeveloperJob(jobId);
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE response formatting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format the autonomous task creation as an SSE-compatible payload.
 * This is sent as a `response.autonomous_task` event in the chat stream.
 */
export function formatAutonomousTaskSsePayload(result: AutonomousHandoffResult): Record<string, unknown> {
  return {
    type: 'response.autonomous_task',
    ok: result.ok,
    jobId: result.jobId,
    status: result.status,
    stage: result.stage,
    progressPercent: result.progressPercent,
    attached: result.attached,
    error: result.error,
    intent: {
      isExecutionCommand: result.intent.isExecutionCommand,
      requiresApproval: result.intent.requiresApproval,
      approvalCategories: result.intent.approvalCategories,
      autoExecute: result.intent.autoExecute,
      executionMode: result.intent.executionMode,
      templateMode: result.intent.templateMode,
    },
  };
}

/**
 * Format a human-readable summary of the autonomous task for the chat UI.
 * This is NOT LLM-generated — it is a deterministic string built from real
 * job state.
 */
export function formatAutonomousTaskMessage(result: AutonomousHandoffResult): string {
  if (!result.ok) {
    if (result.intent.requiresApproval) {
      return [
        'AUTONOMOUS TASK: APPROVAL REQUIRED',
        `Task: ${result.intent.reason}`,
        `Approval categories: ${result.intent.approvalCategories.join(', ')}`,
        '',
        'Reply with /confirm to approve and start the real autonomous job.',
        'The job will execute through the real Senior Developer Worker pipeline:',
        'inspect → patch → test → commit → push → deploy → verify',
      ].join('\n');
    }
    return `AUTONOMOUS TASK: BLOCKED\nReason: ${result.error}`;
  }

  const lines = [
    'AUTONOMOUS TASK CREATED',
    `JOB_ID: ${result.jobId}`,
    `STATUS: ${result.status}`,
    `STAGE: ${result.stage}`,
    `PROGRESS: ${result.progressPercent}%`,
  ];

  if (result.attached) {
    lines.push('NOTE: Attached to an existing active job for this owner.');
  }

  lines.push(
    '',
    'The Senior Developer Worker is now executing this task.',
    'Real progress will be tracked from the worker queue.',
    `Poll: GET /api/ivx/senior-developer/worker/jobs/${result.jobId}`,
  );

  return lines.join('\n');
}

/**
 * Format a job status update as a chat-readable message.
 * Used when polling returns an updated status.
 */
export function formatJobStatusMessage(job: IVXWorkerJob): string {
  const lines = [
    `JOB_ID: ${job.jobId}`,
    `STATUS: ${job.status}`,
    `STAGE: ${job.stage}`,
    `PROGRESS: ${job.progressPercent}%`,
  ];

  if (job.stageDetail) {
    lines.push(`DETAIL: ${job.stageDetail}`);
  }

  if (job.result) {
    const r = job.result;
    lines.push(
      '',
      '--- RESULT ---',
      `COMMIT_SHA: ${r.commitSha ?? 'none'}`,
      `DEPLOY_ID: ${r.deployId ?? 'none'}`,
      `HEALTH_STATUS: ${r.healthStatus ?? 'none'}`,
      `TESTS: ${r.testsRun ? (r.testsPassed ? 'passed' : 'failed') : 'not run'}`,
      `FILES_CHANGED: ${r.changedFiles.length > 0 ? r.changedFiles.join(', ') : 'none'}`,
      `FINAL_STATUS: ${r.finalStatus}`,
    );
  }

  if (job.error) {
    lines.push(`ERROR: ${job.error}`);
  }

  return lines.join('\n');
}
