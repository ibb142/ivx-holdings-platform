import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
type OwnerRegistrationPayload = {
  email?: unknown;
  password?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  phone?: unknown;
  country?: unknown;
};

type OwnerAccessRepairPayload = {
  email?: unknown;
  phone?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  country?: unknown;
  sendPasswordReset?: unknown;
  redirectTo?: unknown;
  /** New owner password supplied by the phone UI for same-value reset + immediate sign-in. */
  newPassword?: unknown;
  /** Backward-compatible alias; prefer newPassword from the mobile app. */
  password?: unknown;
};

type OwnerRegistrationProof = {
  authUserCreated: boolean;
  emailConfirmed: boolean;
  profilePersisted: boolean;
  walletPersisted: boolean;
  role: 'owner';
  status: 'active';
  kycStatus: 'approved';
  accountType: 'owner';
  requestedRole: 'owner';
};

type OwnerEmailLookup = {
  requested: boolean;
  allowed: boolean;
  authUserExists: boolean | null;
  profileExists: boolean | null;
  walletExists: boolean | null;
  safeToSignup: boolean;
  action: 'signup' | 'sign_in' | 'not_allowed' | 'unavailable';
  message: string;
  secretValuesReturned: false;
};

type OwnerSignupAuditSummary = {
  ownerExists: boolean;
  authUserExists: boolean;
  profileExists: boolean;
  walletExists: boolean;
  emailConfirmed: boolean;
  phonePresent: boolean;
  duplicateCount: number;
  orphanCount: number;
  repairAvailable: boolean;
  secretValuesReturned: false;
};

type SafeOwnerRecord = {
  id: string;
  email: string | null;
  phone: string | null;
  role?: string | null;
  kyc_status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type SafeWalletRecord = {
  user_id: string;
  currency?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

const DEPLOYMENT_MARKER = 'ivx-owner-registration-2026-05-11t-render-direct-phone-repair-v7';
const OWNER_ACCESS_REPAIR_BACKEND_VERSION = 'V7';
const DEFAULT_OWNER_PASSWORD_RESET_REDIRECT_URL = 'https://ivxholding.com/reset-password.html';

const OWNER_REGISTRATION_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
} as const;

const REQUEST_WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 6;
const ownerRegistrationAttempts = new Map<string, { count: number; resetAt: number }>();

function nowIso(): string {
  return new Date().toISOString();
}

function json(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: OWNER_REGISTRATION_HEADERS,
  });
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEmail(value: unknown): string {
  return readTrimmed(value).toLowerCase();
}

