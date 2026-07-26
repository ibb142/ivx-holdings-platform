/**
 * IVX Canonical Members API
 *
 * Routes:
 *   GET  /api/ivx/members/registry   → canonical members list (search/type/verified filters)
 *   GET  /api/ivx/members/summary    → counts by type/source/verification
 *   POST /api/ivx/members/backfill   → sync every landing registration into public.members
 */
import { listCanonicalMembers, backfillCanonicalMembers, countCanonicalMembers, isCanonicalMembersConfigured, } from '../services/ivx-canonical-members';
import { assertIVXOwnerOnly, ownerOnlyJson } from './owner-only';
const DEPLOYMENT_MARKER = 'ivx-canonical-members-api-v1';
function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        },
    });
}
export async function handleCanonicalMembersRegistry(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'AUTH_REQUIRED' }, 401);
    }
    const url = new URL(request.url);
    const options = {
        search: url.searchParams.get('search') || undefined,
        memberType: url.searchParams.get('type') || undefined,
        verified: url.searchParams.get('verified') || undefined,
        limit: Number(url.searchParams.get('limit') || '1000') || 1000,
    };
    const members = await listCanonicalMembers(options);
    return jsonResponse({
        ok: true,
        configured: isCanonicalMembersConfigured(),
        total: members.length,
        members,
        deploymentMarker: DEPLOYMENT_MARKER,
    });
}
export async function handleCanonicalMembersSummary(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'AUTH_REQUIRED' }, 401);
    }
    const members = await listCanonicalMembers({ limit: 2000 });
    const byType = {};
    const bySource = {};
    let smsVerified = 0;
    let verified = 0;
    for (const member of members) {
        byType[member.member_type] = (byType[member.member_type] ?? 0) + 1;
        bySource[member.source] = (bySource[member.source] ?? 0) + 1;
        if (member.sms_verified)
            smsVerified += 1;
        if (member.verification_status === 'verified')
            verified += 1;
    }
    return jsonResponse({
        ok: true,
        total: await countCanonicalMembers(),
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
export async function handleCanonicalMembersList(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'AUTH_REQUIRED' }, 401);
    }
    const url = new URL(request.url);
    const options = {
        search: url.searchParams.get('search') || undefined,
        memberType: url.searchParams.get('type') || undefined,
        verified: url.searchParams.get('verified') || undefined,
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
    const members = await listCanonicalMembers(options);
    const counts = { members: 0, investors: 0, buyers: 0, jvDeals: 0, tokenized: 0, total: 0 };
    for (const m of members) {
        counts.total += 1;
        if (m.member_type === 'investor')
            counts.investors += 1;
        if (m.member_type === 'buyer')
            counts.buyers += 1;
        if (m.member_type === 'jv_deals')
            counts.jvDeals += 1;
        if (m.member_type === 'tokenized')
            counts.tokenized += 1;
        if (m.member_type === 'member' || m.member_type === 'user')
            counts.members += 1;
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
export async function handleCanonicalMembersBackfill(request) {
    try {
        await assertIVXOwnerOnly(request);
    }
    catch {
        return ownerOnlyJson({ ok: false, error: 'AUTH_REQUIRED' }, 401);
    }
    const result = await backfillCanonicalMembers();
    return jsonResponse({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, result.ok ? 200 : 207);
}
