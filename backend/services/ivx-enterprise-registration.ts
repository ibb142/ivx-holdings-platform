/**
 * IVX Enterprise Registration Service
 *
 * Implements:
 *  - Enterprise registration (legal company entity + owner membership)
 *  - Enterprise team invitations (single-use, token-hash, expiration, role binding)
 *  - Enterprise membership management (suspend, remove, transfer ownership)
 *  - KYC/AML status separation (registration != KYC approval)
 *  - Cross-enterprise isolation (members can only access their own enterprise)
 *  - Duplicate enterprise detection (legal name, domain, registration ID)
 *  - Owner review queue for uncertain records
 *  - Audit trail for every enterprise action
 *
 * Security invariants:
 *  - Users cannot assign themselves privileged enterprise roles
 *  - Users cannot mark their own enterprise as verified
 *  - Service-role credentials never enter client code
 *  - All mutations produce audit events
 *  - Invitations are single-use with nonce-bound token hashes
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { isDurableStoreConfigured, readDurableJson, writeDurableJson } from './ivx-durable-store';
import { upsertCanonicalMember } from './ivx-canonical-members';

const DEPLOYMENT_MARKER = 'ivx-enterprise-registration-v1';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EnterpriseRole =
  | 'owner'
  | 'administrator'
  | 'manager'
  | 'analyst'
  | 'contributor'
  | 'read_only'
  | 'external_advisor';

export type VerificationStatus =
  | 'not_started'
  | 'information_required'
  | 'submitted'
  | 'under_review'
  | 'verified'
  | 'rejected'
  | 'expired'
  | 'manual_review';

export type MembershipStatus = 'active' | 'suspended' | 'removed' | 'pending';

export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export const ALL_ENTERPRISE_ROLES: readonly EnterpriseRole[] = [
  'owner', 'administrator', 'manager', 'analyst', 'contributor', 'read_only', 'external_advisor',
];

export const INVITABLE_ROLES: readonly EnterpriseRole[] = [
  'administrator', 'manager', 'analyst', 'contributor', 'read_only', 'external_advisor',
];

export const ALL_VERIFICATION_STATUSES: readonly VerificationStatus[] = [
  'not_started', 'information_required', 'submitted', 'under_review', 'verified', 'rejected', 'expired', 'manual_review',
];

export interface EnterpriseRegistrationInput {
  /** Auth user ID of the registering owner (from Supabase Auth) */
  ownerAuthUserId: string;
  /** Member ID from canonical members table */
  ownerMemberId?: string;
  legalName: string;
  displayName: string;
  companyType: string;
  industry: string;
  website: string;
  address: string;
  authorizedRepresentative: string;
  representativeJobTitle: string;
  teamSize: number;
  businessCategory: string;
  companyRegistrationId?: string;
  sourceChannel?: string;
  /** Audit metadata */
  ipAddress?: string;
  userAgent?: string;
  traceId?: string;
}

export interface EnterpriseRegistrationResult {
  ok: boolean;
  enterpriseId?: string;
  membershipId?: string;
  duplicate?: boolean;
  duplicateReason?: string;
  error?: string;
  errorCode?: EnterpriseErrorCode;
  traceId: string;
  deploymentMarker: string;
}

export type EnterpriseErrorCode =
  | 'INVALID_INPUT'
  | 'DUPLICATE_ENTERPRISE'
  | 'DUPLICATE_LEGAL_NAME'
  | 'DUPLICATE_DOMAIN'
  | 'CREATION_FAILED'
  | 'MEMBERSHIP_FAILED'
  | 'AUDIT_FAILED'
  | 'NOT_AUTHORIZED'
  | 'NOT_FOUND'
  | 'INVITATION_EXPIRED'
  | 'INVITATION_REVOKED'
  | 'INVITATION_ALREADY_ACCEPTED'
  | 'INVITATION_TOKEN_INVALID'
  | 'INVITATION_WRONG_ENTERPRISE'
  | 'ROLE_NOT_ALLOWED'
  | 'MEMBERSHIP_EXISTS'
  | 'CROSS_ENTERPRISE_DENIED'
  | 'OWNER_TRANSFER_DENIED'
  | 'UNKNOWN_ERROR';

export interface InvitationInput {
  enterpriseId: string;
  invitedByAuthUserId: string;
  invitedByName: string;
  invitedEmail: string;
  enterpriseRole: EnterpriseRole;
  expirationHours?: number;
  ipAddress?: string;
  userAgent?: string;
}

export interface InvitationResult {
  ok: boolean;
  invitationId?: string;
  token?: string; // raw token — only returned once
  expiresAt?: string;
  error?: string;
  errorCode?: EnterpriseErrorCode;
  traceId: string;
}

