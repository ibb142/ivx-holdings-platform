import { afterAll, beforeEach, expect, mock, spyOn, test } from 'bun:test';

const envNames = ['IVX_OWNER_EMAIL', 'IVX_OWNER_PASSWORD', 'OWNER_NEW_PASSWORD', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'];
const savedEnv = new Map(envNames.map(name => [name, process.env[name]]));
const owner = 'owner@example.test';
const password = '  Local-Recovery-Example-783!  ';
let durablePassword = '';
let outageEnabled = true;
let grantException: Error | null = null;
let omitRefreshToken = false;
let authError: null | { status: number; message: string } = null;
const variableRead = mock(async (name: string) => name === 'OWNER_NEW_PASSWORD' ? durablePassword : '');
const grant = mock(async (_input: { email: string; password: string }) => {
  if (grantException) throw grantException;
  return {
  data: { session: authError ? null : { access_token: 'isolated-access-session', refresh_token: omitRefreshToken ? '' : 'isolated-refresh-session', expires_at: 2000000000, user: { id: 'test-owner' } } },
  error: authError,
  };
});
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
  durablePassword = ''; outageEnabled = true; authError = null; grantException = null; omitRefreshToken = false;
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


test('mobile recovery requests an installable Supabase session even when outage signing is enabled', async () => {
  const response = await handle(request({ password, requireSupabaseSession: true }));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.sessionMethod).toBe('bounded_password_grant');
  expect(body.refreshToken).toBe('isolated-refresh-session');
  expect(grant).toHaveBeenCalledWith({ email: owner, password });
  expect(mint).not.toHaveBeenCalled();
});

for (const status of [400, 503]) {
  test(`mobile recovery preserves provider rejection ${status} without incompatible outage tokens`, async () => {
    authError = { status, message: status === 400 ? 'Invalid login credentials' : 'Authentication temporarily unavailable' };
    const response = await handle(request({ password, requireSupabaseSession: true }));
    const body = await response.json();
    expect(response.status).toBe(status === 400 ? 502 : 503);
    expect(body.success).toBe(false);
    expect(body.accessToken).toBeUndefined();
    expect(body.refreshToken).toBeUndefined();
    expect(grant).toHaveBeenCalledTimes(1);
    expect(mint).not.toHaveBeenCalled();
  });
}

test('mobile recovery rejects invalid credentials before any grant or signing', async () => {
  await expectRejectedWithoutSession(await handle(request({ password: 'wrong', requireSupabaseSession: true })), 401);
});

for (const [message, status] of [['Request timeout', 504], ['Network failed', 502]] as const) {
  test(`mobile recovery preserves thrown ${status} failures without outage signing`, async () => {
    grantException = new Error(message);
    const response = await handle(request({ password, requireSupabaseSession: true }));
    expect(response.status).toBe(status);
    expect((await response.json()).success).toBe(false);
    expect(mint).not.toHaveBeenCalled();
  });
}
test('mobile recovery rejects a provider response without a refresh token', async () => {
  omitRefreshToken = true;
  const response = await handle(request({ password, requireSupabaseSession: true }));
  expect(response.status).toBe(502);
  expect((await response.json()).success).toBe(false);
  expect(mint).not.toHaveBeenCalled();
});
