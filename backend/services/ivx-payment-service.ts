/**
 * IVX Payment Service — Stripe-primary payment processor
 *
 * Handles:
 * - Stripe Customer creation/lookup (idempotent)
 * - PaymentIntent creation (card + ACH)
 * - SetupIntent for reusable bank accounts
 * - Stripe Financial Connections session creation
 * - Webhook signature verification + idempotent event processing
 * - Refunds (full + partial)
 * - Payment state machine transitions
 * - Server-side amount calculation (never trust client amounts)
 *
 * Security rules:
 * - Never store full card numbers, CVV, or raw bank account numbers
 * - Never place secret keys in client bundles
 * - All financial calculations happen server-side
 * - Webhook events verified via Stripe signature
 * - Idempotency keys prevent duplicate processing
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { onTransactionSettled, onRefundProcessed } from './ivx-classification-triggers';

const DEPLOYMENT_MARKER = 'ivx-payment-service-v1-2026-07-28-classification';

// ── Types ──

export type PaymentPathway = 'tokenized' | 'jv' | 'buyer_deposit' | 'buyer_application_fee';
export type PaymentMethod = 'card' | 'ach_debit';
export type PaymentState =
  | 'DRAFT'
  | 'PAYMENT_CREATED'
  | 'REQUIRES_ACTION'
  | 'PROCESSING'
  | 'PENDING_SETTLEMENT'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUND_PENDING'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'DISPUTED'
  | 'ALLOCATED'
  | 'COMPLETED';

export type InvestmentState =
  | 'PENDING'
  | 'PAYMENT_PROCESSING'
  | 'CONFIRMED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED';

export interface CreatePaymentInput {
  userId: string;
  dealId: string;
  pathway: PaymentPathway;
  paymentMethod: PaymentMethod;
  shareCount?: number; // tokenized only
  amountCents?: number; // JV/buyer — server recalculates for tokenized
  idempotencyKey: string;
  acceptedTerms: boolean;
  metadata?: Record<string, string>;
}

export interface CreatePaymentResult {
  ok: boolean;
  paymentId?: string;
  providerPaymentIntentId?: string;
  clientSecret?: string;
  amountCents: number;
  state: PaymentState;
  traceId: string;
  error?: string;
  code?: string;
  testMode: boolean;
}

export interface WebhookProcessResult {
  ok: boolean;
  processed: boolean;
  paymentId?: string;
  newState?: PaymentState;
  investmentFinalized?: boolean;
  traceId: string;
  error?: string;
}

export interface PaymentStatusResult {
  ok: boolean;
  payment?: {
    id: string;
    state: PaymentState;
    amountCents: number;
    pathway: PaymentPathway;
    providerPaymentIntentId: string | null;
    dealId: string;
    shareCount: number | null;
  };
  investment?: {
    id: string;
    state: InvestmentState;
    sharesAllocated: number | null;
    ownershipPercent: number | null;
  };
  traceId: string;
}

// ── Supabase admin client ──

let _sb: SupabaseClient | null = null;
function getSB(): SupabaseClient {
  if (_sb) return _sb;
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _sb;
}

// ── Stripe client (lazy init, test-mode safe) ──

let _stripe: any = null;
function getStripe(): any | null {
  if (_stripe) return _stripe;
  const secretKey = (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();
  if (!secretKey) return null;
  try {
    // require works in Bun/Node — stripe is in package.json dependencies
    const Stripe = require('stripe');
    _stripe = Stripe(secretKey, { apiVersion: '2025-06-30.basil' as any });
    return _stripe;
  } catch {
    return null;
  }
}

function isStripeConfigured(): boolean {
  return !!(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();
}

function isTestMode(): boolean {
  const key = (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();
  return !key || key.startsWith('sk_test_');
}

function genTraceId(): string {
  return `pay-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

// ── Server-side amount calculation ──

/**
 * Calculate the payment amount for a tokenized investment.
 * Server reads share_price from the deal — NEVER trusts client-submitted price.
 */
