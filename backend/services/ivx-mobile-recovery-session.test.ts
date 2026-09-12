import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// Execute the actual mobile recovery guard, including its state mutations.
// An outage response from an older backend must not authenticate the UI.
const source = readFileSync(new URL('../../expo/lib/auth-context.tsx', import.meta.url), 'utf8');
const start = source.indexOf("          const accessToken = typeof parsed.accessToken");
const end = source.indexOf('          // Mark manual owner login BEFORE setSession', start);
if (start < 0 || end < start) throw new Error('Mobile recovery guard not found');
const guard = new Bun.Transpiler({ loader: 'ts' }).transformSync(`
(async () => {
 let lastError = null, sessionInstalled = false, reachedSetSession = false;
 for (const parsed of responses) {
 ${source.slice(start, end)}
 reachedSetSession = true;
 }
 return { lastError, sessionInstalled, reachedSetSession };
})()`);
async function execute(response: Record<string, unknown>) {
 const mutations: unknown[] = [];
 const mutate = (...args: unknown[]) => mutations.push(args);
 const result = await runInNewContext(guard, {
  responses: [response], normalizedOwnerEmail: 'owner@example.test',
  sanitizeEmail: (value: string) => value, isValidOwnerVerifiedUserId: () => true,
  isOwnerAdminEmail: () => true, manualOwnerLoginRef: {}, ownerIPActiveRef: {}, activeSessionUserIdRef: {},
  setUser: mutate, setUserRole: mutate, setIsAuthenticated: mutate, setIsOwnerIPAccess: mutate,
  setAuthCredentials: mutate, persistAuth: mutate, console: { log() {} },
 });
 return { ...result, mutations };
}
test('an incompatible outage response cannot authenticate the mobile UI', async () => {
 const result = await execute({ accessToken: 'test-outage-token', refreshToken: '', sessionMethod: 'ivx_owner_outage_session', userId: 'test-owner', email: 'owner@example.test' });
 expect(result.sessionInstalled).toBe(false);
 expect(result.reachedSetSession).toBe(false);
 expect(result.mutations).toEqual([]);
 expect(result.lastError).toBeTruthy();
});
test('a complete provider session proceeds to Supabase installation', async () => {
 const result = await execute({ accessToken: 'test-access', refreshToken: 'test-refresh', sessionMethod: 'bounded_password_grant' });
 expect(result.reachedSetSession).toBe(true);
 expect(result.mutations).toEqual([]);
 expect(result.lastError).toBeNull();
});
test('an incomplete provider session does not authenticate', async () => {
 const result = await execute({ accessToken: 'test-access', sessionMethod: 'bounded_password_grant' });
 expect(result.reachedSetSession).toBe(false);
 expect(result.mutations).toEqual([]);
 expect(result.lastError).toBeTruthy();
});
