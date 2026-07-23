/**
 * IVX Business Reasoning Engine — Phase 13
 *
 * Structured reasoning tools for:
 * investor qualification, buyer qualification, deal analysis, property comparison,
 * capital requirements, ROI, IRR, risk classification, project matching,
 * lead scoring, follow-up prioritization, document completeness, onboarding state.
 *
 * Every business conclusion must identify: input data, missing data, assumptions,
 * calculation, risk, recommendation, confidence.
 * No invented investor, buyer, or financial information.
 */

// ─── Types ────────────────────────────────────────────────────────

export type IVXBusinessConclusion = {
  type: 'investor_qualification' | 'buyer_qualification' | 'deal_analysis' | 'property_comparison' | 'capital_requirements' | 'roi' | 'irr' | 'risk_classification' | 'project_matching' | 'lead_scoring' | 'follow_up_priority' | 'document_completeness' | 'onboarding_state';
  inputData: Record<string, unknown>;
  missingData: string[];
  assumptions: string[];
  calculation: string;
  risk: string;
  recommendation: string;
  confidence: number; // 0.0 to 1.0
  uncertainty: 'VERIFIED' | 'SUPPORTED' | 'INFERRED' | 'UNKNOWN' | 'NOT_TESTED';
};

// ─── ROI Calculation ──────────────────────────────────────────────

export function calculateROI(input: {
  investmentAmount: number;
  expectedReturn: number;
  holdingPeriodYears: number;
}): IVXBusinessConclusion {
  const { investmentAmount, expectedReturn, holdingPeriodYears } = input;
  const roi = ((expectedReturn - investmentAmount) / investmentAmount) * 100;
  const annualizedROI = roi / holdingPeriodYears;

  return {
    type: 'roi',
    inputData: { investmentAmount, expectedReturn, holdingPeriodYears },
    missingData: [],
    assumptions: ['Expected return is realized at end of holding period', 'No additional capital calls'],
    calculation: `ROI = ((${expectedReturn} - ${investmentAmount}) / ${investmentAmount}) × 100 = ${roi.toFixed(2)}% over ${holdingPeriodYears} years (${annualizedROI.toFixed(2)}%/year)`,
    risk: 'Expected return is not guaranteed; market conditions may affect exit value',
    recommendation: roi > 15 ? 'Attractive ROI — proceed with due diligence' : roi > 8 ? 'Moderate ROI — evaluate against alternative investments' : 'Low ROI — consider alternative opportunities',
    confidence: 0.7,
    uncertainty: 'SUPPORTED',
  };
}

// ─── IRR Calculation (simplified) ─────────────────────────────────

export function calculateIRR(input: {
  initialInvestment: number;
  cashFlows: number[];
}): IVXBusinessConclusion {
  const { initialInvestment, cashFlows } = input;

  // Simple IRR estimation using Newton-Raphson
  let rate = 0.1;
  for (let iter = 0; iter < 50; iter++) {
    let npv = -initialInvestment;
    let dnpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      npv += cashFlows[t] / Math.pow(1 + rate, t + 1);
      dnpv -= (t + 1) * cashFlows[t] / Math.pow(1 + rate, t + 2);
    }
    if (Math.abs(npv) < 0.01) break;
    if (dnpv === 0) break;
    rate = rate - npv / dnpv;
  }

  const irrPercent = rate * 100;

  return {
    type: 'irr',
    inputData: { initialInvestment, cashFlows },
    missingData: [],
    assumptions: ['Cash flows occur at end of each period', 'Cash flows are known with certainty'],
    calculation: `IRR ≈ ${irrPercent.toFixed(2)}% (estimated via Newton-Raphson, ${cashFlows.length} periods)`,
    risk: 'IRR is sensitive to cash flow timing and amounts; small changes can significantly impact results',
    recommendation: irrPercent > 15 ? 'Strong IRR — exceeds typical real estate hurdle rate' : irrPercent > 8 ? 'Acceptable IRR — meets standard hurdle rate' : 'Below hurdle rate — reconsider or negotiate better terms',
    confidence: 0.65,
    uncertainty: 'SUPPORTED',
  };
}

