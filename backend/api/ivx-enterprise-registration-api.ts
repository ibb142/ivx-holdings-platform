/**
 * IVX Enterprise Registration API
 *
 * Endpoints:
 *   POST /api/ivx/enterprise-registration/register
 *   POST /api/ivx/enterprise-registration/invitations
 *   POST /api/ivx/enterprise-registration/invitations/accept
 *   POST /api/ivx/enterprise-registration/invitations/:id/revoke
 *   POST /api/ivx/enterprise-registration/memberships/:action
 *   GET  /api/ivx/enterprise-registration/access/:enterpriseId
 *   GET  /api/ivx/enterprise-registration/summary           (owner-only)
 *   GET  /api/ivx/enterprise-registration/enterprises       (owner-only)
 *   GET  /api/ivx/enterprise-registration/enterprises/:id
 *   GET  /api/ivx/enterprise-registration/enterprises/:id/memberships
 *   POST /api/ivx/enterprise-registration/enterprises/:id/verification  (owner-only)
 */

import {
  registerEnterprise,
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  manageMembership,
  checkEnterpriseAccess,
  getEnterpriseSummary,
  listEnterprises,
  getEnterprise,
  listEnterpriseMemberships,
  updateEnterpriseVerificationStatus,
  type EnterpriseRole,
  type VerificationStatus,
  ALL_ENTERPRISE_ROLES,
  INVITABLE_ROLES,
  ALL_VERIFICATION_STATUSES,
  ENTERPRISE_REGISTRATION_MARKER,
} from '../services/ivx-enterprise-registration';
import { assertIVXOwnerOnly } from './owner-only';

const MARKER = ENTERPRISE_REGISTRATION_MARKER;

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

async function parseBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value.trim();
  return fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (typeof value === 'string') {
    const n = Number(value);
    if (!Number.isNaN(n)) return n;
  }
  return fallback;
}

