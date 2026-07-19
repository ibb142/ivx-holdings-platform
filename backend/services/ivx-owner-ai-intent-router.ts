export type OwnerLocationClarificationIntent = 'ambiguous_where_are_we' | 'physical_location_unavailable';

export type IVXOwnerAISemanticIntent =
  | 'time_query'
  | 'ambiguous_location'
  | 'physical_location_unavailable'
  | 'project_status'
  | 'long_structured_response'
  | 'multi_step_task'
  | 'deal_review'
  | 'bug_review'
  | 'code_retrieval'
  | 'explicit_tool_request'
  | 'app_build_planning'
  | 'self_developer_execution'
  | 'daily_self_improvement'
  | 'media_generation_3d'
  | 'normal_question';

export type IVXOwnerAIRouteDecision = 'clarification' | 'time_tool' | 'tool_grounded_gpt' | 'self_developer' | 'self_improvement' | 'gpt_conversation';

export type IVXOwnerAIPlannerDecision = {
  semanticIntent: IVXOwnerAISemanticIntent;
  route: IVXOwnerAIRouteDecision;
  useTools: boolean;
  toolHints: string[];
  requiresLongResponse: boolean;
  requiresTaskDecomposition: boolean;
  memoryMode: 'load_recent_and_persist_turn';
  fallbackPolicy: 'fail_visible_not_canned';
  reason: string;
};

function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Deterministic exact-echo command detector (acceptance test B).
 *
 * When the owner sends an explicit "reply/respond/say exactly: <X>" instruction,
 * IVX must return <X> VERBATIM — proving the LATEST owner message is the one being
 * executed, with no LLM paraphrasing, no clarification hijack, and no truncation.
 * Returns the exact text to echo (preserving original casing/characters), or null.
 */
