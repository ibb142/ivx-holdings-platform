// Real Auth and PostgREST proof, limited to the existing ephemeral QA stack.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const url = process.env.SUPABASE_URL!;
const database = process.env.IVX_QA_DB_URL!;
assert.equal(new URL(url).hostname, '127.0.0.1', 'Only isolated Auth is allowed');
assert.equal(new URL(database).hostname, '127.0.0.1', 'Only isolated PostgreSQL is allowed');
assert.equal(process.env.EXPO_PUBLIC_SUPABASE_URL, url);
assert.ok(process.env.SUPABASE_ANON_KEY && process.env.SUPABASE_SERVICE_ROLE_KEY);
process.env.NODE_ENV = 'production';
process.env.IVX_OPEN_ACCESS_MODE = 'false';
process.env.EXPO_PUBLIC_IVX_OPEN_ACCESS_MODE = 'false';
process.env.IVX_TEST_MODE = 'false';
process.env.EXPO_PUBLIC_IVX_TEST_MODE = 'false';
delete process.env.IVX_OWNER_TOKEN;

const actualFetch = globalThis.fetch;
globalThis.fetch = ((input, init) => {
  const target = new URL(input instanceof Request ? input.url : String(input));
  assert.equal(target.origin, new URL(url).origin, 'Proof cannot contact a hosted service');
  return actualFetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(10_000) });
}) as typeof fetch;
const { resolveIVXAuthenticatedRequest, getIVXAccessControlConfig, resolveIVXSupabaseUrl } = await import('../expo/shared/ivx/access-control');
assert.equal(getIVXAccessControlConfig().securityMode, 'strict');
assert.equal(resolveIVXSupabaseUrl(), url);

const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, options);
const anonymous = createClient(url, process.env.SUPABASE_ANON_KEY!, options);
const db = new pg.Client({ connectionString: database });
const created: string[] = [];
const createdTables: string[] = [];
const privateTables = ['public_chat_sessions', 'public_chat_messages', 'ivx_ai_conversations'];
let metadataChangesDenied = 0;
let privateReadsDenied = 0;
let profileIsolationChecks = 0;
let receipt: Record<string, unknown> | undefined;
const guard = (token: string) => resolveIVXAuthenticatedRequest(new Request('http://127.0.0.1/owner', {
  headers: { Authorization: `Bearer ${token}` },
}), '[isolated-real-auth]');
await db.connect();
try {
  await db.query(`grant select on public.profiles to authenticated;
    create policy phase1_role_proof_self_read on public.profiles for select to authenticated using(id=auth.uid());`);
  const identities = [];
  for (const kind of ['owner', 'member-a', 'member-b']) {
    const role = kind === 'owner' ? 'owner' : 'member';
    const email = `phase1-${kind}-${randomUUID()}@qa.invalid`;
    const password = randomUUID() + randomUUID();
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role } });
    assert.equal(made.error, null, 'Isolated user creation failed');
    assert.ok(made.data.user);
    created.push(made.data.user.id);
    await db.query('insert into public.profiles(id,email,role) values($1,$2,$3)', [made.data.user.id, email, role]);
    const client = createClient(url, process.env.SUPABASE_ANON_KEY!, options);
    const login = await client.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null, 'Real password login failed');
    assert.equal(login.data.user?.id, made.data.user.id);
    assert.ok(login.data.session?.access_token);
    identities.push({ kind, id: made.data.user.id, client, token: login.data.session.access_token });
  }
  const [owner, first, second] = identities;
  assert.equal((await guard(owner.token)).role, 'owner');
  for (const member of [first, second]) {
    await assert.rejects(guard(member.token), /privileged IVX access is required/);
    const own = await member.client.from('profiles').select('id').eq('id', member.id);
    assert.equal(own.error, null);
    assert.deepEqual(own.data, [{ id: member.id }]);
    const others = await member.client.from('profiles').select('id').neq('id', member.id);
    assert.equal(others.error, null);
    assert.deepEqual(others.data, []);
    profileIsolationChecks += 2;
  }
  for (const metadata of [{ role: 'owner' }, { role: 'admin' }, { role: 'developer' },
    { user_role: 'owner' }, { app_role: 'superadmin' }, { profile: { role: 'owner' } },
    { app_metadata: { role: 'owner' } }]) {
    const updated = await first.client.auth.updateUser({ data: metadata });
    assert.equal(updated.error, null, 'Auth must actually accept the editable metadata');
    const verified = await first.client.auth.getUser();
    assert.equal(verified.error, null);
    assert.equal(verified.data.user?.app_metadata.role, 'member');
    for (const key of Object.keys(metadata)) assert.deepEqual(verified.data.user?.user_metadata[key], metadata[key as keyof typeof metadata]);
    await assert.rejects(guard(first.token), /privileged IVX access is required/);
    metadataChangesDenied++;
  }
  for (const table of privateTables) {
    await db.query(`create table public.${table}(id text primary key, payload text);
      alter table public.${table} enable row level security;
      grant select,insert,update,delete on public.${table} to anon,authenticated,service_role;
      create policy original_permissive_policy on public.${table} for all to authenticated using(true) with check(true);
      insert into public.${table} values ('visitor-a','isolated A'),('visitor-b','isolated B');`);
    createdTables.push(table);
  }
  await db.query(await readFile(new URL('../supabase/repair-functions/ivx-private-visitor-chat.sql', import.meta.url), 'utf8'));
  for (const table of privateTables) {
    // Newly created relations become visible after the notified schema reload.
    let serviceRead;
    for (let attempt = 0; attempt < 15; attempt++) {
      serviceRead = await admin.from(table).select('id');
      if (serviceRead.error?.code !== 'PGRST205') break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert.equal(serviceRead?.error, null);
    assert.equal(serviceRead?.data?.length, 2);
    for (const client of [anonymous, first.client, second.client]) {
      const blocked = await client.from(table).select('id');
      assert.equal(blocked.error?.code, '42501');
      assert.ok([401, 403].includes(blocked.status));
      privateReadsDenied++;
    }
  }
  receipt = { result: 'PASS', scope: 'isolated real Auth, PostgREST and application guard',
    sourceSha: process.env.GITHUB_SHA ?? null, observedAt: new Date().toISOString(), realPasswordSessions: 3,
    ownerAllowed: true, ordinaryMembersDenied: 2, metadataChangesDenied, profileIsolationChecks,
    privateReadsDenied, privateRowsPreserved: 6, productionRowsTouched: 0, hostedRequests: 0 };
} finally {
  for (const table of createdTables) await db.query(`drop table public.${table}`);
  await db.query('delete from public.profiles where id=any($1::uuid[])', [created]);
  for (const id of created) {
    const deleted = await admin.auth.admin.deleteUser(id);
    assert.equal(deleted.error, null, 'Isolated identity cleanup failed');
  }
  await db.end();
  globalThis.fetch = actualFetch;
}
assert.ok(receipt);
console.log(JSON.stringify({ ...receipt, isolatedIdentitiesRemoved: created.length }));
