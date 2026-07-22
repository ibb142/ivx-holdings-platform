/**
 * IVX Member Registration API Handlers
 *
 * Endpoints:
 *   POST /api/members/register         - Create free account
 *   POST /api/members/send-email-code  - Generate + send email verification code
 *   POST /api/members/verify-email     - Verify email code
 *   POST /api/members/send-phone-code  - Generate + send phone verification code
 *   POST /api/members/verify-phone     - Verify phone code
 *   GET  /api/members/me               - Get current member profile
 *   POST /api/members/start-kyc        - Initiate KYC process
 */

import {
  registerMember,
  getMemberProfile,
  updateMemberKYCStatus,
  updateMemberLastLogin,
  loginMember,
  requestMemberPasswordReset,
  resetMemberPasswordWithToken,
  updateMemberProfile,
} from '../services/ivx-member-database';
import { storeVerificationCode, verifyCode, checkVerificationStatus } from '../services/ivx-member-verification';
import { onboardNewMember, VALID_ROLE_INTERESTS, type MemberRoleInterest } from '../services/ivx-member-investor-system';
import { upsertCanonicalMember, markCanonicalMemberVerified } from '../services/ivx-canonical-members';
import {
  orchestrateRegistration,
  getRegistrationStatus,
  checkRegistrationHealth,
  getRegistrationMetrics,
  type RegistrationRequestInput,
  type NormalizedRegistrationResult,
  type RegistrationStage,
  type RegistrationErrorCode,
} from '../services/ivx-registration-orchestrator';

const DEPLOYMENT_MARKER = 'ivx-members-api-v1';

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

function getAuthUserId(request: Request): string | null {
  const authHeader = request.headers.get('Authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

// Validate email format
function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Validate date of birth: required, ISO YYYY-MM-DD, real calendar date, age 18-120
function validateDateOfBirth(dateOfBirth: string): { valid: boolean; reason?: string } {
  if (!dateOfBirth) return { valid: false, reason: 'Date of birth is required.' };
  const match = dateOfBirth.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return { valid: false, reason: 'Date of birth must be in YYYY-MM-DD format.' };
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return { valid: false, reason: 'Please enter a valid date of birth.' };
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) return { valid: false, reason: 'Please enter a valid date of birth.' };
  const now = new Date();
  let age = now.getUTCFullYear() - year;
  const hadBirthdayThisYear =
    now.getUTCMonth() + 1 > month || (now.getUTCMonth() + 1 === month && now.getUTCDate() >= day);
  if (!hadBirthdayThisYear) age -= 1;
  if (age < 18) return { valid: false, reason: 'You must be at least 18 years old to create an account.' };
  if (age > 120) return { valid: false, reason: 'Please enter a valid date of birth.' };
  return { valid: true };
}

const VALID_GENDERS = new Set(['male', 'female', 'prefer_not_to_say']);

// Validate gender: required, must be one of the allowed values
function validateGender(gender: string): { valid: boolean; reason?: string } {
  if (!gender) return { valid: false, reason: 'Gender is required.' };
  if (!VALID_GENDERS.has(gender)) {
    return { valid: false, reason: 'Please select a valid gender option.' };
  }
  return { valid: true };
}

// Validate password strength
function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8) return { valid: false, reason: 'Password must be at least 8 characters.' };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain at least 1 uppercase letter.' };
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain at least 1 number.' };
  return { valid: true };
}

export function membersOptions(): Response {
  return jsonResponse({ deploymentMarker: DEPLOYMENT_MARKER }, 204);
}

