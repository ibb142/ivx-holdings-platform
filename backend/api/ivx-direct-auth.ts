/**
 * IVX Direct Auth — GoTrue Bypass Endpoint
 *
 * When Supabase GoTrue (auth/v1) is degraded or unreachable (522/timeout),
 * this endpoint authenticates the owner by querying auth.users via a custom
 * RPC function, verifying the bcrypt password hash, and minting a
 * Supabase-compatible JWT using JWT_SECRET.
 *
 * Uses SUPABASE_SERVICE_ROLE_KEY + REST API — same pattern as durable store.
 * No SUPABASE_DB_URL or direct Postgres needed.
 *
 * Route: POST /api/ivx/auth/direct-sign-in
 * Body: { email, password }
 */
import { ownerOnlyOptions } from './owner-only';

const DEPLOYMENT_MARKER = 'ivx-direct-auth-gotrue-bypass-2026-08-05';

// ── Env resolution ──────────────────────────────────────────────────────────

const SERVICE_ROLE_NAMES = ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_KEY'] as const;
const SUPABASE_URL_NAMES = ['EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_URL'] as const;

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEmail(raw: string): string {
  return readTrimmed(raw).toLowerCase();
}

function getSupabaseUrl(): string {
  for (const name of SUPABASE_URL_NAMES) {
    const value = readTrimmed(process.env[name]).replace(/\/+$/, '');
    if (value) return value;
  }
  return '';
}

function getServiceRoleKey(): string {
  for (const name of SERVICE_ROLE_NAMES) {
    const value = readTrimmed(process.env[name]);
    if (value) return value;
  }
  return '';
}

function getSupabaseProjectRef(): string {
  return getSupabaseUrl().match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? 'kvclcdjmjghndxsngfzb';
}

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '(invalid)';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '(invalid)';
  const maskedLocal = local.length <= 2 ? local[0] + '***' : local.slice(0, 2) + '***';
  return `${maskedLocal}@${domain}`;
}

function buildHeaders(): Record<string, string> {
  const key = getServiceRoleKey();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}

// ── Lazy module loading ─────────────────────────────────────────────────────

let _bcryptModule: typeof import('bcryptjs') | null = null;
async function getBcryptModule(): Promise<typeof import('bcryptjs')> {
  if (_bcryptModule) return _bcryptModule;
  const mod = await import('bcryptjs') as any;
  _bcryptModule = (mod?.default ?? mod) as typeof import('bcryptjs');
  return _bcryptModule;
}

let _jwtModule: typeof import('jsonwebtoken') | null = null;
async function getJwtModule(): Promise<typeof import('jsonwebtoken')> {
  if (_jwtModule) return _jwtModule;
  _jwtModule = await import('jsonwebtoken');
  return _jwtModule;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface AuthUserRow {
  id: string;
  email: string;
  encrypted_password: string;
  email_confirmed_at: string | null;
  raw_user_meta_data: Record<string, unknown> | null;
  raw_app_meta_data: Record<string, unknown> | null;
  aud: string;
  role: string;
  created_at: string;
  updated_at: string;
}

// ── JWT minting ─────────────────────────────────────────────────────────────

function mintAccessToken(jwt: typeof import('jsonwebtoken'), user: AuthUserRow, jwtSecret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600;
  const projectRef = getSupabaseProjectRef();

  const payload = {
    iss: `https://${projectRef}.supabase.co/auth/v1/`,
    sub: user.id,
    aud: 'authenticated',
    exp: now + expiresIn,
    iat: now,
    email: user.email,
    phone: '',
    app_metadata: user.raw_app_meta_data ?? {},
    user_metadata: user.raw_user_meta_data ?? {},
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    session_id: crypto.randomUUID(),
    is_anonymous: false,
  };

  return jwt.sign(payload, jwtSecret, { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } });
}

function mintRefreshToken(jwt: typeof import('jsonwebtoken'), user: AuthUserRow, jwtSecret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 86400 * 30;
  const projectRef = getSupabaseProjectRef();

  const payload = {
    iss: `https://${projectRef}.supabase.co/auth/v1/`,
    sub: user.id,
    aud: 'authenticated',
    exp: now + expiresIn,
    iat: now,
    session_id: crypto.randomUUID(),
    refresh_token_aal: 'aal1',
  };

  return jwt.sign(payload, jwtSecret, { algorithm: 'HS256' });
}

