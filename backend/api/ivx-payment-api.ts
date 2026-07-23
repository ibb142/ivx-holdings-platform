/**
 * IVX Payment API Handlers
 *
 * Endpoints:
 * - GET  /api/ivx/payments/config          — public payment config status
 * - POST /api/ivx/payments/create           — create payment intent (authenticated)
 * - GET  /api/ivx/payments/:id              — get payment status (authenticated)
 * - POST /api/ivx/payments/bank-link        — create bank link session (authenticated)
 * - POST /api/ivx/payments/webhook          — Stripe webhook receiver (no auth, signature verified)
 * - POST /api/ivx/payments/:id/refund       — refund payment (owner-only)
 * - GET  /api/ivx/payments/portfolio        — user portfolio (authenticated)
 * - GET  /api/ivx/payments/transactions     — user transactions (authenticated)
 * - GET  /api/ivx/payments/receipts/:id     — receipt detail (authenticated)
 * - GET  /api/ivx/payments/admin/all        — all payments (owner-only)
 * - GET  /api/ivx/payments/admin/stats      — payment stats (owner-only)
 * - POST /api/ivx/payments/jv-application   — submit JV application (authenticated)
 * - POST /api/ivx/payments/buyer-offer      — submit buyer offer (authenticated)
 * - GET  /api/ivx/payments/jv-applications  — list JV applications (owner-only)
 * - GET  /api/ivx/payments/buyer-offers     — list buyer offers (owner-only)
 * - POST /api/ivx/payments/jv-applications/:id/review — owner review JV (owner-only)
 * - POST /api/ivx/payments/buyer-offers/:id/review    — owner review buyer offer (owner-only)
 */

import {
  createPaymentIntent,
  getPaymentStatus,
  processStripeWebhook,
  refundPayment,
  createBankLinkSession,
  getPaymentConfigStatus,
  validateJVContribution,
  validateBuyerPayment,
  calculateTokenizedAmount,
  type CreatePaymentInput,
  type PaymentPathway,
} from '../services/ivx-payment-service';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const DEPLOYMENT_MARKER = 'ivx-payment-api-v1-2026-07-23';

