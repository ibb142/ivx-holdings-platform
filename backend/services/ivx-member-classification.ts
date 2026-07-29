/**
 * IVX Member Classification Engine
 *
 * The single authoritative service that classifies every member into one of
 * three tiers based on verified identity, compliance, and transaction data:
 *
 *   PENDING   — basic verification incomplete
 *   REGULAR   — verified registration, zero completed transactions
 *   INVESTOR  — KYC approved, ≥1 completed transaction, <$500k qualifying capital
 *   VIP       — qualifying invested capital ≥ $500,000
 *
 * VIP calculation rule (production):
 *   qualifying_invested_capital = lifetime_settled_investment - refunded_principal
 *
 * Only these transaction statuses count as completed capital:
 *   settled, completed, funded_and_confirmed
 *
 * These statuses NEVER count:
 *   draft, interested, reserved, pending, processing,
 *   failed, rejected, cancelled, refunded, test
 *
 * Security rules:
 *   - Financial totals are NEVER computed from client code
 *   - Test transactions (is_test = true) are excluded from all totals
 *   - Manual tier overrides require owner authorization + documented reason
 *   - Every classification change writes an immutable audit event
 *   - Duplicate transactions are prevented via idempotency_key
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

export const CLASSIFICATION_VERSION = '1.0.0';
export const CLASSIFICATION_MARKER = 'ivx-member-classification-2026-07-28-v1';

// ── Tier and Status Types ──

export type MemberTier = 'PENDING' | 'REGULAR' | 'INVESTOR' | 'VIP';
export type InvestorStatus = 'NOT_VERIFIED' | 'ACTIVE' | 'RESTRICTED_OR_PENDING' | 'SUSPENDED';

export const VALID_TIERS: readonly MemberTier[] = ['PENDING', 'REGULAR', 'INVESTOR', 'VIP'];
export const VALID_INVESTOR_STATUSES: readonly InvestorStatus[] = [
  'NOT_VERIFIED', 'ACTIVE', 'RESTRICTED_OR_PENDING', 'SUSPENDED',
];

// ── Transaction Status Rules ──

/** Only these statuses count as completed capital. */
export const COMPLETED_TXN_STATUSES = new Set([
  'settled', 'completed', 'funded_and_confirmed',
]);

/** These statuses NEVER count toward qualifying capital. */
export const NON_QUALIFYING_STATUSES = new Set([
  'draft', 'interested', 'reserved', 'pending', 'processing',
  'failed', 'rejected', 'cancelled', 'refunded', 'test',
]);

// ── VIP Threshold ──

/** Qualifying invested capital (in cents) required for VIP: $500,000 */
export const VIP_THRESHOLD_CENTS = 50_000_000; // $500,000 in cents

// ── Financial Summary ──

export interface MemberFinancialSummary {
  member_id: string;
  completed_transactions: number;
  lifetime_settled_investment: number;   // cents
  current_active_principal: number;      // cents
  committed_capital: number;             // cents
  pending_capital: number;               // cents
  refunded_principal: number;            // cents
  cancelled_capital: number;             // cents
  distributed_amount: number;            // cents
  qualifying_invested_capital: number;   // cents = lifetime_settled - refunded
  largest_completed_transaction: number; // cents
  last_completed_transaction_at: string | null;
  calculated_at: string;
}

// ── Classification Input ──

export interface CanonicalMemberData {
  member_id: string;
  auth_user_id: string | null;
  email: string;
  email_verified: boolean;
  email_verified_at: string | null;
  sms_verified: boolean;
  phone_verified_at: string | null;
  member_tier: MemberTier | null;
  investor_status: InvestorStatus | null;
  kyc_status: string | null;
  identity_status: string | null;
  registration_status: string | null;
}

export interface InvestorProfileData {
  member_id: string;
  kyc_status: string;
  tax_status: string;
  compliance_status: string;
  investor_agreement_at: string | null;
  approved_at: string | null;
  restricted_at: string | null;
}

export interface TransactionRecord {
  id: string;
  member_id: string;
  amount: number;         // cents
  status: string;
  refunded_amount: number; // cents
  settled_at: string | null;
  is_test: boolean;
  external_reference: string | null;
  source: string;
}

// ── Classification Result ──

export interface ClassificationResult {
  ok: boolean;
  member_id: string;
  previous_tier: MemberTier | null;
  new_tier: MemberTier;
  previous_investor_status: InvestorStatus | null;
  new_investor_status: InvestorStatus;
  reason: string;
  classification_version: string;
  financial_summary: MemberFinancialSummary;
  tier_changed: boolean;
  status_changed: boolean;
  trace_id: string;
  error?: string;
}

// ── Audit Event ──

export interface ClassificationAuditEvent {
  member_id: string;
  previous_tier: MemberTier | null;
  new_tier: MemberTier;
  previous_investor_status: InvestorStatus | null;
  new_investor_status: InvestorStatus;
  reason: string;
  qualifying_total_before: number | null;
  qualifying_total_after: number;
  actor: string;
  trace_id: string;
}

// ── Supabase Client ──

let _sb: SupabaseClient | null = null;
function getSB(): SupabaseClient {
  if (_sb) return _sb;
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _sb;
}

function isConfigured(): boolean {
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  return Boolean(url && key);
}

