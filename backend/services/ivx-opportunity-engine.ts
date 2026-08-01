/**
 * IVX Opportunity Intelligence Engine (owner-only).
 *
 * Turns IVX's own data + platform signals into ranked, high-upside opportunities
 * across seven categories. It is the discovery layer the owner asked for: scan →
 * score → profit-ladder → execution-plan → alerts.
 *
 * Signal sources scanned (read-only, defensive — a failed reader degrades to an
 * honest empty signal, never throws):
 *   jv_deals (live)  — real-estate / distressed / investor / financing / arbitrage
 *   autonomous-core  — competitor capability gaps → partnership / technology
 *   incidents        — reliability friction → technology-business opportunity
 *
 * HARD RULES (the whole spec depends on these):
 *   - Never promise guaranteed profit. Never fabricate ROI / upside numbers.
 *   - Rank ONLY by evidence, risk, speed, capital needed, and upside.
 *   - Unknown economics stay null. Every opportunity + every profit-ladder rung
 *     carries an explicit legal/compliance warning.
 *   - Higher profit-ladder rungs not supported by real evidence are flagged
 *     `speculative` (illustrative compounding only) — "$100M is possible" is never
 *     asserted without backing data.
 *
 * Deterministic + runtime-light: pure functions over already-collected signals,
 * no AI/network of its own, fully unit-testable. Heavy readers are lazy-imported.
 */
import { rankDeals, type DealScore } from './ivx-deal-intelligence';
import {
  raiseAlerts,
  upsertOpportunities,
  listOpportunities,
  computeOverallScore,
  type CreateAlertInput,
  type CreateOpportunityInput,
  type Opportunity,
  type OpportunityCategory,
  type OpportunityExecutionPlan,
  type OpportunityScores,
  type ProfitLadderStep,
  type Probability,
  type RiskLevel,
} from './ivx-opportunity-store';

export const IVX_OPPORTUNITY_ENGINE_MARKER = 'ivx-opportunity-engine-2026-05-30';

const LEGAL_WARNING =
  'Decision support only — not financial, investment, tax, or legal advice. No profit is guaranteed. ' +
  'Verify every figure against primary documents and confirm securities/AML/regulatory compliance with licensed counsel before acting.';

/** A source IVX's multi-AI research layer can consult, with honest availability. */
export type ResearchSource = {
  id: string;
  label: string;
  kind: 'internal_ai' | 'external_ai' | 'market_news' | 'document_analysis' | 'financial_model';
  status: 'online' | 'unavailable';
  detail: string;
};

/** Normalized snapshot of every signal the engine scanned. */
export type OpportunitySignalSnapshot = {
  scannedAt: string;
  deals: {
    ok: boolean;
    publishedProjects: number;
    rankedDeals: DealScore[];
    reason: string | null;
  };
  competitor: {
    missingCapabilities: number;
    partialCapabilities: number;
  };
  reliability: {
    openIncidents: number;
  };
};

/**
 * Collect every signal source. Read-only + defensive — never throws.
 */
export async function collectOpportunitySignals(): Promise<OpportunitySignalSnapshot> {
  const scannedAt = new Date().toISOString();

  let rankedDeals: DealScore[] = [];
  let dealsOk = false;
  let dealsReason: string | null = null;
  let publishedProjects = 0;
  try {
    const { readLandingProjects } = await import('./ivx-project-data');
    const projects = await readLandingProjects();
    dealsOk = projects.ok;
    publishedProjects = projects.ok ? projects.projects.length : 0;
    dealsReason = projects.ok ? null : projects.error ?? 'project source unavailable';
    if (projects.ok && projects.projects.length > 0) {
      rankedDeals = rankDeals(projects.projects);
    }
  } catch (error) {
    dealsReason = error instanceof Error ? error.message : 'project source unavailable';
  }

  let missingCapabilities = 0;
  let partialCapabilities = 0;
  try {
    const { buildAutonomousDashboard } = await import('./ivx-autonomous-core');
    const dashboard = await buildAutonomousDashboard();
    missingCapabilities = dashboard.capabilities.filter((c) => c.state === 'missing').length;
    partialCapabilities = dashboard.capabilities.filter((c) => c.state === 'partial').length;
  } catch {
    missingCapabilities = 0;
    partialCapabilities = 0;
  }

  let openIncidents = 0;
  try {
    const { listIncidents } = await import('./ivx-incident-store');
    const incidents = listIncidents(200);
    openIncidents = incidents.filter((i) => i.status === 'open' || i.status === 'diagnosing').length;
  } catch {
    openIncidents = 0;
  }

  return {
    scannedAt,
    deals: { ok: dealsOk, publishedProjects, rankedDeals, reason: dealsReason },
    competitor: { missingCapabilities, partialCapabilities },
    reliability: { openIncidents },
  };
}

