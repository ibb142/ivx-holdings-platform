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

/** Wrap assertIVXOwnerOnly so unauthenticated requests get a clean 401/403 JSON. */
async function requireOwner(request: Request): Promise<Response | null> {
  try {
    await assertIVXOwnerOnly(request);
    return null;
  } catch (err: unknown) {
    const message = err instanceof Error ? (err instanceof Error ? err.message : String(err)) : 'IVX owner authentication required.';
    const status = /required|missing|unauthorized|invalid|no bearer/i.test(message) ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message }, status);
  }
}

// ── GET /api/ivx/classification/dashboard ──

export async function handleClassificationDashboard(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const totals = await getOwnerDashboardTotals();
  return ownerOnlyJson({ ok: true, marker: CLASSIFICATION_MARKER, totals });
}

// ── GET /api/ivx/classification/member/:memberId ──

export async function handleGetMemberClassification(
  request: Request,
  memberId: string,
): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
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
  const denied = await requireOwner(request);
  if (denied) return denied;
  const result = await classifyMember(memberId);
  return ownerOnlyJson(result as unknown as Record<string, unknown>, result.ok ? 200 : 400);
}

// ── POST /api/ivx/classification/reconcile ──

export async function handleReconcileAll(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const result = await reconcileAllMembers();
  return ownerOnlyJson(result as unknown as Record<string, unknown>, result.ok ? 200 : 500);
}

// ── POST /api/ivx/classification/override ──

export async function handleManualOverride(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const body = await parseBody(request);
  const actor = 'owner'; // ctx not available after requireOwner pattern

  const input: ManualOverrideInput = {
    member_id: asString(body.member_id),
    target_tier: asString(body.target_tier) as MemberTier,
    reason: asString(body.reason),
    evidence_url: asString(body.evidence_url),
    expiration_date: asString(body.expiration_date),
    actor: asString(body.actor) || 'owner',
    second_review_required: Boolean(body.second_review_required),
  };

  if (!input.member_id || !input.target_tier) {
    return ownerOnlyJson({ ok: false, error: 'member_id and target_tier required' }, 400);
  }

  const result = await applyManualOverride(input);
  return ownerOnlyJson(result as unknown as Record<string, unknown>, result.ok ? 200 : 400);
}

// ── GET /api/ivx/classification/audit/:memberId ──