function getAuthUserId(request: Request): string | null {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function isValidEnterpriseRole(role: string): role is EnterpriseRole {
  return (ALL_ENTERPRISE_ROLES as readonly string[]).includes(role);
}

function isValidVerificationStatus(status: string): status is VerificationStatus {
  return (ALL_VERIFICATION_STATUSES as readonly string[]).includes(status);
}

function isValidInvitableRole(role: string): role is EnterpriseRole {
  return (INVITABLE_ROLES as readonly string[]).includes(role);
}

export function enterpriseRegistrationOptions(): Response {
  return jsonResponse({ deploymentMarker: MARKER }, 204);
}

// POST /api/ivx/enterprise-registration/register
export async function handleEnterpriseRegisterRequest(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const ownerAuthUserId = asString(body.ownerAuthUserId) || getAuthUserId(request) || '';

  if (!ownerAuthUserId) {
    return jsonResponse({ ok: false, errorCode: 'INVALID_INPUT', error: 'Authentication required. Please sign in first.', deploymentMarker: MARKER }, 401);
  }

  const result = await registerEnterprise({
    ownerAuthUserId,
    ownerMemberId: asString(body.ownerMemberId) || undefined,
    legalName: asString(body.legalName),
    displayName: asString(body.displayName),
    companyType: asString(body.companyType),
    industry: asString(body.industry),
    website: asString(body.website),
    address: asString(body.address),
    authorizedRepresentative: asString(body.authorizedRepresentative),
    representativeJobTitle: asString(body.representativeJobTitle),
    teamSize: asNumber(body.teamSize, 1),
    businessCategory: asString(body.businessCategory),
    companyRegistrationId: asString(body.companyRegistrationId) || undefined,
    sourceChannel: asString(body.sourceChannel, 'landing_page'),
    ipAddress: asString(body.ipAddress),
    userAgent: asString(body.userAgent),
  });

  return jsonResponse(result, result.ok ? 200 : (result.duplicate ? 409 : 400));
}

// POST /api/ivx/enterprise-registration/invitations
export async function handleCreateInvitationRequest(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const invitedByAuthUserId = asString(body.invitedByAuthUserId) || getAuthUserId(request) || '';

  if (!invitedByAuthUserId) {
    return jsonResponse({ ok: false, errorCode: 'NOT_AUTHORIZED', error: 'Authentication required.', deploymentMarker: MARKER }, 401);
  }

  const enterpriseRole = asString(body.enterpriseRole);
  if (!isValidInvitableRole(enterpriseRole)) {
    return jsonResponse({ ok: false, errorCode: 'ROLE_NOT_ALLOWED', error: 'Invalid or non-invitable role.', deploymentMarker: MARKER }, 400);
  }

  const result = await createInvitation({
    enterpriseId: asString(body.enterpriseId),
    invitedByAuthUserId,
    invitedByName: asString(body.invitedByName),
    invitedEmail: asString(body.invitedEmail),
    enterpriseRole,
    expirationHours: asNumber(body.expirationHours, 168),
    ipAddress: asString(body.ipAddress),
    userAgent: asString(body.userAgent),
  });

  return jsonResponse(result, result.ok ? 200 : 400);
}

// POST /api/ivx/enterprise-registration/invitations/accept
export async function handleAcceptInvitationRequest(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const acceptingAuthUserId = asString(body.acceptingAuthUserId) || getAuthUserId(request) || '';

  if (!acceptingAuthUserId) {
    return jsonResponse({ ok: false, errorCode: 'NOT_AUTHORIZED', error: 'Authentication required.', deploymentMarker: MARKER }, 401);
  }

  const result = await acceptInvitation({
    token: asString(body.token),
    acceptingAuthUserId,
    acceptingMemberId: asString(body.acceptingMemberId) || undefined,
    acceptingEmail: asString(body.acceptingEmail),
    enterpriseId: asString(body.enterpriseId),
    ipAddress: asString(body.ipAddress),
    userAgent: asString(body.userAgent),
  });

  return jsonResponse(result, result.ok ? 200 : 400);
}

// POST /api/ivx/enterprise-registration/invitations/:id/revoke
export async function handleRevokeInvitationRequest(request: Request, invitationId: string): Promise<Response> {
  const body = await parseBody(request);
  const revokedByAuthUserId = asString(body.revokedByAuthUserId) || getAuthUserId(request) || '';

  if (!revokedByAuthUserId) {
    return jsonResponse({ ok: false, errorCode: 'NOT_AUTHORIZED', error: 'Authentication required.', deploymentMarker: MARKER }, 401);
  }

  const result = await revokeInvitation(
    invitationId,
    revokedByAuthUserId,
    asString(body.revokedByName)
  );

  return jsonResponse({ ...result, deploymentMarker: MARKER }, result.ok ? 200 : 400);
}

// POST /api/ivx/enterprise-registration/memberships/:action
export async function handleMembershipActionRequest(request: Request, action: string): Promise<Response> {
  const body = await parseBody(request);
  const actingAuthUserId = asString(body.actingAuthUserId) || getAuthUserId(request) || '';

  if (!actingAuthUserId) {
    return jsonResponse({ ok: false, errorCode: 'NOT_AUTHORIZED', error: 'Authentication required.', deploymentMarker: MARKER }, 401);
  }

  const validActions = ['suspend', 'remove', 'reactivate', 'transfer_ownership'];
  if (!validActions.includes(action)) {
    return jsonResponse({ ok: false, errorCode: 'INVALID_INPUT', error: 'Invalid action.', deploymentMarker: MARKER }, 400);
  }

  const result = await manageMembership({
    enterpriseId: asString(body.enterpriseId),
    memberId: asString(body.memberId),
    actingAuthUserId,
    action: action as 'suspend' | 'remove' | 'reactivate' | 'transfer_ownership',
    newOwnerId: asString(body.newOwnerId) || undefined,
    ipAddress: asString(body.ipAddress),
    userAgent: asString(body.userAgent),
  });

  return jsonResponse({ ...result, deploymentMarker: MARKER }, result.ok ? 200 : 400);
}

// GET /api/ivx/enterprise-registration/access/:enterpriseId
export async function handleCheckAccessRequest(request: Request, enterpriseId: string): Promise<Response> {
  const authUserId = getAuthUserId(request);
  if (!authUserId) {
    return jsonResponse({ ok: false, error: 'Authentication required.', deploymentMarker: MARKER }, 401);
  }

  const result = await checkEnterpriseAccess(enterpriseId, authUserId);
  return jsonResponse({ ok: result.hasAccess, ...result, deploymentMarker: MARKER }, result.hasAccess ? 200 : 403);
}

// GET /api/ivx/enterprise-registration/summary (owner-only)
export async function handleEnterpriseRegistrationSummaryRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return jsonResponse({ ok: false, error: 'Owner authentication required.', deploymentMarker: MARKER }, 401);
  }

  const summary = await getEnterpriseSummary();
  return jsonResponse({ ok: true, ...summary });
}