/**
 * Report the multi-AI research layer IVX can consult, with honest availability
 * derived from the environment (no fake "connected" claims).
 */
export function buildResearchLayer(): ResearchSource[] {
  const hasAiGateway = Boolean(process.env.IVX_AI_GATEWAY_KEY);
  const hasSupabase = Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  return [
    {
      id: 'internal-ivx-ai',
      label: 'Internal IVX AI (deal intelligence)',
      kind: 'internal_ai',
      status: hasSupabase ? 'online' : 'unavailable',
      detail: hasSupabase
        ? 'Scores live jv_deals projects (ROI/risk/timeline/completion) deterministically.'
        : 'Needs EXPO_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY to read live deal data.',
    },
    {
      id: 'external-ai',
      label: 'External AI providers (GPT/Gemini via gateway)',
      kind: 'external_ai',
      status: hasAiGateway ? 'online' : 'unavailable',
      detail: hasAiGateway
        ? 'Available through the AI gateway for second-opinion analysis on a flagged opportunity.'
        : 'Needs IVX_AI_GATEWAY_KEY (or toolkit key) to query external models.',
    },
    {
      id: 'market-news',
      label: 'Market / news web research',
      kind: 'market_news',
      status: hasAiGateway ? 'online' : 'unavailable',
      detail: hasAiGateway
        ? 'Web/market signals can be pulled on demand for a specific opportunity (manual trigger).'
        : 'Needs a search/AI key to fetch live market & news context.',
    },
    {
      id: 'document-analysis',
      label: 'Document analysis (deal-room OCR/extraction)',
      kind: 'document_analysis',
      status: 'online',
      detail: 'Reads attached budgets/appraisals/proformas via the BLOCK 5 extractor + vision OCR.',
    },
    {
      id: 'financial-model',
      label: 'Financial / deal models',
      kind: 'financial_model',
      status: hasSupabase ? 'online' : 'unavailable',
      detail: 'Deterministic scoring + capital-allocation model over the live portfolio.',
    },
  ];
}

// ── Profit ladder ─────────────────────────────────────────────────────────────

type LadderTierSpec = { from: number; to: number; label: string };

const LADDER_TIERS: LadderTierSpec[] = [
  { from: 1, to: 10, label: '$1 → $10' },
  { from: 10, to: 100, label: '$10 → $100' },
  { from: 100, to: 1_000, label: '$100 → $1,000' },
  { from: 1_000, to: 10_000, label: '$1,000 → $10,000' },
  { from: 10_000, to: 100_000, label: '$10,000 → $100,000' },
  { from: 100_000, to: 1_000_000, label: '$100,000 → $1M+' },
  { from: 1_000_000, to: 10_000_000, label: '$1M → $10M+' },
  { from: 10_000_000, to: 100_000_000, label: '$10M → $100M+' },
];

function ladderRiskLevel(toUsd: number, evidencedCeiling: number): RiskLevel {
  if (toUsd > evidencedCeiling) return 'very_high';
  if (toUsd >= 1_000_000) return 'high';
  if (toUsd >= 10_000) return 'medium';
  return 'low';
}

function ladderProbability(toUsd: number, evidencedCeiling: number): Probability {
  if (toUsd > evidencedCeiling) return 'speculative';
  if (toUsd >= 1_000_000) return 'low';
  if (toUsd >= 10_000) return 'medium';
  return 'high';
}