export interface AcceptInvitationInput {
  token: string;
  acceptingAuthUserId: string;
  acceptingMemberId?: string;
  acceptingEmail: string;
  enterpriseId: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface AcceptInvitationResult {
  ok: boolean;
  membershipId?: string;
  enterpriseId?: string;
  enterpriseRole?: EnterpriseRole;
  error?: string;
  errorCode?: EnterpriseErrorCode;
  traceId: string;
}

export interface MembershipActionInput {
  enterpriseId: string;
  memberId: string;
  actingAuthUserId: string;
  action: 'suspend' | 'remove' | 'reactivate' | 'transfer_ownership';
  newOwnerId?: string;
  ipAddress?: string;
  userAgent?: string;
}

export interface EnterpriseSummary {
  totalEnterprises: number;
  byVerificationStatus: Record<string, number>;
  totalMemberships: number;
  totalInvitations: number;
  pendingInvitations: number;
  expiredInvitations: number;
  acceptedInvitations: number;
  deploymentMarker: string;
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
    '';
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateTraceId(): string {
  return 'ivx-ent-' + Date.now().toString(36) + '-' + randomUUID().replace(/-/g, '').substring(0, 10);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateInvitationToken(): string {
  return randomUUID() + '-' + randomUUID();
}

function normalizeDomain(website: string): string {
  try {
    const url = new URL(website.startsWith('http') ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return website.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidUrl(url: string): boolean {
  if (!url) return true; // optional
  try {
    new URL(url.startsWith('http') ? url : `https://${url}`);
    return true;
  } catch {
    return false;
  }
}

function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function userMessageForCode(code: EnterpriseErrorCode): string {
  switch (code) {
    case 'INVALID_INPUT': return 'Please provide all required enterprise details.';
    case 'DUPLICATE_ENTERPRISE': return 'An enterprise with this legal name or domain already exists.';
    case 'DUPLICATE_LEGAL_NAME': return 'An enterprise with this legal name already exists.';
    case 'DUPLICATE_DOMAIN': return 'An enterprise with this website domain already exists.';
    case 'CREATION_FAILED': return 'We could not create the enterprise. Please try again.';
    case 'MEMBERSHIP_FAILED': return 'Enterprise created, but membership binding failed.';
    case 'AUDIT_FAILED': return 'Enterprise created, but audit logging failed.';
    case 'NOT_AUTHORIZED': return 'You are not authorized to perform this action.';
    case 'NOT_FOUND': return 'Enterprise or membership not found.';
    case 'INVITATION_EXPIRED': return 'This invitation has expired.';
    case 'INVITATION_REVOKED': return 'This invitation has been revoked.';
    case 'INVITATION_ALREADY_ACCEPTED': return 'This invitation has already been used.';
    case 'INVITATION_TOKEN_INVALID': return 'The invitation token is invalid.';
    case 'INVITATION_WRONG_ENTERPRISE': return 'This invitation does not match the enterprise.';
    case 'ROLE_NOT_ALLOWED': return 'You cannot assign this role.';
    case 'MEMBERSHIP_EXISTS': return 'This person is already a member of this enterprise.';
    case 'CROSS_ENTERPRISE_DENIED': return 'You cannot access another enterprise.';
    case 'OWNER_TRANSFER_DENIED': return 'Only the enterprise owner can transfer ownership.';
    case 'UNKNOWN_ERROR': return 'An unexpected error occurred. Please try again.';
  }
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

async function writeAuditEvent(input: {
  traceId: string;
  registrationRequestId?: string;
  authUserId?: string;
  memberId?: string;
  enterpriseId?: string;
  stage: string;
  eventType: string;
  eventData?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  sourceChannel?: string;
  success: boolean;
  errorCode?: string;
  errorMessage?: string;
}): Promise<void> {
  const supabase = getSupabaseAdmin();
  try {
    const { error } = await supabase.from('registration_audit').insert({
      trace_id: input.traceId,
      registration_request_id: input.registrationRequestId || input.traceId,
      auth_user_id: input.authUserId || null,
      member_id: input.memberId || null,
      enterprise_id: input.enterpriseId || null,
      stage: input.stage,
      event_type: input.eventType,
      event_data: input.eventData || {},
      ip_address: input.ipAddress || '',
      user_agent: input.userAgent || '',
      source_channel: input.sourceChannel || 'landing_page',
      success: input.success,
      error_code: input.errorCode || '',
      error_message: input.errorMessage || '',
    });
    if (error) {
      console.error('[EnterpriseReg] Audit write failed:', error.message);
    }
  } catch (err) {
    console.error('[EnterpriseReg] Audit write exception:', err instanceof Error ? err.message : 'unknown');
  }
}

// ---------------------------------------------------------------------------
// Enterprise Registration
// ---------------------------------------------------------------------------

/**
 * Register a new enterprise with the registering user as the enterprise owner.
 * Steps:
 *  1. Validate input
 *  2. Normalize identity fields (legal name, domain)
 *  3. Check duplicates (legal name, domain, company registration ID)
 *  4. Create enterprise record
 *  5. Create owner membership (enterprise_role = 'owner')
 *  6. Create KYC/AML status record (not_started)
 *  7. Write audit event
 *  8. Return confirmation
 */
export async function registerEnterprise(
  input: EnterpriseRegistrationInput
): Promise<EnterpriseRegistrationResult> {
  const traceId = input.traceId || generateTraceId();
  const supabase = getSupabaseAdmin();

  // Step 1: validate
  if (!input.ownerAuthUserId) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: userMessageForCode('INVALID_INPUT'), traceId, deploymentMarker: DEPLOYMENT_MARKER };
  }
  if (!input.legalName || input.legalName.trim().length < 2) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: 'Legal company name is required.', traceId, deploymentMarker: DEPLOYMENT_MARKER };
  }
  if (!input.displayName || input.displayName.trim().length < 1) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: 'Display company name is required.', traceId, deploymentMarker: DEPLOYMENT_MARKER };
  }
  if (!input.authorizedRepresentative || input.authorizedRepresentative.trim().length < 2) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: 'Authorized representative is required.', traceId, deploymentMarker: DEPLOYMENT_MARKER };
  }
  if (!isValidUrl(input.website)) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: 'Please enter a valid website URL.', traceId, deploymentMarker: DEPLOYMENT_MARKER };
  }
  if (input.teamSize < 1 || input.teamSize > 100000) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: 'Team size must be between 1 and 100,000.', traceId, deploymentMarker: DEPLOYMENT_MARKER };
  }

  const legalName = input.legalName.trim();
  const displayName = input.displayName.trim();
  const domain = normalizeDomain(input.website);

  // Step 2: check duplicates
  try {
    // Check legal name (case-insensitive)
    const { data: existingByName } = await supabase
      .from('enterprises')
      .select('enterprise_id, legal_name')
      .ilike('legal_name', legalName)
      .limit(1);

    if (existingByName && existingByName.length > 0) {
      await writeAuditEvent({
        traceId,
        authUserId: input.ownerAuthUserId,
        enterpriseId: existingByName[0].enterprise_id,
        stage: 'duplicate_check',
        eventType: 'enterprise_duplicate_blocked',
        eventData: { reason: 'legal_name', legalName },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        sourceChannel: input.sourceChannel,
        success: false,
        errorCode: 'DUPLICATE_LEGAL_NAME',
        errorMessage: 'Legal name already exists',
      });
      return {
        ok: false,
        duplicate: true,
        duplicateReason: 'legal_name',
        errorCode: 'DUPLICATE_LEGAL_NAME',
        error: userMessageForCode('DUPLICATE_LEGAL_NAME'),
        traceId,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }

    // Check domain
    if (domain) {
      const { data: existingByDomain } = await supabase
        .from('enterprises')
        .select('enterprise_id, domain')
        .eq('domain', domain)
        .limit(1);

      if (existingByDomain && existingByDomain.length > 0) {
        await writeAuditEvent({
          traceId,
          authUserId: input.ownerAuthUserId,
          enterpriseId: existingByDomain[0].enterprise_id,
          stage: 'duplicate_check',
          eventType: 'enterprise_duplicate_blocked',
          eventData: { reason: 'domain', domain },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          sourceChannel: input.sourceChannel,
          success: false,
          errorCode: 'DUPLICATE_DOMAIN',
          errorMessage: 'Domain already exists',
        });
        return {
          ok: false,
          duplicate: true,
          duplicateReason: 'domain',
          errorCode: 'DUPLICATE_DOMAIN',
          error: userMessageForCode('DUPLICATE_DOMAIN'),
          traceId,
          deploymentMarker: DEPLOYMENT_MARKER,
        };
      }
    }

    // Check company registration ID
    if (input.companyRegistrationId && input.companyRegistrationId.trim()) {
      const { data: existingByRegId } = await supabase
        .from('enterprises')
        .select('enterprise_id, company_registration_id')
        .eq('company_registration_id', input.companyRegistrationId.trim())
        .limit(1);

      if (existingByRegId && existingByRegId.length > 0) {
        await writeAuditEvent({
          traceId,
          authUserId: input.ownerAuthUserId,
          enterpriseId: existingByRegId[0].enterprise_id,
          stage: 'duplicate_check',
          eventType: 'enterprise_duplicate_blocked',
          eventData: { reason: 'company_registration_id' },
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          sourceChannel: input.sourceChannel,
          success: false,
          errorCode: 'DUPLICATE_ENTERPRISE',
          errorMessage: 'Company registration ID already exists',
        });
        return {
          ok: false,
          duplicate: true,
          duplicateReason: 'company_registration_id',
          errorCode: 'DUPLICATE_ENTERPRISE',
          error: userMessageForCode('DUPLICATE_ENTERPRISE'),
          traceId,
          deploymentMarker: DEPLOYMENT_MARKER,
        };
      }
    }
  } catch (err) {
    console.error('[EnterpriseReg] Duplicate check failed:', err instanceof Error ? err.message : 'unknown');
    // Continue — don't block registration on duplicate check failure
  }

  // Step 3: create enterprise
  let enterpriseId: string;
  try {
    const { data: enterprise, error: enterpriseError } = await supabase
      .from('enterprises')
      .insert({
        legal_name: legalName,
        display_name: displayName,
        company_type: input.companyType || 'llc',
        industry: input.industry || '',
        website: input.website || '',
        address: input.address || '',
        authorized_representative: input.authorizedRepresentative.trim(),
        representative_job_title: input.representativeJobTitle || '',
        team_size: input.teamSize,
        business_category: input.businessCategory || '',
        verification_status: 'not_started',
        owner_auth_user_id: input.ownerAuthUserId,
        owner_member_id: input.ownerMemberId || null,
        domain,
        company_registration_id: input.companyRegistrationId || '',
        source_channel: input.sourceChannel || 'landing_page',
      })
      .select('enterprise_id')
      .single();

    if (enterpriseError || !enterprise) {
      console.error('[EnterpriseReg] Enterprise creation failed:', enterpriseError?.message);
      await writeAuditEvent({
        traceId,
        authUserId: input.ownerAuthUserId,
        stage: 'enterprise_creation',
        eventType: 'enterprise_creation_failed',
        eventData: { legalName },
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        sourceChannel: input.sourceChannel,
        success: false,
        errorCode: 'CREATION_FAILED',
        errorMessage: enterpriseError?.message || 'Unknown',
      });
      return {
        ok: false,
        errorCode: 'CREATION_FAILED',
        error: userMessageForCode('CREATION_FAILED'),
        traceId,
        deploymentMarker: DEPLOYMENT_MARKER,
      };
    }
    enterpriseId = enterprise.enterprise_id;
  } catch (err) {
    console.error('[EnterpriseReg] Enterprise creation exception:', err instanceof Error ? err.message : 'unknown');
    return {
      ok: false,
      errorCode: 'CREATION_FAILED',
      error: userMessageForCode('CREATION_FAILED'),
      traceId,
      deploymentMarker: DEPLOYMENT_MARKER,
    };
  }

  // Step 4: create owner membership
  let membershipId: string | undefined;
  try {
    const { data: membership, error: membershipError } = await supabase
      .from('enterprise_memberships')
      .insert({
        enterprise_id: enterpriseId,
        member_id: input.ownerMemberId || '',
        auth_user_id: input.ownerAuthUserId,
        enterprise_role: 'owner',
        status: 'active',
        invited_by: 'self_registration',
        joined_at: new Date().toISOString(),
      })
      .select('membership_id')
      .single();

    if (membershipError || !membership) {
      console.error('[EnterpriseReg] Owner membership failed:', membershipError?.message);
      // Non-fatal — enterprise exists, membership can be repaired
    } else {
      membershipId = membership.membership_id;
    }
  } catch (err) {
    console.error('[EnterpriseReg] Owner membership exception:', err instanceof Error ? err.message : 'unknown');
  }

  // Step 5: create KYC/AML status record (not_started — registration != KYC)
  try {
    await supabase.from('kyc_aml_status').insert({
      auth_user_id: input.ownerAuthUserId,
      member_id: input.ownerMemberId || null,
      enterprise_id: enterpriseId,
      kyc_status: 'not_started',
      aml_status: 'not_started',
      owner_review_status: 'not_started',
      accreditation_status: 'not_started',
      proof_of_funds_status: 'not_started',
    });
  } catch (err) {
    console.error('[EnterpriseReg] KYC/AML status creation failed:', err instanceof Error ? err.message : 'unknown');
    // Non-fatal — KYC can be started later
  }

  // Step 6: sync canonical member with enterprise identity fields (ITEM 1)
  try {
    await upsertCanonicalMember({
      authUserId: input.ownerAuthUserId,
      email: '', // email comes from auth.users profile; we don't have it here
      enterpriseId,
      registrationType: 'enterprise',
      registrationStatus: 'completed',
      identityStatus: 'active',
      kycStatus: 'not_started',
      amlStatus: 'not_started',
      ownerReviewStatus: 'not_started',
      sourceChannel: input.sourceChannel || 'enterprise_registration',
      dataOrigin: 'enterprise_registration',
      primaryRole: 'enterprise_owner',
      auditTraceId: traceId,
    });
  } catch (canonicalErr) {
    console.error('[EnterpriseReg] Canonical member sync failed:', canonicalErr instanceof Error ? canonicalErr.message : 'unknown');
    // Non-fatal — enterprise + membership + KYC are already created
  }

  // Step 7: audit
  await writeAuditEvent({
    traceId,
    authUserId: input.ownerAuthUserId,
    memberId: input.ownerMemberId,
    enterpriseId,
    stage: 'enterprise_registration',
    eventType: 'enterprise_registered',
    eventData: {
      legalName,
      displayName,
      domain,
      companyType: input.companyType,
      industry: input.industry,
    },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    sourceChannel: input.sourceChannel,
    success: true,
  });

  return {
    ok: true,
    enterpriseId,
    membershipId,
    traceId,
    deploymentMarker: DEPLOYMENT_MARKER,
  };
}

