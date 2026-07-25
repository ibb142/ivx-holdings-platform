/**
 * IVX Owner Intent Classifier — 5-class request routing.
 *
 * PROBLEM (owner directive 2026-07-25): the owner asked "Audit the loading
 * problem on this chat, explain what is wrong, what must be fixed, and deploy
 * it." This is a DIAGNOSTIC request, but the old `isSeniorDeveloperBuildRequest`
 * matcher caught the word "deploy it" and misrouted the entire message to the
 * Senior Developer Worker — which returned task-progress percentages (RUNNING
 * 10%, COMMITTING 65%) instead of a diagnosis.
 *
 * This classifier runs BEFORE the build-intent check and separates:
 *
 *   A. DIAGNOSTIC  — "audit", "why is X failing", "diagnose", "explain what is wrong"
 *   B. CODE_CHANGE — "fix the bug", "change the code", "add a feature"
 *   C. DEPLOYMENT  — "deploy this", "ship to production", "push to main"
 *   D. STATUS      — "what is the task status", "show me the progress"
 *   E. EXPLANATION — "explain the architecture", "how does X work"
 *
 * Diagnostic, status, and explanation requests must NEVER be routed to the
 * worker. Only explicit code-change and deployment requests (without a
 * diagnostic lead) trigger the worker flow.
 *
 * Pure + deterministic (no I/O, no AI) so it is fully unit-testable.
 */

export type OwnerIntentClass =
  | 'diagnostic'
  | 'code_change'
  | 'deployment'
  | 'status'
  | 'explanation';

export type OwnerIntentClassification = {
  intent: OwnerIntentClass;
  /** True when this message should route to the Senior Developer Worker. */
  routesToWorker: boolean;
  /** True when this message is a diagnostic request that needs a real analysis. */
  isDiagnostic: boolean;
  /** The specific subject/module the diagnostic targets (e.g. "chat loading"). */
  diagnosticSubject: string | null;
  /** Brief reason for the classification (for audit logging). */
  reason: string;
};

/**
 * Diagnostic lead patterns. When a message BEGINS with or is structured as a
 * diagnostic request, it is classified as DIAGNOSTIC regardless of whether it
 * also mentions "deploy" or "fix" later. The diagnostic intent takes priority.
 *
 * Matches:
 *   - "Audit the loading problem on this chat"
 *   - "Why is member registration failing?"
 *   - "Diagnose the chat cold-start issue"
 *   - "Explain what is wrong with the chat"
 *   - "What is broken in the reels screen"
 *   - "Audit chat loading and deploy it" (diagnostic with deploy suffix)
 */