function normalizePhone(value: unknown): string {
  const raw = readTrimmed(value);
  if (!raw) {
    return '';
  }

  const digits = raw.replace(/\D/g, '');
  if (digits.length < 8) {
    return '';
  }

  return `+${digits}`;
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return '***';
  const visibleLocal = local.length <= 2 ? `${local[0] ?? '*'}*` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${visibleLocal}@${domain}`;
}

function maskPhone(phone: string): string | null {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return `${normalized.slice(0, 2)}***${normalized.slice(-4)}`;
}

function readMetadataString(user: User, key: string): string {
  const userMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
  return readTrimmed(userMetadata[key]) || readTrimmed(appMetadata[key]);
}

function readUserProviders(user: User): string[] {
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const identityProviders = identities
    .map((identity) => readTrimmed((identity as { provider?: unknown }).provider).toLowerCase())
    .filter(Boolean);
  const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
  const metadataProvider = readTrimmed(appMetadata.provider).toLowerCase();
  const providers = [...identityProviders, metadataProvider].filter(Boolean);
  return Array.from(new Set(providers));
}

function isUserBanned(user: User): boolean {
  const bannedUntil = readTrimmed((user as { banned_until?: unknown }).banned_until);
  if (!bannedUntil) return false;
  if (bannedUntil.toLowerCase() === 'none') return false;
  const bannedTime = Date.parse(bannedUntil);
  return Number.isFinite(bannedTime) ? bannedTime > Date.now() : true;
}

function readBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

function getUserNormalizedPhone(user: User): string {
  return normalizePhone(user.phone) || normalizePhone(readMetadataString(user, 'phone'));
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseEmailList(value: string): string[] {
  return value
    .split(',')
    .map((item) => sanitizeEmail(item))
    .filter((item) => isValidEmail(item));
}

function getAllowedOwnerRegistrationEmails(): string[] {
  const values = [
    readTrimmed(process.env.IVX_OWNER_REGISTRATION_EMAILS),
    readTrimmed(process.env.EXPO_PUBLIC_OWNER_EMAIL),
    readTrimmed(process.env.NEXT_PUBLIC_OWNER_EMAIL),
    readTrimmed(process.env.OWNER_EMAIL),
  ].filter(Boolean);

  return Array.from(new Set(values.flatMap(parseEmailList)));
}

function assertOwnerRegistrationEmailAllowed(email: string): void {
  const allowedEmails = getAllowedOwnerRegistrationEmails();
  if (allowedEmails.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Owner registration is not configured. Set IVX_OWNER_REGISTRATION_EMAILS or EXPO_PUBLIC_OWNER_EMAIL on the backend.');
    }
    console.log('[IVXOwnerRegistration] No owner registration allowlist configured in non-production mode.');
    return;
  }

  if (!allowedEmails.includes(email)) {
    throw new Error('Owner registration is limited to the configured owner email. Use Owner Login or Owner Recovery for existing accounts.');
  }
}

function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least 1 uppercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least 1 number.';
  }
  return null;
}

function safeSupabaseProjectHost(): string | null {
  // The service-role key is the authoritative source of the project ref. The
  // EXPO_PUBLIC_SUPABASE_URL env var may be stale or point to a different
  // project, so derive the host from the JWT instead of the URL.
  const serviceRoleKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
  const keyRef = decodeJwtRef(serviceRoleKey);
  if (keyRef) {
    return `${keyRef}.supabase.co`;
  }
  const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL);
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).hostname;
  } catch {
    return null;
  }
}

function decodeJwtRole(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) {
    return null;
  }

  try {
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { role?: unknown };
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

function decodeJwtRef(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) {
    return null;
  }

  try {
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { ref?: unknown };
    return typeof parsed.ref === 'string' ? parsed.ref : null;
  } catch {
    return null;
  }
}

function extractSupabaseProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co\b/i);
  return match?.[1] ?? null;
}

function getServiceRoleKey(): string {
  const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const serviceKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
  const role = decodeJwtRole(serviceKey);
  if (!serviceKey || serviceKey === anonKey || (role !== 'service_role' && role !== 'supabase_admin')) {
    throw new Error('A backend-only Supabase service-role key is required for owner registration repair.');
  }
  return serviceKey;
}

function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured on the backend.');
  }

  const urlRef = extractSupabaseProjectRef(supabaseUrl);
  const keyRef = decodeJwtRef(serviceRoleKey);
  if (urlRef && keyRef && urlRef !== keyRef) {
    throw new Error(
      `Supabase project mismatch: EXPO_PUBLIC_SUPABASE_URL points to ${urlRef} but the service-role key belongs to ${keyRef}. Fix these variables in the backend runtime.`,
    );
  }

  const runtimeFetch = ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      fetch: runtimeFetch,
    },
  });
}

function readClientIp(request: Request): string {
  const forwardedFor = readTrimmed(request.headers.get('x-forwarded-for')).split(',')[0]?.trim();
  return forwardedFor || readTrimmed(request.headers.get('cf-connecting-ip')) || readTrimmed(request.headers.get('x-real-ip')) || 'unknown';
}

function assertRateLimit(email: string, request: Request): void {
  const ip = readClientIp(request);
  const key = `${email}:${ip}`;
  const now = Date.now();
  const current = ownerRegistrationAttempts.get(key);
  if (!current || current.resetAt <= now) {
    ownerRegistrationAttempts.set(key, { count: 1, resetAt: now + REQUEST_WINDOW_MS });
    return;
  }

  if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    throw new Error('Owner registration repair is temporarily rate limited. Please wait one minute and try again.');
  }

  current.count += 1;
}

async function listAuthUsersForAudit(client: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) {
      console.log('[IVXOwnerRegistration] Auth user audit lookup skipped:', error.message);
      return users;
    }
    users.push(...data.users);
    if (data.users.length < 1000) {
      return users;
    }
  }
  return users;
}

async function findAuthUserByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  const users = await listAuthUsersForAudit(client);
  return users.find((user) => sanitizeEmail(user.email ?? '') === email) ?? null;
}

async function inspectOwnerPersistence(client: SupabaseClient, userId: string): Promise<{ profileExists: boolean | null; walletExists: boolean | null }> {
  const [profileResult, walletResult] = await Promise.allSettled([
    client.from('profiles').select('id', { count: 'exact', head: true }).eq('id', userId),
    client.from('wallets').select('user_id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);

  const profileExists = profileResult.status === 'fulfilled'
    ? profileResult.value.error ? null : (profileResult.value.count ?? 0) > 0
    : null;
  const walletExists = walletResult.status === 'fulfilled'
    ? walletResult.value.error ? null : (walletResult.value.count ?? 0) > 0
    : null;

  return { profileExists, walletExists };
}

async function selectProfilesForAudit(client: SupabaseClient, email: string, phone: string, candidateIds: string[]): Promise<{ records: SafeOwnerRecord[]; unavailable: boolean; error: string | null }> {
  const byId = new Map<string, SafeOwnerRecord>();
  const queries: PromiseLike<{ data: SafeOwnerRecord[] | null; error: { message?: string } | null }>[] = [];
  if (email) {
    queries.push(client.from('profiles').select('id,email,phone,role,kyc_status,created_at,updated_at').eq('email', email) as unknown as PromiseLike<{ data: SafeOwnerRecord[] | null; error: { message?: string } | null }>);
  }
  if (phone) {
    queries.push(client.from('profiles').select('id,email,phone,role,kyc_status,created_at,updated_at').eq('phone', phone) as unknown as PromiseLike<{ data: SafeOwnerRecord[] | null; error: { message?: string } | null }>);
  }
  if (candidateIds.length > 0) {
    queries.push(client.from('profiles').select('id,email,phone,role,kyc_status,created_at,updated_at').in('id', candidateIds) as unknown as PromiseLike<{ data: SafeOwnerRecord[] | null; error: { message?: string } | null }>);
  }

  let unavailable = false;
  let errorMessage: string | null = null;
  const results = await Promise.allSettled(queries);
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      unavailable = true;
      errorMessage = result.reason instanceof Error ? result.reason.message : 'profiles query failed';
      continue;
    }
    if (result.value.error) {
      unavailable = true;
      errorMessage = result.value.error.message ?? 'profiles query failed';
      continue;
    }
    for (const record of result.value.data ?? []) {
      byId.set(record.id, record);
    }
  }

  return { records: Array.from(byId.values()), unavailable, error: errorMessage };
}

async function selectWalletsForAudit(client: SupabaseClient, candidateIds: string[]): Promise<{ records: SafeWalletRecord[]; unavailable: boolean; error: string | null }> {
  if (candidateIds.length === 0) {
    return { records: [], unavailable: false, error: null };
  }

  const { data, error } = await client
    .from('wallets')
    .select('user_id,currency,created_at,updated_at')
    .in('user_id', candidateIds);

  if (error) {
    return { records: [], unavailable: true, error: error.message };
  }

  return { records: (data ?? []) as SafeWalletRecord[], unavailable: false, error: null };
}

async function countAuditLogsForOwner(client: SupabaseClient, userId: string | null): Promise<number | null> {
  if (!userId) return null;
  const { count, error } = await client
    .from('audit_trail')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId);
  if (error) {
    console.log('[IVXOwnerRegistration] Audit log count skipped:', error.message);
    return null;
  }
  return count ?? 0;
}

async function insertOwnerRegistrationAudit(client: SupabaseClient, input: {
  action: string;
  userId: string;
  email: string;
  profilePersisted: boolean;
  walletPersisted: boolean;
  source: 'owner_registration' | 'owner_repair' | 'owner_access_repair';
}): Promise<void> {
  const safeDetails = JSON.stringify({
    emailMasked: maskEmail(input.email),
    profilePersisted: input.profilePersisted,
    walletPersisted: input.walletPersisted,
    secretValuesReturned: false,
  });
  const { error } = await client.from('audit_trail').insert({
    entity_type: 'owner_registration',
    entity_id: input.userId,
    entity_title: 'IVX owner account bootstrap',
    action: input.action,
    user_id: input.userId,
    user_role: 'owner',
    details: safeDetails,
    source: input.source,
  });
  if (error) {
    console.log('[IVXOwnerRegistration] Owner registration audit insert skipped:', error.message);
  }
}

function resolvePasswordResetRedirectUrl(value: unknown): string {
  const raw = readTrimmed(value);
  if (!raw) return DEFAULT_OWNER_PASSWORD_RESET_REDIRECT_URL;
  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return DEFAULT_OWNER_PASSWORD_RESET_REDIRECT_URL;
    }
    if (parsed.hostname.startsWith('api.')) {
      return DEFAULT_OWNER_PASSWORD_RESET_REDIRECT_URL;
    }
    return parsed.href;
  } catch {
    return DEFAULT_OWNER_PASSWORD_RESET_REDIRECT_URL;
  }
}

async function sendOwnerPasswordResetEmail(email: string, redirectTo: string): Promise<{ sent: boolean; httpStatus: number | null; message: string }> {
  const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
  const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  if (!supabaseUrl || !anonKey) {
    return { sent: false, httpStatus: null, message: 'Supabase public auth configuration is not available for reset email delivery.' };
  }

  try {
    const endpoint = `${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectTo)}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email }),
    });
    const sent = response.ok;
    return {
      sent,
      httpStatus: response.status,
      message: sent ? 'Password reset email accepted by Supabase Auth.' : `Supabase Auth reset email returned HTTP ${response.status}.`,
    };
  } catch (error) {
    return {
      sent: false,
      httpStatus: null,
      message: error instanceof Error ? error.message : 'Password reset email request failed.',
    };
  }
}