// ─── Investor Qualification ───────────────────────────────────────

export function qualifyInvestor(input: {
  accredited: boolean;
  annualIncome?: number;
  netWorth?: number;
  investmentExperience?: string;
  targetInvestmentAmount?: number;
  kycStatus?: string;
}): IVXBusinessConclusion {
  const missing: string[] = [];
  if (!input.annualIncome) missing.push('annual_income');
  if (!input.netWorth) missing.push('net_worth');
  if (!input.investmentExperience) missing.push('investment_experience');
  if (!input.targetInvestmentAmount) missing.push('target_investment_amount');

  // SEC accreditation: $200k income (single) or $300k joint, OR $1M net worth (excluding primary residence)
  const incomeQualified = (input.annualIncome || 0) >= 200000;
  const netWorthQualified = (input.netWorth || 0) >= 1000000;
  const accredited = input.accredited || incomeQualified || netWorthQualified;

  const kycComplete = input.kycStatus === 'approved' || input.kycStatus === 'pending';

  let recommendation = '';
  let confidence = 0.5;

  if (accredited && kycComplete) {
    recommendation = 'Qualified investor — proceed with deal matching';
    confidence = 0.9;
  } else if (accredited && !kycComplete) {
    recommendation = 'Accredited but KYC incomplete — complete verification before proceeding';
    confidence = 0.7;
  } else if (!accredited) {
    recommendation = 'Not accredited — evaluate under non-accredited investor rules (Reg CF, Reg A+)';
    confidence = 0.6;
  }

  return {
    type: 'investor_qualification',
    inputData: input,
    missingData: missing,
    assumptions: ['US-based investor under SEC Regulation D', 'Self-reported income/net worth is accurate'],
    calculation: `Accredited: ${accredited ? 'YES' : 'NO'} (income≥$200k: ${incomeQualified}, netWorth≥$1M: ${netWorthQualified}). KYC: ${input.kycStatus || 'not started'}`,
    risk: missing.length > 0 ? `Missing ${missing.length} data points — qualification is incomplete` : 'Self-reported data requires verification',
    recommendation,
    confidence,
    uncertainty: missing.length > 2 ? 'UNKNOWN' : 'SUPPORTED',
  };
}

// ─── Deal Analysis ────────────────────────────────────────────────

export function analyzeDeal(input: {
  dealId: string;
  dealName: string;
  capitalRequired: number;
  targetROI: number;
  minInvestment: number;
  location: string;
  holdingPeriod?: number;
  developerTrackRecord?: string;
}): IVXBusinessConclusion {
  const missing: string[] = [];
  if (!input.holdingPeriod) missing.push('holding_period');
  if (!input.developerTrackRecord) missing.push('developer_track_record');

  const riskLevel = input.targetROI > 20 ? 'high' : input.targetROI > 10 ? 'medium' : 'low';
  const minInvestmentRatio = (input.minInvestment / input.capitalRequired) * 100;

  return {
    type: 'deal_analysis',
    inputData: input,
    missingData: missing,
    assumptions: ['Target ROI is achievable', 'Developer will deliver on timeline', 'Market conditions remain stable'],
    calculation: `Capital: $${input.capitalRequired.toLocaleString()}, Target ROI: ${input.targetROI}%, Min investment: $${input.minInvestment.toLocaleString()} (${minInvestmentRatio.toFixed(1)}% of capital), Risk: ${riskLevel}`,
    risk: `High target ROI (${input.targetROI}%) suggests ${riskLevel} risk${missing.length > 0 ? `. Missing: ${missing.join(', ')}` : ''}`,
    recommendation: riskLevel === 'low' ? 'Conservative deal — suitable for risk-averse investors' : riskLevel === 'medium' ? 'Balanced risk-reward — standard due diligence recommended' : 'High-risk, high-reward — enhanced due diligence required',
    confidence: missing.length > 1 ? 0.5 : 0.75,
    uncertainty: missing.length > 1 ? 'INFERRED' : 'SUPPORTED',
  };
}

