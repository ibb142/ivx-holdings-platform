/**
 * IVX IA Brain — Live Retrieval Module (§3, §12).
 *
 * Manages real-world retrieval for time-sensitive information.
 * Records query, source, source date, retrieval timestamp, evidence,
 * confidence, and whether sources agreed.
 *
 * Freshness policies per data category (§12):
 *   Breaking news:      minutes (5 min)
 *   Market prices:      seconds-minutes (30s)
 *   Property sales:     daily-weekly
 *   Regulations:        daily
 *   Competitor pages:   daily-weekly
 *   Internal KPIs:      near real time (10s)
 *   Stable knowledge:   long cache (7 days)
 *
 * Integrates with the existing `ivx-retrieval.ts` pipeline and the
 * `ivx-global-opportunity-intelligence.ts` web search function.
 */

export const IVX_BRAIN_LIVE_RETRIEVAL_MARKER =
  'ivx-brain-live-retrieval-2026-08-07-v1';

// ─── Freshness Policies (§12) ────────────────────────────────────

export type IVXDataCategory =
  | 'breaking_news'
  | 'market_prices'
  | 'property_sales'
  | 'regulations'
  | 'competitor_info'
  | 'internal_kpis'
  | 'stable_knowledge'
  | 'api_documentation'
  | 'app_store_policies'
  | 'economic_indicators'
  | 'general_current';

export type IVXFreshnessPolicy = {
  category: IVXDataCategory;
  /** Maximum age before data is considered stale (milliseconds). */
  maxAgeMs: number;
  /** Human-readable description. */
  description: string;
  /** Whether to prefer official/government sources. */
  preferOfficial: boolean;
  /** Minimum number of sources for important claims. */
  minSources: number;
};

export const FRESHNESS_POLICIES: Record<IVXDataCategory, IVXFreshnessPolicy> = {
  breaking_news: {
    category: 'breaking_news',
    maxAgeMs: 5 * 60 * 1000, // 5 minutes
    description: 'Breaking news — refresh every 5 minutes',
    preferOfficial: true,
    minSources: 2,
  },
  market_prices: {
    category: 'market_prices',
    maxAgeMs: 30 * 1000, // 30 seconds
    description: 'Market prices — refresh every 30 seconds',
    preferOfficial: true,
    minSources: 1,
  },
  property_sales: {
    category: 'property_sales',
    maxAgeMs: 24 * 60 * 60 * 1000, // 1 day
    description: 'Property sales — refresh daily',
    preferOfficial: true,
    minSources: 2,
  },
  regulations: {
    category: 'regulations',
    maxAgeMs: 24 * 60 * 60 * 1000, // 1 day
    description: 'Regulations — refresh daily',
    preferOfficial: true,
    minSources: 2,
  },
  competitor_info: {
    category: 'competitor_info',
    maxAgeMs: 24 * 60 * 60 * 1000, // 1 day
    description: 'Competitor information — refresh daily',
    preferOfficial: false,
    minSources: 2,
  },
  internal_kpis: {
    category: 'internal_kpis',
    maxAgeMs: 10 * 1000, // 10 seconds
    description: 'Internal business KPIs — near real time',
    preferOfficial: true,
    minSources: 1,
  },
  stable_knowledge: {
    category: 'stable_knowledge',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
    description: 'Stable general knowledge — long cache',
    preferOfficial: false,
    minSources: 1,
  },
  api_documentation: {
    category: 'api_documentation',
    maxAgeMs: 24 * 60 * 60 * 1000, // 1 day
    description: 'API/SDK documentation — refresh daily',
    preferOfficial: true,
    minSources: 1,
  },
  app_store_policies: {
    category: 'app_store_policies',
    maxAgeMs: 24 * 60 * 60 * 1000, // 1 day
    description: 'App store policies — refresh daily',
    preferOfficial: true,
    minSources: 2,
  },
  economic_indicators: {
    category: 'economic_indicators',
    maxAgeMs: 60 * 60 * 1000, // 1 hour
    description: 'Economic indicators — refresh hourly',
    preferOfficial: true,
    minSources: 2,
  },
  general_current: {
    category: 'general_current',
    maxAgeMs: 60 * 60 * 1000, // 1 hour
    description: 'General current information — refresh hourly',
    preferOfficial: false,
    minSources: 2,
  },
};

