/**
 * IVX Lead Scoring Helper — autonomous senior-developer output.
 *
 * Pure, side-effect-free functions that compute a lead temperature
 * (hot / warm / cold) and a 0-100 score from SEC Form D filing metadata.
 * Used by the capital-sourcing engines to prioritize outreach.
 */

export type LeadTemperature = 'hot' | 'warm' | 'cold';

export interface LeadScoringInput {
  /** Filing type, e.g. "1-D", "1-D/A". */
  filingType: string;
  /** Offering amount in USD (the target raise). */
  offeringAmount?: number;
  /** Amount already sold in USD. */
  amountSold?: number;
  /** Number of investors already in the deal. */
  investorsCount?: number;
  /** ISO date the filing was signed. */
  signedDate?: string;
  /** ISO date the filing was submitted to SEC. */
  submissionDate?: string;
  /** Industry / business type from the filing. */
  industry?: string;
  /** True when the filing is an amendment (1-D/A). */
  isAmendment?: boolean;
}

export interface LeadScoringResult {
  score: number;
  temperature: LeadTemperature;
  rationale: string[];
  components: {
    recency: number;
    dealSize: number;
    momentum: number;
    clarity: number;
  };
}

const COLD_THRESHOLD = 35;
const WARM_THRESHOLD = 65;

const HIGH_VALUE_INDUSTRIES = new Set([
  'real_estate',
  'reits',
  'property',
  'syndication',
  'fund',
  'private_equity',
  'venture_capital',
]);

/**
 * Compute days between two ISO dates (positive = past).
 */
function daysSince(isoDate: string | undefined, now: Date = new Date()): number {
  if (!isoDate) return Number.POSITIVE_INFINITY;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return Number.POSITIVE_INFINITY;
  return Math.max(0, Math.floor((now.getTime() - d.getTime()) / 86_400_000));
}

/**
 * Score how recent the filing is. Newer filings score higher.
 * <= 14 days = 100, <= 30 days = 80, <= 90 days = 60, else decays.
 */
function scoreRecency(input: LeadScoringInput): number {
  const days = Math.min(daysSince(input.signedDate), daysSince(input.submissionDate));
  if (days <= 14) return 100;
  if (days <= 30) return 80;
  if (days <= 90) return 60;
  if (days <= 180) return 40;
  if (days <= 365) return 20;
  return 10;
}

/**
 * Score the deal size. Larger offerings indicate higher-value leads.
 * >= $10M = 100, >= $1M = 70, >= $100K = 40, else 20.
 */
function scoreDealSize(input: LeadScoringInput): number {
  const amt = input.offeringAmount ?? 0;
  if (amt >= 10_000_000) return 100;
  if (amt >= 1_000_000) return 70;
  if (amt >= 100_000) return 40;
  if (amt > 0) return 20;
  return 10;
}

/**
 * Score momentum — how much of the offering is already sold and how many
 * investors are in. High momentum = the deal is moving, act fast.
 */
function scoreMomentum(input: LeadScoringInput): number {
  let score = 30;
  const sold = input.amountSold ?? 0;
  const offered = input.offeringAmount ?? 0;
  if (offered > 0) {
    const pct = sold / offered;
    if (pct >= 0.75) score += 60;
    else if (pct >= 0.5) score += 40;
    else if (pct >= 0.25) score += 20;
    else if (pct > 0) score += 10;
  }
  const inv = input.investorsCount ?? 0;
  if (inv >= 10) score += 10;
  else if (inv >= 3) score += 5;
  return Math.min(100, score);
}

/**
 * Score clarity — original filings are clearer than amendments; high-value
 * industries get a small boost because they match IVX's target market.
 */
function scoreClarity(input: LeadScoringInput): number {
  let score = 70;
  if (input.isAmendment || /\/A$/.test(input.filingType)) score -= 20;
  const industry = (input.industry ?? '').toLowerCase().replace(/\s+/g, '_');
  if (HIGH_VALUE_INDUSTRIES.has(industry)) score += 30;
  return Math.min(100, Math.max(0, score));
}

/**
 * Compute the composite lead score and temperature.
 * Weights: recency 30%, dealSize 25%, momentum 25%, clarity 20%.
 */
export function scoreLead(input: LeadScoringInput): LeadScoringResult {
  const components = {
    recency: scoreRecency(input),
    dealSize: scoreDealSize(input),
    momentum: scoreMomentum(input),
    clarity: scoreClarity(input),
  };
  const score = Math.round(
    components.recency * 0.3 +
      components.dealSize * 0.25 +
      components.momentum * 0.25 +
      components.clarity * 0.2,
  );

  const rationale: string[] = [];
  rationale.push(`recency=${components.recency} (days since filing)`);
  rationale.push(`dealSize=${components.dealSize} (offering amount)`);
  rationale.push(`momentum=${components.momentum} (sold/investors)`);
  rationale.push(`clarity=${components.clarity} (type/industry)`);

  const temperature: LeadTemperature =
    score >= WARM_THRESHOLD ? 'hot' : score >= COLD_THRESHOLD ? 'warm' : 'cold';

  return { score, temperature, rationale, components };
}

/**
 * Convenience: classify a raw filing record into a temperature bucket.
 */
export function classifyLeadTemperature(input: LeadScoringInput): LeadTemperature {
  return scoreLead(input).temperature;
}