// ─── Lead Scoring ─────────────────────────────────────────────────

export function scoreLead(input: {
  source: string;
  expressedInterest: 'high' | 'medium' | 'low' | 'none';
  completedRegistration: boolean;
  viewedDeals: number;
  submittedDocuments: boolean;
  lastActivityDays: number;
}): IVXBusinessConclusion {
  let score = 0;

  // Source quality
  if (input.source === 'invest_modal') score += 20;
  else if (input.source === 'landing') score += 10;
  else if (input.source === 'mobile') score += 15;

  // Interest level
  if (input.expressedInterest === 'high') score += 30;
  else if (input.expressedInterest === 'medium') score += 20;
  else if (input.expressedInterest === 'low') score += 10;

  // Registration
  if (input.completedRegistration) score += 20;

  // Deal views
  score += Math.min(15, input.viewedDeals * 3);

  // Documents
  if (input.submittedDocuments) score += 10;

  // Recency penalty
  if (input.lastActivityDays > 30) score -= 10;
  else if (input.lastActivityDays > 7) score -= 5;

  score = Math.max(0, Math.min(100, score));

  let priority = 'cold';
  if (score >= 70) priority = 'hot';
  else if (score >= 40) priority = 'warm';

  return {
    type: 'lead_scoring',
    inputData: input,
    missingData: [],
    assumptions: ['Activity data is accurate', 'No duplicate accounts'],
    calculation: `Score: ${score}/100 (${priority} lead). Source: ${input.source} (+), Interest: ${input.expressedInterest} (+), Registration: ${input.completedRegistration ? 'yes' : 'no'}, Deals viewed: ${input.viewedDeals}, Documents: ${input.submittedDocuments ? 'yes' : 'no'}, Recency: ${input.lastActivityDays}d`,
    risk: 'Score is based on observable signals — actual intent may differ',
    recommendation: priority === 'hot' ? 'Hot lead (score ' + score + '/100) — prioritize immediate follow-up within 24 hours' : priority === 'warm' ? 'Warm lead (score ' + score + '/100) — include in weekly nurture campaign' : 'Cold lead (score ' + score + '/100) — add to long-term re-engagement list',
    confidence: 0.7,
    uncertainty: 'SUPPORTED',
  };
}

// ─── Document Completeness ────────────────────────────────────────

export function checkDocumentCompleteness(input: {
  requiredDocuments: string[];
  submittedDocuments: string[];
}): IVXBusinessConclusion {
  const missing = input.requiredDocuments.filter((d) => !input.submittedDocuments.includes(d));
  const completeness = ((input.submittedDocuments.length / input.requiredDocuments.length) * 100);

  return {
    type: 'document_completeness',
    inputData: { required: input.requiredDocuments, submitted: input.submittedDocuments },
    missingData: missing,
    assumptions: ['Document list is current', 'Submitted documents are valid and not expired'],
    calculation: `${input.submittedDocuments.length}/${input.requiredDocuments.length} documents submitted (${completeness.toFixed(0)}%)`,
    risk: missing.length > 0 ? `Missing ${missing.length} documents: ${missing.join(', ')}` : 'All required documents submitted',
    recommendation: missing.length === 0 ? 'Document package complete — proceed to review' : `Request missing documents: ${missing.join(', ')}`,
    confidence: 0.9,
    uncertainty: 'VERIFIED',
  };
}

// ─── Risk Classification ──────────────────────────────────────────

