/**
 * Canonical deal pathway types, status labels, and constants.
 *
 * Each deal can independently enable three participation pathways:
 * Tokenized, JV, and Buyer. The admin controls which pathways are active
 * per deal. This file provides the single source of truth for status
 * labels, defaults, and validation logic used across cards, backend, and admin.
 */

// ── Tokenized pathway ──

export type TokenizedStatus =
  | 'TOKENIZED_NOT_AVAILABLE'
  | 'TOKENIZED_COMING_SOON'
  | 'TOKENIZED_WAITLIST'
  | 'TOKENIZED_OPEN'
  | 'TOKENIZED_PAUSED'
  | 'TOKENIZED_FULLY_ALLOCATED'
  | 'TOKENIZED_CLOSED';

export const TOKENIZED_STATUS_LABELS: Record<TokenizedStatus, string> = {
  TOKENIZED_NOT_AVAILABLE: 'Not Available',
  TOKENIZED_COMING_SOON: 'Coming Soon',
  TOKENIZED_WAITLIST: 'Waitlist Open',
  TOKENIZED_OPEN: 'Open',
  TOKENIZED_PAUSED: 'Paused',
  TOKENIZED_FULLY_ALLOCATED: 'Fully Allocated',
  TOKENIZED_CLOSED: 'Closed',
};

export const DEFAULT_SHARE_PRICE = 50.0;
export const DEFAULT_MINIMUM_SHARES = 1;
export const DEFAULT_MINIMUM_TOKENIZED_INVESTMENT = 50.0;

// ── JV pathway ──

export type JVStatus =
  | 'JV_NOT_AVAILABLE'
  | 'JV_COMING_SOON'
  | 'JV_OPEN'
  | 'JV_PAUSED'
  | 'JV_CLOSED';

export const JV_STATUS_LABELS: Record<JVStatus, string> = {
  JV_NOT_AVAILABLE: 'Not Available',
  JV_COMING_SOON: 'Coming Soon',
  JV_OPEN: 'Open',
  JV_PAUSED: 'Paused',
  JV_CLOSED: 'Closed',
};

export const DEFAULT_JV_MINIMUM_CONTRIBUTION = 20000;

// ── Buyer pathway ──

export type BuyerStatus =
  | 'BUYER_NOT_AVAILABLE'
  | 'BUYER_OPEN'
  | 'BUYER_PAUSED'
  | 'BUYER_CLOSED'
  | 'BUYER_UNDER_CONTRACT';

export const BUYER_STATUS_LABELS: Record<BuyerStatus, string> = {
  BUYER_NOT_AVAILABLE: 'Not Available',
  BUYER_OPEN: 'Open',
  BUYER_PAUSED: 'Paused',
  BUYER_CLOSED: 'Closed',
  BUYER_UNDER_CONTRACT: 'Under Contract',
};

// ── Publish workflow ──

export type PublishState =
  | 'draft'
  | 'under_review'
  | 'approved'
  | 'published'
  | 'paused'
  | 'closed'
  | 'archived';

export const PUBLISH_STATE_LABELS: Record<PublishState, string> = {
  draft: 'Draft',
  under_review: 'Under Review',
  approved: 'Approved',
  published: 'Published',
  paused: 'Paused',
  closed: 'Closed',
  archived: 'Archived',
};

// ── Payment readiness ──

export type PaymentReadiness =
  | 'PAYMENT_NOT_CONFIGURED'
  | 'TEST_PAYMENT_AVAILABLE'
  | 'LIVE_PAYMENT_AVAILABLE';

export const PAYMENT_READINESS_LABELS: Record<PaymentReadiness, string> = {
  PAYMENT_NOT_CONFIGURED: 'Payment Not Configured',
  TEST_PAYMENT_AVAILABLE: 'Test Payment Available',
  LIVE_PAYMENT_AVAILABLE: 'Live Payment Available',
};

// ── Pathway config interface (matches DB columns) ──

export interface DealPathwayConfig {
  // Tokenized
  tokenized_enabled: boolean;
  tokenized_status: TokenizedStatus;
  share_price: number;
  total_shares: number;
  available_shares: number;
  sold_shares: number;
  minimum_shares: number;
  maximum_shares_per_investor: number;
  tokenized_capital_target: number;
  tokenized_capital_raised: number;
  kyc_required: boolean;
  tokenized_launch_date: string | null;
  tokenized_close_date: string | null;

  // JV
  jv_enabled: boolean;
  jv_status: JVStatus;
  jv_minimum_contribution: number;
  jv_maximum_contribution: number;
  jv_capital_target: number;
  jv_capital_raised: number;
  jv_structure: string | null;
  jv_open_date: string | null;
  jv_close_date: string | null;

  // Buyer
  buyer_enabled: boolean;
  buyer_status: BuyerStatus;
  buyer_asking_price: number;
  buyer_minimum_offer: number;
  allow_below_asking: boolean;
  allow_above_asking: boolean;
  earnest_money_required: boolean;
  proof_of_funds_required: boolean;
  financing_allowed: boolean;
  cash_only: boolean;
  inspection_period_days: number;
  closing_target_days: number;
  offer_expiration_days: number;

