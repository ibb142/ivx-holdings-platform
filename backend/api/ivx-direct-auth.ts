/**
 * IVX Direct Auth — GoTrue Bypass Endpoint
 *
 * When Supabase GoTrue (auth/v1) is degraded or unreachable (522/timeout),
 * this endpoint authenticates the owner by querying the auth.users table
 * via the Supabase REST API (using SUPABASE_SERVICE_ROLE_KEY), verifying
 * the bcrypt password hash, and minting a Supabase-compatible JWT using
 * JWT_SECRET.
 *
 * This uses the SAME REST API pattern as the IVX durable store — no direct
 * Postgres connection (SUPABASE_DB_URL) is needed. The REST API works even
 * when GoTrue is down.
 *
 * Route: POST /api/ivx/auth/direct-sign-in
 * Body: { email, password }
 * Response: { access_token, refresh_token, expires_at, user: { id, email, ... } }
 */
import { ownerOnlyOptions } from './owner-only';

const DEPLOYMENT_MARKER = 'ivx-direct-auth-gotrue-bypass-2026-08-05';

// ── Env resolution (same pattern as ivx-durable-store.ts) ───────────────────

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
  _bcryptModule = await import('bcryptjs');
  return _bcryptModule;
}

let _jwtModule: typeof import('jsonwebtoken') | null = null;
async function getJwtModule(): Promise<typeof import('jsonwebtoken')> {
  if (_jwtModule) return _jwtModule;
  _jwtModule = await import('jsonwebtoken');
  return _jwtModule;
}

// ── JWT minting ─────────────────────────────────────────────────────────────

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

// ── Query auth.users via REST API ───────────────────────────────────────────

/**
 * Query auth.users by email using the Supabase REST API + ivx_exec_sql RPC.
 * This is the same pattern the durable store uses — no direct Postgres needed.
 * Falls back to direct PostgREST query if ivx_exec_sql is not available.
 */
async function queryAuthUserByEmail(email: string): Promise<AuthUserRow | null> {
  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    throw new Error('Supabase URL or service role key is not configured.');
  }

  // Try ivx_exec_sql RPC first (same as durable store)
  const sql = `SELECT id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at FROM auth.users WHERE email = '${email.replace(/'/g, "''")}' LIMIT 1`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/rpc/ivx_exec_sql`, {
      method: 'POST',
      headers: buildHeaders(),
      body: JSON.stringify({ sql_text: sql }),
      signal: controller.signal,
    });

    if (response.ok) {
      const data = await response.json();
      // ivx_exec_sql returns the query result — parse it
      if (data && typeof data === 'object') {
        // The RPC may return the result in various formats
        // Check for common patterns
        const result = Array.isArray(data) ? data[0] : data;
        if (result && typeof result === 'object') {
          // If the RPC returns the raw row data
          const rows = (result as Record<string, unknown>).rows ?? (Array.isArray(data) ? data : [data]);
          if (Array.isArray(rows) && rows.length > 0) {
            return rows[0] as AuthUserRow;
          }
          // If data itself is the row (single object returned)
          if ((result as Record<string, unknown>).id) {
            return result as AuthUserRow;
          }
        }
      }
      // If ivx_exec_sql didn't return user data, try direct query
    }

    // Fallback: try querying auth.users directly via PostgREST
    // This works if the service role has access to the auth schema
    const directController = new AbortController();
    const directTimeout = setTimeout(() => directController.abort(), 10_000);
    try {
      const directResponse = await fetch(`${supabaseUrl}/rest/v1/users?email=eq.${encodeURIComponent(email)}&limit=1&select=id,email,encrypted_password,email_confirmed_at,raw_user_meta_data,raw_app_meta_data,aud,role,created_at,updated_at`, {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        signal: directController.signal,
      });
      if (directResponse.ok) {
        const directData = await directResponse.json();
        if (Array.isArray(directData) && directData.length > 0) {
          return directData[0] as AuthUserRow;
        }
      }
    } finally {
      clearTimeout(directTimeout);
    }

    return null;
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
    console.error('[IVX Direct Auth] JWT_SECRET is not configured on the backend.');
    return Response.json(
      { ok: false, error: 'Server is not configured for direct authentication. Contact your administrator.', errorCode: 'jwt_secret_missing', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const supabaseUrl = getSupabaseUrl();
  const serviceKey = getServiceRoleKey();
  if (!supabaseUrl || !serviceKey) {
    console.error('[IVX Direct Auth] Supabase URL or service role key is not configured.');
    return Response.json(
      { ok: false, error: 'Server is not configured for direct authentication. Contact your administrator.', errorCode: 'supabase_not_configured', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  try {
    // 1. Query auth.users via REST API
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
    if (message.includes('connect') || message.includes('timeout') || message.includes('ECONNREFUSED') || message.includes('ENOTFOUND') || message.includes('aborted')) {
      errorCode = 'rest_connection_failed';
      safeMessage = 'Authentication service is temporarily unavailable. Please try again.';
    } else if (message.includes('Supabase URL') || message.includes('service role')) {
      errorCode = 'supabase_not_configured';
      safeMessage = 'Server is not configured for direct authentication. Contact your administrator.';
    } else if (message.includes('Cannot find module') || message.includes('MODULE_NOT_FOUND')) {
      errorCode = 'module_not_found';
      safeMessage = 'Server module loading error. Contact your administrator.';
    } else if (message.includes('bcrypt')) {
      errorCode = 'bcrypt_error';
      safeMessage = 'Password verification error. Contact your administrator.';
    } else if (message.includes('jwt') || message.includes('JWT_SECRET')) {
      errorCode = 'jwt_error';
      safeMessage = 'Token generation error. Contact your administrator.';
    }
    return Response.json(
      { ok: false, error: safeMessage, errorCode, deploymentMarker: DEPLOYMENT_MARKER },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }
}
