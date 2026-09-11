import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';

const envNames = ['IVX_OWNER_EMAIL', 'IVX_OWNER_PASSWORD', 'OWNER_NEW_PASSWORD', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'];
const savedEnv = new Map(envNames.map(name => [name, process.env[name]]));
const owner = 'owner@example.test';
const password = '  Local-Recovery-Example-783!  ';
let durablePassword = '';
let outageEnabled = true;
let authError: null | { status: number; message: string } = null;
const variableRead = mock(async (name: string) => name === 'OWNER_NEW_PASSWORD' ? durablePassword : '');
const grant = mock(async (_input: { email: string; password: string }) => ({
  data: { session: authError ? null : { access_token: 'isolated-access-session', refresh_token: 'isolated-refresh-session', expires_at: 2000000000, user: { id: 'test-owner' } } },
  error: authError,
}));
const createClient = mock(() => ({ auth: { signInWithPassword: grant } }));
const mint = mock((_email: string) => outageEnabled ? {
  token: 'isolated-owner-session', expiresAt: 2000000000, userId: 'test-owner', email: owner, role: 'owner',
} : null);
const network = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected network in isolated owner recovery test'));
mock.module('@supabase/supabase-js', () => ({ createClient }));
mock.module('./owner-only', () => ({
  ownerOnlyJson: (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }),
  ownerOnlyOptions: () => new Response(null, { status: 204 }),
}));
mock.module('./ivx-owner-variables', () => ({ getIVXOwnerVariableRuntimeValue: variableRead }));
mock.module('../../expo/shared/ivx/access-control', () => ({ getIVXOwnerEmailAllowlist: () => [owner] }));
mock.module('../services/ivx-outage-owner-session', () => ({ mintIVXOutageOwnerSession: mint }));
const { handleIVXOwnerPasswordlessLogin: handle } = await import('./ivx-owner-passwordless-login');
const request = (extra: Record<string, unknown> = {}) => new Request('https://example.test/owner-recovery', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: owner, emergency: 'ivx_emergency_recovery', ...extra }),
});
beforeEach(() => {
  for (const name of envNames) delete process.env[name];
  process.env.IVX_OWNER_EMAIL = owner;
  process.env.IVX_OWNER_PASSWORD = password;
  durablePassword = ''; outageEnabled = true; authError = null;
  variableRead.mockClear(); grant.mockClear(); createClient.mockClear(); mint.mockClear(); network.mockClear();
});
afterAll(() => {
  for (const [name, value] of savedEnv) if (value === undefined) delete process.env[name]; else process.env[name] = value;
  network.mockRestore(); mock.restore();
});
async function expectRejectedWithoutSession(response: Response, status: number) {
  expect(response.status).toBe(status);
  const body = await response.json();
  expect(body.success).toBe(false);
  expect(body.accessToken).toBeUndefined();
  expect(body.refreshToken).toBeUndefined();
  expect(createClient).not.toHaveBeenCalled();
  expect(mint).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
}
test('an emergency flag and allowlisted email cannot obtain a server credential session', async () => {
  await expectRejectedWithoutSession(await handle(request()), 401);
  expect(variableRead).not.toHaveBeenCalled();
});
test('empty and non-string credentials are rejected before runtime variable reads', async () => {
  for (const value of ['', null, 123, {}]) {
    await expectRejectedWithoutSession(await handle(request({ password: value })), 401);
  }
  expect(variableRead).not.toHaveBeenCalled();
});
test('wrong credentials cannot request an outage session or provider password grant', async () => {
  await expectRejectedWithoutSession(await handle(request({ password: 'Wrong-Local-Credential' })), 401);
});
test('an unavailable credential binding cannot mint an outage owner session', async () => {
  delete process.env.IVX_OWNER_PASSWORD;
  await expectRejectedWithoutSession(await handle(request({ password })), 503);
});
test('exact password bytes authorize the existing bounded outage session', async () => {
  const response = await handle(request({ password }));
  expect(response.status).toBe(200);
  expect((await response.json()).sessionMethod).toBe('ivx_owner_outage_session');
  expect(mint).toHaveBeenCalledTimes(1);
  expect(grant).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
test('removing whitespace changes the credential and cannot authenticate', async () => {
  await expectRejectedWithoutSession(await handle(request({ password: password.trim() })), 401);
});
test('durable credentials preserve exact whitespace too', async () => {
  delete process.env.IVX_OWNER_PASSWORD; durablePassword = password;
  expect((await handle(request({ password }))).status).toBe(200);
  expect(mint).toHaveBeenCalledTimes(1);
});
test('a different account remains rejected even with a matching credential', async () => {
  await expectRejectedWithoutSession(await handle(request({ email: 'member@example.test', password })), 403);
  expect(variableRead).not.toHaveBeenCalled();
});
test('a valid credential can use real-provider flow when outage signing is unavailable', async () => {
  outageEnabled = false;
  const response = await handle(request({ password }));
  expect(response.status).toBe(200);
  expect((await response.json()).sessionMethod).toBe('bounded_password_grant');
  expect(grant).toHaveBeenCalledWith({ email: owner, password });
  expect(network).not.toHaveBeenCalled();
});

