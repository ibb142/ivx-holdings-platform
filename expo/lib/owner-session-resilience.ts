import * as SecureStore from 'expo-secure-store';
import { supabase } from '@/lib/supabase';
import type { Session } from '@supabase/supabase-js';

const KEYS = {
  ACCESS_TOKEN: 'ivx_owner_resilient_access_token', // ivx-audit-ok: SecureStore key name, not a credential
  REFRESH_TOKEN: 'ivx_owner_resilient_refresh_token', // ivx-audit-ok: SecureStore key name, not a credential
  EMAIL: 'ivx_owner_resilient_email',
  USER_ID: 'ivx_owner_resilient_user_id',
  EXPIRES_AT: 'ivx_owner_resilient_expires_at',
} as const;

export type ResilientOwnerSession = {
  accessToken: string;
  refreshToken: string;
  email: string;
  userId: string;
  expiresAt: number;
};

/**
 * Persist a copy of the owner Supabase session in SecureStore. This is the
 * resilience fallback for the rare React Native / Expo Go path where
 * `supabase.auth.setSession()` stores the session in AsyncStorage but a
 * subsequent `supabase.auth.getSession()` returns null (AsyncStorage not
 * flushed, bundle reload, or storage key mismatch). The SecureStore copy is
 * small (< 2KB) and lets the senior-developer preflight restore the real
 * session without asking the owner to sign in again.
 *
 * Never stores the password or any server secrets.
 */
export async function storeOwnerResilientSession(session: Session): Promise<void> {
  try {
    await Promise.all([
      SecureStore.setItemAsync(KEYS.ACCESS_TOKEN, session.access_token),
      SecureStore.setItemAsync(KEYS.REFRESH_TOKEN, session.refresh_token || ''),
      SecureStore.setItemAsync(KEYS.USER_ID, session.user.id),
      SecureStore.setItemAsync(KEYS.EMAIL, session.user.email ?? ''),
      SecureStore.setItemAsync(KEYS.EXPIRES_AT, String(session.expires_at ?? 0)),
    ]);
  } catch (error) {
    console.log('[OwnerSessionResilience] store failed:', error instanceof Error ? error.message : 'unknown');
  }
}

/** Clear the resilient owner session copy. Called on sign-out and on stale-token restore failure. */
export async function clearOwnerResilientSession(): Promise<void> {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(KEYS.ACCESS_TOKEN),
      SecureStore.deleteItemAsync(KEYS.REFRESH_TOKEN),
      SecureStore.deleteItemAsync(KEYS.USER_ID),
      SecureStore.deleteItemAsync(KEYS.EMAIL),
      SecureStore.deleteItemAsync(KEYS.EXPIRES_AT),
    ]);
  } catch (error) {
    console.log('[OwnerSessionResilience] clear failed:', error instanceof Error ? error.message : 'unknown');
  }
}

/** Read the resilient owner session copy. Returns null when nothing is stored or read fails. */
export async function loadOwnerResilientSession(): Promise<ResilientOwnerSession | null> {
  try {
    const [accessToken, refreshToken, email, userId, expiresAt] = await Promise.all([
      SecureStore.getItemAsync(KEYS.ACCESS_TOKEN),
      SecureStore.getItemAsync(KEYS.REFRESH_TOKEN),
      SecureStore.getItemAsync(KEYS.EMAIL),
      SecureStore.getItemAsync(KEYS.USER_ID),
      SecureStore.getItemAsync(KEYS.EXPIRES_AT),
    ]);
    if (!accessToken || !refreshToken) return null;
    return {
      accessToken,
      refreshToken,
      email: email ?? '',
      userId: userId ?? '',
      expiresAt: Number(expiresAt ?? 0),
    };
  } catch (error) {
    console.log('[OwnerSessionResilience] load failed:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

/**
 * Restore the owner session into the live Supabase client from the resilient
 * SecureStore copy. If the stored tokens are rejected or stale, they are
 * cleared so the owner is prompted to sign in again.
 *
 * Returns whether a live session is present and the owner's email after the
 * restore attempt.
 */
export async function restoreOwnerResilientSession(): Promise<{ sessionPresent: boolean; userEmail: string | null }> {
  const resilient = await loadOwnerResilientSession();
  if (!resilient) return { sessionPresent: false, userEmail: null };
  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: resilient.accessToken,
      refresh_token: resilient.refreshToken,
    });
    if (error || !data.session) {
      console.log('[OwnerSessionResilience] stored tokens rejected; clearing:', error?.message ?? 'no session');
      await clearOwnerResilientSession();
      return { sessionPresent: false, userEmail: null };
    }
    return { sessionPresent: true, userEmail: data.session.user?.email ?? resilient.email ?? null };
  } catch (error) {
    console.log('[OwnerSessionResilience] restore threw:', error instanceof Error ? error.message : 'unknown');
    return { sessionPresent: false, userEmail: null };
  }
}
