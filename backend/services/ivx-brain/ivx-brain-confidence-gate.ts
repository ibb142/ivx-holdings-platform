/**
 * IVX IA Brain — Knowledge Confidence Gate (§2).
 *
 * Before answering, determines the confidence level for the response:
 *
 *   HIGH:   supported by verified internal data or authoritative current sources
 *   MEDIUM: strong reasoning but incomplete evidence
 *   LOW:    ambiguous, insufficient, outdated, or speculative
 *
 * Each level has prescribed behavior:
 *   HIGH   → answer directly, include evidence
 *   MEDIUM → answer with assumptions stated, retrieve more when possible
 *   LOW    → do not guess, retrieve, clarify, or state unverified
 *
 * Pure — no I/O, no AI, fully unit-testable.
 */

export const IVX_BRAIN_CONFIDENCE_GATE_MARKER =
  'ivx-brain-confidence-gate-2026-08-07-v1';

export type IVXConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';

export type IVXConfidenceAssessment = {
  level: IVXConfidenceLevel;
  /** Whether the information is stable (unchanging) or time-sensitive. */
  stability: 'stable' | 'time_sensitive';
  /** Whether the information is internal (IVX) or public. */
  scope: 'internal' | 'public' | 'mixed';
  /** Whether there is sufficient evidence to answer. */
  hasSufficientEvidence: boolean;
  /** Whether the request is high-risk (financial, legal, security). */
  isHighRisk: boolean;
  /** Whether the response requires current information. */
  requiresCurrentInfo: boolean;
  /** Whether a tool action is required. */
  requiresToolAction: boolean;
  /** Whether the model has enough context to answer accurately. */
  hasEnoughContext: boolean;
  /** Prescribed behavior for this confidence level. */
  prescribedBehavior: string;
  /** Reason for the assessment. */
  reason: string;
};

// ─── Indicators ──────────────────────────────────────────────────

const TIME_SENSITIVE_PATTERNS: RegExp[] = [
  /\b(today|now|current|latest|recent|this (week|month|year|quarter))\b/i,
  /\b(interest rate|exchange rate|market price|stock price|inflation rate|gdp|cpi|fed rate)\b/i,
  /\b(breaking news|just announced|just released|news today)\b/i,
  /\b(regulation|law|policy|guideline|requirement)\b/i,
];

const HIGH_RISK_PATTERNS: RegExp[] = [
  /\b(invest|investment|roi|return|financial|legal|contract|liability|tax|compliance)\b/i,
  /\b(security|password|token|key|credential|authentication)\b/i,
  /\b(guarantee|guaranteed|certain|definitely|risk.?free)\b/i,
  /\b(medical|health|diagnosis|treatment)\b/i,
];

const STABLE_KNOWLEDGE_PATTERNS: RegExp[] = [
  /\b(what is|define|explain|how does|history of|origin of)\b/i,
  /\b(mathematics|algebra|geometry|calculus|physics|chemistry|biology)\b/i,
  /\b(programming (concept|pattern|paradigm)|data structure|algorithm)\b/i,
];

const INTERNAL_IVX_PATTERNS: RegExp[] = [
  /\b(ivx|ivxholding|owner (session|login|token)|member|investor|buyer|deal|property (record|management))\b/i,
  /\b(supabase|render|github (repo|commit)|api\.ivxholding\.com)\b/i,
];

const SUFFICIENT_EVIDENCE_INDICATORS: RegExp[] = [
  /\b(prove|proof|evidence|verified|confirmed|sha|commit|deploy|http (200|401|403))\b/i,
];

// ─── Assessment ──────────────────────────────────────────────────

/**
 * Assess the confidence level for a message before answering.
 *
 * @param prompt The user's message.
 * @param hasInternalData Whether verified internal IVX data is available.
 * @param hasRetrievedSources Whether live-retrieved authoritative sources are available.
 * @param hasConversationContext Whether sufficient conversation context exists.
 */
