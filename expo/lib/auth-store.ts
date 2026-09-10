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

const KEYS = {
  USER_ID: 'ipx_user_id',
  USER_ROLE: 'ipx_user_role',
} as const;

export function setAuthCredentials(
  _token: string | null,
  userId: string | null,
  userRole: string | null,
  _refreshToken?: string | null,
) {
  _userId = userId;
  _userRole = userRole;
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