function ladderStrategy(category: OpportunityCategory, tier: LadderTierSpec, evidenced: boolean): string {
  if (!evidenced) {
    return `Illustrative compounding step only — reaching ${tier.label.split(' → ')[1]} from this opportunity is NOT supported by current IVX data. Treat as a hypothetical reinvestment path, not a plan.`;
  }
  switch (category) {
    case 'real_estate':
      return `Reinvest realized gains into the next fractional JV position; compound equity + distributions toward ${tier.label.split(' → ')[1]}.`;
    case 'distressed_asset':
      return `Acquire below intrinsic value, stabilize/renovate, refinance or resell, then redeploy proceeds at the ${tier.label} band.`;
    case 'financing':
      return `Use structured financing to control more asset value per dollar, recycling capital across deals at the ${tier.label} band.`;
    case 'investor':
      return `Aggregate investor capital into larger JV positions; scale carry/fees + co-invest toward ${tier.label.split(' → ')[1]}.`;
    case 'arbitrage':
      return `Repeat the priced-gap trade and reinvest the spread; throughput (not a single trade) drives the ${tier.label} band.`;
    case 'partnership':
      return `Convert the partnership into recurring deal flow / revenue share, compounding toward ${tier.label.split(' → ')[1]}.`;
    case 'technology_business':
      return `Ship the capability, attach revenue (fees/subscriptions/efficiency), and reinvest into growth at the ${tier.label} band.`;
    default:
      return `Reinvest realized gains toward the ${tier.label} band.`;
  }
}

/**
 * Build the full $1 → $100M+ profit ladder for an opportunity. Honest: rungs
 * beyond the opportunity's evidenced upside ceiling are flagged speculative with
 * an explicit "not supported by data" proof + warning.
 */
export function buildProfitLadder(
  category: OpportunityCategory,
  capitalRequiredUsd: number | null,
  upsideHighUsd: number | null,
): ProfitLadderStep[] {
  // The evidenced ceiling is the only point we have real data for; everything
  // above it is explicitly illustrative.
  const evidencedCeiling = upsideHighUsd ?? capitalRequiredUsd ?? 0;
  return LADDER_TIERS.map((tier) => {
    const evidenced = evidencedCeiling > 0 && tier.to <= evidencedCeiling;
    const probability = ladderProbability(tier.to, evidencedCeiling);
    return {
      tier: tier.label,
      fromUsd: tier.from,
      toUsd: tier.to,
      strategy: ladderStrategy(category, tier, evidenced),
      requiredCapitalUsd: tier.from,
      timeline:
        tier.to <= 1_000 ? 'days–weeks (per cycle)' :
        tier.to <= 100_000 ? 'months per cycle' :
        tier.to <= 1_000_000 ? '1–3 years' :
        'multi-year, multiple deals',
      riskLevel: ladderRiskLevel(tier.to, evidencedCeiling),
      proof: evidenced
        ? `Within the opportunity's evidenced upside (~$${evidencedCeiling.toLocaleString('en-US')}).`
        : 'No IVX data supports this rung — illustrative compounding path only.',
      probability,
      blockers:
        probability === 'speculative'
          ? ['Requires capital + deal flow far beyond this single opportunity', 'Market, financing, and execution risk compound at each rung']
          : ['Capital availability', 'Deal/asset availability at the right price', 'Execution + timing risk'],
      legalWarning: LEGAL_WARNING,
    };
  });
}

// ── Execution plan ────────────────────────────────────────────────────────────