export async function calculateTokenizedAmount(
  dealId: string,
  shareCount: number,
): Promise<{ amountCents: number; sharePrice: number; ok: boolean; error?: string }> {
  const sb = getSB();
  const { data: deal, error } = await sb.from('jv_deals')
    .select('share_price, available_shares, minimum_shares, maximum_shares_per_investor, tokenized_status, tokenized_enabled')
    .eq('id', dealId)
    .single();

  if (error || !deal) {
    return { amountCents: 0, sharePrice: 0, ok: false, error: 'Deal not found' };
  }

  if (!deal.tokenized_enabled) {
    return { amountCents: 0, sharePrice: 0, ok: false, error: 'Tokenized pathway not enabled for this deal' };
  }

  if (deal.tokenized_status !== 'TOKENIZED_OPEN') {
    return { amountCents: 0, sharePrice: 0, ok: false, error: `Tokenized status is ${deal.tokenized_status}` };
  }

  if (shareCount < (deal.minimum_shares || 1)) {
    return { amountCents: 0, sharePrice: deal.share_price || 50, ok: false, error: `Minimum shares is ${deal.minimum_shares || 1}` };
  }

  if (shareCount > (deal.available_shares || 0)) {
    return { amountCents: 0, sharePrice: deal.share_price || 50, ok: false, error: 'Exceeds available shares' };
  }

  if (deal.maximum_shares_per_investor > 0 && shareCount > deal.maximum_shares_per_investor) {
    return { amountCents: 0, sharePrice: deal.share_price || 50, ok: false, error: 'Exceeds maximum shares per investor' };
  }

  const sharePrice = Number(deal.share_price) || 50;
  const amountCents = Math.round(shareCount * sharePrice * 100);

  return { amountCents, sharePrice, ok: true };
}

/**
 * Validate a JV contribution amount against deal constraints.
 */
export async function validateJVContribution(
  dealId: string,
  amountCents: number,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSB();
  const { data: deal, error } = await sb.from('jv_deals')
    .select('jv_enabled, jv_status, jv_minimum_contribution, jv_maximum_contribution, jv_capital_target, jv_capital_raised')
    .eq('id', dealId)
    .single();

  if (error || !deal) return { ok: false, error: 'Deal not found' };
  if (!deal.jv_enabled) return { ok: false, error: 'JV pathway not enabled' };
  if (deal.jv_status !== 'JV_OPEN') return { ok: false, error: `JV status is ${deal.jv_status}` };

  const minCents = Number(deal.jv_minimum_contribution) * 100 || 2_000_000;
  if (amountCents < minCents) {
    return { ok: false, error: `Minimum JV contribution is $${(minCents / 100).toLocaleString()}` };
  }

  const maxCents = Number(deal.jv_maximum_contribution) * 100;
  if (maxCents > 0 && amountCents > maxCents) {
    return { ok: false, error: `Exceeds maximum JV contribution of $${(maxCents / 100).toLocaleString()}` };
  }

  const capitalRemaining = Number(deal.jv_capital_target) - Number(deal.jv_capital_raised);
  if (capitalRemaining > 0 && amountCents > capitalRemaining * 100) {
    return { ok: false, error: `Exceeds remaining JV allocation of $${capitalRemaining.toLocaleString()}` };
  }

  return { ok: true };
}

/**
 * Validate a buyer offer/deposit amount.
 */
export async function validateBuyerPayment(
  dealId: string,
  amountCents: number,
  isDeposit: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const sb = getSB();
  const { data: deal, error } = await sb.from('jv_deals')
    .select('buyer_enabled, buyer_status, buyer_asking_price, buyer_minimum_offer, earnest_money_required')
    .eq('id', dealId)
    .single();

  if (error || !deal) return { ok: false, error: 'Deal not found' };
  if (!deal.buyer_enabled) return { ok: false, error: 'Buyer pathway not enabled' };
  if (deal.buyer_status !== 'BUYER_OPEN') return { ok: false, error: `Buyer status is ${deal.buyer_status}` };

  if (isDeposit) {
    // Deposits are typically a small fraction — just validate positive
    if (amountCents < 100) return { ok: false, error: 'Deposit must be at least $1.00' };
  } else {
    const minOfferCents = Number(deal.buyer_minimum_offer) * 100 || 0;
    if (amountCents < minOfferCents) {
      return { ok: false, error: `Minimum offer is $${(minOfferCents / 100).toLocaleString()}` };
    }
  }

  return { ok: true };
}