  // Publish
  publish_state: PublishState;
  slug: string | null;
  capital_raised: number;
  progress_percentage: number;
  featured: boolean;
}

export const DEFAULT_PATHWAY_CONFIG: DealPathwayConfig = {
  tokenized_enabled: false,
  tokenized_status: 'TOKENIZED_COMING_SOON',
  share_price: DEFAULT_SHARE_PRICE,
  total_shares: 0,
  available_shares: 0,
  sold_shares: 0,
  minimum_shares: DEFAULT_MINIMUM_SHARES,
  maximum_shares_per_investor: 0,
  tokenized_capital_target: 0,
  tokenized_capital_raised: 0,
  kyc_required: true,
  tokenized_launch_date: null,
  tokenized_close_date: null,

  jv_enabled: true,
  jv_status: 'JV_OPEN',
  jv_minimum_contribution: DEFAULT_JV_MINIMUM_CONTRIBUTION,
  jv_maximum_contribution: 0,
  jv_capital_target: 0,
  jv_capital_raised: 0,
  jv_structure: null,
  jv_open_date: null,
  jv_close_date: null,

  buyer_enabled: true,
  buyer_status: 'BUYER_OPEN',
  buyer_asking_price: 0,
  buyer_minimum_offer: 0,
  allow_below_asking: true,
  allow_above_asking: true,
  earnest_money_required: false,
  proof_of_funds_required: true,
  financing_allowed: true,
  cash_only: false,
  inspection_period_days: 15,
  closing_target_days: 30,
  offer_expiration_days: 7,

  publish_state: 'draft',
  slug: null,
  capital_raised: 0,
  progress_percentage: 0,
  featured: false,
};

// ── Badge display logic ──

export type PathwayBadgeState = 'active' | 'coming_soon' | 'unavailable' | 'paused' | 'closed';

export interface PathwayBadge {
  id: 'tokenized' | 'jv' | 'buyer';
  label: string;
  state: PathwayBadgeState;
  enabled: boolean;
}

/**
 * Returns the badges that should be displayed for a deal based on its
 * pathway configuration. Only shows badges for enabled pathways.
 */
export function getPathwayBadges(config: Partial<DealPathwayConfig> | null | undefined): PathwayBadge[] {
  if (!config) return [];

  const badges: PathwayBadge[] = [];

  // Tokenized badge
  if (config.tokenized_enabled) {
    const status = config.tokenized_status ?? 'TOKENIZED_COMING_SOON';
    const state: PathwayBadgeState =
      status === 'TOKENIZED_OPEN' ? 'active' :
      status === 'TOKENIZED_COMING_SOON' || status === 'TOKENIZED_WAITLIST' ? 'coming_soon' :
      status === 'TOKENIZED_PAUSED' ? 'paused' :
      status === 'TOKENIZED_CLOSED' || status === 'TOKENIZED_FULLY_ALLOCATED' ? 'closed' :
      'unavailable';
    badges.push({
      id: 'tokenized',
      label: 'Tokenized',
      state,
      enabled: true,
    });
  }

  // JV badge
  if (config.jv_enabled) {
    const status = config.jv_status ?? 'JV_NOT_AVAILABLE';
    const state: PathwayBadgeState =
      status === 'JV_OPEN' ? 'active' :
      status === 'JV_COMING_SOON' ? 'coming_soon' :
      status === 'JV_PAUSED' ? 'paused' :
      status === 'JV_CLOSED' ? 'closed' :
      'unavailable';
    badges.push({
      id: 'jv',
      label: 'JV Deal',
      state,
      enabled: true,
    });
  }

  // Buyer badge
  if (config.buyer_enabled) {
    const status = config.buyer_status ?? 'BUYER_NOT_AVAILABLE';
    const state: PathwayBadgeState =
      status === 'BUYER_OPEN' ? 'active' :
      status === 'BUYER_PAUSED' ? 'paused' :
      status === 'BUYER_CLOSED' || status === 'BUYER_UNDER_CONTRACT' ? 'closed' :
      'unavailable';
    badges.push({
      id: 'buyer',
      label: 'Buyer',
      state,
      enabled: true,
    });
  }

  return badges;
}

/**
 * Returns the count of active pathways for a deal.
 */
export function getActivePathwayCount(config: Partial<DealPathwayConfig> | null | undefined): number {
  if (!config) return 0;
  let count = 0;
  if (config.tokenized_enabled && config.tokenized_status === 'TOKENIZED_OPEN') count++;
  if (config.jv_enabled && config.jv_status === 'JV_OPEN') count++;
  if (config.buyer_enabled && config.buyer_status === 'BUYER_OPEN') count++;
  return count;
}

/**
 * Returns the primary CTA label based on active pathways.
 * If one pathway is active, show the specific action.
 * If multiple are active, show "PARTICIPATE NOW".
 */
