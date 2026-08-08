/**
 * Passwordless owner sign-in.
 *
 * POST /api/ivx/owner-passwordless-login
 *   body: { email, emergency }
 *
 * The owner types ONLY their email. The backend:
 *   1. Validates the email is in the owner allowlist
 *      (IVX_OWNER_REGISTRATION_EMAILS / IVX_BASELINE_OWNER_EMAILS).
 *   2. Uses a single Supabase admin generateLink(magiclink) call which both
 *      resolves the user (creating them if needed) AND returns the hashed
 *      token needed for session minting. This replaces the prior 3-call
 *      sequence (listUsers → createUser → updateUserById) that timed out
 *      on Render free tier.
 *   3. PRESERVES the owner's password: mints the session with a server-side
 *      magic-link token (admin generateLink + verifyOtp token_hash). The
 *      owner's manual password is NEVER modified by this flow anymore.
 *   4. Falls back to the legacy password self-heal ONLY if the magic-link
 *      session mint fails, so owner access can never be fully locked out.
 *
 * No password is ever sent back to the client. The client installs the
 * returned session via supabase.auth.setSession(), which produces a real
 * Supabase session — so owner-AI chat approval (allowlist + bearer check)
 * works automatically.
 */
import { randomBytes } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getIVXOwnerEmailAllowlist } from '../../expo/shared/ivx/access-control';

const DEPLOYMENT_MARKER = 'ivx-owner-passwordless-login-generatelink-optimized-2026-08-08';

const PASSWORDLESS_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEmail(value: unknown): string {
  return readTrimmed(value).toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Generate a cryptographically random password (only used when creating a brand-new auth user or in the legacy fallback). */
function generateRandomPassword(): string {
  return randomBytes(32).toString('base64url') + '!A1';
}

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function resolveSupabaseUrl(): string {
  return readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
}

function resolveServiceRoleKey(): string {
  return readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
}

function resolveAnonKey(): string {
  return readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY');
}

function createAdminClient() {
  const supabaseUrl = resolveSupabaseUrl();
  const serviceRoleKey = resolveServiceRoleKey();
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured on the backend (EXPO_PUBLIC_SUPABASE_URL).');
  }
  if (!serviceRoleKey) {
    throw new Error('Supabase service role key is not configured on the backend (SUPABASE_SERVICE_ROLE_KEY).');
  }
  const SUPABASE_ADMIN_TIMEOUT_MS = 12_000;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false, debug: false },
    global: {
      headers: { 'X-Client-Info': 'ivx-owner-passwordless-login' },
      fetch: (url: RequestInfo | URL, init: RequestInit = {}) => {
        const signal = AbortSignal.timeout(SUPABASE_ADMIN_TIMEOUT_MS);
        const mergedInit = init.signal
          ? init
          : { ...init, signal };
        return fetch(url, mergedInit);
      },
    },
  });
}

type OwnerSessionResponse = {
  success: true;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  expiresAtIso: string;
  userId: string;
  email: string;
  /** Always false on the primary path now — the owner password is preserved. */
  passwordSelfHealed: boolean;
  /** True when the owner's manual password was NOT modified by this login. */
  passwordPreserved: boolean;
  /** 'magiclink_token_hash' (primary, password untouched) or 'legacy_password_self_heal' (fallback). */
  sessionMethod: string;
  authUserCreated: boolean;
  deploymentMarker: string;
  timestamp: string;
};

type OwnerSessionFailure = {
  success: false;
  message: string;
  rootCause: string;
  deploymentMarker: string;
  timestamp: string;
};

type MintedSession = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
};

/**
 * Mint a real Supabase session WITHOUT touching the owner's password.
 *
 * Uses a single admin generateLink(magiclink) call which both resolves the
 * user (creating them if they don't exist) AND returns the hashed_token
 * needed for OTP verification. This eliminates the prior listUsers call
 * that fetched up to 1000 users just to find one by email — a call that
 * consistently timed out on Render free tier.
 *
 * Returns the user ID alongside the session so callers don't need a
 * separate lookup.
 */
