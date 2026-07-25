/**
 * IVX IA Chat Execution Mode — Intent Classifier
 *
 * FINAL IVX IA CHAT EXECUTION MODE mandate (owner 2026-07-19):
 *   "Remove all narrative planning responses for requests classified as Developer."
 *
 * When the owner's prompt matches one of the 10 execution categories, the chat
 * becomes an EXECUTION CONSOLE — never a planning assistant. The 10 categories
 * are the owner's exact list:
 *
 *   fix · build · deploy · audit · QA · refactor · migration ·
 *   create module · create app · senior developer
 *
 * For any matched category the chat MUST:
 *   1. Classify the intent  →  this module.
 *   2. Create a persistent worker job  →  ivx-senior-developer-worker queue.
 *   3. Return HTTP 202 with taskId immediately  →  ivx-owner-ai.ts.
 *   4. Begin execution  →  worker drain loop.
 *   5. Stream live execution status  →  executionStatus JSON + statusUrl.
 *   6. Return only verified evidence from the worker.
 *
 * Pure + deterministic (no I/O, no AI gateway) so it is fully unit-testable.
 */

/** The 11 owner-mandated execution categories (10 execution + 1 read-only inspection). */
export type IVXExecutionModeCategory =
  | 'fix'
  | 'build'
  | 'deploy'
  | 'audit'
  | 'qa'
  | 'refactor'
  | 'migration'
  | 'create_module'
  | 'create_app'
  | 'senior_developer'
  | 'developer_inspection';

export type IVXExecutionModeClassification = {
  /** True when the prompt matches any of the 10 execution categories. */
  isExecutionMode: boolean;
  /** The matched category, or null when not an execution-mode prompt. */
  category: IVXExecutionModeCategory | null;
  /** Human-readable label for the matched category (for audit/proof). */
  categoryLabel: string;
  /** The exact trigger phrase that fired the classification (for proof). */
  matchedTrigger: string;
  /** Human-readable reason for the classification (audit trail). */
  reason: string;
};

/**
 * Category matchers, ordered most-specific first so "create module" wins over
 * bare "create" and "QA" wins over a generic "fix" mention. Each pattern is
 * anchored to whole-phrase semantics (no substring false positives).
 *
 * CRITICAL: the owner's mandate bans narrative planning for these categories.
 * A match means the chat returns HTTP 202 + taskId + executionStatus JSON —
 * never a conversational implementation plan.
 */
const CATEGORY_PATTERNS: Array<{
  category: IVXExecutionModeCategory;
  label: string;
  pattern: RegExp;
}> = [
  // ── Most specific composite intents first ──────────────────────────────
  {
    category: 'create_module',
    label: 'create module',
    // "create a module", "create module", "build a new module", "add module X"
    pattern:
      /\b(?:create|build|add|scaffold|make|generate)\b[^.]{0,30}\b(?:a\s+)?(?:new\s+)?(?:module|feature|service|component)\b/i,
  },
  {
    category: 'create_app',
    label: 'create app',
    // "create an app", "build a new app", "create app X", "scaffold app"
    pattern:
      /\b(?:create|build|scaffold|make|generate|spin\s+up|stand\s+up)\b[^.]{0,30}\b(?:a\s+)?(?:new\s+)?(?:app|application|mobile\s+app|ios\s+app|android\s+app|expo\s+app|swift\s+app|kotlin\s+app)\b/i,
  },
  {
    category: 'senior_developer',
    label: 'senior developer',
    pattern:
      /\b(?:senior\s+developer|senior\s+dev|staff\s+engineer|principal\s+engineer|lead\s+developer|enterprise\s+senior\s+developer|enterprise\s+senior\s+dev)\b/i,
  },
  {
    category: 'migration',
    label: 'migration',
    // "run a migration", "migrate the db", "schema migration", "supabase migration"
    pattern:
      /\b(?:migration|migrate|migrating|migrated|migrations|schema\s+(?:change|update|migrate)|db\s+migration|database\s+migration|supabase\s+migration|sql\s+migration)\b/i,
  },
  {
    category: 'refactor',
    label: 'refactor',
    pattern:
      /\b(?:refactor|refactoring|refactored|clean\s+up\s+(?:the\s+)?code|restructure(?:d)?\s+(?:the\s+)?(?:code|module|service)|reorganiz(?:e|ing|ed)\s+(?:the\s+)?(?:code|module|service))\b/i,
  },
  {
    category: 'qa',
    label: 'QA',
    pattern:
      /\b(?:qa|quality\s+assurance|run\s+(?:the\s+)?tests?|test\s+suite|run\s+typecheck|run\s+tsc|regression\s+(?:test|check|sweep)|smoke\s+test|verification\s+sweep|pre[-\s]?flight|pre[-\s]?submission)\b/i,
  },
  {
    category: 'audit',
    label: 'audit',
    pattern:
      /\b(?:audit|audited|auditing|inspect(?:ion)?|investigate|root\s+cause|end[-\s]to[-\s]end\s+(?:audit|review|trace)|forensic|review\s+(?:the\s+)?(?:code|system|production|backend|frontend|repo))\b/i,
  },
  {
    category: 'deploy',
    label: 'deploy',
    // Match "deploy live", "deploy to prod", "deploy now", "ship it", "go live"
    pattern:
      /\b(?:deploy(?:ed|ing|ment)?|ship\s+(?:it|this|that|now|today)|go\s+live|push\s+to\s+(?:prod|production|live|main)|release\s+to\s+(?:prod|production|live)|render\s+deploy|trigger\s+deploy)\b/i,
  },
  {
    category: 'build',
    label: 'build',
    // Match "build the apk", "build the app", "run a build", "build v1.4.14"
    pattern:
      /\b(?:build(?:ing)?\s+(?:the\s+)?(?:apk|aab|app|bundle|release|ipa|binary|version|v\d+\.\d+\.\d+)|run\s+a\s+build|gradle\s+build|run\s+gradle|assemble\s+release|produce\s+(?:the\s+)?(?:apk|aab|build))\b/i,
  },
  {
    category: 'fix',
    label: 'fix',
    // Match "fix this", "fix the chat", "patch the bug", "repair X", "resolve the issue"
    pattern:
      /\b(?:fix(?:ed|ing|es)?|patch(?:ed|ing)?|repair(?:ed|ing)?|resolve(?:d|ing)?\s+(?:the\s+)?(?:bug|issue|error|defect|problem)|debug\s+(?:this|that|the\s+\w+)|troubleshoot)\b/i,
  },
];

