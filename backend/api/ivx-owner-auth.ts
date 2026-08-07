/**
 * IVX Owner Authorization Endpoint
 *
 * Architecture: Supabase answers WHO; IVX answers WHAT.
 * This endpoint receives a valid Supabase access token in the Authorization header,
 * validates it with Supabase Auth, and returns the IVX owner authorization result.
 * It never accepts passwords or creates sessions.
 */

import { createClient } from '@supabase/supabase-js';

const DEPLOYMENT_MARKER = 'ivx-owner-auth-v1';
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

function getSupabaseConfig(): { url: string; anonKey: string } | null {
  const url = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '';
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !anonKey) return null;
  return { url, anonKey };
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
    let roleSource: 'profiles' | 'rpc_verify_admin_access' | 'email_not_owner' = 'profiles';

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