// POST /api/members/register
// Phase 2 reliability: accepts `registrationRequestId` for idempotency + resume.
// Returns the normalized { ok, code, message, traceId, stage, retryable, ... } contract.
export async function handleMemberRegister(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const email = asString(body.email).toLowerCase();
  const password = asString(body.password);
  const firstName = asString(body.firstName);
  const lastName = asString(body.lastName);
  const phone = asString(body.phone);
  const country = asString(body.country);
  const zipCode = asString(body.zipCode);
  const roles: MemberRoleInterest[] = Array.isArray(body.roles)
    ? (body.roles.filter(
        (r): r is MemberRoleInterest => typeof r === 'string' && VALID_ROLE_INTERESTS.has(r as MemberRoleInterest)
      ))
    : [];
  const acceptTerms = !!body.acceptTerms;
  const pictureUrl = asString(body.pictureUrl);
  const dateOfBirth = asString(body.dateOfBirth);
  const gender = asString(body.gender).toLowerCase();
  const registrationRequestId = asString(body.registrationRequestId) || undefined;
  const opportunityId = asString(body.opportunityId) || undefined;
  const opportunityTitle = asString(body.opportunityTitle) || undefined;
  const amount = typeof body.amount === 'number' ? body.amount : undefined;
  const investmentType = asString(body.investmentType) || undefined;

  // Validation — returns the normalized error contract (no raw strings).
  // These are pre-orchestrator checks that never touch the network.
  if (!firstName || !lastName) {
    return normalizedError('INVALID_EMAIL', 'VALIDATING', { message: 'First name and last name are required.' });
  }
  if (!isValidEmail(email)) {
    return normalizedError('INVALID_EMAIL', 'VALIDATING', { message: 'Please enter a valid email address.' });
  }
  const pwCheck = validatePassword(password);
  if (!pwCheck.valid) {
    return normalizedError('WEAK_PASSWORD', 'VALIDATING', { message: pwCheck.reason || 'Password does not meet requirements.' });
  }
  if (!phone || phone.replace(/\D/g, '').length < 10) {
    return normalizedError('INVALID_EMAIL', 'VALIDATING', { message: 'Please enter a valid phone number.' });
  }
  if (!acceptTerms) {
    return normalizedError('UNKNOWN_ERROR', 'VALIDATING', { message: 'You must accept the Terms of Service.' });
  }
  const dobCheck = validateDateOfBirth(dateOfBirth);
  if (!dobCheck.valid) {
    return normalizedError('INVALID_EMAIL', 'VALIDATING', { message: dobCheck.reason || 'Please enter a valid date of birth.' });
  }
  const genderCheck = validateGender(gender);
  if (!genderCheck.valid) {
    return normalizedError('INVALID_EMAIL', 'VALIDATING', { message: genderCheck.reason || 'Gender is required.' });
  }
  if (roles.length === 0) {
    return normalizedError('UNKNOWN_ERROR', 'VALIDATING', { message: 'Please select at least one role to continue.' });
  }

  // Delegate to the idempotent orchestrator (Auth + profile + fanout + persistence).
  const input: RegistrationRequestInput = {
    email,
    password,
    firstName,
    lastName,
    dateOfBirth,
    gender,
    phone,
    country,
    zipCode,
    roles,
    acceptTerms,
    pictureUrl,
    registrationRequestId,
    opportunityId,
    opportunityTitle,
    amount,
    investmentType,
  };
  const result = await orchestrateRegistration(input);
  return normalizedResponse(result);
}

// --- Normalized response helpers (Phase 2 contract) ---

function normalizedError(code: RegistrationErrorCode, stage: RegistrationStage, overrides?: { message?: string; retryable?: boolean; registrationRequestId?: string }): Response {
  const traceId = 'ivx-reg-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10);
  const body = {
    ok: false as const,
    code,
    message: overrides?.message ?? code,
    traceId,
    stage,
    retryable: overrides?.retryable ?? false,
    registrationRequestId: overrides?.registrationRequestId,
    deploymentMarker: DEPLOYMENT_MARKER,
  };
  const status = code === 'EMAIL_EXISTS' ? 409 : code === 'RATE_LIMITED' ? 429 : (code === 'NETWORK_ERROR' || code === 'SERVICE_UNAVAILABLE') ? 503 : 400;
  return jsonResponse(body, status);
}