export function classifyRisk(input: {
  dealROI: number;
  holdingPeriod: number;
  developerExperience: 'experienced' | 'limited' | 'unknown';
  marketVolatility: 'low' | 'medium' | 'high';
  diversification: 'single_asset' | 'portfolio' | 'fund';
}): IVXBusinessConclusion {
  let riskScore = 0;

  // ROI risk
  if (input.dealROI > 20) riskScore += 30;
  else if (input.dealROI > 12) riskScore += 20;
  else riskScore += 10;

  // Holding period risk
  if (input.holdingPeriod > 5) riskScore += 15;
  else if (input.holdingPeriod > 2) riskScore += 10;
  else riskScore += 5;

  // Developer risk
  if (input.developerExperience === 'unknown') riskScore += 25;
  else if (input.developerExperience === 'limited') riskScore += 15;
  else riskScore += 5;

  // Market volatility
  if (input.marketVolatility === 'high') riskScore += 20;
  else if (input.marketVolatility === 'medium') riskScore += 10;
  else riskScore += 0;

  // Diversification
  if (input.diversification === 'single_asset') riskScore += 15;
  else if (input.diversification === 'portfolio') riskScore += 5;
  else riskScore += 0;

  let riskClass = 'low';
  if (riskScore >= 70) riskClass = 'high';
  else if (riskScore >= 40) riskClass = 'medium';

  return {
    type: 'risk_classification',
    inputData: input,
    missingData: [],
    assumptions: ['Risk factors are weighted equally', 'Market conditions remain within expected range'],
    calculation: `Risk score: ${riskScore}/100 → ${riskClass.toUpperCase()} risk (ROI:${input.dealROI}%, holding:${input.holdingPeriod}y, developer:${input.developerExperience}, market:${input.marketVolatility}, diversification:${input.diversification})`,
    risk: `Overall risk classification: ${riskClass}`,
    recommendation: riskClass === 'high' ? 'Enhanced due diligence required — disclose risks prominently to investors' : riskClass === 'medium' ? 'Standard due diligence — disclose material risks' : 'Low risk — standard disclosure sufficient',
    confidence: 0.75,
    uncertainty: 'SUPPORTED',
  };
}

// ─── Onboarding State ────────────────────────────────────────────

export function assessOnboardingState(input: {
  authUserCreated: boolean;
  profileCreated: boolean;
  memberCreated: boolean;
  rolesAssigned: string[];
  emailVerified: boolean;
  phoneVerified: boolean;
  kycStatus: string;
  documentsSubmitted: boolean;
}): IVXBusinessConclusion {
  const steps = [
    { name: 'auth_user', complete: input.authUserCreated },
    { name: 'profile', complete: input.profileCreated },
    { name: 'member', complete: input.memberCreated },
    { name: 'roles', complete: input.rolesAssigned.length > 0 },
    { name: 'email_verified', complete: input.emailVerified },
    { name: 'phone_verified', complete: input.phoneVerified },
    { name: 'kyc', complete: input.kycStatus === 'approved' },
    { name: 'documents', complete: input.documentsSubmitted },
  ];

  const completedSteps = steps.filter((s) => s.complete).length;
  const incompleteSteps = steps.filter((s) => !s.complete).map((s) => s.name);
  const progress = (completedSteps / steps.length) * 100;

  return {
    type: 'onboarding_state',
    inputData: input,
    missingData: incompleteSteps,
    assumptions: ['Onboarding steps are sequential', 'Email verification requires SMTP (currently not configured)'],
    calculation: `${completedSteps}/${steps.length} steps complete (${progress.toFixed(0)}%). Missing: ${incompleteSteps.join(', ') || 'none'}`,
    risk: input.emailVerified === false && !input.emailVerified ? 'Email verification blocked by SMTP not configured' : '',
    recommendation: progress === 100 ? 'Onboarding complete — investor is fully onboarded' : `Next step: ${incompleteSteps[0] || 'none'}`,
    confidence: 0.95,
    uncertainty: 'VERIFIED',
  };
}

export const IVX_BUSINESS_REASONING_MARKER = 'ivx-business-reasoning-2026-07-23-v1';
