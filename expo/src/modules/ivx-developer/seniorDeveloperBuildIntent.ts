/**
 * IVX chat build-intent detection + worker-job draft builder.
 *
 * When the owner asks the IVX chat to build an app/module, create a feature,
 * modify code, deploy, or run the senior developer, the chat must STOP
 * producing narrative and instead route the request to the self-hosted Senior
 * Developer Worker (`POST /api/ivx/senior-developer/worker/jobs`).
 *
 * This module is pure + deterministic (no I/O, network, or AI) so the
 * detection and the job-draft conversion are fully unit-testable. It produces a
 * structured, owner-approval job draft — never a fabricated result.
 */

export type SeniorDeveloperBuildRiskLevel = 'low' | 'medium' | 'high';

/**
 * Worker execution template the request maps to. Lets the worker scaffold the
 * right shape of work (whole app, module, single feature, fix, refactor, or a
 * specific business workflow) from one owner request.
 */
export type SeniorDeveloperTemplateMode =
  | 'NEW_APP_FROM_SCRATCH'
  | 'NEW_MODULE_FROM_SCRATCH'
  | 'NEW_FEATURE'
  | 'BUG_FIX'
  | 'REFACTOR'
  | 'BUSINESS_WORKFLOW'
  | 'INVESTOR_WORKFLOW'
  | 'CRM_WORKFLOW';

/** A build request converted into an owner-approval worker-job draft. */
export type SeniorDeveloperJobDraft = {
  chatOrigin?: { conversationId: string; messageId: string };
  title: string;
  goal: string;
  /** Execution template the worker should follow for this request. */
  templateMode: SeniorDeveloperTemplateMode;
  proposedPlan: string;
  filesAffected: string[];
  riskLevel: SeniorDeveloperBuildRiskLevel;
  rollbackPlan: string;
  /** Whether this request asks to commit/push/deploy (real production mutation). */
  requestsDeploy: boolean;
};

/**
 * Build / development intent patterns. A match routes the message to the worker
 * approval flow instead of the conversational model.
 */
const BUILD_INTENT_PATTERNS: RegExp[] = [
  /\bbuild (?:an? )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration)\b/i,
  /\bcreate (?:an? )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration|function)\b/i,
  /\b(?:add|implement) (?:an? )?(?:app|module|feature|endpoint|screen|page|service|api|component|integration|function)\b/i,
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
];

/**
 * Imperative build verbs. When a message *begins* with one of these (optionally
 * after a polite/filler prefix), it is an instruction to the worker — even when
 * the object isn't one of the explicit nouns above. This catches natural phrasing
 * like "build login", "finish app", "fix chat", "deploy production",
 * "rewrite routing", "update worker", "complete ivx".
 *
 * The trailing negative lookahead drops conversational uses of ambiguous verbs
 * ("update me on the investors", "finish up with us") so questions and status
 * requests are never misrouted to the worker.
 */