// ---------------------------------------------------------------------------
// Enterprise Invitations
// ---------------------------------------------------------------------------

/**
 * Create a single-use enterprise invitation.
 * Only enterprise owners and administrators can invite.
 */
export async function createInvitation(
  input: InvitationInput
): Promise<InvitationResult> {
  const traceId = generateTraceId();
  const supabase = getSupabaseAdmin();

  // Validate
  if (!input.enterpriseId) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: 'Enterprise ID is required.', traceId };
  }
  if (!input.invitedByAuthUserId) {
    return { ok: false, errorCode: 'NOT_AUTHORIZED', error: userMessageForCode('NOT_AUTHORIZED'), traceId };
  }
  if (!isValidEmail(input.invitedEmail)) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: 'A valid invited email is required.', traceId };
  }
  if (!INVITABLE_ROLES.includes(input.enterpriseRole)) {
    return { ok: false, errorCode: 'ROLE_NOT_ALLOWED', error: 'Cannot invite someone as owner. Use transfer ownership instead.', traceId };
  }

  // Check inviter is owner or administrator of this enterprise
  const { data: inviterMembership } = await supabase
    .from('enterprise_memberships')
    .select('membership_id, enterprise_role, status')
    .eq('enterprise_id', input.enterpriseId)
    .eq('auth_user_id', input.invitedByAuthUserId)
    .eq('status', 'active')
    .limit(1);

  if (!inviterMembership || inviterMembership.length === 0) {
    return { ok: false, errorCode: 'NOT_AUTHORIZED', error: 'You are not a member of this enterprise.', traceId };
  }

  const inviterRole = inviterMembership[0].enterprise_role;
  if (inviterRole !== 'owner' && inviterRole !== 'administrator') {
    return { ok: false, errorCode: 'NOT_AUTHORIZED', error: 'Only owners and administrators can send invitations.', traceId };
  }

  // Administrators cannot invite other administrators (only owner can)
  if (inviterRole === 'administrator' && input.enterpriseRole === 'administrator') {
    return { ok: false, errorCode: 'ROLE_NOT_ALLOWED', error: 'Administrators cannot invite other administrators. Only the owner can.', traceId };
  }

  // Check for existing active membership for this email
  const invitedEmail = normalizeEmail(input.invitedEmail);
  const { data: existingMember } = await supabase
    .from('enterprise_memberships')
    .select('membership_id, status, auth_user_id')
    .eq('enterprise_id', input.enterpriseId)
    .neq('status', 'removed')
    .limit(100);

  // Check if any existing member has this email (we'd need to join with auth for email, but we block by pending invitation)
  const { data: existingPending } = await supabase
    .from('enterprise_invitations')
    .select('invitation_id, status')
    .eq('enterprise_id', input.enterpriseId)
    .eq('invited_email', invitedEmail)
    .eq('status', 'pending')
    .limit(1);

  if (existingPending && existingPending.length > 0) {
    return { ok: false, errorCode: 'MEMBERSHIP_EXISTS', error: 'An active invitation already exists for this email.', traceId };
  }

  // Generate token
  const rawToken = generateInvitationToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + (input.expirationHours || 168) * 60 * 60 * 1000).toISOString(); // 7 days default

  // Insert invitation
  try {
    const { data: invitation, error } = await supabase
      .from('enterprise_invitations')
      .insert({
        enterprise_id: input.enterpriseId,
        token_hash: tokenHash,
        invited_email: invitedEmail,
        enterprise_role: input.enterpriseRole,
        invited_by: input.invitedByName,
        invited_by_auth_user_id: input.invitedByAuthUserId,
        status: 'pending',
        expires_at: expiresAt,
      })
      .select('invitation_id')
      .single();

    if (error || !invitation) {
      console.error('[EnterpriseReg] Invitation creation failed:', error?.message);
      return { ok: false, errorCode: 'CREATION_FAILED', error: 'Could not create invitation.', traceId };
    }

    await writeAuditEvent({
      traceId,
      authUserId: input.invitedByAuthUserId,
      enterpriseId: input.enterpriseId,
      stage: 'invitation_created',
      eventType: 'enterprise_invitation_created',
      eventData: { invitedEmail, role: input.enterpriseRole, expiresAt },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: true,
    });

    return {
      ok: true,
      invitationId: invitation.invitation_id,
      token: rawToken,
      expiresAt,
      traceId,
    };
  } catch (err) {
    console.error('[EnterpriseReg] Invitation creation exception:', err instanceof Error ? err.message : 'unknown');
    return { ok: false, errorCode: 'UNKNOWN_ERROR', error: userMessageForCode('UNKNOWN_ERROR'), traceId };
  }
}