// ─── Retrieval Record ────────────────────────────────────────────

export type IVXRetrievalRecord = {
  query: string;
  sources: IVXRetrievedSource[];
  retrievalTimestamp: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  sourcesAgreed: boolean;
  containsInference: boolean;
  category: IVXDataCategory;
  freshnessPolicy: IVXFreshnessPolicy;
  evidence: string;
};

export type IVXRetrievedSource = {
  /** Source name (e.g. "Bloomberg", "Apple Developer Documentation"). */
  name: string;
  /** Source URL. */
  url: string;
  /** Source publication date (ISO string or null). */
  sourceDate: string | null;
  /** Relevance to the query (0.0–1.0). */
  relevance: number;
  /** Source quality tier. */
  quality: 'official' | 'reputable' | 'secondary' | 'low_quality';
  /** Key evidence extracted from the source. */
  evidence: string;
  /** Whether the source is a primary source. */
  isPrimary: boolean;
};

// ─── Category Detection ──────────────────────────────────────────

const CATEGORY_PATTERNS: ReadonlyArray<{ category: IVXDataCategory; patterns: RegExp[] }> = [
  { category: 'breaking_news', patterns: [/\b(breaking|just (happened|announced)|urgent|emergency)\b/i] },
  { category: 'market_prices', patterns: [/\b(stock (price|market)|exchange rate|crypto|bitcoin|oil price|gold price|commodity)\b/i] },
  { category: 'property_sales', patterns: [/\b(property (sale|sold|comp|comparable)|mls|recently sold|closing price)\b/i] },
  { category: 'regulations', patterns: [/\b(law|regulation|act|statute|ordinance|zoning|permit (requirement|law))\b/i] },
  { category: 'competitor_info', patterns: [/\b(competitor|rival|competition|vs\.?|compared to)\b/i] },
  { category: 'internal_kpis', patterns: [/\b(member(s)? count|investor(s)? count|revenue|active user|conversion rate|churn)\b/i] },
  { category: 'api_documentation', patterns: [/\b(api (doc|documentation|reference)|sdk (doc|guide)|developer guide)\b/i] },
  { category: 'app_store_policies', patterns: [/\b(app store|google play|apple developer|play console) (policy|guideline|requirement|rule)\b/i] },
  { category: 'economic_indicators', patterns: [/\b(gdp|cpi|inflation|unemployment|fed rate|interest rate|jobs report)\b/i] },
];

export function detectDataCategory(query: string): IVXDataCategory {
  for (const { category, patterns } of CATEGORY_PATTERNS) {
    if (patterns.some((p) => p.test(query))) {
      return category;
    }
  }
  return 'general_current';
}

// ─── Freshness Check ─────────────────────────────────────────────

export function isDataFresh(
  sourceTimestamp: string | null,
  category: IVXDataCategory,
): { fresh: boolean; ageLabel: string; policy: IVXFreshnessPolicy } {
  const policy = FRESHNESS_POLICIES[category];
  if (!sourceTimestamp) {
    return { fresh: false, ageLabel: 'No timestamp', policy };
  }
  const age = Date.now() - new Date(sourceTimestamp).getTime();
  const fresh = age <= policy.maxAgeMs;
  const ageLabel = fresh
    ? `Fresh (${Math.round(age / 1000)}s old, max ${Math.round(policy.maxAgeMs / 1000)}s)`
    : `Stale (${Math.round(age / 1000 / 60)}min old, max ${Math.round(policy.maxAgeMs / 1000 / 60)}min)`;
  return { fresh, ageLabel, policy };
}

// ─── Source Quality Assessment ───────────────────────────────────

