import { expect, mock, test } from 'bun:test';

// Run in isolation: native SecureStore must never be touched by web sessions.
const values = new Map<string, string>();
const nativeCall = mock(() => { throw new Error('Native storage unavailable on web'); });
Object.defineProperty(globalThis, 'window', { configurable: true, value: {} });
mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('expo-secure-store', () => ({
  getItemAsync: nativeCall, setItemAsync: nativeCall, deleteItemAsync: nativeCall,
}));
mock.module('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async (key: string) => values.get(key) ?? null,
  setItem: async (key: string, value: string) => { values.set(key, value); },
  removeItem: async (key: string) => { values.delete(key); },
} }));
mock.module('../lib/logger', () => ({ default: { authStore: {
  log: () => {}, warn: () => {}, error: () => {},
} } }));
const auth = await import('../lib/auth-store');

test('web identity survives reload without persisting tokens; logout clears legacy data', async () => {
  await auth.persistAuth({ userId: 'test-user', userRole: 'owner', token: 'unused-access', refreshToken: 'unused-refresh' });
  auth.setAuthCredentials(null, null, null);
  expect(await auth.loadStoredAuth()).toEqual({ userId: 'test-user', userRole: 'owner', token: null, refreshToken: null });
  expect([...values.values()]).not.toContain('unused-access');
  expect([...values.values()]).not.toContain('unused-refresh');
  values.set('ipx_auth_token', 'legacy');
  values.set('ipx_refresh_token', 'legacy');
  await auth.clearStoredAuth();
  expect(values.size).toBe(0);
  expect(auth.getAuthUserId()).toBeNull();
  expect((await auth.loadStoredAuth()).userId).toBeNull();
  expect(nativeCall).not.toHaveBeenCalled();
});