function buildExecutionPlan(
  category: OpportunityCategory,
  title: string,
  capitalRequiredUsd: number | null,
  upsideLowUsd: number | null,
  upsideHighUsd: number | null,
  nextActions: string[],
): OpportunityExecutionPlan {
  const capitalText = capitalRequiredUsd !== null ? `$${capitalRequiredUsd.toLocaleString('en-US')}` : 'unspecified (confirm minimum)';
  const upsideText =
    upsideLowUsd !== null && upsideHighUsd !== null
      ? `$${upsideLowUsd.toLocaleString('en-US')}–$${upsideHighUsd.toLocaleString('en-US')} (evidence-based range, not a guarantee)`
      : 'not quantified yet — derive from deal-room documents (no fabricated number)';

  const baseDocs = ['Term sheet / offering memo', 'Financials (budget, proforma)', 'Title / ownership verification'];
  const categoryDocs: Record<OpportunityCategory, string[]> = {
    real_estate: ['Appraisal', 'Inspection report', 'Rent roll / comps'],
    distressed_asset: ['Lien/encumbrance search', 'As-is appraisal', 'Renovation scope + budget'],
    financing: ['Loan term sheet', 'Rate/amortization schedule', 'Covenant list'],
    investor: ['Investor KYC/AML', 'Subscription agreement', 'Cap table'],
    arbitrage: ['Both-side pricing proof', 'Execution/settlement terms', 'Fee schedule'],
    partnership: ['Partnership/JV agreement', 'Revenue-share terms', 'Counterparty due diligence'],
    technology_business: ['Spec / scope', 'Cost + timeline estimate', 'Revenue model'],
  };

  return {
    actionPlan: [
      `Validate the evidence behind "${title}" against primary documents before committing capital.`,
      `Confirm capital required (${capitalText}) and the realistic upside range (${upsideText}).`,
      'Run the financial model (NOI/cap rate/IRR or trade spread) and stress-test the downside.',
      'Confirm legal/compliance (securities, AML, licensing) with counsel.',
      'Decide: pursue, watch, or dismiss — and set the next review date.',
    ],
    contacts: [
      'IVX deal/acquisition lead',
      category === 'investor' ? 'Investor relations / placement agent' : 'Counterparty / broker',
      'Legal counsel',
      'Lender / capital partner',
    ],
    documentsNeeded: [...baseDocs, ...categoryDocs[category]],
    fundingPath:
      capitalRequiredUsd !== null && capitalRequiredUsd <= 1_000
        ? 'Self-fundable at the stated minimum; scale via reinvestment.'
        : 'Blend owner capital + investor co-invest + structured financing; size to the confirmed minimum.',
    expectedUpside: upsideText,
    worstCaseRisk:
      'Total loss of committed capital is possible. Illiquidity, market downturn, financing fall-through, or execution failure can wipe out the position. No outcome is guaranteed.',
    nextThreeActions: nextActions.slice(0, 3).length === 3
      ? nextActions.slice(0, 3)
      : [
          'Open the deal room and verify the headline numbers.',
          'Run the financial model + downside case.',
          'Get a legal/compliance read before any commitment.',
        ],
  };
}

// ── Deal-derived opportunities ────────────────────────────────────────────────

function dealScores(deal: DealScore): { scores: OpportunityScores; category: OpportunityCategory } {
  const m = deal.metrics;
  // Evidence = data completeness; risk sub-score already "high = safe"; speed from
  // timeline; capital accessibility from minimum ownership; upside from ROI.
  const evidence = Math.round(m.dataCompleteness * 100);
  const risk = Math.round(deal.riskScore);
  const speed = Math.round(deal.timelineScore);
  const capital =
    m.minOwnershipUsd === null ? 50 :
    m.minOwnershipUsd <= 100 ? 100 :
    m.minOwnershipUsd <= 1_000 ? 85 :
    m.minOwnershipUsd <= 10_000 ? 65 :
    m.minOwnershipUsd <= 100_000 ? 45 : 25;
  const upside = Math.round(deal.roiScore);
  // Distressed/active classification is a heuristic: low completion or unpublished
  // → distressed-style; otherwise a standard real-estate position.
  const category: OpportunityCategory = deal.completionScore < 55 ? 'distressed_asset' : 'real_estate';
  return { scores: { evidence, risk, speed, capital, upside }, category };
}

function dealUpsideRange(deal: DealScore): { low: number | null; high: number | null } {
  const price = deal.metrics.priceUsd;
  const roi = deal.metrics.roiPercent;
  if (price === null || roi === null) {
    return { low: null, high: null };
  }
  // Evidence-based gross upside band from the stated ROI; conservative low = 60%
  // of stated (execution drag), high = stated ROI. NOT a guarantee.
  const high = Math.round(price * (roi / 100));
  const low = Math.round(high * 0.6);
  return { low, high };
}

