import { expect, mock, test } from 'bun:test';

let resolvedToken: string | null = null;

mock.module('react-native', () => ({ Platform: { OS: 'ios' } }));
mock.module('@/lib/supabase-env', () => ({
  resolveSupabaseUrl: () => 'https://kvclcdjmjghndxsngfzb.supabase.co',
}));
mock.module('@/lib/ivx-supabase-client', () => ({
  getIVXAccessToken: async () => resolvedToken,
  getIVXSupabaseClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
  }),
}));

const { decodeBoundedOwnerOutageToken, runOwnerSessionPreflight } = await import(
  '../src/modules/ivx-owner-ai/services/ownerSessionPreflight'
);

function outageToken(email: string, expiresAt: number): string {
  return `ivxos1.${expiresAt}.${Buffer.from(email).toString('base64url')}.nonce.signature`;
}

test('accepts a live allowlisted outage token while keeping backend signature verification authoritative', async () => {
  const token = outageToken('iperez4242@gmail.com', Math.floor(Date.now() / 1000) + 3600);
  resolvedToken = token;

  const result = await runOwnerSessionPreflight();
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.detail);
  expect(result.accessToken).toBe(token);
  expect(result.email).toBe('iperez4242@gmail.com');
  expect(result.checks.find((check) => check.id === 'bounded_outage_session')?.passed).toBe(true);
  expect(result.checks.find((check) => check.id === 'supabase_session')?.passed).toBe(false);
});

test('blocks expired and non-allowlisted outage tokens before POST', async () => {
  resolvedToken = outageToken('iperez4242@gmail.com', Math.floor(Date.now() / 1000) - 1);
  const expired = await runOwnerSessionPreflight();
  expect(expired.ok).toBe(false);
  if (expired.ok) throw new Error('expired outage token unexpectedly passed');
  expect(expired.reason).toBe('outage_token_invalid');

  resolvedToken = outageToken('attacker@example.com', Math.floor(Date.now() / 1000) + 3600);
  const unlisted = await runOwnerSessionPreflight();
  expect(unlisted.ok).toBe(false);
  if (unlisted.ok) throw new Error('unlisted outage token unexpectedly passed');
  expect(unlisted.reason).toBe('outage_token_invalid');
});

test('decoder rejects malformed tokens without exposing token material', () => {
  expect(decodeBoundedOwnerOutageToken('ivxos1.invalid')).toBeNull();
  expect(decodeBoundedOwnerOutageToken('ivxos1.123.bad.nonce.signature')).toBeNull();
});
