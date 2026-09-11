import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import logger from './logger';
import { isAdminRole as _isAdminRole } from './auth-helpers';
import type { AdminRole, UserRole } from './auth-helpers';

export type { AdminRole, UserRole };
export const isAdminRole = _isAdminRole;

// Identity metadata only; Supabase remains responsible for session tokens and
// the backend remains responsible for authorization. SecureStore is native-only.
const identityStorage = Platform.OS === 'web' ? {
  getItemAsync: (key: string) => AsyncStorage.getItem(key),
  setItemAsync: (key: string, value: string) => AsyncStorage.setItem(key, value),
  deleteItemAsync: (key: string) => AsyncStorage.removeItem(key),
} : SecureStore;

let _userId: string | null = null;
let _userRole: string | null = null;
// A backend-minted outage session is deliberately process-only. It lets an
// owner who has just passed the exact password/allowlist login continue to the
// owner API while Supabase Auth is unavailable, without restoring the former
// persisted-token behaviour. The backend still verifies the HMAC on every
// request.
let _ownerOutageToken: string | null = null;

function isUsableOwnerOutageToken(token: string | null): token is string {
  if (!token) return false;
  const parts = token.trim().split('.');
  if (parts.length !== 5 || parts[0] !== 'ivxos1') return false;
  const expiresAt = Number(parts[1]);
  return Number.isFinite(expiresAt)
    && expiresAt > Math.floor(Date.now() / 1000)
    && Boolean(parts[2] && parts[3] && parts[4]);
}

const KEYS = {
  USER_ID: 'ipx_user_id',
  USER_ROLE: 'ipx_user_role',
} as const;

export function setAuthCredentials(
  token: string | null,
  userId: string | null,
  userRole: string | null,
  _refreshToken?: string | null,
) {
  _userId = userId;
  _userRole = userRole;
  _ownerOutageToken = userId && userRole === 'owner' && isUsableOwnerOutageToken(token)
    ? token.trim()
    : null;
}

/**
 * Returns only the short-lived, backend-minted owner outage token held by this
 * process. Supabase JWTs and refresh tokens are never stored here.
 */
export function getInMemoryOwnerOutageToken(): string | null {
  if (!isUsableOwnerOutageToken(_ownerOutageToken)) {
    _ownerOutageToken = null;
    return null;
  }
  return _ownerOutageToken;
}

export function getAuthToken(): string | null {
  console.log('[AuthStore] getAuthToken() is deprecated — use supabase.auth.getSession() instead');
  return null;
}

export function getRefreshToken(): string | null {
  console.log('[AuthStore] getRefreshToken() is deprecated — use supabase.auth.getSession() instead');
  return null;
}

export function setAuthToken(_token: string) {
  console.log('[AuthStore] setAuthToken() is deprecated — Supabase manages tokens');
}

export function getAuthUserId(): string | null {
  if (!_userId) {
    logger.authStore.warn('No userId available — user may not be authenticated');
  }
  return _userId;
}

export function getAuthUserRole(): string {
  return _userRole || 'investor';
}

export async function persistAuth(data: {
  token: string;
  refreshToken: string;
  userId: string;
  userRole: string;
}): Promise<void> {
  _userId = data.userId;
  _userRole = data.userRole;
  try {
    await Promise.all([
      identityStorage.setItemAsync(KEYS.USER_ID, data.userId),
      identityStorage.setItemAsync(KEYS.USER_ROLE, data.userRole),
    ]);
    logger.authStore.log('Auth persisted for:', data.userId);
  } catch (error) {
    logger.authStore.error('Persist error:', error);
  }
}

export async function loadStoredAuth(): Promise<{
  token: string | null;
  refreshToken: string | null;
  userId: string | null;
  userRole: string | null;
}> {
  try {
    const [userId, userRole] = await Promise.all([
      identityStorage.getItemAsync(KEYS.USER_ID),
      identityStorage.getItemAsync(KEYS.USER_ROLE),
    ]);
    if (userId) {
      _userId = userId;
      _userRole = userRole;
      logger.authStore.log('Stored auth loaded for:', userId);
    }
    return { token: null, refreshToken: null, userId, userRole };
  } catch (error) {
    logger.authStore.error('Load error:', error);
    return { token: null, refreshToken: null, userId: null, userRole: null };
  }
}

export async function clearStoredAuth(): Promise<void> {
  _userId = null;
  _userRole = null;
  _ownerOutageToken = null;
  try {
    await Promise.all([
      identityStorage.deleteItemAsync(KEYS.USER_ID),
      identityStorage.deleteItemAsync(KEYS.USER_ROLE),
      identityStorage.deleteItemAsync('ipx_auth_token').catch(() => {}),
      identityStorage.deleteItemAsync('ipx_refresh_token').catch(() => {}),
    ]);
    logger.authStore.log('Auth cleared');
  } catch (error) {
    logger.authStore.error('Clear error:', error);
  }
}
