import { createClient } from '@supabase/supabase-js';
import { ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { getIVXOwnerEmailAllowlist } from '../../expo/shared/ivx/access-control';
import { resolveSupabaseAnonKey, resolveSupabaseUrl } from '../../expo/lib/supabase-env';

const DEPLOYMENT_MARKER = 'ivx-owner-passwordless-login-canonical-supabase-2026-08-14';
const AUTH_TIMEOUT_MS = 10_000;

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
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

  // Use the same project-aware sanitizer as the Expo auth path. This prevents
  // a stale/polluted SUPABASE_URL or EXPO_PUBLIC_* binding from sending owner
  // credentials to a different Supabase project. The resolver falls back to
  // the canonical production project and its public anon key when necessary.
  const supabaseUrl = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();
  const ownerEmail = (readEnv('IVX_OWNER_EMAIL') || allowlist[0] || email).toLowerCase();
  // Render's production blueprint already declares OWNER_NEW_PASSWORD. Keep
  // IVX_OWNER_PASSWORD as the preferred alias without requiring credential
  // recreation or a manual secret copy.
  const ownerPassword = readEnv('IVX_OWNER_PASSWORD') || readEnv('OWNER_NEW_PASSWORD');

  if (!ownerPassword) {
    return failure(
      'Owner emergency authentication password binding is unavailable on the backend runtime.',
      'owner_password_binding_unavailable',
      503,
    );
  }

  if (ownerEmail !== email) {
    return failure('Requested owner email does not match the configured owner.', 'owner_runtime_email_mismatch', 403);
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
      return failure(
        error?.message || 'Supabase did not return an owner session.',
        'owner_password_grant_failed',
        502,
      );
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
      authUserCreated: false,
      deploymentMarker: DEPLOYMENT_MARKER,
      timestamp: nowIso(),
    });
  } catch (error) {
    const timedOut = error instanceof Error && /timeout|abort/i.test(error.message);
    return failure(
      timedOut ? 'Owner authentication timed out.' : (error instanceof Error ? error.message : 'Owner authentication failed.'),
      timedOut ? 'owner_password_grant_timeout' : 'owner_password_grant_exception',
      timedOut ? 504 : 502,
    );
  }
}