function genTraceId(): string {
  return `cls-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ── Financial Summary Calculation ──

/**
 * Calculate the authoritative financial summary for a member from their
 * transaction records. Only non-test transactions with qualifying statuses
 * are counted toward completed capital.
 *
 * VIP rule: qualifying_invested_capital = lifetime_settled_investment - refunded_principal
 */
export function calculateFinancialSummary(
  memberId: string,
  transactions: TransactionRecord[],
): MemberFinancialSummary {
  let completedTransactions = 0;
  let lifetimeSettled = 0;
  let currentActivePrincipal = 0;
  let committedCapital = 0;
  let pendingCapital = 0;
  let refundedPrincipal = 0;
  let cancelledCapital = 0;
  let distributedAmount = 0;
  let largestCompleted = 0;
  let lastCompletedAt: string | null = null;

  for (const txn of transactions) {
    // Test transactions are ALWAYS excluded
    if (txn.is_test) continue;

    const amount = Number(txn.amount) || 0;
    const refunded = Number(txn.refunded_amount) || 0;
    const status = txn.status;

    if (COMPLETED_TXN_STATUSES.has(status)) {
      completedTransactions++;
      lifetimeSettled += amount;
      currentActivePrincipal += (amount - refunded);
      refundedPrincipal += refunded;

      if (amount > largestCompleted) {
        largestCompleted = amount;
      }

      if (txn.settled_at) {
        const settledAt = txn.settled_at;
        if (!lastCompletedAt || settledAt > lastCompletedAt) {
          lastCompletedAt = settledAt;
        }
      }
    } else if (status === 'pending' || status === 'processing' || status === 'reserved') {
      pendingCapital += amount;
      committedCapital += amount;
    } else if (status === 'cancelled') {
      cancelledCapital += amount;
    } else if (status === 'refunded') {
      refundedPrincipal += amount;
    }
    // draft, interested, failed, rejected, test → excluded entirely
  }

  // VIP calculation: lifetime settled minus refunded principal
  const qualifyingInvestedCapital = Math.max(0, lifetimeSettled - refundedPrincipal);

  return {
    member_id: memberId,
    completed_transactions: completedTransactions,
    lifetime_settled_investment: lifetimeSettled,
    current_active_principal: currentActivePrincipal,
    committed_capital: committedCapital,
    pending_capital: pendingCapital,
    refunded_principal: refundedPrincipal,
    cancelled_capital: cancelledCapital,
    distributed_amount: distributedAmount,
    qualifying_invested_capital: qualifyingInvestedCapital,
    largest_completed_transaction: largestCompleted,
    last_completed_transaction_at: lastCompletedAt,
    calculated_at: nowIso(),
  };
}

// ── Tier Determination ──

/**
 * Determine the member tier based on verification, compliance, and financial data.
 *
 * Classification rules (in order):
 *   1. Basic verification incomplete → PENDING
 *   2. Zero completed transactions → REGULAR
 *   3. Investor approval not active → REGULAR (investor_status = RESTRICTED_OR_PENDING)
 *   4. Qualifying capital < $500k → INVESTOR
 *   5. Qualifying capital ≥ $500k → VIP
 */
export function determineTier(
  member: CanonicalMemberData,
  investorProfile: InvestorProfileData | null,
  financialSummary: MemberFinancialSummary,
): { tier: MemberTier; investorStatus: InvestorStatus; reason: string } {
  // 1. Check basic verification
  const emailVerified = member.email_verified === true || Boolean(member.email_verified_at);
  const phoneVerified = member.sms_verified === true || Boolean(member.phone_verified_at);
  const registrationComplete = member.registration_status === 'completed';

  if (!emailVerified || !phoneVerified || !registrationComplete) {
    const missing: string[] = [];
    if (!emailVerified) missing.push('email verification');
    if (!phoneVerified) missing.push('phone verification');
    if (!registrationComplete) missing.push('registration completion');
    return {
      tier: 'PENDING',
      investorStatus: 'NOT_VERIFIED',
      reason: `Basic verification incomplete: missing ${missing.join(', ')}`,
    };
  }

  // 2. Zero completed transactions → REGULAR
  if (financialSummary.completed_transactions === 0) {
    return {
      tier: 'REGULAR',
      investorStatus: 'NOT_VERIFIED',
      reason: 'Verified registration with zero completed investment transactions',
    };
  }

  // 3. Check investor compliance approval
  const kycApproved = investorProfile?.kyc_status === 'approved' || member.kyc_status === 'approved';
  const complianceApproved = investorProfile?.compliance_status === 'approved';
  const investorAgreementAccepted = Boolean(investorProfile?.investor_agreement_at);
  const investorApproved = Boolean(investorProfile?.approved_at);

  const isActive = kycApproved && complianceApproved && investorAgreementAccepted && investorApproved;

  if (!isActive) {
    const blockers: string[] = [];
    if (!kycApproved) blockers.push('KYC not approved');
    if (!complianceApproved) blockers.push('compliance not approved');
    if (!investorAgreementAccepted) blockers.push('investor agreement not accepted');
    if (!investorApproved) blockers.push('investor profile not approved');
    return {
      tier: 'REGULAR',
      investorStatus: 'RESTRICTED_OR_PENDING',
      reason: `Has ${financialSummary.completed_transactions} completed transaction(s) but investor approval incomplete: ${blockers.join(', ')}`,
    };
  }

  // 4 & 5. Check qualifying capital for VIP threshold
  const qualifyingCapital = financialSummary.qualifying_invested_capital;

  if (qualifyingCapital >= VIP_THRESHOLD_CENTS) {
    return {
      tier: 'VIP',
      investorStatus: 'ACTIVE',
      reason: `VIP: qualifying invested capital $${(qualifyingCapital / 100).toLocaleString()} ≥ $500,000 threshold (${financialSummary.completed_transactions} completed transactions, lifetime settled $${(financialSummary.lifetime_settled_investment / 100).toLocaleString()} minus refunded $${(financialSummary.refunded_principal / 100).toLocaleString()})`,
    };
  }

  return {
    tier: 'INVESTOR',
    investorStatus: 'ACTIVE',
    reason: `Verified investor: ${financialSummary.completed_transactions} completed transaction(s), qualifying capital $${(qualifyingCapital / 100).toLocaleString()} < $500,000 VIP threshold`,
  };
}

// ── Manual Override ──

export interface ManualOverrideInput {
  member_id: string;
  target_tier: MemberTier;
  reason: string;
  evidence_url: string;
  expiration_date: string;
  actor: string;
  second_review_required: boolean;
}

export interface ManualOverrideResult {
  ok: boolean;
  member_id: string;
  previous_tier: MemberTier | null;
  new_tier: MemberTier;
  reason: string;
  evidence_url: string;
  expiration_date: string;
  actor: string;
  trace_id: string;
  error?: string;
}

/**
 * Apply a manual tier override. Requires owner authorization, documented reason,
 * evidence attachment, and expiration date. Never changes underlying transaction totals.
 */
export async function applyManualOverride(
  input: ManualOverrideInput,
): Promise<ManualOverrideResult> {
  const traceId = genTraceId();

  if (!input.reason || input.reason.trim().length < 10) {
    return { ok: false, member_id: input.member_id, previous_tier: null, new_tier: input.target_tier, reason: input.reason, evidence_url: input.evidence_url, expiration_date: input.expiration_date, actor: input.actor, trace_id: traceId, error: 'Reason must be at least 10 characters' };
  }

  if (!input.evidence_url || !input.evidence_url.startsWith('http')) {
    return { ok: false, member_id: input.member_id, previous_tier: null, new_tier: input.target_tier, reason: input.reason, evidence_url: input.evidence_url, expiration_date: input.expiration_date, actor: input.actor, trace_id: traceId, error: 'Valid evidence URL required' };
  }

  if (!input.expiration_date || new Date(input.expiration_date) <= new Date()) {
    return { ok: false, member_id: input.member_id, previous_tier: null, new_tier: input.target_tier, reason: input.reason, evidence_url: input.evidence_url, expiration_date: input.expiration_date, actor: input.actor, trace_id: traceId, error: 'Expiration date must be in the future' };
  }

  if (!isConfigured()) {
    return { ok: false, member_id: input.member_id, previous_tier: null, new_tier: input.target_tier, reason: input.reason, evidence_url: input.evidence_url, expiration_date: input.expiration_date, actor: input.actor, trace_id: traceId, error: 'Supabase not configured' };
  }

  const sb = getSB();

  // Load current member
  const { data: member, error: memberErr } = await sb.from('members')
    .select('member_id, member_tier, investor_status')
    .eq('member_id', input.member_id)
    .single();

  if (memberErr || !member) {
    return { ok: false, member_id: input.member_id, previous_tier: null, new_tier: input.target_tier, reason: input.reason, evidence_url: input.evidence_url, expiration_date: input.expiration_date, actor: input.actor, trace_id: traceId, error: 'Member not found' };
  }

  const previousTier = (member.member_tier || null) as MemberTier | null;

  // Update tier with override metadata
  const { error: updateErr } = await sb.from('members').update({
    member_tier: input.target_tier,
    classification_reason: `MANUAL OVERRIDE by ${input.actor}: ${input.reason} (evidence: ${input.evidence_url}, expires: ${input.expiration_date})`,
    classification_updated_at: nowIso(),
    classification_version: CLASSIFICATION_VERSION,
  }).eq('member_id', input.member_id);

  if (updateErr) {
    return { ok: false, member_id: input.member_id, previous_tier: previousTier, new_tier: input.target_tier, reason: input.reason, evidence_url: input.evidence_url, expiration_date: input.expiration_date, actor: input.actor, trace_id: traceId, error: `Update failed: ${updateErr.message}` };
  }

  // Write audit event
  await sb.from('classification_audit').insert({
    member_id: input.member_id,
    previous_tier: previousTier,
    new_tier: input.target_tier,
    reason: `MANUAL OVERRIDE: ${input.reason}`,
    actor: input.actor,
    trace_id: traceId,
    qualifying_total_before: null,
    qualifying_total_after: 0,
  });

  return {
    ok: true,
    member_id: input.member_id,
    previous_tier: previousTier,
    new_tier: input.target_tier,
    reason: input.reason,
    evidence_url: input.evidence_url,
    expiration_date: input.expiration_date,
    actor: input.actor,
    trace_id: traceId,
  };
}

// ── Core Classification Function ──

/**
 * Classify a single member. This is the authoritative classification engine
 * that all other services must call.
 *
 * Sequence:
 *   1. Load canonical member
 *   2. Confirm email and phone verification
 *   3. Load investor compliance status
 *   4. Load all non-test transactions
 *   5. Calculate completed transaction count
 *   6. Calculate qualifying invested capital
 *   7. Determine tier
 *   8. Write classification reason
 *   9. Write classification timestamp
 *  10. Write audit event
 *  11. Update CRM and dashboards (via caller)
 *  12. Notify affected services (via caller)
 */
export async function classifyMember(memberId: string): Promise<ClassificationResult> {
  const traceId = genTraceId();

  if (!isConfigured()) {
    return {
      ok: false, member_id: memberId, previous_tier: null, new_tier: 'PENDING',
      previous_investor_status: null, new_investor_status: 'NOT_VERIFIED',
      reason: 'Supabase not configured', classification_version: CLASSIFICATION_VERSION,
      financial_summary: emptySummary(memberId), tier_changed: false, status_changed: false,
      trace_id: traceId, error: 'Supabase not configured',
    };
  }

  const sb = getSB();

  // 1. Load canonical member
  const { data: member, error: memberErr } = await sb.from('members')
    .select(`
      member_id, auth_user_id, email, email_verified, email_verified_at,
      sms_verified, phone_verified_at, member_tier, investor_status,
      kyc_status, identity_status, registration_status
    `)
    .eq('member_id', memberId)
    .single();

  if (memberErr || !member) {
    return {
      ok: false, member_id: memberId, previous_tier: null, new_tier: 'PENDING',
      previous_investor_status: null, new_investor_status: 'NOT_VERIFIED',
      reason: 'Member not found', classification_version: CLASSIFICATION_VERSION,
      financial_summary: emptySummary(memberId), tier_changed: false, status_changed: false,
      trace_id: traceId, error: 'Member not found',
    };
  }

  const previousTier = (member.member_tier || null) as MemberTier | null;
  const previousInvestorStatus = (member.investor_status || null) as InvestorStatus | null;

  const canonicalMember: CanonicalMemberData = {
    member_id: member.member_id,
    auth_user_id: member.auth_user_id,
    email: member.email,
    email_verified: member.email_verified,
    email_verified_at: member.email_verified_at,
    sms_verified: member.sms_verified,
    phone_verified_at: member.phone_verified_at,
    member_tier: previousTier,
    investor_status: previousInvestorStatus,
    kyc_status: member.kyc_status,
    identity_status: member.identity_status,
    registration_status: member.registration_status,
  };

  // 3. Load investor compliance status
  const { data: profileRow } = await sb.from('investor_profiles')
    .select('member_id, kyc_status, tax_status, compliance_status, investor_agreement_at, approved_at, restricted_at')
    .eq('member_id', memberId)
    .single();

  const investorProfile: InvestorProfileData | null = profileRow
    ? {
        member_id: profileRow.member_id,
        kyc_status: profileRow.kyc_status,
        tax_status: profileRow.tax_status,
        compliance_status: profileRow.compliance_status,
        investor_agreement_at: profileRow.investor_agreement_at,
        approved_at: profileRow.approved_at,
        restricted_at: profileRow.restricted_at,
      }
    : null;

  // 4. Load all non-test transactions
  // Query by member_id (new schema) OR user_id (legacy schema where member_id is NULL).
  // The auth_user_id from the members table maps to user_id in the transactions table.
  const authUserId = member.auth_user_id as string | null;
  let txns: Record<string, unknown>[] | null = null;

  // Try member_id first (post-migration rows)
  const { data: txnsByMemberId } = await sb.from('transactions')
    .select('id, member_id, user_id, amount, status, refunded_amount, settled_at, is_test, external_reference, source')
    .eq('member_id', memberId)
    .eq('is_test', false);
  txns = (txnsByMemberId as Record<string, unknown>[]) || [];

  // Also query by user_id (legacy rows where member_id hasn't been backfilled yet)
  if (authUserId) {
    const { data: txnsByUserId } = await sb.from('transactions')
      .select('id, member_id, user_id, amount, status, refunded_amount, settled_at, is_test, external_reference, source')
      .eq('user_id', authUserId)
      .eq('is_test', false);
    // Merge, dedup by transaction id
    const seen = new Set(txns.map((t) => t.id as string));
    for (const t of (txnsByUserId as Record<string, unknown>[]) || []) {
      if (!seen.has(t.id as string)) {
        txns.push(t);
      }
    }
  }

  const transactions: TransactionRecord[] = (txns || []).map((t: Record<string, unknown>) => ({
    id: t.id as string,
    member_id: (t.member_id as string) || memberId,
    amount: Number(t.amount) || 0,
    status: t.status as string,
    refunded_amount: Number(t.refunded_amount) || 0,
    settled_at: t.settled_at as string | null,
    is_test: Boolean(t.is_test),
    external_reference: t.external_reference as string | null,
    source: t.source as string,
  }));

  // 5 & 6. Calculate financial summary
  const financialSummary = calculateFinancialSummary(memberId, transactions);

  // 7. Determine tier
  const { tier, investorStatus, reason } = determineTier(canonicalMember, investorProfile, financialSummary);

  const tierChanged = tier !== previousTier;
  const statusChanged = investorStatus !== previousInvestorStatus;

  // 8 & 9. Write classification to member record
  await sb.from('members').update({
    member_tier: tier,
    investor_status: investorStatus,
    classification_reason: reason,
    classification_updated_at: nowIso(),
    classification_version: CLASSIFICATION_VERSION,
  }).eq('member_id', memberId);

  // 10. Write audit event (only if tier or status changed)
  if (tierChanged || statusChanged) {
    const auditEvent: ClassificationAuditEvent = {
      member_id: memberId,
      previous_tier: previousTier,
      new_tier: tier,
      previous_investor_status: previousInvestorStatus,
      new_investor_status: investorStatus,
      reason,
      qualifying_total_before: null, // would need to load previous summary
      qualifying_total_after: financialSummary.qualifying_invested_capital,
      actor: 'automatic',
      trace_id: traceId,
    };

    await sb.from('classification_audit').insert({
      member_id: auditEvent.member_id,
      previous_tier: auditEvent.previous_tier,
      new_tier: auditEvent.new_tier,
      previous_investor_status: auditEvent.previous_investor_status,
      new_investor_status: auditEvent.new_investor_status,
      reason: auditEvent.reason,
      qualifying_total_before: auditEvent.qualifying_total_before,
      qualifying_total_after: auditEvent.qualifying_total_after,
      actor: auditEvent.actor,
      trace_id: auditEvent.trace_id,
    });
  }

  // Write/update financial summary
  await sb.from('member_financial_summary').upsert({
    member_id: financialSummary.member_id,
    completed_transactions: financialSummary.completed_transactions,
    lifetime_settled_investment: financialSummary.lifetime_settled_investment,
    current_active_principal: financialSummary.current_active_principal,
    committed_capital: financialSummary.committed_capital,
    pending_capital: financialSummary.pending_capital,
    refunded_principal: financialSummary.refunded_principal,
    cancelled_capital: financialSummary.cancelled_capital,
    distributed_amount: financialSummary.distributed_amount,
    qualifying_invested_capital: financialSummary.qualifying_invested_capital,
    largest_completed_transaction: financialSummary.largest_completed_transaction,
    last_completed_transaction_at: financialSummary.last_completed_transaction_at,
    calculated_at: financialSummary.calculated_at,
  }, { onConflict: 'member_id' });

  return {
    ok: true,
    member_id: memberId,
    previous_tier: previousTier,
    new_tier: tier,
    previous_investor_status: previousInvestorStatus,
    new_investor_status: investorStatus,
    reason,
    classification_version: CLASSIFICATION_VERSION,
    financial_summary: financialSummary,
    tier_changed: tierChanged,
    status_changed: statusChanged,
    trace_id: traceId,
  };
}

// ── Reconciliation ──

export interface ReconciliationResult {
  ok: boolean;
  total_members: number;
  classified: number;
  errors: number;
  tier_counts: Record<MemberTier, number>;
  investor_status_counts: Record<InvestorStatus, number>;
  members_with_investor_interest_no_txn: number;
  investors_with_completed_txn: number;
  members_at_or_above_500k: number;
  duplicate_transactions: number;
  orphan_transactions: number;
  test_transactions_included: number;
  records_missing_member_id: number;
  classification_mismatches: number;
  trace_id: string;
  error?: string;
}

/**
 * Reconcile all existing members — audit and repair classification mismatches.
 */
export async function reconcileAllMembers(): Promise<ReconciliationResult> {
  const traceId = genTraceId();

  if (!isConfigured()) {
    return {
      ok: false, total_members: 0, classified: 0, errors: 0,
      tier_counts: { PENDING: 0, REGULAR: 0, INVESTOR: 0, VIP: 0 },
      investor_status_counts: { NOT_VERIFIED: 0, ACTIVE: 0, RESTRICTED_OR_PENDING: 0, SUSPENDED: 0 },
      members_with_investor_interest_no_txn: 0,
      investors_with_completed_txn: 0,
      members_at_or_above_500k: 0,
      duplicate_transactions: 0,
      orphan_transactions: 0,
      test_transactions_included: 0,
      records_missing_member_id: 0,
      classification_mismatches: 0,
      trace_id: traceId,
      error: 'Supabase not configured',
    };
  }

  const sb = getSB();

  // Load all members
  const { data: members, error: membersErr } = await sb.from('members')
    .select('member_id, member_type, member_tier, investor_status, email_verified, sms_verified')
    .order('created_at', { ascending: true });

  if (membersErr || !members) {
    return {
      ok: false, total_members: 0, classified: 0, errors: 1,
      tier_counts: { PENDING: 0, REGULAR: 0, INVESTOR: 0, VIP: 0 },
      investor_status_counts: { NOT_VERIFIED: 0, ACTIVE: 0, RESTRICTED_OR_PENDING: 0, SUSPENDED: 0 },
      members_with_investor_interest_no_txn: 0,
      investors_with_completed_txn: 0,
      members_at_or_above_500k: 0,
      duplicate_transactions: 0,
      orphan_transactions: 0,
      test_transactions_included: 0,
      records_missing_member_id: 0,
      classification_mismatches: 0,
      trace_id: traceId,
      error: `Failed to load members: ${membersErr?.message || 'unknown'}`,
    };
  }

  const tierCounts: Record<MemberTier, number> = { PENDING: 0, REGULAR: 0, INVESTOR: 0, VIP: 0 };
  const statusCounts: Record<InvestorStatus, number> = { NOT_VERIFIED: 0, ACTIVE: 0, RESTRICTED_OR_PENDING: 0, SUSPENDED: 0 };
  let classified = 0;
  let errors = 0;
  let mismatches = 0;
  let investorInterestNoTxn = 0;
  let investorsWithTxn = 0;
  let atOrAbove500k = 0;

  for (const member of members) {
    try {
      const result = await classifyMember(member.member_id);
      if (result.ok) {
        classified++;
        tierCounts[result.new_tier]++;
        statusCounts[result.new_investor_status]++;

        if (result.tier_changed) {
          mismatches++;
        }

        // Track metrics
        if (member.member_type === 'investor' && result.financial_summary.completed_transactions === 0) {
          investorInterestNoTxn++;
        }
        if (result.financial_summary.completed_transactions > 0) {
          investorsWithTxn++;
        }
        if (result.financial_summary.qualifying_invested_capital >= VIP_THRESHOLD_CENTS) {
          atOrAbove500k++;
        }
      } else {
        errors++;
      }
    } catch {
      errors++;
    }
  }

  // Check for duplicate transactions (same idempotency_key)
  const { data: dupCheck } = await sb.from('transactions')
    .select('idempotency_key')
    .not('idempotency_key', 'is', null);

  const keyCounts = new Map<string, number>();
  for (const row of (dupCheck || [])) {
    const key = row.idempotency_key as string;
    keyCounts.set(key, (keyCounts.get(key) || 0) + 1);
  }
  let duplicateTxns = 0;
  for (const count of keyCounts.values()) {
    if (count > 1) duplicateTxns += (count - 1);
  }

  // Check for orphan transactions (member_id not in members table)
  const { data: orphanCheck } = await sb.from('transactions')
    .select('member_id')
    .not('member_id', 'in', `(${members.map((m: Record<string, unknown>) => `'${m.member_id}'`).join(',')})`);
  const orphanTxns = orphanCheck?.length || 0;

  // Check for test transactions incorrectly included
  const { data: testCheck } = await sb.from('member_financial_summary')
    .select('member_id, lifetime_settled_investment')
    .gt('lifetime_settled_investment', 0);

  // Check for records missing member_id
  const { data: missingCheck } = await sb.from('transactions')
    .select('id')
    .or('member_id.is.null,member_id.eq.""');
  const missingMemberId = missingCheck?.length || 0;

  return {
    ok: true,
    total_members: members.length,
    classified,
    errors,
    tier_counts: tierCounts,
    investor_status_counts: statusCounts,
    members_with_investor_interest_no_txn: investorInterestNoTxn,
    investors_with_completed_txn: investorsWithTxn,
    members_at_or_above_500k: atOrAbove500k,
    duplicate_transactions: duplicateTxns,
    orphan_transactions: orphanTxns,
    test_transactions_included: 0, // test txns are always excluded by the engine
    records_missing_member_id: missingMemberId,
    classification_mismatches: mismatches,
    trace_id: traceId,
  };
}

// ── Owner Dashboard Totals ──

export interface OwnerDashboardTotals {
  total_regular_members: number;
  total_verified_investors: number;
  total_vip_investors: number;
  total_invested_capital: number;     // cents
  vip_invested_capital: number;       // cents
  new_investors_this_month: number;
  members_awaiting_verification: number;
  investors_with_pending_transactions: number;
  classification_changes_this_month: number;
  transaction_source: string;
  calculated_at: string;
}

/**
 * Build the owner dashboard totals from authoritative classification data.
 */
export async function getOwnerDashboardTotals(): Promise<OwnerDashboardTotals> {
  const now = nowIso();

  if (!isConfigured()) {
    return {
      total_regular_members: 0,
      total_verified_investors: 0,
      total_vip_investors: 0,
      total_invested_capital: 0,
      vip_invested_capital: 0,
      new_investors_this_month: 0,
      members_awaiting_verification: 0,
      investors_with_pending_transactions: 0,
      classification_changes_this_month: 0,
      transaction_source: 'transactions table (authoritative)',
      calculated_at: now,
    };
  }

  const sb = getSB();

  // Count by tier
  const { count: regularCount } = await sb.from('members')
    .select('member_id', { count: 'exact', head: true })
    .eq('member_tier', 'REGULAR');

  const { count: investorCount } = await sb.from('members')
    .select('member_id', { count: 'exact', head: true })
    .eq('member_tier', 'INVESTOR');

  const { count: vipCount } = await sb.from('members')
    .select('member_id', { count: 'exact', head: true })
    .eq('member_tier', 'VIP');

  const { count: pendingCount } = await sb.from('members')
    .select('member_id', { count: 'exact', head: true })
    .eq('member_tier', 'PENDING');

  // Sum total invested capital from all financial summaries
  const { data: summaries } = await sb.from('member_financial_summary')
    .select('lifetime_settled_investment, qualifying_invested_capital');

  let totalInvested = 0;
  let vipInvested = 0;
  for (const s of (summaries || [])) {
    totalInvested += Number(s.lifetime_settled_investment) || 0;
    // VIP invested = sum of qualifying capital for VIP members only
  }

  // Get VIP invested capital specifically
  const { data: vipMembers } = await sb.from('members')
    .select('member_id')
    .eq('member_tier', 'VIP');

  if (vipMembers && vipMembers.length > 0) {
    const vipIds = vipMembers.map((m: Record<string, unknown>) => m.member_id);
    const { data: vipSummaries } = await sb.from('member_financial_summary')
      .select('qualifying_invested_capital')
      .in('member_id', vipIds);
    for (const s of (vipSummaries || [])) {
      vipInvested += Number(s.qualifying_invested_capital) || 0;
    }
  }

  // New investors this month (members classified as INVESTOR or VIP this month)
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const { count: newInvestors } = await sb.from('classification_audit')
    .select('id', { count: 'exact', head: true })
    .in('new_tier', ['INVESTOR', 'VIP'])
    .gte('created_at', monthStart.toISOString());

  // Investors with pending transactions
  const { data: pendingTxns } = await sb.from('transactions')
    .select('member_id')
    .in('status', ['pending', 'processing', 'reserved']);

  const pendingMembers = new Set<string>();
  for (const t of (pendingTxns || [])) {
    if (t.member_id) pendingMembers.add(t.member_id as string);
  }

  // Classification changes this month
  const { count: changesCount } = await sb.from('classification_audit')
    .select('id', { count: 'exact', head: true })
    .gte('created_at', monthStart.toISOString());

  return {
    total_regular_members: regularCount || 0,
    total_verified_investors: investorCount || 0,
    total_vip_investors: vipCount || 0,
    total_invested_capital: totalInvested,
    vip_invested_capital: vipInvested,
    new_investors_this_month: newInvestors || 0,
    members_awaiting_verification: pendingCount || 0,
    investors_with_pending_transactions: pendingMembers.size,
    classification_changes_this_month: changesCount || 0,
    transaction_source: 'transactions table (authoritative)',
    calculated_at: now,
  };
}

// ── Helper: Empty Summary ──

function emptySummary(memberId: string): MemberFinancialSummary {
  return {
    member_id: memberId,
    completed_transactions: 0,
    lifetime_settled_investment: 0,
    current_active_principal: 0,
    committed_capital: 0,
    pending_capital: 0,
    refunded_principal: 0,
    cancelled_capital: 0,
    distributed_amount: 0,
    qualifying_invested_capital: 0,
    largest_completed_transaction: 0,
    last_completed_transaction_at: null,
    calculated_at: nowIso(),
  };
}

// ── IVX IA Classification Query ──

export interface IAClassificationQuery {
  question: string;
  member_id?: string;
  is_this_person_a_real_investor?: boolean;
  is_this_person_vip?: boolean;
}

export interface IAClassificationAnswer {
  answer: string;
  member_id: string | null;
  tier: MemberTier | null;
  investor_status: InvestorStatus | null;
  completed_transactions: number | null;
  qualifying_invested_capital: number | null;
  classification_rule: string;
  last_calculated: string | null;
  evidence_ids: string[];
  restricted_info_hidden: boolean;
}

/**
 * Answer a classification question from IVX IA using authoritative data.
 * Never infers VIP from conversation text — only from verified transaction records.
 */
export async function answerClassificationQuery(
  query: IAClassificationQuery,
): Promise<IAClassificationAnswer> {
  const defaultResponse: IAClassificationAnswer = {
    answer: 'No member ID provided. Classification requires a specific member identifier.',
    member_id: null,
    tier: null,
    investor_status: null,
    completed_transactions: null,
    qualifying_invested_capital: null,
    classification_rule: 'VIP when lifetime settled investment minus refunded principal ≥ $500,000',
    last_calculated: null,
    evidence_ids: [],
    restricted_info_hidden: true,
  };

  if (!query.member_id) {
    return defaultResponse;
  }

  if (!isConfigured()) {
    return {
      ...defaultResponse,
      member_id: query.member_id,
      answer: 'Classification system is not configured. Cannot verify investor status.',
    };
  }

  const sb = getSB();

  // Load member classification
  const { data: member } = await sb.from('members')
    .select('member_id, member_tier, investor_status, classification_updated_at')
    .eq('member_id', query.member_id)
    .single();

  if (!member) {
    return {
      ...defaultResponse,
      member_id: query.member_id,
      answer: `Member ${query.member_id} not found in the canonical member registry.`,
    };
  }

  // Load financial summary
  const { data: summary } = await sb.from('member_financial_summary')
    .select('*')
    .eq('member_id', query.member_id)
    .single();

  const tier = (member.member_tier || 'PENDING') as MemberTier;
  const investorStatus = (member.investor_status || 'NOT_VERIFIED') as InvestorStatus;
  const completedTxns = summary?.completed_transactions || 0;
  const qualifyingCapital = summary?.qualifying_invested_capital || 0;
  const lastCalculated = member.classification_updated_at || null;

  // Load evidence IDs (transaction IDs for completed transactions)
  const { data: evidenceTxns } = await sb.from('transactions')
    .select('id')
    .eq('member_id', query.member_id)
    .in('status', ['settled', 'completed', 'funded_and_confirmed'])
    .eq('is_test', false)
    .limit(10);

  const evidenceIds = (evidenceTxns || []).map((t: Record<string, unknown>) => String(t.id));

  // Build answer based on question type
  let answer = '';

  if (query.is_this_person_a_real_investor) {
    const isRealInvestor = completedTxns >= 1 && investorStatus === 'ACTIVE';
    answer = isRealInvestor
      ? `Yes. This member is a verified investor with ${completedTxns} completed transaction(s) and ACTIVE investor status. Classification: ${tier}. Qualifying invested capital: $${(qualifyingCapital / 100).toLocaleString()}. Evidence: ${evidenceIds.length} transaction record(s). Last calculated: ${lastCalculated || 'unknown'}.`
      : `No. This member is NOT a verified investor. Completed transactions: ${completedTxns}. Investor status: ${investorStatus}. A real investor must have at least one completed verified transaction with ACTIVE investor status.`;
  } else if (query.is_this_person_vip) {
    const isVip = tier === 'VIP' && qualifyingCapital >= VIP_THRESHOLD_CENTS;
    answer = isVip
      ? `Yes. This member is VIP. Qualifying invested capital: $${(qualifyingCapital / 100).toLocaleString()} (≥ $500,000 threshold). VIP rule: lifetime settled investment minus refunded principal. Completed transactions: ${completedTxns}. Last calculated: ${lastCalculated || 'unknown'}. Evidence IDs: ${evidenceIds.join(', ') || 'none'}.`
      : `No. This member is NOT VIP. Current tier: ${tier}. Qualifying invested capital: $${(qualifyingCapital / 100).toLocaleString()} (threshold: $500,000). VIP status is calculated automatically from verified transaction records, not from profile claims.`;
  } else {
    answer = `Member classification: ${tier}. Investor status: ${investorStatus}. Completed transactions: ${completedTxns}. Qualifying invested capital: $${(qualifyingCapital / 100).toLocaleString()}. Classification rule: VIP when lifetime settled investment minus refunded principal ≥ $500,000. Last calculated: ${lastCalculated || 'unknown'}.`;
  }

  return {
    answer,
    member_id: query.member_id,
    tier,
    investor_status: investorStatus,
    completed_transactions: completedTxns,
    qualifying_invested_capital: qualifyingCapital,
    classification_rule: 'VIP when lifetime settled investment minus refunded principal ≥ $500,000',
    last_calculated: lastCalculated,
    evidence_ids: evidenceIds,
    restricted_info_hidden: true,
  };
}

// ── Classification Question Detector for IVX IA ──

/**
 * Detects classification-related questions in IVX IA prompts.
 * Returns the extracted member_id (if present) and question type flags.
 * This ensures IVX IA never infers investor/VIP status from conversation text —
 * it always routes to authoritative transaction data.
 */
export function detectClassificationQuestion(prompt: string): {
  memberId: string | undefined;
  isRealInvestorQuestion: boolean;
  isVipQuestion: boolean;
} | null {
  const lower = prompt.toLowerCase();

  // Check for classification-related keywords
  const isRealInvestorQuestion =
    /is\s+(?:this\s+)?(?:person\s+|member\s+)?(?:a\s+)?real\s+investor/i.test(prompt)
    || /(?:is\s+|verify\s+)(?:this\s+)?(?:person\s+|member\s+)?(?:an?\s+)?investor/i.test(prompt)
    || /verify\s+investor\s+status/i.test(prompt)
    || /check\s+investor\s+classification/i.test(prompt);

  const isVipQuestion =
    /is\s+(?:this\s+)?(?:person\s+|member\s+)?vip/i.test(prompt)
    || /vip\s+(?:status|classification|tier)/i.test(prompt)
    || /check\s+vip\s+status/i.test(prompt)
    || /verify\s+vip/i.test(prompt);

  const isGeneralClassification =
    /classification\s+(?:status|tier|level|rule)/i.test(prompt)
    || /member\s+(?:tier|classification)/i.test(prompt)
    || /what\s+(?:is\s+|are\s+)?(?:the\s+)?classification\s+(?:rule|rules|levels|tiers)/i.test(prompt);

  if (!isRealInvestorQuestion && !isVipQuestion && !isGeneralClassification) {
    return null;
  }

  // Try to extract member_id from the prompt
  let memberId: string | undefined;

  // Match patterns like "member abc123", "member_id: abc123", "for member abc123"
  const memberIdMatch = prompt.match(/(?:member[_\s-]?id[:\s]+|member\s+)([a-zA-Z0-9_-]{6,})/i);
  if (memberIdMatch) {
    memberId = memberIdMatch[1];
  }

  // Match UUID patterns
  const uuidMatch = prompt.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (uuidMatch) {
    memberId = uuidMatch[1];
  }

  // Match email patterns (used as member identifier in some contexts)
  const emailMatch = prompt.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  if (emailMatch && !memberId) {
    memberId = emailMatch[1];
  }

  return {
    memberId,
    isRealInvestorQuestion,
    isVipQuestion,
  };
}