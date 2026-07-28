/**
 * IVX Member Classification API — owner-only endpoints.
 *
 *   GET  /api/ivx/classification/dashboard          — owner dashboard totals
 *   GET  /api/ivx/classification/member/:memberId    — get member classification
 *   POST /api/ivx/classification/classify/:memberId  — reclassify a member
 *   POST /api/ivx/classification/reconcile           — reconcile all members
 *   POST /api/ivx/classification/override             — manual tier override (owner)
 *   GET  /api/ivx/classification/audit/:memberId      — audit trail for a member
 *   POST /api/ivx/classification/ia-query             — IVX IA classification query
 *   GET  /api/ivx/classification/financial/:memberId  — financial summary (owner)
 */
import {
  classifyMember,
  reconcileAllMembers,
  getOwnerDashboardTotals,
  applyManualOverride,
  answerClassificationQuery,
  CLASSIFICATION_MARKER,
  type MemberTier,
  type ManualOverrideInput,
  type IAClassificationQuery,
} from '../services/ivx-member-classification';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

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
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

// ── OPTIONS ──

export function classificationOptions(): Response {
  return ownerOnlyOptions();
}

// ── GET /api/ivx/classification/dashboard ──

export async function handleClassificationDashboard(request: Request): Promise<Response> {
  await assertIVXOwnerOnly(request);
  const totals = await getOwnerDashboardTotals();
  return ownerOnlyJson({ ok: true, marker: CLASSIFICATION_MARKER, totals });
}

// ── GET /api/ivx/classification/member/:memberId ──

export async function handleGetMemberClassification(
  request: Request,
  memberId: string,
): Promise<Response> {
  await assertIVXOwnerOnly(request);
  const sb = getSB();

  const { data: member, error } = await sb.from('members')
    .select(`
      member_id, full_name, email, member_type, member_tier, investor_status,
      classification_reason, classification_updated_at, classification_version,
      email_verified, sms_verified, kyc_status, registration_status,
      created_at
    `)
    .eq('member_id', memberId)
    .single();

  if (error || !member) {
    return ownerOnlyJson({ ok: false, error: 'Member not found' }, 404);
  }

  const { data: summary } = await sb.from('member_financial_summary')
    .select('*')
    .eq('member_id', memberId)
    .single();

  return ownerOnlyJson({
    ok: true,
    member: {
      member_id: member.member_id,
      full_name: member.full_name,
      email: member.email,
      member_type: member.member_type,
      member_tier: member.member_tier || 'PENDING',
      investor_status: member.investor_status || 'NOT_VERIFIED',
      classification_reason: member.classification_reason || null,
      classification_updated_at: member.classification_updated_at || null,
      classification_version: member.classification_version || null,
      email_verified: member.email_verified,
      sms_verified: member.sms_verified,
      kyc_status: member.kyc_status || 'not_started',
      registration_status: member.registration_status || 'pending',
      created_at: member.created_at,
    },
    financial_summary: summary || null,
  });
}

// ── POST /api/ivx/classification/classify/:memberId ──

export async function handleClassifyMember(
  request: Request,
  memberId: string,
): Promise<Response> {
  await assertIVXOwnerOnly(request);
  const result = await classifyMember(memberId);
  return ownerOnlyJson(result, result.ok ? 200 : 400);
}

// ── POST /api/ivx/classification/reconcile ──

export async function handleReconcileAll(request: Request): Promise<Response> {
  await assertIVXOwnerOnly(request);
  const result = await reconcileAllMembers();
  return ownerOnlyJson(result, result.ok ? 200 : 500);
}

// ── POST /api/ivx/classification/override ──

export async function handleManualOverride(request: Request): Promise<Response> {
  const ctx = await assertIVXOwnerOnly(request);
  const body = await parseBody(request);

  const input: ManualOverrideInput = {
    member_id: asString(body.member_id),
    target_tier: asString(body.target_tier) as MemberTier,
    reason: asString(body.reason),
    evidence_url: asString(body.evidence_url),
    expiration_date: asString(body.expiration_date),
    actor: ctx.email || ctx.userId || 'owner',
    second_review_required: Boolean(body.second_review_required),
  };

  if (!input.member_id || !input.target_tier) {
    return ownerOnlyJson({ ok: false, error: 'member_id and target_tier required' }, 400);
  }

  const result = await applyManualOverride(input);
  return ownerOnlyJson(result, result.ok ? 200 : 400);
}

