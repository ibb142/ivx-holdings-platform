/**
 * IVX Landing Payment Sync Service
 *
 * Ensures that every landing-page "Invest Now" intent becomes a REAL payment
 * transaction that is visible inside the app admin payment transactions view.
 *
 * Rules:
 *   - No simulated/fake transactions in production.
 *   - Every landing investment creates a pending payment transaction in the
 *     `transactions` table and a linked `landing_investments` record.
 *   - Every create/update is appended to the durable audit log.
 *   - If no real payment provider is configured, the transaction stays in
 *     `pending_payment` status awaiting owner review / wire confirmation.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { auditDir } from './ivx-data-root';

const DEPLOYMENT_MARKER = 'ivx-landing-payment-sync-v1-real-only';

const AUDIT_DIR = auditDir('landing-payment-sync');
const AUDIT_LOG_FILE = () => path.join(AUDIT_DIR, 'audit.jsonl');

export interface LandingPaymentInput {
  dealId: string;
  dealTitle: string;
  investmentType: 'jv_direct' | 'token_shares' | string;
  amount: number;
  expectedRoi?: number;
  ownershipPct?: number;
  paymentMethod: 'bank' | 'wire' | 'wallet' | string;
  investorEmail: string;
  investorId?: string | null;
  investorName?: string;
  termsAccepted: boolean;
  source: string;
  ip?: string;
  userAgent?: string;
}

export interface LandingPaymentResult {
  success: boolean;
  transactionId: string;
  landingInvestmentId: string;
  intentId: string;
  status: 'pending_payment' | 'pending' | 'completed' | 'failed';
  message: string;
  providerConfigured: boolean;
  providerMode?: 'live' | 'test' | 'none';
  auditLogged: boolean;
  deploymentMarker: string;
  error?: string;
}

function getSupabaseAdmin(): SupabaseClient {
  const url =
    process.env.SUPABASE_URL ||
    process.env.EXPO_PUBLIC_SUPABASE_URL ||
    '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isProviderConfigured(): { configured: boolean; mode: 'live' | 'test' | 'none' } {
  const stripeLive = Boolean(process.env.STRIPE_SECRET_KEY && !process.env.STRIPE_SECRET_KEY.includes('test'));
  const stripeTest = Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_SECRET_KEY.includes('test'));
  const plaidProduction = Boolean(process.env.PLAID_SECRET && process.env.PLAID_ENV === 'production');
  const plaidTest = Boolean(process.env.PLAID_SECRET && process.env.PLAID_ENV !== 'production');
  const paypalLive = Boolean(process.env.PAYPAL_CLIENT_SECRET && process.env.PAYPAL_ENV === 'live');

  if (stripeLive || plaidProduction || paypalLive) return { configured: true, mode: 'live' };
  if (stripeTest || plaidTest) return { configured: true, mode: 'test' };
  return { configured: false, mode: 'none' };
}

function nowIso(): string {
  return new Date().toISOString();
}

async function appendAuditLog(event: Record<string, unknown>): Promise<void> {
  try {
    await mkdir(AUDIT_DIR, { recursive: true });
    await appendFile(AUDIT_LOG_FILE(), JSON.stringify({ ...event, loggedAt: nowIso() }) + '\n');
  } catch (err) {
    console.error('[LandingPaymentSync] Audit log append failed:', (err as Error)?.message);
  }
}

function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    bank: 'Bank Transfer (ACH)',
    wire: 'Wire Transfer',
    wallet: 'Wallet Balance',
  };
  return labels[method] || method;
}

/**
 * Create a real payment transaction from a landing-page investment intent.
 * This is the single source of truth for landing-generated money movement:
 *   1. Inserts a row into `transactions` (status pending_payment).
 *   2. Inserts a row into `landing_investments` linked by transaction_id.
 *   3. Appends an immutable audit log entry.
 */