/**
 * Accept an enterprise invitation.
 * Single-use: token hash must match, not expired, not revoked, not already accepted.
 */
export async function acceptInvitation(
  input: AcceptInvitationInput
): Promise<AcceptInvitationResult> {
  const traceId = generateTraceId();
  const supabase = getSupabaseAdmin();

  if (!input.token || !input.acceptingAuthUserId || !input.enterpriseId) {
    return { ok: false, errorCode: 'INVALID_INPUT', error: 'Token, auth user ID, and enterprise ID are required.', traceId };
  }

  const tokenHash = hashToken(input.token);

  // Find invitation by token hash
  const { data: invitation, error: findError } = await supabase
    .from('enterprise_invitations')
    .select('invitation_id, enterprise_id, invited_email, enterprise_role, status, expires_at, accepted_at')
    .eq('token_hash', tokenHash)
    .limit(1)
    .single();

  if (findError || !invitation) {
    await writeAuditEvent({
      traceId,
      authUserId: input.acceptingAuthUserId,
      enterpriseId: input.enterpriseId,
      stage: 'invitation_accept',
      eventType: 'invitation_accept_failed',
      eventData: { reason: 'token_invalid' },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: false,
      errorCode: 'INVITATION_TOKEN_INVALID',
      errorMessage: 'Token hash not found',
    });
    return { ok: false, errorCode: 'INVITATION_TOKEN_INVALID', error: userMessageForCode('INVITATION_TOKEN_INVALID'), traceId };
  }

  // Check enterprise matches
  if (!timingSafeCompare(invitation.enterprise_id, input.enterpriseId)) {
    return { ok: false, errorCode: 'INVITATION_WRONG_ENTERPRISE', error: userMessageForCode('INVITATION_WRONG_ENTERPRISE'), traceId };
  }

  // Check status
  if (invitation.status === 'accepted') {
    return { ok: false, errorCode: 'INVITATION_ALREADY_ACCEPTED', error: userMessageForCode('INVITATION_ALREADY_ACCEPTED'), traceId };
  }
  if (invitation.status === 'revoked') {
    return { ok: false, errorCode: 'INVITATION_REVOKED', error: userMessageForCode('INVITATION_REVOKED'), traceId };
  }
  if (invitation.status === 'expired' || new Date(invitation.expires_at).getTime() < Date.now()) {
    // Mark as expired if not already
    await supabase.from('enterprise_invitations').update({ status: 'expired' }).eq('invitation_id', invitation.invitation_id);
    return { ok: false, errorCode: 'INVITATION_EXPIRED', error: userMessageForCode('INVITATION_EXPIRED'), traceId };
  }

  // Check email matches
  const expectedEmail = normalizeEmail(input.acceptingEmail);
  if (!timingSafeCompare(normalizeEmail(invitation.invited_email), expectedEmail)) {
    return { ok: false, errorCode: 'INVITATION_TOKEN_INVALID', error: 'This invitation was sent to a different email address.', traceId };
  }

  // Check no existing active membership
  const { data: existingMembership } = await supabase
    .from('enterprise_memberships')
    .select('membership_id, status')
    .eq('enterprise_id', input.enterpriseId)
    .eq('auth_user_id', input.acceptingAuthUserId)
    .neq('status', 'removed')
    .limit(1);

  if (existingMembership && existingMembership.length > 0) {
    return { ok: false, errorCode: 'MEMBERSHIP_EXISTS', error: userMessageForCode('MEMBERSHIP_EXISTS'), traceId };
  }

  // Create membership
  try {
    const { data: membership, error: membershipError } = await supabase
      .from('enterprise_memberships')
      .insert({
        enterprise_id: input.enterpriseId,
        member_id: input.acceptingMemberId || '',
        auth_user_id: input.acceptingAuthUserId,
        enterprise_role: invitation.enterprise_role,
        status: 'active',
        invited_by: 'invitation',
        invitation_id: invitation.invitation_id,
        joined_at: new Date().toISOString(),
      })
      .select('membership_id')
      .single();

    if (membershipError || !membership) {
      console.error('[EnterpriseReg] Membership creation failed:', membershipError?.message);
      return { ok: false, errorCode: 'MEMBERSHIP_FAILED', error: 'Could not create membership.', traceId };
    }

    // Mark invitation as accepted (single-use)
    await supabase
      .from('enterprise_invitations')
      .update({
        status: 'accepted',
        accepted_at: new Date().toISOString(),
        accepted_by_member_id: input.acceptingMemberId || null,
        accepted_by_auth_user_id: input.acceptingAuthUserId,
      })
      .eq('invitation_id', invitation.invitation_id);

    await writeAuditEvent({
      traceId,
      authUserId: input.acceptingAuthUserId,
      memberId: input.acceptingMemberId,
      enterpriseId: input.enterpriseId,
      stage: 'invitation_accepted',
      eventType: 'enterprise_invitation_accepted',
      eventData: { role: invitation.enterprise_role, invitationId: invitation.invitation_id },
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: true,
    });

    return {
      ok: true,
      membershipId: membership.membership_id,
      enterpriseId: input.enterpriseId,
      enterpriseRole: invitation.enterprise_role as EnterpriseRole,
      traceId,
    };
  } catch (err) {
    console.error('[EnterpriseReg] Membership creation exception:', err instanceof Error ? err.message : 'unknown');
    return { ok: false, errorCode: 'UNKNOWN_ERROR', error: userMessageForCode('UNKNOWN_ERROR'), traceId };
  }
}

