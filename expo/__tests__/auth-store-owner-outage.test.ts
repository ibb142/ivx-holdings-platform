import { beforeEach, expect, mock, test } from 'bun:test';

const values = new Map<string, string>();

mock.module('react-native', () => ({ Platform: { OS: 'web' } }));
mock.module('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
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

function outageToken(expiresAt: number): string {
  const encodedEmail = Buffer.from('iperez4242@gmail.com').toString('base64url');
  return `ivxos1.${expiresAt}.${encodedEmail}.nonce.signature`;
}

beforeEach(async () => {
  values.clear();
  await auth.clearStoredAuth();
});

test('keeps a bounded owner outage token in memory for the active owner only', () => {
  const token = outageToken(Math.floor(Date.now() / 1000) + 3600);
  auth.setAuthCredentials(token, 'ivx-owner-service', 'owner');
  expect(auth.getInMemoryOwnerOutageToken()).toBe(token);

  auth.setAuthCredentials(token, 'ivx-owner-service', 'admin');
  expect(auth.getInMemoryOwnerOutageToken()).toBeNull();

  auth.setAuthCredentials('ordinary.supabase.jwt', 'ivx-owner-service', 'owner');
  expect(auth.getInMemoryOwnerOutageToken()).toBeNull();
});

test('rejects expired or malformed outage tokens before an owner request', () => {
  auth.setAuthCredentials(outageToken(Math.floor(Date.now() / 1000) - 1), 'ivx-owner-service', 'owner');
  expect(auth.getInMemoryOwnerOutageToken()).toBeNull();

  auth.setAuthCredentials('ivxos1.not-a-time.email.nonce.signature', 'ivx-owner-service', 'owner');
  expect(auth.getInMemoryOwnerOutageToken()).toBeNull();
});

test('never persists or reloads the outage token', async () => {
  const token = outageToken(Math.floor(Date.now() / 1000) + 3600);
  auth.setAuthCredentials(token, 'ivx-owner-service', 'owner');
  await auth.persistAuth({ token, refreshToken: '', userId: 'ivx-owner-service', userRole: 'owner' });

  expect([...values.values()]).not.toContain(token);
  auth.setAuthCredentials(null, null, null);
  await auth.loadStoredAuth();
  expect(auth.getInMemoryOwnerOutageToken()).toBeNull();
});

test('logout clears the in-memory outage token', async () => {
  auth.setAuthCredentials(
    outageToken(Math.floor(Date.now() / 1000) + 3600),
    'ivx-owner-service',
    'owner',
  );
  await auth.clearStoredAuth();
  expect(auth.getInMemoryOwnerOutageToken()).toBeNull();
});
