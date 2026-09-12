import test from 'node:test';
import assert from 'node:assert/strict';
import { runProof, API, SUPABASE, OWNER_READ } from './phase1-owner-isolation-live.mjs';

// Test doubles verify the harness's verdict/cleanup; these are not hosted acceptance evidence.
const config = {
  consent: 'temporary-members-and-chat-fixtures', apiBase: API, supabaseUrl: SUPABASE,
  targetSha: '1'.repeat(40), qaSourceSha: '2'.repeat(40), run: 'regression-1',
  ownerEmail: 'owner@qa.invalid', ownerPassword: 'owner-secret-not-for-receipts',
  anonKey: 'anonymous-key', serviceKey: 'server-secret-not-for-receipts',
};
const response = (data, status = 200) => new Response(data === null ? null : JSON.stringify(data), { status });

function server(override = () => undefined) {
  const users = new Map([['owner', { id: 'owner', email: config.ownerEmail, app_metadata: { role: 'owner' } }]]);
  const tables = new Map(['members', 'profiles', 'public_chat_sessions', 'public_chat_messages', 'ivx_ai_conversations'].map(name => [name, new Map()]));
  const calls = [];
  const sessions = new Map();
  const fetchImpl = async (input, init) => {
    const url = new URL(input);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const token = init.headers.Authorization?.replace('Bearer ', '');
    const admin = token === config.serviceKey;
    const user = users.get(sessions.get(token));
    const call = { url, init, body, token, user, admin, users, tables, sessions };
    calls.push(call);
    const intercepted = override(call);
    if (intercepted !== undefined) return intercepted;
    if (url.origin === API) {
      assert.notEqual(token, config.serviceKey);
      assert.equal(init.headers.apikey, undefined);
      assert.equal(init.method, 'GET');
      if (url.pathname === '/health' || url.pathname === '/version') return response({ ok: true, commit: config.targetSha });
      if (url.pathname === OWNER_READ) {
        if (!token) return response({ ok: false, error: 'IVX auth guard failed: missing bearer token.' }, 401);
        if (user?.id === 'owner') return response({ ok: true, ownerOnly: true, authenticatedUserId: 'owner' });
        return response({ ok: false, error: 'IVX role guard failed: privileged IVX access is required.' }, 403);
      }
      if (url.pathname === '/api/public/chat/history') {
        const sessionId = url.searchParams.get('sessionId');
        const messages = [...tables.get('public_chat_messages').values()].filter(row => row.session_id === sessionId);
        return response({ ok: true, sessionId, persistence: 'supabase', messages });
      }
    }
    assert.equal(url.origin, SUPABASE);
    if (url.pathname === '/auth/v1/token') {
      const found = [...users.values()].find(item => item.email === body.email);
      assert.ok(found);
      const token = `test.${found.id}.signature`;
      sessions.set(token, found.id);
      return response({ user: found, access_token: token });
    }
    if (url.pathname === '/auth/v1/user') {
      assert.ok(user);
      if (init.method === 'PUT') user.user_metadata = { ...user.user_metadata, ...body.data };
      return response(user);
    }
    if (url.pathname === '/auth/v1/logout') {
      if (user?.id === 'owner') assert.equal(url.searchParams.get('scope'), 'local');
      sessions.delete(token);
      return response(null, 204);
    }
    if (url.pathname === '/auth/v1/admin/users') {
      assert.ok(admin);
      assert.equal(body.email_confirm, true);
      assert.equal(body.phone, undefined);
      assert.equal(body.app_metadata.role, 'member');
      users.set(body.id, { ...body });
      tables.get('members').set(body.id, { member_id: body.id, auth_user_id: body.id, email: body.email });
      return response(body);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/')) {
      assert.ok(admin);
      const id = url.pathname.split('/').at(-1);
      if (init.method === 'DELETE') { users.delete(id); tables.get('profiles').delete(id); return response(null, 204); }
      return response(users.get(id) ?? { code: 'user_not_found' }, users.has(id) ? 200 : 404);
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').at(-1);
      const rows = tables.get(table);
      assert.ok(rows);
      if (!admin && table !== 'profiles') return response({ code: '42501' }, user ? 403 : 401);
      if (!admin && init.method !== 'GET') return response({ code: '42501' }, 403);
      let selected = [...rows.values()].filter(row => [...url.searchParams].every(([key, value]) => {
        if (value.startsWith('eq.')) return row[key] === value.slice(3);
        if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(row[key]);
        return true;
      }));
      if (!admin) selected = selected.filter(row => row.id === user?.id);
      if (init.method === 'POST') { rows.set(body.id, structuredClone(body)); return response(null, 201); }
      if (init.method === 'DELETE') { for (const row of selected) rows.delete(row.id ?? row.member_id); return response(null, 204); }
      const keys = url.searchParams.get('select')?.split(',');
      return response(selected.map(row => keys ? Object.fromEntries(keys.map(key => [key, row[key]])) : row));
    }
    assert.fail('Unexpected request');
  };
  return { fetchImpl, users, tables, calls, sessions };
}

