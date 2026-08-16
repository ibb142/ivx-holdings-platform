/**
 * IVX Owner Authorization Endpoint
 *
 * Architecture: Supabase answers WHO; IVX answers WHAT.
 * This endpoint receives a valid Supabase access token in the Authorization header,
 * validates it with Supabase Auth, and returns the IVX owner authorization result.
 * It never accepts passwords or creates sessions.
 */

import { createClient } from '@supabase/supabase-js';

const DEPLOYMENT_MARKER = 'ivx-owner-auth-v2';
const PRODUCTION_SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const PRODUCTION_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMxOTQwMjcsImV4cCI6MjA4ODc3MDAyN30.OLDwa21VHQNs151AD-8k--_HigQ2d-N7yJfFn5UeNPk';
const HOSTED_SUPABASE_URL_PATTERN = /https:\/\/([a-z0-9-]+)\.supabase\.co\b/i;
const PRODUCTION_PROJECT_REF = 'kvclcdjmjghndxsngfzb';
const JWT_PATTERN = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
const ADMIN_ROLES = ['owner', 'admin', 'ceo', 'staff', 'manager', 'analyst', 'support'] as const;
const ROLE_ALIASES: Record<string, string> = {
  super_admin: 'admin',
  superadmin: 'admin',
  administrator: 'admin',
  admin_user: 'admin',
  adminuser: 'admin',
  owner_admin: 'owner',
  owneradmin: 'owner',
  chief_executive_officer: 'ceo',
  chiefexecutiveofficer: 'ceo',
  staff_member: 'staff',
  staffmember: 'staff',
  team_manager: 'manager',
  teammanager: 'manager',
  support_staff: 'support',
  supportstaff: 'support',
  support_agent: 'support',
  supportagent: 'support',
  customer_support: 'support',
  customersupport: 'support',
};

function canonicalizeRole(role: string | null | undefined): string {
  return role?.trim().toLowerCase().replace(/[\s-]+/g, '_') ?? '';
}

function normalizeRole(role: string | null | undefined): string {
  const normalized = canonicalizeRole(role);
  if (!normalized) return 'investor';
  const aliased = ROLE_ALIASES[normalized] ?? normalized;
  if (ADMIN_ROLES.includes(aliased as typeof ADMIN_ROLES[number])) return aliased;
  return 'investor';
}

function isAdminRole(role: string | null | undefined): boolean {
  return normalizeRole(role) !== 'investor';
}

type OwnerAuthorizationResult = {
  success: true;
  authorized: true;
  userId: string;
  email: string;
  role: string;
  roleSource: 'profiles' | 'rpc_verify_admin_access' | 'email_not_owner';
  expiresAt: number;
  deploymentMarker: string;
} | {
  success: false;
  authorized: false;
  reason: 'missing_token' | 'invalid_token' | 'token_expired' | 'supabase_unavailable' | 'not_owner' | 'backend_error';
  message: string;
  deploymentMarker: string;
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadSegment = token.split('.')[1] ?? '';
    const normalized = payloadSegment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, 'base64').toString('utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractSupabaseUrl(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  const hosted = value.match(HOSTED_SUPABASE_URL_PATTERN);
  if (hosted?.[0]) {
    const projectRef = hosted[1]?.toLowerCase() ?? '';
    return projectRef === PRODUCTION_PROJECT_REF ? hosted[0].replace(/\/$/, '') : null;
  }
  return null;
}

function extractSupabaseAnonKey(raw: string): string | null {
  const matches = raw.trim().match(JWT_PATTERN) ?? [];
  for (const candidate of matches) {
    const payload = decodeJwtPayload(candidate);
    if (payload?.role === 'anon' && payload?.ref === PRODUCTION_PROJECT_REF) {
      return candidate;
    }
  }
  return null;
}

function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const rawUrl = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const rawKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  const url = extractSupabaseUrl(rawUrl) || extractSupabaseUrl(rawKey) || PRODUCTION_SUPABASE_URL;
  const anonKey = extractSupabaseAnonKey(rawKey) || PRODUCTION_SUPABASE_ANON_KEY;
  return { url, anonKey };
}

function getServiceRoleKey(): string {
  return process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
}

const OWNER_BASELINE_EMAILS = ['iperez4242@gmail.com'];

function getOwnerAllowlist(): string[] {
  const sources = [
    ...OWNER_BASELINE_EMAILS,
    process.env.IVX_OWNER_REGISTRATION_EMAILS,
    process.env.EXPO_PUBLIC_OWNER_EMAIL,
    process.env.OWNER_REPAIR_EMAIL,
    process.env.NEXT_PUBLIC_OWNER_EMAIL,
    process.env.OWNER_EMAIL,
    process.env.IVX_OWNER_EMAIL,
  ];
  return Array.from(new Set(
    sources
      .flatMap((v) => (typeof v === 'string' ? v.split(',') : []))
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
  ));
}