async function buildOwnerSignupAudit(client: SupabaseClient, email: string, requestedPhone: string): Promise<Record<string, unknown>> {
  const authUsers = await listAuthUsersForAudit(client);
  const matchingEmailUsers = authUsers.filter((user) => sanitizeEmail(user.email ?? '') === email);
  const firstAuthUserWithPhone = matchingEmailUsers.find((user) => Boolean(getUserNormalizedPhone(user))) ?? null;
  const inferredPhone = requestedPhone || (firstAuthUserWithPhone ? getUserNormalizedPhone(firstAuthUserWithPhone) : '');
  const matchingPhoneUsers = inferredPhone ? authUsers.filter((user) => getUserNormalizedPhone(user) === inferredPhone) : [];
  const candidateAuthUsers = Array.from(new Map([...matchingEmailUsers, ...matchingPhoneUsers].map((user) => [user.id, user])).values());
  const canonicalAuthUser = candidateAuthUsers
    .slice()
    .sort((left, right) => new Date(left.created_at ?? 0).getTime() - new Date(right.created_at ?? 0).getTime())[0] ?? null;
  const candidateIds = candidateAuthUsers.map((user) => user.id);
  const profiles = await selectProfilesForAudit(client, email, inferredPhone, candidateIds);
  const profileIds = profiles.records.map((record) => record.id);
  const mergedCandidateIds = Array.from(new Set([...candidateIds, ...profileIds]));
  const wallets = await selectWalletsForAudit(client, mergedCandidateIds);
  const allAuthUserIds = new Set(authUsers.map((user) => user.id));
  const canonicalUserId = canonicalAuthUser?.id ?? profileIds[0] ?? null;
  const canonicalProfile = canonicalUserId ? profiles.records.find((record) => record.id === canonicalUserId) ?? null : null;
  const canonicalWallet = canonicalUserId ? wallets.records.find((record) => record.user_id === canonicalUserId) ?? null : null;
  const profileOrphans = profiles.records.filter((record) => !allAuthUserIds.has(record.id));
  const walletOrphans = wallets.records.filter((record) => !allAuthUserIds.has(record.user_id));
  const duplicateCount = Math.max(0, matchingEmailUsers.length - 1)
    + Math.max(0, matchingPhoneUsers.length - 1)
    + Math.max(0, profiles.records.length - (canonicalProfile ? 1 : 0))
    + Math.max(0, wallets.records.length - (canonicalWallet ? 1 : 0));
  const orphanCount = profileOrphans.length + walletOrphans.length;
  const emailConfirmed = Boolean(canonicalAuthUser?.email_confirmed_at || canonicalAuthUser?.confirmed_at);
  const phonePresent = Boolean(inferredPhone || normalizePhone(canonicalProfile?.phone));
  const role = readTrimmed(canonicalProfile?.role)
    || (canonicalAuthUser ? readMetadataString(canonicalAuthUser, 'role') : '')
    || (canonicalAuthUser ? readMetadataString(canonicalAuthUser, 'requestedRole') : '')
    || null;
  const kycStatus = readTrimmed(canonicalProfile?.kyc_status)
    || (canonicalAuthUser ? readMetadataString(canonicalAuthUser, 'kycStatus') : '')
    || null;
  const auditLogCount = await countAuditLogsForOwner(client, canonicalUserId);
  const allowedEmails = getAllowedOwnerRegistrationEmails();
  const ownerAllowlistConfigured = allowedEmails.length > 0;
  const ownerAllowlistAllowed = ownerAllowlistConfigured ? allowedEmails.includes(email) : process.env.NODE_ENV !== 'production';
  const ownerExists = Boolean(canonicalAuthUser || canonicalProfile || canonicalWallet);
  const repairAvailable = Boolean(canonicalAuthUser && (!canonicalProfile || !canonicalWallet || role !== 'owner' || kycStatus !== 'approved'));
  const summary: OwnerSignupAuditSummary = {
    ownerExists,
    authUserExists: Boolean(canonicalAuthUser),
    profileExists: Boolean(canonicalProfile),
    walletExists: Boolean(canonicalWallet),
    emailConfirmed,
    phonePresent,
    duplicateCount,
    orphanCount,
    repairAvailable,
    secretValuesReturned: false,
  };

  return {
    ok: true,
    routeRegistered: true,
    route: 'GET /api/ivx/owner-signup-audit',
    deploymentMarker: DEPLOYMENT_MARKER,
    requestedEmailMasked: maskEmail(email),
    requestedPhoneMasked: maskPhone(inferredPhone),
    canonicalUserId,
    ownerExists: summary.ownerExists,
    authUserExists: summary.authUserExists,
    profileExists: summary.profileExists,
    walletExists: summary.walletExists,
    emailConfirmed: summary.emailConfirmed,
    phonePresent: summary.phonePresent,
    duplicateCount: summary.duplicateCount,
    orphanCount: summary.orphanCount,
    repairAvailable: summary.repairAvailable,
    role,
    kycStatus,
    profilePersisted: summary.profileExists,
    walletPersisted: summary.walletExists,
    ownerAllowlist: {
      configured: ownerAllowlistConfigured,
      allowed: ownerAllowlistAllowed,
    },
    auditLogs: {
      available: auditLogCount !== null,
      count: auditLogCount,
    },
    duplicates: {
      authEmailCount: matchingEmailUsers.length,
      authPhoneCount: matchingPhoneUsers.length,
      profileMatchCount: profiles.records.length,
      walletMatchCount: wallets.records.length,
    },
    orphans: {
      profileOrphanCount: profileOrphans.length,
      walletOrphanCount: walletOrphans.length,
    },
    mismatches: {
      profileMissing: Boolean(canonicalAuthUser && !canonicalProfile),
      walletMissing: Boolean(canonicalAuthUser && !canonicalWallet),
      roleMismatch: Boolean(role && role !== 'owner'),
      kycMismatch: Boolean(kycStatus && kycStatus !== 'approved'),
      profileQueryUnavailable: profiles.unavailable,
      walletQueryUnavailable: wallets.unavailable,
    },
    safeFlow: {
      existingOwnerRoutesToSignIn: Boolean(canonicalAuthUser),
      signupAllowedOnce: !canonicalAuthUser && ownerAllowlistAllowed,
      duplicateSignupBlocked: Boolean(canonicalAuthUser),
      postLoginRepairEndpoint: 'POST /api/ivx/owner-registration/repair',
    },
    secretValuesReturned: false,
    timestamp: nowIso(),
  };
}