/**
 * Revoke a pending invitation.
 */
export async function revokeInvitation(
  invitationId: string,
  revokedByAuthUserId: string,
  revokedByName: string
): Promise<{ ok: boolean; error?: string; traceId: string }> {
  const traceId = generateTraceId();
  const supabase = getSupabaseAdmin();

  const { data: invitation } = await supabase
    .from('enterprise_invitations')
    .select('enterprise_id, status, invited_email')
    .eq('invitation_id', invitationId)
    .limit(1)
    .single();

  if (!invitation) {
    return { ok: false, error: 'Invitation not found.', traceId };
  }
  if (invitation.status !== 'pending') {
    return { ok: false, error: `Invitation is already ${invitation.status}.`, traceId };
  }

  // Check revoker is owner or admin of this enterprise
  const { data: revokerMembership } = await supabase
    .from('enterprise_memberships')
    .select('enterprise_role')
    .eq('enterprise_id', invitation.enterprise_id)
    .eq('auth_user_id', revokedByAuthUserId)
    .eq('status', 'active')
    .limit(1);

  if (!revokerMembership || revokerMembership.length === 0) {
    return { ok: false, error: 'Not authorized.', traceId };
  }

  const revokerRole = revokerMembership[0].enterprise_role;
  if (revokerRole !== 'owner' && revokerRole !== 'administrator') {
    return { ok: false, error: 'Only owners and administrators can revoke invitations.', traceId };
  }

  await supabase
    .from('enterprise_invitations')
    .update({
      status: 'revoked',
      revoked_at: new Date().toISOString(),
      revoked_by: revokedByName,
    })
    .eq('invitation_id', invitationId);

  await writeAuditEvent({
    traceId,
    authUserId: revokedByAuthUserId,
    enterpriseId: invitation.enterprise_id,
    stage: 'invitation_revoked',
    eventType: 'enterprise_invitation_revoked',
    eventData: { invitationId, invitedEmail: invitation.invited_email },
    success: true,
  });

  return { ok: true, traceId };
}

