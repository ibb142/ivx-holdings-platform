/**
 * IVX IA Brain — Hallucination Control Gate (§16).
 *
 * Scans AI-generated answers for fabricated claims:
 *   - invented sources, URLs, transactions, properties, commits
 *   - invented customers, revenue, market share, legal requirements
 *   - invented current information presented as fact
 *
 * When evidence is unavailable, the gate rewrites the answer to state:
 *   what is known, what is unknown, what must be retrieved,
 *   what assumption is being used, and the confidence level.
 *
 * This complements the existing `ivx-unified-ai-gate-pipeline.ts`
 * which focuses on fake *execution* claims. This gate catches
 * fabricated *factual* claims in non-execution domains.
 *
 * Pure — no I/O, no AI, fully unit-testable.
 */

export const IVX_BRAIN_HALLUCINATION_GATE_MARKER =
  'ivx-brain-hallucination-gate-2026-08-07-v1';

export type IVXHallucinationFlag = {
  type: string;
  matchedText: string;
  reason: string;
};

export type IVXHallucinationGateResult = {
  /** True when hallucination markers were detected and the answer was rewritten. */
  gated: boolean;
  /** The final answer (rewritten if gated, unchanged if not). */
  answer: string;
  /** All flags detected. */
  flags: IVXHallucinationFlag[];
  /** Confidence in the assessment. */
  confidence: 'high' | 'medium' | 'low';
  /** Reason for the gate decision. */
  reason: string;
};

// ─── Hallucination Patterns ──────────────────────────────────────

const FABRICATED_SOURCE_PATTERNS: Array<{ pattern: RegExp; type: string; reason: string }> = [
  {
    pattern: /\b(according to (?:a |an |the )?(?:study|report|survey|research)(?:\s+(?:by|from|conducted by)\s+\w+)?)\b/gi,
    type: 'fabricated_source',
    reason: 'References an unnamed study/report — verify the source exists.',
  },
  {
    pattern: /\b(source:\s*(?:https?:\/\/(?!api\.ivxholding\.com|supabase\.com|render\.com|github\.com|apple\.com|developers?\.google\.com|bloomberg\.com|reuters\.com|wsj\.com|ft\.com|sec\.gov|bls\.gov|federalreserve\.gov)[^\s]+))/gi,
    type: 'fabricated_url',
    reason: 'Contains a URL from an unverified domain — verify it exists.',
  },
];

const FABRICATED_TRANSACTION_PATTERNS: Array<{ pattern: RegExp; type: string; reason: string }> = [
  {
    pattern: /\b(?:sold (?:for|at)\s+\$?[\d,]+(?:\.\d+)?(?:[km]?|\s*(?:million|billion|thousand))?)/gi,
    type: 'fabricated_sale_price',
    reason: 'Contains a specific sold price — verify with actual property records.',
  },
  {
    pattern: /\b(?:revenue\s+(?:of\s+|is\s+)?\$?[\d,]+(?:\.\d+)?(?:[km]|\s*(?:million|billion)))/gi,
    type: 'fabricated_revenue',
    reason: 'Contains a specific revenue figure — verify with actual financial records.',
  },
  {
    pattern: /\b(?:market share\s+(?:of\s+)?[\d.]+%)/gi,
    type: 'fabricated_market_share',
    reason: 'Contains a specific market share percentage — verify with actual market data.',
  },
];

const FABRICATED_COMMIT_PATTERNS: Array<{ pattern: RegExp; type: string; reason: string }> = [
  {
    pattern: /\bcommit\s+([0-9a-f]{7,40})\b/gi,
    type: 'fabricated_commit',
    reason: 'Contains a commit SHA — verify it exists in the actual repository.',
  },
  {
    pattern: /\bpr\s+#?(\d+)\b/gi,
    type: 'fabricated_pr',
    reason: 'Contains a PR number — verify it exists in the actual repository.',
  },
  {
    pattern: /\bdep-([a-z0-9]{8,})\b/gi,
    type: 'fabricated_deploy',
    reason: 'Contains a deploy ID — verify it exists in the actual Render account.',
  },
];

const FABRICATED_CUSTOMER_PATTERNS: Array<{ pattern: RegExp; type: string; reason: string }> = [
  {
    pattern: /\b(?:we have\s+(?:over\s+)?[\d,]+\s+(?:customers|users|members|investors|buyers))/gi,
    type: 'fabricated_customer_count',
    reason: 'Contains a specific customer/user count — verify with actual database records.',
  },
  {
    pattern: /\b(?:customer\s+(?:named|called)\s+[A-Z][a-z]+\s+[A-Z][a-z]+)/gi,
    type: 'fabricated_customer_name',
    reason: 'Contains a specific customer name — verify it is a real customer.',
  },
];

