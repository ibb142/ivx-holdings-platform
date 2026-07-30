/**
 * IVX Authoritative Intent Router — Two-Stage Classification.
 *
 * This is the SINGLE source of truth for message routing. No other router
 * may override its decision. It implements:
 *
 *   STAGE 1 — Deterministic Safety Router
 *     Checks owner auth, explicit execution verbs, destructive actions,
 *     production scope, manual-answer override, public/private boundary.
 *     Always has final authority over destructive actions.
 *
 *   STAGE 2 — Semantic Intent Classifier
 *     Determines the specific intent (explanation, diagnostic, architecture,
 *     code_review, etc.) and selects the correct route.
 *
 * Every classification returns a full decision object with traceId for
 * observability.
 */

import { randomUUID } from 'node:crypto';

// ─── Intent Taxonomy (Item 1) ─────────────────────────────────────────

export type IVXIntent =
  | 'explanation'
  | 'diagnostic'
  | 'architecture'
  | 'code_review'
  | 'code_change'
  | 'deployment'
  | 'task_status'
  | 'data_query'
  | 'business_analysis'
  | 'conversation'
  | 'memory_write'
  | 'memory_read'
  | 'memory_delete'
  | 'app_generator'
  | 'manual_answer'
  | 'clarification_required';

export type IVXRoute =
  | 'LLM_TEXT_RESPONSE'
  | 'LLM_TOOL_GROUNDED'
  | 'DEVELOPER_WORKER'
  | 'DEPLOYMENT_ACTION'
  | 'STATUS_QUERY'
  | 'DATA_QUERY'
  | 'BUSINESS_MODULE'
  | 'MANUAL_LLM_RESPONSE'
  | 'APP_GENERATOR'
  | 'MEMORY_READ'
  | 'MEMORY_WRITE'
  | 'MEMORY_DELETE'
  | 'CLARIFICATION'
  | 'PUBLIC_LLM_RESPONSE';

export type IVXAuthDecision = 'owner_authenticated' | 'owner_required' | 'public_allowed' | 'public_blocked';

export type IVXIntentDecision = {
  intent: IVXIntent;
  confidence: number;
  actionRequired: boolean;
  toolsAllowed: boolean;
  ownerAuthRequired: boolean;
  destructiveAction: boolean;
  selectedRoute: IVXRoute;
  reason: string;
  traceId: string;
  // Stage 1 safety result
  safetyStage: {
    manualOverride: boolean;
    executionVerb: boolean;
    destructiveDetected: boolean;
    productionScope: boolean;
    publicBoundary: 'owner_only' | 'public_safe' | 'public_blocked';
    authDecision: IVXAuthDecision;
  };
  // Stage 2 semantic result
  semanticStage: {
    matchedPatterns: string[];
    rejectedPatterns: string[];
  };
};

// ─── Helpers ──────────────────────────────────────────────────────────