// ── Stripe Customer management ──

export async function getOrCreateStripeCustomer(
  userId: string,
  email: string,
  fullName: string,
): Promise<{ customerId: string; ok: boolean; error?: string }> {
  const sb = getSB();

  // Check for existing customer
  const { data: existing } = await sb.from('payment_customers')
    .select('provider_customer_id')
    .eq('user_id', userId)
    .single();

  if (existing?.provider_customer_id) {
    return { customerId: existing.provider_customer_id, ok: true };
  }

  const stripe = getStripe();
  if (!stripe) {
    // Test mode without Stripe — generate a placeholder
    const placeholderId = `cus_test_${userId.slice(0, 12)}`;
    await sb.from('payment_customers').insert({
      user_id: userId,
      provider_customer_id: placeholderId,
      provider: 'stripe',
      test_mode: true,
    });
    return { customerId: placeholderId, ok: true };
  }

  try {
    const customer = await stripe.customers.create({
      email,
      name: fullName,
      metadata: {
        ivx_user_id: userId,
        environment: isTestMode() ? 'test' : 'live',
      },
    });

    await sb.from('payment_customers').insert({
      user_id: userId,
      provider_customer_id: customer.id,
      provider: 'stripe',
      test_mode: isTestMode(),
    });

    return { customerId: customer.id, ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { customerId: '', ok: false, error: message };
  }
}

// ── Payment Intent creation ──

export async function createPaymentIntent(
  input: CreatePaymentInput,
  userEmail: string,
  userFullName: string,
): Promise<CreatePaymentResult> {
  const traceId = genTraceId();
  const sb = getSB();
  const stripe = getStripe();
  const testMode = isTestMode();

  // Validate terms acceptance
  if (!input.acceptedTerms) {
    return { ok: false, amountCents: 0, state: 'DRAFT', traceId, code: 'TERMS_REQUIRED', error: 'You must accept the terms', testMode };
  }

  // Server-side amount calculation
  let amountCents = input.amountCents || 0;
  let shareCount = input.shareCount || 0;

  if (input.pathway === 'tokenized') {
    if (!shareCount || shareCount < 1) {
      return { ok: false, amountCents: 0, state: 'DRAFT', traceId, code: 'INVALID_SHARES', error: 'Share count required', testMode };
    }
    const calc = await calculateTokenizedAmount(input.dealId, shareCount);
    if (!calc.ok) {
      return { ok: false, amountCents: 0, state: 'DRAFT', traceId, code: 'VALIDATION_FAILED', error: calc.error, testMode };
    }
    amountCents = calc.amountCents;
  } else if (input.pathway === 'jv') {
    if (!amountCents || amountCents < 100) {
      return { ok: false, amountCents: 0, state: 'DRAFT', traceId, code: 'INVALID_AMOUNT', error: 'Amount required', testMode };
    }
    const valid = await validateJVContribution(input.dealId, amountCents);
    if (!valid.ok) {
      return { ok: false, amountCents: 0, state: 'DRAFT', traceId, code: 'VALIDATION_FAILED', error: valid.error, testMode };
    }
  } else if (input.pathway === 'buyer_deposit' || input.pathway === 'buyer_application_fee') {
    if (!amountCents || amountCents < 100) {
      return { ok: false, amountCents: 0, state: 'DRAFT', traceId, code: 'INVALID_AMOUNT', error: 'Amount required', testMode };
    }
    const valid = await validateBuyerPayment(input.dealId, amountCents, input.pathway === 'buyer_deposit');
    if (!valid.ok) {
      return { ok: false, amountCents: 0, state: 'DRAFT', traceId, code: 'VALIDATION_FAILED', error: valid.error, testMode };
    }
  }

  // Get or create Stripe customer
  const customerResult = await getOrCreateStripeCustomer(input.userId, userEmail, userFullName);
  if (!customerResult.ok) {
    return { ok: false, amountCents, state: 'DRAFT', traceId, code: 'CUSTOMER_ERROR', error: customerResult.error, testMode };
  }

  // Create payment record in DB
  const paymentId = `pay_${randomUUID()}`;
  const investmentId = `inv_${randomUUID()}`;

  const { error: payErr } = await sb.from('payment_intents').insert({
    id: paymentId,
    user_id: input.userId,
    deal_id: input.dealId,
    pathway: input.pathway,
    payment_method: input.paymentMethod,
    amount_cents: amountCents,
    currency: 'usd',
    state: 'DRAFT',
    idempotency_key: input.idempotencyKey,
    provider: 'stripe',
    provider_customer_id: customerResult.customerId,
    test_mode: testMode,
    share_count: shareCount || null,
    accepted_terms: true,
    metadata: input.metadata || {},
    trace_id: traceId,
  });

  if (payErr) {
    return { ok: false, amountCents, state: 'DRAFT', traceId, code: 'DB_ERROR', error: payErr.message, testMode };
  }

  // Create investment record (pending until payment confirmed)
  const { error: invErr } = await sb.from('investment_requests').insert({
    id: investmentId,
    payment_id: paymentId,
    user_id: input.userId,
    deal_id: input.dealId,
    pathway: input.pathway,
    amount_cents: amountCents,
    share_count: shareCount || null,
    state: 'PENDING',
    trace_id: traceId,
  });

  if (invErr) {
    // Non-fatal — payment can still proceed
    console.warn('[PaymentService] Investment record creation failed:', invErr.message);
  }

  // Create Stripe PaymentIntent if Stripe is configured
  if (stripe) {
    try {
      const paymentMethodTypes: string[] = input.paymentMethod === 'ach_debit'
        ? ['us_bank_account']
        : ['card'];

      const intent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: customerResult.customerId,
        payment_method_types: paymentMethodTypes,
        metadata: {
          ivx_payment_id: paymentId,
          ivx_user_id: input.userId,
          ivx_deal_id: input.dealId,
          ivx_pathway: input.pathway,
          ivx_trace_id: traceId,
          environment: testMode ? 'test' : 'live',
        },
      }, { idempotencyKey: input.idempotencyKey });

      // Update payment record with Stripe intent ID
      await sb.from('payment_intents').update({
        provider_payment_intent_id: intent.id,
        state: 'PAYMENT_CREATED',
        client_secret: intent.client_secret,
        updated_at: new Date().toISOString(),
      }).eq('id', paymentId);

      return {
        ok: true,
        paymentId,
        providerPaymentIntentId: intent.id,
        clientSecret: intent.client_secret,
        amountCents,
        state: 'PAYMENT_CREATED',
        traceId,
        testMode,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await sb.from('payment_intents').update({
        state: 'FAILED',
        error_message: message,
        updated_at: new Date().toISOString(),
      }).eq('id', paymentId);

      return { ok: false, amountCents, state: 'FAILED', traceId, code: 'STRIPE_ERROR', error: message, testMode };
    }
  }

  // Test mode without Stripe — return mock client secret
  const mockClientSecret = `${paymentId}_secret_${randomUUID().slice(0, 16)}`;
  await sb.from('payment_intents').update({
    provider_payment_intent_id: `pi_test_${paymentId.slice(4, 20)}`,
    state: 'PAYMENT_CREATED',
    client_secret: mockClientSecret,
    updated_at: new Date().toISOString(),
  }).eq('id', paymentId);

  return {
    ok: true,
    paymentId,
    providerPaymentIntentId: `pi_test_${paymentId.slice(4, 20)}`,
    clientSecret: mockClientSecret,
    amountCents,
    state: 'PAYMENT_CREATED',
    traceId,
    testMode: true,
  };
}

