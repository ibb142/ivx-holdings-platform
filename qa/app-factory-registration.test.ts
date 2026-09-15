import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import type { PoolClient } from 'pg';
import { AppFactoryEngine, FACTORY_COMPONENTS } from '../backend/services/app-factory-engine';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');
const migration = await readFile(new URL('../supabase/migrations/20260913234137_app_factory_registration.sql', import.meta.url), 'utf8');
const submission = { requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ownerId: 'fixture-owner', instructions: 'Build and test a fixture application.' };

async function fixture() {
  const db = new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(migration);
  const released: boolean[] = [];
  let loseCommitAck = false;
  const client = {
    on() { return client; }, removeListener() { return client; },
    release(destroy = false) { released.push(Boolean(destroy)); },
    async query(sql: string, values?: unknown[]) {
      if (/^(BEGIN|SET LOCAL|ROLLBACK|COMMIT)/.test(sql)) {
        await db.exec(sql);
        if (sql === 'COMMIT' && loseCommitAck) { loseCommitAck = false; throw new Error('lost acknowledgement'); }
        return { rows: [] };
      }
      return db.query(sql, values);
    },
  } as PoolClient;
  const engine = new AppFactoryEngine({ connect: async () => client });
  const counts = async () => (await db.query(`select
    (select count(*)::int from factory_build_requests) as builds,
    (select count(*)::int from factory_tasks) as tasks`)).rows[0];
  return { db, engine, released, counts, loseNextCommitAck() { loseCommitAck = true; } };
}

test('registers exactly four tracks with a server deadline and stable retry identity', async () => {
  const f = await fixture();
  try {
    const first = await f.engine.submitAppBuildTarget('Fixture App', 10, submission);
    const again = await f.engine.submitAppBuildTarget('Fixture App', 10, submission);
    expect(first.tasks.map(t => t.component_type)).toEqual([...FACTORY_COMPONENTS]);
    expect(first.status).toBe('REGISTERED');
    expect(first.workersStarted).toBe(0);
    expect(first.applicationVerified).toBe(false);
    expect(again.duplicate).toBe(true);
    expect(again.targetDeadline).toBe(first.targetDeadline);
    expect(again.tasks).toEqual(first.tasks);
    expect(await f.counts()).toEqual({ builds: 1, tasks: 4 });
    const rows = (await f.db.query('select component_type,payload from factory_tasks')).rows;
    expect(rows.find((r: any) => r.component_type === 'QA').payload.dependency_task_ids).toHaveLength(3);
    expect(rows.every((r: any) => r.payload.target_deadline === first.targetDeadline)).toBe(true);
    expect(rows.every((r: any) => r.payload.evidence.length === 0)).toBe(true);
    const span = (await f.db.query('select extract(epoch from target_deadline-created_at) as seconds from factory_build_requests')).rows[0];
    expect(Math.abs(Number(span.seconds) - 10 * 86400)).toBeLessThan(1);
    expect(f.released).toEqual([false, false]);
  } finally { await f.db.close(); }
});

test('a failure in the last component rolls back the entire application plan', async () => {
  const f = await fixture();
  try {
    await f.db.exec(`create function reject_fixture_qa() returns trigger language plpgsql as $$
      begin if new.component_type='QA' then raise exception 'injected write failure'; end if; return new; end $$;
      create trigger reject_fixture_qa before insert on factory_tasks for each row execute function reject_fixture_qa();`);
    await expect(f.engine.submitAppBuildTarget('Fixture App', 10, submission)).rejects.toThrow('FACTORY_SUBMISSION_UNAVAILABLE');
    expect(await f.counts()).toEqual({ builds: 0, tasks: 0 });
    expect(f.released).toEqual([true]);
  } finally { await f.db.close(); }
});

test('a committed write with a lost acknowledgement is recovered using the same request ID', async () => {
  const f = await fixture();
  try {
    f.loseNextCommitAck();
    await expect(f.engine.submitAppBuildTarget('Fixture App', 30, submission)).rejects.toThrow('FACTORY_SUBMISSION_UNCONFIRMED');
    expect(await f.counts()).toEqual({ builds: 1, tasks: 4 });
    const recovered = await f.engine.submitAppBuildTarget('Fixture App', 30, submission);
    expect(recovered.duplicate).toBe(true);
    expect(await f.counts()).toEqual({ builds: 1, tasks: 4 });
    expect(f.released).toEqual([true, false]);
  } finally { await f.db.close(); }
});

test('reusing a request ID with another plan or owner rejects the whole attempt', async () => {
  const f = await fixture();
  try {
    const first = await f.engine.submitAppBuildTarget('Fixture App', 10, submission);
    for (const [name, days, input] of [
      ['Different App', 10, submission], ['Fixture App', 11, submission],
      ['Fixture App', 10, { ...submission, ownerId: 'other-owner' }],
      ['Fixture App', 10, { ...submission, instructions: 'Different scope' }],
    ] as const) {
      await expect(f.engine.submitAppBuildTarget(name, days, input)).rejects.toThrow('FACTORY_REQUEST_CONFLICT');
    }
    expect(await f.counts()).toEqual({ builds: 1, tasks: 4 });
    expect((await f.engine.submitAppBuildTarget('Fixture App', 10, submission)).tasks).toEqual(first.tasks);
  } finally { await f.db.close(); }
});

test('registration retries preserve terminal work and reject an incomplete stored plan', async () => {
  const f = await fixture();
  try {
    await f.engine.submitAppBuildTarget('Fixture App', 10, submission);
    await f.db.exec("update factory_tasks set state='FAILED',version=2 where component_type='DATABASE'");
    const retried = await f.engine.submitAppBuildTarget('Fixture App', 10, submission);
    expect(retried.tasks[0].state).toBe('FAILED');
    await f.db.exec("delete from factory_tasks where component_type='QA'");
    await expect(f.engine.submitAppBuildTarget('Fixture App', 10, submission)).rejects.toThrow('FACTORY_REGISTRATION_INCOMPLETE');
    expect(await f.counts()).toEqual({ builds: 1, tasks: 3 });
  } finally { await f.db.close(); }
});

test('public clients cannot read or mutate plans and the registrar cannot activate tasks', async () => {
  const f = await fixture();
  try {
    for (const role of ['anon', 'authenticated']) {
      await f.db.exec(`set role ${role}`);
      await expect(f.db.query('select * from public.factory_tasks')).rejects.toThrow('permission denied');
      await expect(f.db.query('delete from public.factory_build_requests')).rejects.toThrow('permission denied');
      await f.db.exec('reset role');
    }
    await f.db.exec('set role service_role');
    await f.engine.submitAppBuildTarget('Fixture App', 10, submission);
    await expect(f.db.query("update public.factory_tasks set state='VERIFIED'")).rejects.toThrow('permission denied');
    await f.db.exec('reset role');
    expect((await f.counts()).tasks).toBe(4);
  } finally { await f.db.close(); }
});
