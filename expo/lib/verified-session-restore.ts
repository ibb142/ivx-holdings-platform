import type { Session, User } from '@supabase/supabase-js';

/** Restore only a session whose token is accepted by the auth authority. */
export async function readVerifiedSession(auth: {
  getSession: () => Promise<{ data: { session: Session | null }; error: unknown }>;
  getUser: (token: string) => Promise<{ data: { user: User | null }; error: unknown }>;
}): Promise<Session | null> {
  const stored = await auth.getSession();
  if (stored.error || !stored.data.session?.access_token) return null;
  const session = stored.data.session;
  const verified = await auth.getUser(session.access_token);
  if (verified.error || !verified.data.user || verified.data.user.id !== session.user.id) return null;
  // Verification can finish after logout, account switch or token rotation in
  // another tab. Never reinstall a snapshot that is no longer the active session.
  const current = await auth.getSession();
  if (current.error || current.data.session?.access_token !== session.access_token
      || current.data.session.user.id !== verified.data.user.id) return null;
  return { ...current.data.session, user: verified.data.user };
}
