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

function syntheticAuthError(message: string, status: number, code: string): AuthError {
  return { name: 'AuthError', message, status, code } as AuthError;
}

/**
 * Direct Supabase password grant. The Supabase fetch layer owns the network
 * deadline. Network AbortError must never leak to the owner UI as the opaque
 * word "Aborted"; convert it to a stable service-unavailable AuthError so the
 * login state machine can immediately offer trusted-device recovery/retry.
 */
export async function signInWithEmailPassword(
  client: SupabaseClient,
  rawEmail: string,
  rawPassword: string,
): Promise<EmailPasswordSignInResult> {
  const email = sanitizeEmail(rawEmail);
  const password = sanitizePasswordForSignIn(rawPassword);
  const credentials: EmailPasswordSignInCredentials = { email, passwordLength: password.length };

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
      return { ok: false, error: syntheticAuthError('Sign-in succeeded but no session or user was returned.', 500, 'session_missing'), credentials };
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
}
