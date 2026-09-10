import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from 'bun:test';
import type { AuthError, User } from '@supabase/supabase-js';

// Run in its own process. Only the external identity provider is replaced;
// token validation, strict role enforcement and owner resolution stay real.
const previousNodeEnv = process.env.NODE_ENV;
const previousOwnerToken = process.env.IVX_OWNER_TOKEN;
process.env.NODE_ENV = 'production';
delete process.env.IVX_OWNER_TOKEN;
const user = {
  id: 'availability-owner', email: 'owner@example.test',
  app_metadata: { role: 'owner' }, user_metadata: {},
} as User;
let providerResult: { data: { user: User | null }; error: AuthError | null };
let profile: Record<string, unknown>;
let profileStatus: number;
let profileError: { message: string } | null;
const getUser = mock(async (_token: string) => providerResult);
const maybeSingle = mock(async () => ({ data: profile, error: profileError, status: profileStatus }));
const abortSignal = mock((_signal: AbortSignal) => ({ maybeSingle }));
const networkGuard = spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unexpected live request in isolated auth contract'));
let clientFetch: typeof fetch | undefined;
const providerModule = Bun.resolveSync('@supabase/supabase-js', new URL('../../expo/shared/ivx/', import.meta.url).pathname);
mock.module(providerModule, () => ({
  createClient: (_url: string, _key: string, options: { global?: { fetch?: typeof fetch } }) => {
    clientFetch = options.global?.fetch;
    return ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ abortSignal }) }) }),
    });
  },
}));
const { IVXAuthServiceUnavailableError, resolveIVXAuthenticatedRequest } = await import('../../expo/shared/ivx/access-control');
const request = () => new Request('https://example.test/owner-dashboard', {
  headers: { Authorization: 'Bearer fixture.header.signature-for-availability-test' },
});
const auditLog = spyOn(console, 'log').mockImplementation(() => {});
beforeEach(() => {
  providerResult = { data: { user }, error: null };
  profile = { id: user.id, email: user.email, role: 'owner' };
  profileStatus = 200;
  profileError = null;
  getUser.mockReset().mockImplementation(async () => providerResult);
  maybeSingle.mockReset().mockImplementation(async () => ({ data: profile, error: profileError, status: profileStatus }));
  abortSignal.mockClear();
});
afterEach(() => {
  auditLog.mockClear();
  expect(networkGuard).not.toHaveBeenCalled();
});
afterAll(() => {
  auditLog.mockRestore();
  networkGuard.mockRestore();
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousOwnerToken === undefined) delete process.env.IVX_OWNER_TOKEN;
  else process.env.IVX_OWNER_TOKEN = previousOwnerToken;
});

test('provider overload and network errors cannot become invalid-session errors or permit access', async () => {
  for (const status of [0, 429, 500, 503]) {
    providerResult = {
      data: { user: null },
      error: Object.assign(new Error('private provider diagnostic'), { status }) as AuthError,
    };
    await expect(resolveIVXAuthenticatedRequest(request(), '[availability-test]')).rejects.toBeInstanceOf(IVXAuthServiceUnavailableError);
  }
  getUser.mockRejectedValueOnce(new TypeError('private transport diagnostic'));
  await expect(resolveIVXAuthenticatedRequest(request(), '[availability-test]')).rejects.toThrow('temporarily unavailable');
  expect(maybeSingle).not.toHaveBeenCalled();
});

test('a timed-out identity lookup fails closed with 503 and clears its deadline', async () => {
  getUser.mockImplementationOnce(() => new Promise(() => {}));
  const originalSetTimeout = globalThis.setTimeout;
  const deadlineHandles: ReturnType<typeof setTimeout>[] = [];
  const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((callback, delay, ...args) => {
    const handle = originalSetTimeout(callback, delay === 15_000 ? 5 : delay, ...args);
    if (delay === 15_000) deadlineHandles.push(handle);
    return handle;
  }) as typeof setTimeout);
  const clearSpy = spyOn(globalThis, 'clearTimeout');
  try {
    const failure = await resolveIVXAuthenticatedRequest(request(), '[availability-test]').catch(error => error);
    expect(failure).toBeInstanceOf(IVXAuthServiceUnavailableError);
    expect(failure.status).toBe(503);
    expect(maybeSingle).not.toHaveBeenCalled();
    expect(deadlineHandles).toHaveLength(1);
    expect(clearSpy).toHaveBeenCalledWith(deadlineHandles[0]);
    // Probe the actual custom transport with a local fetch stub. Its signal
    // must already be aborted, so a timed-out lookup cannot retain a socket.
    let transportSignal: AbortSignal | null | undefined;
    networkGuard.mockImplementationOnce(async (_input, init) => {
      transportSignal = init?.signal;
      return new Response('{}');
    });
    await clientFetch!('https://example.test/auth/v1/user');
    expect(transportSignal?.aborted).toBe(true);
    networkGuard.mockClear();
  } finally {
    timerSpy.mockRestore();
    clearSpy.mockRestore();
  }
});

