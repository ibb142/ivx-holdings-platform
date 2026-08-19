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
import { createClient } from '@supabase/supabase-js';
import { assertIVXOwnerOnly } from './owner-only';

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

async function requireAuthenticatedMember(request: Request): Promise<string | null> {
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) return null;

  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await client.auth.getUser(token);
    return error || !data.user ? null : data.user.id;
  } catch {
    return null;
  }
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

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

function validateGender(gender: string): { valid: boolean; reason?: string } {
  if (!gender) return { valid: true };
  if (!VALID_GENDERS.has(gender)) {
    return { valid: false, reason: 'Please select a valid gender option.' };
  }
  return { valid: true };
}

function validatePassword(password: string): { valid: boolean; reason?: string } {
  if (password.length < 8) return { valid: false, reason: 'Password must be at least 8 characters.' };
  if (!/[A-Z]/.test(password)) return { valid: false, reason: 'Password must contain at least 1 uppercase letter.' };
  if (!/[0-9]/.test(password)) return { valid: false, reason: 'Password must contain at least 1 number.' };
  return { valid: true };
}

export function membersOptions(): Response {
  return jsonResponse({ deploymentMarker: DEPLOYMENT_MARKER }, 204);
}

export async function handleMemberRegister(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const email = asString(body.email).toLowerCase();
  const password = asString(body.password);
  const confirmPassword = asString(body.confirmPassword);
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

  if (!firstName || !lastName) {
    return normalizedError('INVALID_EMAIL', 'VALIDATING', { message: 'First name and last name are required.' });
  }
  if (!isValidEmail(email)) {
    return normalizedError('INVALID_EMAIL', 'VALIDATING', { message: 'Please enter a valid email address.' });
  }
  if (confirmPassword && password !== confirmPassword) {
    return normalizedError('WEAK_PASSWORD', 'VALIDATING', { message: 'Password confirmation does not match.' });
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
    storeVerificationCode({ userId: result.authUserId, type: 'email' }).catch(() => {});
    storeVerificationCode({ userId: result.authUserId, type: 'phone' }).catch(() => {});
    return jsonResponse({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, 200);
  }
  const status = result.code === 'EMAIL_EXISTS' ? 409 : result.code === 'RATE_LIMITED' ? 429 : (result.code === 'NETWORK_ERROR' || result.code === 'SERVICE_UNAVAILABLE') ? 503 : 400;
  return jsonResponse({ ...result, deploymentMarker: DEPLOYMENT_MARKER }, status);
}

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

export async function handleRegistrationHealthRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return jsonResponse({ ok: false, message: 'Owner authentication required for health.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }
  const health = await checkRegistrationHealth();
  return jsonResponse(health, health.status === 'healthy' ? 200 : 503);
}

export async function handleRegistrationMetricsRequest(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch {
    return jsonResponse({ ok: false, message: 'Owner authentication required for metrics.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }
  const metrics = await getRegistrationMetrics();
  return jsonResponse({ ok: true, ...metrics }, 200);
}

export async function handleSendEmailCode(request: Request): Promise<Response> {
  const userId = await requireAuthenticatedMember(request);
  if (!userId) {
    return jsonResponse({ success: false, message: 'Authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }

  const result = await storeVerificationCode({ userId, type: 'email' });
  return jsonResponse({
    success: result.success,
    message: result.success ? 'Verification code sent to your email.' : result.message,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

export async function handleVerifyEmail(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = await requireAuthenticatedMember(request);
  const code = asString(body.code);

  if (!userId) {
    return jsonResponse({ success: false, message: 'Authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }
  if (!code) {
    return jsonResponse({ success: false, message: 'Verification code is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  if (!/^\d{6}$/.test(code)) {
    return jsonResponse({ success: false, message: 'Please enter a valid 6-digit code.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const result = await verifyCode({ userId, type: 'email', code });
  if ((result as { success?: boolean; verified?: boolean }).success || (result as { verified?: boolean }).verified) {
    try {
      await markCanonicalMemberVerified({ authUserId: userId }, { emailVerified: true });
    } catch {
      console.warn('[Members] Canonical email verification sync failed.');
    }
  }
  return jsonResponse(result);
}

export async function handleSendPhoneCode(request: Request): Promise<Response> {
  const userId = await requireAuthenticatedMember(request);
  if (!userId) {
    return jsonResponse({ success: false, message: 'Authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }

  const result = await storeVerificationCode({ userId, type: 'phone' });
  return jsonResponse({
    success: result.success,
    message: result.success ? 'Verification code sent to your phone.' : result.message,
    deploymentMarker: DEPLOYMENT_MARKER,
  });
}

export async function handleVerifyPhone(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = await requireAuthenticatedMember(request);
  const code = asString(body.code);

  if (!userId) {
    return jsonResponse({ success: false, message: 'Authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }
  if (!code) {
    return jsonResponse({ success: false, message: 'Verification code is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  if (!/^\d{6}$/.test(code)) {
    return jsonResponse({ success: false, message: 'Please enter a valid 6-digit code.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const result = await verifyCode({ userId, type: 'phone', code });
  if ((result as { success?: boolean; verified?: boolean }).success || (result as { verified?: boolean }).verified) {
    try {
      await markCanonicalMemberVerified({ authUserId: userId }, { smsVerified: true });
    } catch {
      console.warn('[Members] Canonical phone verification sync failed.');
    }
  }
  return jsonResponse(result);
}

export async function handleGetMemberProfile(request: Request): Promise<Response> {
  const userId = await requireAuthenticatedMember(request);

  if (!userId) {
    return jsonResponse({ success: false, message: 'Authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
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

export async function handleStartKYC(request: Request): Promise<Response> {
  const userId = await requireAuthenticatedMember(request);

  if (!userId) {
    return jsonResponse({ success: false, message: 'Authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
  }

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

export async function handleVerificationStatus(request: Request): Promise<Response> {
  const userId = await requireAuthenticatedMember(request);

  if (!userId) {
    return jsonResponse({ success: false, message: 'Authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
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

export async function handleMemberLogin(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const email = asString(body.email).toLowerCase();
  const password = asString(body.password);
  if (!email || !password) {
    return jsonResponse({ success: false, message: 'Email and password are required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }

  const result = await loginMember(email, password);

  if (!result.success) {
    return jsonResponse(result, result.requiresVerification ? 403 : 401);
  }

  if (!result.accessToken || !result.refreshToken) {
    return jsonResponse({
      success: false,
      message: 'Authentication service could not issue a valid session. Please retry.',
      errorCode: 'SESSION_UNAVAILABLE',
      retryable: true,
      deploymentMarker: result.deploymentMarker,
    }, 503);
  }

  return jsonResponse(result, 200);
}

export async function handleMemberForgotPassword(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const email = asString(body.email).toLowerCase();
  if (!email) {
    return jsonResponse({ success: false, message: 'Email is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }
  const result = await requestMemberPasswordReset(email);
  return jsonResponse(result, result.success ? 200 : 400);
}

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

export async function handleUpdateMemberProfile(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const userId = await requireAuthenticatedMember(request);
  if (!userId) {
    return jsonResponse({ success: false, message: 'Authentication required.', deploymentMarker: DEPLOYMENT_MARKER }, 401);
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