function normalize(text: string): string {
  return (text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// ─── Stage 1: Deterministic Safety Router ─────────────────────────────

const MANUAL_ANSWER_DIRECTIVES: RegExp[] = [
  /\bno\s+tools?\b/i,
  /\bmanual\s+answer\b/i,
  /\banswer\s+only\b/i,
  /\bdo\s+not\s+execute\b/i,
  /\bexplain\s+only\b/i,
  /\bdo\s+not\s+deploy\b/i,
  /\bno\s+code\s+changes?\b/i,
  /\bwithout\s+tools?\b/i,
  /\bplain\s+text\b/i,
  /\bno\s+execution\b/i,
];

const EXECUTION_VERBS: RegExp[] = [
  /\bfix\s+(?:this|that|the|it)\b/i,
  /\bpatch\s+(?:this|that|the|it)\b/i,
  /\bcommit\s+(?:this|that|the|it|now)\b/i,
  /\bpush\s+to\s+github\b/i,
  /\bdeploy\s+(?:this|that|the|it|now|live)\b/i,
  /\btrigger\s+(?:a\s+)?deploy\b/i,
  /\brollback\s+production\b/i,
  /\brun\s+(?:the\s+)?tests?\b/i,
  /\bbuild\s+the\s+apk\b/i,
  /\bcreate\s+(?:the\s+)?(?:module|file|component)\s+(?:and|then)\s+(?:deploy|commit|push)\b/i,
  /\bedit\s+(?:the\s+)?code\b/i,
  /\bimplement\s+(?:this|that|the)\s+(?:feature|fix|module)\b/i,
  /\brun\s+a\s+senior\s+developer\s+task\b/i,
];

const DESTRUCTIVE_PATTERNS: RegExp[] = [
  /\bdelete\s+(?:the\s+)?(?:database|table|record|production)\b/i,
  /\bdrop\s+(?:table|database|schema)\b/i,
  /\bwipe\b/i,
  /\btruncate\b/i,
  /\brollback\s+production\b/i,
  /\bremove\s+(?:rork|all\s+data|production)\b/i,
];

const PRODUCTION_SCOPE_PATTERNS: RegExp[] = [
  /\bproduction\b/i,
  /\blive\s+deploy\b/i,
  /\bprod\b/i,
  /\brender\b/i,
  /\bgithub\s+(?:main|push|commit)\b/i,
];

const EXPLICIT_EXECUTION_TRIGGERS: RegExp[] = [
  /\bfix\s+(?:this|that|the)\b.*\b(?:and\s+)?deploy\b/i,
  /\bpatch\s+(?:this|that|the)\b.*\b(?:and\s+)?(?:commit|push|deploy)\b/i,
  /\bcommit\s+(?:this|that|the)\b.*\b(?:and\s+)?(?:push|deploy)\b/i,
  /\bbuild\s+(?:this|that|the)\b.*\b(?:and\s+)?(?:deploy|ship)\b/i,
  /\brun\s+a\s+senior\s+developer\s+task\b/i,
  /\bfix\s+(?:this|that|the)\s+(?:bug|error|issue)\s+(?:and\s+)?(?:deploy|commit|push)\b/i,
  /\bimplement\s+(?:this|that|the)\s+(?:feature|fix)\s+(?:and\s+)?(?:deploy|commit)\b/i,
  // Creation + deploy/commit patterns — "create a new X and deploy", "build a new service and commit"
  /\b(?:create|build|implement|add|develop|write|scaffold)\b.{0,80}\b(?:and\s+)?(?:deploy|commit|push|ship)\b/i,
];

// ─── Stage 2: Semantic Intent Classifier ──────────────────────────────

const EXPLANATION_PATTERNS: RegExp[] = [
  /^(?:please\s+)?explain\b/i,
  /\bwhat\s+is\b/i,
  /\bwhat\s+does\b/i,
  /\bwhat\s+are\b/i,
  /\bwhat\s+does\s+.*\s+mean\s+in\s+practice\b/i,
  /\bwhen\s+(?:would|should)\s+(?:you|we|i)\s+choose\b/i,
  /\bwhy\s+(?:is|does|do|are|can|should)\b/i,
  /\bhow\s+(?:does|do|is|are|can|should)\s+(?:this|that|it|the)\s+work\b/i,
  /\bis\s+this\s+correct\b/i,
  /\bgive\s+me\s+(?:a\s+)?(?:map|opinion)\b/i,
  /\bsummarize\b/i,
  /\bcompare\b/i,
  /\bwhat\s+are\s+the\s+trade[-\s]?offs?\b/i,
  /\bdiagnose\s+conceptually\b/i,
  /\bwhat\s+is\s+the\s+(?:difference|time\s+complexity|space\s+complexity|big\s+o)\b/i,
  /\bwhat\s+is\s+the\s+(?:internal|capitalization|net\s+operating)\b/i,
];

// Calculation/quantitative patterns: math, finance, algorithms → LLM.
// These must be checked BEFORE the clarification fallback so "Calculate the IRR..."
// is never misclassified as ambiguous. Patterns match ANYWHERE in the text
// (not just at start) because calculation requests often appear after context
// like "A buyer offers 1.2M... Calculate the investor net...".
const CALCULATION_PATTERNS: RegExp[] = [
  /\b(?:calculate|compute|solve|derive|evaluate|determine)\b/i,
  /\bwhat\s+is\s+.*\s+(?:irr|npv|roi|cap\s+rate|noi|cash[-\s]?on[-\s]?cash|yield|return\s+on)\b/i,
  /\bif\s+.*\b(?:what|calculate|how\s+much|how\s+many)\b/i,
  /\bhow\s+much\s+(?:is|would|does|should|will|can|profit|loss|gain|was|were|did|do)\b/i,
  /\bhow\s+much\s+profit\b/i,
  /\bhow\s+much\s+(?:did|do|does)\s+i\s+(?:make|earn|profit|lose|gain)\b/i,
  /\bwhat\s+is\s+the\s+.*\s+(?:value|cost|price|rate|return|split|share|net)\b/i,
  // Financial scenario with numbers + terms like "JV split", "closing costs", "cap rate"
  /\b(?:jv\s+split|closing\s+costs?|cap\s+rate|noi|cash[-\s]?on[-\s]?cash|irr|npv|roi|yield)\b.*\b(?:\d|percent|%)\b/i,
  /\b\d+\s*(?:m|k|million|thousand)\b.*\b(?:offer|value|price|cost|split|investor|buyer)\b/i,
];

const DIAGNOSTIC_PATTERNS: RegExp[] = [
  /\bdiagnose\s+(?:why|the|what)\b/i,
  /\bdebugging\s+(?:process|approach|methodology|steps)\b/i,
  /\b(?:systematic|step-by-step|methodical)\s+(?:debugging|troubleshooting|investigation|process|approach)\b/i,
  /\baudit\s+why\b/i,
  /\bfind\s+the\s+(?:likely\s+)?cause\b/i,
  /\banalyze\s+why\b/i,
  /\broot\s+cause\b/i,
  /\btrace\s+(?:the\s+)?(?:issue|bug|error|problem)\b/i,
  /\binvestigate\s+(?:why|the|what)\b/i,
  /\breview\s+why\b/i,
];

const ARCHITECTURE_PATTERNS: RegExp[] = [
  /\bdesign\s+(?:a|the|this|an)\s+(?:member|notification|system|module|app|service|architecture|component|pipeline|workflow|engine)\b/i,
  /\barchitecture\b/i,
  /\bgive\s+me\s+the\s+(?:complete|full)?\s*(?:architecture|design|technical\s+design)\b/i,
  /\bscreens?\s*,?\s*(?:database|tables?)\s*,?\s*(?:api|endpoints?)\b/i,
  /\bdatabase\s+tables?\s*,?\s*(?:api\s+)?endpoints?\b/i,
  /\bfile\s+structure\b/i,
  /\bevent\s+flow\b/i,
  /\bdeployment\s+plan\b/i,
];

const CODE_REVIEW_PATTERNS: RegExp[] = [
  /\breview\s+(?:this|that|the)\s+(?:code|architecture|function|component|file|snippet)\b/i,
  /\baudit\s+(?:this|that|the)\s+(?:code|architecture)\b/i,
  /\bfind\s+(?:the\s+)?bugs?\s+(?:in|of)\s+(?:this|that|the)\b/i,
  /\bwhat\s+(?:are|is)\s+the\s+(?:bugs?|vulnerabilities?|security\s+issues?)\b/i,
  /\blist\s+(?:every|all|the)\s+(?:bug|vulnerability|security\s+issue)\b/i,
  /\bgive\s+me\s+the\s+fixed\s+version\b/i,
  /\breview\s+(?:this|that)\s+for\s+(?:bugs|security|vulnerabilities)\b/i,
];

const CODE_CHANGE_PATTERNS: RegExp[] = [
  /\bfix\s+(?:this|that|the)\s+(?:code|bug|error|issue)\b/i,
  /\bpatch\s+(?:this|that|the)\s+(?:code|bug|file)\b/i,
  /\bedit\s+(?:the\s+)?(?:code|file|function|component)\b/i,
  /\bmodify\s+(?:the\s+)?(?:code|file|function)\b/i,
  /\bupdate\s+(?:the\s+)?(?:code|file|route|endpoint)\b/i,
  /\bcreate\s+(?:a\s+)?(?:new\s+)?(?:module|file|component|screen|function)\b/i,
  /\bimplement\s+(?:this|that|the)\s+(?:feature|fix|module|component|screen)\b/i,
  /\badd\s+(?:a\s+)?(?:retry|new|feature)\s+(?:button|component|module|screen|endpoint|route|page|service|hook|middleware|handler)\b/i,
  /\bwrite\s+(?:the\s+)?(?:code|tests?|fix|patch|implementation)\b/i,
  /\brefactor\s+(?:this|that|the)\b/i,
];

const DEPLOYMENT_PATTERNS: RegExp[] = [
  /\bdeploy\s+(?:this|that|the|it|now|live|to\s+(?:prod|production))\b/i,
  /\btrigger\s+(?:a\s+)?deploy\b/i,
  /\bpush\s+to\s+(?:github|production|live)\b/i,
  /\bcommit\s+(?:and\s+)?(?:push|deploy)\b/i,
  /\brollback\s+(?:production|deploy|the\s+deploy)\b/i,
  /\bbuild\s+(?:and\s+)?(?:deploy|ship)\b/i,
  /\bship\s+(?:this|that|the|it|now)\b/i,
  /\bredeploy\b/i,
  /\bgo\s+live\b/i,
  /\brelease\s+(?:to\s+)?(?:production|live|prod)\b/i,
];

const TASK_STATUS_PATTERNS: RegExp[] = [
  /\bwhat\s+is\s+the\s+(?:current\s+)?deployment\s+status\b/i,
  /\bshow\s+(?:me\s+)?the\s+last\s+(?:worker\s+)?task\b/i,
  /\bdid\s+ci\s+pass\b/i,
  /\bwhat\s+commit\s+is\s+live\b/i,
  /\bare\s+the\s+(?:\d+\s+)?agents?\s+running\b/i,
  /\bwhat\s+is\s+the\s+current\s+sha\b/i,
  /\bdeployment\s+status\b/i,
  /\bworker\s+(?:task|job)\s+status\b/i,
  /\bshow\s+(?:me\s+)?(?:the\s+)?(?:last\s+)?(?:proof|evidence)\b/i,
  /\bhealth\s+(?:check|status)\b/i,
];

const DATA_QUERY_PATTERNS: RegExp[] = [
  /\bshow\s+(?:me\s+)?(?:all\s+)?(?:the\s+)?(?:investors?|buyers?|members?|deals?|projects?|properties|offers?|applications?)\b/i,
  /\blist\s+(?:all\s+)?(?:investors?|buyers?|members?|deals?)\b/i,
  /\bhow\s+many\s+(?:investors?|buyers?|members?|deals?|projects?|properties)\b/i,
  /\bget\s+(?:the\s+)?(?:investor|buyer|member|deal)\s+(?:list|data|records?)\b/i,
  /\bquery\s+(?:the\s+)?(?:database|supabase|table)\b/i,
];

const BUSINESS_ANALYSIS_PATTERNS: RegExp[] = [
  /\breview\s+(?:this|that|the)\s+deal\b/i,
  /\bunderwrite\b/i,
  /\bcap\s+rate\b/i,
  /\bnoi\b/i,
  /\bcash[-\s]?on[-\s]?cash\b/i,
  /\bbest\s+(?:opportunity|investor|deal)\b/i,
  /\bopportunity\s+scan\b/i,
  /\bdaily\s+(?:improvement|self[-\s]?improvement)\b/i,
  /\bimprove\s+ivx\b/i,
  /\bmarket\s+analysis\b/i,
];

const CONVERSATION_PATTERNS: RegExp[] = [
  /^(?:hi|hello|hey|hola)\b/i,
  /^(?:thank|thanks|gracias)\b/i,
  /\bwhat\s+can\s+you\s+do\b/i,
  /\bhelp\b/i,
  /\byes\s+or\s+no\b/i,
];

// Memory read patterns: the owner asks IVX IA to recall what it remembers.
const MEMORY_READ_PATTERNS: RegExp[] = [
  /\bwhat\s+is\s+my\s+name\b/i,
  /\bwho\s+am\s+i\b/i,
  /\bdo\s+you\s+(?:know|remember)\s+me\b/i,
  /\bshow\s+(?:me\s+)?what\s+you\s+remember\b/i,
  /\bwhat\s+do\s+you\s+remember\b/i,
  /\bshow\s+(?:my\s+)?(?:memory|profile)\b/i,
  /\bwhat\s+do\s+you\s+know\s+about\s+me\b/i,
  /\bwhat\s+is\s+my\s+(?:company|preferred|role|email|language)\b/i,
  // Generic catch-all: "what is my X" / "what is my X address" / "what is my X number"
  /\bwhat\s+is\s+my\s+\w+(?:\s+\w+)?\b/i,
  /\bwhat'?s\s+my\s+\w+(?:\s+\w+)?\b/i,
  /\bdo\s+you\s+know\s+my\s+\w+/i,
];

// Memory delete/forget patterns: owner tells IVX IA to forget identity data.
const MEMORY_DELETE_PATTERNS: RegExp[] = [
  /\bforget\s+(?:this|my)\s+name\b/i,
  /\bforget\s+who\s+i\s+am\b/i,
  /\bforget\s+my\s+(?:company|role|email|language|profile)\b/i,
  /\bdelete\s+my\s+(?:name|profile|memory)\b/i,
  /\berase\s+(?:what\s+you\s+)?remember\b/i,
  /\bclear\s+(?:my\s+)?(?:memory|profile)\b/i,
  /\breset\s+my\s+(?:profile|memory)\b/i,
  // Generic catch-all patterns for any field name
  /\bforget\s+my\s+\w+(?:\s+\w+)?\b/i,
  /\bdelete\s+my\s+\w+(?:\s+\w+)?(?:\s+from\s+(?:memory|your\s+memory))?\b/i,
  /\bclear\s+my\s+\w+(?:\s+\w+)?\b/i,
  /\bremove\s+my\s+\w+(?:\s+\w+)?(?:\s+from\s+(?:your\s+)?memory)?\b/i,
  /\breset\s+(?:all\s+)?my\s+\w+(?:\s+\w+)?\b/i,
  /\bwipe\s+(?:my\s+)?(?:memory|profile|data)\b/i,
];

// Memory write patterns: the owner tells IVX IA to remember identity data.
// These run BEFORE the generic knowledge/execution classifier so "save my name"
// is not misread as a deploy or clarification request.
// Compound patterns catch multi-clause identity like "my company is X and I prefer
// to be called Y, remember this" which would otherwise fall to clarification.
const MEMORY_WRITE_PATTERNS: RegExp[] = [
  /\b(?:remember|save)\s+(?:that\s+)?my\s+name\s+is\s+(.+)$/i,
  /\bmy\s+name\s+is\s+(.+?)(?:\s+(?:and\s+)?(?:save|remember|store)\s+it)?$/i,
  /\b(?:remember|save)\s+(?:that\s+)?i\s*['’]?m\s+(.+)$/i,
  /\b(?:change|update)\s+my\s+name\s+to\s+(.+)$/i,
  /\bcall\s+me\s+(.+)$/i,
  /\b(?:save|remember|store)\s+my\s+name\s+as\s+(.+)$/i,
  /\b(?:remember|save)\s+(?:that\s+)?i\s+(?:work\s+at|am\s+(?:the\s+)?(?:owner|ceo|founder)\s+of)\s+(.+)$/i,
  /\b(?:remember|save)\s+(?:that\s+)?my\s+(?:company|role|email|language)\s+is\s+(.+)$/i,
  // Compound: "my company is X and I prefer to be called Y, remember this"
  /\bmy\s+(?:company|role|email|language)\s+is\s+.{2,60}?\b(?:and\s+)?(?:i\s+prefer\s+to\s+be\s+called|call\s+me|my\s+name\s+is)\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  // Standalone: "my company is X, remember this" (no remember/save prefix)
  /\bmy\s+(?:company|role|email|language)\s+is\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  // "I work at X, remember this" (no remember/save prefix)
  /\bi\s+(?:work\s+at|am\s+(?:the\s+)?(?:owner|ceo|founder)\s+of)\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  // "I prefer to be called X, remember this"
  /\bi\s+prefer\s+to\s+be\s+called\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  // "my preferred language is X, remember this" — adjective between "my" and field
  /\bmy\s+preferred\s+(?:language|name|company|role|email)\s+is\s+(.+?)(?:\s*,?\s*(?:please\s+)?(?:save|remember|store)\s+(?:this|it|that))?\.?$/i,
  // ── V7 generic catch-all patterns for ANY field name ──
  // "remember that my X is Y" / "save that my X is Y"
  /\b(?:remember|save)\s+(?:that\s+)?my\s+\w+(?:\s+\w+)?\s+is\s+(.+)$/i,
  // "remember my X is Y" (no "that")
  /\bremember\s+my\s+\w+(?:\s+\w+)?\s+is\s+(.+)$/i,
  // "save my X as Y" / "store my X as Y" — any field, not just name
  /\b(?:save|store)\s+my\s+\w+(?:\s+\w+)?\s+as\s+(.+)$/i,
  // "remember that I prefer X" / "remember that I like X" — preference save
  /\b(?:remember|save)\s+(?:that\s+)?i\s+(?:prefer|like|use|speak|focus\s+on)\s+(.+)$/i,
  // "my X is Y" standalone (no remember/save prefix) — catches "my birthday is March 15"
  /\bmy\s+(?:birthday|timezone|phone|address|company\s+name|investment\s+focus|preferred\s+language)\s+is\s+(.+)$/i,
  // "my X is Y" generic standalone for any 1-2 word field
  /\bmy\s+\w+\s+is\s+(.+)$/i,
];

// ─── App Generator Patterns ───────────────────────────────────────────

const APP_GENERATOR_PATTERNS: RegExp[] = [
  /\bcreate\s+(?:a\s+)?new\s+app\s+(?:from\s+scratch\s+)?(?:called|named)\b/i,
  /\bscaffold\s+(?:a\s+)?(?:new\s+)?(?:app|module|service)\s+(?:called|named)\b/i,
  /\bbuild\s+(?:a\s+)?new\s+(?:app|module|service|backend\s+service)\s+(?:called|named)\b/i,
  /\bgenerate\s+(?:a\s+)?(?:new\s+)?(?:app|module|service)\s+(?:called|named)\b/i,
  /\bcreate\s+(?:a\s+)?new\s+module\s+(?:called|named)\b/i,
  /\bcreate\s+(?:a\s+)?new\s+backend\s+service\s+(?:called|named)\b/i,
  /\bbuild\s+(?:a\s+)?new\s+service\s+(?:called|named)\b/i,
  /\bcreate\s+(?:a\s+)?new\s+expo\s+app\s+(?:called|named)\b/i,
  /\bcreate\s+(?:a\s+)?new\s+web\s+app\s+(?:called|named)\b/i,
  /\bscaffold\s+(?:a\s+)?new\s+(?:expo|react\s+native|mobile)\s+app\b/i,
];

// ─── Knowledge vs Execution Disambiguation ────────────────────────────

/**
 * Critical disambiguation: determines whether a prompt that contains
 * execution-sounding words (fix, code, build, deploy) is actually asking
 * for KNOWLEDGE (explanation/review/design) or EXECUTION (code change/deploy).
 *
 * This is the core fix for the 8/10 misroute problem. The old router
 * matched on keyword presence alone — "review this code" matched both
 * "code" (development target) and was treated as execution. This function
 * ensures that explanation/diagnostic/review/design questions are NEVER
 * classified as execution.
 */
function isKnowledgeRequest(text: string): boolean {
  // Leading explanation verbs take priority over everything
  const head = text.slice(0, 200);

  // Explicit execution conjunction overrides any knowledge pattern.
  // e.g. "Review this code and deploy it", "Fix the bug and commit it" → execution.
  if (/\b(?:and|then)\s+(?:fix|patch|repair|deploy|commit|push|ship|implement|build|create|edit|modify|update|remove|delete|write|refactor)\b/i.test(text)) {
    return false;
  }

  // "Explain X" / "What is X" / "Why is X" / "What does X do" → always knowledge
  if (/^(?:please\s+)?(?:explain|what\s+is|what\s+are|what\s+does|why\s+is|why\s+does|how\s+does|how\s+do|describe|define|summarize|compare|what\s+are\s+the\s+trade|calculate|compute|solve)/i.test(head)) {
    return true;
  }
  // "Explain" anywhere in the text (not just at start) is knowledge
  if (/\bexplain\b/i.test(text)) {
    if (/\b(?:and|then)\s+(?:fix|patch|repair|deploy|commit|push|ship|implement|build|create|edit|modify|update|remove|delete)\b/i.test(text)) {
      return false;
    }
    return true;
  }
  // "What are the trade-offs" anywhere → knowledge
  if (/\bwhat\s+are\s+the\s+trade[-\s]?offs?\b/i.test(text)) return true;
  // "Give me the (complete) architecture/design/map" anywhere → knowledge
  if (/\bgive\s+me\s+(?:a\s+|the\s+)?(?:complete\s+|full\s+)?(?:architecture|design|map|opinion|summary|overview|analysis)\b/i.test(text)) return true;
  // "Compare X vs Y" anywhere → knowledge
  if (/\bcompare\b/i.test(text) && !/\b(?:and|then)\s+(?:fix|patch|repair|deploy|commit|push|ship|implement|build|create)\b/i.test(text)) return true;
  // "Walk me through X" / "Tell me how to/why/about X" anywhere → knowledge
  if (/\b(?:walk\s+me\s+through|tell\s+me\s+how\s+to|tell\s+me\s+about|tell\s+me\s+why)\b/i.test(text)) return true;
  // "What is the difference" anywhere → knowledge
  if (/\bwhat\s+is\s+the\s+difference\b/i.test(text)) return true;
  // "Is this correct/safe/secure" anywhere → knowledge
  if (/\bis\s+this\s+(?:correct|safe|secure|right|wrong|good|bad)\b/i.test(text)) return true;

  // ── Diagnostic knowledge patterns ──
  // "Diagnose why X" / "Find the cause of X" → diagnostic knowledge
  if (/\b(?:diagnose|find\s+the\s+(?:likely\s+)?cause|root\s+cause|investigate\s+why|trace\s+(?:the\s+)?(?:issue|bug))\b/i.test(text)) {
    if (/\b(?:and|then)\s+(?:fix|patch|repair|deploy|commit|push|ship)\b/i.test(text)) return false;
    return true;
  }
  // "Audit why X" / "Review why X" / "Analyze why X" → diagnostic knowledge
  if (/\b(?:audit|review|analyze|analyse)\s+why\b/i.test(text)) {
    if (/\b(?:and|then)\s+(?:fix|patch|repair|deploy|commit|push|ship)\b/i.test(text)) return false;
    return true;
  }

  // ── Code review knowledge patterns ──
  // "Review this code/architecture/approach" / "Audit this architecture" → knowledge
  // Allow optional adjective words between determiner and noun (e.g. "this authentication approach")
  if (/\b(?:review|audit|analyze|analyse)\s+(?:this|that|the)\s+(?:\w+\s+)?(?:code|architecture|function|component|file|snippet|design|system|approach|pattern|strategy|implementation|module|service|endpoint|pipeline|workflow)\b/i.test(text)) {
    if (/\b(?:and|then)\s+(?:fix|patch|repair|deploy|commit|push|ship|implement|build|create|edit|modify|update|remove|delete)\b/i.test(text)) return false;
    return true;
  }
  // "What are the bugs/vulnerabilities" / "Give me the fixed version" → code review knowledge
  if (/\bwhat\s+(?:are|is)\s+the\s+(?:bugs?|vulnerabilities?|security\s+issues?)\b/i.test(text)) return true;
  if (/\bgive\s+me\s+the\s+fixed\s+version\b/i.test(text)) return true;
  if (/\blist\s+(?:every|all|the)\s+(?:bug|vulnerability|security\s+issue)\b/i.test(text)) return true;

  // ── Architecture knowledge patterns ──
  // "Design a X" / "Design the X" → architecture knowledge
  if (/\bdesign\s+(?:a|the|this|an|me)\b/i.test(text)) {
    if (/\b(?:and|then)\s+(?:build|deploy|commit|push|ship|implement|create|code)\b/i.test(text)) return false;
    return true;
  }

  // ── Additional knowledge patterns ──
  // "How do I fix each" / "How do I" → knowledge (not execution)
  if (/\bhow\s+do\s+i\b/i.test(text)) {
    if (/\b(?:and|then)\s+(?:deploy|commit|push|ship)\b/i.test(text)) return false;
    return true;
  }
  // "What are the N most likely causes" → diagnostic knowledge
  if (/\bwhat\s+are\s+the\s+\d+\s+most\s+likely\s+causes?\b/i.test(text)) return true;
  // "Summarize X" anywhere → knowledge
  if (/\bsummarize\b/i.test(text)) return true;

  // "Review this code" / "Audit this architecture" → knowledge (not execution)
  if (/\b(?:review|audit|analyze|analyse)\s+(?:this|that|the)\s+(?:\w+\s+)?(?:code|architecture|function|component|file|snippet|design|system|approach|pattern|strategy|implementation|module|service|endpoint|pipeline|workflow)\b/i.test(text)) {
    // BUT "review and fix" or "audit and deploy" → execution
    if (/\b(?:and|then)\s+(?:fix|patch|repair|deploy|commit|push|ship|implement|build|create|edit|modify|update|remove|delete)\b/i.test(text)) {
      return false;
    }
    return true;
  }

  // "Design X" → knowledge (architecture), unless "design and build/deploy"
  if (/\bdesign\s+(?:a|the|this|an|me)\b/i.test(text)) {
    if (/\b(?:and|then)\s+(?:build|deploy|commit|push|ship|implement|create|code)\b/i.test(text)) {
      return false;
    }
    return true;
  }

  // "Give me the architecture / design / map / opinion" → knowledge
  if (/\bgive\s+me\s+(?:a\s+|the\s+)?(?:architecture|design|map|opinion|summary|overview|analysis)\b/i.test(text)) {
    return true;
  }

  // "Diagnose why X" / "Find the cause of X" → diagnostic knowledge
  if (/\b(?:diagnose|find\s+the\s+(?:likely\s+)?cause|root\s+cause|investigate\s+why|trace\s+(?:the\s+)?(?:issue|bug))\b/i.test(text)) {
    // "diagnose and fix" → execution
    if (/\b(?:and|then)\s+(?:fix|patch|repair|deploy|commit|push|ship)\b/i.test(text)) {
      return false;
    }
    return true;
  }

  // "What are the bugs/vulnerabilities" / "Give me the fixed version" → code review (knowledge)
  if (/\bwhat\s+(?:are|is)\s+the\s+(?:bugs?|vulnerabilities?|security\s+issues?)\b/i.test(text)) {
    return true;
  }
  if (/\bgive\s+me\s+the\s+fixed\s+version\b/i.test(text)) {
    return true;
  }
  if (/\blist\s+(?:every|all|the)\s+(?:bug|vulnerability|security\s+issue)\b/i.test(text)) {
    return true;
  }

  // "Walk me through X" / "Tell me how to X" → knowledge
  if (/\b(?:walk\s+me\s+through|tell\s+me\s+how\s+to|tell\s+me\s+about|tell\s+me\s+why)\b/i.test(text)) {
    return true;
  }

  // "What is the difference between X and Y" → knowledge
  if (/\bwhat\s+is\s+the\s+difference\b/i.test(text)) {
    return true;
  }

  // "Is this correct" / "Is this safe" → knowledge
  if (/\bis\s+this\s+(?:correct|safe|secure|right|wrong|good|bad)\b/i.test(text)) {
    return true;
  }

  // "What does X mean in practice" → explanation knowledge (e.g. "you build it, you run it")
  if (/\bwhat\s+does\s+.*\s+mean\s+in\s+practice\b/i.test(text)) return true;

  // "When would you choose X over Y" / "When should we choose" → evaluation knowledge
  if (/\bwhen\s+(?:would|should)\s+(?:you|we|i)\s+choose\b/i.test(text)) return true;
  if (/\bchoose\s+(?:a|an\s+)?\w+\s+over\s+\w+/i.test(text)) return true;

  // "Systematic debugging process" / "methodical troubleshooting" → diagnostic knowledge
  if (/\b(?:systematic|step-by-step|methodical)\s+(?:debugging|troubleshooting|investigation|process|approach|methodology)\b/i.test(text)) return true;
  if (/\bdebugging\s+(?:process|approach|methodology|steps)\b/i.test(text)) return true;

  // "Janky" / performance-problem explanations with concrete causes/fixes
  if (/\b(?:janky|laggy|stutter|unresponsive|slow)\b/i.test(text) && /\b(?:explain|why|causes|fixes|optimize|performance|real|concrete|specific)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:real|actual|concrete|specific)\s+(?:causes?|fixes|solutions?)\b/i.test(text)) return true;
  if (/\b(?:list|give)\s+(?:the|me)\s+(?:real|actual|concrete|specific)?\s*(?:causes?|fixes|solutions?)\b/i.test(text)) return true;

  return false;
}

/**
 * Determines if a prompt is an explicit execution command requiring
 * the developer worker. Must have BOTH an execution verb AND a concrete
 * target, AND must NOT be a knowledge request.
 */
function isExplicitExecution(text: string): boolean {
  // Knowledge requests are never execution, even if they contain execution words
  if (isKnowledgeRequest(text)) {
    return false;
  }

  // Check for explicit execution trigger patterns
  for (const pattern of EXPLICIT_EXECUTION_TRIGGERS) {
    if (pattern.test(text)) {
      return true;
    }
  }

  // "Fix X and deploy" / "Patch X and commit" / "Create X and deploy" / "Build X and commit"
  // Any creation/build/fix verb + deploy/commit/push/ship → execution
  if (/\b(?:fix|patch|repair|create|build|implement|add|develop|write|scaffold|generate)\b.{0,80}\b(?:and\s+)?(?:deploy|commit|push|ship)\b/i.test(text)) {
    return true;
  }

  // "Patch the X bug" / "Fix the X bug" / "Fix this bug now" (without "and deploy") → still execution
  // Broadened from [a-z][-\s]*bug to \w+[-\s]*bug so "this bug", "that bug", "the bug" all match.
  if (/\b(?:patch|fix)\s+(?:the\s+|this\s+|that\s+)?(?:\w+[-\s]*bug|duplicate[-\s]*message|issue|error|problem)\b/i.test(text)) {
    return true;
  }
  // Standalone "fix this bug now" / "fix the bug" / "fix it now" → execution
  if (/\b(?:fix|patch)\s+(?:this|that|the|it)\b/i.test(text)) {
    return true;
  }

  // "Add a X and commit it" / "Add X and commit" / "Add X and deploy" → execution
  if (/\badd\b.{0,80}\b(?:and\s+)?(?:commit|deploy|push|ship)\b/i.test(text)) {
    return true;
  }

  // "Create a new X" / "Implement a new X" / "Build a new X" (without "and deploy")
  // → still execution when the target is a code artifact (endpoint, route, page, module, service, etc.)
  if (/\b(?:create|implement|build|develop|scaffold|write)\s+(?:a\s+)?(?:new\s+)?(?:api\s+)?(?:endpoint|route|page|module|service|component|screen|hook|feature|function|middleware|handler|dashboard|widget)\b/i.test(text)) {
    return true;
  }

  // "Deploy the approved SHA" / "Deploy X to production" / "Deploy this now" → execution
  if (/\bdeploy\s+(?:the\s+)?(?:approved\s+)?(?:sha|code|build|version|commit|changes?|this|that|it|now|live)\b/i.test(text)) {
    return true;
  }
  if (/\bdeploy\s+.{0,40}\bto\s+(?:prod|production|live)\b/i.test(text)) {
    return true;
  }
  // "Trigger a deploy" / "Trigger deploy now" → execution
  if (/\btrigger\s+(?:a\s+)?deploy\b/i.test(text)) {
    return true;
  }
  // "Commit and push" / "Commit this" / "Push to github" → execution (standalone, no "fix X and deploy" needed)
  if (/\bcommit\s+(?:and\s+)?(?:push|to\s+github|this|that|it|now)\b/i.test(text)) {
    return true;
  }
  if (/\bpush\s+(?:this|that|it|now|to\s+github)\b/i.test(text)) {
    return true;
  }
  // "Run a senior developer task: <goal>"
  if (/\brun\s+a\s+senior\s+developer\s+task\b/i.test(text)) {
    return true;
  }

  if (/\brun\s+(?:the\s+)?(?:complete\s+|full\s+)?(?:test\s+suite|validation|tests?|checks?|qa\s+tests?)\b/i.test(text)) {
    // "How to run tests" is knowledge, not execution
    if (/\bhow\s+to\b/i.test(text)) {
      return false;
    }
    return true;
  }

  // "scan for dead code" / "scan the codebase" / "scan for unused" / "scan the codebase for unused files" → execution
  if (/\bscan\s+(?:for|the)\s+(?:dead\s+code|unused|duplicate|codebase)\b/i.test(text)) {
    return true;
  }
  // "scan the codebase for X" → execution (broader catch-all)
  if (/\bscan\s+the\s+codebase\b/i.test(text)) {
    return true;
  }
  // "run QA" / "run the QA" → execution
  if (/\brun\s+(?:the\s+)?qa\b/i.test(text)) {
    if (/\bhow\s+to\b/i.test(text)) return false;
    return true;
  }

  return false;
}

// ─── Public Chat Boundary ─────────────────────────────────────────────

const PUBLIC_SAFE_INTENTS: Set<IVXIntent> = new Set([
  'explanation',
  'architecture',
  'code_review',
  'conversation',
  'business_analysis',
]);

const PUBLIC_BLOCKED_PATTERNS: RegExp[] = [
  /\bcommit\b.{0,40}\b(?:push|to\s+github)\b/i,
  /\bpush\s+to\s+github\b/i,
  /\bdeploy\s+(?:this|that|live|now|to\s+prod|the)\b/i,
  /\bfix\b.{0,40}\bdeploy\b/i,
  /\bpatch\b.{0,40}\b(?:deploy|commit|push)\b/i,
  /\bdelete\s+(?:the\s+)?(?:database|table|record|production)\b/i,
  /\brun\s+a\s+senior\s+developer\s+task\b/i,
  /\brun\s+(?:the\s+)?(?:complete\s+|full\s+)?(?:test\s+suite|validation|tests?)\b/i,
  /\bowner\s+(?:secret|password|token|key)\b/i,
  /\bservice\s+role\b/i,
];

function isPublicSafe(text: string): boolean {
  for (const pattern of PUBLIC_BLOCKED_PATTERNS) {
    if (pattern.test(text)) {
      return false;
    }
  }
  return true;
}

// ─── Main Router ──────────────────────────────────────────────────────

export type RouterInput = {
  message: string;
  isOwner: boolean;
  isPublicPath: boolean;
  hasImageAttachments?: boolean;
};

export function classifyIntent(input: RouterInput): IVXIntentDecision {
  const traceId = `trace-${randomUUID().slice(0, 12)}`;
  const text = normalize(input.message);
  const matchedPatterns: string[] = [];
  const rejectedPatterns: string[] = [];

  // ═════════════════════════════════════════════════════════════════════
  // STAGE 1: Deterministic Safety Router
  // ═════════════════════════════════════════════════════════════════════

  const manualOverride = MANUAL_ANSWER_DIRECTIVES.some((p) => {
    if (p.test(text)) {
      matchedPatterns.push(`manual_directive:${p.source}`);
      return true;
    }
    return false;
  });

  const executionVerb = EXECUTION_VERBS.some((p) => p.test(text));
  const destructiveDetected = DESTRUCTIVE_PATTERNS.some((p) => p.test(text));
  const productionScope = PRODUCTION_SCOPE_PATTERNS.some((p) => p.test(text));

  // Public/private boundary
  let publicBoundary: 'owner_only' | 'public_safe' | 'public_blocked' = 'owner_only';
  let authDecision: IVXAuthDecision = 'owner_authenticated';

  if (input.isPublicPath) {
    if (!isPublicSafe(text)) {
      publicBoundary = 'public_blocked';
      authDecision = 'public_blocked';
    } else {
      publicBoundary = 'public_safe';
      authDecision = 'public_allowed';
    }
  } else {
    if (!input.isOwner) {
      authDecision = 'owner_required';
      publicBoundary = 'owner_only';
    }
  }

  // ═════════════════════════════════════════════════════════════════════
  // STAGE 2: Semantic Intent Classifier
  // ═════════════════════════════════════════════════════════════════════

  let intent: IVXIntent = 'conversation';
  let confidence = 0.5;
  let toolsAllowed = false;
  let actionRequired = false;

  // ── Manual answer override (Item 4) ──
  if (manualOverride) {
    intent = 'manual_answer';
    confidence = 0.95;
    matchedPatterns.push('manual_override_active');
    // Strip the manual directive from the message and classify the REMAINING text
    // to determine what tools would have been used (but won't be)
    const strippedText = text.replace(MANUAL_ANSWER_DIRECTIVES.join('|'), '').trim();
    // The remaining text is still classified for route selection,
    // but tools are disabled and execution is bypassed
    if (strippedText.length > 10) {
      // Classify the actual question
      if (EXPLANATION_PATTERNS.some((p) => p.test(strippedText))) {
        intent = 'manual_answer';
        confidence = 0.97;
      } else if (CODE_REVIEW_PATTERNS.some((p) => p.test(strippedText))) {
        intent = 'manual_answer';
        confidence = 0.97;
      } else if (ARCHITECTURE_PATTERNS.some((p) => p.test(strippedText))) {
        intent = 'manual_answer';
        confidence = 0.97;
      } else if (DIAGNOSTIC_PATTERNS.some((p) => p.test(strippedText))) {
        intent = 'manual_answer';
        confidence = 0.97;
      }
    }
    return buildDecision({
      intent,
      confidence,
      actionRequired: false,
      toolsAllowed: false,
      ownerAuthRequired: false,
      destructiveAction: false,
      selectedRoute: 'MANUAL_LLM_RESPONSE',
      reason: 'Manual answer mode: bypassing all executors, tools, and deployment. Question forwarded to LLM for text-only response.',
      traceId,
      safetyStage: { manualOverride: true, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Public path blocked intents ──
  if (input.isPublicPath && publicBoundary === 'public_blocked') {
    return buildDecision({
      intent: 'clarification_required',
      confidence: 0.99,
      actionRequired: false,
      toolsAllowed: false,
      ownerAuthRequired: true,
      destructiveAction: destructiveDetected,
      selectedRoute: 'CLARIFICATION',
      reason: 'Public path: this request requires owner authentication. Safe technical and educational questions are allowed without auth.',
      traceId,
      safetyStage: { manualOverride: false, executionVerb, destructiveDetected, productionScope, publicBoundary, authDecision },
      semanticStage: { matchedPatterns: ['public_blocked'], rejectedPatterns },
    });
  }

  // ── Memory commands — checked BEFORE knowledge/execution so "save my name" / "what is my name" are never misclassified as clarification or deploy. ──
  if (!input.isPublicPath) {
    const memoryWriteMatch = MEMORY_WRITE_PATTERNS.find((p) => {
      const hit = p.test(text);
      if (hit) matchedPatterns.push(`memory_write:${p.source}`);
      return hit;
    });
    if (memoryWriteMatch) {
      return buildDecision({
        intent: 'memory_write',
        confidence: 0.97,
        actionRequired: true,
        toolsAllowed: false,
        ownerAuthRequired: !input.isOwner,
        destructiveAction: false,
        selectedRoute: 'MEMORY_WRITE',
        reason: 'Memory write: owner is explicitly saving identity/profile information to the durable memory store.',
        traceId,
        safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
        semanticStage: { matchedPatterns, rejectedPatterns },
      });
    }

    const memoryReadMatch = MEMORY_READ_PATTERNS.find((p) => {
      const hit = p.test(text);
      if (hit) matchedPatterns.push(`memory_read:${p.source}`);
      return hit;
    });
    if (memoryReadMatch) {
      return buildDecision({
        intent: 'memory_read',
        confidence: 0.96,
        actionRequired: false,
        toolsAllowed: false,
        ownerAuthRequired: !input.isOwner,
        destructiveAction: false,
        selectedRoute: 'MEMORY_READ',
        reason: 'Memory read: owner is asking IVX IA to recall the remembered profile from the durable memory store.',
        traceId,
        safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
        semanticStage: { matchedPatterns, rejectedPatterns },
      });
    }

    const memoryDeleteMatch = MEMORY_DELETE_PATTERNS.find((p) => {
      const hit = p.test(text);
      if (hit) matchedPatterns.push(`memory_delete:${p.source}`);
      return hit;
    });
    if (memoryDeleteMatch) {
      return buildDecision({
        intent: 'memory_delete',
        confidence: 0.95,
        actionRequired: true,
        toolsAllowed: false,
        ownerAuthRequired: !input.isOwner,
        destructiveAction: false,
        selectedRoute: 'MEMORY_DELETE',
        reason: 'Memory delete: owner is asking IVX IA to forget/erase identity data from the durable memory store.',
        traceId,
        safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
        semanticStage: { matchedPatterns, rejectedPatterns },
      });
    }
  }

  // ── Status queries → STATUS_QUERY (checked BEFORE knowledge) ──
  // Status questions like "What is the current deployment status?" start with
  // "what is" which would be caught by isKnowledgeRequest. Check status first.
  if (TASK_STATUS_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`status:${p.source}`); return true; } return false; })) {
    return buildDecision({
      intent: 'task_status',
      confidence: 0.92,
      actionRequired: false,
      toolsAllowed: true,
      ownerAuthRequired: !input.isOwner && !input.isPublicPath,
      destructiveAction: false,
      selectedRoute: input.isPublicPath ? 'PUBLIC_LLM_RESPONSE' : 'STATUS_QUERY',
      reason: 'Status query: routed to status/health check tools. Read-only, no side effects.',
      traceId,
      safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Calculation requests → LLM (checked BEFORE knowledge for priority) ──
  // Math, finance, and quantitative questions must reach the LLM, not clarification.
  if (CALCULATION_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`calculation:${p.source}`); return true; } return false; })) {
    return buildDecision({
      intent: 'explanation',
      confidence: 0.90,
      actionRequired: false,
      toolsAllowed: false,
      ownerAuthRequired: false,
      destructiveAction: false,
      selectedRoute: input.isPublicPath ? 'PUBLIC_LLM_RESPONSE' : 'LLM_TEXT_RESPONSE',
      reason: 'Calculation/quantitative request: routed to LLM for computation and explanation. No task creation, no commit, no deploy.',
      traceId,
      safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Knowledge requests → LLM (Item 2) ──
  // This is the CRITICAL fix: knowledge questions MUST go to the LLM,
  // never to the developer worker, even if they contain execution words.
  if (isKnowledgeRequest(text)) {
    // Determine specific knowledge intent
    if (DIAGNOSTIC_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`diagnostic:${p.source}`); return true; } return false; })) {
      intent = 'diagnostic';
      confidence = 0.92;
    } else if (CODE_REVIEW_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`code_review:${p.source}`); return true; } return false; })) {
      intent = 'code_review';
      confidence = 0.93;
    } else if (ARCHITECTURE_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`architecture:${p.source}`); return true; } return false; })) {
      intent = 'architecture';
      confidence = 0.92;
    } else {
      EXPLANATION_PATTERNS.forEach((p) => { if (p.test(text)) matchedPatterns.push(`explanation:${p.source}`); });
      intent = 'explanation';
      confidence = 0.90;
    }

    // Knowledge requests never trigger execution, deployment, or tools (unless tool-grounded is needed)
    const route: IVXRoute = input.isPublicPath ? 'PUBLIC_LLM_RESPONSE' : 'LLM_TEXT_RESPONSE';
    return buildDecision({
      intent,
      confidence,
      actionRequired: false,
      toolsAllowed: false,
      ownerAuthRequired: false,
      destructiveAction: false,
      selectedRoute: route,
      reason: `Knowledge request (${intent}): routed to LLM for text answer. No task creation, no commit, no deploy, no CI trigger.`,
      traceId,
      safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── App Generator → APP_GENERATOR route ──
  // Checked BEFORE execution and BEFORE knowledge requests because
  // "create a new app called X" is a creation command, not a question.
  // It must reach the app generator handler, not CLARIFICATION.
  if (APP_GENERATOR_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`app_generator:${p.source}`); return true; } return false; })) {
    return buildDecision({
      intent: 'app_generator',
      confidence: 0.95,
      actionRequired: true,
      toolsAllowed: true,
      ownerAuthRequired: true,
      destructiveAction: false,
      selectedRoute: 'APP_GENERATOR',
      reason: 'App creation request: routed to IVX app generator for blueprint generation. No deploy, no commit — owner approval required for scaffolding.',
      traceId,
      safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Explicit execution → Developer Worker (Item 3) ──
  if (isExplicitExecution(text)) {
    // Determine specific execution intent
    if (DEPLOYMENT_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`deployment:${p.source}`); return true; } return false; })) {
      intent = 'deployment';
      confidence = 0.95;
    } else {
      CODE_CHANGE_PATTERNS.forEach((p) => { if (p.test(text)) matchedPatterns.push(`code_change:${p.source}`); });
      intent = 'code_change';
      confidence = 0.93;
    }

    // Execution requires owner auth
    if (!input.isOwner && !input.isPublicPath) {
      return buildDecision({
        intent,
        confidence,
        actionRequired: true,
        toolsAllowed: true,
        ownerAuthRequired: true,
        destructiveAction: destructiveDetected,
        selectedRoute: 'CLARIFICATION',
        reason: 'Execution request requires owner authentication. Please sign in as the IVX owner.',
        traceId,
        safetyStage: { manualOverride: false, executionVerb: true, destructiveDetected, productionScope, publicBoundary, authDecision },
        semanticStage: { matchedPatterns, rejectedPatterns },
      });
    }

    // Destructive actions always require owner auth + confirmation
    if (destructiveDetected && !input.isOwner) {
      return buildDecision({
        intent,
        confidence: 0.99,
        actionRequired: true,
        toolsAllowed: false,
        ownerAuthRequired: true,
        destructiveAction: true,
        selectedRoute: 'CLARIFICATION',
        reason: 'Destructive action detected: requires owner authentication and explicit confirmation.',
        traceId,
        safetyStage: { manualOverride: false, executionVerb: true, destructiveDetected: true, productionScope, publicBoundary, authDecision },
        semanticStage: { matchedPatterns, rejectedPatterns },
      });
    }

    return buildDecision({
      intent,
      confidence,
      actionRequired: true,
      toolsAllowed: true,
      ownerAuthRequired: true,
      destructiveAction: destructiveDetected,
      selectedRoute: 'DEVELOPER_WORKER',
      reason: `Execution request (${intent}): routed to owner-gated developer worker. Requires owner auth${destructiveDetected ? ' + explicit confirmation for destructive action' : ''}.`,
      traceId,
      safetyStage: { manualOverride: false, executionVerb: true, destructiveDetected, productionScope, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Task status → Status Query ──
  if (TASK_STATUS_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`status:${p.source}`); return true; } return false; })) {
    intent = 'task_status';
    confidence = 0.90;
    return buildDecision({
      intent,
      confidence,
      actionRequired: false,
      toolsAllowed: true,
      ownerAuthRequired: input.isOwner ? false : true,
      destructiveAction: false,
      selectedRoute: 'STATUS_QUERY',
      reason: 'Status query: routed to status/health check tools. Read-only, no side effects.',
      traceId,
      safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Data query ──
  if (DATA_QUERY_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`data_query:${p.source}`); return true; } return false; })) {
    intent = 'data_query';
    confidence = 0.88;
    return buildDecision({
      intent,
      confidence,
      actionRequired: false,
      toolsAllowed: true,
      ownerAuthRequired: true,
      destructiveAction: false,
      selectedRoute: 'DATA_QUERY',
      reason: 'Data query: routed to read-only database/CRM query tools.',
      traceId,
      safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Business analysis ──
  if (BUSINESS_ANALYSIS_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`business:${p.source}`); return true; } return false; })) {
    intent = 'business_analysis';
    confidence = 0.88;
    return buildDecision({
      intent,
      confidence,
      actionRequired: false,
      toolsAllowed: true,
      ownerAuthRequired: false,
      destructiveAction: false,
      selectedRoute: 'BUSINESS_MODULE',
      reason: 'Business analysis: routed to business module (deal review, opportunity scan, etc.).',
      traceId,
      safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Conversation ──
  if (CONVERSATION_PATTERNS.some((p) => { if (p.test(text)) { matchedPatterns.push(`conversation:${p.source}`); return true; } return false; })) {
    intent = 'conversation';
    confidence = 0.85;
    const route: IVXRoute = input.isPublicPath ? 'PUBLIC_LLM_RESPONSE' : 'LLM_TEXT_RESPONSE';
    return buildDecision({
      intent,
      confidence,
      actionRequired: false,
      toolsAllowed: false,
      ownerAuthRequired: false,
      destructiveAction: false,
      selectedRoute: route,
      reason: 'Conversation: routed to LLM for direct text answer.',
      traceId,
      safetyStage: { manualOverride: false, executionVerb: false, destructiveDetected: false, productionScope: false, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Fallback: low confidence → clarification (Item 8) ──
  // If no pattern matched with high confidence, ask for clarification
  if (confidence < 0.70) {
    intent = 'clarification_required';
    confidence = 0.40;
    return buildDecision({
      intent,
      confidence,
      actionRequired: false,
      toolsAllowed: false,
      ownerAuthRequired: false,
      destructiveAction: false,
      selectedRoute: 'CLARIFICATION',
      reason: 'Low confidence classification: asking clarification before routing. No deploy, no task creation, no invented action.',
      traceId,
      safetyStage: { manualOverride: false, executionVerb, destructiveDetected, productionScope, publicBoundary, authDecision },
      semanticStage: { matchedPatterns, rejectedPatterns },
    });
  }

  // ── Default: treat as conversation → LLM ──
  intent = 'conversation';
  confidence = 0.70;
  const defaultRoute: IVXRoute = input.isPublicPath ? 'PUBLIC_LLM_RESPONSE' : 'LLM_TEXT_RESPONSE';
  return buildDecision({
    intent,
    confidence,
    actionRequired: false,
    toolsAllowed: false,
    ownerAuthRequired: false,
    destructiveAction: false,
    selectedRoute: defaultRoute,
    reason: 'Default: no specific intent matched. Routed to LLM for conversational answer.',
    traceId,
    safetyStage: { manualOverride: false, executionVerb, destructiveDetected, productionScope, publicBoundary, authDecision },
    semanticStage: { matchedPatterns, rejectedPatterns },
  });
}

function buildDecision(fields: Omit<IVXIntentDecision, never>): IVXIntentDecision {
  return fields;
}

// ─── Clarification Question Builder (Item 8) ──────────────────────────

export function buildClarificationQuestion(originalMessage: string): string {
  const text = normalize(originalMessage);
  // Check if it seems like a knowledge question or execution request
  const hasExecutionWords = /\b(?:fix|patch|deploy|commit|push|build|implement|create)\b/i.test(text);
  const hasKnowledgeWords = /\b(?:explain|what|why|how|review|design|architecture|compare)\b/i.test(text);

  if (hasExecutionWords && hasKnowledgeWords) {
    return 'Do you want an explanation only, or do you want IVX IA to change the code and deploy it?';
  }
  if (hasExecutionWords) {
    return 'Do you want me to execute this change (fix, deploy, commit), or just explain how to do it?';
  }
  return 'Could you clarify what you are asking for — an explanation, a code review, a design, or an execution task?';
}

// ─── Truthful Response States (Item 10) ───────────────────────────────

export type IVXResponseState =
  | 'THINKING'
  | 'ANSWERING'
  | 'WAITING_FOR_CLARIFICATION'
  | 'WAITING_FOR_OWNER_APPROVAL'
  | 'EXECUTING'
  | 'TESTING'
  | 'COMMITTING'
  | 'DEPLOYING'
  | 'VERIFYING'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED';

export function stateForIntent(decision: IVXIntentDecision): IVXResponseState {
  switch (decision.selectedRoute) {
    case 'LLM_TEXT_RESPONSE':
    case 'PUBLIC_LLM_RESPONSE':
    case 'MANUAL_LLM_RESPONSE':
      return 'ANSWERING';
    case 'DEVELOPER_WORKER':
      return decision.destructiveAction ? 'WAITING_FOR_OWNER_APPROVAL' : 'EXECUTING';
    case 'DEPLOYMENT_ACTION':
      return 'WAITING_FOR_OWNER_APPROVAL';
    case 'STATUS_QUERY':
    case 'DATA_QUERY':
    case 'BUSINESS_MODULE':
      return 'ANSWERING';
    case 'CLARIFICATION':
      return 'WAITING_FOR_CLARIFICATION';
    default:
      return 'THINKING';
  }
}

// ─── Manual Answer Mode Helper (Item 4) ───────────────────────────────

/**
 * Strips manual-answer directives from a message so the clean question
 * can be forwarded to the LLM. This is the fix for the bug where
 * "no tools, explain X" returned "Manual answer mode is active" instead
 * of actually answering the question.
 */
export function stripManualDirectives(message: string): string {
  let cleaned = message;
  for (const pattern of MANUAL_ANSWER_DIRECTIVES) {
    cleaned = cleaned.replace(pattern, '');
  }
  // Clean up leading/trailing punctuation and whitespace left behind
  cleaned = cleaned.replace(/^[\s,;:.]+/, '').replace(/[\s,;:.]+$/, '').trim();
  return cleaned || message; // fall back to original if stripping removed everything
}

export function isManualAnswerMode(message: string): boolean {
  return MANUAL_ANSWER_DIRECTIVES.some((p) => p.test(normalize(message)));
}

// ─── Canned Response Detector (Item 6) ────────────────────────────────

const CANNED_RESPONSE_INDICATORS: RegExp[] = [
  /^I am IVX Enterprise Senior Developer mode\b/i,
  /^Manual answer mode is active\b/i,
  /^I will answer in plain text\b/i,
  /^What I do as an enterprise senior developer\b/i,
  /^STATUS: READY\b/i,
  /^I am IVX IA, the AI brain\b/i,
  /^Here is what I can do\b/i,
];

export function isCannedResponse(text: string): boolean {
  return CANNED_RESPONSE_INDICATORS.some((p) => p.test(text.trim()));
}

// ─── Observability (Item 14) ──────────────────────────────────────────

export type RoutingObservabilityRecord = {
  traceId: string;
  conversationId: string | null;
  messageId: string | null;
  classifiedIntent: IVXIntent;
  confidence: number;
  selectedRoute: IVXRoute;
  selectedAgent: string | null;
  toolsInvoked: string[];
  authDecision: IVXAuthDecision;
  approvalDecision: 'not_required' | 'pending' | 'approved' | 'denied' | 'timeout';
  startedAt: string;
  finishedAt: string | null;
  finalStatus: IVXResponseState;
  error: string | null;
  evidenceIds: string[];
};

export function createObservabilityRecord(
  decision: IVXIntentDecision,
  conversationId: string | null = null,
  messageId: string | null = null,
): RoutingObservabilityRecord {
  return {
    traceId: decision.traceId,
    conversationId,
    messageId,
    classifiedIntent: decision.intent,
    confidence: decision.confidence,
    selectedRoute: decision.selectedRoute,
    selectedAgent: null,
    toolsInvoked: [],
    authDecision: decision.safetyStage.authDecision,
    approvalDecision: decision.destructiveAction ? 'pending' : 'not_required',
    startedAt: new Date().toISOString(),
    finishedAt: null,
    finalStatus: stateForIntent(decision),
    error: null,
    evidenceIds: [],
  };
}