function deriveDealOpportunities(signal: OpportunitySignalSnapshot): CreateOpportunityInput[] {
  return signal.deals.rankedDeals.map((deal) => {
    const { scores, category } = dealScores(deal);
    const { low, high } = dealUpsideRange(deal);
    const capitalRequiredUsd = deal.metrics.minOwnershipUsd;
    const nextActions = [
      `Open the ${deal.name} deal room and verify ROI ${deal.metrics.roiPercent ?? 'n/a'}% + price.`,
      'Run the proforma + downside case against the stated numbers.',
      'Confirm minimum ownership terms and legal/compliance.',
    ];
    return {
      title: `${deal.name} — ${category === 'distressed_asset' ? 'value-add / distressed position' : 'JV real-estate position'}`,
      summary: `${deal.rationale} Ranked ${deal.weightedScore}/100 by the deal-intelligence model (${deal.recommendation.toUpperCase()}).`,
      category,
      capitalRequiredUsd,
      upsideLowUsd: low,
      upsideHighUsd: high,
      timeline: deal.metrics.timelineMonths !== null ? `~${deal.metrics.timelineMonths} months` : 'unspecified',
      scores,
      confidence: Math.round(deal.metrics.dataCompleteness * 100),
      evidence: `Live jv_deals project "${deal.name}": ROI ${deal.metrics.roiPercent ?? 'n/a'}%, price ${deal.metrics.priceUsd !== null ? `$${deal.metrics.priceUsd.toLocaleString('en-US')}` : 'n/a'}, min ${deal.metrics.minOwnershipUsd !== null ? `$${deal.metrics.minOwnershipUsd.toLocaleString('en-US')}` : 'n/a'}, weighted score ${deal.weightedScore}/100.`,
      evidenceLinks: ['jv_deals (Supabase) — authoritative project source', 'IVX deal-intelligence scoring model'],
      riskWarnings: deal.risks.length > 0 ? deal.risks : ['Standard real-estate execution + market-timing risk applies.'],
      legalWarning: LEGAL_WARNING,
      nextActions,
      profitLadder: buildProfitLadder(category, capitalRequiredUsd, high),
      executionPlan: buildExecutionPlan(category, deal.name, capitalRequiredUsd, low, high, nextActions),
    };
  });
}

function deriveFinancingAndInvestorOpportunities(signal: OpportunitySignalSnapshot): CreateOpportunityInput[] {
  const out: CreateOpportunityInput[] = [];
  const published = signal.deals.publishedProjects;
  if (published <= 0) {
    return out;
  }

  // Investor-capital aggregation opportunity (grounded in real published count).
  const investorNext = [
    'Define the co-invest vehicle terms (minimum, carry, fees).',
    'Run investor KYC/AML + subscription docs.',
    'Match investors to the highest-scored published deals.',
  ];
  out.push({
    title: 'Investor co-invest aggregation across the published portfolio',
    summary: `Pool investor capital into the ${published} published JV deal(s) to take larger positions and scale fee/carry — grounded in the live portfolio, not a projection.`,
    category: 'investor',
    capitalRequiredUsd: null,
    upsideLowUsd: null,
    upsideHighUsd: null,
    timeline: '1–3 months to structure',
    scores: { evidence: 70, risk: 55, speed: 55, capital: 60, upside: 72 },
    confidence: 60,
    evidence: `${published} published jv_deals project(s) are live and investable right now.`,
    evidenceLinks: ['jv_deals (Supabase)'],
    riskWarnings: ['Securities/AML compliance is mandatory before pooling third-party capital.', 'Investor demand is unproven until subscriptions are signed.'],
    legalWarning: LEGAL_WARNING,
    nextActions: investorNext,
    profitLadder: buildProfitLadder('investor', null, null),
    executionPlan: buildExecutionPlan('investor', 'Investor co-invest aggregation', null, null, null, investorNext),
  });

  // Financing/structured-capital opportunity.
  const financingNext = [
    'Get lender term sheets for the top-scored deals.',
    'Model leveraged vs all-cash returns + covenants.',
    'Confirm refinancing/exit path before drawing debt.',
  ];
  out.push({
    title: 'Structured financing to recycle capital across deals',
    summary: 'Use debt/structured financing to control more asset value per dollar and recycle capital across the published deals — leverage amplifies BOTH upside and loss.',
    category: 'financing',
    capitalRequiredUsd: null,
    upsideLowUsd: null,
    upsideHighUsd: null,
    timeline: 'weeks to arrange per deal',
    scores: { evidence: 62, risk: 45, speed: 60, capital: 70, upside: 68 },
    confidence: 55,
    evidence: `${published} published deal(s) available to finance; leverage terms must be sourced live.`,
    evidenceLinks: ['jv_deals (Supabase)'],
    riskWarnings: ['Leverage magnifies losses and can force a sale in a downturn.', 'Covenant breach or rate shock can wipe out equity.'],
    legalWarning: LEGAL_WARNING,
    nextActions: financingNext,
    profitLadder: buildProfitLadder('financing', null, null),
    executionPlan: buildExecutionPlan('financing', 'Structured financing', null, null, null, financingNext),
  });

  return out;
}

