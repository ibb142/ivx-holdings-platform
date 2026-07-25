/**
 * IVX Chat — Unified 5-Branch Intent Router.
 *
 * Single source of truth for classifying an inbound chat message into exactly
 * one of the five execution branches the IVX Chat → Intent Router diagram
 * defines:
 *
 *   1. general_ai          — generic conversational / informational answer
 *   2. developer_executor  — code/deploy/fix/audit → Senior Developer runtime
 *   3. owner_actions       — sign-in, sign-out, owner-gated tool actions
 *   4. autonomous_jobs     — daily improvement, opportunity scan, best-investor
 *   5. business_modules    — deal review, landing inspection, live grounding,
 *                            supabase inspection, owner-room data
 *
 * Why this exists: the Owner AI path (`/api/ivx/owner-ai`) routed via a long
 * chain of independent `if` blocks spread across an 8000-line file, and the
 * public chat path (`/public/chat`) had NO intent router at all — every
 * message went straight to a generic LLM call with no developer executor,
 * business module, or autonomous-job routing. This module gives both paths a
 * single deterministic classifier so routing is auditable and identical.
 *
 * Pure — no I/O, no AI, fully unit-testable. The caller is responsible for
 * executing the branch; this module only decides which branch runs.
 */

import {
  asksForBestOpportunity,
  asksForBugReview,
  asksForCodeRetrieval,
  asksForDealReview,
  asksToFindBestInvestor,
  asksToGenerate3DModel,
  asksToImproveIVXToday,
  buildIVXOwnerAIPlannerDecision,
  demandsExecutionProofNotNarrative,
  isOwnerExecutionOrTaskBlock,
  isRemovalExecutionPrompt,
  resolveLandingInspectionIntent,
  resolveLiveGroundingIntent,
  resolveMediaAnalysisIntent,
  resolveMultimodalRouting,
  resolveOwnerLocationClarificationIntent,
  shouldUseCurrentTimeTool,
  targetsOwnSystemBuild,
  type MultimodalRoutingKind,
} from './ivx-owner-ai-intent-router';

/**
 * Local manual-answer detector (mirrors the private helper in
 * `ivx-owner-ai.ts`). Returns true when the owner EXPLICITLY opts out of tools
 * ("no tools", "manual answer", "plain text", etc.). Kept local to avoid a
 * circular import with the 8000-line owner-ai API file.
 */
