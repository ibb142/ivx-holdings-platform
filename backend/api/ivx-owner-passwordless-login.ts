import { createClient } from '@supabase/supabase-js';
import { ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getIVXOwnerVariableRuntimeValue } from './ivx-owner-variables';
import { getIVXOwnerEmailAllowlist } from '../../expo/shared/ivx/access-control';
import { mintIVXOutageOwnerSession } from '../services/ivx-outage-owner-session';

const DEPLOYMENT_MARKER = 'ivx-owner-passwordless-login-outage-session-2026-08-15';
const AUTH_TIMEOUT_MS = 10_000;
const PRODUCTION_SUPABASE_PROJECT_REF = 'kvclcdjmjghndxsngfzb';
const PRODUCTION_SUPABASE_URL = `https://${PRODUCTION_SUPABASE_PROJECT_REF}.supabase.co`;
const PRODUCTION_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.OLDwa21VHQNs151AD-8k--_HigQ2d-N7yJfFn5UeNPk';
const HOSTED_SUPABASE_URL_PATTERN = /https:\/\/([a-z0-9-]+)\.supabase\.co\b/i;
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadSegment = token.split('.')[1] ?? '';
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractSupabaseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const hosted = value.match(HOSTED_SUPABASE_URL_PATTERN);
  if (hosted?.[0]) {
    const projectRef = hosted[1]?.toLowerCase() ?? '';
    return projectRef === PRODUCTION_SUPABASE_PROJECT_REF ? hosted[0].replace(/\/$/, '') : null;
  }
  return null;
}

function extractSupabaseAnonKey(raw: string): string | null {
  const matches = raw.trim().match(JWT_PATTERN) ?? [];
  for (const candidate of matches) {
    const payload = decodeJwtPayload(candidate);
    if (payload?.role === 'anon' && payload?.ref === PRODUCTION_SUPABASE_PROJECT_REF) {
      return candidate;
    }
  }
  return null;
}

function resolveSupabaseUrl(): string {
  return extractSupabaseUrl(readEnv('EXPO_PUBLIC_SUPABASE_URL'))
    || extractSupabaseUrl(readEnv('SUPABASE_URL'))
    || PRODUCTION_SUPABASE_URL;
}

