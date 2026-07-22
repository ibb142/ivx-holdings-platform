import createContextHook from '@nkzw/create-context-hook';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import * as SecureStore from 'expo-secure-store';
import { supabase, ensureSupabaseClient, getSupabaseConfigAudit, SUPABASE_NOT_CONFIGURED_MESSAGE, forceProductionSupabaseClient } from './supabase';
import { persistAuth, loadStoredAuth, clearStoredAuth, setAuthCredentials } from './auth-store';
import { clearOwnerResilientSession } from './owner-session-resilience';
import { canonicalizeRole, isAdminRole, normalizeRole, sanitizeEmail } from './auth-helpers';
import { signInWithEmailPassword } from './auth-password-sign-in';
import { extractChallengeId, extractFirstVerifiedMfaFactor, getMfaChallengeRequirement, type ParsedMfaFactor } from './auth-mfa';
import { startSessionMonitor } from './session-timeout';
import { initializeSync, syncOwnerData, syncUserData } from './supabase-sync';
import { logStartup, logStartupError } from './startup-trace';
import {
  ensureMemberProfileRecord,
  ensureMemberWalletRecord,
  findExistingRegisteredMemberByEmail,
  persistMemberRegistrationShadow,
  syncMemberRegistryFromSupabase,
  upsertStoredMemberRegistryRecord,
} from './member-registry';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { fetchPublicIpAddress } from './public-geo';
import { autoDetectAndSaveTimezone, saveTimezoneProfile, loadTimezoneProfile, type TimezoneProfile } from './time-service';
import {
  getAdminAccessLockMessage,
  getConfiguredOwnerAdminEmail,
  isAdminAccessLocked,
  isOwnerAdminEmail,
  shouldBlockRoleForAdminAccess,
} from './admin-access-lock';

const OWNER_IP_KEY = 'ivx_owner_ip';
const OWNER_IP_ENABLED_KEY = 'ivx_owner_ip_enabled';
const OWNER_DEVICE_VERIFIED_KEY = 'ivx_owner_device_verified';
const OWNER_VERIFIED_USER_ID_KEY = 'ivx_owner_verified_user_id';
const OWNER_VERIFIED_ROLE_KEY = 'ivx_owner_verified_role';
const OWNER_VERIFIED_AT_KEY = 'ivx_owner_verified_at';
const OWNER_VERIFIED_EMAIL_KEY = 'ivx_owner_verified_email';
const OWNER_TRUSTED_DEVICE_WINDOW_MS = 1000 * 60 * 60 * 24 * 30;
const AUTH_BOOTSTRAP_TIMEOUT_MS = 3500;
const AUTH_REFRESH_TIMEOUT_MS = 4000;
const AUTH_ROLE_RESOLUTION_TIMEOUT_MS = 2500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getIPSubnet(ip: string | null | undefined, prefixOctets: number = 2): string | null {
  if (!ip) return null;
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  return parts.slice(0, prefixOctets).join('.');
}

function isCarrierSubnetMatch(currentIP: string | null | undefined, storedIP: string | null | undefined): boolean {
  if (!currentIP || !storedIP) return false;
  if (currentIP === storedIP) return true;
  const currentSubnet16 = getIPSubnet(currentIP, 2);
  const storedSubnet16 = getIPSubnet(storedIP, 2);
  if (currentSubnet16 && storedSubnet16 && currentSubnet16 === storedSubnet16) {
    console.log('[Auth] Carrier subnet /16 match:', currentSubnet16, '— current:', currentIP, 'stored:', storedIP);
    return true;
  }
  return false;
}

async function fetchDeviceIP(): Promise<string | null> {
  try {
    const ip = await fetchPublicIpAddress({ requestTimeoutMs: 2500, totalTimeoutMs: 4000 });
    if (ip) {
      console.log('[Auth] IP detected:', ip);
      return ip;
    }
  } catch (error) {
    console.log('[Auth] IP detection exception:', (error as Error)?.message ?? 'Unknown error');
  }

  console.log('[Auth] All IP detection sources failed or timed out');
  return null;
}

export async function getStoredOwnerIP(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(OWNER_IP_KEY);
  } catch {
    return null;
  }
}

export async function setOwnerIP(ip: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(OWNER_IP_KEY, ip);
    await SecureStore.setItemAsync(OWNER_IP_ENABLED_KEY, 'true');
    console.log('[Auth] Owner IP saved:', ip);
  } catch (e) {
    console.log('[Auth] Failed to save owner IP:', e);
  }
}

export async function clearOwnerIP(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(OWNER_IP_KEY),
      SecureStore.deleteItemAsync(OWNER_IP_ENABLED_KEY),
      SecureStore.deleteItemAsync(OWNER_DEVICE_VERIFIED_KEY),
      SecureStore.deleteItemAsync(OWNER_VERIFIED_USER_ID_KEY),
      SecureStore.deleteItemAsync(OWNER_VERIFIED_ROLE_KEY),
      SecureStore.deleteItemAsync(OWNER_VERIFIED_AT_KEY),
      SecureStore.deleteItemAsync(OWNER_VERIFIED_EMAIL_KEY),
    ]);
    console.log('[Auth] Owner trusted-device access cleared');
  } catch {}
}

export async function resetOwnerLocalSignupState(): Promise<{
  clearedOwnerTrustedDevice: boolean;
  clearedAuthStore: boolean;
  signedOutSupabase: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  let clearedOwnerTrustedDevice = false;
  let clearedAuthStore = false;
  let signedOutSupabase = false;

  try {
    await clearOwnerIP();
    clearedOwnerTrustedDevice = true;
  } catch (e) {
    errors.push(`owner_trusted_device:${(e as Error)?.message ?? 'unknown'}`);
  }

  try {
    await clearStoredAuth();
    clearedAuthStore = true;
  } catch (e) {
    errors.push(`auth_store:${(e as Error)?.message ?? 'unknown'}`);
  }

  try {
    await supabase.auth.signOut();
    signedOutSupabase = true;
  } catch (e) {
    errors.push(`supabase_signout:${(e as Error)?.message ?? 'unknown'}`);
  }

  console.log('[Auth] resetOwnerLocalSignupState complete:', {
    clearedOwnerTrustedDevice,
    clearedAuthStore,
    signedOutSupabase,
    errorCount: errors.length,
  });

  return { clearedOwnerTrustedDevice, clearedAuthStore, signedOutSupabase, errors };
}

export async function isStoredOwnerIPEnabled(): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync(OWNER_IP_ENABLED_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

export async function isOwnerDeviceVerified(): Promise<boolean> {
  try {
    const val = await SecureStore.getItemAsync(OWNER_DEVICE_VERIFIED_KEY);
    return val === 'true';
  } catch {
    return false;
  }
}

async function setVerifiedOwnerDevice(userId: string, role: string, email: string): Promise<void> {
  try {
    const verifiedAt = new Date().toISOString();
    const normalizedEmail = sanitizeEmail(email);
    await Promise.all([
      SecureStore.setItemAsync(OWNER_DEVICE_VERIFIED_KEY, 'true'),
      SecureStore.setItemAsync(OWNER_VERIFIED_USER_ID_KEY, userId),
      SecureStore.setItemAsync(OWNER_VERIFIED_ROLE_KEY, role),
      SecureStore.setItemAsync(OWNER_VERIFIED_AT_KEY, verifiedAt),
      normalizedEmail
        ? SecureStore.setItemAsync(OWNER_VERIFIED_EMAIL_KEY, normalizedEmail)
        : SecureStore.deleteItemAsync(OWNER_VERIFIED_EMAIL_KEY),
    ]);
    console.log('[Auth] Trusted owner device verified for:', userId, 'role:', role, 'email:', normalizedEmail || 'missing', 'verifiedAt:', verifiedAt);
  } catch (error) {
    console.log('[Auth] Failed to verify trusted owner device:', error);
  }
}

interface TrustedOwnerDeviceMeta {
  userId: string | null;
  role: string | null;
  verifiedAt: string | null;
  email: string | null;
}

async function getVerifiedOwnerDeviceMeta(): Promise<TrustedOwnerDeviceMeta> {
  try {
    const [userId, role, verifiedAt, email] = await Promise.all([
      SecureStore.getItemAsync(OWNER_VERIFIED_USER_ID_KEY),
      SecureStore.getItemAsync(OWNER_VERIFIED_ROLE_KEY),
      SecureStore.getItemAsync(OWNER_VERIFIED_AT_KEY),
      SecureStore.getItemAsync(OWNER_VERIFIED_EMAIL_KEY),
    ]);
    return { userId, role, verifiedAt, email };
  } catch {
    return { userId: null, role: null, verifiedAt: null, email: null };
  }
}

function isTrustedOwnerDeviceWithinWindow(verifiedAt: string | null | undefined): boolean {
  if (!verifiedAt) {
    return false;
  }

  const verifiedAtMs = new Date(verifiedAt).getTime();
  if (!Number.isFinite(verifiedAtMs)) {
    return false;
  }

  return Date.now() - verifiedAtMs <= OWNER_TRUSTED_DEVICE_WINDOW_MS;
}

function isValidOwnerVerifiedUserId(userId: string | null | undefined): userId is string {
  const trimmedUserId = userId?.trim() ?? '';
  return UUID_PATTERN.test(trimmedUserId);
}

type ServerRoleResolutionSource = 'profiles' | 'rpc_get_user_role' | 'rpc_verify_admin_access' | 'trusted_device' | 'fallback';

interface ServerRoleResolution {
  role: string;
  source: ServerRoleResolutionSource;
}

type SessionRoleBootstrapSource = ServerRoleResolutionSource | 'timeout_fallback';

interface SessionRoleBootstrap {
  role: string;
  source: SessionRoleBootstrapSource;
  requiresBackgroundHydration: boolean;
}

interface NormalizedLoginFailure {
  message: string;
  failureReason: LoginFailureReason;
  isExpectedFailure: boolean;
}

function extractAuthErrorMessage(error: unknown): string | null {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (!error || typeof error !== 'object') {
    return null;
  }

  const record = error as Record<string, unknown>;
  const directKeys = ['message', 'msg', 'details', 'reason', 'error_description'] as const;

  for (const key of directKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  const nestedError = record.error;
  if (typeof nestedError === 'string' && nestedError.trim()) {
    return nestedError;
  }

  if (nestedError && typeof nestedError === 'object') {
    const nestedMessage = (nestedError as Record<string, unknown>).message;
    if (typeof nestedMessage === 'string' && nestedMessage.trim()) {
      return nestedMessage;
    }
  }

  return null;
}

/** Full auth error shape for logs (no secrets). */
function serializeSupabaseAuthErrorForLog(error: unknown): string {
  if (error == null) {
    return 'null';
  }
  if (typeof error === 'string') {
    return JSON.stringify({ message: error });
  }
  if (error instanceof Error) {
    const ext = error as Error & { status?: number; code?: string };
    return JSON.stringify({
      name: error.name,
      message: error.message,
      status: ext.status,
      code: ext.code,
    });
  }
  if (typeof error === 'object') {
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

function normalizeLoginFailureMessage(rawMessage: string | null | undefined): NormalizedLoginFailure {
  const message = rawMessage?.trim() || 'Login failed';
  const lowerMessage = message.toLowerCase();

  if (lowerMessage.includes('invalid login credentials') || lowerMessage.includes('invalid email or password')) {
    return {
      message: 'Invalid email or password.',
      failureReason: 'invalid_credentials',
      isExpectedFailure: true,
    };
  }

  if (lowerMessage.includes('email not confirmed')) {
    return {
      message: 'Your email is not confirmed yet. Check your inbox for the confirmation link or use Forgot? to reset access.',
      failureReason: 'email_not_confirmed',
      isExpectedFailure: true,
    };
  }

  if (lowerMessage.includes('rate limit') || lowerMessage.includes('too many requests') || lowerMessage.includes('over_request_rate_limit')) {
    return {
      message: 'Too many sign-in attempts. Please wait a moment and try again.',
      failureReason: 'rate_limited',
      isExpectedFailure: true,
    };
  }

  if (
    lowerMessage.includes('failed to fetch')
    || lowerMessage.includes('fetch failed')
    || lowerMessage.includes('network request failed')
    || lowerMessage.includes('networkerror')
    || lowerMessage.includes('aborted')
    || lowerMessage.includes('timeout')
    || lowerMessage.includes('supabase url is required')
  ) {
    return {
      message: 'Live Supabase sign-in is temporarily unavailable. If this is a verified owner device, use the controlled owner recovery path.',
      failureReason: 'service_unavailable',
      isExpectedFailure: true,
    };
  }

  return {
    message,
    failureReason: 'unknown',
    isExpectedFailure: false,
  };
}

function shouldAcceptResolvedRole(rawRole: string | null | undefined, normalizedRole: string): boolean {
  const canonicalRole = canonicalizeRole(rawRole);
  if (!canonicalRole) {
    return false;
  }

  if (isAdminRole(normalizedRole)) {
    return true;
  }

  return canonicalRole === 'investor';
}

function extractRoleCandidate(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value;
  }

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const directKeys = ['role', 'user_role', 'app_role'] as const;
  for (const key of directKeys) {
    const candidate = record[key];
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  const nestedUser = record.user;
  if (nestedUser && typeof nestedUser === 'object') {
    const nestedRecord = nestedUser as Record<string, unknown>;
    const nestedRole = nestedRecord.role;
    if (typeof nestedRole === 'string' && nestedRole.trim()) {
      return nestedRole;
    }
  }

  return null;
}

function extractAdminAccessFlag(value: unknown): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    return normalized === 'true' || isAdminRole(normalized);
  }

  if (!value || typeof value !== 'object') {
    return false;
  }

  const record = value as Record<string, unknown>;
  const booleanKeys = ['allowed', 'is_admin', 'isAdmin', 'verified', 'has_access'] as const;
  if (booleanKeys.some((key) => record[key] === true)) {
    return true;
  }

  const roleKeys = ['role', 'user_role', 'app_role', 'access_role'] as const;
  return roleKeys.some((key) => isAdminRole(typeof record[key] === 'string' ? record[key] : null));
}

async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, label: string, fallbackValue: T): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      console.log('[Auth] Operation timed out:', label, timeoutMs, 'ms');
      resolve(fallbackValue);
    }, timeoutMs);

    void operation()
      .then((result) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        resolve(result);
      })
      .catch((error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
  });
}

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  kycStatus: string;
  role: string;
  emailVerified?: boolean;
  twoFactorEnabled?: boolean;
  phone?: string;
  country?: string;
  avatar?: string;
  accountType?: RegisterAccountType;
  accountStatus?: string;
}