// ── GET /api/ivx/classification/audit/:memberId ──

export async function handleGetAuditTrail(
  request: Request,
  memberId: string,
): Promise<Response> {
  await assertIVXOwnerOnly(request);
  const sb = getSB();

  const { data: auditEvents, error } = await sb.from('classification_audit')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return ownerOnlyJson({ ok: false, error: error.message }, 500);
  }

  return ownerOnlyJson({
    ok: true,
    member_id: memberId,
    audit_events: auditEvents || [],
    total: auditEvents?.length || 0,
  });
}

// ── POST /api/ivx/classification/ia-query ──

export async function handleIAQuery(request: Request): Promise<Response> {
  await assertIVXOwnerOnly(request);
  const body = await parseBody(request);

  const query: IAClassificationQuery = {
    question: asString(body.question),
    member_id: asString(body.member_id) || undefined,
    is_this_person_a_real_investor: Boolean(body.is_this_person_a_real_investor),
    is_this_person_vip: Boolean(body.is_this_person_vip),
  };

  const result = await answerClassificationQuery(query);
  return ownerOnlyJson({ ok: true, result });
}

// ── GET /api/ivx/classification/financial/:memberId ──

export async function handleGetFinancialSummary(
  request: Request,
  memberId: string,
): Promise<Response> {
  await assertIVXOwnerOnly(request);
  const sb = getSB();

  const { data: summary, error } = await sb.from('member_financial_summary')
    .select('*')
    .eq('member_id', memberId)
    .single();

  if (error || !summary) {
    return ownerOnlyJson({ ok: false, error: 'Financial summary not found' }, 404);
  }

  // Format amounts for display (cents → dollars)
  const formatCents = (cents: number) => `$${(cents / 100).toLocaleString()}`;

  return ownerOnlyJson({
    ok: true,
    member_id: memberId,
    summary: {
      completed_transactions: summary.completed_transactions,
      lifetime_settled_investment: summary.lifetime_settled_investment,
      lifetime_settled_display: formatCents(summary.lifetime_settled_investment),
      current_active_principal: summary.current_active_principal,
      current_active_display: formatCents(summary.current_active_principal),
      committed_capital: summary.committed_capital,
      committed_display: formatCents(summary.committed_capital),
      pending_capital: summary.pending_capital,
      pending_display: formatCents(summary.pending_capital),
      refunded_principal: summary.refunded_principal,
      refunded_display: formatCents(summary.refunded_principal),
      cancelled_capital: summary.cancelled_capital,
      cancelled_display: formatCents(summary.cancelled_capital),
      distributed_amount: summary.distributed_amount,
      distributed_display: formatCents(summary.distributed_amount),
      qualifying_invested_capital: summary.qualifying_invested_capital,
      qualifying_display: formatCents(summary.qualifying_invested_capital),
      largest_completed_transaction: summary.largest_completed_transaction,
      largest_display: formatCents(summary.largest_completed_transaction),
      last_completed_transaction_at: summary.last_completed_transaction_at,
      calculated_at: summary.calculated_at,
    },
  });
}

// ── Member-facing: GET /api/members/classification ──
// Returns the calling member's OWN classification (no financial details)

export async function handleMemberSelfClassification(request: Request): Promise<Response> {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const sb = getSB();
  const { data: { user }, error: authError } = await sb.auth.getUser(match[1]);
  if (authError || !user) {
    return json({ ok: false, error: 'Invalid token' }, 403);
  }

  // Find canonical member by auth_user_id
  const { data: member, error: memberErr } = await sb.from('members')
    .select('member_id, member_tier, investor_status, classification_reason, classification_updated_at')
    .eq('auth_user_id', user.id)
    .single();

  if (memberErr || !member) {
    return json({ ok: false, error: 'Member record not found' }, 404);
  }

  // Return ONLY tier + status (no financial details, no sensitive data)
  return json({
    ok: true,
    classification: {
      member_tier: member.member_tier || 'PENDING',
      investor_status: member.investor_status || 'NOT_VERIFIED',
      classification_reason: member.classification_reason || null,
      classification_updated_at: member.classification_updated_at || null,
    },
  });
}

export function memberClassificationOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
    },
  });
}