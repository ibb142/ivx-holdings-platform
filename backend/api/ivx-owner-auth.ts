/**
 * IVX Owner Authorization Endpoint
 *
 * Architecture: Supabase answers WHO; IVX answers WHAT.
 * This endpoint receives a valid Supabase access token in the Authorization header,
 * validates it with Supabase Auth, and returns the IVX owner authorization result.
 * It never accepts passwords or creates sessions.
 */

import { createClient } from '@supabase/supabase-js';

const DEPLOYMENT_MARKER = 'ivx-owner-auth-v2-publishable-key-safe';
const PRODUCTION_SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
const PRODUCTION_SUPABASE_PUBLIC_KEY = 'sb_publishable_HD3Xvq5bCQNJLFk1ROH9mQ_Wdb9xdDZ';
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

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-ivx-trace-id',
    },
  });
}

function normalizeUrl(raw: string): string {
  const value = raw.trim().replace(/\/$/, '');
  try {
    const parsed = new URL(value);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return value;
  } catch {}
  return '';
}

function isUsablePublicKey(value: string): boolean {
  const key = value.trim();
  return key.startsWith('sb_publishable_') || key.startsWith('eyJ');
}

function getSupabaseConfig(): { url: string; publicKey: string; source: 'env' | 'production_fallback' } {
  const envUrl = normalizeUrl(process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '');
  const candidates = [
    process.env.SUPABASE_PUBLISHABLE_KEY,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    process.env.SUPABASE_ANON_KEY,
    process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  ].map((v) => (v || '').trim()).filter(Boolean);
  const envKey = candidates.find(isUsablePublicKey) || '';

  if (envUrl && envUrl.includes('kvclcdjmjghndxsngfzb.supabase.co') && envKey) {
    return { url: envUrl, publicKey: envKey, source: 'env' };
  }

  return {
    url: PRODUCTION_SUPABASE_URL,
    publicKey: PRODUCTION_SUPABASE_PUBLIC_KEY,
    source: 'production_fallback',
  };
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

  try {
    const client = createClient(config.url, config.publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await client.auth.getUser(token);
    if (userError || !userData.user) {
      const lower = (userError?.message || '').toLowerCase();
      const reason = lower.includes('expired') ? 'token_expired' : 'invalid_token';
      console.log(`[OwnerAuth] ${traceId} token rejected source=${config.source}: ${userError?.message ?? 'no user'} elapsed=${Date.now() - startedAt}ms`);
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
    let roleSource: 'profiles' | 'rpc_verify_admin_access' = 'profiles';

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
        const { data: rpcData, error: rpcError } = await client.rpc('verify_owner_access_fastpath');
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
      console.log(`[OwnerAuth] ${traceId} authenticated but unauthorized: userId=${userId} role=${normalizedRole} elapsed=${Date.now() - startedAt}ms`);
      return jsonResponse({
        success: false,
        authorized: false,
        reason: 'not_owner',
        message: 'Your account is authenticated but does not have owner access.',
        deploymentMarker: DEPLOYMENT_MARKER,
      }, 403);
    }

    console.log(`[OwnerAuth] ${traceId} authorized owner: userId=${userId} role=${normalizedRole} source=${roleSource} keySource=${config.source} elapsed=${Date.now() - startedAt}ms`);
    return jsonResponse({
      success: true,
      authorized: true,
      userId,
      email,
      role: normalizedRole,
      roleSource,
      keySource: config.source,
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