export type LoginFailureReason = 'invalid_credentials' | 'email_not_confirmed' | 'rate_limited' | 'service_unavailable' | 'admin_access_locked' | 'unknown';

export interface LoginResult {
  success: boolean;
  message: string;
  requiresTwoFactor?: boolean;
  failureReason?: LoginFailureReason;
  /** Exact Supabase Auth error message returned by the password grant when present. */
  supabaseErrorMessage?: string;
  /** Supabase Auth API code when present (e.g. invalid_credentials). */
  supabaseErrorCode?: string;
  /** Supabase Auth HTTP status when present. */
  supabaseErrorStatus?: number;
  /** Supabase Auth error class/name when present. */
  supabaseErrorName?: string;
}

type RegisterAccountType = 'investor' | 'owner';

interface RegisterResult {
  success: boolean;
  message: string;
  alreadyExists?: boolean;
  requiresLogin?: boolean;
  rateLimited?: boolean;
  deploymentBlocked?: boolean;
  email?: string;
  accountType?: RegisterAccountType;
  ownerReviewRequired?: boolean;
  userId?: string;
  proof?: Record<string, unknown>;
}

interface AuthSessionResult {
  accepted: boolean;
  role: string;
  blockedReason: string | null;
}

type OwnerRegistrationRepairInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  country: string;
};

type OwnerEmailLookupAction = 'signup' | 'sign_in' | 'not_allowed' | 'unavailable';

type OwnerEmailLookupStatus = {
  requested?: boolean;
  allowed?: boolean;
  authUserExists?: boolean | null;
  profileExists?: boolean | null;
  walletExists?: boolean | null;
  safeToSignup?: boolean;
  action?: OwnerEmailLookupAction;
  message?: string;
  secretValuesReturned?: false;
};

type OwnerRegistrationRepairResponse = {
  success?: boolean;
  message?: string;
  alreadyExists?: boolean;
  requiresLogin?: boolean;
  rateLimited?: boolean;
  cooldownSeconds?: number;
  email?: string;
  userId?: string;
  proof?: Record<string, unknown>;
  ownerEmailLookup?: OwnerEmailLookupStatus;
  deploymentMarker?: string;
  secretValuesReturned?: false;
};

type OwnerRegistrationStatusResponse = {
  ok?: boolean;
  routeRegistered?: boolean;
  ownerEmailLookup?: OwnerEmailLookupStatus;
  message?: string;
  deploymentMarker?: string;
  secretValuesReturned?: false;
};

type OwnerPostLoginRepairResult = {
  success: boolean;
  message: string;
  proof?: Record<string, unknown>;
  email?: string;
  userId?: string;
};

const IVX_CANONICAL_API_BASE_URL = 'https://api.ivxholding.com';

function normalizeApiBaseUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

function pushUniqueApiBaseUrl(values: string[], value: string | undefined): void {
  const normalized = normalizeApiBaseUrl(value);
  if (normalized && !values.includes(normalized)) {
    values.push(normalized);
  }
}

function getOwnerRegistrationApiBaseUrls(): string[] {
  const urls: string[] = [];
  pushUniqueApiBaseUrl(urls, process.env.EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL);
  pushUniqueApiBaseUrl(urls, process.env.EXPO_PUBLIC_IVX_API_BASE_URL);
  pushUniqueApiBaseUrl(urls, process.env.EXPO_PUBLIC_API_BASE_URL);
  // Rork dev fallback URL removed — IVX uses canonical production URL only
  pushUniqueApiBaseUrl(urls, IVX_CANONICAL_API_BASE_URL);
  return urls;
}

async function fetchWithOwnerRegistrationTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isOwnerRegistrationLookupSignIn(status: OwnerEmailLookupStatus | null | undefined): boolean {
  return status?.authUserExists === true || status?.action === 'sign_in';
}

async function checkOwnerRegistrationStatusThroughBackend(email: string): Promise<OwnerEmailLookupStatus | null> {
  const normalizedEmail = sanitizeEmail(email);
  if (!normalizedEmail) {
    return null;
  }

  const baseUrls = getOwnerRegistrationApiBaseUrls();
  for (const baseUrl of baseUrls) {
    const endpoint = `${baseUrl}/api/ivx/owner-registration/status?email=${encodeURIComponent(normalizedEmail)}`;
    try {
      const response = await fetchWithOwnerRegistrationTimeout(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const rawText = await response.text();
      const parsed = rawText ? JSON.parse(rawText) as OwnerRegistrationStatusResponse : {};
      if (response.ok && parsed.ownerEmailLookup) {
        console.log('[Auth] Owner registration status lookup:', normalizedEmail, 'action:', parsed.ownerEmailLookup.action ?? 'unknown', 'authUserExists:', parsed.ownerEmailLookup.authUserExists ?? null, 'marker:', parsed.deploymentMarker ?? 'missing');
        return parsed.ownerEmailLookup;
      }
      if (response.status !== 404 && response.status !== 405) {
        console.log('[Auth] Owner registration status lookup returned non-success:', response.status, parsed.message ?? 'no message');
        return parsed.ownerEmailLookup ?? null;
      }
    } catch (error) {
      console.log('[Auth] Owner registration status lookup failed:', endpoint, error instanceof Error ? error.message : 'unknown');
    }
  }

  return null;
}

function shouldRepairOwnerAfterLogin(session: Session): boolean {
  const email = sanitizeEmail(session.user.email ?? '');
  const appMetadata = (session.user.app_metadata ?? {}) as Record<string, unknown>;
  const userMetadata = (session.user.user_metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    appMetadata.role,
    appMetadata.accountType,
    appMetadata.account_type,
    appMetadata.requestedRole,
    appMetadata.requested_role,
    userMetadata.role,
    userMetadata.accountType,
    userMetadata.account_type,
    userMetadata.requestedRole,
    userMetadata.requested_role,
  ].map((value) => typeof value === 'string' ? value.trim().toLowerCase() : '');

  return isOwnerAdminEmail(email) || candidates.some((candidate) => ['owner', 'admin', 'super_admin'].includes(candidate));
}

async function repairOwnerRegistrationAfterLogin(session: Session): Promise<OwnerPostLoginRepairResult | null> {
  if (!session.access_token || !shouldRepairOwnerAfterLogin(session)) {
    return null;
  }

  const baseUrls = getOwnerRegistrationApiBaseUrls();
  for (const baseUrl of baseUrls) {
    const endpoint = `${baseUrl}/api/ivx/owner-registration/repair`;
    try {
      const response = await fetchWithOwnerRegistrationTimeout(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({}),
      });
      const rawText = await response.text();
      const parsed = rawText ? JSON.parse(rawText) as OwnerRegistrationRepairResponse : {};
      if (response.ok && parsed.success) {
        console.log('[Auth] Owner post-login profile/wallet repair complete:', parsed.email ?? session.user.email ?? 'owner', 'proof:', JSON.stringify(parsed.proof ?? {}));
        return {
          success: true,
          message: parsed.message || 'Owner profile and wallet repair completed.',
          proof: parsed.proof,
          email: parsed.email,
          userId: parsed.userId,
        };
      }
      if (response.status !== 404 && response.status !== 405) {
        console.log('[Auth] Owner post-login repair skipped:', response.status, parsed.message ?? 'no message', 'marker:', parsed.deploymentMarker ?? 'missing');
        return {
          success: false,
          message: parsed.message || `Owner post-login repair returned HTTP ${response.status}.`,
          proof: parsed.proof,
          email: parsed.email,
          userId: parsed.userId,
        };
      }
    } catch (error) {
      console.log('[Auth] Owner post-login repair endpoint failed:', endpoint, error instanceof Error ? error.message : 'unknown');
    }
  }

  return null;
}