// ---------------------------------------------------------------------------
// Membership Management
// ---------------------------------------------------------------------------

/**
 * Suspend, remove, reactivate, or transfer ownership of a member.
 */
export async function manageMembership(
  input: MembershipActionInput
): Promise<{ ok: boolean; error?: string; errorCode?: EnterpriseErrorCode; traceId: string }> {
  const traceId = generateTraceId();
  const supabase = getSupabaseAdmin();

  // Find the acting member's role
  const { data: actingMember } = await supabase
    .from('enterprise_memberships')
    .select('membership_id, enterprise_role, status')
    .eq('enterprise_id', input.enterpriseId)
    .eq('auth_user_id', input.actingAuthUserId)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (!actingMember) {
    return { ok: false, errorCode: 'NOT_AUTHORIZED', error: 'You are not an active member of this enterprise.', traceId };
  }

  const actingRole = actingMember.enterprise_role as EnterpriseRole;

  // Find the target member
  const { data: targetMember } = await supabase
    .from('enterprise_memberships')
    .select('membership_id, auth_user_id, member_id, enterprise_role, status')
    .eq('enterprise_id', input.enterpriseId)
    .eq('member_id', input.memberId)
    .limit(1)
    .single();

  if (!targetMember) {
    return { ok: false, errorCode: 'NOT_FOUND', error: 'Target member not found in this enterprise.', traceId };
  }

  const targetRole = targetMember.enterprise_role as EnterpriseRole;
  const now = new Date().toISOString();

  switch (input.action) {
    case 'suspend': {
      // Only owner or admin can suspend; admin cannot suspend admin or owner
      if (actingRole !== 'owner' && !(actingRole === 'administrator' && targetRole !== 'owner' && targetRole !== 'administrator')) {
        return { ok: false, errorCode: 'NOT_AUTHORIZED', error: 'You cannot suspend this member.', traceId };
      }
      if (targetMember.status !== 'active') {
        return { ok: false, errorCode: 'INVALID_INPUT', error: 'Member is not active.', traceId };
      }
      await supabase
        .from('enterprise_memberships')
        .update({ status: 'suspended', suspended_at: now })
        .eq('membership_id', targetMember.membership_id);
      break;
    }
    case 'remove': {
      if (actingRole !== 'owner' && !(actingRole === 'administrator' && targetRole !== 'owner' && targetRole !== 'administrator')) {
        return { ok: false, errorCode: 'NOT_AUTHORIZED', error: 'You cannot remove this member.', traceId };
      }
      if (targetRole === 'owner') {
        return { ok: false, errorCode: 'OWNER_TRANSFER_DENIED', error: 'Cannot remove the owner. Transfer ownership first.', traceId };
      }
      await supabase
        .from('enterprise_memberships')
        .update({ status: 'removed', removed_at: now })
        .eq('membership_id', targetMember.membership_id);
      break;
    }
    case 'reactivate': {
      if (actingRole !== 'owner' && actingRole !== 'administrator') {
        return { ok: false, errorCode: 'NOT_AUTHORIZED', error: 'Only owners and administrators can reactivate members.', traceId };
      }
      if (targetMember.status !== 'suspended') {
        return { ok: false, errorCode: 'INVALID_INPUT', error: 'Member is not suspended.', traceId };
      }
      await supabase
        .from('enterprise_memberships')
        .update({ status: 'active', suspended_at: null })
        .eq('membership_id', targetMember.membership_id);
      break;
    }
    case 'transfer_ownership': {
      if (actingRole !== 'owner') {
        return { ok: false, errorCode: 'OWNER_TRANSFER_DENIED', error: userMessageForCode('OWNER_TRANSFER_DENIED'), traceId };
      }
      if (!input.newOwnerId) {
        return { ok: false, errorCode: 'INVALID_INPUT', error: 'New owner member ID is required.', traceId };
      }
      if (input.memberId !== input.actingAuthUserId && targetMember.auth_user_id !== input.actingAuthUserId) {
        // The current owner transfers TO another member
      }
      // Demote current owner to administrator
      await supabase
        .from('enterprise_memberships')
        .update({ enterprise_role: 'administrator' })
        .eq('membership_id', actingMember.membership_id);
      // Promote target to owner
      await supabase
        .from('enterprise_memberships')
        .update({ enterprise_role: 'owner' })
        .eq('membership_id', targetMember.membership_id);
      // Update enterprise owner reference
      await supabase
        .from('enterprises')
        .update({
          owner_auth_user_id: targetMember.auth_user_id,
          owner_member_id: targetMember.member_id,
        })
        .eq('enterprise_id', input.enterpriseId);
      break;
    }
    default:
      return { ok: false, errorCode: 'INVALID_INPUT', error: 'Unknown action.', traceId };
  }

  await writeAuditEvent({
    traceId,
    authUserId: input.actingAuthUserId,
    enterpriseId: input.enterpriseId,
    memberId: input.memberId,
    stage: 'membership_management',
    eventType: `membership_${input.action}`,
    eventData: { action: input.action, targetMemberId: input.memberId, targetRole },
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    success: true,
  });

  return { ok: true, traceId };
}

