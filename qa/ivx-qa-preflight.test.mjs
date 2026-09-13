import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authenticateOwner, waitForDeployment } from './ivx-qa-preflight.mjs';

const owner = { email: 'owner@example.test', password: 'fixture-password', supabaseUrl: 'https://fixture.supabase.co', anonKey: 'fixture-anon' };
const token = 'fixture-session-'.repeat(10);
const session = { access_token: token, user: { email: owner.email, app_metadata: { role: 'owner' } } };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

test('authenticates supplied owner credentials and returns only the verified session', async () => {
  let requests = 0;
  const result = await authenticateOwner(owner, async (url, options) => {
    requests++;
    assert.equal(url, `${owner.supabaseUrl}/auth/v1/token?grant_type=password`);
    assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), { email: owner.email, password: owner.password });
    assert.equal(options.headers.apikey, owner.anonKey);
    return json(session);
  });
  assert.equal(requests, 1);
  assert.deepEqual(result, { token, role: 'owner' });
});

test('missing credentials fail before any HTTP request', async () => {
  let requests = 0;
  await assert.rejects(authenticateOwner({ ...owner, password: '' }, async () => { requests++; }), /credentials_missing/);
  assert.equal(requests, 0);
});

test('a transient connection reset retries within the bounded authentication policy', async () => {
  let requests = 0, waits = 0;
  const result = await authenticateOwner(owner, async () => {
    if (++requests === 1) throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } });
    return json(session);
  }, { sleep: async () => { waits++; } });
  assert.deepEqual(result, { token, role: 'owner' });
  assert.equal(requests, 2);
  assert.equal(waits, 1);
});

test('an upstream 503 can recover, but invalid credentials are never retried', async () => {
  let requests = 0;
  await authenticateOwner(owner, async () => ++requests === 1 ? json({}, 503) : json(session), { sleep: async () => {} });
  assert.equal(requests, 2);
  requests = 0;
  await assert.rejects(authenticateOwner(owner, async () => { requests++; return json({}, 401); }, { sleep: async () => {} }), /owner_auth_http_401/);
  assert.equal(requests, 1);
});

test('user-editable metadata cannot establish Owner authority', async () => {
  await assert.rejects(authenticateOwner(owner, async () => json({ ...session,
    user: { email: owner.email, user_metadata: { role: 'owner' } } })), /owner_auth_identity_invalid/);
});

test('transport failure is bounded and contains no credentials or arbitrary upstream message', async () => {
  let requests = 0;
  await assert.rejects(authenticateOwner(owner, async () => {
    requests++;
    throw Object.assign(new Error(owner.password), { cause: { code: 'ECONNRESET' } });
  }, { sleep: async () => {} }), error => {
    assert.equal(error.message, 'owner_auth_transport_failed: connection_reset');
    assert.ok(!error.message.includes(owner.password));
    return true;
  });
  assert.equal(requests, 3);
});

test('rejects invalid credentials without exposing the response body', async () => {
  await assert.rejects(authenticateOwner(owner, async () => json({ error: owner.password }, 401)), error => {
    assert.equal(error.message, 'owner_auth_http_401');
    assert.ok(!error.message.includes(owner.password));
    return true;
  });
});

test('rejects a different identity, unprivileged role, empty session and malformed response', async () => {
  for (const response of [
    json({ ...session, user: { ...session.user, email: 'member@example.test' } }),
    json({ ...session, user: { email: owner.email, app_metadata: { role: 'member' } } }),
    json({ ...session, access_token: '' }),
    new Response('<html>upstream error</html>', { status: 200 }),
  ]) {
    await assert.rejects(authenticateOwner(owner, async () => response), /owner_auth_(identity|session|response)_invalid/);
  }
});

test('waits through old replicas and requires health plus version on the full target SHA', async () => {
  const sha = 'a'.repeat(40);
  const old = 'b'.repeat(40);
  let request = 0, waits = 0;
  const observed = [old, old, sha, old, sha, sha];
  const result = await waitForDeployment({ apiBase: 'https://api.example.test', sha, attempts: 3, fetchImpl: async () => json({ ok: true, commit: observed[request++] }), sleep: async () => { waits++; } });
  assert.equal(request, 6);
  assert.equal(waits, 2);
  assert.equal(result.sha, sha);
  assert.equal(result.attempts, 3);
});

test('stale, truncated and unhealthy deployment evidence cannot pass', async () => {
  const sha = 'a'.repeat(40);
  for (const body of [{ ok: true, commit: 'b'.repeat(40) }, { ok: true, commit: sha.slice(0, 12) }, { ok: false, commit: sha }]) {
    await assert.rejects(waitForDeployment({ apiBase: 'https://api.example.test', sha, attempts: 1, fetchImpl: async () => json(body), sleep: async () => {} }), /deployment_not_ready/);
  }
});

test('an invalid target fails before any request', async () => {
  let requests = 0;
  await assert.rejects(waitForDeployment({ apiBase: 'https://api.example.test', sha: '', fetchImpl: async () => { requests++; } }), /target_sha_invalid/);
  assert.equal(requests, 0);
});