function normalizedResponse(result: NormalizedRegistrationResult): Response {
  if (result.ok) {
    // Fire-and-forget verification codes + onboarding fanout (kept identical to prior behavior).
    storeVerificationCode({ userId: result.authUserId, type: 'email' }).catch(() => {});
    storeVerificationCode({ userId: result.authUserId, type: 'phone' }).catch(() => {});
    return jsonResponse({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, 200);
  }
  const status = result.code === 'EMAIL_EXISTS' ? 409 : result.code === 'RATE_LIMITED' ? 429 : (result.code === 'NETWORK_ERROR' || result.code === 'SERVICE_UNAVAILABLE') ? 503 : 400;
  return jsonResponse({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, status);
}

// GET /api/ivx/registration/status?id=<registrationRequestId>
export async function handleRegistrationStatusRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const id = url.searchParams.get('id') || '';
  if (!id) {
    return normalizedError('UNKNOWN_ERROR', 'IDLE', { message: 'Registration request ID is required.' });
  }
  const { found, state } = await getRegistrationStatus(id);
  if (!found || !state) {
    return jsonResponse({ ok: false, found: false, message: 'No registration found for that ID.', traceId: 'ivx-reg-status-' + Date.now().toString(36), deploymentMarker: DEPLOYMENT_MARKER }, 404);
  }
  // Never expose the email hash or auth user ID directly — only stage + status.
  return jsonResponse({
    ok: true,
    found: true,
    registrationRequestId: state.registrationRequestId,
    stage: state.stage,
    finalStatus: state.finalStatus,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
    lastErrorCode: state.lastErrorCode,
    deploymentMarker: DEPLOYMENT_MARKER,
  }, 200);
}

// GET /api/ivx/registration/health
export async function handleRegistrationHealthRequest(request: Request): Promise<Response> {
  const authHeader = request.headers.get('Authorization') || '';
  const hasBearer = /^Bearer\s+.+$/i.test(authHeader);
  if (!hasBearer) {
    return jsonResponse({ ok: false, message: 'Owner authentication required for health.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }
  const health = await checkRegistrationHealth();
  return jsonResponse(health, health.status === 'healthy' ? 200 : 503);
}

// GET /api/ivx/registration/metrics — owner-only aggregate metrics (no PII, no secrets)
export async function handleRegistrationMetricsRequest(request: Request): Promise<Response> {
  const authHeader = request.headers.get('Authorization') || '';
  const hasBearer = /^Bearer\s+.+$/i.test(authHeader);
  if (!hasBearer) {
    return jsonResponse({ ok: false, message: 'Owner authentication required for metrics.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }
  const metrics = await getRegistrationMetrics();
  return jsonResponse({ ok: true, ...metrics }, 200);
}

// POST /api/members/send-email-code
export async function handleSendEmailCode(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = asString(body.userId) || getAuthUserId(request) || '';

  if (!userId) {
    return jsonResponse({ success: false, message: 'User ID is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const result = await storeVerificationCode({ userId, type: 'email' });
  return jsonResponse({
    success: result.success,
    message: result.success ? 'Verification code sent to your email.' : result.message,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

// POST /api/members/verify-email
export async function handleVerifyEmail(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = asString(body.userId) || getAuthUserId(request) || '';
  const code = asString(body.code);

  if (!userId || !code) {
    return jsonResponse({ success: false, message: 'User ID and code are required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  if (!/^\d{6}$/.test(code)) {
    return jsonResponse({ success: false, message: 'Please enter a valid 6-digit code.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const result = await verifyCode({ userId, type: 'email', code });
  if ((result as { success?: boolean; verified?: boolean }).success || (result as { verified?: boolean }).verified) {
    try {
      await markCanonicalMemberVerified({ authUserId: userId }, { emailVerified: true });
    } catch (syncErr) {
      console.error('[Members] Canonical email-verified sync failed (non-fatal):', syncErr);
    }
  }
  return jsonResponse(result);
}

// POST /api/members/send-phone-code
export async function handleSendPhoneCode(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = asString(body.userId) || getAuthUserId(request) || '';

  if (!userId) {
    return jsonResponse({ success: false, message: 'User ID is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const result = await storeVerificationCode({ userId, type: 'phone' });
  return jsonResponse({
    success: result.success,
    message: result.success ? 'Verification code sent to your phone.' : result.message,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

// POST /api/members/verify-phone
export async function handleVerifyPhone(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = asString(body.userId) || getAuthUserId(request) || '';
  const code = asString(body.code);

  if (!userId || !code) {
    return jsonResponse({ success: false, message: 'User ID and code are required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  if (!/^\d{6}$/.test(code)) {
    return jsonResponse({ success: false, message: 'Please enter a valid 6-digit code.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const result = await verifyCode({ userId, type: 'phone', code });
  if ((result as { success?: boolean; verified?: boolean }).success || (result as { verified?: boolean }).verified) {
    try {
      await markCanonicalMemberVerified({ authUserId: userId }, { smsVerified: true });
    } catch (syncErr) {
      console.error('[Members] Canonical SMS-verified sync failed (non-fatal):', syncErr);
    }
  }
  return jsonResponse(result);
}

// GET /api/members/me
export async function handleGetMemberProfile(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId') || getAuthUserId(request) || '';

  if (!userId) {
    return jsonResponse({ success: false, message: 'User ID is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const profile = await getMemberProfile(userId);
  if (!profile) {
    return jsonResponse({ success: false, message: 'Member not found.', deploymentMarker: DEPLOYMENT_MARKER }, 404);
  }

  const verification = await checkVerificationStatus(userId);

  return jsonResponse({
    success: true,
    profile: {
      ...profile,
      emailVerified: verification.emailVerified,
      phoneVerified: verification.phoneVerified,
    },
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

// POST /api/members/start-kyc
export async function handleStartKYC(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = asString(body.userId) || getAuthUserId(request) || '';

  if (!userId) {
    return jsonResponse({ success: false, message: 'User ID is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  // Check verification status first
  const verification = await checkVerificationStatus(userId);
  if (!verification.emailVerified || !verification.phoneVerified) {
    return jsonResponse({
      success: false,
      message: 'Email and phone must be verified before starting KYC.',
      requiresVerification: true,
      deploymentMarker: DEPLOYMENT_MARKER,
    }, 400);
  }

  const updated = await updateMemberKYCStatus(userId, 'in_progress');
  if (!updated) {
    return jsonResponse({ success: false, message: 'Failed to start KYC process.', deploymentMarker: DEPLOYMENT_MARKER }, 500);
  }

  return jsonResponse({
    success: true,
    message: 'KYC process initiated. Please upload your documents.',
    kycStatus: 'in_progress',
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

// GET /api/members/verification-status
export async function handleVerificationStatus(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const userId = url.searchParams.get('userId') || getAuthUserId(request) || '';

  if (!userId) {
    return jsonResponse({ success: false, message: 'User ID is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const verification = await checkVerificationStatus(userId);

  return jsonResponse({
    success: true,
    emailVerified: verification.emailVerified,
    phoneVerified: verification.phoneVerified,
    bothVerified: verification.emailVerified && verification.phoneVerified,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

// ---------------------------------------------------------------------------
// Member login, password reset, profile update (BLOCK: IVX business workflows)
// ---------------------------------------------------------------------------

// POST /api/members/login
export async function handleMemberLogin(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const email = asString(body.email).toLowerCase();
  const password = asString(body.password);
  if (!email || !password) {
    return jsonResponse({ success: false, message: 'Email and password are required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }
  const result = await loginMember(email, password);
  return jsonResponse(result, result.success ? 200 : (result.requiresVerification ? 403 : 401));
}

// POST /api/members/forgot-password
export async function handleMemberForgotPassword(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const email = asString(body.email).toLowerCase();
  if (!email) {
    return jsonResponse({ success: false, message: 'Email is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }
  const result = await requestMemberPasswordReset(email);
  return jsonResponse(result, result.success ? 200 : 400);
}

// POST /api/members/reset-password
export async function handleMemberResetPassword(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const email = asString(body.email).toLowerCase();
  const token = asString(body.token);
  const newPassword = asString(body.newPassword);
  if (!email || !token || !newPassword) {
    return jsonResponse({ success: false, message: 'Email, token, and newPassword are required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }
  const result = await resetMemberPasswordWithToken(email, token, newPassword);
  return jsonResponse(result, result.success ? 200 : 400);
}

// PUT /api/members/me  (profile update — never deletes fields the caller omits)
export async function handleUpdateMemberProfile(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = asString(body.userId) || getAuthUserId(request) || '';
  if (!userId) {
    return jsonResponse({ success: false, message: 'User ID is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }
  const result = await updateMemberProfile({
    userId,
    firstName: asString(body.firstName) || undefined,
    lastName: asString(body.lastName) || undefined,
    phone: asString(body.phone) || undefined,
    country: asString(body.country) || undefined,
    zipCode: typeof body.zipCode === 'string' ? asString(body.zipCode) : undefined,
    pictureUrl: asString(body.pictureUrl) || undefined,
  });
  return jsonResponse(result, result.success ? 200 : 400);
}