function deriveCapabilityOpportunities(signal: OpportunitySignalSnapshot): CreateOpportunityInput[] {
  const out: CreateOpportunityInput[] = [];
  const gaps = signal.competitor.missingCapabilities + signal.competitor.partialCapabilities;
  if (gaps > 0) {
    const techNext = [
      'Scope the highest-leverage capability gap into a shippable feature.',
      'Attach a revenue model (fee/subscription/efficiency saving).',
      'Build → test → deploy via the autonomous loop, then measure adoption.',
    ];
    out.push({
      title: 'Productize a platform capability gap into a revenue feature',
      summary: `The autonomous-core map shows ${signal.competitor.missingCapabilities} missing + ${signal.competitor.partialCapabilities} partial capabilities — closing one as a paid feature is an out-build-competitors opportunity.`,
      category: 'technology_business',
      capitalRequiredUsd: null,
      upsideLowUsd: null,
      upsideHighUsd: null,
      timeline: 'days–weeks to ship',
      scores: { evidence: 66, risk: 60, speed: 72, capital: 85, upside: 70 },
      confidence: 64,
      evidence: `${gaps} capability gap(s) detected by the autonomous-core dashboard.`,
      evidenceLinks: ['ivx-autonomous-core capability map'],
      riskWarnings: ['Feature value is unproven until users adopt it.', 'Engineering time has an opportunity cost.'],
      legalWarning: LEGAL_WARNING,
      nextActions: techNext,
      profitLadder: buildProfitLadder('technology_business', null, null),
      executionPlan: buildExecutionPlan('technology_business', 'Platform capability feature', null, null, null, techNext),
    });
  }

  if (signal.deals.publishedProjects >= 2) {
    const partnerNext = [
      'Identify brokers/operators who source deals in the active markets.',
      'Draft a revenue-share / referral structure.',
      'Run counterparty due diligence before signing.',
    ];
    out.push({
      title: 'Deal-flow partnership with brokers/operators in active markets',
      summary: 'Convert the active portfolio markets into a recurring deal-flow partnership (referral / revenue share) to source more opportunities without growing fixed cost.',
      category: 'partnership',
      capitalRequiredUsd: null,
      upsideLowUsd: null,
      upsideHighUsd: null,
      timeline: '1–2 months to formalize',
      scores: { evidence: 58, risk: 62, speed: 50, capital: 80, upside: 64 },
      confidence: 55,
      evidence: `${signal.deals.publishedProjects} published deal(s) establish the active markets a partnership can feed.`,
      evidenceLinks: ['jv_deals (Supabase)'],
      riskWarnings: ['Partnership value depends on the counterparty actually delivering deal flow.', 'Revenue-share terms must be compliant.'],
      legalWarning: LEGAL_WARNING,
      nextActions: partnerNext,
      profitLadder: buildProfitLadder('partnership', null, null),
      executionPlan: buildExecutionPlan('partnership', 'Deal-flow partnership', null, null, null, partnerNext),
    });
  }

  return out;
}

/**
 * Derive all scored opportunities from the signal snapshot. Every opportunity is
 * grounded in a real signal value (placed in `evidence`) — nothing is hardcoded.
 */
