import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

function source(path) {
  return stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), { mode: 'strip' })
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];[ \t]*$/gm, '')
    .replace(/^export /gm, '');
}
// Execute the production identity/role boundary. Only Supabase I/O and time are
// substituted; this is a concurrency regression, not a live owner certificate.
const production = source('../expo/shared/ivx/access.ts') + '\n'
  + source('../expo/shared/ivx/access-control.ts');
const flush = async () => { for (let i = 0; i < 24; i += 1) await Promise.resolve(); };
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
const goodProfile = role => ({ data: { id: 'owner-fixture', role }, error: null, status: 200 });
const fixtureToken = suffix => `fixture.${suffix}.signature-for-profile-concurrency`;

function fixture() {
  const state = { now: 0, clients: [], identities: [], reads: [], timers: new Map(), timerId: 0 };
  const env = { NODE_ENV: 'production', EXPO_PUBLIC_SUPABASE_URL: 'https://profile-a.supabase.co' };
  let read = () => Promise.resolve(goodProfile('owner'));
  let identity = () => Promise.resolve({ data: { user: {
    id: 'owner-fixture', email: 'owner@example.test', app_metadata: { role: 'member' }, user_metadata: {},
  } }, error: null });
  const context = {
    process: { env }, URL, Request, Response, AbortController, Buffer,
    Date: class extends Date { static now() { return state.now; } },
    console: { log() {} }, fetch() { throw new Error('Unexpected live network access'); },
    setTimeout(fn, ms) { const id = ++state.timerId; state.timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { state.timers.delete(id); },
    createClient(url, key, options) {
      const client = { url, key, options };
      client.auth = { getUser(token) { state.identities.push({ client, token }); return identity(token); } };
      client.from = table => ({ select: selection => ({ eq: (column, value) => ({
        abortSignal: signal => ({ maybeSingle() {
          const call = { client, table, selection, column, value, signal };
          state.reads.push(call);
          return read(call);
        } }),
      }) }) });
      state.clients.push(client);
      return client;
    },
  };
  const api = runInNewContext(production + '\n({ resolveIVXAuthenticatedRequest });', context);
  return {
    state, env,
    setRead(fn) { read = fn; }, setIdentity(fn) { identity = fn; },
    request(token = fixtureToken('owner')) {
      return api.resolveIVXAuthenticatedRequest(new Request('https://example.test/owner-chat', {
        headers: { Authorization: `Bearer ${token}` },
      }), '[profile-concurrency-test]');
    },
    expire(ms) {
      const timers = [...state.timers.values()].filter(t => t.ms === ms);
      assert.ok(timers.length > 0, `a ${ms} ms deadline exists`);
      for (const timer of timers) timer.fn();
    },
  };
}

test('40 simultaneous verified requests share one profile read and keep separate request clients', async () => {
  const f = fixture(), done = deferred();
  f.setRead(() => done.promise);
  const requests = Array.from({ length: 40 }, () => f.request());
  await flush();
  const readCount = f.state.reads.length;
  done.resolve(goodProfile('owner'));
  const results = await Promise.all(requests);
  assert.equal(readCount, 1);
  assert.equal(f.state.identities.length, 40, 'each request still verifies its own identity');
  assert.equal(new Set(results.map(r => r.client)).size, 40);
  results[0].roleAudit.normalizedRole = 'investor';
  assert.equal(results[1].roleAudit.normalizedRole, 'owner');
  assert.equal(f.state.timers.size, 0);
});

test('a subsequent request reads the current profile instead of reusing an owner grant', async () => {
  const f = fixture();
  assert.equal((await f.request()).role, 'owner');
  f.setRead(() => Promise.resolve(goodProfile('member')));
  await assert.rejects(f.request(), /privileged IVX access is required/);
  assert.equal(f.state.reads.length, 2);
  assert.equal(f.state.identities.length, 2);
  assert.equal(f.state.timers.size, 0);
});

test('different bearer tokens for the same verified user never share a profile read', async () => {
  const f = fixture(), done = deferred();
  f.setRead(() => done.promise);
  const requests = ['first', 'second'].flatMap(id => [f.request(fixtureToken(id)), f.request(fixtureToken(id))]);
  await flush();
  const reads = f.state.reads.length;
  done.resolve(goodProfile('owner'));
  const results = await Promise.all(requests);
  assert.equal(reads, 2);
  assert.equal(results[0].userId, results[2].userId);
});

test('the same bearer cannot share across different verified user identities', async () => {
  const f = fixture(), done = deferred();
  f.setRead(() => done.promise);
  const first = [f.request(), f.request()];
  await flush();
  f.setIdentity(() => Promise.resolve({ data: { user: {
    id: 'different-owner', email: 'another@example.test', app_metadata: {}, user_metadata: {},
  } }, error: null }));
  const second = [f.request(), f.request()];
  await flush();
  const ids = f.state.reads.map(r => r.value);
  done.resolve(goodProfile('owner'));
  await Promise.all([...first, ...second]);
  assert.deepEqual(ids, ['owner-fixture', 'different-owner']);
});

test('project scope is captured before a delayed identity lookup and later environment rotation', async () => {
  const f = fixture(), done = deferred();
  const delayedIdentity = deferred();
  const identity = { data: { user: {
    id: 'owner-fixture', email: 'owner@example.test', app_metadata: {}, user_metadata: {},
  } }, error: null };
  f.setRead(() => done.promise);
  f.setIdentity(() => delayedIdentity.promise);
  const first = [f.request(), f.request()];
  await flush();
  f.env.EXPO_PUBLIC_SUPABASE_URL = 'https://profile-b.supabase.co';
  f.setIdentity(() => Promise.resolve(identity));
  const second = [f.request(), f.request()];
  await flush();
  delayedIdentity.resolve(identity);
  await flush();
  const urls = f.state.reads.map(r => r.client.url);
  done.resolve(goodProfile('owner'));
  await Promise.all([...first, ...second]);
  assert.deepEqual(urls, ['https://profile-b.supabase.co', 'https://profile-a.supabase.co']);
});

test('a rotated data key cannot reuse an in-flight read with the earlier privileges', async () => {
  const f = fixture(), done = deferred();
  f.setRead(() => done.promise);
  const first = [f.request(), f.request()];
  await flush();
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  f.env.SUPABASE_SERVICE_ROLE_KEY = `${encode({ alg: 'HS256' })}.${encode({ role: 'service_role' })}.fixture-not-a-real-signature`;
  const second = [f.request(), f.request()];
  await flush();
  const keys = f.state.reads.map(r => r.client.key);
  done.resolve(goodProfile('owner'));
  await Promise.all([...first, ...second]);
  assert.equal(keys.length, 2);
  assert.notEqual(keys[0], keys[1]);
});

test('shared profile failures reject every caller and a later request can recover', async () => {
  const f = fixture(), done = deferred();
  f.setRead(() => done.promise);
  f.setIdentity(() => Promise.resolve({ data: { user: {
    id: 'owner-fixture', email: 'owner@example.test', app_metadata: { role: 'owner' }, user_metadata: {},
  } }, error: null }));
  const requests = Array.from({ length: 6 }, () => f.request().catch(error => error));
  await flush();
  const reads = f.state.reads.length;
  done.resolve({ data: null, error: { message: 'fixture database unavailable' }, status: 503 });
  const errors = await Promise.all(requests);
  assert.equal(reads, 1);
  assert.ok(errors.every(error => error.status === 503));
  f.setRead(() => Promise.resolve(goodProfile('owner')));
  assert.equal((await f.request()).role, 'owner');
  assert.equal(f.state.reads.length, 2);
  assert.equal(f.state.timers.size, 0);
});

test('a stuck shared read aborts once, releases capacity and never grants access from late data', async () => {
  const f = fixture(), done = deferred();
  f.setRead(() => done.promise);
  const requests = [f.request().catch(error => error), f.request().catch(error => error)];
  await flush();
  const reads = f.state.reads.length;
  f.expire(5000);
  assert.ok((await Promise.all(requests)).every(error => error.status === 503));
  assert.ok(f.state.reads.every(call => call.signal.aborted));
  f.setRead(() => Promise.resolve(goodProfile('member')));
  await assert.rejects(f.request(), /privileged IVX access is required/);
  done.resolve(goodProfile('owner'));
  await flush();
  assert.equal(reads, 1);
  assert.equal(f.state.timers.size, 0);
});

test('a caller with less auth time left cannot cancel another caller sharing its profile read', async () => {
  const f = fixture(), slowIdentity = deferred(), done = deferred();
  const identityResult = { data: { user: {
    id: 'owner-fixture', email: 'owner@example.test', app_metadata: {}, user_metadata: {},
  } }, error: null };
  let identities = 0;
  f.setIdentity(() => ++identities === 1 ? slowIdentity.promise : Promise.resolve(identityResult));
  f.setRead(() => done.promise);
  const expiring = f.request().catch(error => error);
  f.state.now = 14900;
  const active = f.request();
  await flush();
  f.state.now = 14990;
  slowIdentity.resolve(identityResult);
  await flush();
  const reads = f.state.reads.length;
  f.expire(10);
  assert.equal((await expiring).status, 503);
  assert.equal(f.state.reads[0].signal.aborted, false);
  done.resolve(goodProfile('owner'));
  assert.equal((await active).role, 'owner');
  assert.equal(reads, 1);
  assert.equal(f.state.timers.size, 0);
});

test('rejected identities cannot join an in-flight owner profile lookup', async () => {
  const f = fixture(), done = deferred();
  f.setRead(() => done.promise);
  const owner = f.request();
  await flush();
  f.setIdentity(() => Promise.resolve({ data: { user: null }, error: { status: 401, message: 'rejected' } }));
  await assert.rejects(f.request(), /invalid or expired/);
  done.resolve(goodProfile('owner'));
  assert.equal((await owner).role, 'owner');
  assert.equal(f.state.reads.length, 1);
  assert.equal(f.state.identities.length, 2);
});

test('distinct pending profile reads have a hard capacity and identical work still joins at capacity', async () => {
  const f = fixture(), done = deferred();
  f.setRead(() => done.promise);
  const requests = Array.from({ length: 32 }, (_, i) => f.request(fixtureToken(`owner-${i}`)));
  await flush();
  const overflow = f.request(fixtureToken('overflow')).catch(error => error);
  const joined = f.request(fixtureToken('owner-0'));
  await flush();
  const reads = f.state.reads.length;
  done.resolve(goodProfile('owner'));
  const overflowResult = await overflow;
  await Promise.all([...requests, joined]);
  assert.equal(reads, 32);
  assert.equal(overflowResult.status, 503);
  assert.equal(f.state.timers.size, 0);
  assert.equal((await f.request(fixtureToken('next'))).role, 'owner');
});