const FABRICATED_LEGAL_PATTERNS: Array<{ pattern: RegExp; type: string; reason: string }> = [
  {
    pattern: /\b(?:(?:the\s+)?law (?:requires|states|mandates) (?:that\s+)?[^.]{10,80})/gi,
    type: 'fabricated_legal_requirement',
    reason: 'Contains a specific legal requirement — verify with actual current regulations.',
  },
  {
    pattern: /\b(?:(?:penalty|fine)\s+(?:of\s+|is\s+)?\$?[\d,]+)/gi,
    type: 'fabricated_penalty',
    reason: 'Contains a specific penalty/fine amount — verify with actual current regulations.',
  },
];

const PRESENTED_AS_FACT_PATTERNS: RegExp[] = [
  /\b(?:the current (?:rate|price|value)\s+(?:is|stands at)\s+)/gi,
  /\b(?:as of (?:today|now|right now),\s+(?:the|our|their))/gi,
  /\b(?:latest (?:data|figures|numbers) (?:show|indicate|reveal)\s+)/gi,
];

const ALL_PATTERNS = [
  ...FABRICATED_SOURCE_PATTERNS,
  ...FABRICATED_TRANSACTION_PATTERNS,
  ...FABRICATED_COMMIT_PATTERNS,
  ...FABRICATED_CUSTOMER_PATTERNS,
  ...FABRICATED_LEGAL_PATTERNS,
];

// ─── Gate Implementation ─────────────────────────────────────────

/**
 * Scan an AI-generated answer for hallucination markers.
 * Returns flags and, if gated, a rewritten answer with uncertainty
 * disclaimers per §16.
 *
 * @param answer The AI-generated answer to scan.
 * @param hasRetrievedSources Whether live-retrieved sources were used.
 * @param hasInternalData Whether verified internal data was used.
 */
export function applyHallucinationGate(
  answer: string,
  opts: {
    hasRetrievedSources?: boolean;
    hasInternalData?: boolean;
  } = {},
): IVXHallucinationGateResult {
  const hasRetrievedSources = opts.hasRetrievedSources ?? false;
  const hasInternalData = opts.hasInternalData ?? false;
  const flags: IVXHallucinationFlag[] = [];

  // Check all fabrication patterns
  for (const { pattern, type, reason } of ALL_PATTERNS) {
    const regex = new RegExp(pattern.source, pattern.flags);
    let match: RegExpExecArray | null;
    while ((match = regex.exec(answer)) !== null) {
      flags.push({
        type,
        matchedText: match[0],
        reason,
      });
    }
  }

  // Check "presented as fact" patterns when no sources were retrieved
  if (!hasRetrievedSources && !hasInternalData) {
    for (const pattern of PRESENTED_AS_FACT_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      if (regex.test(answer)) {
        flags.push({
          type: 'unsourced_fact_claim',
          matchedText: '',
          reason: 'Presents information as current fact without retrieved sources.',
        });
      }
    }
  }

  // Determine if gating is needed
  const hasFabricatedCommit = flags.some((f) => f.type === 'fabricated_commit');
  const hasFabricatedDeploy = flags.some((f) => f.type === 'fabricated_deploy');
  const hasCriticalFlags = flags.length > 0 && (
    hasFabricatedCommit || hasFabricatedDeploy ||
    flags.some((f) => f.type === 'fabricated_sale_price' || f.type === 'fabricated_revenue' || f.type === 'fabricated_legal_requirement')
  );

  // Only gate when critical flags are present
  const gated = hasCriticalFlags || flags.length >= 3;

  if (!gated) {
    return {
      gated: false,
      answer,
      flags,
      confidence: flags.length === 0 ? 'high' : 'medium',
      reason: flags.length === 0
        ? 'No hallucination markers detected.'
        : `${flags.length} minor flag(s) detected — below gating threshold.`,
    };
  }

  // Build the rewritten answer with uncertainty disclaimers
  const flagSummary = flags.slice(0, 5).map((f) => `• [${f.type}] ${f.reason}`).join('\n');
  const disclaimer = [
    '\n\n---',
    '⚠ HALLUCINATION CHECK: The following claims in the original answer require verification:',
    flagSummary,
    '',
    'What is known: The response above contains claims that could not be verified against retrieved sources.',
    'What is unknown: Whether the specific figures, sources, or identifiers cited are accurate.',
    'What must be retrieved: Live data from authoritative sources to confirm or correct these claims.',
    'Confidence: LOW — do not make decisions based on unverified figures.',
    '---',
  ].join('\n');

  return {
    gated: true,
    answer: answer + disclaimer,
    flags,
    confidence: 'low',
    reason: `${flags.length} hallucination marker(s) detected — answer annotated with verification warning.`,
  };
}