export async function handleGetAuditTrail(
  request: Request,
  memberId: string,
): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
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
  const denied = await requireOwner(request);
  if (denied) return denied;
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
  const denied = await requireOwner(request);
  if (denied) return denied;
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

  // If the canonical member row doesn't exist yet (e.g. upsertCanonicalMember
  // failed non-fatally during registration), return a default PENDING
  // classification instead of 404 — the auth user is verified valid above.
  const tier = member?.member_tier || 'PENDING';
  const investorStatus = member?.investor_status || 'NOT_VERIFIED';
  const reason = member?.classification_reason || null;
  const updatedAt = member?.classification_updated_at || null;

  // Return ONLY tier + status (no financial details, no sensitive data)
  return json({
    ok: true,
    classification: {
      member_tier: tier,
      investor_status: investorStatus,
      classification_reason: reason,
      classification_updated_at: updatedAt,
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

// ── POST /api/ivx/classification/run-migration ──
// Owner-only: executes the classification system migration SQL against Supabase.

export async function handleRunMigration(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;

  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
  if (!supabaseUrl || !serviceKey) {
    return ownerOnlyJson({
      ok: false,
      error: 'Supabase not configured (missing URL or service role key)',
    }, 500);
  }

  const migrationSql = `-- Migration: member_classification_system
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='member_tier') THEN
    ALTER TABLE public.members ADD COLUMN member_tier text DEFAULT 'PENDING';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='investor_status') THEN
    ALTER TABLE public.members ADD COLUMN investor_status text DEFAULT 'NOT_VERIFIED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='onboarding_phase') THEN
    ALTER TABLE public.members ADD COLUMN onboarding_phase text DEFAULT 'registration';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='classification_updated_at') THEN
    ALTER TABLE public.members ADD COLUMN classification_updated_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='classification_reason') THEN
    ALTER TABLE public.members ADD COLUMN classification_reason text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='members' AND column_name='classification_version') THEN
    ALTER TABLE public.members ADD COLUMN classification_version text;
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS public.investor_profiles (
  id text PRIMARY KEY DEFAULT ('invp_' || gen_random_uuid()::text),
  member_id text NOT NULL,
  kyc_status text NOT NULL DEFAULT 'not_started',
  tax_status text NOT NULL DEFAULT 'not_started',
  compliance_status text NOT NULL DEFAULT 'not_started',
  investor_agreement_at timestamptz,
  approved_at timestamptz,
  restricted_at timestamptz,
  restricted_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_investor_profiles_member_id ON public.investor_profiles (member_id);
CREATE TABLE IF NOT EXISTS public.member_financial_summary (
  member_id text PRIMARY KEY,
  completed_transactions integer NOT NULL DEFAULT 0,
  lifetime_settled_investment bigint NOT NULL DEFAULT 0,
  current_active_principal bigint NOT NULL DEFAULT 0,
  committed_capital bigint NOT NULL DEFAULT 0,
  pending_capital bigint NOT NULL DEFAULT 0,
  refunded_principal bigint NOT NULL DEFAULT 0,
  cancelled_capital bigint NOT NULL DEFAULT 0,
  distributed_amount bigint NOT NULL DEFAULT 0,
  qualifying_invested_capital bigint NOT NULL DEFAULT 0,
  largest_completed_transaction bigint NOT NULL DEFAULT 0,
  last_completed_transaction_at timestamptz,
  calculated_at timestamptz NOT NULL DEFAULT now()
);
-- The transactions table already exists in production with user_id.
-- Add classification columns via ALTER TABLE instead of CREATE TABLE.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='member_id') THEN
    ALTER TABLE public.transactions ADD COLUMN member_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='offering_id') THEN
    ALTER TABLE public.transactions ADD COLUMN offering_id text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='currency') THEN
    ALTER TABLE public.transactions ADD COLUMN currency text NOT NULL DEFAULT 'USD';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='settled_at') THEN
    ALTER TABLE public.transactions ADD COLUMN settled_at timestamptz;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='refunded_amount') THEN
    ALTER TABLE public.transactions ADD COLUMN refunded_amount bigint NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='external_reference') THEN
    ALTER TABLE public.transactions ADD COLUMN external_reference text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='source') THEN
    ALTER TABLE public.transactions ADD COLUMN source text NOT NULL DEFAULT 'system';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='is_test') THEN
    ALTER TABLE public.transactions ADD COLUMN is_test boolean NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='idempotency_key') THEN
    ALTER TABLE public.transactions ADD COLUMN idempotency_key text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='transactions' AND column_name='updated_at') THEN
    ALTER TABLE public.transactions ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_transactions_member_id ON public.transactions (member_id);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON public.transactions (status);
CREATE TABLE IF NOT EXISTS public.classification_audit (
  id bigserial PRIMARY KEY,
  member_id text NOT NULL,
  previous_tier text,
  new_tier text NOT NULL,
  previous_investor_status text,
  new_investor_status text,
  reason text NOT NULL,
  qualifying_total_before bigint,
  qualifying_total_after bigint,
  actor text NOT NULL DEFAULT 'automatic',
  trace_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_classification_audit_member_id ON public.classification_audit (member_id);
`;

  // Split migration into individual statements — ivx_exec_sql may not handle multi-statement DO blocks well.
  // We send the entire migration as one SQL text since the RPC wraps it in a transaction.
  const statements = splitMigrationStatements(migrationSql);
  const errors: string[] = [];
  let executed = 0;

  try {
    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      if (!stmt.trim()) continue;
      const resp = await fetch(`${supabaseUrl}/rest/v1/rpc/ivx_exec_sql`, {
        method: 'POST',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql_text: stmt }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        errors.push(`Statement ${i + 1}/${statements.length}: ${text.slice(0, 200)}`);
      } else {
        executed++;
      }
    }

    if (errors.length > 0) {
      return ownerOnlyJson({
        ok: false,
        error: `Migration partially failed: ${errors.length} statement(s) failed`,
        details: errors.slice(0, 5),
        executed,
        total: statements.length,
        hint: 'Check error details. Some statements may fail idempotently (e.g. IF NOT EXISTS on already-existing objects).',
        migration_file: 'backend/supabase/migrations/20260728080000_member_classification_system.sql',
      }, 500);
    }
    return ownerOnlyJson({
      ok: true,
      message: 'Migration applied successfully',
      statements_executed: executed,
    });
  } catch (err: unknown) {
    return ownerOnlyJson({
      ok: false,
      error: (err instanceof Error ? err.message : String(err)),
      hint: 'Run the migration SQL directly in Supabase SQL Editor',
      migration_file: 'backend/supabase/migrations/20260728080000_member_classification_system.sql',
    }, 500);
  }
}

/** Split a multi-statement SQL string into individual executable statements. */
function splitMigrationStatements(sql: string): string[] {
  // Split on semicolons that are not inside DO $$ ... $$ blocks or string literals
  const statements: string[] = [];
  let current = '';
  let inDollarBlock = false;
  let dollarTag = '';
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextTwo = sql.slice(i, i + 2);

    if (!inDollarBlock && !inString && char === "'" && sql[i - 1] !== '\\') {
      inString = true;
      current += char;
      continue;
    }
    if (inString && char === "'" && sql[i - 1] !== '\\') {
      inString = false;
      current += char;
      continue;
    }

    if (!inString && nextTwo.startsWith('$$')) {
      if (!inDollarBlock) {
        inDollarBlock = true;
        dollarTag = '$$';
        current += '$$';
        i++;
        continue;
      } else if (inDollarBlock && dollarTag === '$$') {
        inDollarBlock = false;
        dollarTag = '';
        current += '$$';
        i++;
        continue;
      }
    }

    if (!inDollarBlock && !inString && char === ';') {
      current += ';';
      if (current.trim()) statements.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}