let _sb: SupabaseClient | null = null;
function getSB(): SupabaseClient {
  if (_sb) return _sb;
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _sb;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function genTraceId(): string {
  return `pay-api-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

/**
 * Extract and verify the Bearer token from the Authorization header.
 * Returns the user ID if valid, null otherwise.
 */
async function verifyBearer(authHeader: string | null | undefined): Promise<{ userId: string; email: string; fullName: string; role: string } | null> {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7).trim();
  if (!token || token.length < 20) return null;

  const sb = getSB();
  const { data: { user }, error } = await sb.auth.getUser(token);
  if (error || !user) return null;

  const { data: profile } = await sb.from('profiles')
    .select('full_name, role')
    .eq('id', user.id)
    .single();

  return {
    userId: user.id,
    email: user.email || '',
    fullName: profile?.full_name || '',
    role: profile?.role || 'member',
  };
}

async function verifyOwner(authHeader: string | null | undefined): Promise<{ userId: string; email: string } | null> {
  const user = await verifyBearer(authHeader);
  if (!user) return null;
  if (user.role !== 'owner' && user.role !== 'admin') return null;
  return { userId: user.userId, email: user.email };
}

// ── Handlers ──

/**
 * GET /api/ivx/payments/config
 * Public endpoint — returns payment configuration status (no secrets).
 */
export async function handleGetPaymentConfig(): Promise<Response> {
  const status = getPaymentConfigStatus();
  return json({
    ok: true,
    config: {
      provider: 'stripe',
      environment: status.environment,
      stripeConfigured: status.stripeConfigured,
      testMode: status.testMode,
      webhookConfigured: status.webhookSecretConfigured,
      publishableKey: process.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
      capabilities: status.capabilities,
    },
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * POST /api/ivx/payments/create
 * Authenticated — creates a payment intent for a deal pathway participation.
 */
export async function handleCreatePayment(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const user = await verifyBearer(authHeader);
  if (!user) return json({ ok: false, code: 'UNAUTHORIZED', traceId }, 401);

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, code: 'INVALID_JSON', traceId }, 400);
  }

  const dealId = String(body.dealId || '').trim();
  const pathway = String(body.pathway || '').trim() as PaymentPathway;
  const paymentMethod = String(body.paymentMethod || 'card').trim() as 'card' | 'ach_debit';
  const shareCount = Number(body.shareCount) || 0;
  const amountCents = Number(body.amountCents) || 0;
  const acceptedTerms = Boolean(body.acceptedTerms);
  const idempotencyKey = String(body.idempotencyKey || `ivx-pay-${user.userId}-${dealId}-${Date.now()}`).trim();

  if (!dealId) return json({ ok: false, code: 'DEAL_REQUIRED', traceId }, 400);
  if (!pathway || !['tokenized', 'jv', 'buyer_deposit', 'buyer_application_fee'].includes(pathway)) {
    return json({ ok: false, code: 'INVALID_PATHWAY', traceId }, 400);
  }
  if (!['card', 'ach_debit'].includes(paymentMethod)) {
    return json({ ok: false, code: 'INVALID_PAYMENT_METHOD', traceId }, 400);
  }

  const input: CreatePaymentInput = {
    userId: user.userId,
    dealId,
    pathway,
    paymentMethod,
    shareCount,
    amountCents,
    idempotencyKey,
    acceptedTerms,
    metadata: {
      userEmail: user.email.slice(0, 50),
      userFullName: user.fullName.slice(0, 80),
    },
  };

  const result = await createPaymentIntent(input, user.email, user.fullName);
  return json({
    ...result,
    traceId: result.traceId || traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  }, result.ok ? 200 : 400);
}

/**
 * GET /api/ivx/payments/:id
 * Authenticated — returns payment status + investment state.
 */
export async function handleGetPayment(req: Request, paymentId: string): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const user = await verifyBearer(authHeader);
  if (!user) return json({ ok: false, code: 'UNAUTHORIZED', traceId }, 401);

  const result = await getPaymentStatus(paymentId);
  if (!result.ok) return json({ ok: false, code: 'NOT_FOUND', traceId }, 404);

  // Users can only see their own payments; owners can see any
  if (result.payment?.dealId && user.role !== 'owner' && user.role !== 'admin') {
    const sb = getSB();
    const { data: payment } = await sb.from('payment_intents')
      .select('user_id')
      .eq('id', paymentId)
      .single();
    if (payment?.user_id !== user.userId) {
      return json({ ok: false, code: 'FORBIDDEN', traceId }, 403);
    }
  }

  return json({ ...result, deploymentMarker: DEPLOYMENT_MARKER });
}

/**
 * POST /api/ivx/payments/bank-link
 * Authenticated — creates a Stripe Financial Connections session.
 */
export async function handleCreateBankLink(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const user = await verifyBearer(authHeader);
  if (!user) return json({ ok: false, code: 'UNAUTHORIZED', traceId }, 401);

  const result = await createBankLinkSession(user.userId, user.email);
  return json({ ...result, deploymentMarker: DEPLOYMENT_MARKER });
}

/**
 * POST /api/ivx/payments/webhook
 * Public — Stripe webhook receiver. Signature verified via STRIPE_WEBHOOK_SECRET.
 */
export async function handleStripeWebhook(req: Request): Promise<Response> {
  const traceId = genTraceId();

  // Read raw body
  const rawBody = await req.text();
  const signature = req.headers.get('stripe-signature') || '';

  const result = await processStripeWebhook(rawBody, signature);

  // Always return 200 to Stripe (prevent retries for processed events)
  // but return 400 for signature verification failures
  return json({
    ...result,
    deploymentMarker: DEPLOYMENT_MARKER,
  }, result.ok ? 200 : 400);
}

/**
 * POST /api/ivx/payments/:id/refund
 * Owner-only — refunds a payment.
 */
export async function handleRefundPayment(req: Request, paymentId: string): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const owner = await verifyOwner(authHeader);
  if (!owner) return json({ ok: false, code: 'OWNER_ONLY', traceId }, 403);

  let body: any = {};
  try { body = await req.json(); } catch { /* ok */ }

  const amountCents = body.amountCents ? Number(body.amountCents) : undefined;
  const reason = String(body.reason || 'owner_initiated').trim();

  const result = await refundPayment(paymentId, amountCents, reason);
  return json({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, result.ok ? 200 : 400);
}

/**
 * GET /api/ivx/payments/portfolio
 * Authenticated — returns user's portfolio positions.
 */
export async function handleGetPortfolio(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const user = await verifyBearer(authHeader);
  if (!user) return json({ ok: false, code: 'UNAUTHORIZED', traceId }, 401);

  const sb = getSB();
  const { data: positions, error } = await sb.from('ownership_allocations')
    .select(`
      id, deal_id, pathway, shares_allocated, ownership_percent, amount_cents, state, created_at,
      investment_requests!inner(payment_id, state)
    `)
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false });

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  // Get deal titles
  const dealIds = [...new Set((positions || []).map((p: any) => p.deal_id))];
  const { data: deals } = await sb.from('jv_deals')
    .select('id, title, slug')
    .in('id', dealIds);

  const dealMap = new Map((deals || []).map((d: any) => [d.id, d]));

  const portfolio = (positions || []).map((p: any) => ({
    id: p.id,
    dealId: p.deal_id,
    dealTitle: dealMap.get(p.deal_id)?.title || 'Unknown',
    dealSlug: dealMap.get(p.deal_id)?.slug || null,
    pathway: p.pathway,
    sharesAllocated: p.shares_allocated,
    ownershipPercent: Number(p.ownership_percent) || 0,
    amountCents: Number(p.amount_cents) || 0,
    state: p.state,
    investmentState: p.investment_requests?.state || 'PENDING',
    createdAt: p.created_at,
  }));

  return json({
    ok: true,
    portfolio,
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * GET /api/ivx/payments/transactions
 * Authenticated — returns user's transaction history.
 */
export async function handleGetTransactions(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const user = await verifyBearer(authHeader);
  if (!user) return json({ ok: false, code: 'UNAUTHORIZED', traceId }, 401);

  const sb = getSB();
  const { data: transactions, error } = await sb.from('payment_intents')
    .select('id, deal_id, pathway, payment_method, amount_cents, currency, state, provider_payment_intent_id, share_count, test_mode, created_at, updated_at')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  return json({
    ok: true,
    transactions: transactions || [],
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * GET /api/ivx/payments/receipts/:id
 * Authenticated — returns receipt details.
 */
export async function handleGetReceipt(req: Request, receiptId: string): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const user = await verifyBearer(authHeader);
  if (!user) return json({ ok: false, code: 'UNAUTHORIZED', traceId }, 401);

  const sb = getSB();
  const { data: receipt, error } = await sb.from('receipts')
    .select('*')
    .eq('id', receiptId)
    .single();

  if (error || !receipt) return json({ ok: false, code: 'NOT_FOUND', traceId }, 404);

  // Users can only see their own receipts
  if (receipt.user_id !== user.userId && user.role !== 'owner' && user.role !== 'admin') {
    return json({ ok: false, code: 'FORBIDDEN', traceId }, 403);
  }

  return json({
    ok: true,
    receipt,
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * GET /api/ivx/payments/admin/all
 * Owner-only — returns all payments with optional filters.
 */
export async function handleAdminGetAllPayments(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const owner = await verifyOwner(authHeader);
  if (!owner) return json({ ok: false, code: 'OWNER_ONLY', traceId }, 403);

  const sb = getSB();
  const url = new URL(req.url);
  const pathway = url.searchParams.get('pathway');
  const state = url.searchParams.get('state');
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500);

  let query = sb.from('payment_intents')
    .select('id, user_id, deal_id, pathway, payment_method, amount_cents, state, provider_payment_intent_id, share_count, test_mode, created_at, updated_at')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (pathway) query = query.eq('pathway', pathway);
  if (state) query = query.eq('state', state);

  const { data: payments, error } = await query;

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  return json({
    ok: true,
    payments: payments || [],
    count: (payments || []).length,
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * GET /api/ivx/payments/admin/stats
 * Owner-only — returns payment statistics.
 */
export async function handleAdminGetPaymentStats(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const owner = await verifyOwner(authHeader);
  if (!owner) return json({ ok: false, code: 'OWNER_ONLY', traceId }, 403);

  const sb = getSB();

  // Total counts by state
  const { data: byState } = await sb.from('payment_intents')
    .select('state, amount_cents')
    .order('created_at', { ascending: false });

  const stats: Record<string, { count: number; totalCents: number }> = {};
  for (const p of byState || []) {
    if (!stats[p.state]) stats[p.state] = { count: 0, totalCents: 0 };
    stats[p.state].count++;
    stats[p.state].totalCents += Number(p.amount_cents) || 0;
  }

  // By pathway
  const { data: byPathway } = await sb.from('payment_intents')
    .select('pathway, amount_cents, state');

  const pathwayStats: Record<string, { total: number; succeeded: number; processing: number; failed: number }> = {};
  for (const p of byPathway || []) {
    if (!pathwayStats[p.pathway]) pathwayStats[p.pathway] = { total: 0, succeeded: 0, processing: 0, failed: 0 };
    pathwayStats[p.pathway].total++;
    if (['SUCCEEDED', 'COMPLETED', 'ALLOCATED'].includes(p.state)) pathwayStats[p.pathway].succeeded++;
    if (['PROCESSING', 'PENDING_SETTLEMENT', 'REQUIRES_ACTION'].includes(p.state)) pathwayStats[p.pathway].processing++;
    if (['FAILED', 'CANCELLED'].includes(p.state)) pathwayStats[p.pathway].failed++;
  }

  return json({
    ok: true,
    stats: {
      byState: stats,
      byPathway: pathwayStats,
      totalPayments: (byState || []).length,
      totalVolumeCents: (byState || []).reduce((sum: number, p: any) => sum + (Number(p.amount_cents) || 0), 0),
    },
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * POST /api/ivx/payments/jv-application
 * Authenticated — submits a JV application (does NOT enable payment).
 */
export async function handleJVApplication(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const user = await verifyBearer(authHeader);
  if (!user) return json({ ok: false, code: 'UNAUTHORIZED', traceId }, 401);

  let body: any;
  try { body = await req.json(); } catch {
    return json({ ok: false, code: 'INVALID_JSON', traceId }, 400);
  }

  const dealId = String(body.dealId || '').trim();
  const amountCents = Number(body.amountCents) || 0;
  const contributionType = String(body.contributionType || 'capital').trim();
  const company = String(body.company || '').trim();
  const experience = String(body.experience || '').trim();
  const proposedTerms = String(body.proposedTerms || '').trim();
  const requestedOwnership = Number(body.requestedOwnership) || 0;
  const projectRole = String(body.projectRole || '').trim();
  const proofOfFundsUrl = String(body.proofOfFundsUrl || '').trim();
  const acceptedTerms = Boolean(body.acceptedTerms);

  if (!dealId) return json({ ok: false, code: 'DEAL_REQUIRED', traceId }, 400);
  if (!acceptedTerms) return json({ ok: false, code: 'TERMS_REQUIRED', traceId }, 400);
  if (amountCents < 100) return json({ ok: false, code: 'INVALID_AMOUNT', traceId }, 400);

  // Validate against deal constraints
  const valid = await validateJVContribution(dealId, amountCents);
  if (!valid.ok) return json({ ok: false, code: 'VALIDATION_FAILED', traceId, error: valid.error }, 400);

  const sb = getSB();
  const applicationId = `jv_app_${randomUUID()}`;

  const { data, error } = await sb.from('jv_applications').insert({
    id: applicationId,
    user_id: user.userId,
    deal_id: dealId,
    amount_cents: amountCents,
    contribution_type: contributionType,
    company,
    experience,
    proposed_terms: proposedTerms,
    requested_ownership: requestedOwnership,
    project_role: projectRole,
    proof_of_funds_url: proofOfFundsUrl,
    accepted_terms: acceptedTerms,
    state: 'APPLICATION',
    trace_id: traceId,
  }).select('*').single();

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  return json({
    ok: true,
    application: data,
    message: 'JV application submitted. Owner will review and respond.',
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * POST /api/ivx/payments/buyer-offer
 * Authenticated — submits a buyer offer (does NOT charge full price).
 */
export async function handleBuyerOffer(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const user = await verifyBearer(authHeader);
  if (!user) return json({ ok: false, code: 'UNAUTHORIZED', traceId }, 401);

  let body: any;
  try { body = await req.json(); } catch {
    return json({ ok: false, code: 'INVALID_JSON', traceId }, 400);
  }

  const dealId = String(body.dealId || '').trim();
  const offerAmountCents = Number(body.offerAmountCents) || 0;
  const financingType = String(body.financingType || 'cash').trim(); // cash | financing
  const downPaymentCents = Number(body.downPaymentCents) || 0;
  const proofOfFundsUrl = String(body.proofOfFundsUrl || '').trim();
  const preapprovalUrl = String(body.preapprovalUrl || '').trim();
  const earnestMoneyCents = Number(body.earnestMoneyCents) || 0;
  const inspectionPeriodDays = Number(body.inspectionPeriodDays) || 15;
  const closingDate = String(body.closingDate || '').trim();
  const contingencies = String(body.contingencies || '').trim();
  const brokerName = String(body.brokerName || '').trim();
  const offerExpirationDays = Number(body.offerExpirationDays) || 7;
  const message = String(body.message || '').trim();
  const acceptedTerms = Boolean(body.acceptedTerms);

  if (!dealId) return json({ ok: false, code: 'DEAL_REQUIRED', traceId }, 400);
  if (!acceptedTerms) return json({ ok: false, code: 'TERMS_REQUIRED', traceId }, 400);
  if (offerAmountCents < 100) return json({ ok: false, code: 'INVALID_OFFER', traceId }, 400);

  // Validate against deal constraints
  const valid = await validateBuyerPayment(dealId, offerAmountCents, false);
  if (!valid.ok) return json({ ok: false, code: 'VALIDATION_FAILED', traceId, error: valid.error }, 400);

  const sb = getSB();
  const offerId = `buyer_offer_${randomUUID()}`;

  // Determine offer classification
  const { data: deal } = await sb.from('jv_deals')
    .select('buyer_asking_price, allow_below_asking')
    .eq('id', dealId)
    .single();

  const askingPriceCents = Number(deal?.buyer_asking_price) * 100 || 0;
  let offerType = 'FULL_PRICE_OFFER';
  if (askingPriceCents > 0) {
    if (offerAmountCents < askingPriceCents) offerType = 'BELOW_ASKING_OFFER';
    else if (offerAmountCents > askingPriceCents) offerType = 'ABOVE_ASKING_OFFER';
  }

  const { data, error } = await sb.from('buyer_offers').insert({
    id: offerId,
    user_id: user.userId,
    deal_id: dealId,
    offer_amount_cents: offerAmountCents,
    offer_type: offerType,
    asking_price_cents: askingPriceCents,
    financing_type: financingType,
    down_payment_cents: downPaymentCents,
    proof_of_funds_url: proofOfFundsUrl,
    preapproval_url: preapprovalUrl,
    earnest_money_cents: earnestMoneyCents,
    inspection_period_days: inspectionPeriodDays,
    closing_date: closingDate || null,
    contingencies,
    broker_name: brokerName,
    offer_expiration_days: offerExpirationDays,
    message,
    accepted_terms: acceptedTerms,
    state: 'OFFER',
    trace_id: traceId,
  }).select('*').single();

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  return json({
    ok: true,
    offer: data,
    message: 'Buyer offer submitted. Owner will review and respond.',
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * GET /api/ivx/payments/jv-applications
 * Owner-only — lists all JV applications.
 */
export async function handleListJVApplications(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const owner = await verifyOwner(authHeader);
  if (!owner) return json({ ok: false, code: 'OWNER_ONLY', traceId }, 403);

  const sb = getSB();
  const { data, error } = await sb.from('jv_applications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  return json({ ok: true, applications: data || [], count: (data || []).length, traceId, deploymentMarker: DEPLOYMENT_MARKER });
}

/**
 * GET /api/ivx/payments/buyer-offers
 * Owner-only — lists all buyer offers.
 */
export async function handleListBuyerOffers(req: Request): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const owner = await verifyOwner(authHeader);
  if (!owner) return json({ ok: false, code: 'OWNER_ONLY', traceId }, 403);

  const sb = getSB();
  const { data, error } = await sb.from('buyer_offers')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  return json({ ok: true, offers: data || [], count: (data || []).length, traceId, deploymentMarker: DEPLOYMENT_MARKER });
}

/**
 * POST /api/ivx/payments/jv-applications/:id/review
 * Owner-only — reviews a JV application (approve/reject/counter).
 */
export async function handleReviewJVApplication(req: Request, applicationId: string): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const owner = await verifyOwner(authHeader);
  if (!owner) return json({ ok: false, code: 'OWNER_ONLY', traceId }, 403);

  let body: any;
  try { body = await req.json(); } catch {
    return json({ ok: false, code: 'INVALID_JSON', traceId }, 400);
  }

  const action = String(body.action || '').trim(); // approve | reject | counter | due_diligence
  const reviewNotes = String(body.reviewNotes || '').trim();
  const counterTerms = body.counterTerms || null;

  if (!['approve', 'reject', 'counter', 'due_diligence'].includes(action)) {
    return json({ ok: false, code: 'INVALID_ACTION', traceId }, 400);
  }

  const stateMap: Record<string, string> = {
    approve: 'PAYMENT_ENABLED',
    reject: 'REJECTED',
    counter: 'COUNTER_TERMS',
    due_diligence: 'DUE_DILIGENCE',
  };

  const sb = getSB();
  const { data, error } = await sb.from('jv_applications')
    .update({
      state: stateMap[action],
      review_notes: reviewNotes,
      counter_terms: counterTerms,
      reviewed_by: owner.userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', applicationId)
    .select('*')
    .single();

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  return json({
    ok: true,
    application: data,
    message: `JV application ${action}ed.`,
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * POST /api/ivx/payments/buyer-offers/:id/review
 * Owner-only — reviews a buyer offer (accept/reject/counter).
 */
export async function handleReviewBuyerOffer(req: Request, offerId: string): Promise<Response> {
  const traceId = genTraceId();
  const authHeader = req.headers.get('Authorization');
  const owner = await verifyOwner(authHeader);
  if (!owner) return json({ ok: false, code: 'OWNER_ONLY', traceId }, 403);

  let body: any;
  try { body = await req.json(); } catch {
    return json({ ok: false, code: 'INVALID_JSON', traceId }, 400);
  }

  const action = String(body.action || '').trim(); // accept | reject | counter
  const reviewNotes = String(body.reviewNotes || '').trim();
  const counterAmountCents = body.counterAmountCents ? Number(body.counterAmountCents) : null;

  if (!['accept', 'reject', 'counter'].includes(action)) {
    return json({ ok: false, code: 'INVALID_ACTION', traceId }, 400);
  }

  const stateMap: Record<string, string> = {
    accept: 'ACCEPTED',
    reject: 'REJECTED',
    counter: 'COUNTERED',
  };

  const sb = getSB();
  const { data, error } = await sb.from('buyer_offers')
    .update({
      state: stateMap[action],
      review_notes: reviewNotes,
      counter_amount_cents: counterAmountCents,
      reviewed_by: owner.userId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)
    .select('*')
    .single();

  if (error) return json({ ok: false, code: 'DB_ERROR', traceId, error: error.message }, 500);

  return json({
    ok: true,
    offer: data,
    message: `Buyer offer ${action}ed.`,
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

// ── CORS options handler ──
export function handlePaymentOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

export { DEPLOYMENT_MARKER };
