import type { AuthError, Session, SupabaseClient, User } from '@supabase/supabase-js';
import { sanitizeEmail, sanitizePasswordForSignIn } from '@/lib/auth-helpers';

export type EmailPasswordSignInCredentials = {
  email: string;
  passwordLength: number;
};

export type EmailPasswordSignInSuccess = {
  ok: true;
  session: Session;
  user: User;
  credentials: EmailPasswordSignInCredentials;
};

export type EmailPasswordSignInFailure = {
  ok: false;
  error: AuthError;
  credentials: EmailPasswordSignInCredentials;
};

export type EmailPasswordSignInResult = EmailPasswordSignInSuccess | EmailPasswordSignInFailure;

/**
 * Single path for email/password sign-in: normalize inputs → Supabase password grant only.
 * No owner/MFA/session side effects (handle those in AuthProvider after this returns).
 */
/**
 * Enterprise auth trace ID for diagnostics (Phase 6).
 * Format: auth-<timestamp>-<random6> — never contains password data.
 */
export function generateAuthTraceId(): string {
  return `auth-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function signInWithEmailPassword(
  client: SupabaseClient,
  rawEmail: string,
  rawPassword: string,
): Promise<EmailPasswordSignInResult> {
  const email = sanitizeEmail(rawEmail);
  const password = sanitizePasswordForSignIn(rawPassword);
  const credentials: EmailPasswordSignInCredentials = {
    email,
    passwordLength: password.length,
  };
  const traceId = generateAuthTraceId();

  // Increase timeout to 45s — the Supabase fetch layer (supabase.ts) already retries
  // 3× with backoff on 522/timeout, so the outer race needs to accommodate the full
  // retry window (15s + 1s + 20s + 2s + 25s ≈ 63s worst case, but 45s is enough for
  // at least 2 retries to complete).
  const SIGN_IN_TIMEOUT_MS = 45000;

  const signInPromise = client.auth.signInWithPassword({ email, password });
  const timeoutPromise = new Promise<never>((_, reject) => {
    const timeout = setTimeout(() => {
      const synthetic: AuthError = {
        name: 'AuthError',
        message: 'Sign-in timed out after multiple retries. The auth server (Supabase GoTrue) may be temporarily degraded. Please try again in a few minutes.',
        status: 408,
        code: 'sign_in_timeout',
      } as AuthError;
      reject(synthetic);
    }, SIGN_IN_TIMEOUT_MS);
    // Avoid keeping the timer alive if the promise settles.
    signInPromise.then(() => clearTimeout(timeout)).catch(() => clearTimeout(timeout));
  });

  let result: { data: { session: Session | null; user: User | null }; error: AuthError | null };
  try {
    result = await Promise.race([
      signInPromise as Promise<{ data: { session: Session | null; user: User | null }; error: AuthError | null }>,
      timeoutPromise,
    ]);
  } catch (timeoutError) {
    const synthetic = timeoutError as AuthError;
    console.log(`[Auth] Sign-in timed out traceId=${traceId} code=${synthetic.code ?? 'unknown'} email=${email}`);
    return { ok: false, error: synthetic, credentials };
  }

  const { data, error } = result;

  if (error) {
    // Log ONLY the error code + trace ID — never the password, email body, or raw error details.
    const authError = error as AuthError & { status?: number; code?: string };
    // Translate raw "Aborted" (from AbortController) into a user-friendly message.
    // This happens when the Supabase GoTrue service is degraded (522) and all retries exhaust.
    if (authError.message === 'Aborted' || authError.name === 'AbortError') {
      const friendly: AuthError = {
        name: 'AuthError',
        message: 'Unable to reach the authentication server. Supabase may be experiencing issues. Please try again in a few minutes.',
        status: 503,
        code: 'auth_server_unreachable',
      } as AuthError;
      console.log(`[Auth] Sign-in failed (aborted) traceId=${traceId} email=${email}`);
      return { ok: false, error: friendly, credentials };
    }
    console.log(`[Auth] Sign-in failed traceId=${traceId} code=${authError.code ?? 'unknown'} status=${authError.status ?? 'unknown'} email=${email}`);
    return { ok: false, error, credentials };
  }

  const session = data.session;
  const user = data.user;
  if (!session || !user) {
    const synthetic: AuthError = {
      name: 'AuthError',
      message: 'Sign-in succeeded but no session or user was returned.',
      status: 500,
      code: 'session_missing',
    } as AuthError;
    return { ok: false, error: synthetic, credentials };
  }

  console.log(`[Auth] Sign-in succeeded traceId=${traceId} email=${email}`);
  return { ok: true, session, user, credentials };
}