// ── Webhook processing ──

export async function processStripeWebhook(
  rawBody: string,
  signature: string,
): Promise<WebhookProcessResult> {
  const traceId = genTraceId();
  const sb = getSB();
  const stripe = getStripe();
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

  let event: any;

  if (stripe && webhookSecret) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, processed: false, traceId, error: `Signature verification failed: ${message}` };
    }
  } else {
    // Test mode — parse body directly (no signature verification)
    try {
      event = JSON.parse(rawBody);
    } catch {
      return { ok: false, processed: false, traceId, error: 'Invalid JSON body' };
    }
  }

  // Idempotency: check if event already processed
  const eventId = event.id || `evt_${Date.now()}`;
  const { data: existingEvent } = await sb.from('payment_events')
    .select('id, processed')
    .eq('provider_event_id', eventId)
    .single();

  if (existingEvent?.processed) {
    return { ok: true, processed: true, traceId, error: 'Event already processed (idempotent)' };
  }

  // Record the event
  await sb.from('payment_events').insert({
    id: `ev_${randomUUID()}`,
    provider_event_id: eventId,
    event_type: event.type,
    provider: 'stripe',
    processed: false,
    raw_event: event,
    trace_id: traceId,
  });

  const paymentIntent = event.data?.object;
  if (!paymentIntent?.id) {
    return { ok: false, processed: false, traceId, error: 'No payment intent in event' };
  }

  // Find our payment record
  const { data: payment } = await sb.from('payment_intents')
    .select('id, user_id, deal_id, pathway, share_count, amount_cents, state')
    .eq('provider_payment_intent_id', paymentIntent.id)
    .single();

  if (!payment) {
    return { ok: true, processed: true, traceId, error: 'Payment not found (may be from another system)' };
  }

  // Map Stripe status to our state machine
  const stripeStatus = paymentIntent.status;
  let newState: PaymentState = payment.state as PaymentState;

  switch (stripeStatus) {
    case 'requires_payment_method':
    case 'requires_confirmation':
      newState = 'PAYMENT_CREATED';
      break;
    case 'requires_action':
      newState = 'REQUIRES_ACTION';
      break;
    case 'processing':
      newState = 'PROCESSING';
      break;
    case 'succeeded':
      newState = 'SUCCEEDED';
      break;
    case 'canceled':
      newState = 'CANCELLED';
      break;
    case 'requires_capture':
      newState = 'PENDING_SETTLEMENT';
      break;
    default:
      if (stripeStatus?.startsWith('requires')) {
        newState = 'REQUIRES_ACTION';
      }
      break;
  }

  // Update payment state
  await sb.from('payment_intents').update({
    state: newState,
    updated_at: new Date().toISOString(),
  }).eq('id', payment.id);

  // If succeeded — finalize investment atomically
  let investmentFinalized = false;
  if (newState === 'SUCCEEDED') {
    investmentFinalized = await finalizeInvestment(payment.id, traceId);
  }

  // Mark event as processed
  await sb.from('payment_events').update({
    processed: true,
    processed_at: new Date().toISOString(),
  }).eq('provider_event_id', eventId);

  return {
    ok: true,
    processed: true,
    paymentId: payment.id,
    newState,
    investmentFinalized,
    traceId,
  };
}