// GET /api/ivx/enterprise-registration/enterprises (owner-only)
export async function handleListEnterprisesRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return jsonResponse({ ok: false, error: 'Owner authentication required.', deploymentMarker: MARKER }, 401);
  }

  const url = new URL(request.url);
  const verificationStatus = url.searchParams.get('verificationStatus') || undefined;
  const search = url.searchParams.get('search') || undefined;
  const limit = Number(url.searchParams.get('limit') || '100');

  const enterprises = await listEnterprises({
    verificationStatus: verificationStatus && isValidVerificationStatus(verificationStatus) ? verificationStatus : undefined,
    search: search || undefined,
    limit: Number.isNaN(limit) ? 100 : limit,
  });

  return jsonResponse({ ok: true, enterprises, count: enterprises.length, deploymentMarker: MARKER });
}

// GET /api/ivx/enterprise-registration/enterprises/:id
export async function handleGetEnterpriseRequest(request: Request, enterpriseId: string): Promise<Response> {
  const authUserId = getAuthUserId(request);
  if (!authUserId) {
    return jsonResponse({ ok: false, error: 'Authentication required.', deploymentMarker: MARKER }, 401);
  }

  // Check access
  const access = await checkEnterpriseAccess(enterpriseId, authUserId);
  const enterprise = await getEnterprise(enterpriseId);

  if (!enterprise) {
    return jsonResponse({ ok: false, error: 'Enterprise not found.', deploymentMarker: MARKER }, 404);
  }

  // Owner can see all; members can see their own
  try {
    await assertIVXOwnerOnly(request);
    return jsonResponse({ ok: true, enterprise, access: { hasAccess: true, reason: 'owner' }, deploymentMarker: MARKER });
  } catch {
    if (!access.hasAccess) {
      return jsonResponse({ ok: false, error: access.reason || 'Access denied.', deploymentMarker: MARKER }, 403);
    }
    // Return limited fields for members
    return jsonResponse({
      ok: true,
      enterprise: {
        enterprise_id: (enterprise as Record<string, unknown>).enterprise_id,
        legal_name: (enterprise as Record<string, unknown>).legal_name,
        display_name: (enterprise as Record<string, unknown>).display_name,
        industry: (enterprise as Record<string, unknown>).industry,
        website: (enterprise as Record<string, unknown>).website,
        verification_status: (enterprise as Record<string, unknown>).verification_status,
      },
      membership: access.membership,
      deploymentMarker: MARKER,
    });
  }
}

// GET /api/ivx/enterprise-registration/enterprises/:id/memberships
export async function handleListMembershipsRequest(request: Request, enterpriseId: string): Promise<Response> {
  const authUserId = getAuthUserId(request);
  if (!authUserId) {
    return jsonResponse({ ok: false, error: 'Authentication required.', deploymentMarker: MARKER }, 401);
  }

  // Owner or member can list memberships
  let isOwner = false;
  try {
    await assertIVXOwnerOnly(request);
    isOwner = true;
  } catch {
    // not owner
  }

  if (!isOwner) {
    const access = await checkEnterpriseAccess(enterpriseId, authUserId);
    if (!access.hasAccess) {
      return jsonResponse({ ok: false, error: access.reason || 'Access denied.', deploymentMarker: MARKER }, 403);
    }
  }

  const memberships = await listEnterpriseMemberships(enterpriseId);
  return jsonResponse({ ok: true, memberships, count: memberships.length, deploymentMarker: MARKER });
}

// POST /api/ivx/enterprise-registration/enterprises/:id/verification (owner-only)
export async function handleUpdateVerificationRequest(request: Request, enterpriseId: string): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return jsonResponse({ ok: false, error: 'Owner authentication required.', deploymentMarker: MARKER }, 401);
  }

  const body = await parseBody(request);
  const status = asString(body.status);
  if (!isValidVerificationStatus(status)) {
    return jsonResponse({ ok: false, error: 'Invalid verification status.', deploymentMarker: MARKER }, 400);
  }

  const owner = await assertIVXOwnerOnly(request).catch(() => ({ userId: 'unknown' }));
  const result = await updateEnterpriseVerificationStatus(
    enterpriseId,
    status,
    (owner as { userId?: string }).userId || 'owner',
    asString(body.reviewerNotes)
  );

  return jsonResponse({ ...result, deploymentMarker: MARKER }, result.ok ? 200 : 400);
}
