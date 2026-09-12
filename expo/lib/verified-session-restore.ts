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
  return { ...session, user: verified.data.user };
}
