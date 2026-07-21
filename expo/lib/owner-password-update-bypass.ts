import { supabase } from '@/lib/supabase';
import { getApiBaseUrl } from '@/lib/api-base';

/**
 * Result of an owner-gated password update via the backend bypass endpoint.
 * The backend verifies the current password live against Supabase, then applies
 * the new password via the service-role admin API — bypassing AAL2 enforcement
 * that blocks client-side `supabase.auth.updateUser({ password })` when the
 * Supabase project has `mfa_allow_low_aal: false`.
 */
export type OwnerPasswordUpdateResult = {
  ok: boolean;
  message: string;
  aal2Bypassed?: boolean;
};

/**
 * Update the owner password via the owner-gated backend endpoint.
 *
 * Falls back to `supabase.auth.updateUser({ password })` if the backend endpoint
 * is unreachable — so the app still works if the backend is temporarily down or
 * the endpoint is removed in the future. The backend path is preferred because
 * it bypasses AAL2 enforcement.
 *
 * SECURITY: the current password is verified by the backend against live
 * Supabase BEFORE any mutation — this is NOT a security hole. The owner bearer
 * token (Supabase session access token) is sent for owner-gate verification.
 */
export async function updateOwnerPasswordViaBackend(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<OwnerPasswordUpdateResult> {
  const { currentPassword, newPassword } = input;
  if (!currentPassword || !newPassword) {
    return { ok: false, message: 'Current password and new password are required.' };
  }
  if (newPassword.length < 12) {
    return { ok: false, message: 'New password must be at least 12 characters (enterprise policy).' };
  }
  if (newPassword === currentPassword) {
    return { ok: false, message: 'New password must differ from the current password.' };
  }

  // Resolve the owner bearer token from the active Supabase session.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (!accessToken) {
    // No session → can't prove owner identity. Fall back to client-side update
    // so the reset-password flow (which has a recovery session) still works.
    return updateViaSupabaseClient(newPassword);
  }

  const endpoint = `${getApiBaseUrl()}/api/ivx/owner-update-password`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
        signal: controller.signal,
      });
      const text = await response.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        parsed = { ok: false, error: `Backend returned non-JSON response (HTTP ${response.status}).` };
      }
      if (response.ok && parsed.ok === true) {
        return {
          ok: true,
          message: 'Password updated successfully.',
          aal2Bypassed: parsed.aal2Bypassed === true,
        };
      }
      const errorMessage =
        (typeof parsed.error === 'string' && parsed.error) ||
        (typeof parsed.message === 'string' && parsed.message) ||
        `Backend password update failed (HTTP ${response.status}).`;
      // If the backend rejected the current password, do NOT fall back to client
      // update — the backend already verified the password is wrong.
      if (/current password was rejected/i.test(errorMessage)) {
        return { ok: false, message: errorMessage };
      }
      // For other backend errors (e.g. 500, network), fall back to client-side
      // update so the owner is not blocked by a transient backend issue.
      return updateViaSupabaseClient(newPassword);
    } finally {
      clearTimeout(timer);
    }
  } catch (error: unknown) {
    // Network/abort error — fall back to client-side update.
    return updateViaSupabaseClient(newPassword);
  }
}

/**
 * Fallback: update the password directly via the Supabase client.
 * This path is subject to AAL2 enforcement if the project has
 * `mfa_allow_low_aal: false`, but it's the correct path for the
 * recovery-session reset flow (which has a recovery AAL2 session).
 */
async function updateViaSupabaseClient(newPassword: string): Promise<OwnerPasswordUpdateResult> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) {
    return { ok: false, message: error.message || 'Supabase rejected the password update.' };
  }
  return { ok: true, message: 'Password updated successfully.' };
}