async function resolveSupabaseAnonKey(): Promise<string> {
  const direct = extractSupabaseAnonKey(readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY'))
    || extractSupabaseAnonKey(readEnv('SUPABASE_ANON_KEY'));
  if (direct) return direct;
  try {
    const durable = extractSupabaseAnonKey(
      readTrimmed(await getIVXOwnerVariableRuntimeValue('EXPO_PUBLIC_SUPABASE_ANON_KEY')),
    );
    if (durable) return durable;
  } catch (error) {
    console.warn(
      '[IVXOwnerPasswordlessLogin] durable EXPO_PUBLIC_SUPABASE_ANON_KEY lookup failed:',
      error instanceof Error ? error.message : 'unknown',
    );
  }
  return PRODUCTION_SUPABASE_ANON_KEY;
}

async function readOwnerPassword(): Promise<string> {
  const direct = readEnv('IVX_OWNER_PASSWORD') || readEnv('OWNER_NEW_PASSWORD');
  if (direct) return direct;
  try {
    return readTrimmed(await getIVXOwnerVariableRuntimeValue('OWNER_NEW_PASSWORD'));
  } catch (error) {
    console.warn('[IVXOwnerPasswordlessLogin] durable OWNER_NEW_PASSWORD lookup failed:', error instanceof Error ? error.message : 'unknown');
    return '';
  }
}

function sanitizeEmail(value: unknown): string {
  return readTrimmed(value).toLowerCase().slice(0, 254);
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function nowIso(): string {
  return new Date().toISOString();
}

function failure(message: string, rootCause: string, status: number): Response {
  return ownerOnlyJson({
    success: false,
    message,
    rootCause,
    deploymentMarker: DEPLOYMENT_MARKER,
    timestamp: nowIso(),
  }, status);
}

export function ivxOwnerPasswordlessLoginOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXOwnerPasswordlessLogin(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return failure('Method not allowed.', 'method_not_allowed', 405);
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const email = sanitizeEmail(body.email);
  const emergency = readTrimmed(body.emergency).toLowerCase();

  if (emergency !== 'true' && emergency !== 'ivx_emergency_recovery') {
    return failure(
      'Passwordless owner login is emergency-only. Please sign in with your email and password. If you are locked out, use emergency recovery.',
      'passwordless_not_emergency_mode',
      403,
    );
  }

  if (!isValidEmail(email)) {
    return failure('A valid owner email is required.', 'missing_or_invalid_email', 400);
  }

  const allowlist = getIVXOwnerEmailAllowlist();
  if (!allowlist.includes(email)) {
    return failure(
      'This email is not on the owner allowlist. Owner login is restricted to the configured owner.',
      'email_not_allowlisted',
      403,
    );
  }

  const supabaseUrl = resolveSupabaseUrl();
  const anonKey = await resolveSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    return failure('Supabase authentication binding is unavailable on the backend runtime.', 'supabase_auth_binding_unavailable', 503);
  }

  const ownerEmail = (readEnv('IVX_OWNER_EMAIL') || allowlist[0] || email).toLowerCase();
  const ownerPassword = await readOwnerPassword();

  if (ownerEmail !== email) {
    return failure('Requested owner email does not match the configured owner.', 'owner_runtime_email_mismatch', 403);
  }

  const buildOutageSessionResponse = (): Response | null => {
    const outageSession = mintIVXOutageOwnerSession(email);
    if (!outageSession) return null;
    return ownerOnlyJson({
      success: true,
      accessToken: outageSession.token,
      refreshToken: '',
      expiresAt: outageSession.expiresAt,
      expiresAtIso: new Date(outageSession.expiresAt * 1000).toISOString(),
      userId: outageSession.userId,
      email: outageSession.email,
      role: outageSession.role,
      passwordSelfHealed: false,
      passwordPreserved: true,
      sessionMethod: 'ivx_owner_outage_session',
      credentialBinding: 'server_signed_owner_outage_session',
      outageMode: true,
      authUserCreated: false,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    });
  };

  if (!ownerPassword) {
    const outageResponse = buildOutageSessionResponse();
    if (outageResponse) return outageResponse;
    return failure(
      'Owner emergency authentication bindings are unavailable on the backend runtime.',
      'owner_emergency_binding_unavailable',
      503,
    );
  }

  try {
    const supabase = createClient(supabaseUrl, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: {
        fetch: ((input: RequestInfo | URL, init: RequestInit = {}) =>
          fetch(input, {
            ...init,
            signal: init.signal ?? AbortSignal.timeout(AUTH_TIMEOUT_MS),
          })) as typeof fetch,
      },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: ownerPassword,
    });

    const session = data.session;
    if (error || !session?.access_token || !session.refresh_token) {
      const errorStatus = typeof (error as { status?: unknown } | null)?.status === 'number'
        ? Number((error as { status?: number }).status)
        : 0;
      const errorMessage = error?.message || 'Supabase did not return an owner session.';
      const serviceUnavailable = errorStatus >= 500 || /timeout|abort|fetch|network|unavailable|522|503|504/i.test(errorMessage);
      if (serviceUnavailable) {
        const outageResponse = buildOutageSessionResponse();
        if (outageResponse) return outageResponse;
      }
      return failure(errorMessage, 'owner_password_grant_failed', 502);
    }

    const expiresAt = session.expires_at ?? 0;
    return ownerOnlyJson({
      success: true,
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt,
      expiresAtIso: expiresAt ? new Date(expiresAt * 1000).toISOString() : nowIso(),
      userId: session.user?.id ?? '',
      email,
      passwordSelfHealed: false,
      passwordPreserved: true,
      sessionMethod: 'bounded_password_grant',
      credentialBinding: 'runtime_or_durable_owner_variable',
      authUserCreated: false,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    });
  } catch (error) {
    const outageResponse = buildOutageSessionResponse();
    if (outageResponse) return outageResponse;
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.message);
    return failure(
      timedOut ? 'Owner authentication timed out.' : (error instanceof Error ? error.message : 'Owner authentication failed.'),
      timedOut ? 'owner_password_grant_timeout' : 'owner_password_grant_exception',
      timedOut ? 504 : 502,
    );
  }
}