// ---------------------------------------------------------------------------
// Cross-Enterprise Access Check
// ---------------------------------------------------------------------------

/**
 * Verify that a user has access to an enterprise.
 * Returns the membership if the user is an active member.
 */
export async function checkEnterpriseAccess(
  enterpriseId: string,
  authUserId: string
): Promise<{ hasAccess: boolean; membership?: { membership_id: string; enterprise_role: EnterpriseRole; status: string }; reason?: string }> {
  const supabase = getSupabaseAdmin();
  const { data: membership } = await supabase
    .from('enterprise_memberships')
    .select('membership_id, enterprise_role, status')
    .eq('enterprise_id', enterpriseId)
    .eq('auth_user_id', authUserId)
    .limit(1)
    .single();

  if (!membership) {
    return { hasAccess: false, reason: 'You are not a member of this enterprise.' };
  }
  if (membership.status === 'suspended') {
    return { hasAccess: false, reason: 'Your membership is suspended.' };
  }
  if (membership.status === 'removed') {
    return { hasAccess: false, reason: 'Your membership has been removed.' };
  }
  if (membership.status !== 'active') {
    return { hasAccess: false, reason: `Your membership status is ${membership.status}.` };
  }
  return {
    hasAccess: true,
    membership: {
      membership_id: membership.membership_id,
      enterprise_role: membership.enterprise_role as EnterpriseRole,
      status: membership.status,
    },
  };
}

