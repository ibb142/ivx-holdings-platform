/**
 * IVX Real Estate Transaction Flow API
 *
 * Complete end-to-end real estate transaction endpoints:
 * - Property search, details, images
 * - Offers: create, list, counter, accept, reject
 * - Contracts: create, sign, execute
 * - Escrow: create, fund, release
 * - KYC/KYB: submit, status
 * - Sanctions screening, proof of funds
 * - Portfolio dashboard, audit trail
 * - Currencies, countries, brokers
 *
 * Endpoints registered in hono.ts:
 * - GET  /api/ivx/re/properties           — search listings with filters
 * - GET  /api/ivx/re/properties/:id       — property details
 * - POST /api/ivx/re/offers               — create offer
 * - GET  /api/ivx/re/offers              — list offers (buyer or listing)
 * - POST /api/ivx/re/offers/:id/counter  — counter offer
 * - POST /api/ivx/re/offers/:id/accept    — accept offer
 * - POST /api/ivx/re/offers/:id/reject    — reject offer
 * - POST /api/ivx/re/contracts            — create contract
 * - POST /api/ivx/re/contracts/:id/sign  — sign contract
 * - POST /api/ivx/re/escrow               — create escrow
 * - POST /api/ivx/re/escrow/:id/fund      — fund escrow
 * - POST /api/ivx/re/escrow/:id/release   — release escrow
 * - GET  /api/ivx/re/portfolio           — owner portfolio
 * - GET  /api/ivx/re/audit               — audit trail
 * - GET  /api/ivx/re/currencies          — list currencies
 * - GET  /api/ivx/re/countries           — list countries
 * - GET  /api/ivx/re/brokers             — list brokers
 * - POST /api/ivx/re/kyc                 — submit KYC
 * - GET  /api/ivx/re/kyc/status          — KYC status
 * - POST /api/ivx/re/proof-of-funds      — submit proof of funds
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const DEPLOYMENT_MARKER = 'ivx-real-estate-flow-v1-2026-08-13';

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
  return `re-flow-${Date.now()}-${randomUUID().slice(0, 8)}`;
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

async function verifyOwner(authHeader: string | null | undefined): Promise<{ userId: string; email: string } | null> {
  const user = await verifyBearer(authHeader);
  if (!user) return null;
  if (user.role !== 'owner' && user.role !== 'admin') return null;
  return { userId: user.userId, email: user.email };
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
      category: entry.category || 'real_estate',
    });
  } catch {
    // Audit recording is best-effort
  }
}

// ============================================================================
// PROPERTY SEARCH
// ============================================================================
export async function handleRESearchProperties(raw: Request): Promise<Response> {
  const url = new URL(raw.url);
  const params = url.searchParams;

  const page = Math.max(1, parseInt(params.get('page') || '1', 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(params.get('pageSize') || '12', 10)));
  const offset = (page - 1) * pageSize;

  let query = getSB()
    .from('ivx_re_property_listings')
    .select('*', { count: 'exact' })
    .in('listing_status', ['active', 'under_contract'])
    .eq('is_verified', true)
    .order('is_featured', { ascending: false })
    .order('created_at', { ascending: false })
    .range(offset, offset + pageSize - 1);

  const typeFilter = params.get('type');
  if (typeFilter) query = query.eq('property_type_code', typeFilter);

  const cityFilter = params.get('city');
  if (cityFilter) query = query.ilike('city', `%${cityFilter}%`);

  const countryFilter = params.get('country');
  if (countryFilter) query = query.eq('country_iso', countryFilter);

  const minPrice = params.get('minPrice');
  if (minPrice) query = query.gte('asking_price', parseFloat(minPrice));

  const maxPrice = params.get('maxPrice');
  if (maxPrice) query = query.lte('asking_price', parseFloat(maxPrice));

  const listingType = params.get('listingType');
  if (listingType) query = query.eq('listing_type', listingType);

  const search = params.get('q');
  if (search) query = query.or(`title.ilike.%${search}%,description.ilike.%${search}%,city.ilike.%${search}%`);

  const { data, error, count } = await query;

  if (error) {
    return json({ ok: false, error: 'Search failed', details: error.message }, 500);
  }

  return json({
    ok: true,
    properties: data || [],
    pagination: {
      page,
      pageSize,
      total: count || 0,
      totalPages: Math.ceil((count || 0) / pageSize),
    },
  });
}

// ============================================================================
// PROPERTY DETAILS
// ============================================================================
export async function handleREPropertyDetails(raw: Request, propertyId: string): Promise<Response> {
  const sb = getSB();

  const { data: listing, error } = await sb
    .from('ivx_re_property_listings')
    .select('*')
    .eq('id', propertyId)
    .single();

  if (error || !listing) {
    return json({ ok: false, error: 'Property not found' }, 404);
  }

  const [imagesResult, documentsResult, valuationsResult, amenitiesResult, offersResult] = await Promise.all([
    sb.from('ivx_re_property_images').select('*').eq('listing_id', propertyId).order('sort_order'),
    sb.from('ivx_re_property_documents').select('*').eq('listing_id', propertyId).order('created_at', { ascending: false }),
    sb.from('ivx_re_property_valuations').select('*').eq('listing_id', propertyId).order('valuation_date', { ascending: false }),
    sb.from('ivx_re_property_amenities').select('*').eq('listing_id', propertyId),
    sb.from('ivx_re_offers').select('id, offer_amount, offer_status, buyer_name, created_at').eq('listing_id', propertyId).eq('offer_status', 'pending').order('offer_amount', { ascending: false }),
  ]);

  const brokerAssignment = await sb
    .from('ivx_re_broker_assignments')
    .select('*, broker:ivx_re_brokers(*)')
    .eq('listing_id', propertyId)
    .eq('is_primary', true)
    .maybeSingle();

  // Increment view count
  await sb.from('ivx_re_property_listings')
    .update({ view_count: (listing.view_count || 0) + 1 })
    .eq('id', propertyId);

  return json({
    ok: true,
    property: {
      ...listing,
      images: imagesResult.data || [],
      documents: documentsResult.data || [],
      valuations: valuationsResult.data || [],
      amenities: amenitiesResult.data || [],
      pendingOffers: offersResult.data || [],
      primaryBroker: brokerAssignment.data?.broker || null,
    },
  });
}

// ============================================================================
// CREATE OFFER
// ============================================================================
export async function handleRECreateOffer(raw: Request): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const body = await raw.json().catch(() => null);
  if (!body) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const { listing_id, offer_amount, currency_code, financing_type, earnest_money, proposed_close_date, terms, conditions, proof_of_funds_url, pre_approval_url } = body;

  if (!listing_id || !offer_amount) {
    return json({ ok: false, error: 'listing_id and offer_amount are required' }, 400);
  }

  const sb = getSB();

  // Check listing exists and is active
  const { data: listing } = await sb
    .from('ivx_re_property_listings')
    .select('id, asking_price, listing_status, currency_code, seller_id')
    .eq('id', listing_id)
    .single();

  if (!listing || listing.listing_status !== 'active') {
    return json({ ok: false, error: 'Property not available for offers' }, 400);
  }

  const offerId = randomUUID();
  const { data: offer, error } = await sb.from('ivx_re_offers').insert({
    id: offerId,
    listing_id,
    buyer_id: user.userId,
    buyer_name: user.fullName,
    buyer_email: user.email,
    offer_amount: parseFloat(offer_amount),
    currency_code: currency_code || listing.currency_code || 'USD',
    financing_type: financing_type || 'cash',
    earnest_money: earnest_money ? parseFloat(earnest_money) : null,
    proposed_close_date: proposed_close_date || null,
    terms: terms || null,
    conditions: conditions || null,
    proof_of_funds_url: proof_of_funds_url || null,
    pre_approval_url: pre_approval_url || null,
    offer_status: 'pending',
    offer_expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  }).select('*').single();

  if (error) {
    return json({ ok: false, error: 'Failed to create offer', details: error.message }, 500);
  }

  // Increment listing offer count
  await sb.from('ivx_re_property_listings')
    .update({ offer_count: (await sb.from('ivx_re_offers').select('*', { count: 'exact', head: true }).eq('listing_id', listing_id)).count || 0 })
    .eq('id', listing_id);

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'offer_created',
    entity_type: 'offer',
    entity_id: offerId,
    entity_name: `Offer ${offer_amount} on listing ${listing_id}`,
    details: { offer_amount, listing_id, financing_type },
    severity: 'info',
  });

  return json({ ok: true, offer }, 201);
}

// ============================================================================
// LIST OFFERS
// ============================================================================
export async function handleREListOffers(raw: Request): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const url = new URL(raw.url);
  const listingId = url.searchParams.get('listing_id');
  const status = url.searchParams.get('status');

  const sb = getSB();

  // Check if user is owner/admin (can see all offers) or regular user (see own offers)
  const isOwner = user.role === 'owner' || user.role === 'admin';

  let query = sb.from('ivx_re_offers').select('*, listing:ivx_re_property_listings(id, title, asking_price, city, country_iso, currency_code, images)').order('created_at', { ascending: false });

  if (listingId) {
    query = query.eq('listing_id', listingId);
  } else if (!isOwner) {
    query = query.eq('buyer_id', user.userId);
  }

  if (status) {
    query = query.eq('offer_status', status);
  }

  const { data: offers, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Failed to fetch offers', details: error.message }, 500);
  }

  return json({ ok: true, offers: offers || [] });
}

// ============================================================================
// COUNTER OFFER
// ============================================================================
export async function handleRECounterOffer(raw: Request, offerId: string): Promise<Response> {
  const user = await verifyOwner(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Owner access required' }, 403);
  }

  const body = await raw.json().catch(() => null);
  if (!body) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const { counter_amount, terms, conditions } = body;
  if (!counter_amount) {
    return json({ ok: false, error: 'counter_amount is required' }, 400);
  }

  const sb = getSB();

  const { data: offer } = await sb.from('ivx_re_offers')
    .select('*').eq('id', offerId).single();

  if (!offer) {
    return json({ ok: false, error: 'Offer not found' }, 404);
  }

  // Update offer status to countered
  const { data: updated, error } = await sb.from('ivx_re_offers')
    .update({
      offer_status: 'countered',
      counter_count: (offer.counter_count || 0) + 1,
      updated_at: new Date().toISOString(),
    })
    .eq('id', offerId)
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Failed to counter offer', details: error.message }, 500);
  }

  // Add counter message
  await sb.from('ivx_re_offer_messages').insert({
    offer_id: offerId,
    sender_id: user.userId,
    sender_name: 'IVX Holdings',
    sender_role: 'owner',
    message_type: 'counter',
    content: terms || 'Counter offer submitted',
    counter_amount: parseFloat(counter_amount),
    counter_terms: conditions || null,
  });

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'offer_countered',
    entity_type: 'offer',
    entity_id: offerId,
    details: { counter_amount, original_amount: offer.offer_amount },
    severity: 'info',
  });

  return json({ ok: true, offer: updated });
}

// ============================================================================
// ACCEPT OFFER
// ============================================================================
export async function handleREAcceptOffer(raw: Request, offerId: string): Promise<Response> {
  const user = await verifyOwner(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Owner access required' }, 403);
  }

  const sb = getSB();

  const { data: offer } = await sb.from('ivx_re_offers')
    .select('*, listing:ivx_re_property_listings(*)').eq('id', offerId).single();

  if (!offer) {
    return json({ ok: false, error: 'Offer not found' }, 404);
  }

  // Accept this offer
  const { data: accepted, error: acceptError } = await sb.from('ivx_re_offers')
    .update({ offer_status: 'accepted', updated_at: new Date().toISOString() })
    .eq('id', offerId)
    .select('*')
    .single();

  if (acceptError) {
    return json({ ok: false, error: 'Failed to accept offer', details: acceptError.message }, 500);
  }

  // Reject all other pending offers on the same listing
  await sb.from('ivx_re_offers')
    .update({ offer_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('listing_id', offer.listing_id)
    .neq('id', offerId)
    .eq('offer_status', 'pending');

  // Update listing status to under_contract
  await sb.from('ivx_re_property_listings')
    .update({ listing_status: 'under_contract', updated_at: new Date().toISOString() })
    .eq('id', offer.listing_id);

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'offer_accepted',
    entity_type: 'offer',
    entity_id: offerId,
    entity_name: `Offer accepted for ${offer.offer_amount}`,
    details: { listing_id: offer.listing_id, offer_amount: offer.offer_amount },
    severity: 'info',
  });

  return json({ ok: true, offer: accepted });
}

// ============================================================================
// REJECT OFFER
// ============================================================================
export async function handleRERejectOffer(raw: Request, offerId: string): Promise<Response> {
  const user = await verifyOwner(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Owner access required' }, 403);
  }

  const body = await raw.json().catch(() => ({}));
  const sb = getSB();

  const { data: rejected, error } = await sb.from('ivx_re_offers')
    .update({ offer_status: 'rejected', updated_at: new Date().toISOString() })
    .eq('id', offerId)
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Failed to reject offer', details: error.message }, 500);
  }

  await sb.from('ivx_re_offer_messages').insert({
    offer_id: offerId,
    sender_id: user.userId,
    sender_name: 'IVX Holdings',
    sender_role: 'owner',
    message_type: 'rejection',
    content: body.reason || 'Offer rejected',
  });

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'offer_rejected',
    entity_type: 'offer',
    entity_id: offerId,
    details: { reason: body.reason || 'Not specified' },
    severity: 'info',
  });

  return json({ ok: true, offer: rejected });
}

// ============================================================================
// CREATE CONTRACT
// ============================================================================
export async function handleRECreateContract(raw: Request): Promise<Response> {
  const user = await verifyOwner(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Owner access required' }, 403);
  }

  const body = await raw.json().catch(() => null);
  if (!body) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const { offer_id, closing_date, special_provisions, disclosures } = body;
  if (!offer_id) {
    return json({ ok: false, error: 'offer_id is required' }, 400);
  }

  const sb = getSB();

  const { data: offer } = await sb.from('ivx_re_offers')
    .select('*, listing:ivx_re_property_listings(*)').eq('id', offer_id).single();

  if (!offer || offer.offer_status !== 'accepted') {
    return json({ ok: false, error: 'Offer must be accepted before creating a contract' }, 400);
  }

  const contractId = randomUUID();
  const { data: contract, error } = await sb.from('ivx_re_contracts').insert({
    id: contractId,
    listing_id: offer.listing_id,
    offer_id: offer_id,
    buyer_id: offer.buyer_id,
    seller_id: offer.listing?.seller_id,
    contract_type: 'purchase_agreement',
    contract_status: 'draft',
    sale_price: offer.offer_amount,
    currency_code: offer.currency_code || 'USD',
    earnest_money: offer.earnest_money,
    earnest_money_held_by: 'escrow_agent',
    closing_date: closing_date || offer.proposed_close_date,
    property_address: offer.listing ? `${offer.listing.address_line1 || ''}, ${offer.listing.city || ''}, ${offer.listing.state_province || ''} ${offer.listing.postal_code || ''}`.trim() : null,
    legal_description: offer.listing?.legal_description || null,
    special_provisions: special_provisions || null,
    disclosures: disclosures || null,
    contract_generated_at: new Date().toISOString(),
  }).select('*').single();

  if (error) {
    return json({ ok: false, error: 'Failed to create contract', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'contract_created',
    entity_type: 'contract',
    entity_id: contractId,
    entity_name: `Contract for ${offer.offer_amount}`,
    details: { offer_id, listing_id: offer.listing_id },
    severity: 'info',
  });

  return json({ ok: true, contract }, 201);
}

// ============================================================================
// SIGN CONTRACT
// ============================================================================
export async function handleRESignContract(raw: Request, contractId: string): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const body = await raw.json().catch(() => ({}));
  const sb = getSB();

  const { data: contract } = await sb.from('ivx_re_contracts')
    .select('*').eq('id', contractId).single();

  if (!contract) {
    return json({ ok: false, error: 'Contract not found' }, 404);
  }

  const isBuyer = contract.buyer_id === user.userId;
  const isSeller = contract.seller_id === user.userId || user.role === 'owner' || user.role === 'admin';

  if (!isBuyer && !isSeller) {
    return json({ ok: false, error: 'Not authorized to sign this contract' }, 403);
  }

  const signatureId = randomUUID();
  const now = new Date().toISOString();

  await sb.from('ivx_re_contract_signatures').insert({
    id: signatureId,
    contract_id: contractId,
    signer_id: user.userId,
    signer_name: user.fullName || body.signer_name,
    signer_email: user.email,
    signer_role: isBuyer ? 'buyer' : 'seller',
    signature_data: body.signature_data || `Signed by ${user.fullName} at ${now}`,
    signature_method: body.signature_method || 'typed',
    signed_at: now,
  });

  const updates: Record<string, string> = { contract_status: 'partially_executed', updated_at: now };
  if (isBuyer) updates.buyer_signed_at = now;
  if (isSeller) updates.seller_signed_at = now;

  // If both signed, mark as fully executed
  if ((isBuyer || contract.buyer_signed_at) && (isSeller || contract.seller_signed_at)) {
    updates.contract_status = 'fully_executed';
    updates.fully_executed_at = now;
  }

  const { data: updated, error } = await sb.from('ivx_re_contracts')
    .update(updates).eq('id', contractId).select('*').single();

  if (error) {
    return json({ ok: false, error: 'Failed to sign contract', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'contract_signed',
    entity_type: 'contract',
    entity_id: contractId,
    details: { signer_role: isBuyer ? 'buyer' : 'seller', status: updates.contract_status },
    severity: 'info',
  });

  return json({ ok: true, contract: updated, signatureId });
}

// ============================================================================
// CREATE ESCROW
// ============================================================================
export async function handleRECreateEscrow(raw: Request): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const body = await raw.json().catch(() => null);
  if (!body) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const { contract_id, total_amount, earnest_money_amount, escrow_company, escrow_agent_name, escrow_agent_email, conditions } = body;
  if (!contract_id || !total_amount) {
    return json({ ok: false, error: 'contract_id and total_amount are required' }, 400);
  }

  const sb = getSB();

  const { data: contract } = await sb.from('ivx_re_contracts')
    .select('*, listing:ivx_re_property_listings(*)').eq('id', contract_id).single();

  if (!contract) {
    return json({ ok: false, error: 'Contract not found' }, 404);
  }

  if (contract.contract_status !== 'fully_executed') {
    return json({ ok: false, error: 'Contract must be fully executed before creating escrow' }, 400);
  }

  const escrowId = randomUUID();
  const { data: escrow, error } = await sb.from('ivx_re_escrow_accounts').insert({
    id: escrowId,
    contract_id,
    listing_id: contract.listing_id,
    buyer_id: contract.buyer_id,
    seller_id: contract.seller_id,
    escrow_status: 'open',
    escrow_agent_name: escrow_agent_name || null,
    escrow_agent_email: escrow_agent_email || null,
    escrow_company: escrow_company || 'IVX Holdings Escrow',
    total_amount: parseFloat(total_amount),
    earnest_money_amount: earnest_money_amount ? parseFloat(earnest_money_amount) : null,
    conditions: conditions || null,
  }).select('*').single();

  if (error) {
    return json({ ok: false, error: 'Failed to create escrow', details: error.message }, 500);
  }

  // Update contract to indicate escrow created
  await sb.from('ivx_re_contracts')
    .update({ contract_status: 'in_escrow', updated_at: new Date().toISOString() })
    .eq('id', contract_id);

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'escrow_created',
    entity_type: 'escrow',
    entity_id: escrowId,
    entity_name: `Escrow for ${total_amount}`,
    details: { contract_id, total_amount },
    severity: 'info',
  });

  return json({ ok: true, escrow }, 201);
}

// ============================================================================
// FUND ESCROW
// ============================================================================
export async function handleREFundEscrow(raw: Request, escrowId: string): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const body = await raw.json().catch(() => ({}));
  const sb = getSB();

  const { data: escrow } = await sb.from('ivx_re_escrow_accounts')
    .select('*').eq('id', escrowId).single();

  if (!escrow) {
    return json({ ok: false, error: 'Escrow not found' }, 404);
  }

  const { amount, payment_method, reference_number, transaction_type } = body;
  if (!amount) {
    return json({ ok: false, error: 'amount is required' }, 400);
  }

  const txId = randomUUID();
  const now = new Date().toISOString();

  // Record the escrow transaction
  await sb.from('ivx_re_escrow_transactions').insert({
    id: txId,
    escrow_id: escrowId,
    transaction_type: transaction_type || 'deposit',
    amount: parseFloat(amount),
    currency_code: escrow.currency_code || 'USD',
    direction: 'inbound',
    payment_method: payment_method || 'wire',
    reference_number: reference_number || null,
    status: 'completed',
    completed_at: now,
  });

  // Update escrow balance
  const newBalance = (escrow.balance_amount || 0) + parseFloat(amount);
  const updates: Record<string, unknown> = { balance_amount: newBalance, updated_at: now };

  // Check if earnest money received
  if (escrow.earnest_money_amount && newBalance >= escrow.earnest_money_amount && !escrow.earnest_money_received) {
    updates.earnest_money_received = true;
    updates.earnest_money_received_at = now;
  }

  // Check if fully funded
  if (newBalance >= escrow.total_amount) {
    updates.escrow_status = 'funded';
  }

  const { data: updated, error } = await sb.from('ivx_re_escrow_accounts')
    .update(updates).eq('id', escrowId).select('*').single();

  if (error) {
    return json({ ok: false, error: 'Failed to update escrow', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'escrow_funded',
    entity_type: 'escrow',
    entity_id: escrowId,
    details: { amount, payment_method, reference_number, new_balance: newBalance },
    severity: 'info',
  });

  return json({ ok: true, escrow: updated, transactionId: txId });
}

// ============================================================================
// RELEASE ESCROW
// ============================================================================
export async function handleREReleaseEscrow(raw: Request, escrowId: string): Promise<Response> {
  const user = await verifyOwner(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Owner access required' }, 403);
  }

  const body = await raw.json().catch(() => ({}));
  const sb = getSB();

  const { data: escrow } = await sb.from('ivx_re_escrow_accounts')
    .select('*').eq('id', escrowId).single();

  if (!escrow) {
    return json({ ok: false, error: 'Escrow not found' }, 404);
  }

  if (escrow.escrow_status !== 'funded') {
    return json({ ok: false, error: 'Escrow must be fully funded before release' }, 400);
  }

  const now = new Date().toISOString();

  // Record disbursement transaction
  await sb.from('ivx_re_escrow_transactions').insert({
    id: randomUUID(),
    escrow_id: escrowId,
    transaction_type: 'disbursement',
    amount: escrow.balance_amount,
    currency_code: escrow.currency_code || 'USD',
    direction: 'outbound',
    payment_method: 'wire',
    reference_number: body.reference_number || null,
    status: 'completed',
    completed_at: now,
  });

  const { data: updated, error } = await sb.from('ivx_re_escrow_accounts')
    .update({
      escrow_status: 'closed',
      funds_disbursed: true,
      funds_disbursed_at: now,
      disbursement_instructions: body.instructions || null,
      balance_amount: 0,
      updated_at: now,
    })
    .eq('id', escrowId)
    .select('*')
    .single();

  if (error) {
    return json({ ok: false, error: 'Failed to release escrow', details: error.message }, 500);
  }

  // Update contract to closed
  await sb.from('ivx_re_contracts')
    .update({ contract_status: 'closed', updated_at: now })
    .eq('id', escrow.contract_id);

  // Update listing to sold
  await sb.from('ivx_re_property_listings')
    .update({ listing_status: 'sold', updated_at: now })
    .eq('id', escrow.listing_id);

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'escrow_released',
    entity_type: 'escrow',
    entity_id: escrowId,
    details: { amount: escrow.balance_amount, contract_id: escrow.contract_id },
    severity: 'warning',
  });

  return json({ ok: true, escrow: updated });
}

// ============================================================================
// PORTFOLIO DASHBOARD
// ============================================================================
export async function handleREPortfolio(raw: Request): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const sb = getSB();

  // Get user's listings (as seller)
  const { data: listings } = await sb.from('ivx_re_property_listings')
    .select('id, title, asking_price, currency_code, listing_status, city, country_iso, images, view_count, offer_count, created_at')
    .or(`seller_id.eq.${user.userId}`)
    .order('created_at', { ascending: false });

  // Get user's offers (as buyer)
  const { data: offers } = await sb.from('ivx_re_offers')
    .select('id, offer_amount, currency_code, offer_status, listing:ivx_re_property_listings(id, title, city, country_iso, images), created_at')
    .eq('buyer_id', user.userId)
    .order('created_at', { ascending: false });

  // Get user's contracts
  const { data: contracts } = await sb.from('ivx_re_contracts')
    .select('id, sale_price, currency_code, contract_status, closing_date, listing:ivx_re_property_listings(id, title, city), created_at')
    .or(`buyer_id.eq.${user.userId},seller_id.eq.${user.userId}`)
    .order('created_at', { ascending: false });

  // Get user's escrow accounts
  const { data: escrows } = await sb.from('ivx_re_escrow_accounts')
    .select('id, total_amount, currency_code, escrow_status, balance_amount, contract:ivx_re_contracts(id, listing:ivx_re_property_listings(id, title, city))')
    .or(`buyer_id.eq.${user.userId},seller_id.eq.${user.userId}`)
    .order('created_at', { ascending: false });

  // Get user's transactions
  const { data: transactions } = await sb.from('ivx_re_transactions')
    .select('id, amount, currency_code, transaction_type, status, created_at')
    .or(`buyer_id.eq.${user.userId},seller_id.eq.${user.userId}`)
    .order('created_at', { ascending: false })
    .limit(20);

  // Calculate portfolio stats
  const totalListings = listings?.length || 0;
  const activeListings = listings?.filter(l => l.listing_status === 'active').length || 0;
  const soldListings = listings?.filter(l => l.listing_status === 'sold').length || 0;
  const totalValue = listings?.reduce((sum, l) => sum + parseFloat(l.asking_price?.toString() || '0'), 0) || 0;
  const totalOffers = offers?.length || 0;
  const activeOffers = offers?.filter(o => o.offer_status === 'pending' || o.offer_status === 'countered').length || 0;
  const activeContracts = contracts?.filter(c => c.contract_status !== 'closed' && c.contract_status !== 'cancelled').length || 0;
  const totalTransactionVolume = transactions?.filter(t => t.status === 'completed').reduce((sum, t) => sum + parseFloat(t.amount?.toString() || '0'), 0) || 0;

  return json({
    ok: true,
    portfolio: {
      listings: listings || [],
      offers: offers || [],
      contracts: contracts || [],
      escrows: escrows || [],
      recentTransactions: transactions || [],
      stats: {
        totalListings,
        activeListings,
        soldListings,
        totalListingsValue: totalValue,
        totalOffers,
        activeOffers,
        activeContracts,
        totalTransactionVolume,
      },
    },
  });
}

// ============================================================================
// AUDIT TRAIL
// ============================================================================
export async function handleREAuditTrail(raw: Request): Promise<Response> {
  const user = await verifyOwner(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Owner access required' }, 403);
  }

  const url = new URL(raw.url);
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50', 10));
  const action = url.searchParams.get('action');
  const entity_type = url.searchParams.get('entity_type');

  let query = getSB().from('ivx_re_audit_trail')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (action) query = query.eq('action', action);
  if (entity_type) query = query.eq('entity_type', entity_type);

  const { data, error } = await query;

  if (error) {
    return json({ ok: false, error: 'Failed to fetch audit trail', details: error.message }, 500);
  }

  return json({ ok: true, entries: data || [] });
}

// ============================================================================
// REFERENCE DATA (currencies, countries, brokers)
// ============================================================================
export async function handleREGetCurrencies(_raw: Request): Promise<Response> {
  const { data, error } = await getSB().from('ivx_re_currencies').select('*').eq('is_active', true).order('code');
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, currencies: data || [] });
}

export async function handleREGetCountries(_raw: Request): Promise<Response> {
  const { data, error } = await getSB().from('ivx_re_countries').select('*').eq('is_active', true).order('name');
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, countries: data || [] });
}

export async function handleREGetBrokers(_raw: Request): Promise<Response> {
  const { data, error } = await getSB().from('ivx_re_brokers').select('*').eq('is_active', true).order('rating', { ascending: false });
  if (error) return json({ ok: false, error: error.message }, 500);
  return json({ ok: true, brokers: data || [] });
}

// ============================================================================
// KYC SUBMISSION
// ============================================================================
export async function handleRESubmitKYC(raw: Request): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const body = await raw.json().catch(() => null);
  if (!body) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const sb = getSB();

  // Check for existing pending/verified KYC
  const { data: existing } = await sb.from('ivx_re_kyc_records')
    .select('id, status').eq('user_id', user.userId)
    .in('status', ['pending', 'verified'])
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();

  if (existing && existing.status === 'verified') {
    return json({ ok: false, error: 'KYC already verified' }, 400);
  }

  if (existing && existing.status === 'pending') {
    return json({ ok: false, error: 'KYC already pending review', existing_id: existing.id }, 400);
  }

  const kycId = randomUUID();
  const { data: kyc, error } = await sb.from('ivx_re_kyc_records').insert({
    id: kycId,
    user_id: user.userId,
    kyc_type: body.kyc_type || 'individual',
    status: 'pending',
    first_name: body.first_name,
    last_name: body.last_name,
    date_of_birth: body.date_of_birth,
    nationality: body.nationality,
    id_type: body.id_type,
    id_number: body.id_number,
    id_country: body.id_country,
    id_expiry: body.id_expiry,
    id_front_url: body.id_front_url,
    id_back_url: body.id_back_url,
    selfie_url: body.selfie_url,
    proof_of_address_url: body.proof_of_address_url,
    address_line1: body.address_line1,
    address_city: body.address_city,
    address_state: body.address_state,
    address_postal_code: body.address_postal_code,
    address_country: body.address_country,
    phone_number: body.phone_number,
    email: body.email || user.email,
    occupation: body.occupation,
    source_of_funds: body.source_of_funds,
  }).select('*').single();

  if (error) {
    return json({ ok: false, error: 'Failed to submit KYC', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'kyc_submitted',
    entity_type: 'kyc',
    entity_id: kycId,
    details: { kyc_type: body.kyc_type || 'individual' },
    severity: 'info',
  });

  return json({ ok: true, kyc }, 201);
}

// ============================================================================
// KYC STATUS
// ============================================================================
export async function handleREKYCStatus(raw: Request): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const sb = getSB();

  const { data: kyc, error } = await sb.from('ivx_re_kyc_records')
    .select('id, status, kyc_type, risk_level, verified_at, verification_notes, expires_at, created_at')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  const { data: kyb } = await sb.from('ivx_re_kyb_records')
    .select('id, status, company_name, risk_level, verified_at, verification_notes, expires_at, created_at')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();

  const { data: sanctions } = await sb.from('ivx_re_sanctions_checks')
    .select('id, check_status, is_clear, risk_level, checked_at, next_check_due')
    .eq('user_id', user.userId)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();

  return json({
    ok: true,
    kyc: kyc || null,
    kyb: kyb || null,
    sanctions: sanctions || null,
    overallStatus: kyc?.status === 'verified' && (!sanctions || sanctions.is_clear) ? 'verified' : 'pending',
  });
}

// ============================================================================
// PROOF OF FUNDS
// ============================================================================
export async function handleREProofOfFunds(raw: Request): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const body = await raw.json().catch(() => null);
  if (!body) {
    return json({ ok: false, error: 'Invalid request body' }, 400);
  }

  const { amount, currency_code, fund_source, bank_name, account_last4, statement_url, verification_letter_url, listing_id, offer_id } = body;
  if (!amount) {
    return json({ ok: false, error: 'amount is required' }, 400);
  }

  const sb = getSB();
  const pofId = randomUUID();

  const { data: pof, error } = await sb.from('ivx_re_proof_of_funds').insert({
    id: pofId,
    user_id: user.userId,
    listing_id: listing_id || null,
    offer_id: offer_id || null,
    amount: parseFloat(amount),
    currency_code: currency_code || 'USD',
    fund_source: fund_source || null,
    bank_name: bank_name || null,
    account_last4: account_last4 || null,
    statement_url: statement_url || null,
    verification_letter_url: verification_letter_url || null,
    status: 'pending',
  }).select('*').single();

  if (error) {
    return json({ ok: false, error: 'Failed to submit proof of funds', details: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'proof_of_funds_submitted',
    entity_type: 'proof_of_funds',
    entity_id: pofId,
    details: { amount, currency_code, listing_id, offer_id },
    severity: 'info',
  });

  return json({ ok: true, proofOfFunds: pof }, 201);
}

// ============================================================================
// CLOSING DOCUMENTS
// ============================================================================
export async function handleREGetClosingDocs(raw: Request, contractId: string): Promise<Response> {
  const user = await verifyBearer(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Authentication required' }, 401);
  }

  const sb = getSB();

  const { data: docs, error } = await sb.from('ivx_re_closing_documents')
    .select('*').eq('contract_id', contractId).order('created_at', { ascending: false });

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  return json({ ok: true, documents: docs || [] });
}

export async function handleREDeliverClosingDoc(raw: Request, docId: string): Promise<Response> {
  const user = await verifyOwner(raw.headers.get('Authorization'));
  if (!user) {
    return json({ ok: false, error: 'Owner access required' }, 403);
  }

  const body = await raw.json().catch(() => ({}));
  const sb = getSB();

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.deliver_to === 'buyer') {
    updates.delivered_to_buyer = true;
    updates.delivered_to_buyer_at = new Date().toISOString();
  } else if (body.deliver_to === 'seller') {
    updates.delivered_to_seller = true;
    updates.delivered_to_seller_at = new Date().toISOString();
  }

  const { data: updated, error } = await sb.from('ivx_re_closing_documents')
    .update(updates).eq('id', docId).select('*').single();

  if (error) {
    return json({ ok: false, error: error.message }, 500);
  }

  await recordAudit(sb, {
    user_id: user.userId,
    action: 'closing_doc_delivered',
    entity_type: 'closing_document',
    entity_id: docId,
    details: { delivered_to: body.deliver_to },
    severity: 'info',
  });

  return json({ ok: true, document: updated });
}

// Export all handlers for route registration
export const OPTIONS = new Response(null, {
  status: 204,
  headers: {
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  },
});

export const DEPLOYMENT_MARKER_RE = DEPLOYMENT_MARKER;
