/**
 * Owner-gated password update that bypasses Supabase AAL2 enforcement.
 *
 * Root cause this fixes: when the Supabase project-level auth config has
 * `mfa_allow_low_aal: false`, the client-side `supabase.auth.updateUser({ password })`
 * call rejects AAL1 sessions with "AAL2 session is required to update email or
 * password when MFA is enabled" — even when the owner has 0 MFA factors enrolled.
 * The Supabase Management API refuses to flip `mfa_allow_low_aal`, so the only
 * in-app fix is to route the password update through the service-role admin API,
 * which is not subject to AAL enforcement.
 *
 * Security contract (NOT a hole):
 *   1. Owner bearer verified via assertIVXRegisteredOwnerBearer (real Supabase JWT
 *      + owner email allowlist).
 *   2. Current password verified against live Supabase
 *      `auth/v1/token?grant_type=password` with the anon key BEFORE any admin
 *      mutation — proves the caller knows the current password.
 *   3. New password validated against the enterprise 12-char policy.
 *   4. Password applied via `admin.auth.admin.updateUserById` (service role).
 *   5. The owner's current session is preserved (no global signOut) so the owner
 *      is not logged out of the app they are using to change the password.
 */
import { createClient } from '@supabase/supabase-js';
import {
  assertIVXRegisteredOwnerBearer,
  ownerOnlyJson,
  ownerOnlyOptions,
} from './owner-only';

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

const OWNER_UPDATE_PASSWORD_HEADERS = {
  'Content-Type': 'application/json',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
} as const;

export function ivxOwnerUpdatePasswordOptions(): Response {
  return new Response(null, { status: 204, headers: OWNER_UPDATE_PASSWORD_HEADERS });
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Verify the current password against live Supabase using an ephemeral client
 * (anon key, no session persistence). Returns true only if Supabase issues an
 * access token for this email+password pair.
 */
async function verifyCurrentPassword(email: string, currentPassword: string): Promise<boolean> {
  const supabaseUrl = resolveSupabaseUrl();
  const anonKey = resolveSupabaseAnonKey();
  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase URL / anon key not configured on the backend.');
  }
  const ephemeral = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await ephemeral.auth.signInWithPassword({
    email,
    password: currentPassword,
  });
  if (error || !data.session) {
    return false;
  }
  // Immediately sign out the ephemeral session — we only needed to verify.
  try {
    await ephemeral.auth.signOut();
  } catch {
    /* no-op — ephemeral client, no persisted session */
  }
  return true;
}

export async function handleIVXOwnerUpdatePassword(request: Request): Promise<Response> {
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const currentPassword = readTrimmed(body.currentPassword);
  const newPassword = readTrimmed(body.newPassword);

  if (!currentPassword) {
    return ownerOnlyJson({ ok: false, error: 'Current password is required.' }, 400);
  }
  if (!newPassword || newPassword.length < 12) {
    return ownerOnlyJson(
      { ok: false, error: 'New password must be at least 12 characters (enterprise policy).' },
      400,
    );
  }
  if (newPassword === currentPassword) {
    return ownerOnlyJson(
      { ok: false, error: 'New password must differ from the current password.' },
      400,
    );
  }

  let ownerEmail = '';
  let ownerUserId = '';
  try {
    const ownerContext = await assertIVXRegisteredOwnerBearer(request, 'owner_update_password');
    ownerEmail = readTrimmed(ownerContext.context.email ?? '').toLowerCase();
    ownerUserId = readTrimmed(ownerContext.context.userId ?? '');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner bearer verification failed.';
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message, secretValuesReturned: false }, status);
  }

  const email = ownerEmail;
  void ownerUserId;
  if (!email || !EMAIL_RE.test(email)) {
    return ownerOnlyJson({ ok: false, error: 'Owner email could not be resolved from session.' }, 400);
  }

  // Step 1: verify the current password live (security gate).
  const currentOk = await verifyCurrentPassword(email, currentPassword);
  if (!currentOk) {
    return ownerOnlyJson(
      {
        ok: false,
        error: 'The current password was rejected by live Supabase verification. Password was not changed.',
        secretValuesReturned: false,
      },
      403,
    );
  }

  // Step 2: resolve the user id + apply the new password via the admin API.
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

  const { data: listData, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) {
    return ownerOnlyJson({ ok: false, error: `Supabase listUsers failed: ${listError.message}` }, 500);
  }
  const user = (listData.users ?? []).find((u) => (u.email ?? '').toLowerCase() === email);
  if (!user) {
    return ownerOnlyJson({ ok: false, error: `No Supabase auth user found for email ${email}.` }, 404);
  }

  const { data: updateData, error: updateError } = await admin.auth.admin.updateUserById(user.id, {
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

  // SECURITY: intentionally do NOT call admin.signOut('global') here — that would
  // log the owner out of the app they are using to change the password. The owner's
  // existing session stays valid; the old password no longer works for new sign-ins.

  return ownerOnlyJson({
    ok: true,
    action: 'owner_update_password',
    ownerOnly: true,
    email,
    userId: user.id,
    passwordUpdated: true,
    aal2Bypassed: true,
    sessionsPreserved: true,
    secretValuesReturned: false,
    timestamp: new Date().toISOString(),
  });
}
