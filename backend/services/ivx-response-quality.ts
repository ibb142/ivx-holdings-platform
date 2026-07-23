/**
 * IVX Self-Critique + Response Quality — Phases 10-11
 *
 * Before sending a final response, run a critique pass.
 * Implements owner response modes and default response structure.
 * The critique may revise the final response once.
 */

// ─── Response Modes (Phase 11) ────────────────────────────────────

export type IVXResponseMode =
  | 'DIRECT_ANSWER'
  | 'EXECUTION_UPDATE'
  | 'TECHNICAL_REPORT'
  | 'OWNER_ACTION_REQUIRED'
  | 'FINAL_PROOF'
  | 'BUSINESS_EXPLANATION';

export type IVXResponseStructure = {
  directAnswer: string;
  currentStatus: string;
  whatWasFound: string | null;
  whatWasDone: string | null;
  evidence: string[];
  remainingBlocker: string | null;
  nextAction: string | null;
  mode: IVXResponseMode;
  traceId: string | null;
};

// ─── Self-Critique (Phase 10) ─────────────────────────────────────

export type IVXCritiqueCheck = {
  name: string;
  passed: boolean;
  detail: string;
};

export type IVXCritiqueResult = {
  checks: IVXCritiqueCheck[];
  overallPassed: boolean;
  revisedResponse: IVXResponseStructure | null;
  revisionReason: string | null;
};

export function runSelfCritique(response: IVXResponseStructure, context: {
  ownerQuestion: string;
  hasEvidence: boolean;
  hasBlocker: boolean;
  isExecutionTask: boolean;
  isBusinessTask: boolean;
}): IVXCritiqueResult {
  const checks: IVXCritiqueCheck[] = [];

  // 1. Did the answer address the owner's real question?
  const questionKeywords = context.ownerQuestion
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3);
  const answerText = (response.directAnswer + ' ' + response.currentStatus).toLowerCase();
  const matchedKeywords = questionKeywords.filter((k) => answerText.includes(k));
  const addressedQuestion = matchedKeywords.length >= Math.min(1, Math.floor(questionKeywords.length * 0.2));
  checks.push({
    name: 'addressed_owner_question',
    passed: addressedQuestion,
    detail: addressedQuestion
      ? `Matched ${matchedKeywords.length}/${questionKeywords.length} question keywords`
      : `Only matched ${matchedKeywords.length}/${questionKeywords.length} keywords — answer may not address the question`,
  });

  // 2. Did it repeat information unnecessarily?
  const allText = [response.directAnswer, response.currentStatus, response.whatWasFound, response.whatWasDone]
    .filter(Boolean)
    .join(' ');
  const sentences = allText.split(/[.!?]+/).filter((s) => s.trim().length > 10);
  const uniqueSentences = new Set(sentences.map((s) => s.trim().toLowerCase()));
  const hasRepeats = sentences.length > uniqueSentences.size + 2; // Allow some overlap
  checks.push({
    name: 'no_unnecessary_repeats',
    passed: !hasRepeats,
    detail: hasRepeats
      ? `${sentences.length - uniqueSentences.size} repeated sentences detected`
      : 'No unnecessary repeats',
  });

  // 3. Are any claims unsupported?
  const claimsEvidence = !context.isExecutionTask || response.evidence.length > 0 || !response.whatWasDone;
  checks.push({
    name: 'claims_supported',
    passed: claimsEvidence,
    detail: claimsEvidence
      ? 'Claims have evidence or no execution claims made'
      : 'Execution claims made without evidence',
  });

  // 4. Did it confuse code, deployment, and live verification?
  const confusesLevels = response.whatWasDone?.includes('verified') && !response.evidence.some((e) => e.includes('HTTP') || e.includes('SHA') || e.includes('commit'));
  checks.push({
    name: 'no_level_confusion',
    passed: !confusesLevels,
    detail: confusesLevels
      ? 'Claims "verified" without HTTP/SHA/commit evidence'
      : 'Verification levels are distinct',
  });

  // 5. Are required citations/evidence present?
  checks.push({
    name: 'evidence_present',
    passed: !context.isExecutionTask || response.evidence.length > 0,
    detail: response.evidence.length > 0
      ? `${response.evidence.length} evidence items`
      : 'No evidence (acceptable for non-execution tasks)',
  });

  // 6. Are owner actions clear?
  const hasOwnerAction = context.hasBlocker ? response.nextAction !== null : true;
  checks.push({
    name: 'owner_actions_clear',
    passed: hasOwnerAction,
    detail: hasOwnerAction
      ? 'Owner action is clear or not needed'
      : 'Blocker exists but no next action specified',
  });

  // 7. Are blockers exact?
  const blockerIsExact = response.remainingBlocker
    ? response.remainingBlocker.length > 10 && !response.remainingBlocker.toLowerCase().includes('service unavailable')
    : true;
  checks.push({
    name: 'blockers_exact',
    passed: blockerIsExact,
    detail: blockerIsExact
      ? 'Blocker is specific or absent'
      : 'Blocker is generic ("service unavailable") — needs exact detail',
  });

  // 8. Is the answer understandable?
  const avgSentenceLength = allText.split(/[.!?]+/).filter((s) => s.trim()).reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0) / Math.max(1, sentences.length);
  checks.push({
    name: 'understandable',
    passed: avgSentenceLength < 30,
    detail: `Average sentence length: ${avgSentenceLength.toFixed(1)} words`,
  });

  // 9. Is there a shorter clearer way?
  const totalWords = allText.split(/\s+/).length;
  const couldBeShorter = totalWords > 300 && context.ownerQuestion.length < 100;
  checks.push({
    name: 'concise',
    passed: !couldBeShorter,
    detail: couldBeShorter
      ? `${totalWords} words for a ${context.ownerQuestion.length}-char question — could be shorter`
      : 'Response length is proportional to question',
  });

  const overallPassed = checks.every((c) => c.passed);

  // Auto-revision: if critique found issues, suggest a revised response
  let revisedResponse: IVXResponseStructure | null = null;
  let revisionReason: string | null = null;

  if (!overallPassed) {
    const failedChecks = checks.filter((c) => !c.passed);
    revisionReason = failedChecks.map((c) => c.name).join(', ');

    // Apply simple revisions
    let revisedDirectAnswer = response.directAnswer;
    let revisedBlocker = response.remainingBlocker;

    // Fix generic blocker
    if (failedChecks.some((c) => c.name === 'blockers_exact') && revisedBlocker) {
      revisedBlocker = revisedBlocker + ' (trace: ' + (response.traceId || 'N/A') + ')';
    }

    // Trim if too long
    if (failedChecks.some((c) => c.name === 'concise') && revisedDirectAnswer.length > 500) {
      revisedDirectAnswer = revisedDirectAnswer.slice(0, 500) + '…';
    }

    revisedResponse = {
      ...response,
      directAnswer: revisedDirectAnswer,
      remainingBlocker: revisedBlocker,
    };
  }

  return {
    checks,
    overallPassed,
    revisedResponse,
    revisionReason,
  };
}

