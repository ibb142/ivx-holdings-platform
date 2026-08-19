import type { AuthError, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { sanitizeEmail, sanitizePasswordForSignIn } from '@/lib/auth-helpers';

/** Generate a unique auth trace ID without password data. */
export function generateAuthTraceId(): string {
  return `auth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export type EmailPasswordSignInCredentials = { email: string; passwordLength: number };
export type EmailPasswordSignInSuccess = { ok: true; session: Session; user: User; credentials: EmailPasswordSignInCredentials };
export type EmailPasswordSignInFailure = { ok: false; error: AuthError; credentials: EmailPasswordSignInCredentials };
export type EmailPasswordSignInResult = EmailPasswordSignInSuccess | EmailPasswordSignInFailure;

const TRANSIENT_RETRY_DELAY_MS = 700;

function syntheticAuthError(message: string, status: number, code: string): AuthError {
  return { name: 'AuthError', message, status, code } as AuthError;
}

function isTransientTransportFailure(error: unknown): boolean {
  const authError = error as (AuthError & { status?: number; code?: string }) | null | undefined;
  const message = (authError?.message ?? String(error ?? '')).toLowerCase();
  const code = (authError?.code ?? '').toLowerCase();
  const status = authError?.status ?? 0;

  return status === 0
    || status === 408
    || status === 429
    || status >= 500
    || code === 'auth_timeout'
    || code === 'auth_network_unavailable'
    || message.includes('failed to fetch')
    || message.includes('fetch failed')
    || message.includes('network request failed')
    || message.includes('networkerror')
    || message.includes('timeout')
    || message.includes('timed out')
    || message.includes('abort');
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Direct Supabase password grant.
 *
 * Mobile networks can briefly drop or stall immediately after app launch. A
 * single transient failure must not become a user-facing "service unavailable"
 * error when the exact same request can succeed a fraction of a second later.
 * We therefore retry transport/server failures once, but NEVER retry invalid
 * credentials, email confirmation failures, or other deterministic auth errors.
 */
export async function signInWithEmailPassword(
  client: SupabaseClient,
  rawEmail: string,
  rawPassword: string,
): Promise<EmailPasswordSignInResult> {
  const email = sanitizeEmail(rawEmail);
  const password = sanitizePasswordForSignIn(rawPassword);
  const credentials: EmailPasswordSignInCredentials = { email, passwordLength: password.length };

  const attempt = async (): Promise<EmailPasswordSignInResult> => {
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) {
        const authError = error as AuthError & { status?: number; code?: string };
        console.log(`[Auth] Sign-in failed email=${email} code=${authError.code ?? 'unknown'} status=${authError.status ?? 'unknown'}`);
        return { ok: false, error, credentials };
      }

      const session = data.session;
      const user = data.user;
      if (!session || !user) {
        return {
          ok: false,
          error: syntheticAuthError('Sign-in succeeded but no session or user was returned.', 500, 'session_missing'),
          credentials,
        };
      }
      return { ok: true, session, user, credentials };
    } catch (error) {
      const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'network failure');
      const lower = raw.toLowerCase();
      const isAbort = lower.includes('abort') || lower.includes('timeout');
      const message = isAbort
        ? 'Authentication service timed out. Please retry; trusted owner recovery remains available on a verified device.'
        : 'Authentication service is temporarily unavailable. Please retry.';
      console.log(`[Auth] Sign-in transport failure email=${email} kind=${isAbort ? 'timeout' : 'network'}`);
      return {
        ok: false,
        error: syntheticAuthError(message, 503, isAbort ? 'auth_timeout' : 'auth_network_unavailable'),
        credentials,
      };
    }
  };

  const first = await attempt();
  if (first.ok || !isTransientTransportFailure(first.error)) {
    return first;
  }

  console.log(`[Auth] Retrying transient password sign-in transport once email=${email}`);
  await wait(TRANSIENT_RETRY_DELAY_MS);
  return await attempt();
}