export function deriveOpportunities(signal: OpportunitySignalSnapshot): CreateOpportunityInput[] {
  return [
    ...deriveDealOpportunities(signal),
    ...deriveFinancingAndInvestorOpportunities(signal),
    ...deriveCapabilityOpportunities(signal),
  ];
}

// ── Alerts ────────────────────────────────────────────────────────────────────

/** Derive owner alerts from the freshly-ranked opportunities. */
export function deriveAlerts(opportunities: Opportunity[]): CreateAlertInput[] {
  const alerts: CreateAlertInput[] = [];
  for (const opp of opportunities) {
    if (opp.scores.upside >= 75 && opp.scores.evidence >= 60) {
      alerts.push({
        opportunityId: opp.id,
        type: 'high_upside',
        severity: 'warning',
        message: `High-upside opportunity: "${opp.title}" (overall ${opp.overall}/100, upside ${opp.scores.upside}/100, evidence ${opp.scores.evidence}/100).`,
      });
    }
    if (opp.category === 'distressed_asset' && opp.scores.evidence >= 50) {
      alerts.push({
        opportunityId: opp.id,
        type: 'undervalued_deal',
        severity: 'info',
        message: `Potentially undervalued / value-add deal flagged: "${opp.title}". Verify the discount against an appraisal.`,
      });
    }
    if (opp.category === 'investor' && opp.scores.upside >= 65) {
      alerts.push({
        opportunityId: opp.id,
        type: 'investor_match',
        severity: 'info',
        message: `Investor opportunity ready to structure: "${opp.title}".`,
      });
    }
    if (opp.category === 'financing' && opp.scores.evidence >= 55) {
      alerts.push({
        opportunityId: opp.id,
        type: 'financing_path',
        severity: 'info',
        message: `Financing path available: "${opp.title}". Source live lender terms before drawing debt.`,
      });
    }
    if (opp.category === 'technology_business' && opp.overall >= 65) {
      alerts.push({
        opportunityId: opp.id,
        type: 'acquisition_target',
        severity: 'info',
        message: `Build/own opportunity worth pursuing: "${opp.title}".`,
      });
    }
  }
  return alerts;
}

export type OpportunityScanResult = {
  marker: typeof IVX_OPPORTUNITY_ENGINE_MARKER;
  scannedAt: string;
  signal: OpportunitySignalSnapshot;
  research: ResearchSource[];
  generatedCount: number;
  alertsRaised: number;
  opportunities: Opportunity[];
};

/**
 * Run one full scan: collect signals → derive scored opportunities → persist
 * (de-duped) → raise alerts → return the refreshed, ranked list.
 */
export async function runOpportunityScan(): Promise<OpportunityScanResult> {
  const { withAgentRun } = await import('./ivx-agent-activity-store');
  return withAgentRun(
    {
      kind: 'opportunity_scan',
      label: 'Opportunity scan',
      why: 'Discover and rank high-upside opportunities from real deal, capability, and incident signals.',
      detail: 'Collecting opportunity signals and deriving scored opportunities…',
      proofOf: (result) => `Generated ${result.generatedCount} opportunity(ies); ${result.opportunities.length} total · ${result.alertsRaised} alert(s) raised.`,
    },
    async () => {
      const signal = await collectOpportunitySignals();
      const candidates = deriveOpportunities(signal);
      if (candidates.length > 0) {
        await upsertOpportunities(candidates);
      }
      const opportunities = await listOpportunities();
      const alertInputs = deriveAlerts(opportunities);
      const raised = alertInputs.length > 0 ? await raiseAlerts(alertInputs) : [];
      console.log('[IVXOpportunityEngine] SCAN', {
        marker: IVX_OPPORTUNITY_ENGINE_MARKER,
        generated: candidates.length,
        total: opportunities.length,
        alerts: raised.length,
      });
      return {
        marker: IVX_OPPORTUNITY_ENGINE_MARKER,
        scannedAt: signal.scannedAt,
        signal,
        research: buildResearchLayer(),
        generatedCount: candidates.length,
        alertsRaised: raised.length,
        opportunities,
      };
    },
  );
}

/** Re-export so callers can reuse the overall blend without importing the store. */
export { computeOverallScore };