const BUILD_VERB_LEAD_PATTERN =
  /^(?:please |pls |hey |ok |okay |now |go |kindly |i (?:need|want|'d like) (?:you )?to |can you |could you |would you |let'?s |let us )*(?:build|create|implement|develop|generate|ship|release|deploy|fix|repair|resolve|patch|update|upgrade|rewrite|refactor|optimize|optimise|finish|complete|add|modify|change|edit|write|scaffold|integrate|wire|connect|set up|setup|hook up)\b(?!\s+(?:me|us|out|up with|on (?:the|me|us))\b)/i;

/** Deploy-intent patterns — these request a real production mutation. */
const DEPLOY_INTENT_PATTERNS: RegExp[] = [
  /\bdeploy\b/i,
  /\bship (?:this|it|to production)\b/i,
  /\bpush to (?:production|github|main)\b/i,
  /\brelease\b/i,
  /\bgo live\b/i,
];

/** Higher-risk operation patterns. */
const HIGH_RISK_PATTERNS: RegExp[] = [
  /\bdelete\b/i,
  /\bdrop\b/i,
  /\bmigration\b/i,
  /\bschema\b/i,
  /\bauth(?:entication)?\b/i,
  /\bpayment|billing|stripe\b/i,
  /\bsecret|credential|token\b/i,
];

/**
 * Ordered template-mode matchers. The first match wins, so more specific
 * workflows (investor / CRM / business) are checked before generic feature work.
 */
const TEMPLATE_MODE_PATTERNS: { mode: SeniorDeveloperTemplateMode; pattern: RegExp }[] = [
  { mode: 'NEW_APP_FROM_SCRATCH', pattern: /\b(?:new |whole |full |entire )?app from scratch\b|\bbuild (?:a |an )?(?:whole|full|new|complete) app\b/i },
  { mode: 'NEW_MODULE_FROM_SCRATCH', pattern: /\bmodule from scratch\b|\b(?:build|create|add) (?:a |an )?(?:new )?module\b/i },
  { mode: 'INVESTOR_WORKFLOW', pattern: /\binvestor|private lender|capital raise|fundrais|cap(?:ital)? (?:network|pipeline)\b/i },
  { mode: 'CRM_WORKFLOW', pattern: /\bcrm|contact|lead|pipeline|outreach\b/i },
  { mode: 'BUSINESS_WORKFLOW', pattern: /\bworkflow|business process|automation|daily report|deal (?:matching|tracking)\b/i },
  { mode: 'BUG_FIX', pattern: /\bbug ?fix|hotfix|\b(?:fix|repair|patch|resolve)\b|broken|not working\b/i },
  { mode: 'REFACTOR', pattern: /\brefactor|rewrite|clean ?up|reorganiz|restructure|optimi[sz]e\b/i },
];

function normalize(message: unknown): string {
  return typeof message === 'string' ? message.trim() : '';
}

/**
 * Map a build request to its execution template. Defaults to NEW_FEATURE when no
 * more specific workflow matches.
 */
export function deriveTemplateMode(message: unknown): SeniorDeveloperTemplateMode {
  const text = normalize(message);
  if (text.length === 0) return 'NEW_FEATURE';
  const hit = TEMPLATE_MODE_PATTERNS.find(({ pattern }) => pattern.test(text));
  return hit?.mode ?? 'NEW_FEATURE';
}

/** True when the chat message is a build/development request for the worker. */
export function isSeniorDeveloperBuildRequest(message: unknown): boolean {
  const text = normalize(message);
  if (text.length === 0) return false;
  if (BUILD_INTENT_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return BUILD_VERB_LEAD_PATTERN.test(text);
}

/** True when the request explicitly asks to commit/push/deploy to production. */
export function requestsProductionDeploy(message: unknown): boolean {
  const text = normalize(message);
  if (text.length === 0) return false;
  return DEPLOY_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

function deriveRiskLevel(text: string, requestsDeploy: boolean): SeniorDeveloperBuildRiskLevel {
  if (HIGH_RISK_PATTERNS.some((pattern) => pattern.test(text))) return 'high';
  if (requestsDeploy) return 'medium';
  return 'low';
}

function deriveTitle(text: string): string {
  const firstLine = text.split('\n')[0]?.trim() ?? text;
  const compact = firstLine.replace(/\s+/g, ' ').slice(0, 80);
  return compact.length > 0 ? compact : 'Senior developer build task';
}

/**
 * Convert a build request into a structured owner-approval worker-job draft.
 * Deterministic — the same message always produces the same draft.
 */
export function buildSeniorDeveloperJobDraft(message: unknown): SeniorDeveloperJobDraft {
  const text = normalize(message);
  const requestsDeploy = requestsProductionDeploy(text);
  const riskLevel = deriveRiskLevel(text, requestsDeploy);
  const title = deriveTitle(text);
  const templateMode = deriveTemplateMode(text);

  const goal = [
    'Act as the IVX self-hosted senior developer worker and execute this owner-approved task end-to-end:',
    text,
  ].join(' ');

  const proposedPlan = [
    '1. Read the repository and locate the exact files for this task.',
    '2. Create or modify the required files.',
    '3. Add or update focused tests.',
    '4. Run tests + typecheck + build.',
    requestsDeploy
      ? '5. Commit, push to GitHub, trigger a Render deploy, then verify /health (200) and /version commit match.'
      : '5. Stop after local verification (no commit/deploy) and return the proof.',
  ].join('\n');

  const filesAffected = requestsDeploy
    ? ['(worker resolves exact files from the repository during execution)']
    : ['(worker resolves exact files from the repository during execution)'];

  const rollbackPlan = requestsDeploy
    ? 'Revert the worker commit on GitHub and trigger a redeploy of the previous commit; the worker records the prior commit hash in the proof ledger.'
    : 'No production mutation — discard the local working changes; nothing is committed or deployed.';

  return {
    title,
    goal,
    templateMode,
    proposedPlan,
    filesAffected,
    riskLevel,
    rollbackPlan,
    requestsDeploy,
  };
}

/**
 * Owner-approval card (structured `Result:`/`Evidence:` rows so the chat renders
 * it as a Command Result card). The owner approves + runs by replying `/confirm`.
 */
export function buildSeniorDeveloperApprovalCard(draft: SeniorDeveloperJobDraft): string {
  return [
    'Result: OWNER_APPROVAL_REQUIRED',
    `Title: ${draft.title}`,
    `Goal: ${draft.goal.slice(0, 280)}`,
    `Proposed plan: ${draft.proposedPlan.replace(/\n/g, ' ')}`,
    `Files affected: ${draft.filesAffected.join(', ')}`,
    `Template mode: ${draft.templateMode}`,
    `Risk level: ${draft.riskLevel}`,
    `Rollback plan: ${draft.rollbackPlan}`,
    `Production mutation: ${draft.requestsDeploy ? 'yes (commit + push + Render deploy)' : 'no (local verification only)'}`,
    'Evidence: This request was routed to the self-hosted Senior Developer Worker — no narrative, no fake commit.',
    'Run preflight: reply /confirm to run the owner preflight and submit the job.',
    'Approve + Run: reply /confirm to approve and execute. Reply anything else to cancel.',
    'Operator action log: senior-developer-worker-approval-pending',
    'Linked surface: POST /api/ivx/senior-developer/worker/jobs',
  ].join('\n');
}

/** Non-success submit card for the stable status codes. */
export function buildSeniorDeveloperSubmitStatusCard(
  statusCode: 'OWNER_APPROVAL_REQUIRED' | 'WORKER_UNAVAILABLE' | 'DEPLOY_SECRETS_MISSING',
  reason: string | null,
): string {
  const explanation =
    statusCode === 'OWNER_APPROVAL_REQUIRED'
      ? 'No verified owner session. Sign in as the IVX owner, then send the build request and reply /confirm.'
      : statusCode === 'WORKER_UNAVAILABLE'
        ? 'The self-hosted Senior Developer Worker is not reachable from this app session right now.'
        : 'The worker cannot commit or deploy because the GitHub/Render execution secrets are not configured in the production runtime.';
  return [
    `Result: ${statusCode}`,
    `Explanation: ${explanation}`,
    `Evidence: ${reason ?? 'No additional detail returned by the worker.'}`,
    'Operator action log: senior-developer-worker-submit-blocked',
    'Rollback: not required (no mutation occurred)',
    'Linked surface: POST /api/ivx/senior-developer/worker/jobs',
  ].join('\n');
}
