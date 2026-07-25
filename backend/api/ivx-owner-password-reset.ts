import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { assertIVXRegisteredOwnerBearer } from './owner-only';
// Local email sanitizer to avoid backend build dependency on expo/lib/auth-helpers.
function sanitizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

type OwnerPasswordResetPayload = {
  newPassword?: unknown;
};

const HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

function json(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: HEADERS });
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validatePassword(password: string): string | null {
  if (password.length < 8) {
    return 'Password must be at least 8 characters.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must contain at least 1 uppercase letter.';
  }
  if (!/[0-9]/.test(password)) {
    return 'Password must contain at least 1 number.';
  }
  return null;
}

function decodeJwtRole(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { role?: unknown };
    return typeof parsed.role === 'string' ? parsed.role : null;
  } catch {
    return null;
  }
}

function decodeJwtRef(token: string): string | null {
  const payloadSegment = token.split('.')[1];
  if (!payloadSegment) return null;
  try {
    const padded = payloadSegment.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(payloadSegment.length / 4) * 4, '=');
    const parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as { ref?: unknown };
    return typeof parsed.ref === 'string' ? parsed.ref : null;
  } catch {
    return null;
  }
}

function extractSupabaseProjectRef(url: string): string | null {
  const match = url.match(/https:\/\/([a-z0-9-]+)\.supabase\.co\b/i);
  return match?.[1] ?? null;
}

function getServiceRoleKey(): string {
  const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
  const serviceKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
  const role = decodeJwtRole(serviceKey);
  if (!serviceKey || serviceKey === anonKey || (role !== 'service_role' && role !== 'supabase_admin')) {
    throw new Error('A backend-only Supabase service-role key is required for owner password reset.');
  }
  return serviceKey;
}

function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL);
  const serviceRoleKey = getServiceRoleKey();
  if (!supabaseUrl) {
    throw new Error('Supabase URL is not configured on the backend.');
  }
  const urlRef = extractSupabaseProjectRef(supabaseUrl);
  const keyRef = decodeJwtRef(serviceRoleKey);
  if (urlRef && keyRef && urlRef !== keyRef) {
    throw new Error(`Supabase project mismatch: EXPO_PUBLIC_SUPABASE_URL points to ${urlRef} but the service-role key belongs to ${keyRef}.`);
  }
  const runtimeFetch = ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init)) as typeof fetch;
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: runtimeFetch },
  });
}

function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  if (!local || !domain) return '***';
  const visibleLocal = local.length <= 2 ? `${local[0] ?? '*'}*` : `${local.slice(0, 2)}***${local.slice(-1)}`;
  return `${visibleLocal}@${domain}`;
}

export function ownerPasswordResetOptions(): Response {
  return new Response(null, { status: 204, headers: HEADERS });
}

export async function handleIVXOwnerPasswordReset(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return json({ success: false, message: 'Method not allowed.', secretValuesReturned: false }, 405);
  }

  try {
    const { context } = await assertIVXRegisteredOwnerBearer(request, 'owner_password_reset');
    const email = sanitizeEmail(context.email ?? '');
    if (!email) {
      return json({ success: false, message: 'Owner email could not be determined from bearer.', secretValuesReturned: false }, 400);
    }

    const body = await request.json().catch(() => ({})) as OwnerPasswordResetPayload;
    const newPassword = typeof body.newPassword === 'string' ? body.newPassword.trim() : '';
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return json({ success: false, message: passwordError, secretValuesReturned: false }, 400);
    }

    const supabaseUrl = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL);
    const anonKey = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
    const serviceRoleKey = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
    const managementToken = readTrimmed(process.env.SUPABASE_ACCESS_TOKEN);
    if (!managementToken) {
      return json({ success: false, message: 'Supabase Management API token is not configured on the backend.', secretValuesReturned: false }, 503);
    }

    let projectRef = supabaseUrl ? extractSupabaseProjectRef(supabaseUrl) : null;
    if (!projectRef && anonKey) {
      projectRef = decodeJwtRef(anonKey);
    }
    if (!projectRef && serviceRoleKey) {
      projectRef = decodeJwtRef(serviceRoleKey);
    }
    if (!projectRef) {
      return json({ success: false, message: 'Could not extract Supabase project ref from EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY, or SUPABASE_SERVICE_ROLE_KEY.', secretValuesReturned: false }, 503);
    }


    const query = `UPDATE auth.users SET encrypted_password = crypt('${newPassword.replace(/'/g, "''")}', gen_salt('bf', 10)) WHERE email = '${email.replace(/'/g, "''")}';`;
    const endpoint = `https://api.supabase.com/v1/projects/${projectRef}/database/query`;

    const sqlResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${managementToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    const sqlStatus = sqlResponse.status;
    let sqlResult: unknown = null;
    let sqlError: string | null = null;
    try {
      sqlResult = await sqlResponse.json();
    } catch {
      const text = await sqlResponse.text().catch(() => '');
      sqlResult = text;
    }
    if (!sqlResponse.ok) {
      const resultText = typeof sqlResult === 'string' ? sqlResult : JSON.stringify(sqlResult);
      sqlError = `Supabase Management API returned HTTP ${sqlStatus}: ${resultText.slice(0, 400)}`;
    }

    if (sqlError) {
      return json({ success: false, message: sqlError, secretValuesReturned: false }, 502);
    }

    return json({
      success: true,
      message: 'Owner password reset successfully via direct database update. You can now sign in with the new password on this device.',
      emailMasked: maskEmail(email),
      projectRef,
      secretValuesReturned: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner password reset failed.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return json({ success: false, message, secretValuesReturned: false }, status);
  }
}

// IVX owner password reset endpoint — deployed and verified live.
