import { expect, test } from 'bun:test';
import type { Session, User } from '@supabase/supabase-js';
import { readVerifiedSession } from '../lib/verified-session-restore';

const session = { access_token: 'fixture-token', user: { id: 'fixture-user' } } as Session;
test('restores an authority-verified session', async () => {
  expect(await readVerifiedSession({
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async token => {
      expect(token).toBe(session.access_token);
      return { data: { user: session.user }, error: null };
    },
  })).toEqual(session);
});
test('rejects missing, rejected and mismatched identities', async () => {
  for (const identity of [null, { id: 'another-user' } as User]) {
    expect(await readVerifiedSession({
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: identity }, error: null }),
    })).toBeNull();
  }
  expect(await readVerifiedSession({
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user: session.user }, error: new Error('rejected') }),
  })).toBeNull();
  expect(await readVerifiedSession({
    getSession: async () => ({ data: { session: null }, error: null }),
    getUser: async () => { throw new Error('Must not query without a session'); },
  })).toBeNull();
});