function normalize(value: string): string {
  return (typeof value === 'string' ? value : '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Classify an owner prompt into one of the 10 execution-mode categories.
 *
 * The first matching category wins (patterns are ordered most-specific first).
 * Returns `isExecutionMode: false` when the prompt is a normal conversation,
 * explanation request, or non-developer question — those still route through
 * the normal chat path. The chat model may explain architecture ONLY when the
 * user explicitly asks for an explanation ("explain how X works", "what is Y").
 */
export function classifyExecutionModeIntent(prompt: string): IVXExecutionModeClassification {
  const normalized = normalize(prompt);
  if (!normalized) {
    return {
      isExecutionMode: false,
      category: null,
      categoryLabel: '',
      matchedTrigger: '',
      reason: 'Empty prompt — no execution-mode category detected.',
    };
  }

  // ── Read-only developer inspection (owner mandate 2026-07-19) ──────────
  // BEFORE the explanation hatch and the category matchers: detect read-only
  // inspection intent. These prompts must route through the persistent worker
  // as a READ_ONLY job (no file edits / commit / deploy / migrations), never
  // through the narrative fallback model. Fires when an inspection signal is
  // combined with a read-only signal (in either order), or when the explicit
  // "read-only inspection" phrase appears.
  const INSPECTION_SIGNAL_PATTERN =
    /\b(?:inspect(?:ion)?(?:\s+(?:code|logs|the\s+\w+|this|that))?|audit\s+(?:the\s+)?code|trace\s+(?:the\s+)?(?:issue|bug|defect|root\s+cause)|report\s+(?:the\s+)?(?:current\s+)?task\s+status|verify\s+(?:the\s+)?(?:implementation|deploy|build)|diagnose\s+(?:the\s+)?(?:bug|issue|defect|root\s+cause))\b/i;
  const READ_ONLY_SIGNAL_PATTERN =
    /\b(?:do\s+not\s+(?:change|deploy|modify|edit|commit|push|apply|run|touch)|don'?t\s+(?:change|deploy|modify|edit|commit|push|apply|run|touch)|read[-\s]?only|no\s+changes?\s+(?:required|allowed|needed|made)|without\s+changing|without\s+deploying)\b/i;
  const EXPLICIT_READ_ONLY_INSPECTION_PATTERN = /\bread[-\s]?only\s+inspection\b/i;
  const hasInspectionSignal = INSPECTION_SIGNAL_PATTERN.test(normalized);
  const hasReadOnlySignal = READ_ONLY_SIGNAL_PATTERN.test(normalized);
  const hasExplicitInspection = EXPLICIT_READ_ONLY_INSPECTION_PATTERN.test(normalized);
  if ((hasInspectionSignal && hasReadOnlySignal) || hasExplicitInspection) {
    const trigger = hasExplicitInspection
      ? 'read-only inspection'
      : `${normalized.match(INSPECTION_SIGNAL_PATTERN)?.[0] ?? ''} + ${normalized.match(READ_ONLY_SIGNAL_PATTERN)?.[0] ?? ''}`.trim();
    return {
      isExecutionMode: true,
      category: 'developer_inspection',
      categoryLabel: 'developer inspection',
      matchedTrigger: trigger,
      reason: `Read-only developer inspection matched ("${trigger}"). Routes through the persistent worker as a READ_ONLY job: inspect files / search code / run read-only tests, NEVER edit/commit/deploy/migrate. Returns the strict inspection format (TASK ID / STATUS / MODE: READ_ONLY / FILES INSPECTED / COMMANDS RUN / FINDINGS / ROOT CAUSE / FILES CHANGED: NONE / COMMIT: NOT REQUESTED / DEPLOYMENT: NOT REQUESTED).`,
    };
  }

  // ── Execution-imperative override (owner 2026-07-20) ────────────────────
  // Prompts like "audit this chat why is a lot loading fix it end to end and
  // update deploy live" contain an inspection signal ("audit", "why") but the
  // dominant intent is FIX + DEPLOY LIVE. Without this override, the category
  // matchers would classify it as 'audit' and the runtime would return BLOCKED
  // with "no code change". The owner mandate is: when a prompt asks to fix AND
  // deploy, it must be an execution command and must attempt to build/deploy
  // even if the source already contains the fix.
  //
  // This override fires when the prompt contains an imperative execution clause
  // (fix it/this/that/the, update, patch, build, ship, upload) followed by a
  // deploy/live/release clause within 80 characters. It fires AFTER the
  // explanation-question hatch so pure questions like "what is the difference
  // between fix and deploy?" still escape, and BEFORE the category matchers so
  // execution intent always beats bare audit/inspect signals.
  const STRONG_EXECUTION_PATTERN =
    /\b(?:fix(?:\s+(?:it|this|that|the|a))?|update|patch|repair|debug|troubleshoot|build|ship|upload)\b[^.]{0,80}\b(?:deploy(?:\s+(?:live|to\s+(?:prod|production|main)))?|go\s+live|ship\s+(?:it|now|today)|release\s+(?:to\s+)?(?:prod|production|live))\b/i;
  const hasStrongExecution = STRONG_EXECUTION_PATTERN.test(normalized);
  if (hasStrongExecution && !hasReadOnlySignal) {
    const trigger = normalized.match(STRONG_EXECUTION_PATTERN)?.[0] ?? 'fix + deploy';
    return {
      isExecutionMode: true,
      category: 'fix',
      categoryLabel: 'fix',
      matchedTrigger: trigger,
      reason: `Strong execution-imperative override matched ("${trigger}"). The prompt asks to fix/deploy/build, so it is treated as an execution command, not a read-only inspection. Routes through the full developer_executor pipeline and attempts to build/deploy even if no code change is required.`,
    };
  }

  // Explanation escape hatch: "explain how X works", "what is Y", "describe Z"
  // are NOT execution commands — they are architecture-explanation requests
  // the chat model is allowed to answer narratively. This MUST fire BEFORE the
  // category matchers so a question that merely mentions a category verb (e.g.
  // "what is the difference between fix and build?") is treated as a pure
  // question, not an execution command.
  const EXPLANATION_QUESTION_PATTERN =
    /^\s*(?:explain|what\s+is|what\s+are|describe|how\s+does|how\s+do\s+(?:you|i)|teach\s+me|walk\s+me\s+through|clarify|elaborate\s+on|what\s+do\s+you\s+mean\s+by|what\s+does\s+it\s+mean)\b/i;
  // Narrow action-imperative detector: only fire when the prompt ENDS with an
  // explicit action clause ("... then fix it", "... and deploy now",
  // "... after that run the tests"). Broad `and <verb>` matching is too greedy —
  // it catches "the difference between fix and build" (a noun phrase, not an
  // imperative) and would mis-classify pure questions as execution commands.
  const ACTION_IMPERATIVE_TAIL_PATTERN =
    /\b(?:then\s+(?:fix|deploy|build|ship|run|execute|patch|refactor|migrate)|after\s+that\s+\w+|and\s+then\s+(?:fix|deploy|build|ship|run|execute|patch|refactor|migrate))\b/i;
  const isExplanationRequest = EXPLANATION_QUESTION_PATTERN.test(normalized.trim())
    && !ACTION_IMPERATIVE_TAIL_PATTERN.test(normalized);

  if (isExplanationRequest) {
    return {
      isExecutionMode: false,
      category: null,
      categoryLabel: '',
      matchedTrigger: '',
      reason: 'Explanation/question request — chat model may answer narratively.',
    };
  }

  for (const matcher of CATEGORY_PATTERNS) {
    const match = normalized.match(matcher.pattern);
    if (match && match[0]) {
      return {
        isExecutionMode: true,
        category: matcher.category,
        categoryLabel: matcher.label,
        matchedTrigger: match[0].trim(),
        reason: `Execution-mode category "${matcher.label}" matched ("${match[0].trim()}"). Chat returns HTTP 202 + taskId + executionStatus JSON; no narrative planning.`,
      };
    }
  }

  return {
    isExecutionMode: false,
    category: null,
    categoryLabel: '',
    matchedTrigger: '',
    reason: 'No execution-mode category matched — route as a normal conversation.',
  };
}

/** The fixed set of execution-mode categories, exposed for status/proof. */
export function listExecutionModeCategories(): Array<{ category: IVXExecutionModeCategory; label: string }> {
  return CATEGORY_PATTERNS.map((m) => ({ category: m.category, label: m.label }));
}
