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
 * Direct Supabase password grant with no global timeout wrapper.
 * The client-side fetch layer applies a per-request auth timeout (8s).
 * Surrounding code must stage this call with its own deadline.
 */
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

  const { data, error } = await client.auth.signInWithPassword({ email, password });

  if (error) {
    const authError = error as AuthError & { status?: number; code?: string };
    console.log(`[Auth] Sign-in failed email=${email} code=${authError.code ?? 'unknown'} status=${authError.status ?? 'unknown'}`);
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

  return { ok: true, session, user, credentials };
}