// ── RPC function deployment + query ─────────────────────────────────────────

/**
 * Single-statement SQL to create a function that queries auth.users by email.
 * This is a SINGLE statement so ivx_exec_sql's EXECUTE can handle it.
 * SECURITY DEFINER allows it to access the auth schema.
 */
const CREATE_FUNCTION_SQL = `CREATE OR REPLACE FUNCTION public.ivx_query_auth_user_by_email(user_email TEXT) RETURNS JSON AS $fn$ BEGIN RETURN (SELECT json_build_object('id', u.id::text, 'email', u.email, 'encrypted_password', u.encrypted_password, 'email_confirmed_at', u.email_confirmed_at, 'raw_user_meta_data', u.raw_user_meta_data, 'raw_app_meta_data', u.raw_app_meta_data, 'aud', u.aud, 'role', u.role, 'created_at', u.created_at::text, 'updated_at', u.updated_at::text) FROM auth.users u WHERE u.email = user_email LIMIT 1); END; $fn$ LANGUAGE plpgsql SECURITY DEFINER`;

let _functionDeployed = false;

/** Deploy the query function via ivx_exec_sql (one-time, persists in DB). */
async function ensureQueryFunction(): Promise<void> {
  if (_functionDeployed) return;
  const supabaseUrl = getSupabaseUrl();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/ivx_exec_sql`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ sql_text: CREATE_FUNCTION_SQL }),
      signal: controller.signal,
    });
    if (response.ok) {
      _functionDeployed = true;
      console.log('[IVX Direct Auth] Query function deployed successfully');
    } else {
      const text = await response.text().catch(() => '');
      // If function already exists, that's fine
      if (text.includes('already exists') || response.status === 409 || response.ok) {
        _functionDeployed = true;
        console.log('[IVX Direct Auth] Query function already exists');
      } else {
        throw new Error(`Failed to deploy query function: HTTP ${response.status} ${text.slice(0, 300)}`);
      }
    }
  } finally {
    clearTimeout(timeout);
  }
}

/** Query auth.users by email via the custom RPC function. */
async function queryAuthUserByEmail(email: string): Promise<AuthUserRow | null> {
  const supabaseUrl = getSupabaseUrl();

  // Ensure the function exists (one-time, cached)
  await ensureQueryFunction();

  // Call the function via REST API
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/ivx_query_auth_user_by_email`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ user_email: email }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      console.error(`[IVX Direct Auth] Query RPC failed: HTTP ${response.status} ${text.slice(0, 300)}`);
      throw new Error(`Query RPC returned HTTP ${response.status}: ${text.slice(0, 200)}`);
    }

    const data = await response.json();
    if (!data || typeof data !== 'object') {
      return null;
    }

    const userRow = data as Record<string, unknown>;
    if (!userRow.id) {
      return null;
    }

    return {
      id: String(userRow.id),
      email: String(userRow.email ?? ''),
      encrypted_password: String(userRow.encrypted_password ?? ''),
      email_confirmed_at: userRow.email_confirmed_at ? String(userRow.email_confirmed_at) : null,
      raw_user_meta_data: (userRow.raw_user_meta_data as Record<string, unknown>) ?? null,
      raw_app_meta_data: (userRow.raw_app_meta_data as Record<string, unknown>) ?? null,
      aud: String(userRow.aud ?? 'authenticated'),
      role: String(userRow.role ?? 'authenticated'),
      created_at: String(userRow.created_at ?? ''),
      updated_at: String(userRow.updated_at ?? ''),
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ── Main handler ────────────────────────────────────────────────────────────

export function ivxDirectAuthOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleIVXDirectAuthSignIn(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json(
      { ok: false, error: 'Method not allowed.', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 405, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const email = sanitizeEmail(String(body.email ?? ''));
  const password = String(body.password ?? '');

  if (!email || !password) {
    return Response.json(
      { ok: false, error: 'Email and password are required.', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const jwtSecret = readTrimmed(process.env.JWT_SECRET);
  if (!jwtSecret) {
    console.error('[IVX Direct Auth] JWT_SECRET is not configured.');
    return Response.json(
      { ok: false, error: 'Server is not configured for direct authentication.', errorCode: 'jwt_secret_missing', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    console.error('[IVX Direct Auth] Supabase URL or service role key not configured.');
    return Response.json(
      { ok: false, error: 'Server is not configured for direct authentication.', errorCode: 'supabase_not_configured', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  try {
    // 1. Query auth.users via custom RPC function
    const userRow = await queryAuthUserByEmail(email);

    if (!userRow) {
      console.log(`[IVX Direct Auth] No user found for email: ${maskEmail(email)}`);
      return Response.json(
        { ok: false, error: 'Invalid email or password.', deploymentMarker: DEPLOYMENT_MARKER },
        { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }

    // 2. Check email confirmed
    if (!userRow.email_confirmed_at) {
      console.log(`[IVX Direct Auth] Email not confirmed for: ${maskEmail(email)}`);
      return Response.json(
        { ok: false, error: 'Your email is not confirmed yet. Check your inbox for the confirmation link.', deploymentMarker: DEPLOYMENT_MARKER },
        { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }

    // 3. Verify password with bcrypt
    const bcrypt = await getBcryptModule();
    const storedHash = userRow.encrypted_password;
    if (!storedHash) {
      console.log(`[IVX Direct Auth] No password hash for user: ${maskEmail(email)}`);
      return Response.json(
        { ok: false, error: 'Invalid email or password.', deploymentMarker: DEPLOYMENT_MARKER },
        { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }

    const passwordValid = await bcrypt.compare(password, storedHash);
    if (!passwordValid) {
      console.log(`[IVX Direct Auth] Password verification failed for: ${maskEmail(email)}`);
      return Response.json(
        { ok: false, error: 'Invalid email or password.', deploymentMarker: DEPLOYMENT_MARKER },
        { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }

    // 4. Mint JWT tokens
    const jwt = await getJwtModule();
    const accessToken = mintAccessToken(jwt, userRow, jwtSecret);
    const refreshToken = mintRefreshToken(jwt, userRow, jwtSecret);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    // 5. Build user object matching Supabase shape
    const user = {
      id: userRow.id,
      aud: userRow.aud || 'authenticated',
      role: userRow.role || 'authenticated',
      email: userRow.email,
      email_confirmed_at: userRow.email_confirmed_at,
      created_at: userRow.created_at,
      updated_at: userRow.updated_at,
      app_metadata: userRow.raw_app_meta_data ?? {},
      user_metadata: userRow.raw_user_meta_data ?? {},
      is_anonymous: false,
    };

    console.log(`[IVX Direct Auth] Sign-in succeeded for: ${maskEmail(email)}, user_id: ${userRow.id}`);

    return Response.json(
      {
        ok: true,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt,
        expires_in: 3600,
        token_type: 'bearer',
        user,
        deploymentMarker: DEPLOYMENT_MARKER,
        timestamp: new Date().toISOString(),
      },
      { status: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error during direct auth.';
    console.error('[IVX Direct Auth] Error:', message);
    let errorCode = 'unknown_error';
    let safeMessage = 'Sign-in failed. Please try again or contact support.';
    if (message.includes('timeout') || message.includes('aborted') || message.includes('AbortError')) {
      errorCode = 'rest_timeout';
      safeMessage = 'Authentication service is temporarily unavailable. Please try again.';
    } else if (message.includes('Query RPC')) {
      errorCode = 'query_rpc_failed';
      safeMessage = 'Server could not query the auth database. Please try again.';
    } else if (message.includes('query function') || message.includes('deploy')) {
      errorCode = 'function_deploy_failed';
      safeMessage = 'Server could not initialize the auth query. Please try again.';
    } else if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
      errorCode = 'module_not_found';
      safeMessage = 'Server module loading error. Contact your administrator.';
    } else if (message.includes('bcrypt')) {
      errorCode = 'bcrypt_error';
      safeMessage = 'Password verification error. Contact your administrator.';
    }
    return Response.json(
      { ok: false, error: safeMessage, errorCode, deploymentMarker: DEPLOYMENT_MARKER },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }
}