function hasManualAnswerDirective(value: string): boolean {
  const text = normalize(value);
  if (!text) return false;
  return /\b(no\s+tools?|without\s+tools?|manual\s+answer|answer\s+manually|plain\s+text|do\s+not\s+(?:use\s+tools?|inspect)|don'?t\s+(?:use\s+tools?|inspect)|dont\s+(?:use\s+tools?|inspect))\b/.test(text)
    || /\b(no|without|skip)\s+(?:supabase\s+)?schema\s+inspection\b/.test(text)
    || /\bno\s+unrelated\s+audits?\b/.test(text)
    || /\bproduction[-\s]?runtime\s+test\s+only\b/.test(text);
}

/**
 * Local owner-backend-command detector (mirrors the private helper in
 * `ivx-owner-ai.ts`). Detects the documented `/time-now`, `/supabase-tables`,
 * etc. slash-command prefixes. Returns the command slug or null.
 */
const OWNER_BACKEND_COMMAND_SLUGS: readonly string[] = [
  '/time-now',
  '/room-status',
  '/supabase-tables',
  '/storage-diagnostics',
  '/knowledge-reindex',
  '/inbox-diagnostics',
  '/create-record',
  '/update-record',
  '/delete-record',
  '/run-query',
  '/upload-file',
  '/read-file',
];
function resolveOwnerBackendCommandLocal(prompt: string): string | null {
  const normalized = prompt.trim().toLowerCase();
  const firstToken = normalized.split(/\s+/)[0] ?? '';
  if (OWNER_BACKEND_COMMAND_SLUGS.includes(firstToken)) {
    return firstToken;
  }
  if (shouldUseCurrentTimeTool(prompt)) {
    return '/time-now';
  }
  return null;
}

/** The five execution branches. Exactly one is selected per message. */
export type IVXChatBranch =
  | 'general_ai'
  | 'developer_executor'
  | 'owner_actions'
  | 'autonomous_jobs'
  | 'business_modules';

export type IVXChatIntent =
  // general_ai
  | 'normal_question'
  | 'long_structured_response'
  | 'multi_step_task'
  | 'app_build_planning'
  | 'media_analysis'
  | 'location_clarification'
  | 'time_query'
  // developer_executor
  | 'self_developer_execution'
  | 'removal_execution'
  | 'demands_execution_proof'
  | 'code_retrieval'
  | 'bug_review'
  | 'media_generation_3d'
  // owner_actions
  | 'owner_sign_in'
  | 'owner_sign_out'
  | 'owner_backend_command'
  | 'manual_answer'
  | 'supabase_owner_action'
  | 'supabase_inspection'
  | 'owner_room_data'
  // autonomous_jobs
  | 'daily_self_improvement'
  | 'opportunity_scan'
  | 'best_investor_workflow'
  // business_modules
  | 'deal_review'
  | 'landing_inspection'
  | 'live_project_state';

export type IVXChatRouteDecision = {
  branch: IVXChatBranch;
  intent: IVXChatIntent;
  /** True when the branch requires a verified owner session before executing. */
  requiresOwnerSession: boolean;
  /** True when the branch is allowed to execute real side effects (deploy, mutate). */
  mayExecuteSideEffects: boolean;
  /** Optional hint for the executor (e.g. tool name, command slug). */
  hint: string | null;
  /** Human-readable reason for the routing decision (for audit logs). */
  reason: string;
  /** Original planner decision, preserved for downstream token-budget / gating logic. */
  planner: ReturnType<typeof buildIVXOwnerAIPlannerDecision>;
  /** Multimodal routing decision when image attachments are present. */
  multimodal: MultimodalRoutingKind | null;
};

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

const OWNER_SIGN_IN_PATTERNS: RegExp[] = [
  /\bsign\s+in\b/i,
  /\blog\s+in\b/i,
  /\blogin\b/i,
  /\bowner\s+login\b/i,
  /\bauthenticate\b/i,
  /\bstart\s+(?:an\s+)?owner\s+session\b/i,
];

const OWNER_SIGN_OUT_PATTERNS: RegExp[] = [
  /\bsign\s+out\b/i,
  /\blog\s+out\b/i,
  /\blogout\b/i,
  /\bend\s+(?:the\s+)?owner\s+session\b/i,
  /\bclear\s+(?:my\s+|the\s+)?session\b/i,
];

const OWNER_ACTION_KEYWORDS: RegExp[] = [
  /\bsupabase\s+(?:owner\s+)?action\b/i,
  /\brun\s+(?:an\s+)?owner\s+(?:approved\s+)?action\b/i,
  /\bowner\s+approved\b/i,
  /\bowner\s+command\b/i,
];

/** Detects an owner sign-in / sign-out request. */
export function resolveOwnerAuthActionIntent(prompt: string): 'owner_sign_in' | 'owner_sign_out' | null {
  const text = normalize(prompt);
  if (!text) return null;
  // Sign-out must be checked before sign-in because "sign out" contains "sign".
  if (OWNER_SIGN_OUT_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'owner_sign_out';
  }
  if (OWNER_SIGN_IN_PATTERNS.some((pattern) => pattern.test(text))) {
    return 'owner_sign_in';
  }
  return null;
}

/** Detects a generic owner-action / owner-command request (not sign-in/out). */
function isOwnerActionRequest(normalized: string): boolean {
  return OWNER_ACTION_KEYWORDS.some((pattern) => pattern.test(normalized));
}

/**
 * Classify a chat message into exactly one of the five execution branches.
 *
 * Order matters: clarification/short-circuit intents first, then auth actions,
 * then autonomous jobs, then developer execution, then business modules, then
 * the general-AI fallthrough. The first matching branch wins.
 *
 * @param prompt The owner/user prompt text.
 * @param hasImageAttachments True when one or more image attachments accompany the message.
 */
export function routeIVXChatIntent(
  prompt: string,
  hasImageAttachments: boolean = false,
): IVXChatRouteDecision {
  const normalized = normalize(prompt);
  const planner = buildIVXOwnerAIPlannerDecision(prompt);
  const multimodal = resolveMultimodalRouting(prompt, hasImageAttachments);

  // ── 1. Short-circuit clarifications (never hijack longer commands) ───────
  const locationIntent = resolveOwnerLocationClarificationIntent(prompt);
  if (locationIntent && !isOwnerExecutionOrTaskBlock(prompt)) {
    return {
      branch: 'general_ai',
      intent: 'location_clarification',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: locationIntent,
      reason: 'Short location clarification; no execution branch.',
      planner,
      multimodal,
    };
  }

  if (shouldUseCurrentTimeTool(prompt) && !isOwnerExecutionOrTaskBlock(prompt)) {
    return {
      branch: 'general_ai',
      intent: 'time_query',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: 'get_current_time',
      reason: 'Time/date query answered by the time tool.',
      planner,
      multimodal,
    };
  }

  // ── 2. Owner Actions (auth + owner-gated commands) ──────────────────────
  const authIntent = resolveOwnerAuthActionIntent(prompt);
  if (authIntent) {
    return {
      branch: 'owner_actions',
      intent: authIntent,
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: authIntent,
      reason: authIntent === 'owner_sign_in'
        ? 'Owner requested sign-in. Route to Owner Login.'
        : 'Owner requested sign-out. Route to the session-clear flow.',
      planner,
      multimodal,
    };
  }

  const ownerBackendCommand = isOwnerExecutionOrTaskBlock(prompt) ? null : resolveOwnerBackendCommandLocal(prompt);
  if (ownerBackendCommand) {
    return {
      branch: 'owner_actions',
      intent: 'owner_backend_command',
      requiresOwnerSession: true,
      mayExecuteSideEffects: true,
      hint: ownerBackendCommand,
      reason: `Owner backend command "${ownerBackendCommand}" routed to the owner-only tool executor.`,
      planner,
      multimodal,
    };
  }

  const manualAnswerDirective = isOwnerExecutionOrTaskBlock(prompt) ? false : hasManualAnswerDirective(prompt);
  if (manualAnswerDirective) {
    return {
      branch: 'owner_actions',
      intent: 'manual_answer',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: 'manual_answer',
      reason: 'Owner explicitly requested manual/plain-text answer (no tools).',
      planner,
      multimodal,
    };
  }

  if (isOwnerActionRequest(normalized) && !isOwnerExecutionOrTaskBlock(prompt)) {
    return {
      branch: 'owner_actions',
      intent: 'supabase_owner_action',
      requiresOwnerSession: true,
      mayExecuteSideEffects: true,
      hint: 'supabase_owner_action',
      reason: 'Owner requested a Supabase owner action; requires owner approval.',
      planner,
      multimodal,
    };
  }

  // ── 3. Autonomous Jobs (durable background tasks) ───────────────────────
  if (asksToImproveIVXToday(prompt)) {
    return {
      branch: 'autonomous_jobs',
      intent: 'daily_self_improvement',
      requiresOwnerSession: true,
      mayExecuteSideEffects: true,
      hint: 'run_ivx_daily_improvement',
      reason: 'Owner issued the daily self-improvement command. Start the autonomous loop.',
      planner,
      multimodal,
    };
  }

  if (asksForBestOpportunity(prompt)) {
    return {
      branch: 'autonomous_jobs',
      intent: 'opportunity_scan',
      requiresOwnerSession: true,
      mayExecuteSideEffects: false,
      hint: 'opportunity_intelligence',
      reason: 'Owner asked for today\'s best opportunity. Run the opportunity scan engine.',
      planner,
      multimodal,
    };
  }

  if (asksToFindBestInvestor(prompt)) {
    return {
      branch: 'autonomous_jobs',
      intent: 'best_investor_workflow',
      requiresOwnerSession: true,
      mayExecuteSideEffects: false,
      hint: 'find_best_investor',
      reason: 'Owner asked to find the best investor for a deal. Run the best-investor workflow.',
      planner,
      multimodal,
    };
  }

  // ── 4. Developer Executor (code/deploy/fix/audit) ───────────────────────
  // Image-first: when an image is attached with an implementation verb, the
  // image is analyzed first and THEN the developer executor runs.
  const isDeveloperExecution =
    planner.route === 'self_developer'
    || isOwnerExecutionOrTaskBlock(prompt)
    || targetsOwnSystemBuild(normalized)
    || isRemovalExecutionPrompt(normalized)
    || demandsExecutionProofNotNarrative(normalized);

  if (isDeveloperExecution && !asksForDealReview(normalized)) {
    return {
      branch: 'developer_executor',
      intent: 'self_developer_execution',
      requiresOwnerSession: true,
      mayExecuteSideEffects: true,
      hint: 'run_ivx_senior_developer_task',
      reason: 'Owner issued a build/fix/deploy/audit command targeting this system. Route to the Senior Developer Executor.',
      planner,
      multimodal,
    };
  }

  if (asksForCodeRetrieval(normalized) && !isOwnerExecutionOrTaskBlock(prompt)) {
    return {
      branch: 'developer_executor',
      intent: 'code_retrieval',
      requiresOwnerSession: true,
      mayExecuteSideEffects: false,
      hint: 'search_code',
      reason: 'Owner asked to see real source code. Run a live repo code search.',
      planner,
      multimodal,
    };
  }

  if (asksForBugReview(normalized)) {
    return {
      branch: 'developer_executor',
      intent: 'bug_review',
      requiresOwnerSession: true,
      mayExecuteSideEffects: false,
      hint: 'code_or_logs',
      reason: 'Owner asked for a bug review. Ground in live code/log context.',
      planner,
      multimodal,
    };
  }

  if (asksToGenerate3DModel(normalized) && !isOwnerExecutionOrTaskBlock(prompt)) {
    return {
      branch: 'developer_executor',
      intent: 'media_generation_3d',
      requiresOwnerSession: true,
      mayExecuteSideEffects: false,
      hint: 'generate_3d_model',
      reason: 'Owner asked to generate a 3D model. Run the owner 3D generation tool.',
      planner,
      multimodal,
    };
  }

  // ── 5. Business Modules (deal/landing/grounding/data) ───────────────────
  if (asksForDealReview(normalized)) {
    return {
      branch: 'business_modules',
      intent: 'deal_review',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: 'deal_intelligence',
      reason: 'Owner asked for a deal review. Route to the deal-intelligence business module.',
      planner,
      multimodal,
    };
  }

  if (resolveLandingInspectionIntent(prompt)) {
    return {
      branch: 'business_modules',
      intent: 'landing_inspection',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: 'inspect_landing_page',
      reason: 'Owner asked about the live landing page / projects. Inspect the live site.',
      planner,
      multimodal,
    };
  }

  const liveGroundingIntent = resolveLiveGroundingIntent(prompt);
  if (liveGroundingIntent && liveGroundingIntent !== 'time') {
    return {
      branch: 'business_modules',
      intent: 'live_project_state',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: 'live_project_state',
      reason: 'Owner asked for current IVX project/app state. Ground in live runtime context.',
      planner,
      multimodal,
    };
  }

  // ── 6. General AI (fallthrough) ─────────────────────────────────────────
  // Long structured responses / multi-step plans / normal questions all land here.
  const mediaIntent = resolveMediaAnalysisIntent(prompt);
  if (mediaIntent) {
    return {
      branch: 'general_ai',
      intent: 'media_analysis',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: mediaIntent,
      reason: 'Owner asked the AI to analyze an attached image/video.',
      planner,
      multimodal,
    };
  }

  if (planner.semanticIntent === 'app_build_planning') {
    return {
      branch: 'general_ai',
      intent: 'app_build_planning',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: 'app_planning_mode',
      reason: 'Owner asked to build a new external app. Enter product-engineering planning mode.',
      planner,
      multimodal,
    };
  }

  if (planner.requiresLongResponse) {
    return {
      branch: 'general_ai',
      intent: 'long_structured_response',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: null,
      reason: 'Owner requested a long structured answer; route to GPT conversation.',
      planner,
      multimodal,
    };
  }

  if (planner.requiresTaskDecomposition) {
    return {
      branch: 'general_ai',
      intent: 'multi_step_task',
      requiresOwnerSession: false,
      mayExecuteSideEffects: false,
      hint: null,
      reason: 'Owner requested multi-step task decomposition; route to GPT conversation.',
      planner,
      multimodal,
    };
  }

  return {
    branch: 'general_ai',
    intent: 'normal_question',
    requiresOwnerSession: false,
    mayExecuteSideEffects: false,
    hint: null,
    reason: 'Default path: normal question answered by GPT conversation.',
    planner,
    multimodal,
  };
}

/** Human-readable branch label for logs / diagnostics. */
export function branchLabel(branch: IVXChatBranch): string {
  switch (branch) {
    case 'general_ai': return 'General AI';
    case 'developer_executor': return 'Developer Executor';
    case 'owner_actions': return 'Owner Actions';
    case 'autonomous_jobs': return 'Autonomous Jobs';
    case 'business_modules': return 'Business Modules';
  }
}