export function assessConfidence(
  prompt: string,
  opts: {
    hasInternalData?: boolean;
    hasRetrievedSources?: boolean;
    hasConversationContext?: boolean;
  } = {},
): IVXConfidenceAssessment {
  const text = prompt.trim();
  const hasInternalData = opts.hasInternalData ?? false;
  const hasRetrievedSources = opts.hasRetrievedSources ?? false;
  const hasConversationContext = opts.hasConversationContext ?? true;

  const isTimeSensitive = TIME_SENSITIVE_PATTERNS.some((p) => p.test(text));
  const isStable = !isTimeSensitive && STABLE_KNOWLEDGE_PATTERNS.some((p) => p.test(text));
  const isInternal = INTERNAL_IVX_PATTERNS.some((p) => p.test(text));
  const isPublic = !isInternal;
  const isHighRisk = HIGH_RISK_PATTERNS.some((p) => p.test(text));
  const requiresCurrentInfo = isTimeSensitive;
  const requiresToolAction = /\b(deploy|commit|push|build|run|create|update|delete|execute)\b/i.test(text);
  const hasSufficientEvidence =
    hasInternalData || hasRetrievedSources || SUFFICIENT_EVIDENCE_INDICATORS.some((p) => p.test(text));
  const hasEnoughContext = hasConversationContext && text.length > 15;

  // Confidence determination
  let level: IVXConfidenceLevel;

  if ((hasInternalData || hasRetrievedSources) && hasEnoughContext && (!requiresCurrentInfo || hasRetrievedSources)) {
    level = 'HIGH';
  } else if (isStable && hasEnoughContext && !requiresCurrentInfo && !isHighRisk) {
    level = 'HIGH';
  } else if (hasEnoughContext && (!isHighRisk || hasSufficientEvidence) && !requiresCurrentInfo) {
    level = 'MEDIUM';
  } else if (isHighRisk && !hasSufficientEvidence) {
    level = 'LOW';
  } else if (requiresCurrentInfo && !hasRetrievedSources) {
    level = 'LOW';
  } else if (!hasEnoughContext) {
    level = 'LOW';
  } else {
    level = 'MEDIUM';
  }

  // Prescribed behavior per §2
  const prescribedBehavior =
    level === 'HIGH'
      ? 'Answer directly. Include evidence when relevant.'
      : level === 'MEDIUM'
        ? 'Answer with assumptions clearly stated. Retrieve more information when possible.'
        : 'Do not guess. Retrieve, ask a clarification, or state that the answer is not yet verified.';

  const stability = isTimeSensitive ? 'time_sensitive' as const : 'stable' as const;
  const scope = isInternal && isPublic ? 'mixed' as const : isInternal ? 'internal' as const : 'public' as const;

  const reason =
    `Level: ${level}. Stability: ${stability}. Scope: ${scope}. ` +
    `Sufficient evidence: ${hasSufficientEvidence}. High risk: ${isHighRisk}. ` +
    `Requires current info: ${requiresCurrentInfo}. Enough context: ${hasEnoughContext}.`;

  return {
    level,
    stability,
    scope,
    hasSufficientEvidence,
    isHighRisk,
    requiresCurrentInfo,
    requiresToolAction,
    hasEnoughContext,
    prescribedBehavior,
    reason,
  };
}

/**
 * Append a confidence disclaimer to an answer when the level is not HIGH.
 */
export function appendConfidenceDisclaimer(
  answer: string,
  assessment: IVXConfidenceAssessment,
): string {
  if (assessment.level === 'HIGH') return answer;

  const disclaimer =
    assessment.level === 'MEDIUM'
      ? '\n\n---\n*Confidence: MEDIUM — assumptions stated above. Additional evidence may refine this answer.*'
      : '\n\n---\n*Confidence: LOW — this answer is not yet verified. Do not make decisions based on this without further verification.*';

  return answer + disclaimer;
}