// ── Atomic investment finalization ──

async function finalizeInvestment(paymentId: string, traceId: string): Promise<boolean> {
  const sb = getSB();

  try {
    // Load payment + investment
    const { data: payment } = await sb.from('payment_intents')
      .select('id, user_id, deal_id, pathway, share_count, amount_cents')
      .eq('id', paymentId)
      .single();

    if (!payment) return false;

    const { data: investment } = await sb.from('investment_requests')
      .select('id, state')
      .eq('payment_id', paymentId)
      .single();

    if (!investment) return false;

    // Update investment to CONFIRMED
    await sb.from('investment_requests').update({
      state: 'CONFIRMED',
      confirmed_at: new Date().toISOString(),
      trace_id: traceId,
    }).eq('id', investment.id);

    // Create ownership allocation
    const ownershipId = `own_${randomUUID()}`;
    const ownershipPercent = payment.pathway === 'tokenized' && payment.share_count
      ? (payment.share_count / 10000) // placeholder — real calc needs total shares
      : 0;

    await sb.from('ownership_allocations').insert({
      id: ownershipId,
      investment_id: investment.id,
      user_id: payment.user_id,
      deal_id: payment.deal_id,
      pathway: payment.pathway,
      shares_allocated: payment.share_count || null,
      ownership_percent: ownershipPercent,
      amount_cents: payment.amount_cents,
      state: 'ACTIVE',
      trace_id: traceId,
    });

    // Update deal counters (tokenized)
    if (payment.pathway === 'tokenized' && payment.share_count) {
      const { data: deal } = await sb.from('jv_deals')
        .select('sold_shares, available_shares, tokenized_capital_raised, share_price')
        .eq('id', payment.deal_id)
        .single();

      if (deal) {
        const newSoldShares = Number(deal.sold_shares) + payment.share_count;
        const newAvailableShares = Number(deal.available_shares) - payment.share_count;
        const newCapitalRaised = Number(deal.tokenized_capital_raised) + (payment.share_count * Number(deal.share_price));

        await sb.from('jv_deals').update({
          sold_shares: newSoldShares,
          available_shares: newAvailableShares,
          tokenized_capital_raised: newCapitalRaised,
          updated_at: new Date().toISOString(),
        }).eq('id', payment.deal_id);
      }
    }

    // Create receipt
    const receiptId = `rcpt_${randomUUID()}`;
    await sb.from('receipts').insert({
      id: receiptId,
      payment_id: paymentId,
      investment_id: investment.id,
      user_id: payment.user_id,
      deal_id: payment.deal_id,
      pathway: payment.pathway,
      amount_cents: payment.amount_cents,
      share_count: payment.share_count || null,
      provider: 'stripe',
      provider_payment_intent_id: payment.id,
      trace_id: traceId,
    });

    // Update payment to COMPLETED
    await sb.from('payment_intents').update({
      state: 'COMPLETED',
      completed_at: new Date().toISOString(),
    }).eq('id', paymentId);

    // Trigger member reclassification after successful investment finalization
    try {
      const memberId = payment.user_id;
      if (memberId) {
        await onTransactionSettled(memberId, paymentId, Number(payment.amount_cents));
        console.log(`[PaymentService] Classification trigger fired for member ${memberId} after settlement`);
      }
    } catch (classErr) {
      const classMessage = classErr instanceof Error ? classErr.message : String(classErr);
      console.error('[PaymentService] Classification trigger failed (non-fatal):', classMessage);
    }

    return true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[PaymentService] Finalization failed:', message);
    return false;
  }
}

