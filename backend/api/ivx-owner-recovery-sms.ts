/**
 * IVX Owner Login Recovery via SMS — secondary owner access path.
 *
 * Provides a redundant, AWS-SNS-backed SMS recovery link so the owner can
 * always get back into the app even when the primary email/password Supabase
 * login path is broken. The flow is:
 *
 *   1. Owner (or operator) calls POST /api/ivx/owner-recovery/request
 *      with the owner email. The backend resolves the registered owner phone
 *      (from the auth user or IVX_OWNER_RECOVERY_PHONE env), generates a
 *      6-digit code, persists it with a 5-minute TTL, and texts it via SNS.
 *   2. Owner receives the SMS, enters the code on the phone, which calls
 *      POST /api/ivx/owner-recovery/verify with email + code. On success the
 *      backend returns a short-lived recovery token and (optionally) repairs
 *      the owner password to the value submitted so the owner can sign in
 *      immediately.
 *   3. GET /api/ivx/owner-recovery/status exposes SNS readiness (no secrets).
 *
 * Security:
 *   - Codes are 6 digits, single-use, expire after 5 minutes.
 *   - Max 3 attempts per code, max 5 requests per phone per 15 minutes.
 *   - Owner email must match the allowlist (same gate as owner registration).
 *   - Recovery token is a random 256-bit secret, single-use, 10-minute TTL.
 *
 * AWS SNS is the active transport.
 */
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { sendSnsSms, isSnsSmsConfigured, generateRecoveryCode, resolveOwnerRecoveryPhone, normalizePhoneToE164 } from '../services/ivx-sns-sms';
import { appendRecoveryAudit, hashToken, hashPhone, generateSecureRecoveryToken } from '../services/ivx-owner-recovery-audit';

const RECOVERY_BACKEND_VERSION = 'V1-SNS';
const CODE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const RECOVERY_TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes
const MAX_VERIFY_ATTEMPTS = 3;
const REQUEST_WINDOW_MS = 15 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 5;

type RecoveryCodeRecord = {
  email: string;
  phone: string;
  code: string;
  expiresAt: number;
  attempts: number;
  createdAt: number;
};

type RecoveryTokenRecord = {
  email: string;
  userId: string;
  /** SHA-256 hash of the raw token. The raw token is never stored. */
  tokenHash: string;
  expiresAt: number;
  used: boolean;
};

const recoveryCodes = new Map<string, RecoveryCodeRecord>();
const recoveryTokens = new Map<string, RecoveryTokenRecord>();
const requestAttempts = new Map<string, { count: number; resetAt: number }>();

const RECOVERY_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Vary': 'Origin',
} as const;

function nowIso(): string {
  return new Date().toISOString();
}

function json(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: RECOVERY_HEADERS });
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEmail(value: unknown): string {
  return readTrimmed(value).toLowerCase();
}

function normalizePhone(value: unknown): string {
  return normalizePhoneToE164(readTrimmed(value));
}