async function mintSessionViaMagicLink(
  adminClient: SupabaseClient,
  email: string,
): Promise<{ ok: boolean; session?: MintedSession; userId?: string; userCreated?: boolean; errorMessage?: string }> {
  const supabaseUrl = resolveSupabaseUrl();
  const anonKey = resolveAnonKey();
  if (!anonKey) {
    return { ok: false, errorMessage: 'Supabase anon key is not configured on the backend.' };
  }

  let tokenHash = '';
  let userId = '';
  let userCreated = false;
  try {
    const { data, error } = await adminClient.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: {
        createUser: true,
        data: {
          accountType: 'owner',
          requestedRole: 'owner',
          role: 'owner',
          status: 'active',
          kycStatus: 'approved',
        },
      },
    });
    if (error) {
      return { ok: false, errorMessage: `generateLink failed: ${error.message}` };
    }
    const properties = data?.properties as { hashed_token?: string } | null | undefined;
    tokenHash = typeof properties?.hashed_token === 'string' ? properties.hashed_token : '';
    if (!tokenHash) {
      return { ok: false, errorMessage: 'generateLink did not return a hashed_token.' };
    }
    // generateLink returns the user object — extract ID and creation status
    const user = data?.user as { id?: string; created_at?: string } | null | undefined;
    userId = typeof user?.id === 'string' ? user.id : '';
    // If the user was just created, created_at will be very recent.
    // Supabase sets action_link for new users; we infer creation from the
    // user object presence and the fact that generateLink with createUser
    // creates if not exists.
    userCreated = Boolean(userId);
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : 'generateLink threw.' };
  }

  try {
    const anonClient = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await anonClient.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
    if (error) {
      return { ok: false, errorMessage: `verifyOtp failed: ${error.message}` };
    }
    const session = data?.session;
    const accessToken = typeof session?.access_token === 'string' ? session.access_token : '';
    const refreshToken = typeof session?.refresh_token === 'string' ? session.refresh_token : '';
    const expiresAt = typeof session?.expires_at === 'number' ? session.expires_at : 0;
    if (!accessToken || !refreshToken) {
      return { ok: false, errorMessage: 'verifyOtp did not return access_token/refresh_token.' };
    }
    // Prefer the session user ID if generateLink didn't return one
    const sessionUserId = typeof session?.user?.id === 'string' ? session.user.id : '';
    return {
      ok: true,
      session: { accessToken, refreshToken, expiresAt },
      userId: userId || sessionUserId,
      userCreated,
    };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : 'verifyOtp threw.' };
  }
}

/** Server-side password grant against the Supabase Auth token endpoint (legacy fallback only). */
async function passwordGrant(supabaseUrl: string, email: string, password: string): Promise<{
  ok: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  errorMessage?: string;
  errorStatus?: number;
}> {
  const endpoint = `${supabaseUrl.replace(/\/+$/, '')}/auth/v1/token?grant_type=password`;
  const anonKey = resolveAnonKey();
  if (!anonKey) {
    return { ok: false, errorMessage: 'Supabase anon key is not configured on the backend.' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ email, password }),
      signal: controller.signal,
    });
    const text = await response.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      return { ok: false, errorMessage: `Supabase returned non-JSON auth response (HTTP ${response.status}).` };
    }
    if (!response.ok) {
      const message = typeof parsed.error_description === 'string'
        ? parsed.error_description
        : typeof parsed.msg === 'string'
          ? parsed.msg
          : typeof parsed.error === 'string'
            ? parsed.error
            : `Supabase rejected the password grant (HTTP ${response.status}).`;
      return { ok: false, errorMessage: message, errorStatus: response.status };
    }
    const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token : '';
    const refreshToken = typeof parsed.refresh_token === 'string' ? parsed.refresh_token : '';
    const expiresAt = typeof parsed.expires_at === 'number' ? parsed.expires_at : 0;
    if (!accessToken || !refreshToken) {
      return { ok: false, errorMessage: 'Supabase did not return access_token/refresh_token.' };
    }
    return { ok: true, accessToken, refreshToken, expiresAt };
  } catch (error) {
    return { ok: false, errorMessage: error instanceof Error ? error.message : 'Network failure during password grant.' };
  } finally {
    clearTimeout(timer);
  }
}

export function ivxOwnerPasswordlessLoginOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXOwnerPasswordlessLogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return ownerOnlyJson({ success: false, message: 'Method not allowed.', deploymentMarker: DEPLOYMENT_MARKER }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const email = sanitizeEmail(body.email);

  // EMERGENCY-ONLY GATE: passwordless login is restricted to emergency recovery.
  // The owner must use standard email + password sign-in for routine access.
  // This endpoint is kept as a last-resort lockout recovery path only.
  const emergency = readTrimmed(body.emergency).toLowerCase();
  if (emergency !== 'true' && emergency !== 'ivx_emergency_recovery') {
    const failure: OwnerSessionFailure = {
      success: false,
      message: 'Passwordless owner login is emergency-only. Please sign in with your email and password. If you are locked out, include { "emergency": "ivx_emergency_recovery" } in the request body.',
      rootCause: 'passwordless_not_emergency_mode',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(failure, 403);
  }

  if (!isValidEmail(email)) {
    const failure: OwnerSessionFailure = {
      success: false,
      message: 'A valid owner email is required.',
      rootCause: 'missing_or_invalid_email',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(failure, 400);
  }

  const allowlist = getIVXOwnerEmailAllowlist();
  if (!allowlist.includes(email)) {
    const failure: OwnerSessionFailure = {
      success: false,
      message: 'This email is not on the owner allowlist. Owner login is restricted to the configured owner.',
      rootCause: 'email_not_allowlisted',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(failure, 403);
  }

  const supabaseUrl = resolveSupabaseUrl();
  if (!supabaseUrl) {
    const failure: OwnerSessionFailure = {
      success: false,
      message: 'Supabase URL is not configured on the backend.',
      rootCause: 'supabase_url_not_configured',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(failure, 500);
  }

  let adminClient: SupabaseClient;
  try {
    adminClient = createAdminClient();
  } catch (error) {
    const failure: OwnerSessionFailure = {
      success: false,
      message: error instanceof Error ? error.message : 'Failed to initialize Supabase admin client.',
      rootCause: 'admin_client_init_failed',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(failure, 500);
  }

  // PRIMARY PATH — generateLink both resolves/creates the user AND returns
  // the magic-link token in a SINGLE Supabase admin call. This replaces the
  // prior 3-call sequence (listUsers → createUser → updateUserById) that
  // consistently timed out on Render free tier.
  const minted = await mintSessionViaMagicLink(adminClient, email);
  if (minted.ok && minted.session) {
    const expiresAt = minted.session.expiresAt;
    const successPayload: OwnerSessionResponse = {
      success: true,
      accessToken: minted.session.accessToken,
      refreshToken: minted.session.refreshToken,
      expiresAt,
      expiresAtIso: expiresAt ? new Date(expiresAt * 1000).toISOString() : nowIso(),
      userId: minted.userId ?? '',
      email,
      passwordSelfHealed: false,
      passwordPreserved: true,
      sessionMethod: 'magiclink_token_hash',
      authUserCreated: minted.userCreated ?? false,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(successPayload as unknown as Record<string, unknown>);
  }

  // LEGACY FALLBACK — only if the magic-link mint failed.
  // We need the user ID for the fallback. Try generateLink again without
  // createUser to get the user, or use a lightweight createUser if needed.
  let fallbackUserId = minted.userId ?? '';
  if (!fallbackUserId) {
    // Last resort: try createUser to get a user ID for the password reset
    try {
      const { data: createData, error: createError } = await adminClient.auth.admin.createUser({
        email,
        password: readEnv('IVX_OWNER_PASSWORD') || generateRandomPassword(),
        email_confirm: true,
        user_metadata: {
          accountType: 'owner',
          requestedRole: 'owner',
          role: 'owner',
          status: 'active',
          kycStatus: 'approved',
        },
        app_metadata: {
          accountType: 'owner',
          requestedRole: 'owner',
          role: 'owner',
        },
      });
      if (!createError && createData.user) {
        fallbackUserId = createData.user.id;
      }
    } catch {
      // If createUser also fails, we cannot proceed with the fallback
    }
  }

  if (!fallbackUserId) {
    const failure: OwnerSessionFailure = {
      success: false,
      message: `Magic-link session mint failed (${minted.errorMessage ?? 'unknown'}) and no user ID available for password fallback.`,
      rootCause: 'fallback_no_user_id',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(failure, 502);
  }

  const ownerPassword = readEnv('IVX_OWNER_PASSWORD') || generateRandomPassword();
  let passwordSelfHealed = false;
  try {
    const { error: updateError } = await adminClient.auth.admin.updateUserById(fallbackUserId, {
      password: ownerPassword,
      email_confirm: true,
      ban_duration: 'none',
    });
    if (updateError) {
      const failure: OwnerSessionFailure = {
        success: false,
        message: `Magic-link session mint failed (${minted.errorMessage ?? 'unknown'}) and fallback password reset failed: ${updateError.message}`,
        rootCause: 'fallback_password_reset_failed',
        deploymentMarker: DEPLOYMENT_MARKER,
        timestamp: nowIso(),
      };
      return ownerOnlyJson(failure, 502);
    }
    passwordSelfHealed = true;
  } catch (error) {
    const failure: OwnerSessionFailure = {
      success: false,
      message: error instanceof Error ? error.message : 'Fallback password reset threw.',
      rootCause: 'fallback_password_reset_threw',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(failure, 502);
  }

  const grant = await passwordGrant(supabaseUrl, email, ownerPassword);
  if (!grant.ok || !grant.accessToken || !grant.refreshToken) {
    const failure: OwnerSessionFailure = {
      success: false,
      message: grant.errorMessage ?? 'Password grant failed.',
      rootCause: 'password_grant_failed',
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    };
    return ownerOnlyJson(failure, 502);
  }

  const expiresAt = grant.expiresAt ?? 0;
  const successPayload: OwnerSessionResponse = {
    success: true,
    accessToken: grant.accessToken,
    refreshToken: grant.refreshToken,
    expiresAt,
    expiresAtIso: expiresAt ? new Date(expiresAt * 1000).toISOString() : nowIso(),
    userId: fallbackUserId,
    email,
    passwordSelfHealed,
    passwordPreserved: false,
    sessionMethod: 'legacy_password_self_heal',
    authUserCreated: false,
    deploymentMarker: DEPLOYMENT_MARKER,
    timestamp: nowIso(),
  };
  return ownerOnlyJson(successPayload as unknown as Record<string, unknown>);
}