async function repairOwnerRegistrationThroughBackend(input: OwnerRegistrationRepairInput): Promise<RegisterResult> {
  const baseUrls = getOwnerRegistrationApiBaseUrls();
  let lastMessage = 'Owner registration backend repair is not reachable yet.';

  for (const baseUrl of baseUrls) {
    const endpoint = `${baseUrl}/api/ivx/owner-registration`;
    try {
      const response = await fetchWithOwnerRegistrationTimeout(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      const rawText = await response.text();
      const parsed = rawText ? JSON.parse(rawText) as OwnerRegistrationRepairResponse : {};
      lastMessage = parsed.message || `Owner registration backend returned HTTP ${response.status}.`;

      if (response.ok && parsed.success) {
        console.log('[Auth] Owner registration backend repair saved account:', parsed.email ?? input.email, 'proof:', JSON.stringify(parsed.proof ?? {}), 'secretEcho:', parsed.secretValuesReturned === false ? 'blocked' : 'unknown');
        return {
          success: true,
          message: parsed.message || 'Owner registration saved. Please sign in with your owner email and password.',
          requiresLogin: parsed.requiresLogin !== false,
          email: parsed.email ?? input.email,
          accountType: 'owner',
          ownerReviewRequired: false,
          userId: parsed.userId,
          proof: parsed.proof,
        };
      }

      if (parsed.alreadyExists || isOwnerRegistrationLookupSignIn(parsed.ownerEmailLookup)) {
        console.log('[Auth] Owner registration backend repair found existing account:', parsed.email ?? input.email, 'profileExists:', parsed.ownerEmailLookup?.profileExists ?? null, 'walletExists:', parsed.ownerEmailLookup?.walletExists ?? null);
        return {
          success: false,
          message: parsed.message || 'This owner email already exists. Please use Owner Login. After login, profile/wallet repair runs without calling signup again.',
          alreadyExists: true,
          requiresLogin: true,
          email: parsed.email ?? input.email,
          accountType: 'owner',
          ownerReviewRequired: false,
          userId: parsed.userId,
          proof: parsed.ownerEmailLookup ? { ownerEmailLookup: parsed.ownerEmailLookup, secretValuesReturned: false } : undefined,
        };
      }

      if (parsed.rateLimited || response.status === 429) {
        console.log('[Auth] Owner registration backend rate limit active:', parsed.email ?? input.email, 'cooldownSeconds:', parsed.cooldownSeconds ?? 60);
        return {
          success: false,
          message: parsed.message || 'Owner signup is temporarily throttled. Please wait before trying again, or sign in if this owner account already exists.',
          rateLimited: true,
          requiresLogin: true,
          email: parsed.email ?? input.email,
          accountType: 'owner',
          ownerReviewRequired: false,
          proof: { cooldownSeconds: parsed.cooldownSeconds ?? 60, secretValuesReturned: false },
        };
      }

      if (response.status !== 404 && response.status !== 405) {
        console.log('[Auth] Owner registration backend repair returned non-success:', response.status, lastMessage, 'marker:', parsed.deploymentMarker ?? 'missing');
        return {
          success: false,
          message: parsed.message || `Owner registration backend returned HTTP ${response.status}.`,
          deploymentBlocked: response.status >= 500,
          requiresLogin: false,
          email: parsed.email ?? input.email,
          accountType: 'owner',
          ownerReviewRequired: false,
        };
      }
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : 'Owner registration backend repair request failed.';
      console.log('[Auth] Owner registration backend repair endpoint failed:', endpoint, lastMessage);
    }
  }

  console.log('[Auth] Owner registration backend repair unavailable after all candidates:', lastMessage);
  return {
    success: false,
    message: `Owner registration backend repair is not live/reachable yet, so no owner data was saved through the public Supabase signup path. Last proof: ${lastMessage}. Deploy the current backend owner-registration route, then submit again or use Owner Login if the account already exists.`,
    deploymentBlocked: true,
    requiresLogin: false,
    email: input.email,
    accountType: 'owner',
    ownerReviewRequired: false,
  };
}

export interface OwnerDirectAccessAuditResult {
  eligible: boolean;
  message: string;
  currentIP: string | null;
  storedIP: string | null;
  ipEnabled: boolean;
  ownerDeviceVerified: boolean;
  verifiedUserId: string | null;
  verifiedRole: string | null;
  verifiedAt: string | null;
  requestedEmail: string | null;
  verifiedEmail: string | null;
  hasStoredVerifiedEmail: boolean;
  emailCheckPassed: boolean;
  emailMismatch: boolean;
  trustedDeviceWindowActive: boolean;
  hasValidTrustedIdentity: boolean;
  exactIPMatch: boolean;
  subnetMatch: boolean;
  blockingReasons: string[];
  accessPath: 'none' | 'ip_match' | 'trusted_device';
}

type OwnerIdentityAuditStatus = 'verified_owner_authority' | 'trusted_device_owner_authority' | 'normal_user_account' | 'email_mismatch' | 'unverified';
type OwnerIdentityAuditSource = ServerRoleResolutionSource | 'owner_ip_access' | 'local_session' | 'not_authenticated';

function areAuthUsersEqual(left: AuthUser | null, right: AuthUser | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.id === right.id
    && left.email === right.email
    && left.firstName === right.firstName
    && left.lastName === right.lastName
    && left.kycStatus === right.kycStatus
    && left.role === right.role
    && left.emailVerified === right.emailVerified
    && left.twoFactorEnabled === right.twoFactorEnabled
    && left.phone === right.phone
    && left.country === right.country
    && left.avatar === right.avatar
    && left.accountType === right.accountType
    && left.accountStatus === right.accountStatus;
}

export interface OwnerIdentityAuditResult {
  requestedEmail: string | null;
  authenticatedUserId: string | null;
  authenticatedEmail: string | null;
  authenticatedRole: string | null;
  authenticatedRoleSource: OwnerIdentityAuditSource;
  authenticatedAuthorityIsAdmin: boolean;
  trustedDeviceVerified: boolean;
  trustedDeviceVerifiedUserId: string | null;
  trustedDeviceVerifiedEmail: string | null;
  trustedDeviceVerifiedRole: string | null;
  trustedDeviceVerifiedAt: string | null;
  trustedDeviceWindowActive: boolean;
  trustedDeviceHasValidIdentity: boolean;
  trustedDeviceAuthorityIsAdmin: boolean;
  matchesAuthenticatedEmail: boolean;
  matchesTrustedDeviceEmail: boolean;
  status: OwnerIdentityAuditStatus;
  isVerifiedOwnerAuthority: boolean;
  isNormalUserOnly: boolean;
  message: string;
  warnings: string[];
}

export const [AuthProvider, useAuth] = createContextHook(() => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('investor');
  const [requiresTwoFactor, setRequiresTwoFactor] = useState<boolean>(false);
  const [pendingTwoFactorEmail, setPendingTwoFactorEmail] = useState<string>('');
  const [pendingTwoFactorFactor, setPendingTwoFactorFactor] = useState<ParsedMfaFactor | null>(null);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [verify2FALoading, setVerify2FALoading] = useState<boolean>(false);
  const [registerLoading, setRegisterLoading] = useState<boolean>(false);
  const [activatingOwner, setActivatingOwner] = useState(false);
  const [ownerAccessLoading, setOwnerAccessLoading] = useState(false);
  const [isOwnerIPAccess, setIsOwnerIPAccess] = useState(false);
  const [detectedIP, setDetectedIP] = useState<string | null>(null);
  const sessionMonitorCleanup = useRef<(() => void) | null>(null);
  const ownerIPActiveRef = useRef(false);
  // Tracks whether the owner has manually signed in during this app session.
  // Only set true inside login() / loginOwnerPasswordless() after the owner
  // enters credentials. The onAuthStateChange handler checks this ref to block
  // any automatic owner session restoration that bypasses manual login.
  const manualOwnerLoginRef = useRef(false);
  const sessionWarmupKeyRef = useRef<string | null>(null);
  const ownerRepairKeyRef = useRef<string | null>(null);
  const activeSessionUserIdRef = useRef<string | null>(null);
  const lastHandledSessionKeyRef = useRef<string | null>(null);
  const lastHandledSessionResultRef = useRef<AuthSessionResult | null>(null);
  const inFlightSessionKeyRef = useRef<string | null>(null);
  const inFlightSessionPromiseRef = useRef<Promise<AuthSessionResult> | null>(null);

  const resolveServerRole = useCallback(async (userId: string, sessionEmail?: string | null): Promise<ServerRoleResolution> => {
    const traceId = `auth-${Date.now()}-${userId.slice(0, 8)}`;
    const startTime = Date.now();
    console.log(`[Auth] OWNER_PROFILE_QUERY_STARTED traceId=${traceId} userId=${userId} email=${sessionEmail ? sanitizeEmail(sessionEmail) : 'none'}`);

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', userId)
        .single();

      if (!error && data?.role) {
        const rawProfileRole = typeof data.role === 'string' ? data.role : null;
        const normalizedProfileRole = normalizeRole(rawProfileRole);
        console.log(`[Auth] OWNER_PROFILE_QUERY_COMPLETED traceId=${traceId} source=profiles rawRole=${rawProfileRole} normalizedRole=${normalizedProfileRole} elapsed=${Date.now() - startTime}ms`);
        if (shouldAcceptResolvedRole(rawProfileRole, normalizedProfileRole)) {
          // Email allow-list upgrade: if the session email matches the configured owner email,
          // promote the role to 'owner' even if profiles.role says something else.
          // This is the SAME upgrade that handleSession applies, now baked into resolveServerRole
          // so background hydration cannot downgrade the owner.
          if (isOwnerAdminEmail(sessionEmail) && !isAdminRole(normalizedProfileRole)) {
            console.log(`[Auth] OWNER_AUTHORIZED traceId=${traceId} source=profiles+email_allowlist role=owner elapsed=${Date.now() - startTime}ms`);
            return { role: 'owner', source: 'profiles' };
          }
          return { role: normalizedProfileRole, source: 'profiles' };
        }
        console.log('[Auth] Profiles role did not map cleanly to a trusted role. Continuing fallback checks for:', rawProfileRole);
      }

      console.log('[Auth] Could not fetch role from profiles:', error?.message ?? 'no role returned');
    } catch (error) {
      console.log('[Auth] Profile role fetch error:', (error as Error)?.message ?? 'unknown');
    }

    try {
      const { data, error } = await supabase.rpc('get_user_role');
      const rpcRole = extractRoleCandidate(data);
      if (!error && rpcRole) {
        const normalizedRpcRole = normalizeRole(rpcRole);
        console.log(`[Auth] OWNER_PROFILE_QUERY_COMPLETED traceId=${traceId} source=rpc_get_user_role rawRole=${rpcRole} normalizedRole=${normalizedRpcRole} elapsed=${Date.now() - startTime}ms`);
        if (shouldAcceptResolvedRole(rpcRole, normalizedRpcRole)) {
          if (isOwnerAdminEmail(sessionEmail) && !isAdminRole(normalizedRpcRole)) {
            console.log(`[Auth] OWNER_AUTHORIZED traceId=${traceId} source=rpc+email_allowlist role=owner elapsed=${Date.now() - startTime}ms`);
            return { role: 'owner', source: 'rpc_get_user_role' };
          }
          return { role: normalizedRpcRole, source: 'rpc_get_user_role' };
        }
        console.log('[Auth] get_user_role RPC returned an untrusted role label. Continuing fallback checks for:', rpcRole);
      }

      console.log('[Auth] get_user_role RPC note:', error?.message ?? 'no role returned');
    } catch (error) {
      console.log('[Auth] get_user_role RPC error:', (error as Error)?.message ?? 'unknown');
    }

    try {
      const { data, error } = await supabase.rpc('verify_admin_access');
      if (!error && extractAdminAccessFlag(data)) {
        console.log(`[Auth] OWNER_PROFILE_QUERY_COMPLETED traceId=${traceId} source=rpc_verify_admin_access role=admin elapsed=${Date.now() - startTime}ms`);
        // Email allow-list upgrade for verify_admin_access too
        if (isOwnerAdminEmail(sessionEmail)) {
          console.log(`[Auth] OWNER_AUTHORIZED traceId=${traceId} source=verify_admin+email_allowlist role=owner elapsed=${Date.now() - startTime}ms`);
          return { role: 'owner', source: 'rpc_verify_admin_access' };
        }
        return { role: 'admin', source: 'rpc_verify_admin_access' };
      }

      console.log('[Auth] verify_admin_access RPC note:', error?.message ?? 'admin access not confirmed');
    } catch (error) {
      console.log('[Auth] verify_admin_access RPC error:', (error as Error)?.message ?? 'unknown');
    }

    try {
      const trustedOwnerMeta = await getVerifiedOwnerDeviceMeta();
      const trustedWindowActive = isTrustedOwnerDeviceWithinWindow(trustedOwnerMeta.verifiedAt);
      const trustedRole = normalizeRole(trustedOwnerMeta.role);
      if (
        trustedWindowActive
        && isValidOwnerVerifiedUserId(trustedOwnerMeta.userId)
        && trustedOwnerMeta.userId === userId
        && isAdminRole(trustedRole)
      ) {
        console.log(`[Auth] OWNER_PROFILE_QUERY_COMPLETED traceId=${traceId} source=trusted_device role=${trustedRole} elapsed=${Date.now() - startTime}ms`);
        return { role: trustedRole, source: 'trusted_device' };
      }
    } catch (error) {
      console.log('[Auth] Trusted-device role fallback note:', (error as Error)?.message ?? 'unknown');
    }

    // Email allow-list final fallback: if all server sources fail but the session email
    // matches the configured owner email, the user IS the owner. This prevents the
    // background hydration from downgrading an owner to investor when RLS or network
    // issues block the profiles query.
    if (isOwnerAdminEmail(sessionEmail)) {
      console.log(`[Auth] OWNER_AUTHORIZED traceId=${traceId} source=email_allowlist_fallback role=owner elapsed=${Date.now() - startTime}ms`);
      return { role: 'owner', source: 'fallback' };
    }

    console.log(`[Auth] OWNER_DENIED traceId=${traceId} source=fallback role=investor elapsed=${Date.now() - startTime}ms`);
    return { role: 'investor', source: 'fallback' };
  }, []);

  const fetchProfileRole = useCallback(async (userId: string, sessionEmail?: string | null): Promise<string> => {
    const resolvedRole = await resolveServerRole(userId, sessionEmail);
    console.log('[Auth] Role resolution complete for user:', userId, 'role:', resolvedRole.role, 'source:', resolvedRole.source);
    return resolvedRole.role;
  }, [resolveServerRole]);

  const resolveLocalSessionRoleFallback = useCallback(async (userId: string, sessionEmail?: string | null): Promise<SessionRoleBootstrap> => {
    // Email allow-list: if the session email matches the configured owner email,
    // return 'owner' immediately so the timeout fallback never downgrades the owner.
    if (isOwnerAdminEmail(sessionEmail)) {
      console.log('[Auth] Role resolution timeout fallback: using owner role from email allow-list for:', userId);
      return {
        role: 'owner',
        source: 'timeout_fallback',
        requiresBackgroundHydration: true,
      };
    }

    try {
      const [storedAuth, ownerDeviceVerified, trustedOwnerMeta] = await Promise.all([
        loadStoredAuth(),
        isOwnerDeviceVerified(),
        getVerifiedOwnerDeviceMeta(),
      ]);

      const trustedRole = normalizeRole(trustedOwnerMeta.role);
      const trustedWindowActive = isTrustedOwnerDeviceWithinWindow(trustedOwnerMeta.verifiedAt);
      const sameVerifiedUser = ownerDeviceVerified
        && isValidOwnerVerifiedUserId(trustedOwnerMeta.userId)
        && trustedOwnerMeta.userId === userId;

      if (sameVerifiedUser && trustedWindowActive && isAdminRole(trustedRole)) {
        console.log('[Auth] Role resolution timeout fallback: using trusted-device role for:', userId, 'role:', trustedRole);
        return {
          role: trustedRole,
          source: 'timeout_fallback',
          requiresBackgroundHydration: true,
        };
      }

      const storedRole = normalizeRole(storedAuth.userRole);
      if (storedAuth.userId === userId && storedRole === 'investor') {
        console.log('[Auth] Role resolution timeout fallback: keeping stored investor role for:', userId);
      }
    } catch (error) {
      console.log('[Auth] Local session role fallback note:', (error as Error)?.message ?? 'unknown');
    }

    console.log('[Auth] Role resolution timeout fallback: defaulting to investor for:', userId);
    return {
      role: 'investor',
      source: 'timeout_fallback',
      requiresBackgroundHydration: true,
    };
  }, []);

  const hydrateResolvedRoleInBackground = useCallback((session: Session, optimisticRole: string): void => {
    const sessionUserId = session.user.id;
    const sessionEmail = session.user.email;
    console.log('[Auth] Scheduling background role hydration for:', sessionUserId, 'optimisticRole:', optimisticRole);

    void Promise.resolve().then(async () => {
      try {
        // Pass sessionEmail so resolveServerRole can apply the email allow-list upgrade.
        // This prevents background hydration from downgrading an owner to investor
        // when the profiles query is slow/fails but the email matches the configured owner.
        const resolvedRole = await resolveServerRole(sessionUserId, sessionEmail);
        const normalizedResolvedRole = normalizeRole(resolvedRole.role);

        if (activeSessionUserIdRef.current !== sessionUserId) {
          console.log('[Auth] Background role hydration cancelled because active user changed:', sessionUserId);
          return;
        }

        if (ownerIPActiveRef.current) {
          console.log('[Auth] Background role hydration skipped because trusted owner mode is active for:', sessionUserId);
          return;
        }

        // NEVER downgrade from an admin/owner role to investor during background hydration.
        // The optimistic role was set by handleSession which has the full email allow-list
        // upgrade logic. Background hydration should only UPGRADE, never downgrade.
        if (isAdminRole(optimisticRole) && !isAdminRole(normalizedResolvedRole)) {
          console.log('[Auth] Background role hydration SKIPPED — refusing to downgrade from', optimisticRole, 'to', normalizedResolvedRole, 'for user:', sessionUserId);
          return;
        }

        if (normalizedResolvedRole === optimisticRole) {
          console.log('[Auth] Background role hydration confirmed existing role for:', sessionUserId, 'role:', normalizedResolvedRole);
          return;
        }

        console.log('[Auth] Background role hydration UPGRADING role for:', sessionUserId, 'from:', optimisticRole, 'to:', normalizedResolvedRole, 'source:', resolvedRole.source);
        setUserRole((currentRole) => currentRole === normalizedResolvedRole ? currentRole : normalizedResolvedRole);
        setUser((previousUser) => {
          if (previousUser?.id !== sessionUserId) {
            return previousUser;
          }
          if (previousUser.role === normalizedResolvedRole) {
            return previousUser;
          }
          return { ...previousUser, role: normalizedResolvedRole };
        });
        setAuthCredentials(null, sessionUserId, normalizedResolvedRole);
        await persistAuth({
          token: session.access_token,
          refreshToken: session.refresh_token || '',
          userId: sessionUserId,
          userRole: normalizedResolvedRole,
        });
      } catch (error) {
        console.log('[Auth] Background role hydration note:', (error as Error)?.message ?? 'unknown');
      }
    });
  }, [resolveServerRole]);

  const clearTwoFactorState = useCallback(() => {
    setRequiresTwoFactor((current) => current ? false : current);
    setPendingTwoFactorEmail((currentEmail) => currentEmail ? '' : currentEmail);
    setPendingTwoFactorFactor((currentFactor) => currentFactor === null ? currentFactor : null);
  }, []);

  // 2FA gating disabled at the owner's request. Owner login must route
  // directly to /admin/owner-controls without any MFA pending state.
  // We always clear any stale 2FA state and never block the session.
  const requireTwoFactorIfNeeded = useCallback(async (_session: Session, source: string): Promise<boolean> => {
    console.log('[Auth] 2FA gating disabled — skipping MFA challenge after', source);
    clearTwoFactorState();
    return false;
  }, [clearTwoFactorState]);

  const doLogout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
    } catch (e) {
      console.log('[Auth] Logout error:', e);
    }
    ownerIPActiveRef.current = false;
    sessionWarmupKeyRef.current = null;
    ownerRepairKeyRef.current = null;
    activeSessionUserIdRef.current = null;
    lastHandledSessionKeyRef.current = null;
    lastHandledSessionResultRef.current = null;
    inFlightSessionKeyRef.current = null;
    inFlightSessionPromiseRef.current = null;
    manualOwnerLoginRef.current = false;
    await clearStoredAuth();
    await clearOwnerResilientSession().catch((error: unknown) => {
      console.log('[Auth] Resilient owner session clear note:', error instanceof Error ? error.message : 'unknown');
    });
    // OWNER LOGOUT: Clear ALL owner SecureStore keys including trusted-device
    // state so the next app launch requires manual email + password.
    await clearOwnerIP();
    setUser((previousUser) => previousUser === null ? previousUser : null);
    setIsAuthenticated((current) => current ? false : current);
    setUserRole((currentRole) => currentRole === 'investor' ? currentRole : 'investor');
    clearTwoFactorState();
    setIsOwnerIPAccess((current) => current ? false : current);
    if (sessionMonitorCleanup.current) {
      sessionMonitorCleanup.current();
      sessionMonitorCleanup.current = null;
    }
    console.log('[Auth] Logged out');
  }, [clearTwoFactorState]);

  const startMonitor = useCallback(() => {
    if (sessionMonitorCleanup.current) {
      sessionMonitorCleanup.current();
    }
    sessionMonitorCleanup.current = startSessionMonitor(() => {
      console.log('[Auth] Session timed out — logging out');
      void doLogout();
    });
  }, [doLogout]);

  const warmSessionInBackground = useCallback((session: Session, authUser: AuthUser, role: string) => {
    const supaUser = session.user;
    const warmupKey = `${supaUser.id}:${role}`;

    if (sessionWarmupKeyRef.current === warmupKey) {
      console.log('[Auth] Session warmup already scheduled for:', warmupKey);
      return;
    }

    sessionWarmupKeyRef.current = warmupKey;
    console.log('[Auth] Scheduling non-blocking session warmup for:', warmupKey);

    const runWarmup = async (): Promise<void> => {
      if (activeSessionUserIdRef.current !== supaUser.id) {
        console.log('[Auth] Session warmup cancelled because active user changed:', supaUser.id);
        return;
      }

      const registryTimestamp = new Date().toISOString();
      const sessionCreatedAt = supaUser.created_at || registryTimestamp;

      const warmupStatus = 'active';

      try {
        await upsertStoredMemberRegistryRecord({
          id: supaUser.id,
          email: authUser.email,
          firstName: authUser.firstName,
          lastName: authUser.lastName,
          phone: authUser.phone || '',
          country: authUser.country || '',
          role,
          status: warmupStatus,
          kycStatus: authUser.kycStatus,
          createdAt: sessionCreatedAt,
          updatedAt: registryTimestamp,
          lastSeenAt: registryTimestamp,
          source: 'session',
        });
        console.log('[Auth] Member registry warmup complete for:', supaUser.id);
      } catch (error) {
        console.log('[Auth] Member registry warmup note:', (error as Error)?.message ?? 'unknown');
      }

      if (activeSessionUserIdRef.current !== supaUser.id) {
        console.log('[Auth] Session warmup stopped after member registry because active user changed:', supaUser.id);
        return;
      }

      try {
        const profileEnsureResult = await ensureMemberProfileRecord({
          id: supaUser.id,
          email: authUser.email,
          firstName: authUser.firstName,
          lastName: authUser.lastName,
          phone: authUser.phone || '',
          country: authUser.country || '',
          kycStatus: authUser.kycStatus,
          role,
          status: warmupStatus,
          source: 'session',
        });

        if (!profileEnsureResult.success) {
          console.log('[Auth] Profile warmup note:', profileEnsureResult.error || 'unknown');
        } else {
          console.log('[Auth] Profile warmup complete for:', supaUser.id);
        }
      } catch (error) {
        console.log('[Auth] Profile warmup exception:', (error as Error)?.message ?? 'unknown');
      }

      if (activeSessionUserIdRef.current !== supaUser.id) {
        console.log('[Auth] Session warmup stopped before sync because active user changed:', supaUser.id);
        return;
      }

      try {
        const status = await initializeSync();
        console.log('[Auth] Supabase sync initialized. Connected:', status.connected);
        await syncUserData(supaUser.id);
        console.log('[Auth] User sync warmup complete for:', supaUser.id);
      } catch (error) {
        console.log('[Auth] User sync warmup note:', (error as Error)?.message ?? 'unknown');
      }
    };

    void Promise.resolve().then(runWarmup);
  }, []);

  const handleSession = useCallback(async (session: Session): Promise<AuthSessionResult> => {
    const supaUser = session.user;
    const sessionKey = `${supaUser.id}:${session.expires_at ?? 'no-expiry'}:${session.access_token ?? 'no-token'}`;
    const lastSessionResult = lastHandledSessionResultRef.current;
    if (lastHandledSessionKeyRef.current === sessionKey && lastSessionResult) {
      console.log('[Auth] Duplicate completed session event ignored for:', supaUser.id);
      return lastSessionResult;
    }

    if (inFlightSessionKeyRef.current === sessionKey && inFlightSessionPromiseRef.current) {
      console.log('[Auth] Duplicate in-flight session event joined for:', supaUser.id);
      return inFlightSessionPromiseRef.current;
    }

    const handleSessionWork = async (): Promise<AuthSessionResult> => {
    const meta = supaUser.user_metadata || {};

    if (ownerIPActiveRef.current) {
      console.log('[Auth] Replacing transient trusted-owner session with real Supabase session for:', supaUser.id);
    }
    ownerIPActiveRef.current = false;
    setIsOwnerIPAccess((current) => current ? false : current);

    if (shouldRepairOwnerAfterLogin(session)) {
      const repairKey = `${supaUser.id}:${supaUser.updated_at ?? supaUser.email ?? 'owner'}`;
      if (ownerRepairKeyRef.current !== repairKey) {
        ownerRepairKeyRef.current = repairKey;
        await repairOwnerRegistrationAfterLogin(session).catch((error: unknown) => {
          console.log('[Auth] Owner post-login repair note:', error instanceof Error ? error.message : 'unknown');
          return null;
        });
      }
    }

    const roleBootstrap = await withTimeout<SessionRoleBootstrap | null>(
      async () => {
        const resolvedRole = await resolveServerRole(supaUser.id, supaUser.email);
        return {
          role: normalizeRole(resolvedRole.role),
          source: resolvedRole.source,
          requiresBackgroundHydration: false,
        };
      },
      AUTH_ROLE_RESOLUTION_TIMEOUT_MS,
      'resolveServerRole',
      null,
    );
    const resolvedSessionRole = roleBootstrap ?? await resolveLocalSessionRoleFallback(supaUser.id, supaUser.email);
    let role = normalizeRole(resolvedSessionRole.role);

    // Owner email allow-list: if the authenticated email matches the configured
    // EXPO_PUBLIC_OWNER_EMAIL, force the role to 'owner'. This guarantees the
    // owner account has full end-to-end admin access across every module
    // (Home, Invest, Market, Portfolio, Chat, Profile, Owner Controls, Admin
    // Hub, Revenue, Properties, Fees, Settings, Landing Control, Landing
    // Analytics, Landing Submissions, Deploy Waitlist, Waitlist Admin,
    // Banners, JV Deals, Land Partners, Users & Investors, Team, KYC,
    // Broker/Agent Applications, Diagnostic modules, etc.) even when the
    // Supabase profiles row is missing or drifted to investor.
    if (isOwnerAdminEmail(supaUser.email) && role !== 'owner') {
      console.log('[Auth] Owner email allow-list upgrade — promoting role from', role, 'to owner for:', sanitizeEmail(supaUser.email ?? 'unknown'));
      role = 'owner';
    }

    if (resolvedSessionRole.source === 'timeout_fallback') {
      console.log('[Auth] Session role bootstrap used timeout fallback for:', supaUser.id, 'role:', role);
    }

    if (!role) {
      console.log('[Auth] No server role found for user:', supaUser.id, '— defaulting to investor. JWT metadata role is NOT trusted for authorization.');
    }

    if (shouldBlockRoleForAdminAccess(role, supaUser.email)) {
      const blockedReason = getAdminAccessLockMessage();
      console.log('[Auth] Admin access lock blocked authenticated session for:', supaUser.id, 'role:', role, 'email:', sanitizeEmail(supaUser.email ?? 'unknown'));
      ownerIPActiveRef.current = false;
      sessionWarmupKeyRef.current = null;
      ownerRepairKeyRef.current = null;
      activeSessionUserIdRef.current = null;
      setUser((previousUser) => previousUser === null ? previousUser : null);
      setUserRole((currentRole) => currentRole === 'investor' ? currentRole : 'investor');
      setIsAuthenticated((current) => current ? false : current);
      setIsOwnerIPAccess((current) => current ? false : current);
      setDetectedIP((currentIP) => currentIP === null ? currentIP : null);
      clearTwoFactorState();
      setAuthCredentials(null, null, 'investor');
      await clearStoredAuth();
      if (sessionMonitorCleanup.current) {
        sessionMonitorCleanup.current();
        sessionMonitorCleanup.current = null;
      }
      try {
        await supabase.auth.signOut();
      } catch (error) {
        console.log('[Auth] Admin access lock signOut note:', extractAuthErrorMessage(error) ?? 'unknown');
      }
      const blockedResult = { accepted: false, role, blockedReason };
      lastHandledSessionKeyRef.current = sessionKey;
      lastHandledSessionResultRef.current = blockedResult;
      return blockedResult;
    }

    const authUser: AuthUser = {
      id: supaUser.id,
      email: supaUser.email || '',
      firstName: meta.firstName || meta.first_name || '',
      lastName: meta.lastName || meta.last_name || '',
      kycStatus: isAdminRole(role) ? 'approved' : (meta.kycStatus || meta.kyc_status || 'pending'),
      role,
      emailVerified: !!supaUser.email_confirmed_at,
      twoFactorEnabled: false,
      phone: meta.phone || '',
      country: meta.country || '',
      accountType: meta.accountType === 'owner' ? 'owner' : 'investor',
      accountStatus: 'active',
    };

    clearTwoFactorState();
    activeSessionUserIdRef.current = supaUser.id;
    setUser((previousUser) => areAuthUsersEqual(previousUser, authUser) ? previousUser : authUser);
    setUserRole((currentRole) => currentRole === role ? currentRole : role);
    setIsAuthenticated((current) => current ? current : true);

    await persistAuth({
      token: session.access_token,
      refreshToken: session.refresh_token || '',
      userId: supaUser.id,
      userRole: role,
    });

    startMonitor();
    console.log('[Auth] Session set for:', supaUser.id, 'role:', role, 'source:', resolvedSessionRole.source);
    warmSessionInBackground(session, authUser, role);

    if (resolvedSessionRole.requiresBackgroundHydration) {
      hydrateResolvedRoleInBackground(session, role);
    }

    const acceptedResult = { accepted: true, role, blockedReason: null };
    lastHandledSessionKeyRef.current = sessionKey;
    lastHandledSessionResultRef.current = acceptedResult;
    return acceptedResult;
    };

    const sessionPromise = handleSessionWork().finally(() => {
      if (inFlightSessionKeyRef.current === sessionKey) {
        inFlightSessionKeyRef.current = null;
        inFlightSessionPromiseRef.current = null;
      }
    });
    inFlightSessionKeyRef.current = sessionKey;
    inFlightSessionPromiseRef.current = sessionPromise;
    return sessionPromise;
  }, [clearTwoFactorState, hydrateResolvedRoleInBackground, resolveLocalSessionRoleFallback, resolveServerRole, startMonitor, warmSessionInBackground]);

  const activateOwnerIPSession = useCallback((ip: string, verifiedRole: string = 'owner', verifiedUserId?: string | null, verifiedEmail?: string | null) => {
    if (shouldBlockRoleForAdminAccess(verifiedRole, verifiedEmail)) {
      console.log('[Auth] Trusted owner IP activation blocked because owner-only admin access is enabled for another email:', sanitizeEmail(verifiedEmail ?? 'unknown'));
      return;
    }

    const normalizedVerifiedRole = normalizeRole(verifiedRole);
    const effectiveRole = isAdminRole(normalizedVerifiedRole) ? normalizedVerifiedRole : 'owner';
    const normalizedVerifiedEmail = sanitizeEmail(verifiedEmail ?? '');
    const ownerUser: AuthUser = {
      id: verifiedUserId || 'owner-ip-' + ip.replace(/\./g, '-'),
      email: normalizedVerifiedEmail || 'owner@ivxholding.com',
      firstName: 'Owner',
      lastName: '(Trusted Device)',
      kycStatus: 'approved',
      role: effectiveRole,
      emailVerified: true,
    };
    ownerIPActiveRef.current = true;
    sessionWarmupKeyRef.current = null;
    activeSessionUserIdRef.current = ownerUser.id;
    setUser((previousUser) => areAuthUsersEqual(previousUser, ownerUser) ? previousUser : ownerUser);
    setUserRole((currentRole) => currentRole === effectiveRole ? currentRole : effectiveRole);
    setIsAuthenticated((current) => current ? current : true);
    setIsOwnerIPAccess((current) => current ? current : true);
    setDetectedIP((currentIP) => currentIP === ip ? currentIP : ip);
    setAuthCredentials(null, ownerUser.id, effectiveRole);
    console.log('[Auth] Trusted owner IP access activated for IP:', ip, 'role:', effectiveRole, 'userId:', ownerUser.id);

    initializeSync().then((status) => {
      console.log('[Auth] Supabase sync initialized for owner. Connected:', status.connected, '| Channels:', status.realtimeChannels);
      syncOwnerData().then((stats) => {
        console.log('[Auth] Owner data stats:', JSON.stringify(stats));
      }).catch(() => {});
    }).catch((err) => {
      console.log('[Auth] Sync init failed (non-blocking):', (err as Error)?.message);
    });
  }, []);

  const restoreTrustedOwnerSession = useCallback(async (): Promise<boolean> => {
    try {
      const [ipEnabled, ownerDeviceVerified, ownerDeviceMeta, storedIP] = await Promise.all([
        isStoredOwnerIPEnabled(),
        isOwnerDeviceVerified(),
        getVerifiedOwnerDeviceMeta(),
        getStoredOwnerIP(),
      ]);
      const hasValidTrustedIdentity = isValidOwnerVerifiedUserId(ownerDeviceMeta.userId);
      const normalizedTrustedEmail = sanitizeEmail(ownerDeviceMeta.email ?? '');

      if (isAdminAccessLocked() && !isOwnerAdminEmail(normalizedTrustedEmail)) {
        console.log('[Auth] Trusted owner auto-restore skipped because the verified device email is not the configured owner email:', normalizedTrustedEmail || 'missing');
        return false;
      }

      if (ownerDeviceVerified && !hasValidTrustedIdentity) {
        console.log('[Auth] Trusted owner restore blocked because stored verified user id is invalid:', ownerDeviceMeta.userId);
        await clearOwnerIP();
        return false;
      }

      const shouldVerifyOwnerNetwork = ipEnabled && ownerDeviceVerified;
      const currentIP = shouldVerifyOwnerNetwork ? await fetchDeviceIP() : null;
      const nextDetectedIP = currentIP ?? storedIP ?? null;
      setDetectedIP((currentDetectedIP) => currentDetectedIP === nextDetectedIP ? currentDetectedIP : nextDetectedIP);
      const trustedDeviceWindowActive = isTrustedOwnerDeviceWithinWindow(ownerDeviceMeta.verifiedAt);
      const hasTrustedWindowAccess = ipEnabled && ownerDeviceVerified && trustedDeviceWindowActive && isValidOwnerVerifiedUserId(ownerDeviceMeta.userId);
      const trustedRole = normalizeRole(ownerDeviceMeta.role);
      console.log('[Auth] Owner trusted-device check — current:', currentIP, 'stored:', storedIP, 'enabled:', ipEnabled, 'verified:', ownerDeviceVerified, 'verifiedUserId:', ownerDeviceMeta.userId, 'verifiedRole:', ownerDeviceMeta.role, 'verifiedAt:', ownerDeviceMeta.verifiedAt, 'trustedWindow:', trustedDeviceWindowActive, 'trustedWindowAccess:', hasTrustedWindowAccess);

      if (ipEnabled && ownerDeviceVerified && storedIP && currentIP && isCarrierSubnetMatch(currentIP, storedIP)) {
        console.log('[Auth] Trusted owner device matched carrier subnet — restoring owner access. Current:', currentIP, 'Stored:', storedIP);
        if (currentIP !== storedIP) {
          await setOwnerIP(currentIP);
          console.log('[Auth] Updated stored owner IP to current:', currentIP);
        }
        activateOwnerIPSession(currentIP, trustedRole, ownerDeviceMeta.userId, ownerDeviceMeta.email);
        return true;
      }

      if (hasTrustedWindowAccess && ownerDeviceMeta.userId) {
        const restoreIdentity = currentIP ?? storedIP ?? 'trusted-device';
        if (currentIP && currentIP !== storedIP) {
          await setOwnerIP(currentIP);
          console.log('[Auth] Updated stored owner IP during trusted-window restore:', currentIP, 'previous:', storedIP ?? 'none');
        }
        console.log('[Auth] Trusted owner device is still inside the verification window — restoring owner access without blocking on exact IP match. Current:', currentIP ?? 'unavailable', 'Stored:', storedIP ?? 'none', 'Role:', trustedRole, 'User:', ownerDeviceMeta.userId);
        activateOwnerIPSession(restoreIdentity, trustedRole, ownerDeviceMeta.userId, ownerDeviceMeta.email);
        return true;
      }

      if (ipEnabled && ownerDeviceVerified && trustedDeviceWindowActive && ownerDeviceMeta.userId && storedIP && currentIP && !isCarrierSubnetMatch(currentIP, storedIP)) {
        console.log('[Auth] Trusted owner device within window but IP subnet mismatch — manual restore remains available. Current:', currentIP, 'stored:', storedIP);
      }

      if (ipEnabled && ownerDeviceVerified && storedIP && !currentIP) {
        console.log('[Auth] Trusted owner device enabled but IP detection failed — exact IP restore is blocked, but verified-window restore may still be used when eligible');
      }
    } catch (error) {
      console.log('[Auth] Trusted owner restore note:', (error as Error)?.message ?? 'unknown');
    }

    return false;
  }, [activateOwnerIPSession]);

  useEffect(() => {
    let cancelled = false;

    const initAuth = async () => {
      logStartup('AUTH_INITIALIZATION_STARTED');
      logStartup('AUTH_INIT_STARTED');
      try {
        // Cold launch: sign out any persisted Supabase session so the owner
        // (and all users) must enter credentials manually every time.
        // This prevents automatic owner sign-in from AsyncStorage.
        //
        // CRITICAL: The router must render BEFORE this signOut completes.
        // We set isLoading=false immediately in a microtask so TabsLayout can
        // redirect to /login, then run the background signOut in a fire-and-forget
        // promise. If signOut hangs or is slow, the UI is never blocked.
        Promise.resolve().then(() => {
          if (!cancelled) {
            manualOwnerLoginRef.current = false;
            setIsLoading(false);
            logStartup('AUTH_INITIALIZATION_COMPLETED', 'router unlocked before signOut');
            logStartup('AUTH_INIT_COMPLETED', 'router unlocked before signOut');
          }
        });

        // Background signOut with a strict timeout. This never blocks render.
        withTimeout(
          () => supabase.auth.signOut({ scope: 'local' }).then(() => {
            console.log('[Auth] Cold-launch signOut completed');
          }),
          AUTH_BOOTSTRAP_TIMEOUT_MS,
          'initAuth.signOut',
          undefined,
        ).catch((e: unknown) => {
          console.log('[Auth] Cold-launch signOut note:', (e as Error)?.message ?? 'unknown');
        });
      } catch (e) {
        logStartupError('AUTH_INITIALIZATION_FAILED', e);
        logStartupError('AUTH_INIT_FAILED', e);
        console.log('[Auth] Init error:', (e as Error)?.message);
        // Always unlock the router even if setup threw.
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void initAuth();

    let subscription: { unsubscribe: () => void } | null = null;
    try {
      const result = supabase.auth.onAuthStateChange(async (_event, session) => {
        if (cancelled) {
          return;
        }
        if (_event === 'INITIAL_SESSION') {
          console.log('[Auth] State changed: INITIAL_SESSION — handled by startup bootstrap');
          return;
        }
        if (ownerIPActiveRef.current) {
          console.log('[Auth] State changed:', _event, '— IGNORED (owner IP active)');
          return;
        }
        console.log('[Auth] State changed:', _event);
        if (session) {
          // Only accept sessions from manual login — not from automatic restore.
          // manualOwnerLoginRef is set to true inside login() /
          // loginOwnerPasswordless() / verify2FA() before the Supabase sign-in
          // call. Without it, persisted sessions from cold launch are ignored.
          if (!manualOwnerLoginRef.current) {
            console.log('[Auth] Ignoring auth state session — no manual login for this app session');
            return;
          }
          const challengeRequired = await requireTwoFactorIfNeeded(session, `auth event ${String(_event)}`);
          if (!challengeRequired) {
            const handledSession = await handleSession(session);
            if (!handledSession.accepted) {
              console.log('[Auth] Auth state session blocked:', handledSession.blockedReason ?? 'admin access lock');
            }
          }
        } else if (_event === 'SIGNED_OUT') {
          sessionWarmupKeyRef.current = null;
          ownerRepairKeyRef.current = null;
          activeSessionUserIdRef.current = null;
          lastHandledSessionKeyRef.current = null;
          lastHandledSessionResultRef.current = null;
          inFlightSessionKeyRef.current = null;
          inFlightSessionPromiseRef.current = null;
          manualOwnerLoginRef.current = false;
          setUser((previousUser) => previousUser === null ? previousUser : null);
          setIsAuthenticated((current) => current ? false : current);
          setUserRole((currentRole) => currentRole === 'investor' ? currentRole : 'investor');
          clearTwoFactorState();
          await clearStoredAuth();
          await clearOwnerResilientSession().catch(() => {});
          await clearOwnerIP();
          if (sessionMonitorCleanup.current) {
            sessionMonitorCleanup.current();
            sessionMonitorCleanup.current = null;
          }
        }
      });
      subscription = result?.data?.subscription ?? null;
    } catch (e) {
      console.log('[Auth] onAuthStateChange setup error:', (e as Error)?.message);
    }

    return () => {
      cancelled = true;
      try { subscription?.unsubscribe(); } catch {}
      if (sessionMonitorCleanup.current) {
        sessionMonitorCleanup.current();
        sessionMonitorCleanup.current = null;
      }
    };
  }, [clearTwoFactorState, handleSession, requireTwoFactorIfNeeded]);

  const loginOwnerPasswordless = useCallback(async (ownerEmail: string): Promise<LoginResult> => {
    const normalizedOwnerEmail = sanitizeEmail(ownerEmail);
    if (!normalizedOwnerEmail) {
      return { success: false, message: 'Enter your owner email to sign in.' };
    }
    setLoginLoading(true);
    try {
      const apiBaseUrls = getOwnerRegistrationApiBaseUrls();
      let lastError: string | null = null;
      let sessionInstalled = false;
      for (const baseUrl of apiBaseUrls) {
        const endpoint = `${baseUrl}/api/ivx/owner-passwordless-login`;
        try {
          const response = await fetchWithOwnerRegistrationTimeout(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ email: normalizedOwnerEmail }),
          });
          const text = await response.text();
          let parsed: Record<string, unknown> = {};
          try { parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}; } catch {}
          if (parsed.success !== true) {
            lastError = typeof parsed.message === 'string' ? parsed.message : `Owner login failed (HTTP ${response.status}).`;
            continue;
          }
          const accessToken = typeof parsed.accessToken === 'string' ? parsed.accessToken : '';
          const refreshToken = typeof parsed.refreshToken === 'string' ? parsed.refreshToken : '';
          if (!accessToken || !refreshToken) {
            lastError = 'Backend did not return session tokens.';
            continue;
          }
          // Mark manual owner login BEFORE setSession so the synchronous
          // onAuthStateChange event does not trigger the owner auto-login block
          // and wipe the session immediately.
          manualOwnerLoginRef.current = true;
          const freshClient = ensureSupabaseClient();
          const { data: sessionData, error: sessionError } = await freshClient.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (sessionError) {
            manualOwnerLoginRef.current = false;
            lastError = sessionError.message;
            continue;
          }
          const session = sessionData.session;
          if (!session) {
            manualOwnerLoginRef.current = false;
            lastError = 'No session returned from setSession.';
            continue;
          }
          const challengeRequired = await requireTwoFactorIfNeeded(session, 'passwordless owner login');
          if (challengeRequired) {
            return { success: false, requiresTwoFactor: true, message: 'Enter the 6-digit code from your authenticator app to finish signing in.' };
          }
          const handled = await handleSession(session);
          if (!handled.accepted) {
            manualOwnerLoginRef.current = false;
            return { success: false, message: handled.blockedReason ?? 'Owner session was not accepted.', failureReason: 'admin_access_locked' };
          }
          sessionInstalled = true;
          break;
        } catch (endpointError) {
          lastError = endpointError instanceof Error ? endpointError.message : 'Owner login endpoint failed.';
          continue;
        }
      }
      if (!sessionInstalled) {
        // No hardcoded password fallback. The passwordless login endpoint
        // is the only path for this flow. If it fails, the owner must use
        // the standard email + password login screen instead.
        return {
          success: false,
          message: lastError ?? 'Owner passwordless login is not available. Please use email and password sign-in.',
          failureReason: 'service_unavailable',
        };
      }
      return { success: true, message: 'Owner signed in without a password.' };
    } catch (error: unknown) {
      const message = extractAuthErrorMessage(error) || 'Passwordless owner login failed.';
      return { success: false, message, failureReason: 'unknown' };
    } finally {
      setLoginLoading(false);
    }
  }, [handleSession, requireTwoFactorIfNeeded]);

  const login = useCallback(async (email: string, password: string): Promise<LoginResult> => {
    setLoginLoading(true);
    try {
      // Runtime safety: if the Expo Go bundle loaded the stale module-level
      // noop client, force re-initialization before any auth call. This catches
      // the "Supabase URL is required" AuthError that comes from a stale bundle
      // even though the current code has production fallbacks.
      // We capture the fresh client and pass it to signInWithEmailPassword so
      // we never accidentally use the noop client even if the export snapshot
      // was bound before the fallback constants loaded.
      let freshClient: SupabaseClient;
      try {
        freshClient = ensureSupabaseClient();
        const audit = getSupabaseConfigAudit();
        if (!audit.host.includes('kvclcdjmjghndxsngfzb')) {
          console.warn('[Auth] Resolved Supabase host is not production, forcing production client:', audit.host);
          freshClient = forceProductionSupabaseClient();
        }
      } catch (configError) {
        const configAudit = getSupabaseConfigAudit();
        console.log('[Auth] Supabase client not configured at login time:', configAudit);
        return {
          success: false,
          message: SUPABASE_NOT_CONFIGURED_MESSAGE,
          failureReason: 'service_unavailable',
          supabaseErrorMessage: SUPABASE_NOT_CONFIGURED_MESSAGE,
          supabaseErrorCode: 'not_configured',
          supabaseErrorStatus: 500,
          supabaseErrorName: 'AuthError',
        };
      }

      if (ownerIPActiveRef.current || isOwnerIPAccess) {
        console.log('[Auth] Clearing transient trusted-owner access before password sign-in');
        ownerIPActiveRef.current = false;
        setIsOwnerIPAccess(false);
      }

      const normalizedEmail = sanitizeEmail(email);
      const signInResult = await signInWithEmailPassword(freshClient, email, password);
      const { credentials } = signInResult;
      console.log(
        '[Auth] Password sign-in attempt: email=',
        credentials.email,
        'passwordLength=',
        credentials.passwordLength,
      );

      // SECURITY: The former "owner self-healing fallback" that submitted the
      // typed password to the backend repair endpoint has been removed. It let
      // ANY typed password become the owner password, which broke wrong-password
      // rejection and was a critical account-takeover vector. Password sign-in
      // now calls supabase.auth.signInWithPassword only. Recovery goes through
      // the official password reset email flow.
      if (!signInResult.ok && isOwnerAdminEmail(normalizedEmail)) {
        console.log('[Auth] Owner password rejected by Supabase. Self-heal is disabled; use the official password reset flow.');
      }

      if (!signInResult.ok) {
        const { error } = signInResult;
        const authErrorMessage = extractAuthErrorMessage(error);
        const errorCode = typeof error === 'object' && error && 'code' in error
          ? String((error as { code?: string }).code ?? '')
          : '';
        const errorStatus = typeof error === 'object' && error && 'status' in error
          ? Number((error as { status?: number }).status)
          : NaN;
        const errorName = typeof error === 'object' && error && 'name' in error
          ? String((error as { name?: string }).name ?? '')
          : '';
        console.log('[Auth] Supabase signInWithPassword error (full):', serializeSupabaseAuthErrorForLog(error));
        const normalizedFailure = normalizeLoginFailureMessage(authErrorMessage);
        const displayMessage = (authErrorMessage?.trim() || normalizedFailure.message).trim();
        if (normalizedFailure.isExpectedFailure) {
          console.log('[Auth] Login rejected:', normalizedFailure.failureReason, 'email:', credentials.email, 'displayMessage:', displayMessage);
        } else {
          console.log('[Auth] Login rejection handled:', authErrorMessage ?? 'unknown login rejection', 'email:', credentials.email);
        }
        return {
          success: false,
          message: displayMessage,
          failureReason: normalizedFailure.failureReason,
          supabaseErrorMessage: displayMessage,
          ...(errorCode ? { supabaseErrorCode: errorCode } : {}),
          ...(Number.isFinite(errorStatus) ? { supabaseErrorStatus: errorStatus } : {}),
          ...(errorName ? { supabaseErrorName: errorName } : {}),
        };
      }

      const { session: dataSession } = signInResult;
      const resolvedSession = dataSession ?? (await supabase.auth.getSession()).data.session;
      if (resolvedSession) {
        // Mark manual login so onAuthStateChange accepts this session.
        manualOwnerLoginRef.current = true;
        console.log('[Auth] Direct password sign-in produced a real session for:', credentials.email, 'user:', resolvedSession.user.id);
        const challengeRequired = await requireTwoFactorIfNeeded(resolvedSession, 'password sign-in');
        if (challengeRequired) {
          return {
            success: false,
            requiresTwoFactor: true,
            message: 'Enter the 6-digit code from your authenticator app to finish signing in.',
          };
        }
        const handledSession = await handleSession(resolvedSession);
        if (!handledSession.accepted) {
          return {
            success: false,
            message: handledSession.blockedReason ?? getAdminAccessLockMessage(),
            failureReason: 'admin_access_locked',
          };
        }
        // Auto-detect and save timezone on login
        try {
          const tzProfile = await autoDetectAndSaveTimezone();
          console.log('[Auth] Timezone auto-detected on login:', tzProfile.timezone, 'offset:', tzProfile.utc_offset);
        } catch (tzError) {
          console.log('[Auth] Timezone auto-detect failed (non-blocking):', (tzError as Error)?.message);
        }
        return { success: true, message: 'Login successful' };
      }

      console.log('[Auth] Login finished without a recoverable session for:', credentials.email);
      return { success: false, message: 'Login failed because no active session was returned.', failureReason: 'unknown' };
    } catch (error: unknown) {
      const authErrorMessage = extractAuthErrorMessage(error);
      const errorCode = typeof error === 'object' && error && 'code' in error
        ? String((error as { code?: string }).code ?? '')
        : '';
      const errorStatus = typeof error === 'object' && error && 'status' in error
        ? Number((error as { status?: number }).status)
        : NaN;
      const errorName = typeof error === 'object' && error && 'name' in error
        ? String((error as { name?: string }).name ?? '')
        : '';
      console.log('[Auth] Login exception (full):', serializeSupabaseAuthErrorForLog(error));
      const normalizedFailure = normalizeLoginFailureMessage(authErrorMessage);
      const displayMessage = (authErrorMessage?.trim() || normalizedFailure.message).trim();
      if (normalizedFailure.isExpectedFailure) {
        console.log('[Auth] Login exception treated as auth rejection:', normalizedFailure.failureReason, 'email:', sanitizeEmail(email));
      } else {
        console.log('[Auth] Login exception handled:', authErrorMessage ?? 'unknown login exception', 'email:', sanitizeEmail(email));
      }
      return {
        success: false,
        message: displayMessage,
        failureReason: normalizedFailure.failureReason,
        supabaseErrorMessage: displayMessage,
        ...(errorCode ? { supabaseErrorCode: errorCode } : {}),
        ...(Number.isFinite(errorStatus) ? { supabaseErrorStatus: errorStatus } : {}),
        ...(errorName ? { supabaseErrorName: errorName } : {}),
      };
    } finally {
      setLoginLoading(false);
    }
  }, [handleSession, isOwnerIPAccess, requireTwoFactorIfNeeded]);

  const verify2FA = useCallback(async (code: string): Promise<LoginResult> => {
    setVerify2FALoading(true);
    try {
      let factor = pendingTwoFactorFactor;
      if (!factor) {
        const factorsResult = await supabase.auth.mfa.listFactors();
        if (factorsResult.error) {
          throw factorsResult.error;
        }
        factor = extractFirstVerifiedMfaFactor(factorsResult.data);
      }

      if (!factor) {
        return { success: false, message: 'No verified authenticator factor was found for this account.' };
      }

      console.log('[Auth] Verifying MFA challenge for:', pendingTwoFactorEmail || 'current session', 'factor:', factor.friendlyName);
      const challengeResult = await supabase.auth.mfa.challenge({ factorId: factor.id });
      if (challengeResult.error) {
        throw challengeResult.error;
      }

      const challengeId = extractChallengeId(challengeResult.data);
      if (!challengeId) {
        throw new Error('Supabase did not return an MFA challenge id.');
      }

      const verifyResult = await supabase.auth.mfa.verify({
        factorId: factor.id,
        challengeId,
        code: code.trim(),
      });
      if (verifyResult.error) {
        return { success: false, message: verifyResult.error.message || 'Invalid two-factor code.' };
      }

      clearTwoFactorState();
      const sessionResult = await supabase.auth.getSession();
      const verifiedSession = sessionResult.data.session;
      if (!verifiedSession) {
        throw new Error('Two-factor verification finished but no authenticated session was returned.');
      }
      // Mark manual login so onAuthStateChange accepts this session.
      manualOwnerLoginRef.current = true;

      const handledSession = await handleSession(verifiedSession);
      if (!handledSession.accepted) {
        return {
          success: false,
          message: handledSession.blockedReason ?? getAdminAccessLockMessage(),
          failureReason: 'admin_access_locked',
        };
      }
      return { success: true, message: 'Two-factor verification complete.' };
    } catch (error: unknown) {
      return {
        success: false,
        message: error instanceof Error ? error.message : 'Failed to verify the two-factor code.',
      };
    } finally {
      setVerify2FALoading(false);
    }
  }, [clearTwoFactorState, handleSession, pendingTwoFactorEmail, pendingTwoFactorFactor]);

  const cancelTwoFactor = useCallback(() => {
    clearTwoFactorState();
    void supabase.auth.signOut().catch((error: unknown) => {
      console.log('[Auth] cancelTwoFactor signOut note:', error instanceof Error ? error.message : 'unknown');
    });
  }, [clearTwoFactorState]);

  const register = useCallback(async (data: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    phone?: string;
    country: string;
    referralCode?: string;
    accountType?: RegisterAccountType;
  }): Promise<RegisterResult> => {
    setRegisterLoading(true);
    try {
      const normalizedEmail = sanitizeEmail(data.email);
      const accountType: RegisterAccountType = data.accountType === 'owner' ? 'owner' : 'investor';
      const isOwnerSignup = accountType === 'owner';
      const signupRole = isOwnerSignup ? 'owner' : 'investor';
      const signupStatus = 'active';
      const kycStatus = isOwnerSignup ? 'approved' : 'pending';
      const ownerReviewRequired = false;
      const registrationTimestamp = new Date().toISOString();
      const existingStoredRecord = await findExistingRegisteredMemberByEmail(normalizedEmail);
      if (existingStoredRecord) {
        console.log('[Auth] Signup blocked by durable member registry:', normalizedEmail);
        return {
          success: false,
          message: 'This account is already registered. Please sign in.',
          alreadyExists: true,
          requiresLogin: true,
          email: normalizedEmail,
          accountType,
          ownerReviewRequired,
        };
      }

      if (isOwnerSignup) {
        const ownerEmailLookup = await checkOwnerRegistrationStatusThroughBackend(normalizedEmail);
        if (isOwnerRegistrationLookupSignIn(ownerEmailLookup)) {
          console.log('[Auth] Owner signup preflight blocked duplicate before POST:', normalizedEmail, 'profileExists:', ownerEmailLookup?.profileExists ?? null, 'walletExists:', ownerEmailLookup?.walletExists ?? null);
          return {
            success: false,
            message: ownerEmailLookup?.message || 'This owner account already exists. Please use Owner Login instead of signup.',
            alreadyExists: true,
            requiresLogin: true,
            email: normalizedEmail,
            accountType: 'owner',
            ownerReviewRequired,
            proof: { ownerEmailLookup, secretValuesReturned: false },
          };
        }

        if (ownerEmailLookup?.action === 'not_allowed') {
          return {
            success: false,
            message: ownerEmailLookup.message || 'Owner signup is limited to the configured owner email.',
            requiresLogin: true,
            email: normalizedEmail,
            accountType: 'owner',
            ownerReviewRequired,
            proof: { ownerEmailLookup, secretValuesReturned: false },
          };
        }

        const ownerRepairResult = await repairOwnerRegistrationThroughBackend({
          email: normalizedEmail,
          password: data.password,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone || '',
          country: data.country,
        });

        if (ownerRepairResult) {
          if (ownerRepairResult.success && ownerRepairResult.userId) {
            await upsertStoredMemberRegistryRecord({
              id: ownerRepairResult.userId,
              email: normalizedEmail,
              firstName: data.firstName,
              lastName: data.lastName,
              phone: data.phone || '',
              country: data.country,
              role: signupRole,
              status: signupStatus,
              kycStatus,
              createdAt: registrationTimestamp,
              updatedAt: registrationTimestamp,
              lastSeenAt: registrationTimestamp,
              source: 'signup',
            });
          }
          return ownerRepairResult;
        }
      }

      const { data: authData, error } = await supabase.auth.signUp({
        email: normalizedEmail,
        password: data.password,
        options: {
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone || '',
            country: data.country,
            referralCode: data.referralCode || '',
            accountType,
            requestedRole: isOwnerSignup ? 'owner' : '',
            ownerSignupApprovedAt: isOwnerSignup ? registrationTimestamp : '',
            role: signupRole,
            kycStatus,
          },
        },
      });

      if (error) {
        const lowerMessage = error.message.toLowerCase();
        if (lowerMessage.includes('already registered') || lowerMessage.includes('already exists') || lowerMessage.includes('user already')) {
          console.log('[Auth] Existing account attempted signup:', normalizedEmail);
          return {
            success: false,
            message: 'This account already exists. Please sign in.',
            alreadyExists: true,
            requiresLogin: true,
            email: normalizedEmail,
            accountType,
            ownerReviewRequired,
          };
        }
        if (lowerMessage.includes('over_email_send_rate_limit') || (lowerMessage.includes('rate limit') && lowerMessage.includes('email'))) {
          console.log('[Auth] Signup email rate limit active:', normalizedEmail);
          if (isOwnerSignup) {
            const ownerRepairResult = await repairOwnerRegistrationThroughBackend({
              email: normalizedEmail,
              password: data.password,
              firstName: data.firstName,
              lastName: data.lastName,
              phone: data.phone || '',
              country: data.country,
            });
            if (ownerRepairResult) {
              return ownerRepairResult;
            }
          }
          return {
            success: false,
            message: 'Signups are temporarily throttled. Your data was not saved yet. Please wait a moment and then try again or sign in if your account already exists.',
            rateLimited: true,
            email: normalizedEmail,
            accountType,
            ownerReviewRequired,
          };
        }
        console.log('[Auth] Register rejection handled:', error.message, 'email:', normalizedEmail);
        return { success: false, message: error.message, email: normalizedEmail, accountType, ownerReviewRequired };
      }

      const identities = Array.isArray(authData.user?.identities) ? authData.user.identities : [];
      if (authData.user && !authData.session && identities.length === 0) {
        console.log('[Auth] Supabase returned existing-account signup response:', normalizedEmail);
        return {
          success: false,
          message: 'This account already exists. Please sign in.',
          alreadyExists: true,
          requiresLogin: true,
          email: normalizedEmail,
          accountType,
          ownerReviewRequired,
        };
      }

      if (authData.user) {
        const registryTimestamp = registrationTimestamp;
        await upsertStoredMemberRegistryRecord({
          id: authData.user.id,
          email: normalizedEmail,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone || '',
          country: data.country,
          role: signupRole,
          status: signupStatus,
          kycStatus,
          createdAt: registryTimestamp,
          updatedAt: registryTimestamp,
          lastSeenAt: registryTimestamp,
          source: 'signup',
        });

        const shadowResult = await persistMemberRegistrationShadow({
          email: normalizedEmail,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone || '',
          country: data.country,
          createdAt: registryTimestamp,
        });
        if (!shadowResult.success) {
          console.log('[Auth] Member shadow note:', shadowResult.error || 'unknown');
        }

        const profileResult = await ensureMemberProfileRecord({
          id: authData.user.id,
          email: normalizedEmail,
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone || '',
          country: data.country,
          kycStatus,
          role: signupRole,
          status: signupStatus,
          source: 'signup',
        });
        if (!profileResult.success) {
          console.log('[Auth] Profile ensure note:', profileResult.error || 'unknown');
        }

        const walletResult = await ensureMemberWalletRecord(authData.user.id);
        if (!walletResult.success) {
          console.log('[Auth] Wallet ensure note:', walletResult.error || 'unknown');
        }

        if (authData.session) {
          const handledSession = await handleSession(authData.session);
          if (!handledSession.accepted) {
            return {
              success: false,
              message: handledSession.blockedReason ?? getAdminAccessLockMessage(),
              requiresLogin: false,
              email: normalizedEmail,
              accountType,
              ownerReviewRequired,
            };
          }
        }

        void syncMemberRegistryFromSupabase();

        // Auto-detect and save timezone on registration
        try {
          const tzProfile = await autoDetectAndSaveTimezone();
          console.log('[Auth] Timezone auto-detected on registration:', tzProfile.timezone, 'offset:', tzProfile.utc_offset);
        } catch (tzError) {
          console.log('[Auth] Timezone auto-detect failed (non-blocking):', (tzError as Error)?.message);
        }

        // If signUp did not return a session (email confirmation still active at project level),
        // try to sign in immediately — the backend auto-confirms emails, so signInWithPassword
        // should succeed right away.
        if (!authData.session && authData.user) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: normalizedEmail,
            password: data.password,
          });
          if (!signInError && signInData.session) {
            const handledSession = await handleSession(signInData.session);
            if (!handledSession.accepted) {
              return {
                success: false,
                message: handledSession.blockedReason ?? getAdminAccessLockMessage(),
                requiresLogin: false,
                email: normalizedEmail,
                accountType,
                ownerReviewRequired,
              };
            }
            authData.session = signInData.session;
          }
        }

        console.log('[Auth] Registration successful for:', authData.user.id);
        return {
          success: true,
          message: isOwnerSignup
            ? (authData.session
              ? 'Owner account created and approved. You can open Owner Access now with this account.'
              : 'Owner account created and approved. Please sign in with this email.')
            : (authData.session
              ? 'Registration successful.'
              : 'Registration successful. Please sign in with your account.'),
          requiresLogin: !authData.session,
          email: normalizedEmail,
          accountType,
          ownerReviewRequired,
        };
      }

      return { success: false, message: 'Registration failed', email: normalizedEmail, accountType, ownerReviewRequired };
    } catch (error: unknown) {
      const exceptionMessage = extractAuthErrorMessage(error) || 'Registration failed';
      const normalizedEmail = sanitizeEmail(data.email);
      console.log('[Auth] Register exception handled:', exceptionMessage, 'email:', normalizedEmail);
      const lowerMessage = String(exceptionMessage).toLowerCase();
      if (lowerMessage.includes('over_email_send_rate_limit') || (lowerMessage.includes('rate limit') && lowerMessage.includes('email'))) {
        if (data.accountType === 'owner') {
          const ownerRepairResult = await repairOwnerRegistrationThroughBackend({
            email: normalizedEmail,
            password: data.password,
            firstName: data.firstName,
            lastName: data.lastName,
            phone: data.phone || '',
            country: data.country,
          });
          if (ownerRepairResult) {
            return ownerRepairResult;
          }
        }
        return {
          success: false,
          message: 'Signups are temporarily throttled. Your data was not saved yet. Please wait a moment and then try again or sign in if your account already exists.',
          rateLimited: true,
          email: normalizedEmail,
          accountType: data.accountType === 'owner' ? 'owner' : 'investor',
          ownerReviewRequired: false,
        };
      }
      return {
        success: false,
        message: exceptionMessage,
        email: normalizedEmail,
        accountType: data.accountType === 'owner' ? 'owner' : 'investor',
        ownerReviewRequired: false,
      };
    } finally {
      setRegisterLoading(false);
    }
  }, [handleSession]);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    try {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.log('[Auth] Refresh failed:', error.message);
        return false;
      }
      if (data.session) {
        const handledSession = await handleSession(data.session);
        if (!handledSession.accepted) {
          console.log('[Auth] Session refresh blocked:', handledSession.blockedReason ?? 'admin access lock');
          return false;
        }
        console.log('[Auth] Session refreshed');
        return true;
      }
      return false;
    } catch (error) {
      console.log('[Auth] Refresh exception handled:', extractAuthErrorMessage(error) ?? 'unknown refresh error');
      return false;
    }
  }, [handleSession]);

  const auditOwnerDirectAccess = useCallback(async (requestedEmail?: string): Promise<OwnerDirectAccessAuditResult> => {
    const normalizedRequestedEmail = sanitizeEmail(requestedEmail ?? '');

    try {
      const [ipEnabled, ownerDeviceVerified, ownerDeviceMeta, storedIP, currentIP] = await Promise.all([
        isStoredOwnerIPEnabled(),
        isOwnerDeviceVerified(),
        getVerifiedOwnerDeviceMeta(),
        getStoredOwnerIP(),
        fetchDeviceIP(),
      ]);

      if (currentIP) {
        setDetectedIP(currentIP);
      }

      const hasValidTrustedIdentity = isValidOwnerVerifiedUserId(ownerDeviceMeta.userId);
      const verifiedEmail = sanitizeEmail(ownerDeviceMeta.email ?? '');
      const hasStoredVerifiedEmail = verifiedEmail.length > 0;
      const emailMismatch = normalizedRequestedEmail.length > 0 && hasStoredVerifiedEmail && normalizedRequestedEmail !== verifiedEmail;
      const emailCheckPassed = !emailMismatch;
      const effectiveOwnerEmail = normalizedRequestedEmail || verifiedEmail;

      if (isAdminAccessLocked() && !isOwnerAdminEmail(effectiveOwnerEmail)) {
        const configuredOwnerEmail = getConfiguredOwnerAdminEmail();
        const message = configuredOwnerEmail
          ? `Admin access is temporarily limited to ${configuredOwnerEmail} while testing.`
          : getAdminAccessLockMessage();
        const audit: OwnerDirectAccessAuditResult = {
          eligible: false,
          message,
          currentIP,
          storedIP,
          ipEnabled,
          ownerDeviceVerified,
          verifiedUserId: ownerDeviceMeta.userId,
          verifiedRole: ownerDeviceMeta.role,
          verifiedAt: ownerDeviceMeta.verifiedAt,
          requestedEmail: normalizedRequestedEmail || null,
          verifiedEmail: verifiedEmail || null,
          hasStoredVerifiedEmail,
          emailCheckPassed: false,
          emailMismatch: normalizedRequestedEmail.length > 0,
          trustedDeviceWindowActive: isTrustedOwnerDeviceWithinWindow(ownerDeviceMeta.verifiedAt),
          hasValidTrustedIdentity,
          exactIPMatch: !!(ipEnabled && ownerDeviceVerified && storedIP && currentIP && storedIP === currentIP),
          subnetMatch: !!(ipEnabled && ownerDeviceVerified && storedIP && currentIP && isCarrierSubnetMatch(currentIP, storedIP)),
          blockingReasons: [message],
          accessPath: 'none',
        };
        console.log('[Auth] Owner direct-access audit blocked by temporary owner-only admin lock:', JSON.stringify(audit));
        return audit;
      }

      if (ownerDeviceVerified && !hasValidTrustedIdentity) {
        console.log('[Auth] Owner direct-access audit found invalid trusted owner metadata. Clearing legacy owner-claim state:', ownerDeviceMeta.userId);
        await clearOwnerIP();
        const audit: OwnerDirectAccessAuditResult = {
          eligible: false,
          message: 'This device has legacy owner claim data from an older broken flow. Sign in with your verified owner account once, then verify this device again in Owner Controls.',
          currentIP,
          storedIP,
          ipEnabled: false,
          ownerDeviceVerified: false,
          verifiedUserId: null,
          verifiedRole: null,
          verifiedAt: null,
          requestedEmail: normalizedRequestedEmail || null,
          verifiedEmail: null,
          hasStoredVerifiedEmail: false,
          emailCheckPassed,
          emailMismatch,
          trustedDeviceWindowActive: false,
          hasValidTrustedIdentity: false,
          exactIPMatch: false,
          subnetMatch: false,
          blockingReasons: [
            'Legacy trusted-device metadata was found on this device and was cleared because the verified owner id was invalid.',
          ],
          accessPath: 'none',
        };
        console.log('[Auth] Owner direct-access audit reset invalid trusted metadata:', JSON.stringify(audit));
        return audit;
      }

      const trustedDeviceWindowActive = isTrustedOwnerDeviceWithinWindow(ownerDeviceMeta.verifiedAt);
      const hasExactIPMatch = !!(ipEnabled && ownerDeviceVerified && storedIP && currentIP && storedIP === currentIP);
      const hasSubnetMatch = !!(ipEnabled && ownerDeviceVerified && storedIP && currentIP && isCarrierSubnetMatch(currentIP, storedIP));
      const hasTrustedWindowAccess = !!(ipEnabled && ownerDeviceVerified && trustedDeviceWindowActive && ownerDeviceMeta.userId);
      const eligibleByTrustSignal = hasExactIPMatch || hasSubnetMatch || hasTrustedWindowAccess;
      const eligible = eligibleByTrustSignal && emailCheckPassed;
      const accessPath: 'none' | 'ip_match' | 'trusted_device' = hasExactIPMatch || hasSubnetMatch ? 'ip_match' : hasTrustedWindowAccess ? 'trusted_device' : 'none';
      const blockingReasons: string[] = [];

      if (!ipEnabled) {
        blockingReasons.push('Trusted owner mode is disabled on this device.');
      }
      if (!ownerDeviceVerified) {
        blockingReasons.push('This device has not been verified from a signed-in owner/admin session yet.');
      }
      if (ownerDeviceVerified && !hasValidTrustedIdentity) {
        blockingReasons.push('The stored verified owner id is missing or invalid.');
      }
      if (emailMismatch) {
        blockingReasons.push(`Entered email ${normalizedRequestedEmail} does not match verified owner email ${verifiedEmail}.`);
      }
      if (ipEnabled && ownerDeviceVerified && !storedIP) {
        blockingReasons.push('No trusted owner network is stored on this device.');
      }
      if (ipEnabled && ownerDeviceVerified && !trustedDeviceWindowActive) {
        blockingReasons.push('The trusted-device verification window is no longer active.');
      }
      if (ipEnabled && ownerDeviceVerified && storedIP && !currentIP && !hasTrustedWindowAccess) {
        blockingReasons.push('The current network identity could not be detected, so exact trusted restore could not be confirmed.');
      }
      if (ipEnabled && ownerDeviceVerified && storedIP && currentIP && !hasExactIPMatch && !hasSubnetMatch && !hasTrustedWindowAccess) {
        blockingReasons.push(`Current network ${currentIP} does not match trusted network ${storedIP}.`);
      }

      const message = emailMismatch
        ? `The entered email (${normalizedRequestedEmail}) does not match the verified owner email (${verifiedEmail}) saved on this trusted device.`
        : !ipEnabled
          ? 'Trusted owner mode is not enabled on this device.'
          : !ownerDeviceVerified
            ? 'This device has not been server-verified for trusted owner access.'
            : !storedIP
              ? 'No trusted owner network is stored on this device.'
              : hasExactIPMatch
                ? `Trusted owner access is available for ${currentIP}.`
                : hasSubnetMatch
                  ? `Trusted owner access available — carrier subnet match (${currentIP} ≈ ${storedIP}).`
                  : hasTrustedWindowAccess
                    ? 'Trusted device verified within 30-day window. Tap to restore access.'
                    : !currentIP
                      ? 'Current network identity could not be verified, so trusted owner access stays locked.'
                      : `Current network ${currentIP} does not match the trusted owner network ${storedIP}.`;

      const audit: OwnerDirectAccessAuditResult = {
        eligible,
        message,
        currentIP,
        storedIP,
        ipEnabled,
        ownerDeviceVerified,
        verifiedUserId: ownerDeviceMeta.userId,
        verifiedRole: ownerDeviceMeta.role,
        verifiedAt: ownerDeviceMeta.verifiedAt,
        requestedEmail: normalizedRequestedEmail || null,
        verifiedEmail: verifiedEmail || null,
        hasStoredVerifiedEmail,
        emailCheckPassed,
        emailMismatch,
        trustedDeviceWindowActive,
        hasValidTrustedIdentity,
        exactIPMatch: hasExactIPMatch,
        subnetMatch: hasSubnetMatch,
        blockingReasons,
        accessPath,
      };

      console.log('[Auth] Owner direct-access audit:', JSON.stringify(audit));
      return audit;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to audit trusted owner access';
      const audit: OwnerDirectAccessAuditResult = {
        eligible: false,
        message,
        currentIP: null,
        storedIP: null,
        ipEnabled: false,
        ownerDeviceVerified: false,
        verifiedUserId: null,
        verifiedRole: null,
        verifiedAt: null,
        requestedEmail: normalizedRequestedEmail || null,
        verifiedEmail: null,
        hasStoredVerifiedEmail: false,
        emailCheckPassed: false,
        emailMismatch: false,
        trustedDeviceWindowActive: false,
        hasValidTrustedIdentity: false,
        exactIPMatch: false,
        subnetMatch: false,
        blockingReasons: [message],
        accessPath: 'none',
      };
      console.log('[Auth] Owner direct-access audit failed:', JSON.stringify(audit));
      return audit;
    }
  }, []);

  const auditOwnerIdentity = useCallback(async (requestedEmail?: string): Promise<OwnerIdentityAuditResult> => {
    const normalizedRequestedEmail = sanitizeEmail(requestedEmail ?? user?.email ?? '');

    try {
      const [ownerDeviceVerified, ownerDeviceMeta, sessionResult] = await Promise.all([
        isOwnerDeviceVerified(),
        getVerifiedOwnerDeviceMeta(),
        supabase.auth.getSession(),
      ]);

      const trustedDeviceVerifiedEmail = sanitizeEmail(ownerDeviceMeta.email ?? '');
      const trustedDeviceVerifiedRole = normalizeRole(ownerDeviceMeta.role);
      const trustedDeviceHasValidIdentity = isValidOwnerVerifiedUserId(ownerDeviceMeta.userId);
      const trustedDeviceWindowActive = isTrustedOwnerDeviceWithinWindow(ownerDeviceMeta.verifiedAt);
      const trustedDeviceAuthorityIsAdmin = ownerDeviceVerified
        && trustedDeviceHasValidIdentity
        && isAdminRole(trustedDeviceVerifiedRole);

      const session = sessionResult.data.session;
      const authenticatedEmail = sanitizeEmail(session?.user.email ?? user?.email ?? '');
      const authenticatedUserId = session?.user.id ?? user?.id ?? null;
      let authenticatedRole = normalizeRole(userRole);
      let authenticatedRoleSource: OwnerIdentityAuditSource = 'not_authenticated';

      if (session?.user.id) {
        const resolvedRole = await resolveServerRole(session.user.id, session.user.email);
        authenticatedRole = normalizeRole(resolvedRole.role);
        authenticatedRoleSource = resolvedRole.source;
      } else if (isOwnerIPAccess && user?.id) {
        authenticatedRole = normalizeRole(userRole);
        authenticatedRoleSource = 'owner_ip_access';
      } else if (isAuthenticated && user?.id) {
        authenticatedRole = normalizeRole(userRole);
        authenticatedRoleSource = 'local_session';
      }

      const matchesAuthenticatedEmail = normalizedRequestedEmail.length > 0
        && authenticatedEmail.length > 0
        && normalizedRequestedEmail === authenticatedEmail;
      const matchesTrustedDeviceEmail = normalizedRequestedEmail.length > 0
        && trustedDeviceVerifiedEmail.length > 0
        && normalizedRequestedEmail === trustedDeviceVerifiedEmail;
      const authenticatedAuthorityIsAdmin = matchesAuthenticatedEmail
        && isAdminRole(authenticatedRole)
        && authenticatedRoleSource !== 'owner_ip_access';
      const trustedOwnerAuthorityBySession = matchesAuthenticatedEmail
        && isAdminRole(authenticatedRole)
        && authenticatedRoleSource === 'owner_ip_access';

      const warnings: string[] = [];

      if (!normalizedRequestedEmail) {
        warnings.push('No owner email is being audited yet. Carry or enter the owner email first.');
      }
      if (matchesAuthenticatedEmail && authenticatedEmail && !isAdminRole(authenticatedRole)) {
        warnings.push(`Authenticated role for ${authenticatedEmail} is ${authenticatedRole || 'unknown'}, so it is not owner-capable authority.`);
      }
      if (ownerDeviceVerified && !trustedDeviceHasValidIdentity) {
        warnings.push('Trusted-device metadata exists, but the verified owner id is invalid.');
      }
      if (ownerDeviceVerified && trustedDeviceVerifiedEmail.length === 0) {
        warnings.push('Trusted-device verification exists, but the verified owner email is missing.');
      }
      if (ownerDeviceVerified && !trustedDeviceWindowActive) {
        warnings.push('Trusted-device verification exists, but the 30-day trusted-device window has expired.');
      }
      if (normalizedRequestedEmail && authenticatedEmail && !matchesAuthenticatedEmail) {
        warnings.push(`Authenticated session email ${authenticatedEmail} does not match audited email ${normalizedRequestedEmail}.`);
      }
      if (normalizedRequestedEmail && trustedDeviceVerifiedEmail && !matchesTrustedDeviceEmail) {
        warnings.push(`Trusted-device owner email ${trustedDeviceVerifiedEmail} does not match audited email ${normalizedRequestedEmail}.`);
      }
      if (!session?.user && !isOwnerIPAccess) {
        warnings.push('No live authenticated session is active, so owner authority can only be proven from trusted-device evidence right now.');
      }

      let status: OwnerIdentityAuditStatus = 'unverified';
      let message = normalizedRequestedEmail
        ? `No verified owner authority was found for ${normalizedRequestedEmail} in the current session or trusted-device records.`
        : 'Carry or enter the owner email to compare it against the current session and trusted-device records.';

      if (authenticatedAuthorityIsAdmin) {
        status = 'verified_owner_authority';
        message = `${normalizedRequestedEmail || authenticatedEmail} is authenticated with verified ${authenticatedRole} authority from ${authenticatedRoleSource}.`;
      } else if (trustedOwnerAuthorityBySession || (matchesTrustedDeviceEmail && trustedDeviceAuthorityIsAdmin)) {
        status = 'trusted_device_owner_authority';
        message = `${normalizedRequestedEmail || trustedDeviceVerifiedEmail || authenticatedEmail} matches the verified owner authority anchored to this trusted device.`;
      } else if (matchesAuthenticatedEmail && authenticatedEmail) {
        status = 'normal_user_account';
        message = `${normalizedRequestedEmail || authenticatedEmail} is authenticated, but the verified role is ${authenticatedRole || 'unknown'}. This is a normal user account, not owner authority.`;
      } else if (normalizedRequestedEmail && trustedDeviceVerifiedEmail && !matchesTrustedDeviceEmail) {
        status = 'email_mismatch';
        message = `${normalizedRequestedEmail} does not match the verified owner email ${trustedDeviceVerifiedEmail} saved on this device.`;
      }

      const audit: OwnerIdentityAuditResult = {
        requestedEmail: normalizedRequestedEmail || null,
        authenticatedUserId,
        authenticatedEmail: authenticatedEmail || null,
        authenticatedRole: authenticatedRole || null,
        authenticatedRoleSource,
        authenticatedAuthorityIsAdmin: authenticatedAuthorityIsAdmin || trustedOwnerAuthorityBySession,
        trustedDeviceVerified: ownerDeviceVerified,
        trustedDeviceVerifiedUserId: ownerDeviceMeta.userId,
        trustedDeviceVerifiedEmail: trustedDeviceVerifiedEmail || null,
        trustedDeviceVerifiedRole: trustedDeviceVerifiedRole || null,
        trustedDeviceVerifiedAt: ownerDeviceMeta.verifiedAt,
        trustedDeviceWindowActive,
        trustedDeviceHasValidIdentity,
        trustedDeviceAuthorityIsAdmin,
        matchesAuthenticatedEmail,
        matchesTrustedDeviceEmail,
        status,
        isVerifiedOwnerAuthority: status === 'verified_owner_authority' || status === 'trusted_device_owner_authority',
        isNormalUserOnly: status === 'normal_user_account',
        message,
        warnings,
      };

      console.log('[Auth] Owner identity audit:', JSON.stringify(audit));
      return audit;
    } catch (error) {
      const message = extractAuthErrorMessage(error) || 'Failed to audit owner identity';
      const audit: OwnerIdentityAuditResult = {
        requestedEmail: normalizedRequestedEmail || null,
        authenticatedUserId: user?.id ?? null,
        authenticatedEmail: sanitizeEmail(user?.email ?? '') || null,
        authenticatedRole: normalizeRole(userRole) || null,
        authenticatedRoleSource: isOwnerIPAccess ? 'owner_ip_access' : isAuthenticated && user?.id ? 'local_session' : 'not_authenticated',
        authenticatedAuthorityIsAdmin: isAdminRole(normalizeRole(userRole)) && !!user?.id,
        trustedDeviceVerified: false,
        trustedDeviceVerifiedUserId: null,
        trustedDeviceVerifiedEmail: null,
        trustedDeviceVerifiedRole: null,
        trustedDeviceVerifiedAt: null,
        trustedDeviceWindowActive: false,
        trustedDeviceHasValidIdentity: false,
        trustedDeviceAuthorityIsAdmin: false,
        matchesAuthenticatedEmail: normalizedRequestedEmail.length > 0 && sanitizeEmail(user?.email ?? '') === normalizedRequestedEmail,
        matchesTrustedDeviceEmail: false,
        status: 'unverified',
        isVerifiedOwnerAuthority: false,
        isNormalUserOnly: false,
        message,
        warnings: [message],
      };
      console.log('[Auth] Owner identity audit failed:', JSON.stringify(audit));
      return audit;
    }
  }, [isAuthenticated, isOwnerIPAccess, resolveServerRole, user?.email, user?.id, userRole]);

  const activateOwnerAccess = useCallback(async (explicitOwnerEmail?: string) => {
    if (shouldBlockRoleForAdminAccess(userRole, explicitOwnerEmail || user?.email)) {
      return { success: false, message: getAdminAccessLockMessage() };
    }

    setActivatingOwner(true);
    try {
      if (!user?.id) {
        return { success: false, message: 'Not authenticated' };
      }

      const { data: { session: currentSession } } = await supabase.auth.getSession();
      if (!currentSession) {
        console.log('[Auth] activateOwnerAccess blocked: no active Supabase session is available for verification');
        return { success: false, message: 'No active session. Please log in again.' };
      }

      const roleResolution = await resolveServerRole(user.id, currentSession.user.email);
      let serverRole = normalizeRole(roleResolution.role);
      let roleSource: ServerRoleResolutionSource = roleResolution.source;
      console.log('[Auth] activateOwnerAccess role resolution:', serverRole, 'source:', roleSource, 'user:', user.id);

      if (!isAdminRole(serverRole)) {
        const [ownerDeviceVerified, trustedOwnerMeta] = await Promise.all([
          isOwnerDeviceVerified(),
          getVerifiedOwnerDeviceMeta(),
        ]);
        const trustedRole = normalizeRole(trustedOwnerMeta.role);
        const sameVerifiedUser = ownerDeviceVerified
          && isValidOwnerVerifiedUserId(trustedOwnerMeta.userId)
          && trustedOwnerMeta.userId === user.id;

        if (sameVerifiedUser && isAdminRole(trustedRole)) {
          serverRole = trustedRole;
          roleSource = 'trusted_device';
          console.log('[Auth] activateOwnerAccess recovered admin role from previously verified trusted device:', trustedRole, 'user:', user.id);
        }
      }

      if (!isAdminRole(serverRole)) {
        console.log('[Auth] activateOwnerAccess denied — server role is:', serverRole, 'source:', roleSource, 'for user:', user.id);
        return { success: false, message: `Access denied. Verified role is ${serverRole}.` };
      }

      setUserRole(serverRole);
      setUser(prev => prev ? { ...prev, role: serverRole } : prev);

      setAuthCredentials(null, user.id, serverRole);

      await persistAuth({
        token: currentSession.access_token,
        refreshToken: currentSession.refresh_token || '',
        userId: currentSession.user.id,
        userRole: serverRole,
      });

      const currentIP = detectedIP ?? await fetchDeviceIP();
      if (currentIP) {
        setDetectedIP(currentIP);
        await setOwnerIP(currentIP);
      }
      const verifiedOwnerEmail = sanitizeEmail(explicitOwnerEmail || currentSession.user.email || user?.email || '');
      await setVerifiedOwnerDevice(currentSession.user.id, serverRole, verifiedOwnerEmail);

      console.log('[Auth] Owner access verified from server and trusted device updated. Role:', serverRole, 'source:', roleSource, 'IP:', currentIP ?? 'unavailable');
      return {
        success: true,
        message: currentIP
          ? `Trusted owner device updated for ${currentIP}`
          : `Trusted owner device verified with role: ${serverRole}`,
      };
    } catch (error: unknown) {
      const msg = extractAuthErrorMessage(error) || 'Failed to activate owner access';
      console.log('[Auth] activateOwnerAccess exception handled:', msg);
      return { success: false, message: msg };
    } finally {
      setActivatingOwner(false);
    }
  }, [user, userRole, detectedIP, resolveServerRole]);

  const claimOwnerDevice = useCallback(async (ownerEmail?: string): Promise<LoginResult> => {
    setOwnerAccessLoading(true);
    try {
      console.log('[Auth] Owner device verification requested from owner-access hub. Email:', ownerEmail || 'none', 'authenticated:', !!user?.id, 'role:', userRole);
      if (!user?.id || !isAdminRole(userRole)) {
        return {
          success: false,
          message: ownerEmail
            ? `Sign in with ${ownerEmail} first, then verify this device in Owner Controls.`
            : 'Sign in with your verified owner account first, then verify this device in Owner Controls.',
        };
      }

      const result = await activateOwnerAccess(ownerEmail);
      if (!result.success) {
        return result;
      }

      return {
        success: true,
        message: result.message,
      };
    } catch (e: any) {
      console.log('[Auth] claimOwnerDevice error:', e?.message);
      return { success: false, message: e?.message || 'Failed to verify trusted owner device' };
    } finally {
      setOwnerAccessLoading(false);
    }
  }, [activateOwnerAccess, user?.id, userRole]);

  const ownerDirectAccess = useCallback(async (requestedEmail?: string): Promise<LoginResult> => {
    setOwnerAccessLoading(true);
    try {
      const audit = await auditOwnerDirectAccess(requestedEmail);
      if (!audit.eligible) {
        return {
          success: false,
          message: audit.message,
        };
      }

      const accessIdentity = audit.currentIP ?? audit.storedIP ?? 'trusted-device';
      const normalizedTrustedRole = normalizeRole(audit.verifiedRole);
      const trustedRole = isAdminRole(normalizedTrustedRole) ? normalizedTrustedRole : 'owner';
      if (audit.currentIP && audit.storedIP && audit.currentIP !== audit.storedIP) {
        await setOwnerIP(audit.currentIP);
        console.log('[Auth] ownerDirectAccess: Updated stored IP to current:', audit.currentIP);
      }
      console.log('[Auth] ownerDirectAccess: restoring via path:', audit.accessPath, 'identity:', accessIdentity, 'role:', trustedRole, 'verifiedUserId:', audit.verifiedUserId);
      activateOwnerIPSession(accessIdentity, trustedRole, audit.verifiedUserId, audit.verifiedEmail);
      return {
        success: true,
        message: `Trusted owner access restored for ${accessIdentity}`,
      };
    } catch (e: any) {
      return { success: false, message: e?.message || 'Failed to restore trusted owner access' };
    } finally {
      setOwnerAccessLoading(false);
    }
  }, [activateOwnerIPSession, auditOwnerDirectAccess]);

  const refetchProfile = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const challengeRequired = await requireTwoFactorIfNeeded(session, 'profile refetch');
        if (!challengeRequired) {
          const handledSession = await handleSession(session);
          if (!handledSession.accepted) {
            console.log('[Auth] Profile refetch blocked:', handledSession.blockedReason ?? 'admin access lock');
          }
        }
      }
    } catch (e) {
      console.log('[Auth] refetchProfile error:', (e as Error)?.message);
    }
  }, [handleSession, requireTwoFactorIfNeeded]);

  return useMemo(() => ({
    user,
    isAuthenticated,
    isLoading,
    isAdmin: isAdminRole(userRole) && !shouldBlockRoleForAdminAccess(userRole, user?.email),
    userRole,
    userId: user?.id ?? null,
    login,
    register,
    logout: doLogout,
    verify2FA,
    cancelTwoFactor,
    requiresTwoFactor,
    refreshSession,
    activateOwnerAccess,
    activatingOwner,
    auditOwnerDirectAccess,
    auditOwnerIdentity,
    ownerDirectAccess,
    claimOwnerDevice,
    loginOwnerPasswordless,
    ownerAccessLoading,
    isOwnerIPAccess,
    detectedIP,
    loginLoading,
    registerLoading,
    verify2FALoading,
    pendingTwoFactorEmail,
    pendingTwoFactorFactorLabel: pendingTwoFactorFactor?.friendlyName ?? 'Authenticator app',
    profileData: user,
    refetchProfile,
  }), [
    user, isAuthenticated, isLoading, userRole, login, register, doLogout,
    verify2FA, cancelTwoFactor, requiresTwoFactor, refreshSession,
    activateOwnerAccess, activatingOwner, auditOwnerDirectAccess, auditOwnerIdentity, ownerDirectAccess, claimOwnerDevice, loginOwnerPasswordless, ownerAccessLoading, loginLoading, verify2FALoading, registerLoading,
    refetchProfile, isOwnerIPAccess, detectedIP, pendingTwoFactorEmail, pendingTwoFactorFactor,
  ]);
});