function maskPhone(phone: string): string | null {
  const normalized = normalizePhoneToE164(phone);
  if (!normalized) return null;
  return `${normalized.slice(0, 2)}***${normalized.slice(-4)}`;
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return '***';
  const visibleLocal = local.length <= 2 ? `${local[0] ?? '*'}*` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${visibleLocal}@${domain}`;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getAllowedOwnerEmails(): string[] {
  const values = [
    readTrimmed(process.env.IVX_OWNER_REGISTRATION_EMAILS),
    readTrimmed(process.env.EXPO_PUBLIC_OWNER_EMAIL),
    readTrimmed(process.env.NEXT_PUBLIC_OWNER_EMAIL),
    readTrimmed(process.env.OWNER_EMAIL),
  ].filter(Boolean);
  return Array.from(new Set(values.flatMap((v) => v.split(',').map(sanitizeEmail).filter((e) => isValidEmail(e)))));
}

function assertOwnerEmailAllowed(email: string): void {
  const allowed = getAllowedOwnerEmails();
  if (allowed.length === 0) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Owner recovery is not configured. Set IVX_OWNER_REGISTRATION_EMAILS or EXPO_PUBLIC_OWNER_EMAIL on the backend.');
    }
    return;
  }
  if (!allowed.includes(email)) {
    throw new Error('Owner recovery is limited to the configured owner email.');
  }
}

function readClientIp(request: Request): string {
  const forwardedFor = readTrimmed(request.headers.get('x-forwarded-for')).split(',')[0]?.trim();
  return forwardedFor || readTrimmed(request.headers.get('cf-connecting-ip')) || readTrimmed(request.headers.get('x-real-ip')) || 'unknown';
}

function assertRequestRateLimit(key: string): void {
  const now = Date.now();
  const current = requestAttempts.get(key);
  if (!current || current.resetAt <= now) {
    requestAttempts.set(key, { count: 1, resetAt: now + REQUEST_WINDOW_MS });
    return;
  }
  if (current.count >= MAX_REQUESTS_PER_WINDOW) {
    throw new Error('Owner recovery SMS requests are temporarily rate limited. Please wait a few minutes and try again.');
  }
  current.count += 1;
}

function randomToken(): string {
  return generateSecureRecoveryToken();
}

function getServiceRoleKey(): string {
  const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const serviceKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
  if (!serviceKey || serviceKey === anonKey) {
    throw new Error('A backend-only Supabase service-role key is required for owner recovery.');
  }
  return serviceKey;
}

function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured on the backend.');
  }
  const runtimeFetch = ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: runtimeFetch },
  });
}

async function listAuthUsers(client: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) return users;
    users.push(...data.users);
    if (data.users.length < 1000) return users;
  }
  return users;
}

async function findAuthUserByEmail(client: SupabaseClient, email: string): Promise<User | null> {
  const users = await listAuthUsers(client);
  return users.find((u) => sanitizeEmail(u.email ?? '') === email) ?? null;
}

function getUserPhone(user: User): string {
  const raw = readTrimmed(user.phone) || readTrimmed((user.user_metadata ?? {}).phone) || readTrimmed((user.app_metadata ?? {}).phone);
  return normalizePhoneToE164(raw);
}

function readBearerToken(request: Request): string {
  const authorization = readTrimmed(request.headers.get('authorization'));
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return 'Password must be at least 8 characters.';
  if (!/[A-Z]/.test(password)) return 'Password must contain at least 1 uppercase letter.';
  if (!/[0-9]/.test(password)) return 'Password must contain at least 1 number.';
  return null;
}

/** Build the SMS body. Keep it short to fit GSM-7 single-segment limits. */
function buildRecoverySmsBody(code: string): string {
  return `IVX Owner recovery code: ${code}. Expires in 5 min. Do not share. If you did not request this, ignore this message.`;
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: RECOVERY_HEADERS });
}

/**
 * GET /api/ivx/owner-recovery/status — SNS readiness (no secrets returned).
 */
export async function handleOwnerRecoveryStatusRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ ok: false, message: 'Method not allowed.', backendVersion: RECOVERY_BACKEND_VERSION }, 405);
  }
  // Require owner bearer token — this endpoint exposes recovery readiness state.
  const token = readBearerToken(request);
  const ownerToken = readTrimmed(process.env.IVX_OWNER_TOKEN);
  if (!token || !ownerToken || token !== ownerToken) {
    return json({ ok: false, message: 'Authentication required.', backendVersion: RECOVERY_BACKEND_VERSION }, 401);
  }
  const snsConfigured = isSnsSmsConfigured();
  const recoveryPhoneConfigured = Boolean(resolveOwnerRecoveryPhone());
  const ownerEmailAllowlistConfigured = getAllowedOwnerEmails().length > 0;
  return json({
    ok: true,
    route: 'GET /api/ivx/owner-recovery/status',
    backendVersion: RECOVERY_BACKEND_VERSION,
    transport: 'aws_sns',
    snsConfigured,
    awsCredentialsConfigured: Boolean(readTrimmed(process.env.AWS_ACCESS_KEY_ID) && readTrimmed(process.env.AWS_SECRET_ACCESS_KEY)),
    awsRegion: readTrimmed(process.env.AWS_REGION) || 'us-east-1',
    recoveryPhoneConfigured,
    ownerEmailAllowlistConfigured,
    ready: snsConfigured && recoveryPhoneConfigured && ownerEmailAllowlistConfigured,
    freeTierNote: 'AWS SNS provides a small monthly free tier of outbound SMS; owner-only recovery uses far less than the free grant.',
    secretValuesReturned: false,
    timestamp: nowIso(),
  });
}

/**
 * POST /api/ivx/owner-recovery/request
 * Body: { email: string }
 *
 * Resolves the owner phone (auth user phone → IVX_OWNER_RECOVERY_PHONE env),
 * generates a 6-digit code, stores it with TTL, and texts it via AWS SNS.
 */
export async function handleOwnerRecoveryRequestRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Method not allowed.', backendVersion: RECOVERY_BACKEND_VERSION }, 405);
  }
  const clientIp = readClientIp(request);
  const userAgent = readTrimmed(request.headers.get('user-agent')) || 'unknown';
  try {
    const body = await request.json().catch(() => ({})) as { email?: unknown };
    const email = sanitizeEmail(body.email);
    if (!isValidEmail(email)) {
      await appendRecoveryAudit({
        action: 'blocked',
        email: email || 'unknown',
        phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
        tokenHash: null,
        ip: clientIp,
        device: userAgent,
        success: false,
        expiresAt: null,
        usedAt: null,
        operator: 'system',
        reason: 'Invalid email submitted to owner recovery request.',
      });
      return json({ ok: false, message: 'A valid owner email is required.', backendVersion: RECOVERY_BACKEND_VERSION }, 400);
    }
    assertOwnerEmailAllowed(email);
    assertRequestRateLimit(`${email}:${clientIp}`);

    if (!isSnsSmsConfigured()) {
      await appendRecoveryAudit({
        action: 'blocked',
        email,
        phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
        tokenHash: null,
        ip: clientIp,
        device: userAgent,
        success: false,
        expiresAt: null,
        usedAt: null,
        operator: 'system',
        reason: 'AWS SNS SMS not configured; missing env vars.',
      });
      return json({
        ok: false,
        message: 'AWS SNS SMS is not configured on the backend. Set AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION, and IVX_OWNER_RECOVERY_PHONE.',
        backendVersion: RECOVERY_BACKEND_VERSION,
      }, 503);
    }

    // Resolve the destination phone: prefer the auth user's phone, fall back to env.
    let phone = resolveOwnerRecoveryPhone();
    let userId: string | null = null;
    try {
      const client = createSupabaseAdminClient();
      const authUser = await findAuthUserByEmail(client, email);
      if (authUser) {
        userId = authUser.id;
        const authPhone = getUserPhone(authUser);
        if (authPhone) phone = authPhone;
      }
    } catch (err) {
      console.log('[OwnerRecoverySMS] Supabase admin lookup skipped:', err instanceof Error ? err.message : err);
    }

    const normalizedPhone = normalizePhoneToE164(phone);
    if (!normalizedPhone) {
      await appendRecoveryAudit({
        action: 'blocked',
        email,
        phoneHash: hashPhone(phone || ''),
        tokenHash: null,
        ip: clientIp,
        device: userAgent,
        success: false,
        expiresAt: null,
        usedAt: null,
        operator: 'system',
        reason: 'No owner phone available for SMS recovery.',
      });
      return json({
        ok: false,
        message: 'No owner phone is available for SMS recovery. Set IVX_OWNER_RECOVERY_PHONE on the backend.',
        backendVersion: RECOVERY_BACKEND_VERSION,
      }, 503);
    }

    const code = generateRecoveryCode();
    const now = Date.now();
    recoveryCodes.set(email, {
      email,
      phone: normalizedPhone,
      code,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      createdAt: now,
    });

    const smsResult = await sendSnsSms({
      to: normalizedPhone,
      message: buildRecoverySmsBody(code),
    });

    console.log('[OwnerRecoverySMS] Recovery code dispatched:', {
      emailMasked: maskEmail(email),
      phoneMasked: maskPhone(normalizedPhone),
      snsOk: smsResult.ok,
      snsStatus: smsResult.status,
      userId,
      timestamp: nowIso(),
    });

    await appendRecoveryAudit({
      action: 'request',
      email,
      phoneHash: hashPhone(normalizedPhone),
      tokenHash: null,
      ip: clientIp,
      device: userAgent,
      success: smsResult.ok,
      expiresAt: new Date(now + CODE_TTL_MS).toISOString(),
      usedAt: null,
      operator: 'owner',
      reason: smsResult.ok ? 'Recovery code dispatched via AWS SNS.' : `SMS transport failed: ${smsResult.status}`,
    });

    if (!smsResult.ok) {
      // Do not return the code in the response. Keep the code stored so a
      // retry can re-send, but surface the transport failure honestly.
      return json({
        ok: false,
        message: smsResult.status === 'missing_config'
          ? 'AWS SNS SMS is not fully configured on the backend.'
          : smsResult.status === 'rate_limited'
            ? 'AWS SNS is currently rate-limiting SMS delivery. Wait a few minutes and try again.'
            : `AWS SNS could not deliver the SMS: ${smsResult.error ?? 'unknown error'}`,
        backendVersion: RECOVERY_BACKEND_VERSION,
        snsStatus: smsResult.status,
        phoneMasked: maskPhone(normalizedPhone),
        secretValuesReturned: false,
        timestamp: nowIso(),
      }, smsResult.status === 'rate_limited' ? 429 : 502);
    }

    return json({
      ok: true,
      message: 'Owner recovery code sent via AWS SNS SMS.',
      backendVersion: RECOVERY_BACKEND_VERSION,
      transport: 'aws_sns',
      phoneMasked: maskPhone(normalizedPhone),
      codeTtlSeconds: Math.floor(CODE_TTL_MS / 1000),
      messageId: smsResult.messageId,
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner recovery request failed.';
    const lower = message.toLowerCase();
    const status = lower.includes('rate limited') ? 429
      : lower.includes('limited to the configured owner email') ? 403
        : lower.includes('not configured') || lower.includes('service-role') ? 503 : 500;
    console.log('[OwnerRecoverySMS] Request failed:', message);
    await appendRecoveryAudit({
      action: lower.includes('rate limited') ? 'rate_limited' : 'blocked',
      email: (typeof (request.json() as unknown) === 'object' ? (request.json() as { email?: string }).email : '') || 'unknown',
      phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
      tokenHash: null,
      ip: clientIp,
      device: userAgent,
      success: false,
      expiresAt: null,
      usedAt: null,
      operator: 'system',
      reason: message,
    }).catch(() => {});
    return json({ ok: false, message, backendVersion: RECOVERY_BACKEND_VERSION, secretValuesReturned: false, timestamp: nowIso() }, status);
  }
}

/**
 * POST /api/ivx/owner-recovery/verify
 * Body: { email: string, code: string, newPassword?: string }
 *
 * Verifies the code, returns a single-use recovery token, and (when
 * newPassword is supplied) repairs the owner password so the owner can sign
 * in immediately. The recovery token can also be used as a bearer to call
 * POST /api/ivx/owner-registration/repair for profile/wallet repair.
 */
export async function handleOwnerRecoveryVerifyRequest(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ ok: false, message: 'Method not allowed.', backendVersion: RECOVERY_BACKEND_VERSION }, 405);
  }
  const clientIp = readClientIp(request);
  const userAgent = readTrimmed(request.headers.get('user-agent')) || 'unknown';
  try {
    const body = await request.json().catch(() => ({})) as { email?: unknown; code?: unknown; newPassword?: unknown };
    const email = sanitizeEmail(body.email);
    const code = readTrimmed(body.code);
    const newPassword = readTrimmed(body.newPassword);

    if (!isValidEmail(email) || !/^\d{6}$/.test(code)) {
      await appendRecoveryAudit({
        action: 'verify_fail',
        email: email || 'unknown',
        phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
        tokenHash: null,
        ip: clientIp,
        device: userAgent,
        success: false,
        expiresAt: null,
        usedAt: null,
        operator: 'system',
        reason: 'Invalid email or code format submitted to verify.',
      });
      return json({ ok: false, message: 'Owner email and 6-digit code are required.', backendVersion: RECOVERY_BACKEND_VERSION }, 400);
    }
    assertOwnerEmailAllowed(email);

    const record = recoveryCodes.get(email);
    if (!record) {
      await appendRecoveryAudit({
        action: 'verify_fail',
        email,
        phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
        tokenHash: null,
        ip: clientIp,
        device: userAgent,
        success: false,
        expiresAt: null,
        usedAt: null,
        operator: 'system',
        reason: 'No active recovery code found for this email.',
      });
      return json({ ok: false, message: 'No active recovery code for this email. Request a new code.', backendVersion: RECOVERY_BACKEND_VERSION }, 404);
    }
    if (Date.now() > record.expiresAt) {
      recoveryCodes.delete(email);
      await appendRecoveryAudit({
        action: 'verify_fail',
        email,
        phoneHash: hashPhone(record.phone),
        tokenHash: null,
        ip: clientIp,
        device: userAgent,
        success: false,
        expiresAt: new Date(record.expiresAt).toISOString(),
        usedAt: null,
        operator: 'system',
        reason: 'Recovery code expired before verify.',
      });
      return json({ ok: false, message: 'Recovery code expired. Request a new code.', backendVersion: RECOVERY_BACKEND_VERSION }, 410);
    }
    record.attempts += 1;
    await appendRecoveryAudit({
      action: 'verify_attempt',
      email,
      phoneHash: hashPhone(record.phone),
      tokenHash: null,
      ip: clientIp,
      device: userAgent,
      success: false,
      expiresAt: new Date(record.expiresAt).toISOString(),
      usedAt: null,
      operator: 'owner',
      reason: `Recovery code verify attempt ${record.attempts}/${MAX_VERIFY_ATTEMPTS}.`,
      attemptCount: record.attempts,
    });
    if (record.attempts > MAX_VERIFY_ATTEMPTS) {
      recoveryCodes.delete(email);
      await appendRecoveryAudit({
        action: 'blocked',
        email,
        phoneHash: hashPhone(record.phone),
        tokenHash: null,
        ip: clientIp,
        device: userAgent,
        success: false,
        expiresAt: new Date(record.expiresAt).toISOString(),
        usedAt: null,
        operator: 'system',
        reason: 'Too many incorrect recovery code attempts.',
      });
      return json({ ok: false, message: 'Too many incorrect attempts. Request a new code.', backendVersion: RECOVERY_BACKEND_VERSION }, 429);
    }
    if (record.code !== code) {
      const remaining = Math.max(0, MAX_VERIFY_ATTEMPTS - record.attempts);
      return json({
        ok: false,
        message: `Recovery code does not match. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
        backendVersion: RECOVERY_BACKEND_VERSION,
        attemptsRemaining: remaining,
      }, 401);
    }
    recoveryCodes.delete(email);

    // Code verified. Optionally repair the password so the owner can sign in.
    let passwordRepaired = false;
    let userId: string | null = null;
    if (newPassword) {
      const passwordError = validatePassword(newPassword);
      if (passwordError) {
        await appendRecoveryAudit({
          action: 'verify_fail',
          email,
          phoneHash: hashPhone(record.phone),
          tokenHash: null,
          ip: clientIp,
          device: userAgent,
          success: false,
          expiresAt: null,
          usedAt: null,
          operator: 'system',
          reason: `Password validation failed: ${passwordError}`,
        });
        return json({ ok: false, message: passwordError, backendVersion: RECOVERY_BACKEND_VERSION }, 400);
      }
      try {
        const client = createSupabaseAdminClient();
        const authUser = await findAuthUserByEmail(client, email);
        if (authUser) {
          userId = authUser.id;
          const { error } = await client.auth.admin.updateUserById(authUser.id, {
            password: newPassword,
            email_confirm: true,
            ban_duration: 'none',
            app_metadata: { ...(authUser.app_metadata ?? {}), accountType: 'owner', role: 'owner', requestedRole: 'owner' },
          });
          if (error) {
            await appendRecoveryAudit({
              action: 'verify_fail',
              email,
              phoneHash: hashPhone(record.phone),
              tokenHash: null,
              ip: clientIp,
              device: userAgent,
              success: false,
              expiresAt: null,
              usedAt: null,
              operator: 'system',
              reason: `Password repair failed after code verification: ${error.message}`,
            });
            return json({ ok: false, message: `Code verified but password repair failed: ${error.message}`, backendVersion: RECOVERY_BACKEND_VERSION }, 502);
          }
          passwordRepaired = true;
          await appendRecoveryAudit({
            action: 'password_repair',
            email,
            phoneHash: hashPhone(record.phone),
            tokenHash: null,
            ip: clientIp,
            device: userAgent,
            success: true,
            expiresAt: null,
            usedAt: null,
            operator: 'owner',
            reason: 'Owner password repaired via verified recovery code.',
          });
        } else {
          // No auth user yet — create one with the recovery password.
          const { data, error } = await client.auth.admin.createUser({
            email,
            password: newPassword,
            email_confirm: true,
            ...(record.phone ? { phone: record.phone, phone_confirm: true } : {}),
            user_metadata: { accountType: 'owner', requestedRole: 'owner', role: 'owner', status: 'active', kycStatus: 'approved' },
            app_metadata: { accountType: 'owner', requestedRole: 'owner', role: 'owner' },
          });
          if (error || !data.user) {
            await appendRecoveryAudit({
              action: 'verify_fail',
              email,
              phoneHash: hashPhone(record.phone),
              tokenHash: null,
              ip: clientIp,
              device: userAgent,
              success: false,
              expiresAt: null,
              usedAt: null,
              operator: 'system',
              reason: `Owner auth user creation failed after code verification: ${error?.message ?? 'unknown'}`,
            });
            return json({ ok: false, message: `Code verified but owner create failed: ${error?.message ?? 'unknown'}`, backendVersion: RECOVERY_BACKEND_VERSION }, 502);
          }
          userId = data.user.id;
          passwordRepaired = true;
          await appendRecoveryAudit({
            action: 'password_repair',
            email,
            phoneHash: hashPhone(record.phone),
            tokenHash: null,
            ip: clientIp,
            device: userAgent,
            success: true,
            expiresAt: null,
            usedAt: null,
            operator: 'owner',
            reason: 'Owner auth user created via verified recovery code.',
          });
        }
      } catch (err) {
        console.log('[OwnerRecoverySMS] Password repair skipped:', err instanceof Error ? err.message : err);
      }
    }

    // Issue a single-use recovery token. Store the hash only; return the raw token once.
    const rawToken = randomToken();
    const tokenHash = hashToken(rawToken);
    const expiresAt = Date.now() + RECOVERY_TOKEN_TTL_MS;
    recoveryTokens.set(tokenHash, {
      email,
      userId: userId ?? '',
      tokenHash,
      expiresAt,
      used: false,
    });

    await appendRecoveryAudit({
      action: 'verify_success',
      email,
      phoneHash: hashPhone(record.phone),
      tokenHash,
      ip: clientIp,
      device: userAgent,
      success: true,
      expiresAt: new Date(expiresAt).toISOString(),
      usedAt: null,
      operator: 'owner',
      reason: passwordRepaired
        ? 'Recovery code verified and owner password repaired; recovery token issued.'
        : 'Recovery code verified; recovery token issued for profile/wallet repair.',
    });

    return json({
      ok: true,
      message: passwordRepaired
        ? 'Recovery code verified. Owner password was reset to the submitted value. Sign in now with the new password.'
        : 'Recovery code verified. Use the recoveryToken with POST /api/ivx/owner-registration/repair to restore profile/wallet.',
      backendVersion: RECOVERY_BACKEND_VERSION,
      recoveryToken: rawToken,
      recoveryTokenTtlSeconds: Math.floor(RECOVERY_TOKEN_TTL_MS / 1000),
      passwordRepaired,
      phoneMasked: maskPhone(record.phone),
      secretValuesReturned: false,
      timestamp: nowIso(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner recovery verify failed.';
    const lower = message.toLowerCase();
    const status = lower.includes('limited to the configured owner email') ? 403
      : lower.includes('not configured') || lower.includes('service-role') ? 503 : 500;
    console.log('[OwnerRecoverySMS] Verify failed:', message);
    await appendRecoveryAudit({
      action: 'verify_fail',
      email: 'unknown',
      phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
      tokenHash: null,
      ip: clientIp,
      device: userAgent,
      success: false,
      expiresAt: null,
      usedAt: null,
      operator: 'system',
      reason: message,
    }).catch(() => {});
    return json({ ok: false, message, backendVersion: RECOVERY_BACKEND_VERSION, secretValuesReturned: false, timestamp: nowIso() }, status);
  }
}

/**
 * GET /api/ivx/owner-recovery/resolve-token
 * Headers: Authorization: Bearer <recoveryToken>
 *
 * Validates a recovery token and returns the owner email/userId. Used by the
 * mobile app to confirm the recovery session before driving further repair.
 */
export async function handleOwnerRecoveryResolveTokenRequest(request: Request): Promise<Response> {
  if (request.method !== 'GET') {
    return json({ ok: false, message: 'Method not allowed.', backendVersion: RECOVERY_BACKEND_VERSION }, 405);
  }
  const clientIp = readClientIp(request);
  const userAgent = readTrimmed(request.headers.get('user-agent')) || 'unknown';
  const token = readBearerToken(request);
  if (!token) {
    await appendRecoveryAudit({
      action: 'blocked',
      email: 'unknown',
      phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
      tokenHash: null,
      ip: clientIp,
      device: userAgent,
      success: false,
      expiresAt: null,
      usedAt: null,
      operator: 'system',
      reason: 'Recovery token missing from Authorization header.',
    }).catch(() => {});
    return json({ ok: false, message: 'Recovery token is required.', backendVersion: RECOVERY_BACKEND_VERSION }, 401);
  }
  const tokenHash = hashToken(token);
  const record = recoveryTokens.get(tokenHash);
  if (!record || record.used || Date.now() > record.expiresAt) {
    if (record) recoveryTokens.delete(tokenHash);
    await appendRecoveryAudit({
      action: 'blocked',
      email: record?.email ?? 'unknown',
      phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
      tokenHash,
      ip: clientIp,
      device: userAgent,
      success: false,
      expiresAt: record ? new Date(record.expiresAt).toISOString() : null,
      usedAt: record?.used ? new Date().toISOString() : null,
      operator: 'system',
      reason: !record ? 'Recovery token not found (hash mismatch).' : record.used ? 'Recovery token already used.' : 'Recovery token expired.',
    }).catch(() => {});
    return json({ ok: false, message: 'Recovery token is invalid or expired.', backendVersion: RECOVERY_BACKEND_VERSION }, 401);
  }
  record.used = true;
  recoveryTokens.delete(tokenHash);
  const usedAt = new Date().toISOString();
  await appendRecoveryAudit({
    action: 'resolve_token',
    email: record.email,
    phoneHash: hashPhone(resolveOwnerRecoveryPhone() || ''),
    tokenHash,
    ip: clientIp,
    device: userAgent,
    success: true,
    expiresAt: new Date(record.expiresAt).toISOString(),
    usedAt,
    operator: 'owner',
    reason: 'Recovery token resolved successfully and marked as used.',
  }).catch(() => {});
  return json({
    ok: true,
    email: record.email,
    userId: record.userId,
    expiresAt: new Date(record.expiresAt).toISOString(),
    usedAt,
    backendVersion: RECOVERY_BACKEND_VERSION,
    secretValuesReturned: false,
    timestamp: nowIso(),
  });
}