export function getPrimaryCTALabel(config: Partial<DealPathwayConfig> | null | undefined): string {
  const count = getActivePathwayCount(config);
  if (count === 0) return 'View Deal';

  if (count === 1) {
    if (config?.tokenized_enabled && config?.tokenized_status === 'TOKENIZED_OPEN') {
      return 'Buy Tokenized Shares';
    }
    if (config?.jv_enabled && config?.jv_status === 'JV_OPEN') {
      return 'Apply for JV';
    }
    if (config?.buyer_enabled && config?.buyer_status === 'BUYER_OPEN') {
      return 'Make an Offer';
    }
  }

  return 'Participate Now';
}

/**
 * Tokenized icon action message based on status.
 */
export function getTokenizedIconMessage(status: TokenizedStatus): string {
  switch (status) {
    case 'TOKENIZED_NOT_AVAILABLE':
      return 'Tokenized participation is not available for this project.';
    case 'TOKENIZED_COMING_SOON':
    case 'TOKENIZED_WAITLIST':
      return 'Tokenized participation is coming soon.';
    case 'TOKENIZED_OPEN':
      return ''; // Opens the page directly
    case 'TOKENIZED_PAUSED':
      return 'Tokenized participation is temporarily paused.';
    case 'TOKENIZED_FULLY_ALLOCATED':
      return 'Tokenized participation is fully allocated.';
    case 'TOKENIZED_CLOSED':
      return 'Tokenized participation is closed.';
  }
}

/**
 * JV icon action message based on status.
 */
export function getJVIconMessage(status: JVStatus): string {
  switch (status) {
    case 'JV_NOT_AVAILABLE':
      return 'JV participation is not available for this project.';
    case 'JV_COMING_SOON':
      return 'JV participation is coming soon.';
    case 'JV_OPEN':
      return ''; // Opens the page directly
    case 'JV_PAUSED':
      return 'JV participation is temporarily paused.';
    case 'JV_CLOSED':
      return 'JV participation is closed.';
  }
}

/**
 * Buyer icon action message based on status.
 */
export function getBuyerIconMessage(status: BuyerStatus): string {
  switch (status) {
    case 'BUYER_NOT_AVAILABLE':
      return 'Buyer offers are not available for this project.';
    case 'BUYER_OPEN':
      return ''; // Opens the page directly
    case 'BUYER_PAUSED':
      return 'Buyer offers are temporarily paused.';
    case 'BUYER_CLOSED':
      return 'Buyer offers are closed for this project.';
    case 'BUYER_UNDER_CONTRACT':
      return 'This property is under contract.';
  }
}

/**
 * Calculate the maximum permitted tokenized investment for an investor.
 * Returns the lowest of: capital remaining, shares available * share_price,
 * investor-specific maximum, or 0 if no owner-defined max (meaning
 * "NO OWNER-DEFINED PER-INVESTOR MAXIMUM" but still enforced by allocation).
 */
export function calculateMaxTokenizedInvestment(
  sharePrice: number,
  availableShares: number,
  tokenizedCapitalRemaining: number,
  maxSharesPerInvestor: number,
): { maxShares: number; maxAmount: number; hasOwnerMax: boolean } {
  const sharesByAvailability = availableShares;
  const sharesByCapital = sharePrice > 0 ? Math.floor(tokenizedCapitalRemaining / sharePrice) : 0;
  const hasOwnerMax = maxSharesPerInvestor > 0;
  const sharesByInvestorMax = hasOwnerMax ? maxSharesPerInvestor : Infinity;

  const maxShares = Math.min(sharesByAvailability, sharesByCapital, sharesByInvestorMax);
  const maxAmount = maxShares * sharePrice;

  return { maxShares, maxAmount, hasOwnerMax };
}

/**
 * Validate a JV contribution amount.
 */
export function validateJVContribution(
  amount: number,
  minimum: number,
  capitalRemaining: number,
  maximum: number,
): { valid: boolean; reason?: string } {
  if (amount < minimum) {
    return { valid: false, reason: `Minimum JV contribution is $${minimum.toLocaleString()}.` };
  }
  if (amount > capitalRemaining) {
    return { valid: false, reason: `Amount exceeds remaining JV allocation of $${capitalRemaining.toLocaleString()}.` };
  }
  if (maximum > 0 && amount > maximum) {
    return { valid: false, reason: `Amount exceeds the owner-defined maximum of $${maximum.toLocaleString()}.` };
  }
  return { valid: true };
}

/**
 * Classify a buyer offer relative to asking price.
 */
export function classifyBuyerOffer(
  offerAmount: number,
  askingPrice: number,
  allowBelow: boolean,
): { type: 'BELOW_ASKING_OFFER' | 'FULL_PRICE_OFFER' | 'ABOVE_ASKING_OFFER' | 'REJECTED'; label: string } {
  if (offerAmount < askingPrice) {
    if (!allowBelow) {
      return { type: 'REJECTED', label: 'Below-asking offers are not accepted for this property.' };
    }
    return { type: 'BELOW_ASKING_OFFER', label: 'Below-Asking Offer' };
  }
  if (offerAmount === askingPrice) {
    return { type: 'FULL_PRICE_OFFER', label: 'Full-Price Offer' };
  }
  return { type: 'ABOVE_ASKING_OFFER', label: 'Above-Asking Offer' };
}