function isOwnerLikeUser(user: User, email: string): boolean {
  const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
  const userMetadata = (user.user_metadata ?? {}) as Record<string, unknown>;
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
  ].map((value) => readTrimmed(value).toLowerCase());

  return getAllowedOwnerRegistrationEmails().includes(email)
    || candidates.some((candidate) => ['owner', 'admin', 'super_admin'].includes(candidate));
}

function readBearerToken(request: Request): string {
  const authorization = readTrimmed(request.headers.get('authorization'));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function getUserName(user: User, key: 'firstName' | 'lastName', fallback: string): string {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const snakeKey = key === 'firstName' ? 'first_name' : 'last_name';
  return readTrimmed(metadata[key]) || readTrimmed(metadata[snakeKey]) || fallback;
}

async function buildOwnerEmailLookup(email: string): Promise<OwnerEmailLookup> {
  if (!email) {
    return {
      requested: false,
      allowed: false,
      authUserExists: null,
      profileExists: null,
      walletExists: null,
      safeToSignup: false,
      action: 'unavailable',
      message: 'No owner email lookup was requested.',
      secretValuesReturned: false,
    };
  }

  if (!isValidEmail(email)) {
    return {
      requested: true,
      allowed: false,
      authUserExists: null,
      profileExists: null,
      walletExists: null,
      safeToSignup: false,
      action: 'not_allowed',
      message: 'A valid owner email is required before signup.',
      secretValuesReturned: false,
    };
  }

  try {
    const client = createSupabaseAdminClient();
    const existingUser = await findAuthUserByEmail(client, email);
    const allowedByEnv = (() => {
      try {
        assertOwnerRegistrationEmailAllowed(email);
        return true;
      } catch {
        return false;
      }
    })();

    if (existingUser) {
      const persistence = await inspectOwnerPersistence(client, existingUser.id);
      return {
        requested: true,
        allowed: allowedByEnv || isOwnerLikeUser(existingUser, email),
        authUserExists: true,
        profileExists: persistence.profileExists,
        walletExists: persistence.walletExists,
        safeToSignup: false,
        action: 'sign_in',
        message: 'Owner auth user already exists. Route to Owner Login instead of calling signup again. Post-login repair will verify owner authority before writing profile or wallet rows.',
        secretValuesReturned: false,
      };
    }

    if (!allowedByEnv) {
      return {
        requested: true,
        allowed: false,
        authUserExists: false,
        profileExists: false,
        walletExists: false,
        safeToSignup: false,
        action: 'not_allowed',
        message: 'Owner registration is limited to the configured owner email. Use Owner Login or Owner Recovery for existing accounts.',
        secretValuesReturned: false,
      };
    }

    return {
      requested: true,
      allowed: true,
      authUserExists: false,
      profileExists: false,
      walletExists: false,
      safeToSignup: true,
      action: 'signup',
      message: 'Owner email is allowlisted and no existing auth user was found. A single backend signup attempt is allowed.',
      secretValuesReturned: false,
    };
  } catch (error) {
    console.log('[IVXOwnerRegistration] Owner email lookup unavailable:', error instanceof Error ? error.message : 'unknown');
    return {
      requested: true,
      allowed: true,
      authUserExists: null,
      profileExists: null,
      walletExists: null,
      safeToSignup: false,
      action: 'unavailable',
      message: 'Owner email lookup is unavailable because backend Supabase admin credentials are not ready.',
      secretValuesReturned: false,
    };
  }
}

async function ensureOwnerProfile(client: SupabaseClient, input: {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  country: string;
  timestamp: string;
}): Promise<boolean> {
  /**
   * Production profiles schema (see expo/scripts/supabase-full-schema.sql) does NOT
   * include a `status` column. Sending it caused PostgREST to reject the upsert with
   * `column profiles.status does not exist`, so the row was never written.
   * Owner active-status is already proven via auth.users + role='owner' + kyc_status='approved'.
   */
  const basePayload: Record<string, unknown> = {
    id: input.userId,
    email: input.email,
    first_name: input.firstName,
    last_name: input.lastName,
    phone: input.phone,
    country: input.country,
    role: 'owner',
    avatar: '',
    kyc_status: 'approved',
    total_invested: 0,
    total_returns: 0,
    created_at: input.timestamp,
    updated_at: input.timestamp,
  };

  const { error } = await client
    .from('profiles')
    .upsert(basePayload, {
      onConflict: 'id',
      ignoreDuplicates: false,
    });

  if (error) {
    const message = error.message || '';
    const lower = message.toLowerCase();
    // Defensive: if the production schema is missing another optional column
    // (e.g. country/avatar) drop it and retry once with the minimum owner row.
    const missingColumnMatch = lower.match(/column "?([a-z_]+)"? .*does not exist/);
    const missingColumn = missingColumnMatch?.[1];
    if (missingColumn && missingColumn in basePayload) {
      console.log('[IVXOwnerRegistration] Owner profile upsert dropping missing column and retrying:', missingColumn);
      const retryPayload = { ...basePayload };
      delete retryPayload[missingColumn];
      const retry = await client
        .from('profiles')
        .upsert(retryPayload, { onConflict: 'id', ignoreDuplicates: false });
      if (!retry.error) {
        return true;
      }
      console.log('[IVXOwnerRegistration] Owner profile retry upsert failed:', retry.error.message);
      return false;
    }
    console.log('[IVXOwnerRegistration] Owner profile upsert failed:', message);
    return false;
  }

  return true;
}

async function ensureOwnerWallet(client: SupabaseClient, userId: string): Promise<boolean> {
  const { error } = await client
    .from('wallets')
    .upsert({
      user_id: userId,
      available: 0,
      pending: 0,
      invested: 0,
      total: 0,
      currency: 'USD',
    }, {
      onConflict: 'user_id',
      ignoreDuplicates: true,
    });

  if (error) {
    console.log('[IVXOwnerRegistration] Owner wallet ensure skipped:', error.message);
    return false;
  }

  return true;
}

function buildProof(input: { authUserCreated: boolean; profilePersisted: boolean; walletPersisted: boolean }): OwnerRegistrationProof {
  return {
    authUserCreated: input.authUserCreated,
    emailConfirmed: true,
    profilePersisted: input.profilePersisted,
    walletPersisted: input.walletPersisted,
    role: 'owner',
    status: 'active',
    kycStatus: 'approved',
    accountType: 'owner',
    requestedRole: 'owner',
  };
}

export function OPTIONS(): Response {
  return new Response(null, {
    status: 204,
    headers: OWNER_REGISTRATION_HEADERS,
  });
}

export async function handleIVXOwnerSignupAuditRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const email = sanitizeEmail(url.searchParams.get('email') ?? '');
  const phone = normalizePhone(url.searchParams.get('phone') ?? '');

  if (!isValidEmail(email)) {
    return json({
      ok: false,
      message: 'A valid owner email is required for the owner signup audit.',
      deploymentMarker: DEPLOYMENT_MARKER,
      secretValuesReturned: false,
      timestamp: nowIso(),
    }, 400);
  }

  try {
    const client = createSupabaseAdminClient();
    const audit = await buildOwnerSignupAudit(client, email, phone);
    const ownerAllowlist = audit.ownerAllowlist && typeof audit.ownerAllowlist === 'object' ? audit.ownerAllowlist as { allowed?: unknown } : null;
    const ownerExists = audit.ownerExists === true;
    if (ownerAllowlist?.allowed !== true && !ownerExists) {
      return json({
        ok: false,
        ownerExists: false,
        authUserExists: false,
        profileExists: false,
        walletExists: false,
        emailConfirmed: false,
        phonePresent: Boolean(phone),
        duplicateCount: 0,
        orphanCount: 0,
        repairAvailable: false,
        message: 'Owner registration is limited to the configured owner email. No existing owner record was found for this lookup.',
        deploymentMarker: DEPLOYMENT_MARKER,
        secretValuesReturned: false,
        timestamp: nowIso(),
      }, 403);
    }
    return json(audit);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner signup audit failed.';
    const status = message.toLowerCase().includes('limited to the configured owner email') ? 403 : 503;
    console.log('[IVXOwnerRegistration] Owner signup audit failed:', message);
    return json({
      ok: false,
      ownerExists: false,
      authUserExists: false,
      profileExists: false,
      walletExists: false,
      emailConfirmed: false,
      phonePresent: false,
      duplicateCount: 0,
      orphanCount: 0,
      repairAvailable: false,
      message,
      deploymentMarker: DEPLOYMENT_MARKER,
      secretValuesReturned: false,
      timestamp: nowIso(),
    }, status);
  }
}

