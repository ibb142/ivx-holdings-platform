import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.IVX_PRIVACY_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_privacy_test') {
  throw new Error('Isolated local ivx_privacy_test database required');
}
const db = new pg.Client({ connectionString });
await db.connect();
const tables = ['public_chat_sessions', 'public_chat_messages', 'ivx_ai_conversations'];
const identities = ['f3b5b7ca-cdf1-4388-a08e-5738b08dc316', 'e9dcfd04-2d44-4fa8-ae6e-b06f3616bcd2'];
async function asRole(role, subject, operation) {
  assert(['anon', 'authenticated', 'service_role'].includes(role));
  await db.query('begin');
  try {
    await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: subject, role,
      app_metadata: { role: 'member' }, user_metadata: { role: 'owner' } })]);
    await db.query(`set local role ${role}`);
    return await operation();
  } finally { await db.query('rollback'); }
}
const snapshot = async () => {
  const rows = {};
  for (const table of tables) rows[table] = (await db.query(`select * from public.${table} order by id`)).rows;
  return rows;
};
try {
  await db.query('create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema public to anon, authenticated, service_role;');
  for (const table of tables) {
    await db.query(`create table public.${table}(id text primary key, payload text not null);
      alter table public.${table} enable row level security;
      grant select,insert,update,delete on public.${table} to anon,authenticated,service_role;
      create policy original_permissive_policy on public.${table} for all to authenticated using(true) with check(true);
      insert into public.${table} values ('visitor-a','private visitor A'),('visitor-b','private visitor B');`);
  }
  const original = await snapshot();
  for (const subject of identities) {
    for (const table of tables) {
      const rows = await asRole('authenticated', subject, () => db.query(`select id from public.${table}`));
      assert.equal(rows.rowCount, 2, 'Baseline must reproduce cross-visitor access');
    }
  }
  const repair = await readFile(new URL('../supabase/repair-functions/ivx-private-visitor-chat.sql', import.meta.url), 'utf8');
  await db.query(repair);
  await db.query(repair);
  let denied = 0;
  for (const role of ['anon', 'authenticated']) {
    for (const subject of identities) {
      for (const table of tables) {
        for (const sql of [`select * from public.${table}`, `insert into public.${table} values ('forbidden','private')`,
          `update public.${table} set payload='changed' where id='visitor-a'`, `delete from public.${table} where id='visitor-a'`]) {
          await assert.rejects(asRole(role, subject, () => db.query(sql)), error => error.code === '42501');
          denied++;
        }
      }
    }
  }
  for (const table of tables) {
    await asRole('service_role', identities[0], async () => {
      assert.equal((await db.query(`select id from public.${table}`)).rowCount, 2);
      await db.query(`insert into public.${table} values ('backend-proof','backend write')`);
      assert.equal((await db.query(`update public.${table} set payload='updated' where id='backend-proof'`)).rowCount, 1);
      assert.equal((await db.query(`delete from public.${table} where id='backend-proof'`)).rowCount, 1);
    });
    await db.query(`grant select,insert,update,delete on public.${table} to authenticated`);
    await asRole('authenticated', identities[0], async () => {
      assert.equal((await db.query(`select id from public.${table}`)).rowCount, 0, 'Restrictive boundary survives restored grants');
      assert.equal((await db.query(`update public.${table} set payload='changed'`)).rowCount, 0);
      assert.equal((await db.query(`delete from public.${table}`)).rowCount, 0);
    });
    await assert.rejects(asRole('authenticated', identities[0], () => db.query(`insert into public.${table} values ('forbidden','private')`)), error => error.code === '42501');
  }
  assert.deepEqual(await snapshot(), original, 'All visitor records must be preserved');
  console.log(JSON.stringify({ result: 'PASS', sourceSha: process.env.GITHUB_SHA ?? null, observedAt: new Date().toISOString(),
    scope: 'Isolated real PostgreSQL access-policy regression', baselineCrossVisitorAccessReproduced: true,
    distinctSubjects: 2, protectedTables: 3, deniedDirectOperations: denied, backendReadWritePreserved: true,
    recordsPreserved: true, repeatedRepairSafe: true, restoredGrantsRemainRestricted: true, productionRowsTouched: 0 }));
} finally { await db.end(); }
