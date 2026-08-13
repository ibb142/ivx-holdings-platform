/**
 * IVX Platform Extensions API
 *
 * Covers Points 5-8 of the IVX execution plan:
 * - Point 5: Owner system (profiles, holdings, income/expenses, documents, portfolio dashboard)
 * - Point 6: Compliance workflow (workflow steps, consents, role permissions, sanctions)
 * - Point 7: Payments (payment records, fee structures, reconciliation, multi-currency)
 * - Point 8: Global core (languages, timezones, tax rules, pilot markets)
 *
 * Endpoints registered in hono.ts:
 *   OWNER SYSTEM (Point 5)
 *   - GET  /api/ivx/owner/profile           — get or create owner profile
 *   - PUT  /api/ivx/owner/profile           — update owner profile
 *   - GET  /api/ivx/owner/holdings           — list holdings
 *   - POST /api/ivx/owner/holdings           — create holding
 *   - PUT  /api/ivx/owner/holdings/:id       — update holding
 *   - GET  /api/ivx/owner/income-expenses    — list income/expenses
 *   - POST /api/ivx/owner/income-expenses    — add income/expense entry
 *   - GET  /api/ivx/owner/documents          — list documents
 *   - POST /api/ivx/owner/documents          — upload document metadata
 *   - GET  /api/ivx/owner/portfolio          — portfolio dashboard
 *   - GET  /api/ivx/owner/portfolio/snapshots — portfolio snapshots
 *
 *   COMPLIANCE (Point 6)
 *   - GET  /api/ivx/compliance/workflow      — list workflow steps
 *   - POST /api/ivx/compliance/workflow      — create workflow step
 *   - PUT  /api/ivx/compliance/workflow/:id  — update workflow step (review)
 *   - GET  /api/ivx/compliance/consents      — list consents
 *   - POST /api/ivx/compliance/consents       — record consent
 *   - GET  /api/ivx/compliance/permissions    — list role permissions
 *
 *   PAYMENTS (Point 7)
 *   - GET  /api/ivx/payments/records          — list payment records
 *   - POST /api/ivx/payments/records          — create payment record
 *   - GET  /api/ivx/payments/fees             — list fee structures
 *   - POST /api/ivx/payments/fees             — create fee structure
 *   - GET  /api/ivx/payments/reconciliation   — list reconciliation records
 *   - POST /api/ivx/payments/reconciliation    — create reconciliation record
 *
 *   GLOBAL CORE (Point 8)
 *   - GET  /api/ivx/global/languages          — list languages
 *   - GET  /api/ivx/global/timezones          — list timezones
 *   - GET  /api/ivx/global/tax-rules          — list tax rules
 *
 *   PILOT MARKET (Point 10)
 *   - GET  /api/ivx/pilot/markets             — list pilot markets
 *   - POST /api/ivx/pilot/markets             — create pilot market
 *   - PUT  /api/ivx/pilot/markets/:id         — update pilot market
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const DEPLOYMENT_MARKER = 'ivx-platform-extensions-v1-2026-08-13';

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
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function genTraceId(): string {
  return `ext-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

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

async function verifyOwner(authHeader: string | null | undefined): Promise<{ userId: string; email: string; role: string } | null> {
  const user = await verifyBearer(authHeader);
  if (!user) return null;
  if (user.role !== 'owner' && user.role !== 'admin') return null;
  return { userId: user.userId, email: user.email, role: user.role };
}

async function recordAudit(sb: SupabaseClient, entry: {
  user_id?: string;
  action: string;
  entity_type?: string;
  entity_id?: string;
  entity_name?: string;
  details?: Record<string, unknown>;
  severity?: string;
  category?: string;
}): Promise<void> {
  try {
    await sb.from('ivx_re_audit_trail').insert({
      user_id: entry.user_id || null,
      action: entry.action,
      entity_type: entry.entity_type || null,
      entity_id: entry.entity_id || null,
      entity_name: entry.entity_name || null,
      details: entry.details || {},
      severity: entry.severity || 'info',
      category: entry.category || 'platform',
    });
  } catch {
    // best-effort
  }
}

// ============================================================================
// POINT 5: OWNER PROFILE — GET/CREATE
// ============================================================================
export async function handleOwnerProfileGet(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const { data: profile, error } = await sb
    .from('ivx_re_owner_profiles')
    .select('*')
    .eq('user_id', user.userId)
    .single();

  if (error && error.code !== 'PGRST116') {
    return json({ ok: false, error: 'Profile lookup failed', details: error.message }, 500);
  }

  if (profile) {
    return json({ ok: true, profile, traceId: genTraceId() });
  }

  // Auto-create a profile for the user
  const { data: newProfile, error: createErr } = await sb
    .from('ivx_re_owner_profiles')
    .insert({
      user_id: user.userId,
      display_name: user.fullName || user.email,
      entity_type: 'individual',
    })
    .select('*')
    .single();

  if (createErr) {
    return json({ ok: false, error: 'Profile creation failed', details: createErr.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'owner_profile_created',
    entity_type: 'owner_profile',
    entity_id: newProfile.id,
    details: { email: user.email },
  });

  return json({ ok: true, profile: newProfile, traceId: genTraceId() });
}

// ============================================================================
// POINT 5: OWNER PROFILE — UPDATE
// ============================================================================
export async function handleOwnerProfileUpdate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  const allowedFields = [
    'display_name', 'legal_name', 'entity_type', 'phone', 'address_line1',
    'address_line2', 'city', 'state_province', 'postal_code', 'country_iso',
    'preferred_language', 'preferred_currency', 'preferred_timezone',
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return json({ ok: false, error: 'No valid fields to update' }, 400);
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_owner_profiles')
    .update(updates)
    .eq('user_id', user.userId)
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Profile update failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'owner_profile_updated',
    entity_type: 'owner_profile',
    entity_id: data?.id,
    details: { fields: Object.keys(updates) },
  });

  return json({ ok: true, profile: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 5: OWNER HOLDINGS — LIST
// ============================================================================
export async function handleOwnerHoldingsList(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('id')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: true, holdings: [], traceId: genTraceId() });
  }

  const url = new URL(raw.url);
  const status = url.searchParams.get('status') || undefined;

  let query = sb
    .from('ivx_re_owner_holdings')
    .select('*')
    .eq('owner_profile_id', ownerProfile.id)
    .order('created_at', { ascending: false });

  if (status) query = query.eq('status', status);

  const { data: holdings, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Holdings lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, holdings: holdings || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 5: OWNER HOLDINGS — CREATE
// ============================================================================
export async function handleOwnerHoldingsCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.property_title || !body.acquisition_date || body.acquisition_price == null) {
    return json({ ok: false, error: 'property_title, acquisition_date, and acquisition_price are required' }, 400);
  }

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('id')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: false, error: 'Owner profile not found. Create your profile first.' }, 404);
  }

  const insertData: Record<string, unknown> = {
    owner_profile_id: ownerProfile.id,
    property_title: body.property_title,
    acquisition_date: body.acquisition_date,
    acquisition_price: body.acquisition_price,
    currency_code: body.currency_code || 'USD',
    current_value: body.current_value ?? body.acquisition_price,
    outstanding_mortgage: body.outstanding_mortgage ?? 0,
    ownership_percentage: body.ownership_percentage ?? 100,
    annual_rental_income: body.annual_rental_income ?? 0,
    annual_expenses: body.annual_expenses ?? 0,
    listing_id: body.listing_id ?? null,
    cap_rate: body.cap_rate ?? null,
    cash_on_cash_return: body.cash_on_cash_return ?? null,
    notes: body.notes ?? null,
  };

  const { data, error } = await sb
    .from('ivx_re_owner_holdings')
    .insert(insertData)
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Holding creation failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'holding_created',
    entity_type: 'owner_holding',
    entity_id: data?.id,
    details: { property_title: body.property_title },
  });

  return json({ ok: true, holding: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 5: OWNER HOLDINGS — UPDATE
// ============================================================================
export async function handleOwnerHoldingsUpdate(raw: Request, holdingId: string): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  const allowedFields = [
    'property_title', 'current_value', 'outstanding_mortgage', 'ownership_percentage',
    'annual_rental_income', 'annual_expenses', 'cap_rate', 'cash_on_cash_return',
    'status', 'is_listed_for_sale', 'notes', 'acquisition_price', 'currency_code',
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return json({ ok: false, error: 'No valid fields to update' }, 400);
  }

  if ('current_value' in updates) {
    updates.current_value_updated = new Date().toISOString();
  }

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('id')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: false, error: 'Owner profile not found' }, 404);
  }

  const { data, error } = await sb
    .from('ivx_re_owner_holdings')
    .update(updates)
    .eq('id', holdingId)
    .eq('owner_profile_id', ownerProfile.id)
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Holding update failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'holding_updated',
    entity_type: 'owner_holding',
    entity_id: holdingId,
    details: { fields: Object.keys(updates) },
  });

  return json({ ok: true, holding: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 5: INCOME / EXPENSES — LIST
// ============================================================================
export async function handleOwnerIncomeExpensesList(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('id')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: true, entries: [], traceId: genTraceId() });
  }

  const url = new URL(raw.url);
  const entryType = url.searchParams.get('type') || undefined;
  const holdingId = url.searchParams.get('holdingId') || undefined;
  const startDate = url.searchParams.get('startDate') || undefined;
  const endDate = url.searchParams.get('endDate') || undefined;

  let query = sb
    .from('ivx_re_owner_income_expenses')
    .select('*')
    .eq('owner_profile_id', ownerProfile.id)
    .order('entry_date', { ascending: false });

  if (entryType) query = query.eq('entry_type', entryType);
  if (holdingId) query = query.eq('holding_id', holdingId);
  if (startDate) query = query.gte('entry_date', startDate);
  if (endDate) query = query.lte('entry_date', endDate);

  const { data: entries, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Income/expense lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, entries: entries || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 5: INCOME / EXPENSES — CREATE
// ============================================================================
export async function handleOwnerIncomeExpensesCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.entry_type || !body.category || body.amount == null) {
    return json({ ok: false, error: 'entry_type, category, and amount are required' }, 400);
  }

  if (!['income', 'expense'].includes(body.entry_type as string)) {
    return json({ ok: false, error: 'entry_type must be "income" or "expense"' }, 400);
  }

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('id')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: false, error: 'Owner profile not found' }, 404);
  }

  const { data, error } = await sb
    .from('ivx_re_owner_income_expenses')
    .insert({
      owner_profile_id: ownerProfile.id,
      holding_id: body.holding_id ?? null,
      entry_type: body.entry_type,
      category: body.category,
      description: body.description ?? null,
      amount: body.amount,
      currency_code: body.currency_code || 'USD',
      entry_date: body.entry_date || new Date().toISOString().slice(0, 10),
      recurring: body.recurring ?? false,
      recurrence_pattern: body.recurrence_pattern ?? null,
      receipt_url: body.receipt_url ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Entry creation failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'income_expense_created',
    entity_type: 'income_expense',
    entity_id: data?.id,
    details: { entry_type: body.entry_type, amount: body.amount, category: body.category },
  });

  return json({ ok: true, entry: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 5: OWNER DOCUMENTS — LIST
// ============================================================================
export async function handleOwnerDocumentsList(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('id')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: true, documents: [], traceId: genTraceId() });
  }

  const url = new URL(raw.url);
  const docType = url.searchParams.get('type') || undefined;
  const holdingId = url.searchParams.get('holdingId') || undefined;

  let query = sb
    .from('ivx_re_owner_documents')
    .select('*')
    .eq('owner_profile_id', ownerProfile.id)
    .order('created_at', { ascending: false });

  if (docType) query = query.eq('document_type', docType);
  if (holdingId) query = query.eq('holding_id', holdingId);

  const { data: documents, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Document lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, documents: documents || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 5: OWNER DOCUMENTS — CREATE METADATA
// ============================================================================
export async function handleOwnerDocumentsCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.document_type || !body.title || !body.file_url) {
    return json({ ok: false, error: 'document_type, title, and file_url are required' }, 400);
  }

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('id')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: false, error: 'Owner profile not found' }, 404);
  }

  const { data, error } = await sb
    .from('ivx_re_owner_documents')
    .insert({
      owner_profile_id: ownerProfile.id,
      holding_id: body.holding_id ?? null,
      document_type: body.document_type,
      title: body.title,
      description: body.description ?? null,
      file_url: body.file_url,
      file_size_bytes: body.file_size_bytes ?? null,
      mime_type: body.mime_type ?? null,
      uploaded_by: user.userId,
      tags: body.tags ?? [],
      expiry_date: body.expiry_date ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Document creation failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'document_uploaded',
    entity_type: 'owner_document',
    entity_id: data?.id,
    details: { document_type: body.document_type, title: body.title },
  });

  return json({ ok: true, document: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 5: PORTFOLIO DASHBOARD
// ============================================================================
export async function handleOwnerPortfolio(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('*')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: false, error: 'Owner profile not found' }, 404);
  }

  const { data: holdings } = await sb
    .from('ivx_re_owner_holdings')
    .select('*')
    .eq('owner_profile_id', ownerProfile.id)
    .eq('status', 'active')
    .order('current_value', { ascending: false });

  const { data: recentIncome } = await sb
    .from('ivx_re_owner_income_expenses')
    .select('*')
    .eq('owner_profile_id', ownerProfile.id)
    .order('entry_date', { ascending: false })
    .limit(20);

  const totalValue = (holdings || []).reduce((sum: number, h: { current_value?: number }) => sum + (h.current_value || 0), 0);
  const totalMortgage = (holdings || []).reduce((sum: number, h: { outstanding_mortgage?: number }) => sum + (h.outstanding_mortgage || 0), 0);
  const totalEquity = totalValue - totalMortgage;
  const totalRentalIncome = (holdings || []).reduce((sum: number, h: { annual_rental_income?: number }) => sum + (h.annual_rental_income || 0), 0);
  const totalExpenses = (holdings || []).reduce((sum: number, h: { annual_expenses?: number }) => sum + (h.annual_expenses || 0), 0);
  const totalCashFlow = totalRentalIncome - totalExpenses;
  const blendedCapRate = totalValue > 0 ? (totalRentalIncome / totalValue) * 100 : 0;
  const cashOnCash = (totalMortgage + totalExpenses) > 0 ? (totalCashFlow / (totalMortgage + totalExpenses)) * 100 : 0;

  const allocationByType: Record<string, number> = {};
  const allocationByCountry: Record<string, number> = {};
  for (const h of (holdings || [])) {
    const holding = h as { property_title?: string; current_value?: number };
    const type = (h as { property_type?: string })?.property_type || 'unknown';
    allocationByType[type] = (allocationByType[type] || 0) + (holding.current_value || 0);
  }

  return json({
    ok: true,
    portfolio: {
      owner: ownerProfile,
      summary: {
        total_properties: (holdings || []).length,
        total_holdings_value: totalValue,
        total_outstanding_mortgage: totalMortgage,
        total_equity: totalEquity,
        total_annual_rental_income: totalRentalIncome,
        total_annual_expenses: totalExpenses,
        total_annual_net_cash_flow: totalCashFlow,
        blended_cap_rate: parseFloat(blendedCapRate.toFixed(2)),
        cash_on_cash_return: parseFloat(cashOnCash.toFixed(2)),
      },
      holdings: holdings || [],
      recent_transactions: recentIncome || [],
      allocation_by_type: allocationByType,
      allocation_by_country: allocationByCountry,
    },
    traceId: genTraceId(),
  });
}

// ============================================================================
// POINT 5: PORTFOLIO SNAPSHOTS
// ============================================================================
export async function handleOwnerPortfolioSnapshots(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const { data: ownerProfile } = await sb
    .from('ivx_re_owner_profiles')
    .select('id')
    .eq('user_id', user.userId)
    .single();

  if (!ownerProfile) {
    return json({ ok: true, snapshots: [], traceId: genTraceId() });
  }

  const { data: snapshots, error } = await sb
    .from('ivx_re_portfolio_snapshots')
    .select('*')
    .eq('owner_profile_id', ownerProfile.id)
    .order('snapshot_date', { ascending: false })
    .limit(30);

  if (error) {
    return json({ ok: false, error: 'Snapshot lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, snapshots: snapshots || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 6: COMPLIANCE WORKFLOW — LIST
// ============================================================================
export async function handleComplianceWorkflowList(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const url = new URL(raw.url);
  const status = url.searchParams.get('status') || undefined;
  const transactionId = url.searchParams.get('transactionId') || undefined;

  // Admin/compliance officer can see all; others see their own
  const isAdmin = user.role === 'admin' || user.role === 'compliance_officer';

  let query = sb.from('ivx_re_compliance_workflow').select('*');

  if (!isAdmin) {
    const { data: ownerProfile } = await sb
      .from('ivx_re_owner_profiles')
      .select('id')
      .eq('user_id', user.userId)
      .single();
    if (ownerProfile) {
      query = query.eq('owner_profile_id', ownerProfile.id);
    }
  }

  if (status) query = query.eq('status', status);
  if (transactionId) query = query.eq('transaction_id', transactionId);

  query = query.order('sort_order', { ascending: true });

  const { data: steps, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Workflow lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, steps: steps || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 6: COMPLIANCE WORKFLOW — CREATE
// ============================================================================
export async function handleComplianceWorkflowCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyOwner(auth);
  if (!user) return json({ ok: false, error: 'Admin or owner access required' }, 403);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.step_name || !body.step_type || !body.owner_profile_id) {
    return json({ ok: false, error: 'step_name, step_type, and owner_profile_id are required' }, 400);
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_compliance_workflow')
    .insert({
      owner_profile_id: body.owner_profile_id,
      transaction_id: body.transaction_id ?? null,
      step_name: body.step_name,
      step_type: body.step_type,
      status: body.status || 'pending',
      assigned_to: body.assigned_to ?? null,
      assigned_role: body.assigned_role ?? null,
      due_date: body.due_date ?? null,
      sort_order: body.sort_order ?? 0,
    })
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Workflow step creation failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'compliance_step_created',
    entity_type: 'compliance_workflow',
    entity_id: data?.id,
    details: { step_name: body.step_name, step_type: body.step_type },
    severity: 'info',
    category: 'compliance',
  });

  return json({ ok: true, step: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 6: COMPLIANCE WORKFLOW — REVIEW / UPDATE
// ============================================================================
export async function handleComplianceWorkflowReview(raw: Request, stepId: string): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  const canReview = user.role === 'admin' || user.role === 'compliance_officer' || user.role === 'owner';
  if (!canReview) {
    return json({ ok: false, error: 'Insufficient permissions to review compliance steps' }, 403);
  }

  const allowedFields = [
    'status', 'review_notes', 'review_decision', 'risk_score', 'risk_factors',
    'evidence_urls', 'started_at', 'completed_at', 'due_date',
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  if (updates.status === 'completed' && !updates.completed_at) {
    updates.completed_at = new Date().toISOString();
  }
  if (updates.status === 'in_progress' && !updates.started_at) {
    updates.started_at = new Date().toISOString();
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_compliance_workflow')
    .update(updates)
    .eq('id', stepId)
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Workflow step update failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'compliance_step_reviewed',
    entity_type: 'compliance_workflow',
    entity_id: stepId,
    details: { status: updates.status, decision: updates.review_decision },
    severity: updates.status === 'rejected' ? 'warning' : 'info',
    category: 'compliance',
  });

  return json({ ok: true, step: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 6: CONSENTS — LIST
// ============================================================================
export async function handleConsentsList(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const { data: consents, error } = await sb
    .from('ivx_re_consents')
    .select('*')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false });

  if (error) {
    return json({ ok: false, error: 'Consents lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, consents: consents || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 6: CONSENTS — RECORD
// ============================================================================
export async function handleConsentsCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.consent_type || !body.consent_text || !body.consent_version) {
    return json({ ok: false, error: 'consent_type, consent_text, and consent_version are required' }, 400);
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_consents')
    .insert({
      user_id: user.userId,
      consent_type: body.consent_type,
      consent_text: body.consent_text,
      consent_version: body.consent_version,
      is_granted: body.is_granted ?? true,
      ip_address: raw.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null,
      user_agent: raw.headers.get('user-agent') || null,
      jurisdiction: body.jurisdiction ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Consent recording failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'consent_recorded',
    entity_type: 'consent',
    entity_id: data?.id,
    details: { consent_type: body.consent_type, is_granted: body.is_granted ?? true },
    severity: 'info',
    category: 'compliance',
  });

  return json({ ok: true, consent: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 6: ROLE PERMISSIONS — LIST
// ============================================================================
export async function handlePermissionsList(raw: Request): Promise<Response> {
  const sb = getSB();
  const url = new URL(raw.url);
  const role = url.searchParams.get('role') || undefined;

  let query = sb.from('ivx_re_role_permissions').select('*').order('role', { ascending: true });

  if (role) query = query.eq('role', role);

  const { data: permissions, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Permissions lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, permissions: permissions || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 7: PAYMENT RECORDS — LIST
// ============================================================================
export async function handlePaymentRecordsList(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const sb = getSB();
  const url = new URL(raw.url);
  const status = url.searchParams.get('status') || undefined;
  const provider = url.searchParams.get('provider') || undefined;

  let query = sb.from('ivx_re_payment_records').select('*');

  // Non-admin users can only see their own payments
  if (user.role !== 'admin' && user.role !== 'owner') {
    const { data: ownerProfile } = await sb
      .from('ivx_re_owner_profiles')
      .select('id')
      .eq('user_id', user.userId)
      .single();
    if (ownerProfile) {
      query = query.eq('owner_profile_id', ownerProfile.id);
    }
  }

  if (status) query = query.eq('status', status);
  if (provider) query = query.eq('provider', provider);

  query = query.order('created_at', { ascending: false }).limit(50);

  const { data: records, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Payment records lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, records: records || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 7: PAYMENT RECORDS — CREATE
// ============================================================================
export async function handlePaymentRecordsCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyBearer(auth);
  if (!user) return json({ ok: false, error: 'Authentication required' }, 401);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.payment_type || !body.provider || body.amount == null) {
    return json({ ok: false, error: 'payment_type, provider, and amount are required' }, 400);
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_payment_records')
    .insert({
      transaction_id: body.transaction_id ?? null,
      escrow_id: body.escrow_id ?? null,
      owner_profile_id: body.owner_profile_id ?? null,
      payment_type: body.payment_type,
      provider: body.provider,
      provider_transaction_id: body.provider_transaction_id ?? null,
      amount: body.amount,
      currency_code: body.currency_code || 'USD',
      fee_amount: body.fee_amount ?? 0,
      fee_currency: body.fee_currency ?? null,
      status: body.status || 'pending',
      initiated_by: user.userId,
      metadata: body.metadata ?? {},
    })
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Payment record creation failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'payment_recorded',
    entity_type: 'payment_record',
    entity_id: data?.id,
    details: { payment_type: body.payment_type, provider: body.provider, amount: body.amount },
    severity: 'info',
    category: 'payments',
  });

  return json({ ok: true, record: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 7: FEE STRUCTURES — LIST
// ============================================================================
export async function handleFeeStructuresList(raw: Request): Promise<Response> {
  const sb = getSB();
  const url = new URL(raw.url);
  const feeType = url.searchParams.get('type') || undefined;
  const appliesTo = url.searchParams.get('appliesTo') || undefined;

  let query = sb
    .from('ivx_re_fee_structures')
    .select('*')
    .eq('is_active', true)
    .order('fee_name', { ascending: true });

  if (feeType) query = query.eq('fee_type', feeType);
  if (appliesTo) query = query.eq('applies_to', appliesTo);

  const { data: fees, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Fee structures lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, fees: fees || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 7: FEE STRUCTURES — CREATE
// ============================================================================
export async function handleFeeStructuresCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyOwner(auth);
  if (!user) return json({ ok: false, error: 'Admin or owner access required' }, 403);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.fee_name || !body.fee_type || !body.calculation_method || !body.applies_to) {
    return json({ ok: false, error: 'fee_name, fee_type, calculation_method, and applies_to are required' }, 400);
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_fee_structures')
    .insert({
      fee_name: body.fee_name,
      fee_type: body.fee_type,
      calculation_method: body.calculation_method,
      rate: body.rate ?? null,
      flat_amount: body.flat_amount ?? null,
      currency_code: body.currency_code || 'USD',
      min_amount: body.min_amount ?? null,
      max_amount: body.max_amount ?? null,
      applies_to: body.applies_to,
      jurisdiction_id: body.jurisdiction_id ?? null,
      description: body.description ?? null,
    })
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Fee structure creation failed', details: error.message }, 500);
  }

  return json({ ok: true, fee: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 7: RECONCILIATION — LIST
// ============================================================================
export async function handleReconciliationList(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyOwner(auth);
  if (!user) return json({ ok: false, error: 'Admin or owner access required' }, 403);

  const sb = getSB();
  const { data: records, error } = await sb
    .from('ivx_re_reconciliation')
    .select('*')
    .order('reconciliation_date', { ascending: false })
    .limit(30);

  if (error) {
    return json({ ok: false, error: 'Reconciliation lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, records: records || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 7: RECONCILIATION — CREATE
// ============================================================================
export async function handleReconciliationCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyOwner(auth);
  if (!user) return json({ ok: false, error: 'Admin or owner access required' }, 403);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.provider || !body.period_start || !body.period_end || body.total_expected == null) {
    return json({ ok: false, error: 'provider, period_start, period_end, and total_expected are required' }, 400);
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_reconciliation')
    .insert({
      provider: body.provider,
      period_start: body.period_start,
      period_end: body.period_end,
      total_expected: body.total_expected,
      total_actual: body.total_actual ?? 0,
      matched_count: body.matched_count ?? 0,
      unmatched_count: body.unmatched_count ?? 0,
      notes: body.notes ?? null,
      matched_by: user.userId,
    })
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Reconciliation creation failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'reconciliation_created',
    entity_type: 'reconciliation',
    entity_id: data?.id,
    details: { provider: body.provider, variance: data?.variance },
    category: 'payments',
  });

  return json({ ok: true, record: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 8: LANGUAGES — LIST
// ============================================================================
export async function handleLanguagesList(_raw: Request): Promise<Response> {
  const sb = getSB();
  const { data: languages, error } = await sb
    .from('ivx_re_languages')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    return json({ ok: false, error: 'Languages lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, languages: languages || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 8: TIMEZONES — LIST
// ============================================================================
export async function handleTimezonesList(_raw: Request): Promise<Response> {
  const sb = getSB();
  const { data: timezones, error } = await sb
    .from('ivx_re_timezones')
    .select('*')
    .eq('is_active', true)
    .order('label', { ascending: true });

  if (error) {
    return json({ ok: false, error: 'Timezones lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, timezones: timezones || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 8: TAX RULES — LIST
// ============================================================================
export async function handleTaxRulesList(raw: Request): Promise<Response> {
  const sb = getSB();
  const url = new URL(raw.url);
  const jurisdictionId = url.searchParams.get('jurisdictionId') || undefined;
  const taxType = url.searchParams.get('type') || undefined;

  let query = sb
    .from('ivx_re_tax_rules')
    .select('*')
    .eq('is_active', true)
    .order('tax_type', { ascending: true });

  if (jurisdictionId) query = query.eq('jurisdiction_id', jurisdictionId);
  if (taxType) query = query.eq('tax_type', taxType);

  const { data: rules, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Tax rules lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, taxRules: rules || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 10: PILOT MARKETS — LIST
// ============================================================================
export async function handlePilotMarketsList(_raw: Request): Promise<Response> {
  const sb = getSB();
  const { data: markets, error } = await sb
    .from('ivx_re_pilot_markets')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) {
    return json({ ok: false, error: 'Pilot markets lookup failed', details: error.message }, 500);
  }

  return json({ ok: true, markets: markets || [], traceId: genTraceId() });
}

// ============================================================================
// POINT 10: PILOT MARKETS — CREATE
// ============================================================================
export async function handlePilotMarketsCreate(raw: Request): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyOwner(auth);
  if (!user) return json({ ok: false, error: 'Admin or owner access required' }, 403);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  if (!body.market_name || !body.region_name || !body.city) {
    return json({ ok: false, error: 'market_name, region_name, and city are required' }, 400);
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_pilot_markets')
    .insert({
      market_name: body.market_name,
      country_iso: body.country_iso || 'US',
      region_name: body.region_name,
      city: body.city,
      status: body.status || 'planning',
      launch_date: body.launch_date ?? null,
      target_properties: body.target_properties ?? 10,
      target_brokers: body.target_brokers ?? 3,
    })
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Pilot market creation failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'pilot_market_created',
    entity_type: 'pilot_market',
    entity_id: data?.id,
    details: { market_name: body.market_name, city: body.city },
    category: 'platform',
  });

  return json({ ok: true, market: data, traceId: genTraceId() });
}

// ============================================================================
// POINT 10: PILOT MARKETS — UPDATE
// ============================================================================
export async function handlePilotMarketsUpdate(raw: Request, marketId: string): Promise<Response> {
  const auth = raw.headers.get('authorization') || '';
  const user = await verifyOwner(auth);
  if (!user) return json({ ok: false, error: 'Admin or owner access required' }, 403);

  const body = await raw.json().catch(() => null) as Record<string, unknown> | null;
  if (!body) return json({ ok: false, error: 'Invalid request body' }, 400);

  const allowedFields = [
    'status', 'launch_date', 'target_properties', 'target_brokers',
    'active_properties', 'verified_properties', 'active_brokers',
    'total_offers', 'accepted_offers', 'closed_transactions',
    'total_volume', 'total_revenue', 'avg_days_to_close', 'fraud_incidents',
    'metrics', 'is_active',
  ];

  const updates: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  if (Object.keys(updates).length === 0) {
    return json({ ok: false, error: 'No valid fields to update' }, 400);
  }

  const sb = getSB();
  const { data, error } = await sb
    .from('ivx_re_pilot_markets')
    .update(updates)
    .eq('id', marketId)
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Pilot market update failed', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'pilot_market_updated',
    entity_type: 'pilot_market',
    entity_id: marketId,
    details: { fields: Object.keys(updates) },
    category: 'platform',
  });

  return json({ ok: true, market: data, traceId: genTraceId() });
}