test('complete acceptance requires real session checks, exact denials, persisted histories and cleanup', async () => {
  const remote = server();
  const receipt = await runProof(config, remote);
  assert.equal(receipt.result, 'PASS', JSON.stringify(receipt));
  assert.equal(receipt.checks.filter(check => check.name.includes('editable_metadata_case')).length, 7);
  assert.equal(receipt.checks.filter(check => check.name.includes('direct_read_denied')).length, 12);
  assert.equal(receipt.checks.filter(check => check.name.includes('_history_')).length, 4);
  assert.deepEqual([...remote.users.keys()], ['owner']);
  assert.equal(remote.sessions.size, 0);
  for (const rows of remote.tables.values()) assert.equal(rows.size, 0);
  assert.ok(!JSON.stringify(receipt).includes(config.serviceKey));
  assert.ok(!JSON.stringify(receipt).includes(config.ownerPassword));
  assert.ok(!JSON.stringify(receipt).includes('signature'));
});

test('wrong project or commit fails before creating accounts', async () => {
  for (const change of [{ supabaseUrl: 'https://other.supabase.co' }, { targetSha: '3'.repeat(40) }, { consent: undefined }]) {
    const remote = server();
    const receipt = await runProof({ ...config, ...change }, remote);
    assert.equal(receipt.result, 'FAIL');
    assert.equal(receipt.temporaryIdentities.length, 0);
    assert.ok(!remote.calls.some(call => call.url.pathname === '/auth/v1/admin/users'));
  }
});

test('Auth outage never becomes a denied-member PASS and all created accounts are removed', async () => {
  const remote = server(call => call.url.origin === API && call.url.pathname === OWNER_READ && call.user?.id !== 'owner' && call.token
    ? response({ ok: false, error: 'Authentication service temporarily unavailable.' }, 403) : undefined);
  const receipt = await runProof(config, remote);
  assert.equal(receipt.result, 'FAIL');
  assert.deepEqual(receipt.errors, ['member_denial_not_proven']);
  assert.deepEqual([...remote.users.keys()], ['owner']);
  assert.equal(remote.tables.get('members').size, 0);
  assert.equal(receipt.checks.filter(check => check.name.startsWith('real_member')).length, 0);
});

test('owner login transport failure creates no fixture and does not log provider error bodies', async () => {
  const remote = server(call => { if (call.url.pathname === '/auth/v1/token') throw new Error(config.ownerPassword); });
  const receipt = await runProof(config, remote);
  assert.deepEqual(receipt.errors, ['transport_supabase_POST']);
  assert.equal(receipt.temporaryIdentities.length, 0);
  assert.ok(!JSON.stringify(receipt).includes(config.ownerPassword));
});

test('private-table 503 and wrong chat persistence both fail with complete fixture cleanup', async () => {
  for (const kind of ['private-outage', 'history-fallback', 'history-mix']) {
    const remote = server(call => {
      if (kind === 'private-outage' && call.url.pathname === '/rest/v1/public_chat_sessions' && !call.admin)
        return response({ code: 'PGRST002' }, 503);
      if (call.url.pathname === '/api/public/chat/history') return response({ ok: true, sessionId: call.url.searchParams.get('sessionId'), persistence: kind === 'history-fallback' ? 'json' : 'supabase', messages: [] });
    });
    const receipt = await runProof(config, remote);
    assert.equal(receipt.result, 'FAIL');
    assert.ok(receipt.cleanup.every(step => step.result === 'PASS'), JSON.stringify(receipt.cleanup));
    for (const rows of remote.tables.values()) assert.equal(rows.size, 0);
  }
});

test('a role update that grants owner access is a failure, followed by cleanup', async () => {
  const remote = server(call => {
    if (call.url.pathname === '/rest/v1/profiles' && call.init.method === 'PATCH') {
      const row = call.tables.get('profiles').get(call.user.id);
      row.role = 'owner';
      return response([row]);
    }
  });
  const receipt = await runProof(config, remote);
  assert.equal(receipt.result, 'FAIL');
  assert.deepEqual(receipt.errors, ['profile_role_write_not_denied']);
  assert.equal(remote.tables.get('profiles').size, 0);
});

test('uncertain create outcome is checkpointed before request and never certified clean', async () => {
  const checkpoints = [];
  const remote = server(call => { if (call.url.pathname === '/auth/v1/admin/users') throw new Error('timeout'); });
  const receipt = await runProof(config, { ...remote, checkpoint: value => checkpoints.push(value) });
  assert.equal(receipt.result, 'FAIL');
  assert.ok(checkpoints.some(value => value.temporaryIdentities.length === 1 && !value.finishedAt));
  assert.ok(receipt.cleanup.some(step => step.code === 'identity_cleanup_unconfirmed'));
});

test('cleanup refuses to delete an identity whose ownership marker changed', async () => {
  const remote = server(call => {
    if (call.url.pathname.startsWith('/auth/v1/admin/users/') && call.init.method === 'GET') {
      const user = call.users.get(call.url.pathname.split('/').at(-1));
      if (user) return response({ ...user, app_metadata: { role: 'member', phase1_qa_run: 'other-run' } });
    }
  });
  const receipt = await runProof(config, remote);
  assert.equal(receipt.result, 'FAIL');
  assert.equal(receipt.acceptancePassed, true);
  assert.ok(receipt.cleanup.some(step => step.code === 'cleanup_identity_marker_mismatch'));
  assert.ok(!remote.calls.some(call => call.url.pathname.startsWith('/auth/v1/admin/users/') && call.init.method === 'DELETE'));
});
