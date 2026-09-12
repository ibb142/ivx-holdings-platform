import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../expo/lib/auth-context.tsx', import.meta.url), 'utf8');

// Execute the production callbacks, keeping React and network boundaries under
// test control. This does not replace the owner browser acceptance test.
function callback(name, end) {
  const start = source.indexOf(`  const ${name} = useCallback(`);
  assert.ok(start >= 0, `${name} callback is present`);
  const finish = source.indexOf(end, start);
  assert.ok(finish > start, `${name} callback has its expected boundary`);
  return stripTypeScriptTypes(source.slice(start, finish), { mode: 'strip' });
}

const callbacks = callback('doLogout', '\n  const startMonitor = useCallback(')
  + callback('handleSession', '\n  const activateOwnerIPSession = useCallback(');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function session(id = 'owner-a') {
  return {
    access_token: `fixture-${id}`,
    refresh_token: 'fixture-refresh',
    expires_at: 2000000000,
    user: { id, email: `${id}@example.test`, user_metadata: {} },
  };
}

function fixture({ resolveRole, persist, signOut } = {}) {
  const state = { user: null, authenticated: false, role: 'investor', monitors: 0, warmups: 0, persisted: [] };
  const refs = Object.fromEntries([
    'ownerIPActiveRef', 'sessionWarmupKeyRef', 'ownerRepairKeyRef',
    'activeSessionUserIdRef', 'lastHandledSessionKeyRef',
    'lastHandledSessionResultRef', 'inFlightSessionKeyRef',
    'inFlightSessionPromiseRef', 'sessionMonitorCleanup',
  ].map(key => [key, { current: null }]));
  refs.manualOwnerLoginRef = { current: true };
  const update = key => value => { state[key] = typeof value === 'function' ? value(state[key]) : value; };
  const noop = () => {};
  const context = {
    ...refs,
    console: { log: noop },
    useCallback: fn => fn,
    setUser: update('user'), setIsAuthenticated: update('authenticated'), setUserRole: update('role'),
    setIsOwnerIPAccess: noop, setDetectedIP: noop,
    clearTwoFactorState: noop, setAuthCredentials: noop,
    clearStoredAuth: async () => {}, clearOwnerResilientSession: async () => {}, clearOwnerIP: async () => {},
    supabase: { auth: { signOut: signOut ?? (async () => {}) } },
    shouldRepairOwnerAfterLogin: () => false,
    resolveServerRole: resolveRole ?? (async () => ({ role: 'owner', source: 'profiles' })),
    resolveLocalSessionRoleFallback: async () => ({ role: 'investor', source: 'timeout_fallback' }),
    normalizeRole: value => value,
    withTimeout: fn => fn(), AUTH_ROLE_RESOLUTION_TIMEOUT_MS: 1000,
    shouldBlockRoleForAdminAccess: () => false,
    isAdminRole: role => role === 'owner',
    areAuthUsersEqual: (a, b) => a === b,
    persistAuth: async value => { state.persisted.push(value.userId); await persist?.(value); },
    startMonitor: () => { state.monitors += 1; },
    warmSessionInBackground: () => { state.warmups += 1; },
    hydrateResolvedRoleInBackground: noop,
  };
  const api = runInNewContext(`${callbacks}\n({ handleSession, doLogout });`, context);
  return { ...api, state, refs };
}

test('a role lookup completing after logout cannot restore the old owner', async () => {
  const role = deferred();
  const f = fixture({ resolveRole: () => role.promise });
  const restoring = f.handleSession(session());
  await f.doLogout();
  role.resolve({ role: 'owner', source: 'profiles' });
  assert.equal((await restoring).accepted, false);
  assert.equal(f.state.authenticated, false);
  assert.equal(f.state.user, null);
  assert.deepEqual(f.state.persisted, []);
  assert.equal(f.state.monitors, 0);
});

test('requesting logout invalidates pending restoration before remote sign-out finishes', async () => {
  const role = deferred();
  const remote = deferred();
  const f = fixture({ resolveRole: () => role.promise, signOut: () => remote.promise });
  const restoring = f.handleSession(session());
  const loggingOut = f.doLogout();
  role.resolve({ role: 'owner', source: 'profiles' });
  try {
    assert.equal((await restoring).accepted, false);
    assert.equal(f.state.authenticated, false);
    assert.deepEqual(f.state.persisted, []);
  } finally {
    remote.resolve();
    await loggingOut;
  }
});

test('an older role lookup cannot replace a newer account', async () => {
  const role = deferred();
  const f = fixture({ resolveRole: id => id === 'owner-a' ? role.promise : Promise.resolve({ role: 'owner', source: 'profiles' }) });
  const older = f.handleSession(session('owner-a'));
  assert.equal((await f.handleSession(session('owner-b'))).accepted, true);
  role.resolve({ role: 'owner', source: 'profiles' });
  assert.equal((await older).accepted, false);
  assert.equal(f.state.user.id, 'owner-b');
  assert.deepEqual(f.state.persisted, ['owner-b']);
});

test('logout during persistence prevents stale monitoring, warmup and acceptance caching', async () => {
  const writing = deferred();
  const started = deferred();
  const f = fixture({ persist: () => { started.resolve(); return writing.promise; } });
  const restoring = f.handleSession(session());
  await started.promise;
  await f.doLogout();
  writing.resolve();
  assert.equal((await restoring).accepted, false);
  assert.equal(f.state.authenticated, false);
  assert.equal(f.state.monitors, 0);
  assert.equal(f.state.warmups, 0);
  assert.equal(f.refs.lastHandledSessionResultRef.current, null);
});

test('current owner restoration and duplicate events still share one accepted session', async () => {
  const role = deferred();
  const f = fixture({ resolveRole: () => role.promise });
  const first = f.handleSession(session());
  const duplicate = f.handleSession(session());
  role.resolve({ role: 'owner', source: 'profiles' });
  assert.equal((await first).accepted, true);
  assert.equal((await duplicate).accepted, true);
  assert.equal((await f.handleSession(session())).accepted, true);
  assert.equal(f.state.user.id, 'owner-a');
  assert.deepEqual(f.state.persisted, ['owner-a']);
  assert.equal(f.state.monitors, 1);
  assert.equal(f.state.warmups, 1);
});

test('an obsolete attempt cannot clear a newer attempt with the same session token', async () => {
  const firstRole = deferred();
  const nextRole = deferred();
  let calls = 0;
  const f = fixture({ resolveRole: () => ++calls === 1 ? firstRole.promise : nextRole.promise });
  const obsolete = f.handleSession(session());
  await f.doLogout();
  f.refs.manualOwnerLoginRef.current = true;
  const current = f.handleSession(session());
  firstRole.resolve({ role: 'owner', source: 'profiles' });
  assert.equal((await obsolete).accepted, false);
  nextRole.resolve({ role: 'owner', source: 'profiles' });
  assert.equal((await current).accepted, true);
  assert.deepEqual(f.state.persisted, ['owner-a']);
});
