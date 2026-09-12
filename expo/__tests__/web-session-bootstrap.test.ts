import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { readVerifiedSession } from '../lib/verified-session-restore';

// Execute the production initAuth closure, not a copy of its implementation.
// Dependencies are controlled here; live owner/browser acceptance remains separate.
const source = readFileSync(new URL('../lib/auth-context.tsx', import.meta.url), 'utf8');
const start = source.indexOf('    const initAuth = async () => {');
const end = source.indexOf('\n    void initAuth();', start);
if (start < 0 || end < 0) throw new Error('Production auth bootstrap not found');
const bootstrap = new Bun.Transpiler({ loader: 'tsx' }).transformSync(source.slice(start, end));

function fixture(options: { rejected?: boolean; cancelled?: boolean; manual?: boolean; mfa?: boolean } = {}) {
  const calls: string[] = [];
  const session = { access_token: 'test-token', user: { id: 'owner-fixture' } };
  const deps = {
    Platform: { OS: 'web' }, cancelled: options.cancelled ?? false,
    manualOwnerLoginRef: { current: options.manual ?? false }, AUTH_BOOTSTRAP_TIMEOUT_MS: 3500,
    logStartup: () => {}, logStartupError: () => {},
    supabase: { auth: {
      getSession: async () => ({ data: { session }, error: null }),
      getUser: async () => ({ data: { user: session.user }, error: options.rejected ? new Error('AUTH_SERVICE_UNAVAILABLE') : null }),
      signOut: async () => { calls.push('signOut'); },
    } },
    readVerifiedSession,
    withTimeout: async (work: () => Promise<unknown>) => work(),
    requireTwoFactorIfNeeded: async () => { calls.push('mfa'); return options.mfa ?? false; },
    handleSession: async (restored: typeof session) => { expect(restored.user.id).toBe(session.user.id); calls.push('authorize'); },
    setIsLoading: (value: boolean) => { calls.push(`loading:${value}`); },
  };
  return { calls, run: () => new Function(...Object.keys(deps), `${bootstrap}\nreturn initAuth();`)(...Object.values(deps)) };
}

test('web reload restores the verified session without signing it out', async () => {
  const f = fixture(); await f.run();
  expect(f.calls).toEqual(['mfa', 'authorize', 'loading:false']);
});
test('unavailable authority does not grant access or destroy the stored session', async () => {
  const f = fixture({ rejected: true }); await f.run();
  expect(f.calls).toEqual(['loading:false']);
});
test('restoration keeps an outstanding MFA challenge closed', async () => {
  const f = fixture({ mfa: true }); await f.run();
  expect(f.calls).toEqual(['mfa', 'loading:false']);
});
test('an unmounted bootstrap cannot restore a session', async () => {
  const f = fixture({ cancelled: true }); await f.run();
  expect(f.calls).toEqual([]);
});
test('bootstrap does not overwrite a newer manual login', async () => {
  const f = fixture({ manual: true }); await f.run();
  expect(f.calls).toEqual(['loading:false']);
});