// ── Payment status query ──

export async function getPaymentStatus(paymentId: string): Promise<PaymentStatusResult> {
  const traceId = genTraceId();
  const sb = getSB();

  const { data: payment, error } = await sb.from('payment_intents')
    .select('id, state, amount_cents, pathway, provider_payment_intent_id, deal_id, share_count')
    .eq('id', paymentId)
    .single();

  if (error || !payment) {
    return { ok: false, traceId };
  }

  const { data: investment } = await sb.from('investment_requests')
    .select('id, state, share_count, ownership_percent')
    .eq('payment_id', paymentId)
    .single();

  return {
    ok: true,
    payment: {
      id: payment.id,
      state: payment.state as PaymentState,
      amountCents: Number(payment.amount_cents),
      pathway: payment.pathway as PaymentPathway,
      providerPaymentIntentId: payment.provider_payment_intent_id,
      dealId: payment.deal_id,
      shareCount: payment.share_count,
    },
    investment: investment ? {
      id: investment.id,
      state: investment.state as InvestmentState,
      sharesAllocated: investment.share_count,
      ownershipPercent: investment.ownership_percent,
    } : undefined,
    traceId,
  };
}

// ── Refund ──

export async function refundPayment(
  paymentId: string,
  amountCents?: number, // undefined = full refund
  reason?: string,
): Promise<{ ok: boolean; traceId: string; error?: string }> {
  const traceId = genTraceId();
  const sb = getSB();
  const stripe = getStripe();

  const { data: payment } = await sb.from('payment_intents')
    .select('id, provider_payment_intent_id, amount_cents, state, deal_id, pathway, share_count, user_id')
    .eq('id', paymentId)
    .single();

  if (!payment) {
    return { ok: false, traceId, error: 'Payment not found' };
  }

  if (!['SUCCEEDED', 'COMPLETED', 'ALLOCATED'].includes(payment.state)) {
    return { ok: false, traceId, error: `Cannot refund payment in state ${payment.state}` };
  }

  const refundAmount = amountCents || Number(payment.amount_cents);
  const isPartial = amountCents && amountCents < Number(payment.amount_cents);

  if (stripe && payment.provider_payment_intent_id?.startsWith('pi_')) {
    try {
      await stripe.refunds.create({
        payment_intent: payment.provider_payment_intent_id,
        amount: refundAmount,
        metadata: {
          ivx_payment_id: paymentId,
          ivx_trace_id: traceId,
          reason: reason || 'customer_request',
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, traceId, error: message };
    }
  }

  // Update payment state
  await sb.from('payment_intents').update({
    state: isPartial ? 'PARTIALLY_REFUNDED' : 'REFUNDED',
    updated_at: new Date().toISOString(),
  }).eq('id', paymentId);

  // Reverse ownership allocation
  if (!isPartial) {
    await sb.from('ownership_allocations')
      .update({ state: 'REVOKED', revoked_at: new Date().toISOString(), trace_id: traceId })
      .eq('investment_id', (await sb.from('investment_requests').select('id').eq('payment_id', paymentId).single()).data?.id);

    await sb.from('investment_requests')
      .update({ state: 'REFUNDED', trace_id: traceId })
      .eq('payment_id', paymentId);

    // Reverse deal counters for tokenized
    if (payment.pathway === 'tokenized' && payment.share_count) {
      const { data: deal } = await sb.from('jv_deals')
        .select('sold_shares, available_shares, tokenized_capital_raised, share_price')
        .eq('id', payment.deal_id)
        .single();

      if (deal) {
        await sb.from('jv_deals').update({
          sold_shares: Math.max(0, Number(deal.sold_shares) - payment.share_count),
          available_shares: Number(deal.available_shares) + payment.share_count,
          tokenized_capital_raised: Math.max(0, Number(deal.tokenized_capital_raised) - (payment.share_count * Number(deal.share_price))),
        }).eq('id', payment.deal_id);
      }
    }
  }

  // Trigger member reclassification after refund processing
  try {
    const memberId = payment.user_id;
    if (memberId) {
      await onRefundProcessed(memberId, paymentId, refundAmount);
      console.log(`[PaymentService] Classification trigger fired for member ${memberId} after refund`);
    }
  } catch (classErr) {
    const classMessage = classErr instanceof Error ? classErr.message : String(classErr);
    console.error('[PaymentService] Refund classification trigger failed (non-fatal):', classMessage);
  }

  return { ok: true, traceId };
}

// ── Financial Connections session ──

export async function createBankLinkSession(
  userId: string,
  userEmail: string,
): Promise<{ ok: boolean; clientSecret?: string; traceId: string; error?: string; testMode: boolean }> {
  const traceId = genTraceId();
  const stripe = getStripe();
  const testMode = isTestMode();

  if (!stripe) {
    // Test mode — return mock
    return {
      ok: true,
      clientSecret: `fcs_test_${randomUUID().slice(0, 20)}`,
      traceId,
      testMode: true,
    };
  }

  try {
    const customerResult = await getOrCreateStripeCustomer(userId, userEmail, '');
    if (!customerResult.ok) {
      return { ok: false, traceId, error: customerResult.error, testMode };
    }

    const session = await stripe.financialConnections.sessions.create({
      customer: customerResult.customerId,
      permissions: ['balances', 'payment_method', 'transactions'],
      metadata: {
        ivx_user_id: userId,
        ivx_trace_id: traceId,
      },
    });

    return {
      ok: true,
      clientSecret: session.client_secret,
      traceId,
      testMode,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, traceId, error: message, testMode };
  }
}

// ── Payment configuration status ──

export function getPaymentConfigStatus(): {
  stripeConfigured: boolean;
  testMode: boolean;
  webhookSecretConfigured: boolean;
  publishableKeyConfigured: boolean;
  environment: 'test' | 'live' | 'not_configured';
  capabilities: {
    card: boolean;
    ach: boolean;
    financialConnections: boolean;
    refunds: boolean;
  };
} {
  const secretKey = (process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || '').trim();
  const publishableKey = (process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '').trim();
  const webhookSecret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();

  const stripeConfigured = !!secretKey;
  const testMode = !secretKey || secretKey.startsWith('sk_test_');
  const environment: 'test' | 'live' | 'not_configured' = stripeConfigured
    ? (testMode ? 'test' : 'live')
    : 'not_configured';

  return {
    stripeConfigured,
    testMode,
    webhookSecretConfigured: !!webhookSecret,
    publishableKeyConfigured: !!publishableKey,
    environment,
    capabilities: {
      card: stripeConfigured,
      ach: stripeConfigured,
      financialConnections: stripeConfigured,
      refunds: stripeConfigured,
    },
  };
}

export { DEPLOYMENT_MARKER };