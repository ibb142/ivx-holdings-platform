import { afterEach, beforeEach, expect, test } from 'bun:test';
import { scryptSync } from 'node:crypto';
import { handleMemberLogin } from './api/ivx-members';
import { MEMBER_LOGIN_FALLBACK_BUDGET_MS, verifyFallbackMemberPassword } from './services/ivx-member-database';

const names = ['SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY'] as const;
const originalFetch = globalThis.fetch;
let savedEnv: Record<string, string | undefined>;
let calls: string[];
let fallback: 'empty' | 'stalled' | 'unavailable' | 'member';
let provider: 'invalid' | 'success' | 'unavailable' | 'limited';
let fallbackAborted: boolean;
let suppliedPassword: unknown;
const password = '  literal password  ';
const salt = 'local-regression-salt';

beforeEach(() => {
  savedEnv = Object.fromEntries(names.map(name => [name, process.env[name]]));
  process.env.SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://member-login-test.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-key';
  process.env.SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = 'test-public-key';
  calls = []; fallback = 'empty'; provider = 'invalid'; fallbackAborted = false; suppliedPassword = undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.hostname !== 'member-login-test.invalid') throw new Error('Unexpected external request');
    calls.push(url.pathname);
    if (url.pathname === '/rest/v1/ivx_durable_documents') {
      expect(url.searchParams.get('select')).toBe('value');
      expect(url.searchParams.get('limit')).toBe('1');
      expect(url.searchParams.get('doc_key')).toBe('eq.member-database/fallback-members.json');
      if (fallback === 'stalled') return new Promise<Response>((_resolve, reject) => {
        init!.signal!.addEventListener('abort', () => { fallbackAborted = true; reject(init!.signal!.reason); }, { once: true });
      });
      if (fallback === 'unavailable') return Response.json({ message: 'private database detail' }, { status: 503 });
      return Response.json([{ value: fallback === 'member' ? {
        member: { id: 'fallback-member', email: 'member@example.com', passwordSalt: salt, passwordHash: scryptSync(password, salt, 64).toString('hex') },
      } : {} }]);
    }
    if (url.pathname === '/auth/v1/token') {
      suppliedPassword = JSON.parse(String(init?.body)).password;
      if (provider === 'success') return Response.json({
        access_token: 'test-access-token', refresh_token: 'test-refresh-token', token_type: 'bearer', expires_in: 3600,
        user: { id: 'primary-member', email: 'member@example.com' },
      });
      if (provider === 'unavailable') return Response.json({ message: 'private provider detail' }, { status: 503 });
      if (provider === 'limited') return Response.json({ message: 'Rate limit reached' }, { status: 429 });
      return Response.json({ code: 'invalid_credentials', message: 'Invalid login credentials' }, { status: 400 });
    }
    if (['/rest/v1/profiles', '/rest/v1/audit_logs'].includes(url.pathname)) return Response.json([]);
    throw new Error(`Unexpected login dependency: ${url.pathname}`);
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of names) {
    if (savedEnv[name] === undefined) delete process.env[name];
    else process.env[name] = savedEnv[name];
  }
});

const login = (body: unknown) => handleMemberLogin(new Request('https://api.example.com/api/members/login', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
}));

test('malformed bodies and empty credentials finish without any dependency request', async () => {
  for (const body of [null, [], {}, { email: 12, password: 'x' }, { email: 'member@example.com', password: {} }]) {
    expect((await login(body)).status).toBe(400);
  }
  for (const body of [{ email: 'malformed', password: 'x' }, { email: 'member@example.com', password: '   ' }]) {
    expect((await login(body)).status).toBe(401);
  }
  expect(calls).toEqual([]);
});

test('a confirmed negative uses one point read and one auth request, without schema work or identity lookup', async () => {
  const start = performance.now();
  const response = await login({ email: 'member@example.com', password: 'wrong' });
  expect(response.status).toBe(401);
  expect((await response.json()).message).toBe('Invalid email or password.');
  expect(performance.now() - start).toBeLessThan(500);
  expect(calls).toEqual(['/rest/v1/ivx_durable_documents', '/auth/v1/token']);
});

test('fallback verification keeps literal password characters', async () => {
  fallback = 'member';
  expect(await verifyFallbackMemberPassword('member@example.com', password, AbortSignal.timeout(500))).toBe('fallback-member');
  expect(await verifyFallbackMemberPassword('member@example.com', password.trim(), AbortSignal.timeout(500))).toBeNull();
});

test('a stalled fallback transport is aborted and a correct Supabase password still succeeds', async () => {
  fallback = 'stalled'; provider = 'success';
  const start = performance.now();
  const response = await login({ email: 'member@example.com', password });
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.accessToken).toBe('test-access-token');
  expect(suppliedPassword).toBe(password);
  expect(fallbackAborted).toBe(true);
  expect(performance.now() - start).toBeLessThan(MEMBER_LOGIN_FALLBACK_BUDGET_MS + 500);
  expect(calls.filter(path => path === '/rest/v1/ivx_durable_documents')).toHaveLength(1);
});

test('a stalled fallback plus a negative primary verdict remains retryable, not a false bad-password verdict', async () => {
  fallback = 'stalled';
  const response = await login({ email: 'member@example.com', password: 'wrong' });
  expect(response.status).toBe(503);
  expect((await response.json()).retryable).toBe(true);
  expect(fallbackAborted).toBe(true);
});

test('dependency failures are sanitized and preserve retryable status', async () => {
  fallback = 'unavailable';
  const response = await login({ email: 'member@example.com', password: 'wrong' });
  expect(response.status).toBe(503);
  expect(await response.text()).not.toContain('private database detail');
  fallback = 'empty'; provider = 'unavailable';
  const unavailable = await login({ email: 'member@example.com', password: 'wrong' });
  expect(unavailable.status).toBe(503);
  expect(await unavailable.text()).not.toContain('private provider detail');
});

test('provider rate limiting remains HTTP 429', async () => {
  provider = 'limited';
  expect((await login({ email: 'member@example.com', password: 'wrong' })).status).toBe(429);
});