// ─── Response Builder ─────────────────────────────────────────────

export function buildResponse(input: {
  mode: IVXResponseMode;
  directAnswer: string;
  currentStatus: string;
  whatWasFound?: string | null;
  whatWasDone?: string | null;
  evidence?: string[];
  remainingBlocker?: string | null;
  nextAction?: string | null;
  traceId?: string | null;
}): IVXResponseStructure {
  return {
    directAnswer: input.directAnswer,
    currentStatus: input.currentStatus,
    whatWasFound: input.whatWasFound || null,
    whatWasDone: input.whatWasDone || null,
    evidence: input.evidence || [],
    remainingBlocker: input.remainingBlocker || null,
    nextAction: input.nextAction || null,
    mode: input.mode,
    traceId: input.traceId || null,
  };
}

/**
 * Serialize a response structure into a readable string for the owner.
 */
export function serializeResponse(response: IVXResponseStructure): string {
  const parts: string[] = [];

  parts.push(response.directAnswer);

  if (response.currentStatus) {
    parts.push(`\n**Status:** ${response.currentStatus}`);
  }

  if (response.whatWasFound) {
    parts.push(`\n**Found:** ${response.whatWasFound}`);
  }

  if (response.whatWasDone) {
    parts.push(`\n**Done:** ${response.whatWasDone}`);
  }

  if (response.evidence.length > 0) {
    parts.push(`\n**Evidence:**`);
    for (const e of response.evidence) {
      parts.push(`  - ${e}`);
    }
  }

  if (response.remainingBlocker) {
    parts.push(`\n**Blocker:** ${response.remainingBlocker}`);
  }

  if (response.nextAction) {
    parts.push(`\n**Next:** ${response.nextAction}`);
  }

  if (response.traceId) {
    parts.push(`\n*Ref: ${response.traceId}*`);
  }

  return parts.join('\n');
}

/**
 * Detect and suppress duplicate answers.
 * If the new answer is >80% similar to the previous answer, suppress it.
 */
export function isDuplicateAnswer(newAnswer: string, previousAnswer: string): boolean {
  if (!previousAnswer || !newAnswer) return false;

  const newWords = new Set(newAnswer.toLowerCase().split(/\s+/));
  const prevWords = new Set(previousAnswer.toLowerCase().split(/\s+/));

  const intersection = [...newWords].filter((w) => prevWords.has(w)).length;
  const union = new Set([...newWords, ...prevWords]).size;

  const similarity = intersection / union;
  return similarity > 0.8;
}

// ─── Banned Patterns ──────────────────────────────────────────────

const BANNED_PATTERNS = [
  /i'?ll inspect now/i,
  /one moment/i,
  /hold on/i,
  /let me check/i,
  /working on it/i,
  /i apologize for the (confusion|inconvenience)/i,
  /as (an|a) (ai|assistant)/i,
  /i'?m (here|ready) to help/i,
];

export function containsBannedPhrases(text: string): { found: boolean; patterns: string[] } {
  const found: string[] = [];
  for (const pattern of BANNED_PATTERNS) {
    if (pattern.test(text)) {
      found.push(pattern.source);
    }
  }
  return { found: found.length > 0, patterns: found };
}

export const IVX_RESPONSE_QUALITY_MARKER = 'ivx-response-quality-2026-07-23-v1';
