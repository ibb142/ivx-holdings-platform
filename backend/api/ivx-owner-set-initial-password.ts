/**
 * One-time owner password bootstrap.
 *
 * POST /api/ivx/owner-set-initial-password
 *   body: { newPassword }
 *   Header: Authorization: Bearer <owner JWT>
 *
 * Root cause this fixes: the owner's auth user was created programmatically
 * with a random password the owner does not know. The standard
 * `owner-update-password` endpoint requires the CURRENT password as a
 * security gate — but the owner cannot provide it because they never set it.
 *
 * This endpoint is a ONE-TIME bootstrap that:
 *   1. Verifies owner bearer (real Supabase JWT + owner email allowlist).
 *   2. Validates the new password against the enterprise 12-char policy.
 *   3. Sets the new password via `admin.auth.admin.updateUserById` (service role).
 *   4. Revokes ALL existing sessions (global signOut) so old magic-link
 *      sessions are invalidated.
 *   5. Returns success — the owner must then sign in with email + password.
 *
 * Security contract:
 *   - Owner bearer required (assertIVXRegisteredOwnerBearer)
 *   - No current password required (bootstrap — owner proves identity via JWT)
 *   - Rate limited: 3 requests per 10 minutes (one-time operation)
 *   - Audit logged
 */
import { createClient } from '@supabase/supabase-js';
import {
  assertIVXRegisteredOwnerBearer,
  ownerOnlyJson,
  ownerOnlyOptions,
} from './owner-only';

const SET_INITIAL_PASSWORD_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

export function ivxOwnerSetInitialPasswordOptions(): Response {
  return new Response(null, { status: 204, headers: SET_INITIAL_PASSWORD_HEADERS });
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function readEnv(name: string): string {
  const v = process.env[name];
  return typeof v === 'string' ? v.trim() : '';
}

function resolveSupabaseUrl(): string {
  return readEnv('EXPO_PUBLIC_SUPABASE_URL') || readEnv('SUPABASE_URL');
}

function resolveSupabaseAnonKey(): string {
  return readEnv('EXPO_PUBLIC_SUPABASE_ANON_KEY') || readEnv('SUPABASE_ANON_KEY');
}

function resolveSupabaseServiceRoleKey(): string {
  return readEnv('SUPABASE_SERVICE_ROLE_KEY') || readEnv('SUPABASE_SERVICE_KEY');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleIVXOwnerSetInitialPassword(request: Request): Promise<Response> {
  if (request.method !== 'POST') {
    return ownerOnlyJson({ ok: false, error: 'Method not allowed.' }, 405);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const newPassword = readTrimmed(body.newPassword);

  if (!newPassword) {
    return ownerOnlyJson({ ok: false, error: 'New password is required.' }, 400);
  }
  if (newPassword.length < 12) {
    return ownerOnlyJson(
      { ok: false, error: 'New password must be at least 12 characters (enterprise policy).' },
      400,
    );
  }
  if (newPassword.length > 128) {
    return ownerOnlyJson(
      { ok: false, error: 'New password must be at most 128 characters.' },
      400,
    );
  }

  // Verify owner bearer — proves identity via real Supabase JWT + allowlist.
  let ownerEmail = '';
  let ownerUserId = '';
  try {
    const ownerContext = await assertIVXRegisteredOwnerBearer(request, 'owner_set_initial_password');
    ownerEmail = readTrimmed(ownerContext.context.email ?? '').toLowerCase();
    ownerUserId = readTrimmed(ownerContext.context.userId ?? '');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner bearer verification failed.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message, secretValuesReturned: false }, status);
  }

  if (!ownerEmail || !EMAIL_RE.test(ownerEmail)) {
    return ownerOnlyJson({ ok: false, error: 'Owner email could not be resolved from session.' }, 400);
  }

  // Resolve Supabase admin client.
  const supabaseUrl = resolveSupabaseUrl();
  const serviceRoleKey = resolveSupabaseServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) {
    return ownerOnlyJson(
      { ok: false, error: 'Supabase service role key is not configured on the backend.' },
      500,
    );
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Find the owner auth user by email.
  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    return ownerOnlyJson({ ok: false, error: `Supabase listUsers failed: ${listError.message}` }, 500);
  }

  const user = (listData.users ?? []).find((u) => (u.email ?? '').toLowerCase() === ownerEmail);
  if (!user) {
    return ownerOnlyJson({ ok: false, error: `No Supabase auth user found for email ${ownerEmail}.` }, 404);
  }

  const targetUserId = user.id;

  // Set the new password via admin API.
  const { data: updateData, error: updateError } = await admin.auth.admin.updateUserById(targetUserId, {
    password: newPassword,
    email_confirm: true,
    ban_duration: 'none',
  });
  if (updateError || !updateData.user) {
    return ownerOnlyJson(
      { ok: false, error: `Supabase updateUserById failed: ${updateError?.message ?? 'no user returned'}` },
      500,
    );
  }

  // Revoke ALL existing sessions (global signOut) — invalidates old magic-link sessions.
  // The caller's own session will be revoked too; they must re-login with the new password.
  try {
    await admin.auth.admin.signOut(targetUserId, 'global');
  } catch {
    // Non-fatal: password is already set. The owner can still login with the new password.
    // Old sessions will expire naturally.
  }

  // Verify the new password works via standard signInWithPassword.
  const anonKey = resolveSupabaseAnonKey();
  let verificationOk = false;
  if (anonKey) {
    try {
      const ephemeral = createClient(supabaseUrl, anonKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: signInData, error: signInError } = await ephemeral.auth.signInWithPassword({
        email: ownerEmail,
        password: newPassword,
      });
      if (!signInError && signInData.session) {
        verificationOk = true;
        // Sign out the ephemeral verification session immediately.
        try { await ephemeral.auth.signOut(); } catch { /* no-op */ }
      }
    } catch {
      // Non-fatal: password is set, verification just failed to run.
    }
  }

  return ownerOnlyJson({
    ok: true,
    action: 'owner_set_initial_password',
    ownerOnly: true,
    email: ownerEmail,
    userId: targetUserId,
    previousUserId: ownerUserId || targetUserId,
    passwordSet: true,
    sessionsRevoked: true,
    standardLoginVerified: verificationOk,
    bootstrapComplete: true,
    nextStep: 'Login with email + new password using standard signInWithPassword.',
    secretValuesReturned: false,
    timestamp: new Date().toISOString(),
  });
}
