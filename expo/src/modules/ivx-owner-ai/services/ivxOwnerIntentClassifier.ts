/**
 * IVX Owner Intent Classifier — deterministic owner-command routing.
 *
 * Critical rule: an explicit owner EXECUTION command must never be hijacked by
 * a later word such as "audit" inside a QA checklist. Diagnostic intent only
 * wins when the message LEADS with a diagnostic request.
 */

export type OwnerIntentClass =
  | 'diagnostic'
  | 'code_change'
  | 'deployment'
  | 'status'
  | 'explanation';

export type OwnerIntentClassification = {
  intent: OwnerIntentClass;
  routesToWorker: boolean;
  isDiagnostic: boolean;
  diagnosticSubject: string | null;
  reason: string;
};

const DIAGNOSTIC_LEAD_PATTERNS: RegExp[] = [
  /^(?:please\s+)?(?:audit|diagnose|investigate|analyze|analyse)\b/i,
  /^(?:please\s+)?why\s+(?:is|are|does|do|can|cannot|can't|won't|doesn't|don't|did|didn't|has|have|hasn't|haven't)\b/i,
  /^(?:please\s+)?what\s+(?:is|are)\s+(?:wrong|broken|failing|the\s+problem|the\s+issue|the\s+cause)\b/i,
  /^(?:please\s+)?explain\s+what\s+is\s+wrong\b/i,
  /^(?:please\s+)?(?:find|identify)\s+the\s+(?:root\s+cause|problem|issue|failure)\b/i,
  /^(?:please\s+)?reproduce\s+the\s+(?:failure|bug|issue|error)\b/i,
  /^(?:please\s+)?(?:the\s+)?loading\s+problem\b/i,
  /^(?:please\s+)?(?:the\s+)?cold[-\s]?start\s+(?:problem|issue|failure)\b/i,
];

const STATUS_PATTERNS: RegExp[] = [
  /\b(?:what\s+is|show\s+me|give\s+me)\s+(?:the\s+)?(?:task\s+)?status\b/i,
  /\b(?:task|job|worker)\s+status\b/i,
  /\bwhat\s+(?:is|are)\s+(?:the\s+)?(?:progress|results?|findings?)\b/i,
  /\bshow\s+(?:me\s+)?(?:the\s+)?(?:progress|status|results?)\b/i,
  /\bwhat\s+(?:is|'s)\s+happening\b/i,
  /\b(?:is|are)\s+(?:it|the\s+(?:task|job|worker|deploy))\s+(?:still\s+)?(?:running|done|complete|finished)\b/i,
];

const EXPLANATION_PATTERNS: RegExp[] = [
  /\bexplain\s+(?:the\s+)?(?:architecture|design|system|how|what)\b/i,
  /\bhow\s+does\s+.+\bwork\b/i,
  /\bdescribe\s+(?:the\s+)?(?:architecture|system|design|structure)\b/i,
  /\bwalk\s+me\s+through\b/i,
  /\b(?:what\s+is|tell\s+me\s+about)\s+(?:the\s+)?(?:architecture|design|system|stack)\b/i,
];

const DEPLOYMENT_PATTERNS: RegExp[] = [
  /\bdeploy\s+(?:this|it|the\s+app|the\s+build|to\s+production|now)\b/i,
  /\bship\s+(?:this|it|to\s+production)\b/i,
  /\bpush\s+to\s+(?:production|github|main)\b/i,
  /\bgo\s+live\b/i,
  /\brelease\s+(?:this|it|the\s+app|to\s+production)\b/i,
];

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

/** Explicit owner-control commands that must route to execution even if the
 * body later contains QA words like AUDIT, DIAGNOSE, or VERIFY. */
const OWNER_EXECUTION_COMMAND_PATTERNS: RegExp[] = [
  /^(?:ivx\s+owner\s+(?:execution\s+)?command\b|owner\s+(?:execution\s+)?command\b)/i,
  /^(?:start|resume)\s+(?:autonomous|all\s+112|112\s+ia|all\s+agents)\b/i,
  /\bstart\s*\/\s*resume\s+autonomous\b/i,
  /\bstart\s*\/\s*resume\s+all\s+112\s+ia\b/i,
  /\bstart\s+all\s+112\b/i,
  /\bexecute\s+now\b/i,
  /\bthis\s+is\s+an\s+execution\s+command\b/i,
  /\bdispatch\s+real\s+ivx\s+app\b/i,
];

function hasOwnerExecutionCommand(text: string): boolean {
  return OWNER_EXECUTION_COMMAND_PATTERNS.some((pattern) => pattern.test(text));
}

function extractDiagnosticSubject(message: string): string | null {
  const text = message.trim();
  const chatLoadingMatch = text.match(/\b(chat\s+)?(?:loading|cold[-\s]?start|startup)\s+(?:problem|issue|failure|error|slow|delay)\b/i);
  if (chatLoadingMatch) return 'chat loading';
  if (/\bchat\b/i.test(text) && /\b(?:loading|cold|startup|render|blank|frozen|spinner|stuck)\b/i.test(text)) return 'chat loading';
  const registrationMatch = text.match(/\b(member\s+)?registration\s+(?:failing|broken|error|problem)\b/i);
  if (registrationMatch) return 'member registration';
  const reelsMatch = text.match(/\breels?\s+(?:crashing|broken|failing|error|problem)\b/i);
  if (reelsMatch) return 'reels';
  const genericMatch = text.match(/\b(\w+(?:\s+\w+)?)\s+(?:is\s+)?(?:failing|broken|crashing|not\s+working|erroring)\b/i);
  return genericMatch ? genericMatch[1].toLowerCase() : null;
}

export function classifyOwnerIntent(message: string): OwnerIntentClassification {
  const text = message.trim();
  if (!text) {
    return { intent: 'explanation', routesToWorker: false, isDiagnostic: false, diagnosticSubject: null, reason: 'empty message — defaulting to explanation' };
  }

  // Owner execution commands are authoritative. A QA checklist containing
  // "AUDIT -> FIX" later in the text is NOT a diagnostic request.
  if (hasOwnerExecutionCommand(text)) {
    return { intent: 'code_change', routesToWorker: true, isDiagnostic: false, diagnosticSubject: null, reason: 'explicit owner execution command detected' };
  }

  // Diagnostic intent is only a LEADING intent, matching the documented policy.
  if (DIAGNOSTIC_LEAD_PATTERNS.some((pattern) => pattern.test(text))) {
    const subject = extractDiagnosticSubject(text);
    return { intent: 'diagnostic', routesToWorker: false, isDiagnostic: true, diagnosticSubject: subject, reason: `leading diagnostic intent detected${subject ? ` (subject: ${subject})` : ''}` };
  }

  if (STATUS_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'status', routesToWorker: false, isDiagnostic: false, diagnosticSubject: null, reason: 'status request detected' };
  }
  if (EXPLANATION_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'explanation', routesToWorker: false, isDiagnostic: false, diagnosticSubject: null, reason: 'explanation request detected' };
  }
  if (DEPLOYMENT_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'deployment', routesToWorker: true, isDiagnostic: false, diagnosticSubject: null, reason: 'explicit deployment request' };
  }
  if (CODE_CHANGE_PATTERNS.some((pattern) => pattern.test(text))) {
    return { intent: 'code_change', routesToWorker: true, isDiagnostic: false, diagnosticSubject: null, reason: 'explicit code-change request' };
  }
  return { intent: 'explanation', routesToWorker: false, isDiagnostic: false, diagnosticSubject: null, reason: 'no specific intent pattern matched — defaulting to explanation' };
}

export function isDiagnosticRequest(message: string): boolean {
  return classifyOwnerIntent(message).isDiagnostic;
}

export function shouldRouteToWorker(message: string): boolean {
  return classifyOwnerIntent(message).routesToWorker;
}