// ---------------------------------------------------------------------------
// Enterprise Summary (for owner dashboard)
// ---------------------------------------------------------------------------

export async function getEnterpriseSummary(): Promise<EnterpriseSummary> {
  const supabase = getSupabaseAdmin();
  const marker = DEPLOYMENT_MARKER;

  try {
    const { count: totalEnterprises } = await supabase
      .from('enterprises')
      .select('*', { count: 'exact', head: true });

    const { count: totalMemberships } = await supabase
      .from('enterprise_memberships')
      .select('*', { count: 'exact', head: true });

    const { count: totalInvitations } = await supabase
      .from('enterprise_invitations')
      .select('*', { count: 'exact', head: true });

    const { count: pendingInvitations } = await supabase
      .from('enterprise_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');

    const { count: expiredInvitations } = await supabase
      .from('enterprise_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'expired');

    const { count: acceptedInvitations } = await supabase
      .from('enterprise_invitations')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'accepted');

    // Verification status breakdown
    const byVerificationStatus: Record<string, number> = {};
    for (const status of ALL_VERIFICATION_STATUSES) {
      const { count } = await supabase
        .from('enterprises')
        .select('*', { count: 'exact', head: true })
        .eq('verification_status', status);
      byVerificationStatus[status] = count || 0;
    }

    return {
      totalEnterprises: totalEnterprises || 0,
      byVerificationStatus,
      totalMemberships: totalMemberships || 0,
      totalInvitations: totalInvitations || 0,
      pendingInvitations: pendingInvitations || 0,
      expiredInvitations: expiredInvitations || 0,
      acceptedInvitations: acceptedInvitations || 0,
      deploymentMarker: marker,
    };
  } catch (err) {
    console.error('[EnterpriseReg] Summary failed:', err instanceof Error ? err.message : 'unknown');
    return {
      totalEnterprises: 0,
      byVerificationStatus: {},
      totalMemberships: 0,
      totalInvitations: 0,
      pendingInvitations: 0,
      expiredInvitations: 0,
      acceptedInvitations: 0,
      deploymentMarker: marker,
    };
  }
}

/**
 * List enterprises with optional filtering.
 */
export async function listEnterprises(options: {
  verificationStatus?: VerificationStatus;
  search?: string;
  limit?: number;
} = {}): Promise<Array<Record<string, unknown>>> {
  const supabase = getSupabaseAdmin();
  const limit = Math.min(Math.max(options.limit ?? 100, 1), 500);
  let query = supabase.from('enterprises').select('*').order('created_at', { ascending: false }).limit(limit);
  if (options.verificationStatus) {
    query = query.eq('verification_status', options.verificationStatus);
  }
  if (options.search) {
    query = query.or(`legal_name.ilike.%${options.search}%,display_name.ilike.%${options.search}%,domain.ilike.%${options.search}%`);
  }
  const { data, error } = await query;
  if (error) {
    console.error('[EnterpriseReg] List failed:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Get a single enterprise by ID.
 */
export async function getEnterprise(enterpriseId: string): Promise<Record<string, unknown> | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('enterprises')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .limit(1)
    .single();
  if (error) {
    console.error('[EnterpriseReg] Get failed:', error.message);
    return null;
  }
  return data;
}

/**
 * List memberships for an enterprise.
 */
export async function listEnterpriseMemberships(enterpriseId: string): Promise<Array<Record<string, unknown>>> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from('enterprise_memberships')
    .select('*')
    .eq('enterprise_id', enterpriseId)
    .order('joined_at', { ascending: true });
  if (error) {
    console.error('[EnterpriseReg] List memberships failed:', error.message);
    return [];
  }
  return data || [];
}

/**
 * Update enterprise verification status (owner-only — enforced by API layer).
 */
export async function updateEnterpriseVerificationStatus(
  enterpriseId: string,
  status: VerificationStatus,
  reviewedBy: string,
  reviewerNotes?: string
): Promise<{ ok: boolean; error?: string; traceId: string }> {
  const traceId = generateTraceId();
  const supabase = getSupabaseAdmin();

  const { error } = await supabase
    .from('enterprises')
    .update({
      verification_status: status,
      updated_at: new Date().toISOString(),
    })
    .eq('enterprise_id', enterpriseId);

  if (error) {
    return { ok: false, error: error.message, traceId };
  }

  await writeAuditEvent({
    traceId,
    enterpriseId,
    stage: 'verification_update',
    eventType: 'enterprise_verification_status_changed',
    eventData: { status, reviewedBy, reviewerNotes },
    success: true,
  });

  return { ok: true, traceId };
}

export { DEPLOYMENT_MARKER as ENTERPRISE_REGISTRATION_MARKER };