export async function handleOwnerAuthorize(request: Request): Promise<Response> {
  const traceId = request.headers.get('x-ivx-trace-id') || `owner-auth-${Date.now()}`;
  const startedAt = Date.now();
  const token = request.headers.get('Authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();

  if (!token) {
    return jsonResponse({
      success: false,
      authorized: false,
      reason: 'missing_token',
      message: 'Authorization token is required.',
      deploymentMarker: DEPLOYMENT_MARKER,
    }, 401);
  }

  const config = getSupabaseConfig();
  if (!config) {
    console.error(`[OwnerAuth] ${traceId} Supabase not configured`);
    return jsonResponse({
      success: false,
      authorized: false,
      reason: 'backend_error',
      message: 'IVX authorization service is not configured.',
      deploymentMarker: DEPLOYMENT_MARKER,
    }, 500);
  }

  try {
    const client = createClient(config.url, config.anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await client.auth.getUser(token);
    if (userError || !userData.user) {
      const reason = userError?.message?.toLowerCase().includes('expired')
        ? 'token_expired'
        : 'invalid_token';
      console.log(`[OwnerAuth] ${traceId} token rejected: ${userError?.message ?? 'no user'} elapsed=${Date.now() - startedAt}ms`);
      return jsonResponse({
        success: false,
        authorized: false,
        reason,
        message: 'Your session token is invalid or expired. Please sign in again.',
        deploymentMarker: DEPLOYMENT_MARKER,
      }, 401);
    }

    const user = userData.user;
    const userId = user.id;
    const email = user.email ?? '';

    let role: string | null = null;
    let roleSource: 'profiles' | 'rpc_verify_admin_access' | 'email_allowlist' = 'profiles';

    // Strategy 1: Use service role key to bypass RLS for profile lookup
    const serviceKey = getServiceRoleKey();
    if (serviceKey) {
      try {
        const adminClient = createClient(config.url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data: profile, error: profileError } = await adminClient
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .single();
        if (!profileError && profile?.role) {
          role = typeof profile.role === 'string' ? profile.role : null;
        }
      } catch (profileError) {
        console.log(`[OwnerAuth] ${traceId} service-role profile lookup note:`, (profileError as Error)?.message ?? 'unknown');
      }
    }

    // Strategy 2: Try with user's token (RLS may allow self-read)
    if (!role) {
      try {
        const { data: profile, error: profileError } = await client
          .from('profiles')
          .select('role')
          .eq('id', userId)
          .single();
        if (!profileError && profile?.role) {
          role = typeof profile.role === 'string' ? profile.role : null;
        }
      } catch (profileError) {
        console.log(`[OwnerAuth] ${traceId} profile lookup note:`, (profileError as Error)?.message ?? 'unknown');
      }
    }

    // Strategy 3: verify_admin_access RPC
    if (!role) {
      try {
        const { data: rpcData, error: rpcError } = await client.rpc('verify_admin_access');
        if (!rpcError && rpcData === true) {
          role = 'admin';
          roleSource = 'rpc_verify_admin_access';
        }
      } catch (rpcError) {
        console.log(`[OwnerAuth] ${traceId} verify_admin_access note:`, (rpcError as Error)?.message ?? 'unknown');
      }
    }

    // Strategy 4: Owner email allowlist fallback — if the authenticated user's
    // email is on the pinned owner allowlist, grant owner role. This is the
    // last-resort path that ensures the owner can always authorize even if
    // RLS blocks profile reads and the RPC is unavailable.
    if (!role) {
      const allowlist = getOwnerAllowlist();
      if (allowlist.includes(email.toLowerCase())) {
        role = 'owner';
        roleSource = 'email_allowlist';
      }
    }

    const normalizedRole = normalizeRole(role);
    if (!isAdminRole(normalizedRole)) {
      console.log(`[OwnerAuth] ${traceId} user authenticated but not owner: userId=${userId} role=${normalizedRole} elapsed=${Date.now() - startedAt}ms`);
      return jsonResponse({
        success: false,
        authorized: false,
        reason: 'not_owner',
        message: 'Your account is authenticated but does not have owner access.',
        deploymentMarker: DEPLOYMENT_MARKER,
      }, 403);
    }

    const userWithExpiry = user as { expires_at?: number };
    const expiresAt = typeof userWithExpiry.expires_at === 'number' ? userWithExpiry.expires_at : Math.floor(Date.now() / 1000) + 3600;
    console.log(`[OwnerAuth] ${traceId} authorized owner: userId=${userId} role=${normalizedRole} source=${roleSource} elapsed=${Date.now() - startedAt}ms`);
    return jsonResponse({
      success: true,
      authorized: true,
      userId,
      email,
      role: normalizedRole,
      roleSource,
      expiresAt,
      deploymentMarker: DEPLOYMENT_MARKER,
    }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner authorization failed.';
    console.error(`[OwnerAuth] ${traceId} exception: ${message} elapsed=${Date.now() - startedAt}ms`);
    return jsonResponse({
      success: false,
      authorized: false,
      reason: 'backend_error',
      message: 'IVX could not verify owner access right now. Please try again.',
      deploymentMarker: DEPLOYMENT_MARKER,
    }, 500);
  }
}
