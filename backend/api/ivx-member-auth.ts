/**
 * Shared member authentication for IVX backend routes.
 *
 * Verifies a Supabase access token server-side and returns the caller's identity.
 * Routes must derive member identity from THIS function rather than from a
 * client-supplied request body: a body-supplied userId/email can be forged by anyone.
 */
import { createClient } from '@supabase/supabase-js';

export type AuthenticatedMember = {
  id: string;
  email: string;
};

function readTrimmedEnv(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve the authenticated member behind a request, or null when the caller is
 * anonymous, the token is invalid/expired, or Supabase is not configured.
 *
 * Fails closed: any error path returns null so callers deny the request.
 */
export async function resolveAuthenticatedMember(request: Request): Promise<AuthenticatedMember | null> {
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const url = readTrimmedEnv(process.env.SUPABASE_URL) || readTrimmedEnv(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const key = readTrimmedEnv(process.env.SUPABASE_ANON_KEY) || readTrimmedEnv(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  if (!url || !key) return null;

  try {
    const client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await client.auth.getUser(token);
    if (error || !data.user) return null;
    return { id: data.user.id, email: data.user.email ?? '' };
  } catch {
    return null;
  }
}