export async function handleIVXOwnerRegistrationStatusRequest(request?: Request): Promise<Response> {
  const url = request ? new URL(request.url) : null;
  const lookupEmail = sanitizeEmail(url?.searchParams.get('email') ?? '');
  const ownerEmailLookup = lookupEmail ? await buildOwnerEmailLookup(lookupEmail) : null;

  return json({
    ok: true,
    routeRegistered: true,
    route: 'POST /api/ivx/owner-registration',
    statusRoute: 'GET /api/ivx/owner-registration/status',
    auditRoute: 'GET /api/ivx/owner-signup-audit',
    repairRoute: 'POST /api/ivx/owner-registration/repair',
    deploymentMarker: DEPLOYMENT_MARKER,
    supabaseUrlConfigured: Boolean(readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL)),
    serviceRoleConfigured: Boolean(readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY)),
    ownerEmailAllowlistConfigured: getAllowedOwnerRegistrationEmails().length > 0,
    ...(ownerEmailLookup ? { ownerEmailLookup } : {}),
    secretValuesReturned: false,
    timestamp: nowIso(),
  });
}

export async function handleIVXOwnerRegistrationRequest(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => ({})) as OwnerRegistrationPayload;
    const email = sanitizeEmail(body.email);
    const password = readTrimmed(body.password);
    const firstName = readTrimmed(body.firstName);
    const lastName = readTrimmed(body.lastName);
    const phone = normalizePhone(body.phone);
    const country = readTrimmed(body.country) || 'United States';

    if (!firstName || !lastName) {
      return json({ success: false, message: 'First and last name are required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
    }
    if (!isValidEmail(email)) {
      return json({ success: false, message: 'A valid email is required.', deploymentMarker: DEPLOYMENT_MARKER }, 400);
    }
    const passwordError = validatePassword(password);
    if (passwordError) {
      return json({ success: false, message: passwordError, deploymentMarker: DEPLOYMENT_MARKER }, 400);
    }

    const client = createSupabaseAdminClient();
    const existingUser = await findAuthUserByEmail(client, email);
    if (existingUser) {
      console.log('[IVXOwnerRegistration] Existing auth user found; owner signup must use login/recovery:', existingUser.id);
      const persistence = await inspectOwnerPersistence(client, existingUser.id);
      return json({
        success: false,
        alreadyExists: true,
        requiresLogin: true,
        email,
        userId: existingUser.id,
        ownerEmailLookup: {
          requested: true,
          allowed: true,
          authUserExists: true,
          profileExists: persistence.profileExists,
          walletExists: persistence.walletExists,
          safeToSignup: false,
          action: 'sign_in',
          message: 'Owner auth user already exists. Route to Owner Login instead of calling signup again.',
          secretValuesReturned: false,
        },
        message: 'This owner email already exists in Supabase Auth. Use Owner Login instead of creating a duplicate. After login, backend repair can create any missing profile or wallet rows without calling signup.',
        deploymentMarker: DEPLOYMENT_MARKER,
        secretValuesReturned: false,
      }, 409);
    }

    assertOwnerRegistrationEmailAllowed(email);
    assertRateLimit(email, request);

    const timestamp = nowIso();
    const metadata = {
      firstName,
      lastName,
      phone,
      country,
      referralCode: '',
      accountType: 'owner',
      requestedRole: 'owner',
      ownerSignupApprovedAt: timestamp,
      role: 'owner',
      status: 'active',
      kycStatus: 'approved',
    };

    const { data, error } = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      ...(phone ? { phone, phone_confirm: true } : {}),
      user_metadata: metadata,
      app_metadata: {
        accountType: 'owner',
        requestedRole: 'owner',
        role: 'owner',
      },
    });

    if (error || !data.user) {
      const message = error?.message || 'Supabase did not return a created owner user.';
      const lowerMessage = message.toLowerCase();
      if (lowerMessage.includes('already') || lowerMessage.includes('duplicate') || lowerMessage.includes('registered')) {
        const duplicateUser = await findAuthUserByEmail(client, email);
        const persistence = duplicateUser ? await inspectOwnerPersistence(client, duplicateUser.id) : { profileExists: null, walletExists: null };
        return json({
          success: false,
          alreadyExists: true,
          requiresLogin: true,
          email,
          userId: duplicateUser?.id ?? undefined,
          ownerEmailLookup: {
            requested: true,
            allowed: duplicateUser ? isOwnerLikeUser(duplicateUser, email) : true,
            authUserExists: Boolean(duplicateUser),
            profileExists: persistence.profileExists,
            walletExists: persistence.walletExists,
            safeToSignup: false,
            action: 'sign_in',
            message: 'Owner auth user already exists. Route to Owner Login instead of calling signup again.',
            secretValuesReturned: false,
          },
          message: 'This owner email already exists in Supabase Auth. Use Owner Login instead of creating a duplicate.',
          deploymentMarker: DEPLOYMENT_MARKER,
          secretValuesReturned: false,
        }, 409);
      }

      console.log('[IVXOwnerRegistration] Supabase admin createUser failed:', message);
      return json({ success: false, email, message, deploymentMarker: DEPLOYMENT_MARKER }, 502);
    }

    const profilePersisted = await ensureOwnerProfile(client, {
      userId: data.user.id,
      email,
      firstName,
      lastName,
      phone,
      country,
      timestamp,
    });
    const walletPersisted = await ensureOwnerWallet(client, data.user.id);
    await insertOwnerRegistrationAudit(client, {
      action: 'owner_registration_created',
      userId: data.user.id,
      email,
      profilePersisted,
      walletPersisted,
      source: 'owner_registration',
    });
    const proof = buildProof({ authUserCreated: true, profilePersisted, walletPersisted });

    console.log('[IVXOwnerRegistration] Owner registration saved:', {
      userId: data.user.id,
      email,
      profilePersisted,
      walletPersisted,
      timestamp,
    });

    return json({
      success: true,
      email,
      userId: data.user.id,
      requiresLogin: true,
      message: 'Owner registration saved with backend Supabase service-role repair. Email is already confirmed; sign in with the password you entered.',
      proof,
      deploymentMarker: DEPLOYMENT_MARKER,
      secretValuesReturned: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner registration repair failed.';
    const lowerMessage = message.toLowerCase();
    const status = lowerMessage.includes('rate limited')
      ? 429
      : lowerMessage.includes('service-role') || lowerMessage.includes('not configured')
        ? 503
        : lowerMessage.includes('limited to the configured owner email')
          ? 403
          : 500;
    console.log('[IVXOwnerRegistration] Request failed:', message);
    return json({
      success: false,
      message,
      deploymentMarker: DEPLOYMENT_MARKER,
      ...(status === 429 ? { rateLimited: true, cooldownSeconds: Math.ceil(REQUEST_WINDOW_MS / 1000) } : {}),
      secretValuesReturned: false,
    }, status);
  }
}

