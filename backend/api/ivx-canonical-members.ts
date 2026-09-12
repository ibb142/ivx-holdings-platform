/**
 * IVX Canonical Members API
 *
 * Routes:
 *   GET  /api/ivx/members/registry   → canonical members list (search/type/verified filters)
 *   GET  /api/ivx/members/summary    → counts by type/source/verification
 *   POST /api/ivx/members/backfill   → sync every landing registration into public.members
 */

import {
  listCanonicalMembers,
  listCanonicalMemberSummaryRows,
  backfillCanonicalMembers,
  countCanonicalMembers,
  isCanonicalMembersConfigured,
  type ListMembersOptions,
  type CanonicalMemberRow,
  type CanonicalMemberSummaryRow,
} from '../services/ivx-canonical-members';
import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';

const DEPLOYMENT_MARKER = 'ivx-canonical-members-api-v1';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function unavailableMembersResponse(): Response {
  return jsonResponse({
    ok: false,
    code: 'MEMBERS_SOURCE_UNAVAILABLE',
    message: 'Members are temporarily unavailable. Please retry.',
    deploymentMarker: DEPLOYMENT_MARKER,
  }, 503);
}

export async function handleCanonicalMembersRegistry(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); } catch { return ownerOnlyJson({ ok: false, error: 'AUTH_REQUIRED' }, 401); }
  const url = new URL(request.url);
  const options: ListMembersOptions = {
    search: url.searchParams.get('search') || undefined,
    memberType: url.searchParams.get('type') || undefined,
    verified: (url.searchParams.get('verified') as ListMembersOptions['verified']) || undefined,
    limit: Number(url.searchParams.get('limit') || '1000') || 1000,
  };
  let members: CanonicalMemberRow[];
  try { members = await listCanonicalMembers(options); } catch { return unavailableMembersResponse(); }
  return jsonResponse({
    ok: true,
    configured: isCanonicalMembersConfigured(),
    total: members.length,
    members,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

export async function handleCanonicalMembersSummary(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); } catch { return ownerOnlyJson({ ok: false, error: 'AUTH_REQUIRED' }, 401); }
  let members: CanonicalMemberSummaryRow[];
  let total: number;
  try {
    [members, total] = await Promise.all([listCanonicalMemberSummaryRows(), countCanonicalMembers()]);
  } catch {
    return unavailableMembersResponse();
  }
  const byType: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  let smsVerified = 0;
  let verified = 0;
  for (const member of members) {
    byType[member.member_type] = (byType[member.member_type] ?? 0) + 1;
    bySource[member.source] = (bySource[member.source] ?? 0) + 1;
    if (member.sms_verified) smsVerified += 1;
    if (member.verification_status === 'verified') verified += 1;
  }
  return jsonResponse({
    ok: true,
    total,
    byType,
    bySource,
    smsVerified,
    verified,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

/**
 * GET /api/ivx/members — real members list with filters + counts.
 *
 * Query params:
 *   search   — name/email/phone substring
 *   type     — member_type filter (investor|buyer|jv_deals|tokenized|member|all)
 *   verified — verified|unverified|sms_verified|all
 *   limit    — 1..2000 (default 1000)
 *
 * Returns ONLY rows from the canonical public.members table (real database
 * members). No fake, demo, or chatbot members are ever injected here.
 */
export async function handleCanonicalMembersList(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); } catch { return ownerOnlyJson({ ok: false, error: 'AUTH_REQUIRED' }, 401); }
  const url = new URL(request.url);
  const options: ListMembersOptions = {
    search: url.searchParams.get('search') || undefined,
    memberType: url.searchParams.get('type') || undefined,
    verified: (url.searchParams.get('verified') as ListMembersOptions['verified']) || undefined,
    limit: Number(url.searchParams.get('limit') || '1000') || 1000,
  };
  const configured = isCanonicalMembersConfigured();
  if (!configured) {
    return jsonResponse({
      ok: false,
      configured: false,
      message: 'Supabase credentials not configured on this runtime. Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.',
      total: 0,
      counts: { members: 0, investors: 0, buyers: 0, jvDeals: 0, tokenized: 0, total: 0 },
      members: [],
      deploymentMarker: DEPLOYMENT_MARKER,
    }, 503);
  }
  let members: CanonicalMemberRow[];
  try { members = await listCanonicalMembers(options); } catch { return unavailableMembersResponse(); }
  const counts = { members: 0, investors: 0, buyers: 0, jvDeals: 0, tokenized: 0, total: 0 };
  for (const m of members) {
    counts.total += 1;
    if (m.member_type === 'investor') counts.investors += 1;
    if (m.member_type === 'buyer') counts.buyers += 1;
    if (m.member_type === 'jv_deals') counts.jvDeals += 1;
    if (m.member_type === 'tokenized') counts.tokenized += 1;
    if (m.member_type === 'member' || m.member_type === 'user') counts.members += 1;
  }
  return jsonResponse({
    ok: true,
    configured: true,
    realMembersOnly: true,
    containsFakeOrDemoData: false,
    total: members.length,
    counts,
    members,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

export async function handleCanonicalMembersBackfill(request: Request): Promise<Response> {
  try { await assertIVXOwnerOnly(request); } catch { return ownerOnlyJson({ ok: false, error: 'AUTH_REQUIRED' }, 401); }
  const result = await backfillCanonicalMembers();
  return jsonResponse({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, result.ok ? 200 : 207);
}