const DIAGNOSTIC_LEAD_PATTERNS: RegExp[] = [
  /\b(?:audit|diagnose|investigate|analyze|analyse)\b/i,
  /\bwhy\s+(?:is|are|does|do|can|cannot|can't|won't|doesn't|don't|did|didn't|has|have|hasn't|haven't)\b/i,
  /\bwhat\s+(?:is|are)\s+(?:wrong|broken|failing|the\s+problem|the\s+issue|the\s+cause)\b/i,
  /\bexplain\s+what\s+is\s+wrong\b/i,
  /\b(?:find|identify)\s+the\s+(?:root\s+cause|problem|issue|failure)\b/i,
  /\breproduce\s+the\s+(?:failure|bug|issue|error)\b/i,
  /\bloading\s+problem\b/i,
  /\bcold[-\s]?start\s+(?:problem|issue|failure)\b/i,
];

/**
 * Status request patterns. These return task/progress status, not diagnosis.
 */
const STATUS_PATTERNS: RegExp[] = [
  /\b(?:what\s+is|show\s+me|give\s+me)\s+(?:the\s+)?(?:task\s+)?status\b/i,
  /\b(?:task|job|worker)\s+status\b/i,
  /\bwhat\s+(?:is|are)\s+(?:the\s+)?(?:progress|results?|findings?)\b/i,
  /\bshow\s+(?:me\s+)?(?:the\s+)?(?:progress|status|results?)\b/i,
  /\bwhat\s+(?:is|'s|is)\s+happening\b/i,
  /\b(?:is|are)\s+(?:it|the\s+(?:task|job|worker|deploy))\s+(?:still\s+)?(?:running|done|complete|finished)\b/i,
];

/**
 * Explanation request patterns. These ask for architectural understanding,
 * not a diagnosis or code change.
 */
const EXPLANATION_PATTERNS: RegExp[] = [
  /\bexplain\s+(?:the\s+)?(?:architecture|design|system|how|what)\b/i,
  /\bhow\s+does\s+.+\bwork\b/i,
  /\bdescribe\s+(?:the\s+)?(?:architecture|system|design|structure)\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\b(?:what\s+is|tell\s+me\s+about)\s+(?:the\s+)?(?:architecture|design|system|stack)\b/i,
];

/**
 * Deployment request patterns — explicit deploy/ship/push without a diagnostic lead.
 */
const DEPLOYMENT_PATTERNS: RegExp[] = [
  /\bdeploy\s+(?:this|it|the\s+app|the\s+build|to\s+production|now)\b/i,
  /\bship\s+(?:this|it|to\s+production)\b/i,
  /\bpush\s+to\s+(?:production|github|main)\b/i,
  /\bgo\s+live\b/i,
  /\brelease\s+(?:this|it|the\s+app|to\s+production)\b/i,
];

/**
 * Code-change request patterns — explicit code modification without a
 * diagnostic lead. These are imperative build/fix/change instructions.
 */
const CODE_CHANGE_PATTERNS: RegExp[] = [
  /\bfix\s+(?:the\s+)?(?:bug|issue|error|crash|defect)\b/i,
  /\b(?:bug\s*fix|hotfix)\b/i,
  /\bpatch\s+(?:the\s+)?(?:bug|code|file|issue)\b/i,
  /\brepair\s+(?:the\s+)?(?:bug|code|issue)\b/i,
  /\bbuild\s+(?:an?\s+)?(?:(?:new|complete|full|whole)\s+)?(?:app|module|feature|endpoint|screen|page|service|api|component)\b/i,
  /\bcreate\s+(?:an?\s+)?(?:(?:new|complete|full|whole)\s+)?(?:app|module|feature|endpoint|screen|page|service|api|component|function)\b/i,
  /\b(?:add|implement)\s+(?:an?\s+)?(?:(?:new|complete|full|whole)\s+)?(?:feature|endpoint|screen|page|service|api|component|function)\b/i,
  /\bmodify\s+(?:the\s+)?code\b/i,
  /\bchange\s+(?:the\s+)?code\b/i,
  /\brefactor\b/i,
  /\brewrite\b/i,
];

/**
 * Extract the diagnostic subject from the message (e.g. "chat loading" from
 * "Audit the loading problem on this chat").
 */
function extractDiagnosticSubject(message: string): string | null {
  const text = message.trim();

  // "chat loading" / "loading problem on this chat"
  const chatLoadingMatch = text.match(/\b(chat\s+)?(?:loading|cold[-\s]?start|startup)\s+(?:problem|issue|failure|error|slow|delay)\b/i);
  if (chatLoadingMatch) {
    return 'chat loading';
  }

  // "chat" generically
  if (/\bchat\b/i.test(text) && /\b(?:loading|cold|startup|render|blank|frozen|spinner|stuck)\b/i.test(text)) {
    return 'chat loading';
  }

  // "member registration"
  const registrationMatch = text.match(/\b(member\s+)?registration\s+(?:failing|broken|error|problem)\b/i);
  if (registrationMatch) {
    return 'member registration';
  }

  // "reels crashing"
  const reelsMatch = text.match(/\breels?\s+(?:crashing|broken|failing|error|problem)\b/i);
  if (reelsMatch) {
    return 'reels';
  }

  // Generic "X is failing/broken"
  const genericMatch = text.match(/\b(\w+(?:\s+\w+)?)\s+(?:is\s+)?(?:failing|broken|crashing|not\s+working|erroring)\b/i);
  if (genericMatch) {
    return genericMatch[1].toLowerCase();
  }

  return null;
}

/**
 * Classify an owner chat message into one of 5 intent classes.
 *
 * Priority order:
 *   1. DIAGNOSTIC — if the message has a diagnostic lead, it is diagnostic
 *      regardless of trailing "deploy" or "fix" words.
 *   2. STATUS — task/progress status requests.
 *   3. EXPLANATION — architecture/design questions.
 *   4. DEPLOYMENT — explicit deploy/ship without diagnostic lead.
 *   5. CODE_CHANGE — explicit fix/build/change without diagnostic lead.
 *
 * Only DEPLOYMENT and CODE_CHANGE route to the worker.
 */
export function classifyOwnerIntent(message: string): OwnerIntentClassification {
  const text = message.trim();
  if (text.length === 0) {
    return {
      intent: 'explanation',
      routesToWorker: false,
      isDiagnostic: false,
      diagnosticSubject: null,
      reason: 'empty message — defaulting to explanation',
    };
  }

  // 1. DIAGNOSTIC — highest priority, takes precedence over deploy/fix
  if (DIAGNOSTIC_LEAD_PATTERNS.some((pattern) => pattern.test(text))) {
    const subject = extractDiagnosticSubject(text);
    return {
      intent: 'diagnostic',
      routesToWorker: false,
      isDiagnostic: true,
      diagnosticSubject: subject,
      reason: `diagnostic lead detected${subject ? ` (subject: ${subject})` : ''}`,
    };
  }

  // 2. STATUS
  if (STATUS_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      intent: 'status',
      routesToWorker: false,
      isDiagnostic: false,
      diagnosticSubject: null,
      reason: 'status request detected',
    };
  }

  // 3. EXPLANATION
  if (EXPLANATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      intent: 'explanation',
      routesToWorker: false,
      isDiagnostic: false,
      diagnosticSubject: null,
      reason: 'explanation request detected',
    };
  }

  // 4. DEPLOYMENT
  if (DEPLOYMENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      intent: 'deployment',
      routesToWorker: true,
      isDiagnostic: false,
      diagnosticSubject: null,
      reason: 'explicit deployment request',
    };
  }

  // 5. CODE_CHANGE
  if (CODE_CHANGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return {
      intent: 'code_change',
      routesToWorker: true,
      isDiagnostic: false,
      diagnosticSubject: null,
      reason: 'explicit code-change request',
    };
  }

  // Default: conversational/explanation
  return {
    intent: 'explanation',
    routesToWorker: false,
    isDiagnostic: false,
    diagnosticSubject: null,
    reason: 'no specific intent pattern matched — defaulting to explanation',
  };
}

/**
 * Quick boolean: is this a diagnostic request?
 */
export function isDiagnosticRequest(message: string): boolean {
  return classifyOwnerIntent(message).isDiagnostic;
}

/**
 * Quick boolean: should this message route to the worker?
 * Mirrors `isSeniorDeveloperBuildRequest` but respects diagnostic priority.
 */
export function shouldRouteToWorker(message: string): boolean {
  return classifyOwnerIntent(message).routesToWorker;
}
