/**
 * IVX Two-Stage Member & Investor System — API handlers.
 *
 * Member-facing (Bearer userId or explicit userId, same trust model as /api/members/*):
 *   POST /api/members/investor-application          → submit Phase 2 activation (auto AI review)
 *   GET  /api/members/investor-application?userId=  → current application + status + matches + alerts
 *   POST /api/members/investor-application/review   → re-run AI review
 *   POST /api/members/funnel/visitor                → record anonymous visitor (funnel analytics)
 *
 * Owner/admin-only:
 *   GET /api/ivx/member-admin/dashboard             → segments + conversion funnel
 *   GET /api/ivx/member-admin/investors?status=     → investor application pipeline
 */
import { submitInvestorApplication, getInvestorApplication, runAIReview, getMemberRecord, recordVisitor, getMemberAdminDashboard, listApplicationsForAdmin, IVX_MEMBER_INVESTOR_MARKER, VALID_INVESTMENT_RANGES, } from '../services/ivx-member-investor-system';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
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
export function memberInvestorOptions() {
    return new Response(null, {
        status: 204,
        headers: {
            'Access-Control-Allow-Origin': 'https://ivxholding.com',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        },
    });
}
export function memberAdminOptions() {
    return ownerOnlyOptions();
}
async function parseBody(request) {
    try {
        return (await request.json());
    }
    catch {
        return {};
    }
}
function asString(value, fallback = '') {
    return typeof value === 'string' ? value.trim() : fallback;
}
function asStringArray(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((v) => typeof v === 'string').map((v) => v.trim()).filter(Boolean);
}
function asNumber(value, fallback) {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
function getAuthUserId(request) {
    const authHeader = request.headers.get('Authorization') || '';
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    return match ? match[1] : null;
}
async function requireOwner(request) {
    try {
        await assertIVXOwnerOnly(request);
        return null;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : 'IVX owner authentication required.';
        const status = /required|missing|unauthorized|invalid/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
// POST /api/members/investor-application
export async function handleInvestorApplicationSubmit(request) {
    const body = await parseBody(request);
    const userId = asString(body.userId) || getAuthUserId(request) || '';
    if (!userId) {
        return jsonResponse({ success: false, message: 'userId is required.', marker: IVX_MEMBER_INVESTOR_MARKER }, 400);
    }
    const rawRange = asString(body.investmentRange).toLowerCase();
    const input = {
        userId,
        address: asString(body.address),
        dateOfBirth: asString(body.dateOfBirth),
        entityName: asString(body.entityName),
        taxCountry: asString(body.taxCountry),
        netWorthRange: asString(body.netWorthRange),
        accreditedInvestor: body.accreditedInvestor === true,
        investmentRange: (VALID_INVESTMENT_RANGES.has(rawRange) ? rawRange : ''),
        interests: asStringArray(body.interests),
        countries: asStringArray(body.countries),
        states: asStringArray(body.states),
        cities: asStringArray(body.cities),
        zipCodes: asStringArray(body.zipCodes),
        radiusMiles: asNumber(body.radiusMiles, 25),
        goals: asStringArray(body.goals),
        governmentIdProvided: body.governmentIdProvided === true,
        kycConsent: body.kycConsent === true,
        amlConsent: body.amlConsent === true,
        entityDocsProvided: body.entityDocsProvided === true,
    };
    const result = await submitInvestorApplication(input);
    if (!result.ok) {
        return jsonResponse({ success: false, message: result.error, marker: IVX_MEMBER_INVESTOR_MARKER }, 400);
    }
    return jsonResponse({
        success: true,
        application: result.application,
        marker: IVX_MEMBER_INVESTOR_MARKER,
    });
}
// GET /api/members/investor-application
export async function handleInvestorApplicationGet(request) {
    const url = new URL(request.url);
    const userId = url.searchParams.get('userId') || getAuthUserId(request) || '';
    if (!userId) {
        return jsonResponse({ success: false, message: 'userId is required.', marker: IVX_MEMBER_INVESTOR_MARKER }, 400);
    }
    const [application, member] = await Promise.all([
        getInvestorApplication(userId),
        getMemberRecord(userId),
    ]);
    return jsonResponse({
        success: true,
        memberStatus: member?.status ?? 'free_member',
        application,
        marker: IVX_MEMBER_INVESTOR_MARKER,
    });
}
// POST /api/members/investor-application/review
export async function handleInvestorApplicationReview(request) {
    const body = await parseBody(request);
    const userId = asString(body.userId) || getAuthUserId(request) || '';
    if (!userId) {
        return jsonResponse({ success: false, message: 'userId is required.', marker: IVX_MEMBER_INVESTOR_MARKER }, 400);
    }
    const reviewed = await runAIReview(userId);
    if (!reviewed) {
        return jsonResponse({ success: false, message: 'No investor application found for this member.', marker: IVX_MEMBER_INVESTOR_MARKER }, 404);
    }
    return jsonResponse({ success: true, application: reviewed, marker: IVX_MEMBER_INVESTOR_MARKER });
}
// POST /api/members/funnel/visitor
export async function handleFunnelVisitor(request) {
    const body = await parseBody(request);
    const detail = asString(body.source, 'unknown').slice(0, 120);
    await recordVisitor(detail);
    return jsonResponse({ success: true, marker: IVX_MEMBER_INVESTOR_MARKER });
}
// GET /api/ivx/member-admin/dashboard  (owner-only)
export async function handleMemberAdminDashboard(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const dashboard = await getMemberAdminDashboard();
    return ownerOnlyJson({ ok: true, dashboard });
}
// GET /api/ivx/member-admin/investors  (owner-only)
export async function handleMemberAdminInvestors(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const url = new URL(request.url);
    const status = url.searchParams.get('status') || undefined;
    const applications = await listApplicationsForAdmin(status);
    return ownerOnlyJson({ ok: true, applications, total: applications.length });
}
