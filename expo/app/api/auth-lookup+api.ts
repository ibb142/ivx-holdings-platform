import { createClient } from '@supabase/supabase-js';
import { sanitizeEmail, validateEmail } from '@/lib/auth-helpers';

type JsonRecord = Record<string, unknown>;

type AdminIdentity = {
  provider?: string | null;
  id?: string | null;
};

type AdminUserWithIdentities = {
  id?: string | null;
  email?: string | null;
  identities?: AdminIdentity[] | null;
  email_confirmed_at?: string | null;
};

const JSON_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store'} as const;

function jsonResponse(payload: JsonRecord, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: JSON_HEADERS});
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readLookupSecret(): string {
  return readTrimmed(process.env.AUTH_LOOKUP_SECRET);
}

function isAuthorizedLookup(request: Request): boolean {
  const configured = readLookupSecret();
  const provided = readTrimmed(request.headers.get('x-auth-lookup-secret'));
  return configured.length >= 24 && configured === provided;
}

function extractBearerToken(request: Request): string | null {
  const authorizationHeader = request.headers.get('authorization') ?? request.headers.get('Authorization');
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer') {
    return null;
  }

  const trimmedToken = readTrimmed(token);
  return trimmedToken.length > 0 ? trimmedToken : null;
}

function normalizeOwnerRole(value: string | null | undefined): 'owner' | 'investor' {
  const normalizedValue = readTrimmed(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
  return normalizedValue === 'owner' || normalizedValue === 'owneradmin' ? 'owner' : 'investor';
}

async function assertOwnerLookupAccess(request: Request, url: string, serviceRoleKey: string): Promise<void> {
  const accessToken = extractBearerToken(request);
  if (!accessToken) {
    throw new Error('Owner authorization is required.');
  }

  const client = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false}});
  const userResult = await client.auth.getUser(accessToken);

  if (userResult.error || !userResult.data.user) {
    throw new Error('Invalid owner session.');
  }

  const profileResult = await client.from('profiles').select('role').eq('id', userResult.data.user.id).maybeSingle();
  const profileRole = profileResult.data && typeof profileResult.data === 'object' && 'role' in profileResult.data
    ? readTrimmed((profileResult.data as { role?: unknown }).role)
    : '';

  if (normalizeOwnerRole(profileRole) !== 'owner') {
    throw new Error('Owner access is required.');
  }
}

async function fetchAdminUserByEmail(
  url: string,
  serviceRoleKey: string,
  normalizedEmail: string,
): Promise<AdminUserWithIdentities | null> {
  for (let page = 1; page <= 5; page += 1) {
    const response = await fetch(`${url}/auth/v1/admin/users?page=${page}&per_page=200`, {
      method: 'GET',
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        'Content-Type': 'application/json'}});

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase admin list users failed (${response.status}): ${text || 'Unknown error'}`);
    }

    const payload = await response.json() as { users?: AdminUserWithIdentities[] };
    const users = Array.isArray(payload.users) ? payload.users : [];
    const matched = users.find((u) => sanitizeEmail(u.email ?? '') === normalizedEmail);
    if (matched) {
      return matched;
    }
    if (users.length < 200) {
      break;
    }
  }
  return null;
}

function summarizeIdentities(user: AdminUserWithIdentities): {
  providers: string[];
  hasEmailPasswordIdentity: boolean;
  oauthOnlyHint: string | null;
} {
  const identities = Array.isArray(user.identities) ? user.identities : [];
  const providers = [...new Set(
    identities
      .map((i) => (typeof i.provider === 'string' ? i.provider.trim() : ''))
      .filter(Boolean),
  )];
  const hasEmailPasswordIdentity = providers.includes('email');
  let oauthOnlyHint: string | null = null;
  if (providers.length > 0 && !hasEmailPasswordIdentity) {
    oauthOnlyHint = `This account only has OAuth/provider identities (${providers.join(', ')}). Password sign-in will not work until you add an email/password identity (e.g. link password in dashboard or reset-password flow).`;
  }
  return { providers, hasEmailPasswordIdentity, oauthOnlyHint };
}

/**
 * Server-only diagnostic: checks whether an auth user exists and whether password login is plausible.
 * Requires AUTH_LOOKUP_SECRET (min 24 chars) and SUPABASE_SERVICE_ROLE_KEY on the server.
 *
 * Example:
 *   curl -sS -X POST "$ORIGIN/api/auth-lookup" \
 *     -H "Content-Type: application/json" \
 *     -H "x-auth-lookup-secret: $AUTH_LOOKUP_SECRET" \
 *     -d '{"email":"you@example.com"}'
 */
export async function POST(request: Request): Promise<Response> {
  try {
    if (!isAuthorizedLookup(request)) {
      return jsonResponse({ ok: false, message: 'Unauthorized.' }, 401);
    }

    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL);
    const serviceRoleKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY);
    const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);

    if (!url || !serviceRoleKey) {
      return jsonResponse({
        ok: false,
        message: 'EXPO_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for auth lookup.'}, 503);
    }

    if (serviceRoleKey === anonKey) {
      return jsonResponse({
        ok: false,
        message: 'SUPABASE_SERVICE_ROLE_KEY matches the anon key; admin user lookup is not available.'}, 503);
    }

    await assertOwnerLookupAccess(request, url, serviceRoleKey);

    const body = await request.json().catch(() => ({})) as { email?: unknown };
    const email = sanitizeEmail(readTrimmed(body.email));
    if (!email || !validateEmail(email)) {
      return jsonResponse({ ok: false, message: 'A valid email is required.' }, 400);
    }

    const user = await fetchAdminUserByEmail(url, serviceRoleKey, email);
    if (!user?.id) {
      return jsonResponse({
        ok: true,
        email,
        userFound: false,
        message: 'No auth user with this email exists in this Supabase project. Wrong EXPO_PUBLIC_SUPABASE_URL/ANON_KEY in dev/preview is a common cause of "invalid password" for accounts that exist elsewhere.'}, 200);
    }

    const { providers, hasEmailPasswordIdentity, oauthOnlyHint } = summarizeIdentities(user);

    return jsonResponse({
      ok: true,
      email,
      userFound: true,
      userId: user.id,
      emailConfirmed: !!user.email_confirmed_at,
      authProviders: providers,
      hasEmailPasswordIdentity,
      oauthOnlyHint,
      message: oauthOnlyHint
        ?? (hasEmailPasswordIdentity
          ? 'User exists with an email/password identity. If sign-in still fails, the password is wrong, email is unconfirmed, or the app is pointed at a different Supabase project.'
          : 'User exists but identity summary is ambiguous; check authProviders.')}, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Auth lookup failed.';
    const status = message === 'Owner authorization is required.' || message === 'Invalid owner session.' ? 401 : message === 'Owner access is required.' ? 403 : 500;
    return jsonResponse({ ok: false, message }, status);
  }
}

/** Intentionally no GET — avoid discovery. Use POST with secret. */
export async function GET(): Promise<Response> {
  return jsonResponse({ ok: false, message: 'Method not allowed.' }, 405);
}