export async function handleIVXOwnerAccessRepairStatusRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ success: false, ok: false, backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION, message: 'Method not allowed.', deploymentMarker: DEPLOYMENT_MARKER, secretValuesReturned: false }, 405);
  }

  return json({
    success: true,
    ok: true,
    route: 'GET /api/ivx/owner-access-repair/status',
    backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION,
    backendVersionProof: 'owner-access-repair-v7-render-direct-client-password-required',
    phonePasswordSourceOfTruth: true,
    requiresClientPassword: true,
    acceptsNewPasswordFromPhone: true,
    passwordUpdateSource: 'client_request',
    ownerNewPasswordRuntimeSecretUsed: false,
    message: 'V7 owner repair is live on the real ivx-holdings-platform backend: phone must submit newPassword; OWNER_NEW_PASSWORD is not used for phone repair.',
    deploymentMarker: DEPLOYMENT_MARKER,
    secretValuesReturned: false,
    timestamp: nowIso(),
  });
}

export async function handleIVXOwnerAccessRepairRequest(request: Request): Promise<Response> {
  try {
    if (request.method !== 'POST') {
      return json({ success: false, ok: false, backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION, message: 'Method not allowed.', deploymentMarker: DEPLOYMENT_MARKER, secretValuesReturned: false }, 405);
    }

    const body = await request.json().catch(() => ({})) as OwnerAccessRepairPayload;
    const email = sanitizeEmail(body.email);
    const phone = normalizePhone(body.phone);
    const timestamp = nowIso();
    const shouldSendPasswordReset = readBoolean(body.sendPasswordReset, true);
    const redirectTo = resolvePasswordResetRedirectUrl(body.redirectTo);

    if (!isValidEmail(email)) {
      return json({ success: false, ok: false, backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION, message: 'A valid owner email is required for emergency owner access repair.', deploymentMarker: DEPLOYMENT_MARKER, secretValuesReturned: false }, 400);
    }

    assertOwnerRegistrationEmailAllowed(email);
    assertRateLimit(email, request);

    const client = createSupabaseAdminClient();
    const authUsers = await listAuthUsersForAudit(client);
    const matchingEmailUsers = authUsers.filter((user) => sanitizeEmail(user.email ?? '') === email);
    const matchingPhoneUsers = phone ? authUsers.filter((user) => getUserNormalizedPhone(user) === phone) : [];
    const candidateAuthUsers = Array.from(new Map([...matchingEmailUsers, ...matchingPhoneUsers].map((user) => [user.id, user])).values());
    const canonicalAuthUser = candidateAuthUsers
      .slice()
      .sort((left, right) => new Date(left.created_at ?? 0).getTime() - new Date(right.created_at ?? 0).getTime())[0] ?? null;

    let authUser = canonicalAuthUser;
    let authUserCreated = false;
    let passwordUpdatedFromRuntimeSecret = false;
    let passwordUpdatedFromClientRequest = false;
    const requestedOwnerPassword = readTrimmed(body.newPassword) || readTrimmed(body.password);
    if (!requestedOwnerPassword) {
      return json({
        success: false,
        ok: false,
        route: 'POST /api/ivx/owner-access-repair',
        backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION,
        message: 'Phone password is required. Enter a new owner password on the phone, then tap the primary server reset button again. This V7 endpoint does not use OWNER_NEW_PASSWORD for phone repair.',
        passwordUpdatedFromClientRequest: false,
        passwordUpdatedFromRuntimeSecret: false,
        passwordUpdateSource: 'none',
        passwordLoginEnabled: false,
        ownerNewPasswordRuntimeSecretUsed: false,
        deploymentMarker: DEPLOYMENT_MARKER,
        secretValuesReturned: false,
        timestamp,
      }, 400);
    }

    const requestedPasswordError = validatePassword(requestedOwnerPassword);
    if (requestedPasswordError) {
      return json({
        success: false,
        ok: false,
        route: 'POST /api/ivx/owner-access-repair',
        backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION,
        message: requestedPasswordError,
        passwordUpdatedFromClientRequest: false,
        passwordUpdatedFromRuntimeSecret: false,
        passwordUpdateSource: 'none',
        passwordLoginEnabled: false,
        ownerNewPasswordRuntimeSecretUsed: false,
        deploymentMarker: DEPLOYMENT_MARKER,
        secretValuesReturned: false,
        timestamp,
      }, 400);
    }

    // SECURITY LOCKDOWN (2026-07-17): this unauthenticated endpoint must never
    // set an owner password supplied by a client. The mobile "self-heal" that
    // used it has been removed; it allowed any typed password to become the
    // real owner password (account-takeover vector, broke wrong-password
    // rejection). Re-enabling requires the explicit server-side env opt-in
    // IVX_ALLOW_CLIENT_PASSWORD_REPAIR=true, which production must NOT set.
    const clientPasswordRepairEnabled = (process.env.IVX_ALLOW_CLIENT_PASSWORD_REPAIR ?? '').trim().toLowerCase() === 'true';
    if (!clientPasswordRepairEnabled) {
      return json({
        success: false,
        ok: false,
        route: 'POST /api/ivx/owner-access-repair',
        backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION,
        message: 'Setting the owner password through this endpoint is permanently disabled for security. Use the official password reset email flow (Forgot password on the login screen) to choose a new password.',
        passwordUpdatedFromClientRequest: false,
        passwordUpdatedFromRuntimeSecret: false,
        passwordUpdateSource: 'none',
        passwordLoginEnabled: false,
        ownerNewPasswordRuntimeSecretUsed: false,
        clientPasswordRepairDisabled: true,
        deploymentMarker: DEPLOYMENT_MARKER,
        secretValuesReturned: false,
        timestamp,
      }, 410);
    }

    const ownerPasswordToApply = requestedOwnerPassword;
    const passwordUpdateSource = 'client_request' as const;
    const firstName = readTrimmed(body.firstName) || (authUser ? getUserName(authUser, 'firstName', 'Owner') : 'Owner');
    const lastName = readTrimmed(body.lastName) || (authUser ? getUserName(authUser, 'lastName', '') : '');
    const country = readTrimmed(body.country) || (authUser ? readTrimmed((authUser.user_metadata ?? {}).country) : '') || 'United States';
    const repairedPhone = phone || (authUser ? getUserNormalizedPhone(authUser) : '');
    const ownerMetadata = {
      firstName,
      lastName,
      phone: repairedPhone,
      country,
      accountType: 'owner',
      requestedRole: 'owner',
      role: 'owner',
      status: 'active',
      kycStatus: 'approved',
      ownerAccessRepairedAt: timestamp,
    };

    if (!authUser) {
      const generatedPassword = `${crypto.randomUUID()}A1!${Date.now()}`;
      const { data, error } = await client.auth.admin.createUser({
        email,
        password: ownerPasswordToApply || generatedPassword,
        email_confirm: true,
        ...(repairedPhone ? { phone: repairedPhone, phone_confirm: true } : {}),
        user_metadata: ownerMetadata,
        app_metadata: {
          accountType: 'owner',
          requestedRole: 'owner',
          role: 'owner',
        },
      });
      if (error || !data.user) {
        const message = error?.message || 'Supabase did not return a created owner user.';
        return json({ success: false, ok: false, backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION, message, deploymentMarker: DEPLOYMENT_MARKER, secretValuesReturned: false, timestamp }, 502);
      }
      authUser = data.user;
      authUserCreated = true;
      passwordUpdatedFromRuntimeSecret = false;
      passwordUpdatedFromClientRequest = true;
    } else {
      const updatePayload = {
        email_confirm: true,
        ...(repairedPhone ? { phone: repairedPhone, phone_confirm: true } : {}),
        user_metadata: {
          ...(authUser.user_metadata ?? {}),
          ...ownerMetadata,
        },
        app_metadata: {
          ...(authUser.app_metadata ?? {}),
          accountType: 'owner',
          requestedRole: 'owner',
          role: 'owner',
        },
        ban_duration: 'none',
        ...(ownerPasswordToApply ? { password: ownerPasswordToApply } : {}),
      } as Parameters<typeof client.auth.admin.updateUserById>[1];
      const { data, error } = await client.auth.admin.updateUserById(authUser.id, updatePayload);
      if (error) {
        return json({ success: false, ok: false, backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION, message: error.message, deploymentMarker: DEPLOYMENT_MARKER, secretValuesReturned: false, timestamp }, 502);
      }
      passwordUpdatedFromRuntimeSecret = false;
      passwordUpdatedFromClientRequest = true;
      authUser = data.user ?? authUser;
    }

    const profilePersisted = await ensureOwnerProfile(client, {
      userId: authUser.id,
      email,
      firstName,
      lastName,
      phone: repairedPhone,
      country,
      timestamp,
    });
    const walletPersisted = await ensureOwnerWallet(client, authUser.id);
    await insertOwnerRegistrationAudit(client, {
      action: 'owner_access_repaired',
      userId: authUser.id,
      email,
      profilePersisted,
      walletPersisted,
      source: 'owner_access_repair',
    });

    const postRepairAudit = await buildOwnerSignupAudit(client, email, repairedPhone);
    const resetResult = shouldSendPasswordReset
      ? await sendOwnerPasswordResetEmail(email, redirectTo)
      : { sent: false, httpStatus: null, message: 'Password reset email was not requested.' };
    const providers = readUserProviders(authUser);
    const proof = buildProof({ authUserCreated, profilePersisted, walletPersisted });

    console.log('[IVXOwnerRegistration] Emergency owner access repair completed:', {
      userId: authUser.id,
      emailMasked: maskEmail(email),
      profilePersisted,
      walletPersisted,
      resetEmailAccepted: resetResult.sent,
      timestamp,
    });

    return json({
      success: true,
      ok: true,
      route: 'POST /api/ivx/owner-access-repair',
      deploymentMarker: DEPLOYMENT_MARKER,
      backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION,
      backendVersionProof: 'owner-access-repair-v7-render-direct-client-password-required',
      requestedEmailMasked: maskEmail(email),
      requestedPhoneMasked: maskPhone(repairedPhone),
      canonicalUserId: authUser.id,
      authUserCreated,
      authUserExists: true,
      emailConfirmed: Boolean(authUser.email_confirmed_at || authUser.confirmed_at) || true,
      phonePresent: Boolean(repairedPhone),
      providerTypes: providers,
      passwordLoginEnabled: providers.length === 0 || providers.includes('email'),
      disabledOrBanned: isUserBanned(authUser),
      lastSignInErrorAvailable: false,
      lastSignInError: null,
      profileExists: postRepairAudit.profileExists === true,
      walletExists: postRepairAudit.walletExists === true,
      role: 'owner',
      kycStatus: 'approved',
      duplicateCount: typeof postRepairAudit.duplicateCount === 'number' ? postRepairAudit.duplicateCount : 0,
      orphanCount: typeof postRepairAudit.orphanCount === 'number' ? postRepairAudit.orphanCount : 0,
      repairAvailable: false,
      passwordUpdatedFromRuntimeSecret,
      passwordUpdatedFromClientRequest,
      passwordUpdated: passwordUpdatedFromClientRequest,
      passwordUpdateSource,
      requestSource: 'client_request',
      passwordLoginSource: 'phone_in_memory_password',
      runtimePasswordSecretConfigured: false,
      ownerNewPasswordRuntimeSecretUsed: false,
      clientPasswordAccepted: true,
      supabaseProjectHost: safeSupabaseProjectHost(),
      resetEmailSent: resetResult.sent,
      resetEmailHttpStatus: resetResult.httpStatus,
      resetDeliveryStatus: resetResult.sent ? 'accepted' : 'not_accepted',
      resetRedirectHost: new URL(redirectTo).hostname,
      proof,
      message: 'Owner auth/profile/wallet repaired and password login was reset to the exact password submitted by the phone UI. The password value was not returned. OWNER_NEW_PASSWORD was not used for this phone repair flow.',
      secretValuesReturned: false,
      timestamp,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Emergency owner access repair failed.';
    const lowerMessage = message.toLowerCase();
    const status = lowerMessage.includes('rate limited')
      ? 429
      : lowerMessage.includes('limited to the configured owner email')
        ? 403
        : lowerMessage.includes('service-role') || lowerMessage.includes('not configured') || lowerMessage.includes('project mismatch')
          ? 503
          : 500;
    console.log('[IVXOwnerRegistration] Emergency owner access repair failed:', message);
    return json({
      success: false,
      ok: false,
      route: 'POST /api/ivx/owner-access-repair',
      message,
      backendVersion: OWNER_ACCESS_REPAIR_BACKEND_VERSION,
      deploymentMarker: DEPLOYMENT_MARKER,
      secretValuesReturned: false,
      timestamp: nowIso(),
    }, status);
  }
}

export async function handleIVXOwnerRegistrationRepairRequest(request: Request): Promise<Response> {
  try {
    const bearerToken = readBearerToken(request);
    if (!bearerToken) {
      return json({ success: false, message: 'Owner login is required before repair.', deploymentMarker: DEPLOYMENT_MARKER, secretValuesReturned: false }, 401);
    }

    const client = createSupabaseAdminClient();
    const { data, error } = await client.auth.getUser(bearerToken);
    const authUser = data.user;
    const email = sanitizeEmail(authUser?.email ?? '');

    if (error || !authUser || !email) {
      return json({ success: false, message: 'Owner session could not be verified for repair.', deploymentMarker: DEPLOYMENT_MARKER, secretValuesReturned: false }, 401);
    }

    try {
      assertOwnerRegistrationEmailAllowed(email);
    } catch (allowlistError) {
      if (!isOwnerLikeUser(authUser, email)) {
        return json({
          success: false,
          message: allowlistError instanceof Error ? allowlistError.message : 'Owner repair is limited to verified owner accounts.',
          deploymentMarker: DEPLOYMENT_MARKER,
          secretValuesReturned: false,
        }, 403);
      }
    }

    const body = await request.json().catch(() => ({})) as Partial<OwnerRegistrationPayload>;
    const timestamp = nowIso();
    const firstName = readTrimmed(body.firstName) || getUserName(authUser, 'firstName', 'Owner');
    const lastName = readTrimmed(body.lastName) || getUserName(authUser, 'lastName', '');
    const phone = normalizePhone(body.phone) || normalizePhone((authUser.user_metadata ?? {}).phone) || normalizePhone(authUser.phone);
    const country = readTrimmed(body.country) || readTrimmed((authUser.user_metadata ?? {}).country) || 'United States';
    const profilePersisted = await ensureOwnerProfile(client, {
      userId: authUser.id,
      email,
      firstName,
      lastName,
      phone,
      country,
      timestamp,
    });
    const walletPersisted = await ensureOwnerWallet(client, authUser.id);
    await insertOwnerRegistrationAudit(client, {
      action: 'owner_registration_repaired',
      userId: authUser.id,
      email,
      profilePersisted,
      walletPersisted,
      source: 'owner_repair',
    });
    const proof = buildProof({ authUserCreated: false, profilePersisted, walletPersisted });

    console.log('[IVXOwnerRegistration] Owner post-login repair completed:', {
      userId: authUser.id,
      email,
      profilePersisted,
      walletPersisted,
      timestamp,
    });

    return json({
      success: true,
      email,
      userId: authUser.id,
      requiresLogin: false,
      message: 'Owner profile and wallet repair completed after login without calling signup.',
      proof,
      deploymentMarker: DEPLOYMENT_MARKER,
      secretValuesReturned: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner post-login repair failed.';
    console.log('[IVXOwnerRegistration] Repair request failed:', message);
    return json({ success: false, message, deploymentMarker: DEPLOYMENT_MARKER, secretValuesReturned: false }, 500);
  }
}