export function resolveExactEchoCommand(prompt: string): string | null {
  const raw = prompt.trim();
  if (!raw) {
    return null;
  }
  // Match: reply/respond/answer/say/repeat/echo [back] exactly [with][:] <payload>
  const match = raw.match(/^(?:please\s+)?(?:reply|respond|answer|say|repeat|echo|output|return|print)\s+(?:back\s+)?exactly(?:\s+with)?\s*[:\-]?\s*([\s\S]+)$/i);
  if (!match) {
    return null;
  }
  let payload = match[1].trim();
  // Strip a single pair of wrapping quotes the owner may have added around the payload.
  const quoted = payload.match(/^(["'\u201c\u2018])([\s\S]+)(["'\u201d\u2019])$/);
  if (quoted) {
    payload = quoted[2].trim();
  }
  return payload.length > 0 ? payload : null;
}

/**
 * Detects a long, structured owner EXECUTION command or task block (e.g.
 * "BLOCK 28 Visitor-to-Investor Conversion Engine / Create: ... / Track: ...").
 *
 * These must NEVER be hijacked by short clarification intents (physical location,
 * time, manual-answer, infrastructure-runtime) just because the spec happens to
 * mention a keyword like "location", "backend", or "runtime" inside a much larger
 * instruction. The whole class of "IVX answered the wrong context" bugs comes from
 * a clarification regex matching a single word inside a long command and short-
 * circuiting before execution routing. When this returns true, the planner routes
 * the command to task decomposition and the handler skips every clarification gate.
 */
export function isOwnerExecutionOrTaskBlock(prompt: string): boolean {
  const raw = prompt.trim();
  if (!raw) {
    return false;
  }
  const normalized = normalizePrompt(prompt);

  // Explicit "BLOCK N" / "STEP N" / "PHASE N" task headers are always task blocks.
  if (/\b(block|step|phase)\s*\d+\b/.test(normalized)) {
    return true;
  }

  // Structured spec markers the owner uses for feature/task blocks.
  const specMarkerCount = (raw.match(/^\s*(create|track|stages?|capabilities|dashboard|requirements?|safety|store|return|show|build|objective|audit|capabilities?|metrics?)\s*:/gim) ?? []).length;
  if (specMarkerCount >= 2) {
    return true;
  }

  // Multi-line, sufficiently long instructions are treated as task blocks so a
  // single keyword can never reroute them to a one-line clarification answer.
  const lineCount = raw.split(/\n/).filter((line) => line.trim().length > 0).length;
  if (raw.length >= 320 && lineCount >= 4) {
    return true;
  }

  // Imperative engine/system/feature build commands ("... Conversion Engine",
  // "build the ... system") that are also reasonably long.
  if (raw.length >= 90 && /\b(engine|system|pipeline|module|platform|dashboard|workflow)\b/.test(normalized) && /\b(create|build|implement|add|wire|ship|deploy|design|develop)\b/.test(normalized)) {
    return true;
  }

  // Production-execution signals — explicit owner commands to commit/push/deploy/
  // verify on this system. These must NEVER be hijacked by short-circuit
  // clarification gates (time/date, location, manual-answer) just because the
  // prompt happens to contain a date phrase like "(today's date)" inside a larger
  // deploy instruction. This closes the chat→worker narrative-only fallback gap:
  // a prompt like "Bump the version marker to ...-2026-07-19 (today's date), commit
  // to GitHub, deploy to Render, verify /health" must route to the developer
  // executor, not return "The answer is 2019." as a math/time query.
  const hasCommitSignal = /\b(commit|push\s+(?:to\s+)?github|github\s+main|pr\s*#\d)\b/.test(normalized);
  const hasDeploySignal = /\b(deploy|render|trigger\s+a\s+deploy|live\s+commit|production\s+commit)\b/.test(normalized);
  const hasVerifySignal = /\b(verify|verified\s+evidence|verify\s+the\s+live|live\s+runtime\s+commit|github\s+head|sha\s+match|\/health)\b/.test(normalized);
  const hasMutationSignal = /\b(bump|update|change|edit|modify|patch|fix|migrate|rollback)\b/.test(normalized)
    && /\b(version|marker|file|endpoint|route|table|policy|config|code|production)\b/.test(normalized);
  const executionSignalCount = [hasCommitSignal, hasDeploySignal, hasVerifySignal, hasMutationSignal].filter(Boolean).length;
  if (executionSignalCount >= 2) {
    return true;
  }

  return false;
}

function asksForLongStructuredResponse(normalized: string): boolean {
  return /\b(full\s+list|complete\s+list|list\s+all|enumerate|from\s+1\s+to\s+\d+|1\s*[-–to]+\s*\d+|one\s+to\s+\d+|\d{2,}\s+(?:items?|points?|things?|steps?|rows?|entries|checks?))\b/.test(normalized)
    // Full / structured audits always need the long-response budget + auto-continuation.
    || /\b(full\s+audit|complete\s+audit|end[-\s]?to[-\s]?end\s+audit|audit\s+(?:everything|all|end\s+to\s+end|one\s+by\s+one)|run\s+(?:a\s+)?full\s+audit|audit\s+\d{1,4}\s*[-–to]+\s*\d{1,4}|audit\s+from\s+1)\b/.test(normalized)
    // Any explicit numeric range whose upper bound is large (e.g. "1-100", "1 to 2000").
    || hasLargeExplicitRange(normalized);
}

export function hasLargeExplicitRange(normalized: string): boolean {
  const match = normalized.match(/\b(?:from\s+)?1\s*(?:[-–]|to)\s*(\d{2,4})\b/);
  if (match) {
    const upper = Number.parseInt(match[1], 10);
    return Number.isFinite(upper) && upper >= 30;
  }
  return false;
}

function asksForMultiStepTask(normalized: string): boolean {
  return /\b(step[-\s]?by[-\s]?step|multi[-\s]?step|decompose|break\s+(?:it|this)?\s*down|task\s+decomposition|execution\s+plan|implementation\s+plan|roadmap|sequence)\b/.test(normalized)
    || /\b(build|fix|audit|implement|ship|repair|improve)\b.{0,80}\b(plan|steps|phases|tasks)\b/.test(normalized);
}

export function asksForDealReview(normalized: string): boolean {
  return /\b(review\s+(?:this\s+)?deal|deal\s+review|underwrite|underwriting|cap\s+rate|noi|cash[-\s]?on[-\s]?cash|real\s+estate\s+deal|investment\s+deal)\b/.test(normalized);
}

export function asksForBugReview(normalized: string): boolean {
  return /\b(what\s+bugs?\s+do\s+you\s+see|find\s+bugs?|bug\s+review|bug\s+list|prioritized\s+bug\s+list|review\s+(?:the\s+)?bugs?|errors?\s+do\s+you\s+see|what\s+is\s+broken)\b/.test(normalized)
    || /\binspect\b.{0,100}\b(?:chat|ai|assistant)\b.{0,100}\bbugs?\b/.test(normalized);
}

/**
 * Detects when the owner wants to SEE real source code from the repository —
 * file paths, functions, endpoints, queries, or a feature's implementation —
 * rather than execute a build/fix task. These requests must be grounded in the
 * live repo (code search) so the answer contains concrete files and source,
 * never a generic LLM guess or a clarification question.
 */
export function asksForCodeRetrieval(normalized: string): boolean {
  const codeNoun = /\b(code|source|source\s+code|snippet|implementation|function|method|class|file|files|file\s+path|endpoint|route|api\s+route|handler|query|queries|sql\s+quer(?:y|ies)|service|module|component|schema\s+definition)\b/;
  const retrievalVerb = /\b(show|give|return|see|read|display|paste|get|list|find|reveal|provide|where\s+is|which\s+file|what\s+file|locate|share)\b/;
  // "show me the analytics code", "return the analytics implementation", "where is the auth endpoint"
  if (retrievalVerb.test(normalized) && codeNoun.test(normalized)) {
    return true;
  }
  // Direct phrasings that always imply real code retrieval.
  return /\b(source\s+code|code\s+for|implementation\s+of|implementation\s+details|actual\s+code|real\s+code|how\s+is\s+\w+\s+implemented|how\s+does\s+\w+\s+work\s+in\s+(?:the\s+)?code|file\s+path|function\s+name|endpoint\s+definition|database\s+quer(?:y|ies)\s+used)\b/.test(normalized);
}

/**
 * Detects open-ended app/product build requests like "build an app like TikTok",
 * "create a clone of Uber", "I want to build a marketplace app". These must NOT
 * fall through to a generic conversational timeline. They trigger a senior product-
 * engineering planning response: architecture proposal, module breakdown, required
 * repo/actions, execution plan, and a permission/capability check — not boilerplate.
 *
 * Deliberately excludes prompts that already point at THIS repo's concrete work
 * ("build the feature", "build this screen"), which belong to self-developer execution.
 */
/**
 * Detects an owner request to GENERATE a 3D model / mesh / render (e.g.
 * "generate a 3d model of a villa", "create a 3D render of our product",
 * "make me a 3d mesh of a chair"). Routes to the owner 3D generation tool
 * (Meshy/Tripo direct, or a deterministic procedural Three.js preview).
 *
 * Deliberately excludes "build an app" / generic build requests by requiring an
 * explicit 3D/mesh/render target word.
 */
export function asksToGenerate3DModel(normalized: string): boolean {
  const genVerb = /\b(generate|create|make|build|render|design|produce|model|sculpt|give\s+me|i\s+want|i\s+need)\b/;
  const threeDTarget = /\b(3d|three[\s-]?d)\b/;
  const meshTarget = /\b(3d\s+model|3d\s+render|3d\s+mesh|3d\s+object|3d\s+asset|mesh|render)\b/;
  if (!genVerb.test(normalized)) {
    return false;
  }
  if (threeDTarget.test(normalized)) {
    return true;
  }
  // "model/mesh/render" without "3d" only counts when paired with a clear object word.
  return meshTarget.test(normalized) && /\b(model|mesh|render|object|asset|figure|statue|product|prototype|scene)\b/.test(normalized);
}

export function asksToBuildApp(normalized: string): boolean {
  // "build/create/make/design/develop ... an/a/another ... app/clone/platform/product/mvp/saas/marketplace/..."
  const buildVerb = /\b(build|create|make|design|develop|spin\s+up|launch|clone|ship)\b/;
  const appNoun = /\b(app|application|clone|platform|product|mvp|saas|marketplace|startup|website|web\s+app|mobile\s+app|social\s+(?:app|network|platform)|dating\s+app|delivery\s+app|fintech\s+app)\b/;
  // "like X" / "such as X" / "similar to X" / "version of X" / "clone of X" strongly implies product planning.
  const comparativeApp = /\b(?:app|clone|platform|product|version|something)\b[^.]{0,40}\b(?:like|similar\s+to|such\s+as)\b/;
  const cloneOf = /\b(clone|version|copy)\s+of\s+\w+/;

  // A build command aimed at the owner's OWN IVX system ("build the IVX engine",
  // "create our investment platform", "finish the autonomous engine") is in-repo
  // EXECUTION, not a request to scaffold a brand-new external product. It must never
  // enter narrative "app planning" mode — it routes to the senior-developer runtime.
  if (targetsOwnSystemBuild(normalized)) {
    return false;
  }
  if (cloneOf.test(normalized) || comparativeApp.test(normalized)) {
    return true;
  }
  if (buildVerb.test(normalized) && appNoun.test(normalized)) {
    // Avoid hijacking concrete in-repo execution like "build the screen"/"build this feature".
    const pointsAtThisRepoWork = /\b(this|that|the)\s+(feature|screen|fix|bug|endpoint|route|module|component|migration|page|function|test)\b/.test(normalized);
    return !pointsAtThisRepoWork;
  }
  return false;
}

/**
 * Detects a build/execute command aimed at the owner's OWN IVX system rather than a
 * brand-new external app. These are concrete in-repo engineering jobs ("build the IVX
 * autonomous engine", "create our investor pipeline", "finish the conversion engine",
 * "implement the IVX dashboard module") and must EXECUTE end-to-end via the senior-
 * developer runtime — never get answered with an "Architecture Proposal / Phase 1-4"
 * narrative. The signal is a build verb plus either an explicit "IVX"/"our"/"my"
 * possessive or a system-component noun (engine, pipeline, module, workflow, dashboard,
 * system, platform) describing THIS product.
 */
export function targetsOwnSystemBuild(normalized: string): boolean {
  const buildVerb = /\b(build|create|implement|develop|add|wire|integrate|set\s*up|spin\s*up|ship|deploy|launch|configure|finish|complete|make|design|generate|code)\b/;
  if (!buildVerb.test(normalized)) {
    return false;
  }
  // Explicit reference to THIS product / owner's own system.
  const ownProduct = /\bivx\b/.test(normalized)
    || /\b(our|my|the)\s+(?:own\s+)?(?:autonomous\s+|investment\s+|global\s+|owner\s+)?(engine|pipeline|module|workflow|dashboard|system|platform|backend|api|app|product|crm|portal)\b/.test(normalized);
  // System-component nouns that, paired with a build verb, mean in-repo execution.
  const systemComponent = /\b(engine|pipeline|module|workflow|conversion\s+engine|investment\s+engine|autonomous\s+(?:engine|system|investment))\b/.test(normalized);
  return ownProduct || systemComponent;
}

/**
 * Detects work-completion / "prove you are a senior developer" requests, e.g.
 * "finish and show proof you are a senior developer", "complete the task and prove it",
 * "act as a senior developer and finish this". These are engineering-execution
 * intents and must route to the senior-developer runtime — NEVER to a canned
 * audit/status report (the word "developer" + "proof"/"code" must not be misread
 * as an IVX free/control audit).
 */
export function asksToFinishOrProveSeniorDeveloperWork(normalized: string): boolean {
  // "finish and show proof / deploy / prove / push ...", "finish it/this/the task/now".
  const finishWork = /\b(finish|finalize|finalise|wrap\s+up|complete|deliver)\b.{0,60}\b(it|this|that|task|job|work|build|feature|fix|deployment|deploy|code|implementation|now|today|and\s+(?:show|deploy|prove|push|test|verify|ship|finish|complete))\b/i.test(normalized)
    || /\bfinish\s+and\b/i.test(normalized);
  // "(act as|be|prove you are|show proof you are|you are) a senior developer/engineer".
  const seniorDeveloperPersona = /\b(?:act\s+as|be|prove\s+(?:you\s+are|that\s+you\s+are|yourself)|show\s+(?:me\s+)?proof\s+(?:you\s+are|that\s+you\s+are)|demonstrate\s+(?:you\s+are|that\s+you\s+are)|you\s+are)\s+(?:a\s+)?(?:real\s+|true\s+)?senior\s+(?:software\s+)?(?:developer|engineer|dev)\b/i.test(normalized)
    || /\bsenior\s+(?:software\s+)?(?:developer|engineer)\b.{0,40}\b(mode|now|finish|complete|execute|work|build|fix|deploy|prove|show\s+proof|do\s+it)\b/i.test(normalized);
  return finishWork || seniorDeveloperPersona;
}

/**
 * Detects the owner's daily self-improvement command — the single entry point that
 * starts the autonomous "find issue → patch → test → commit → deploy → verify" loop
 * WITHOUT naming a specific file or bug. Phrasings: "improve IVX today", "fix one bug
 * today", "self improve", "run daily improvement". These must route to the dedicated
 * daily-improvement task so progress is durable + visible in the Live Developer Monitor,
 * never to a generic conversational answer.
 */
export function asksToImproveIVXToday(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return false;
  }
  return /\bimprove\s+ivx(?:\s+(?:today|now|daily|automatically))?\b/.test(normalized)
    || /\b(?:run|start|kick\s*off|begin)\s+(?:the\s+|a\s+)?daily\s+(?:self[-\s]?)?improvement\b/.test(normalized)
    || /\bdaily\s+self[-\s]?improvement\b/.test(normalized)
    || /\bself[-\s]?improve(?:ment)?\b/.test(normalized)
    || /\bfix\s+one\s+(?:real\s+)?(?:bug|issue|problem)(?:\s+(?:today|now))?\b/.test(normalized)
    || /\bimprove\s+(?:the\s+)?(?:platform|app|system|codebase|product)\s+(?:today|now|daily|automatically)\b/.test(normalized);
}

/**
 * Detects the owner's opportunity-discovery command — "find today's best opportunity",
 * "best opportunity today", "find me an opportunity", "opportunity scan", "scan for
 * opportunities". Routes to the owner-gated Opportunity Intelligence Engine so the
 * answer is grounded in real scored opportunities (never a fabricated tip).
 */
export function asksForBestOpportunity(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return false;
  }
  return /\bfind\s+(?:me\s+|today'?s\s+|the\s+)?(?:best|top|highest[-\s]?upside)\s+(?:opportunit(?:y|ies)|deal|investment)\b/.test(normalized)
    || /\b(?:best|top|highest[-\s]?upside)\s+opportunit(?:y|ies)\s+(?:today|now|right\s+now)\b/.test(normalized)
    || /\b(?:today'?s\s+)?(?:best|top)\s+opportunit(?:y|ies)\b/.test(normalized)
    || /\b(?:run|start|do)\s+(?:an?\s+)?opportunity\s+scan\b/.test(normalized)
    || /\bscan\s+(?:for|the\s+market\s+for)\s+opportunit(?:y|ies)\b/.test(normalized)
    || /\bfind\s+(?:me\s+)?(?:an?\s+)?opportunit(?:y|ies)\b/.test(normalized);
}

/**
 * Detects the owner's "find the best investor for Deal X" command — routes to the
 * BLOCK 27 best-investor workflow (search CRM → rank → draft intro → follow-up →
 * log → proof). Distinct from `asksForBestOpportunity` (which finds DEALS, not
 * investors). Matches "find the best investor for Casa Rosario", "who is the best
 * investor for deal X", "best buyer/investor for <deal>", "match investors to X".
 */
export function asksToFindBestInvestor(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return false;
  }
  return /\b(?:find|get|show|who(?:'?s| is| are)?)\s+(?:me\s+|us\s+|the\s+)?(?:best|top|right|ideal)\s+investors?\s+for\b/.test(normalized)
    || /\b(?:best|top|right|ideal)\s+investors?\s+for\s+(?:the\s+)?(?:deal|project|property|opportunity)\b/.test(normalized)
    || /\bmatch\s+investors?\s+(?:to|for|with)\b/.test(normalized)
    || /\bfind\s+(?:me\s+)?(?:the\s+)?(?:best|top|right|ideal)\s+(?:investor|buyer|backer|capital)\s+for\b/.test(normalized)
    || /\bwho\s+should\s+(?:i|we)\s+(?:pitch|approach|contact|raise\s+from)\s+for\b/.test(normalized);
}

/**
 * Detects the owner demanding EXECUTION + PROOF instead of a narrative report — e.g.
 * "audit end to end and fix and deploy and prove verified", "stop narrative, fix this
 * now", "no more narrative, deploy and verify". This is the exact class of command that
 * was wrongly routed to a long narrative audit: the words "end to end audit" set
 * `requiresLongResponse = true`, which gated OFF the execute path, so the command fell
 * through to `long_structured_response` (the narrative the owner keeps rejecting).
 *
 * When this returns true the planner routes to the senior-developer runtime so IVX
 * EXECUTES (inspect → patch → test → commit → deploy → verify) and returns live proof,
 * never a narrative — even when an "audit" word is present in the same message.
 */
export function demandsExecutionProofNotNarrative(normalized: string): boolean {
  // Explicit "stop / no / no more / without narrative" always forces execution.
  const banNarrative = /\b(?:no|stop|not|without|don'?t\s+(?:give|want|send|do)|kill|skip|cut|enough|no\s+more)\b[^.]{0,30}\bnarrativ\w*/.test(normalized)
    || /\bnarrativ\w*\b[^.]{0,30}\b(?:stop|off|no\s+more|enough|kill)\b/.test(normalized);
  if (banNarrative) {
    return true;
  }
  // An audit/verify/review/check request PAIRED with a real execute/ship/prove demand
  // means "do the work and prove it", not "write me a report".
  const mentionsAudit = /\b(audit|verify|verified|verification|review|check|prove|proof|end[-\s]?to[-\s]?end|finish|complete)\b/.test(normalized);
  const demandsAction = /\b(fix|patch|repair|deploy|redeploy|ship|release|push|implement|build|execute|run|remove|delete|eliminate|clean\s*up|clear|get\s+rid\s+of|make\s+it\s+work|get\s+it\s+(?:done|working|fixed|shipped|deployed|live)|live\s+deploy|deploy\s+live|go\s+live|prove\s+(?:it|verified)|show\s+proof)\b/.test(normalized);
  return mentionsAudit && demandsAction;
}

function isSelfDeveloperExecutionPrompt(normalized: string): boolean {
  return /\b(complete\s+(?:this\s+|that\s+|the\s+)?(?:task|job|work|fix|feature|build|patch|implementation|deployment|deploy|code|module|bug)|fix\s+(?:this|that|the|it|code|bug|issue|problem|error)|build\s+(?:this|that|the|it|code|feature|app|module|screen|ui|backend|api|route|function|component)|run\s+(?:tests?|test\s+suite|validation|checks?|build)|deploy\s+(?:this|that|the|it|now|to\s+(?:prod|production|live|staging|render))|audit\s+and\s+(?:fix|patch|repair|complete|implement|build|do)|ship\s+(?:this|that|the|it|now|today|today\s+100%|100%|immediately)|implement\s+(?:this|that|the|it|feature|fix|bug|screen|ui|component|backend|api|route|function|module|code)|patch\s+(?:this|that|the|it|code|bug|issue|fix|file|module|feature)|code\s+(?:this|that|the|it|feature|fix|bug|screen|ui|component|backend|api|route|function|module)|write\s+(?:code|this\s+code|the\s+code|a\s+fix|a\s+patch|an\s+implementation|tests?)|make\s+(?:it|this|that)\s+(?:work|pass|run|build|deploy|complete|done|fixed|built|shipped|live)|get\s+(?:it|this|that)\s+(?:done|fixed|built|shipped|deployed|working|running|passing|completed))\b/i.test(normalized)
    || /\b(do\s+(?:it|this|that|the\s+task|the\s+work|the\s+fix|the\s+build|the\s+deploy|the\s+implementation|the\s+coding|now|immediately|asap|today|100%))\b/i.test(normalized)
    || /\b(developer\s+mode|self[-\s]?developer|senior\s+developer\s+mode|execute\s+(?:task|job|fix|build|deploy|patch|code)|run\s+developer\s+task|start\s+(?:coding|development|implementation|fix|build|deploy|patch))\b/i.test(normalized)
    || isRemovalExecutionPrompt(normalized)
    || asksToFinishOrProveSeniorDeveloperWork(normalized);
}

/**
 * Detects an imperative REMOVAL/cleanup command aimed at app UI or behavior —
 * e.g. "remove end to end chat loading", "remove the loading spinner", "delete
 * the duplicate banner", "get rid of the splash delay". These are concrete
 * in-repo engineering jobs and must EXECUTE via the senior-developer runtime,
 * never fall through to a narrative audit/plan that ends with "awaiting your
 * approval". Destructive DATA removal stays protected downstream by the owner
 * execution-mode approval gates (delete data, prod schema, security, ...).
 */
export function isRemovalExecutionPrompt(normalized: string): boolean {
  const removalVerb = /\b(remove|delete|hide|eliminate|clear|clean\s*up|get\s+rid\s+of|strip|kill|turn\s+off|disable|stop)\b/;
  if (!removalVerb.test(normalized)) {
    return false;
  }
  // The removal target must be an app/UI/behavior noun (not a data noun — those
  // are guarded). Covers loading states, UI elements, screens, chat surfaces.
  const uiOrBehaviorTarget = /\b(loading|loader|spinner|skeleton|placeholder|splash|delay|lag|freeze|flicker|glitch|stutter|banner|badge|button|icon|label|text|copy|modal|popup|toast|overlay|screen|page|tab|section|card|component|element|ui|chat|message\s+bubble|feed|carousel|animation|transition|duplicate|watermark|shadow|border|padding|margin|scrollbar|error\s+message)\b/;
  return uiOrBehaviorTarget.test(normalized);
}

function explicitlyNeedsLiveTools(normalized: string): boolean {
  const toolVerb = /\b(use|run|call|execute|inspect|query|scan|check|list|verify|show|read)\b/.test(normalized);
  const liveTarget = /\b(tools?|supabase|schema|database|tables?|columns?|rls|polic(?:y|ies)|logs?|code|repo|github|aws|backend|deployment|health|runtime|storage|bucket|auth\s+users?|edge\s+functions?|migration|sql)\b/.test(normalized);
  const directLiveList = /\b(list|show|inspect|query|verify|check)\b.{0,80}\b(tables?|schemas?|columns?|rls|logs?|github|aws|backend|deployment|runtime|storage|buckets?)\b/.test(normalized);
  return (toolVerb && liveTarget) || directLiveList;
}

export function resolveOwnerLocationClarificationIntent(prompt: string): OwnerLocationClarificationIntent | null {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return null;
  }

  // Never treat a long structured owner command / task block as a location
  // question, even if it mentions "location" (e.g. "track visitor location").
  // This is the primary fix for IVX answering the wrong context.
  if (isOwnerExecutionOrTaskBlock(prompt)) {
    return null;
  }

  const asksAmbiguousWhereAreWe = /\b(where\s+(?:are\s+)?we(?:\s+are)?\s+(?:right\s+)?now|where\s+we\s+are\s+(?:right\s+)?now)\b/.test(normalized);
  if (asksAmbiguousWhereAreWe) {
    return 'ambiguous_where_are_we';
  }

  const asksPhysicalLocation = /\b(location|physical\s+location|gps|current\s+place|where\s+am\s+i|in\s+what\s+location|what\s+location)\b/.test(normalized)
    || /\bwhere\s+(?:are\s+)?(?:we|i)\s+(?:physically|located)\b/.test(normalized);
  return asksPhysicalLocation ? 'physical_location_unavailable' : null;
}

export function buildOwnerLocationClarificationAnswer(intent: OwnerLocationClarificationIntent): string {
  if (intent === 'ambiguous_where_are_we') {
    return 'Do you mean where we are in the IVX project status, your physical location, or the current app state? I don’t want to guess and give you the wrong answer.';
  }

  return 'I don’t have your physical location data in this chat. Location permission or device GPS data is unavailable here, so I can’t say where you are physically unless the app sends that location context.';
}

export function shouldUseCurrentTimeTool(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (!normalized || resolveOwnerLocationClarificationIntent(normalized)) {
    return false;
  }

  return /\b(?:what\s+time(?:\s+is)?(?:\s+it)?(?:\s+now)?|what\s+time\s+is\s+now|current\s+time|time\s+now|current\s+date|date\s+now|today'?s\s+date|what\s+date\s+is\s+it|timezone\s*(?:now|check|status)?)\b/.test(normalized);
}

export function resolveLiveGroundingIntent(prompt: string): 'time' | 'project_state' | null {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return null;
  }
  const asksTime = shouldUseCurrentTimeTool(prompt);
  if (asksTime) {
    return 'time';
  }
  const asksState = /\b(current\s+ivx\s+(?:app|project|system)\s+(?:state|status)|explain\s+current\s+ivx\s+app\s+status|what\s+state\s+are\s+we\s+in|current\s+(?:app|project|system)\s+(?:state|status)|ivx\s+project\s+(?:state|status)|ivx\s+app\s+status)\b/.test(normalized);
  if (asksState) {
    return 'project_state';
  }
  return null;
}

/**
 * Detects when the owner wants the AI to look at the LIVE public landing page
 * (ivxholding.com) — its projects/cards, a named project like "Casa Rosario",
 * its CTAs/links, or its content. These prompts must trigger a live website
 * fetch + parse so the AI answers with what is actually on the site instead of
 * refusing with "I cannot view the landing page".
 */
export function resolveLandingInspectionIntent(prompt: string): boolean {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return false;
  }
  // Direct references to the live site / landing page / project cards.
  const mentionsLanding = /\b(landing\s+page|ivxholding\.com|ivxholding\s+landing|my\s+(?:web)?site|the\s+website|our\s+website|home\s*page|web\s*page|project\s+cards?|project\s+page)\b/.test(normalized);
  // Questions about which projects are shown / listed.
  const asksProjects = /\b(what\s+(?:are\s+)?(?:the\s+)?(?:\d+\s+)?projects?|which\s+projects?|list\s+(?:the\s+|all\s+)?projects?|projects?\s+(?:on|shown|listed|displayed)|how\s+many\s+projects?)\b/.test(normalized);
  // A named project (Casa Rosario) or an explicit audit/inspect of a project.
  const mentionsNamedProject = /\bcasa\s+rosario\b/.test(normalized);
  const asksProjectAuditOrDetails = /\b(audit|inspect|analyze|analyse|review|details?\s+(?:of|for|about)|tell\s+me\s+about|show\s+me)\b/.test(normalized)
    && /\b(casa\s+rosario|project|landing|page|website|site)\b/.test(normalized);
  // "Can you see ... on (the) landing page / site"
  const asksCanYouSee = /\b(can\s+you\s+(?:see|view|read|access|audit|check))\b/.test(normalized)
    && /\b(landing|page|site|website|project|casa\s+rosario|card|cta|link)\b/.test(normalized);

  return mentionsLanding || asksProjects || mentionsNamedProject || asksProjectAuditOrDetails || asksCanYouSee;
}

/**
 * Detects when the owner is asking the AI to look at an uploaded media artifact
 * (image/screenshot/photo or a video). Used to ensure the AI engages its vision
 * pipeline (for images) or states the exact unsupported piece (for video).
 */
export function resolveMediaAnalysisIntent(prompt: string): 'image' | 'video' | null {
  const normalized = normalizePrompt(prompt);
  if (!normalized) {
    return null;
  }
  const asksVideo = /\b(video|clip|footage|recording|reel|mp4|mov)\b/.test(normalized)
    && /\b(analyze|analyse|see|view|inspect|read|describe|watch|understand|look\s+at)\b/.test(normalized);
  if (asksVideo) {
    return 'video';
  }
  const asksImage = /\b(image|images|screenshot|screen\s*shot|photo|picture|pic|attachment|attached|upload(?:ed)?|this\s+(?:image|photo|picture|screenshot))\b/.test(normalized)
    && /\b(analyze|analyse|see|view|inspect|read|describe|extract|what(?:'s| is)|look\s+at|understand|tell\s+me)\b/.test(normalized);
  return asksImage ? 'image' : null;
}

/**
 * Multimodal routing decision when one or more image attachments are present on
 * the request.
 *
 * BUG FIX: previously an attached image with a prompt like "Fix this error" or
 * "Deploy this" was routed straight into Developer Action Mode (code inspection /
 * patching / deployment) WITHOUT ever looking at the image. The image must be
 * inspected and described FIRST. Only when the owner explicitly asks for
 * implementation work (fix/build/debug/change) or deployment does IVX proceed
 * into Developer Action Mode / the deployment workflow — and even then, image
 * analysis runs first and grounds the execution.
 *
 * Routing kinds:
 *  - `image_analysis`      → inspect + answer image content only (default for an
 *                            attached image, including "what is this", "explain
 *                            this error").
 *  - `image_then_developer`  → analyze image first, THEN Developer Action Mode
 *                            (prompt explicitly asks to fix/build/debug/change).
 *  - `image_then_deployment` → analyze image first, THEN deployment workflow
 *                            (prompt explicitly asks to deploy/ship/release).
 *
 * Returns `null` when no image is attached (non-multimodal path unchanged).
 */
export type MultimodalRoutingKind = 'image_analysis' | 'image_then_developer' | 'image_then_deployment';

export function resolveMultimodalRouting(prompt: string, hasImageAttachments: boolean): MultimodalRoutingKind | null {
  if (!hasImageAttachments) {
    return null;
  }
  const normalized = normalizePrompt(prompt);

  // Explicit deployment / release request → analyze image, then deployment workflow.
  const asksDeployment = /\b(deploy|redeploy|re-?deploy|ship|release|roll\s*out|publish|push\s+to\s+(?:prod|production|live)|go\s+live)\b/.test(normalized);
  if (asksDeployment) {
    return 'image_then_deployment';
  }

  // Explicit implementation / fix / build / debug / change request → analyze
  // image, then Developer Action Mode. NOTE: "explain", "what is", "describe",
  // "read" are NOT implementation verbs and must stay on the image-analysis path.
  const asksImplementation = /\b(fix|debug|patch|implement|build|rebuild|create|add|change|modify|update|refactor|resolve|repair|solve|correct|rewrite|wire|integrate|apply|make\s+it\s+work|get\s+it\s+working)\b/.test(normalized);
  if (asksImplementation) {
    return 'image_then_developer';
  }

  // Default for any attached image: inspect it and answer what is visible.
  return 'image_analysis';
}

export function buildIVXOwnerAIPlannerDecision(prompt: string): IVXOwnerAIPlannerDecision {
  const normalized = normalizePrompt(prompt);
  const isExecutionOrTaskBlock = isOwnerExecutionOrTaskBlock(prompt);
  const locationIntent = resolveOwnerLocationClarificationIntent(prompt);
  if (locationIntent === 'ambiguous_where_are_we') {
    return {
      semanticIntent: 'ambiguous_location',
      route: 'clarification',
      useTools: false,
      toolHints: [],
      requiresLongResponse: false,
      requiresTaskDecomposition: false,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner asked “where are we now”, which is ambiguous between project status, physical location, and app state.',
    };
  }

  if (locationIntent === 'physical_location_unavailable') {
    return {
      semanticIntent: 'physical_location_unavailable',
      route: 'clarification',
      useTools: false,
      toolHints: [],
      requiresLongResponse: false,
      requiresTaskDecomposition: false,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner asked for physical location, but no location permission/device coordinates are present in the chat request.',
    };
  }

  if (shouldUseCurrentTimeTool(prompt)) {
    return {
      semanticIntent: 'time_query',
      route: 'time_tool',
      useTools: true,
      toolHints: ['get_current_time'],
      requiresLongResponse: false,
      requiresTaskDecomposition: false,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner explicitly asked for current time/date/timezone.',
    };
  }

  if (resolveLiveGroundingIntent(prompt) === 'project_state') {
    return {
      semanticIntent: 'project_status',
      route: 'tool_grounded_gpt',
      useTools: true,
      toolHints: ['live_project_state'],
      requiresLongResponse: false,
      requiresTaskDecomposition: false,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner asked for current IVX app/project status, so verified runtime context should ground the GPT answer.',
    };
  }

  const requiresLongResponse = asksForLongStructuredResponse(normalized)
    || /\b(prioritized\s+bug\s+list|full\s+bug\s+list|complete\s+bug\s+list)\b/.test(normalized);
  const requiresTaskDecomposition = asksForMultiStepTask(normalized);

  if (asksToImproveIVXToday(prompt)) {
    return {
      semanticIntent: 'daily_self_improvement',
      route: 'self_improvement',
      useTools: true,
      toolHints: ['run_ivx_daily_improvement'],
      requiresLongResponse: false,
      requiresTaskDecomposition: true,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner issued the daily self-improvement command ("improve IVX today" / "fix one bug today" / "self improve" / "run daily improvement"). Start the autonomous self-development loop (find one real safe issue → patch → test → commit → deploy → verify) as a durable, resumable task and surface its id so progress is visible in the Live Developer Monitor.',
    };
  }

  if (asksForBugReview(normalized)) {
    const useTools = /\b(code|repo|repository|scan|inspect|logs?|current\s+app|current\s+ivx|ai\s+chat|chat\s+behavior|files?)\b/.test(normalized);
    return {
      semanticIntent: 'bug_review',
      route: useTools ? 'tool_grounded_gpt' : 'gpt_conversation',
      useTools,
      toolHints: useTools ? ['code_or_logs'] : [],
      requiresLongResponse,
      requiresTaskDecomposition: true,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: useTools
        ? 'The owner asked for bug review with live code/log context, so use tools as evidence and synthesize with GPT.'
        : 'The owner asked a general bug-review question; answer conversationally and ask for code/log context if needed.',
    };
  }

  if (asksForCodeRetrieval(normalized) && !isSelfDeveloperExecutionPrompt(normalized)) {
    return {
      semanticIntent: 'code_retrieval',
      route: 'tool_grounded_gpt',
      useTools: true,
      toolHints: ['search_code'],
      requiresLongResponse,
      requiresTaskDecomposition: false,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner asked to see real source code (files, functions, endpoints, queries, or a feature implementation). Run a live repo code search and answer with concrete file paths and source instead of asking for clarification.',
    };
  }

  if (asksToGenerate3DModel(normalized) && !isSelfDeveloperExecutionPrompt(normalized)) {
    return {
      semanticIntent: 'media_generation_3d',
      route: 'tool_grounded_gpt',
      useTools: true,
      toolHints: ['generate_3d_model'],
      requiresLongResponse: false,
      requiresTaskDecomposition: false,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner asked to generate a 3D model/mesh/render. Run the owner-controlled 3D generation tool (Meshy/Tripo direct when a provider key is set, else a deterministic procedural Three.js preview) and ground the answer in its real output, including the evidence label and any missing-provider-key blocker.',
    };
  }

  // EXECUTE, DON'T NARRATE. When the owner issues a build/execute command targeting
  // THIS system — whether an explicit execution phrase ("fix this", "deploy now") or a
  // structured task block ("BLOCK 28 — Create the … Engine", "build the … pipeline") —
  // route straight to the senior-developer runtime so IVX inspects → patches → tests →
  // commits → deploys → verifies and returns live proof. Never answer a build command
  // with a phased "once approved we'll proceed" plan. Pure report/list/audit requests
  // (handled below) keep producing structured answers; only actionable build/fix/ship
  // task blocks execute here.
  const hasBuildOrExecuteVerb = /\b(build|create|implement|develop|add|wire|integrate|set\s*up|spin\s*up|ship|deploy|launch|configure|finish|complete|fix|patch|code|repair|refactor|migrate|generate|remove|delete|eliminate|clean\s*up|clear|hide|strip|get\s+rid\s+of|turn\s+off)\b/.test(normalized);
  const isBuildOrExecuteTaskBlock = isExecutionOrTaskBlock
    && hasBuildOrExecuteVerb
    && !asksForLongStructuredResponse(normalized)
    && !asksToBuildApp(normalized);
  // "audit end to end and fix/deploy/prove verified" or "stop narrative" must EXECUTE,
  // not narrate — even though the word "audit" set requiresLongResponse above. This is
  // the exact path that kept producing the rejected narrative audit, so it wins here.
  const demandsExecutionProof = demandsExecutionProofNotNarrative(normalized) && !asksToBuildApp(normalized);
  if (isSelfDeveloperExecutionPrompt(normalized) || isBuildOrExecuteTaskBlock || demandsExecutionProof) {
    return {
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
      toolHints: ['run_ivx_senior_developer_task'],
      requiresLongResponse: false,
      requiresTaskDecomposition: true,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner issued a build/execute command or structured task block targeting this system. Route to the senior developer runtime to EXECUTE end-to-end (inspect files → patch → run tests → commit → deploy → verify production) and return live proof. Do not narrate a phased plan or wait for approval on non-destructive work.',
    };
  }

  // A build/execute command aimed at the owner's OWN IVX system (engine, pipeline,
  // module, platform, dashboard) is in-repo EXECUTION — it must run end-to-end via the
  // senior-developer runtime and return live proof, never an "Architecture Proposal /
  // Phase 1-4" narrative. This catches short commands like "build the IVX engine" that
  // are not long enough to register as a structured task block above.
  if (targetsOwnSystemBuild(normalized) && !asksToBuildApp(normalized)) {
    return {
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
      toolHints: ['run_ivx_senior_developer_task'],
      requiresLongResponse: false,
      requiresTaskDecomposition: true,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner issued a build/execute command targeting THIS IVX system (engine/pipeline/module/platform/dashboard). Route to the senior developer runtime to EXECUTE end-to-end (inspect → patch → test → commit → deploy → verify) and return live proof. Never answer with an architecture proposal or a phased plan.',
    };
  }

  if (asksToBuildApp(normalized) && !isSelfDeveloperExecutionPrompt(normalized)) {
    return {
      semanticIntent: 'app_build_planning',
      route: 'gpt_conversation',
      useTools: false,
      toolHints: ['app_planning_mode'],
      requiresLongResponse: true,
      requiresTaskDecomposition: true,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner asked to build a new app/product (e.g. "an app like X"). Enter senior product-engineering planning mode: propose architecture, break down modules, list required repo work/actions, give a concrete execution plan, and state what can be executed now vs. what needs approval/credentials. Never reply with only a generic timeline.',
    };
  }

  if (isSelfDeveloperExecutionPrompt(normalized)) {
    return {
      semanticIntent: 'self_developer_execution',
      route: 'self_developer',
      useTools: true,
      toolHints: ['run_ivx_senior_developer_task'],
      requiresLongResponse: false,
      requiresTaskDecomposition: true,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner explicitly requested a self-developer execution task (fix, build, run tests, deploy, complete task). Route to the senior developer runtime to create a real job, inspect files, and return live proof.',
    };
  }

  if (explicitlyNeedsLiveTools(normalized)) {
    return {
      semanticIntent: 'explicit_tool_request',
      route: 'tool_grounded_gpt',
      useTools: true,
      toolHints: ['explicit_live_tool_request'],
      requiresLongResponse,
      requiresTaskDecomposition,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner explicitly requested live inspection/query/check/list behavior.',
    };
  }

  if (requiresLongResponse) {
    return {
      semanticIntent: 'long_structured_response',
      route: 'gpt_conversation',
      useTools: false,
      toolHints: [],
      requiresLongResponse,
      requiresTaskDecomposition,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner requested a long structured answer; route to GPT conversation and preserve structure instead of shortening or using a status tool.',
    };
  }

  if (requiresTaskDecomposition) {
    return {
      semanticIntent: 'multi_step_task',
      route: 'gpt_conversation',
      useTools: false,
      toolHints: [],
      requiresLongResponse,
      requiresTaskDecomposition,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner asked for decomposition/planning; GPT should produce an orchestrated multi-step plan unless live tools are explicitly requested.',
    };
  }

  // A long, structured owner command / task block (e.g. "BLOCK 28 ... Engine /
  // Create: ... / Track: ...") that did not match a more specific execution route
  // must be PRESERVED and decomposed — never answered as a short clarification or a
  // generic one-liner. This is the safety net that guarantees the latest long owner
  // instruction is processed end-to-end instead of being misread.
  if (isExecutionOrTaskBlock) {
    return {
      semanticIntent: 'multi_step_task',
      route: 'gpt_conversation',
      useTools: false,
      toolHints: [],
      requiresLongResponse: true,
      requiresTaskDecomposition: true,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'The owner sent a long structured command / task block. Preserve the full instruction verbatim, decompose it into ordered steps, and execute/route it — never answer with an unrelated clarification (location/time) or a generic one-liner.',
    };
  }

  if (asksForDealReview(normalized)) {
    return {
      semanticIntent: 'deal_review',
      route: 'gpt_conversation',
      useTools: false,
      toolHints: [],
      requiresLongResponse: false,
      requiresTaskDecomposition: false,
      memoryMode: 'load_recent_and_persist_turn',
      fallbackPolicy: 'fail_visible_not_canned',
      reason: 'Deal review is a reasoning task; use GPT conversation unless the owner provides or requests live data tools.',
    };
  }


  return {
    semanticIntent: 'normal_question',
    route: 'gpt_conversation',
    useTools: false,
    toolHints: [],
    requiresLongResponse: false,
    requiresTaskDecomposition: false,
    memoryMode: 'load_recent_and_persist_turn',
    fallbackPolicy: 'fail_visible_not_canned',
    reason: 'Default path: normal owner question should be answered by GPT conversational reasoning, not a status/tool template.',
  };
}
