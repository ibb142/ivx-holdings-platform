import { beforeEach, expect, mock, test } from 'bun:test';

let refreshCalls = 0;

mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));
mock.module('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => {},
  deleteItemAsync: async () => {},
}));
mock.module('@react-native-async-storage/async-storage', () => ({ default: {
  getItem: async () => null,
  setItem: async () => {},
  removeItem: async () => {},
} }));
mock.module('../lib/logger', () => ({ default: { authStore: {
  log: () => {}, warn: () => {}, error: () => {},
} } }));

const mockSupabase = {
  auth: {
    getSession: async () => ({ data: { session: null }, error: null }),
    refreshSession: async () => {
      refreshCalls += 1;
      return { data: { session: null }, error: { message: 'provider unavailable' } };
    },
  },
};

mock.module('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseClient: () => mockSupabase,
}));
mock.module('@/lib/supabase-env', () => ({
  resolveSupabaseUrl: () => 'https://kvclcdjmjghndxsngfzb.supabase.co',
}));
mock.module('@/lib/admin-access-lock', () => ({
  getConfiguredOwnerAdminEmail: () => 'iperez4242@gmail.com',
}));
mock.module('@/shared/ivx', () => ({
  getIVXAccessControlConfig: () => ({
    ownerBypassEnabled: false,
    openAccessEnabled: false,
    devTestModeEnabled: false,
    securityMode: 'strict',
  }),
  IVX_OPEN_ACCESS_OWNER_TOKEN: 'dev-open-access-token',
  IVX_OPEN_ACCESS_OWNER_USER_ID: 'dev-open-access-user',
  IVX_OWNER_AI_API_PATH: '/api/ivx/owner-ai',
  resolveIVXRoleAudit: () => ({ normalizedRole: 'owner' }),
}));

const auth = await import('../lib/auth-store');
const { getIVXAccessToken } = await import('../lib/ivx-supabase-client');

function outageToken(): string {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const email = Buffer.from('iperez4242@gmail.com').toString('base64url');
  return `ivxos1.${expiresAt}.${email}.nonce.signature`;
}

beforeEach(async () => {
  refreshCalls = 0;
  await auth.clearStoredAuth();
});

test('resolves the active in-memory owner outage token before a failing Supabase refresh', async () => {
  const token = outageToken();
  auth.setAuthCredentials(token, 'ivx-owner-service', 'owner');

  expect(await getIVXAccessToken({ forceRefresh: true })).toBe(token);
  expect(refreshCalls).toBe(0);
});

test('does not create an outage token when none was installed by owner login', async () => {
  expect(await getIVXAccessToken()).toBeNull();
  expect(refreshCalls).toBe(1);
});
