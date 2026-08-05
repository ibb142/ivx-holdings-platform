/**
 * IVX Direct Auth — GoTrue Bypass Endpoint
 *
 * When Supabase GoTrue (auth/v1) is degraded or unreachable (522/timeout),
 * this endpoint authenticates the owner by connecting directly to the
 * Postgres auth.users table, verifying the bcrypt password hash, and
 * minting a Supabase-compatible JWT using JWT_SECRET.
 *
 * The returned session shape matches what supabase.auth.signInWithPassword()
 * returns, so the mobile app can call supabase.auth.setSession() with the
 * tokens and continue normally.
 *
 * Route: POST /api/ivx/auth/direct-sign-in
 * Body: { email, password }
 * Response: { access_token, refresh_token, expires_at, user: { id, email, ... } }
 */
import { ownerOnlyOptions } from './owner-only';

const DEPLOYMENT_MARKER = 'ivx-direct-auth-gotrue-bypass-2026-08-05';

// ── Types ───────────────────────────────────────────────────────────────────

type PgPoolLike = {
  connect: () => Promise<PgPoolClient>;
  end: () => Promise<void>;
};

type PgPoolClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;
  release: () => void;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeEmail(raw: string): string {
  return readTrimmed(raw).toLowerCase();
}

function getSupabaseDatabaseUrl(): string {
  const direct = readTrimmed(process.env.SUPABASE_DB_URL)
    || readTrimmed(process.env.DATABASE_URL)
    || readTrimmed(process.env.POSTGRES_URL);
  if (direct) return direct;

  const password = readTrimmed(process.env.SUPABASE_DB_PASSWORD);
  if (!password) {
    throw new Error('SUPABASE_DB_URL, DATABASE_URL, POSTGRES_URL, or SUPABASE_DB_PASSWORD is required for direct auth.');
  }
  const projectRef = (readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) || readTrimmed(process.env.SUPABASE_URL))
    .match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? '';
  if (!projectRef) {
    throw new Error('Could not determine Supabase project ref for direct DB connection.');
  }
  const dbHost = readTrimmed(process.env.SUPABASE_DB_HOST) || `db.${projectRef}.supabase.co`;
  const dbPort = readTrimmed(process.env.SUPABASE_DB_PORT) || '5432';
  return `postgres://${encodeURIComponent('postgres')}:${encodeURIComponent(password)}@${dbHost}:${dbPort}/postgres?sslmode=require`;
}

function maskEmail(email: string): string {
  if (!email || !email.includes('@')) return '(invalid)';
  const [local, domain] = email.split('@');
  if (!local || !domain) return '(invalid)';
  const maskedLocal = local.length <= 2 ? local[0] + '***' : local.slice(0, 2) + '***';
  return `${maskedLocal}@${domain}`;
}

// ── Lazy module loading (pg and bcryptjs are root-level deps) ───────────────

let _pgModule: typeof import('pg') | null = null;
async function getPgModule(): Promise<typeof import('pg')> {
  if (_pgModule) return _pgModule;
  _pgModule = await import('pg');
  return _pgModule;
}

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

interface SupabaseJwtPayload {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
  email: string;
  phone: string;
  app_metadata: Record<string, unknown>;
  user_metadata: Record<string, unknown>;
  role: string;
  aal: string;
  amr: { method: string; timestamp: number }[];
  session_id: string;
  is_anonymous: boolean;
}

function mintAccessToken(jwt: typeof import('jsonwebtoken'), user: AuthUserRow, jwtSecret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const expiresIn = 3600; // 1 hour — matches Supabase default
  const projectRef = (readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) || readTrimmed(process.env.SUPABASE_URL))
    .match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? 'kvclcdjmjghndxsngfzb';

  const payload: SupabaseJwtPayload = {
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
  const expiresIn = 86400 * 30; // 30 days — matches Supabase default
  const projectRef = (readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL) || readTrimmed(process.env.SUPABASE_URL))
    .match(/https:\/\/([a-z0-9]+)\.supabase\.co/i)?.[1] ?? 'kvclcdjmjghndxsngfzb';

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
      { ok: false, error: 'Server is not configured for direct authentication. Contact your administrator.', deploymentMarker: DEPLOYMENT_MARKER },
      { status: 500, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  let pool: PgPoolLike | null = null;
  let client: PgPoolClient | null = null;

  try {
    // 1. Connect to Postgres directly
    const pg = await getPgModule();
    const connectionString = getSupabaseDatabaseUrl();
    pool = new pg.Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      max: 1,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 8000,
    });
    client = await pool.connect();

    // 2. Query auth.users by email
    const result = await client.query(
      `SELECT id, email, encrypted_password, email_confirmed_at, raw_user_meta_data, raw_app_meta_data, aud, role, created_at, updated_at
       FROM auth.users
       WHERE email = $1
       LIMIT 1`,
      [email],
    );

    if (!result.rows || result.rows.length === 0) {
      console.log(`[IVX Direct Auth] No user found for email: ${maskEmail(email)}`);
      return Response.json(
        { ok: false, error: 'Invalid email or password.', deploymentMarker: DEPLOYMENT_MARKER },
        { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }

    const userRow = result.rows[0] as AuthUserRow;

    // 3. Check email confirmed
    if (!userRow.email_confirmed_at) {
      console.log(`[IVX Direct Auth] Email not confirmed for: ${maskEmail(email)}`);
      return Response.json(
        { ok: false, error: 'Your email is not confirmed yet. Check your inbox for the confirmation link.', deploymentMarker: DEPLOYMENT_MARKER },
        { status: 401, headers: { 'Access-Control-Allow-Origin': '*' } },
      );
    }

    // 4. Verify password with bcrypt
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

    // 5. Mint JWT tokens
    const jwt = await getJwtModule();
    const accessToken = mintAccessToken(jwt, userRow, jwtSecret);
    const refreshToken = mintRefreshToken(jwt, userRow, jwtSecret);
    const expiresAt = Math.floor(Date.now() / 1000) + 3600;

    // 6. Build user object matching Supabase shape
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
    // Don't expose internal errors to the client
    const safeMessage = message.includes('connect') || message.includes('timeout')
      ? 'Authentication service is temporarily unavailable. Please try again.'
      : 'Sign-in failed. Please try again or contact support.';
    return Response.json(
      { ok: false, error: safeMessage, deploymentMarker: DEPLOYMENT_MARKER },
      { status: 503, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  } finally {
    if (client) {
      try { client.release(); } catch {}
    }
    if (pool) {
      try { await pool.end(); } catch {}
    }
  }
}