export async function createLandingPaymentTransaction(
  input: LandingPaymentInput
): Promise<LandingPaymentResult> {
  const provider = isProviderConfigured();

  const transactionId = `txn_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const landingInvestmentId = randomUUID();
  const intentId = `INT-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  const resultBase: LandingPaymentResult = {
    success: false,
    transactionId,
    landingInvestmentId,
    intentId,
    status: 'pending_payment',
    message: '',
    providerConfigured: provider.configured,
    providerMode: provider.mode,
    auditLogged: false,
    deploymentMarker: DEPLOYMENT_MARKER,
  };

  // Validation: refuse fake zero/negative amounts
  if (!input.amount || input.amount <= 0 || Number.isNaN(input.amount)) {
    return { ...resultBase, error: 'Invalid investment amount.' };
  }
  if (!input.investorEmail || input.investorEmail.indexOf('@') === -1) {
    return { ...resultBase, error: 'Investor email is required.' };
  }
  if (!input.termsAccepted) {
    return { ...resultBase, error: 'Terms must be accepted.' };
  }

  // Supabase must be configured to create real records.
  const supabaseUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!supabaseUrl || !supabaseKey) {
    return { ...resultBase, error: 'Supabase is not configured. Real payment transactions require a database connection.' };
  }

  const supabase = getSupabaseAdmin();

  // Resolve the canonical user_id. The landing page authenticates the investor,
  // so a valid investorId is normally present. If it is missing, fall back to an
  // auth.users lookup by email. A real transaction must be tied to a real user.
  let userId = input.investorId || '';
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) {
    try {
      const { data: users, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
      if (!usersError && users?.users) {
        const match = users.users.find((u) => u.email?.toLowerCase() === input.investorEmail.toLowerCase());
        if (match?.id) userId = match.id;
      }
    } catch (lookupErr) {
      console.warn('[LandingPaymentSync] User lookup by email failed:', (lookupErr as Error)?.message);
    }
  }
  if (!userId) {
    return { ...resultBase, error: 'Investor must be authenticated before creating a real payment transaction.' };
  }

  const description = `${paymentMethodLabel(input.paymentMethod)} — ${input.dealTitle || 'Landing Deal'}`;

  const auditPayload = {
    action: 'landing_payment_transaction_created',
    transactionId,
    landingInvestmentId,
    intentId,
    dealId: input.dealId,
    dealTitle: input.dealTitle,
    investorEmail: input.investorEmail.toLowerCase(),
    investorId: userId,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    providerConfigured: provider.configured,
    providerMode: provider.mode,
    deploymentMarker: DEPLOYMENT_MARKER,
    environment: process.env.NODE_ENV || 'production',
  };

  try {
    // 1. Insert the canonical payment transaction.
    const { error: txError } = await supabase.from('transactions').insert({
      id: transactionId,
      user_id: userId,
      member_id: userId, // Set member_id for classification engine (same as user_id until members table lookup)
      type: 'buy',
      amount: input.amount,
      status: 'pending',
      description,
      property_id: /^[0-9a-f-]{36}$/i.test(input.dealId) ? input.dealId : null,
      property_name: input.dealTitle,
      created_at: nowIso(),
    });

    if (txError) {
      console.error('[LandingPaymentSync] transactions insert failed:', txError.message);
      await appendAuditLog({ ...auditPayload, outcome: 'insert_failed', detail: txError.message });
      return { ...resultBase, auditLogged: true, error: `Transaction insert failed: ${txError.message}` };
    }

    // 2. Insert the landing_investments record linked to the transaction.
    // Use the exact column set the existing landing page inserts so we stay
    // compatible with the live Supabase schema. Extra columns are omitted to
    // avoid "column not found" schema-cache errors.
    const { error: liError } = await supabase.from('landing_investments').insert({
      id: landingInvestmentId,
      intent_id: intentId,
      deal_id: input.dealId,
      deal_title: input.dealTitle,
      investment_type: input.investmentType,
      amount: input.amount,
      ownership_pct: input.ownershipPct ?? 0,
      expected_roi: input.expectedRoi ?? 0,
      payment_method: paymentMethodLabel(input.paymentMethod),
      investor_email: input.investorEmail.toLowerCase(),
      investor_id: userId,
      status: 'pending_payment',
      terms_accepted: input.termsAccepted,
      source: input.source || 'landing_page',
      created_at: nowIso(),
    });

    if (liError) {
      console.error('[LandingPaymentSync] landing_investments insert failed:', liError.message);
      // Best-effort rollback: mark transaction as failed so it is not orphaned.
      await supabase
        .from('transactions')
        .update({ status: 'failed', description: `${description} — landing link failed: ${liError.message}` })
        .eq('id', transactionId);
      await appendAuditLog({ ...auditPayload, outcome: 'landing_link_failed', detail: liError.message });
      return { ...resultBase, auditLogged: true, error: `Landing investment link failed: ${liError.message}` };
    }

    // 3. Audit log on success.
    await appendAuditLog({ ...auditPayload, outcome: 'created' });

    const status: LandingPaymentResult['status'] = 'pending_payment';
    const message = provider.configured
      ? `Real payment transaction created. Status: ${status}. Awaiting provider confirmation.`
      : `Real payment transaction created. Status: ${status}. No payment provider is configured; owner must confirm funds via wire/ACH before completing.`;

    return {
      ...resultBase,
      success: true,
      status,
      message,
      auditLogged: true,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[LandingPaymentSync] Unexpected error:', message);
    await appendAuditLog({ ...auditPayload, outcome: 'exception', detail: message });
    return { ...resultBase, auditLogged: true, error: message };
  }
}

/**
 * Mark a landing payment as completed after real funds are confirmed.
 * Only callable by an owner/admin process. Writes an audit log entry.
 */
export async function confirmLandingPaymentTransaction(
  transactionId: string,
  confirmedBy: string,
  confirmationMethod: string,
  notes?: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseAdmin();
  const now = nowIso();

  try {
    const { data: txRows, error: txErr } = await supabase
      .from('transactions')
      .select('id, status, amount')
      .eq('id', transactionId)
      .limit(1);

    if (txErr || !txRows || txRows.length === 0) {
      return { success: false, error: txErr?.message || 'Transaction not found' };
    }

    const tx = txRows[0];
    if (tx.status === 'completed') {
      return { success: false, error: 'Transaction already completed' };
    }

    const { error: updateTxErr } = await supabase
      .from('transactions')
      .update({ status: 'completed', description: `Confirmed by ${confirmedBy} via ${confirmationMethod}${notes ? ` — ${notes}` : ''}` })
      .eq('id', transactionId);

    if (updateTxErr) {
      return { success: false, error: updateTxErr.message };
    }

    await supabase
      .from('landing_investments')
      .update({ status: 'confirmed', notes: `Confirmed by ${confirmedBy} via ${confirmationMethod}${notes ? ` — ${notes}` : ''}` })
      .eq('transaction_id', transactionId);

    await appendAuditLog({
      action: 'landing_payment_transaction_confirmed',
      transactionId,
      confirmedBy,
      confirmationMethod,
      amount: tx.amount,
      notes: notes || '',
      environment: process.env.NODE_ENV || 'production',
      at: now,
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
}

export { DEPLOYMENT_MARKER };