const OFFICIAL_DOMAINS = [
  'gov', 'apple.com', 'developer.apple.com', 'google.com', 'developers.google.com',
  'supabase.com', 'render.com', 'github.com', 'sec.gov', 'bls.gov', 'federalreserve.gov',
];

const REPUTABLE_DOMAINS = [
  'bloomberg.com', 'reuters.com', 'wsj.com', 'ft.com', 'nytimes.com',
  'techcrunch.com', 'arstechnica.com', 'theverge.com', 'zillow.com', 'redfin.com',
];

export function assessSourceQuality(url: string): IVXRetrievedSource['quality'] {
  const lower = url.toLowerCase();
  if (OFFICIAL_DOMAINS.some((d) => lower.includes(d))) return 'official';
  if (REPUTABLE_DOMAINS.some((d) => lower.includes(d))) return 'reputable';
  if (/\.(edu|org)\//.test(lower)) return 'reputable';
  if (/wikipedia\.org/.test(lower)) return 'secondary';
  return 'low_quality';
}

// ─── Retrieval Evaluation ────────────────────────────────────────

/**
 * Evaluate retrieval results and build a structured record per §3.
 * Does NOT perform the actual retrieval — that is done by the caller.
 * This function evaluates the results and records the required metadata.
 */
export function evaluateRetrieval(
  query: string,
  sources: IVXRetrievedSource[],
): IVXRetrievalRecord {
  const category = detectDataCategory(query);
  const policy = FRESHNESS_POLICIES[category];
  const retrievalTimestamp = new Date().toISOString();

  // Check freshness of each source
  const freshSources = sources.filter((s) => {
    const check = isDataFresh(s.sourceDate, category);
    return check.fresh;
  });

  // Determine if sources agree
  const evidenceSet = new Set(sources.map((s) => s.evidence.toLowerCase().slice(0, 100)));
  const sourcesAgreed = sources.length >= 2 && evidenceSet.size <= Math.ceil(sources.length * 0.7);

  // Determine confidence
  const officialCount = sources.filter((s) => s.quality === 'official').length;
  const reputableCount = sources.filter((s) => s.quality === 'reputable').length;
  const sufficientSources = sources.length >= policy.minSources;
  const allFresh = freshSources.length === sources.length && sources.length > 0;

  let confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  if (officialCount >= 1 && sufficientSources && allFresh) {
    confidence = 'HIGH';
  } else if ((officialCount >= 1 || reputableCount >= 1) && sufficientSources) {
    confidence = 'MEDIUM';
  } else {
    confidence = 'LOW';
  }

  // Check for inferences
  const containsInference = sources.some((s) =>
    /\b(probably|likely|appears to|seems to|estimated|approximately|might be|could be)\b/i.test(s.evidence),
  );

  const evidence = sources
    .slice(0, 5)
    .map((s) => `[${s.name}] ${s.evidence.slice(0, 200)}`)
    .join('\n');

  return {
    query,
    sources,
    retrievalTimestamp,
    confidence,
    sourcesAgreed,
    containsInference,
    category,
    freshnessPolicy: policy,
    evidence,
  };
}

/**
 * Format a retrieval record for display to the user, including
 * source citations and freshness information per §3.
 */
export function formatRetrievalCitations(record: IVXRetrievalRecord): string {
  const lines: string[] = [
    '--- Sources ---',
  ];
  for (const source of record.sources.slice(0, 5)) {
    const date = source.sourceDate ? ` (${source.sourceDate.split('T')[0]})` : '';
    lines.push(`• ${source.name}${date} — ${source.quality}`);
    if (source.url) lines.push(`  ${source.url}`);
  }
  lines.push(`Retrieved: ${record.retrievalTimestamp}`);
  lines.push(`Confidence: ${record.confidence}`);
  lines.push(`Sources agreed: ${record.sourcesAgreed}`);
  if (record.containsInference) {
    lines.push('⚠ Contains inferences — verify before relying on these figures.');
  }
  return lines.join('\n');
}