test('provider credential rejection remains an invalid session', async () => {
  providerResult = {
    data: { user: null },
    error: Object.assign(new Error('credential rejected'), { status: 401 }) as AuthError,
  };
  const failure = await resolveIVXAuthenticatedRequest(request(), '[availability-test]').catch(error => error);
  expect(failure).not.toBeInstanceOf(IVXAuthServiceUnavailableError);
  expect(failure.message).toContain('invalid or expired');
  expect(maybeSingle).not.toHaveBeenCalled();
});

test('missing and malformed bearers cannot call the identity provider', async () => {
  for (const token of ['', 'invalid-token']) {
    const malformed = new Request('https://example.test/owner-dashboard', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    await expect(resolveIVXAuthenticatedRequest(malformed, '[availability-test]')).rejects.toThrow('auth guard failed');
  }
  expect(getUser).not.toHaveBeenCalled();
});

test('a verified non-owner remains denied in production', async () => {
  providerResult = { data: { user: { ...user, app_metadata: { role: 'member' } } }, error: null };
  profile = { id: user.id, email: 'member@example.test', role: 'member' };
  await expect(resolveIVXAuthenticatedRequest(request(), '[availability-test]')).rejects.toThrow('privileged IVX access is required');
});

test('a recovered provider permits only its successfully verified owner and clears the deadline', async () => {
  const clearSpy = spyOn(globalThis, 'clearTimeout');
  try {
    const context = await resolveIVXAuthenticatedRequest(request(), '[availability-test]');
    expect(context.userId).toBe(user.id);
    expect(context.role).toBe('owner');
    expect(context.guardMode).toBe('strict');
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(clearSpy).toHaveBeenCalled();
  } finally {
    clearSpy.mockRestore();
  }
});

test('an unavailable profile source cannot fall back to an owner role in metadata', async () => {
  for (const status of [0, 429, 500, 503]) {
    profileStatus = status;
    profileError = { message: 'private profile transport diagnostic' };
    const failure = await resolveIVXAuthenticatedRequest(request(), '[availability-test]').catch(error => error);
    expect(failure).toBeInstanceOf(IVXAuthServiceUnavailableError);
    expect(failure.status).toBe(503);
  }
  maybeSingle.mockRejectedValueOnce(new TypeError('private profile network diagnostic'));
  await expect(resolveIVXAuthenticatedRequest(request(), '[availability-test]')).rejects.toBeInstanceOf(IVXAuthServiceUnavailableError);
});

test('a stuck profile request is aborted and its deadline is cleared', async () => {
  maybeSingle.mockImplementationOnce(() => new Promise(() => {}));
  const originalSetTimeout = globalThis.setTimeout;
  const handles: ReturnType<typeof setTimeout>[] = [];
  const timerSpy = spyOn(globalThis, 'setTimeout').mockImplementation(((callback, delay, ...args) => {
    const handle = originalSetTimeout(callback, delay === 5_000 ? 5 : delay, ...args);
    if (delay === 5_000) handles.push(handle);
    return handle;
  }) as typeof setTimeout);
  const clearSpy = spyOn(globalThis, 'clearTimeout');
  try {
    const failure = await resolveIVXAuthenticatedRequest(request(), '[availability-test]').catch(error => error);
    expect(failure).toBeInstanceOf(IVXAuthServiceUnavailableError);
    expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
    expect(handles).toHaveLength(1);
    expect(clearSpy).toHaveBeenCalledWith(handles[0]);
  } finally {
    timerSpy.mockRestore();
    clearSpy.mockRestore();
  }
});

test('profile verification uses only the remaining session deadline', async () => {
  const now = Date.now();
  const clock = spyOn(Date, 'now').mockReturnValue(now);
  getUser.mockImplementationOnce(async () => {
    clock.mockReturnValue(now + 14_990);
    return providerResult;
  });
  maybeSingle.mockImplementationOnce(() => new Promise(() => {}));
  const timerSpy = spyOn(globalThis, 'setTimeout');
  try {
    await expect(resolveIVXAuthenticatedRequest(request(), '[availability-test]')).rejects.toBeInstanceOf(IVXAuthServiceUnavailableError);
    expect(timerSpy.mock.calls.map(call => call[1])).toEqual([15_000, 10]);
    expect(abortSignal.mock.calls[0][0].aborted).toBe(true);
  } finally {
    clock.mockRestore();
    timerSpy.mockRestore();
  }
});
