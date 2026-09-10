import { expect, test } from 'bun:test';

for (const mode of ['success', 'mutation_failure', 'event_failure']) {
  test(`repair queue stays on verified PostgreSQL when REST is unavailable: ${mode}`, async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import { mock } from 'bun:test';
      import { EventEmitter } from 'node:events';
      import { strict as assert } from 'node:assert';
      let queries = [], rest = 0, pools = 0;
      const doc = { jobs: [{ jobId: 'job-1', status: 'queued' }], durable: true };
      mock.module('pg', () => ({ Client: class {}, Pool: class extends EventEmitter {
        constructor(config) {
          super(); pools++;
          assert.equal(config.max, 1);
          assert.equal(config.application_name, 'ivx_repair');
          assert.equal(config.ssl.rejectUnauthorized, true);
          assert(config.ssl.ca.length > 0);
          assert(!config.connectionString.includes('sslmode'));
        }
        async connect() {
          const client = Object.assign(new EventEmitter(), {
            query: async (sql, values) => {
              if (/^(BEGIN|SET LOCAL|COMMIT|ROLLBACK)/.test(sql)) return { rows: [] };
              queries.push({ sql, values });
              if (sql.startsWith('select value ')) { assert.equal(values[0], 'senior-developer-worker/queue.json'); return { rows: [{ value: structuredClone(doc) }] }; }
              if (sql.includes('ivx_senior_queue_claim')) { assert.equal(values[0], 'job-1'); assert.equal(values[2], false); assert(sql.includes('$3::boolean')); return { rows: [{ result: { jobId: 'job-1', status: 'running' } }] }; }
              if (sql.includes('ivx_senior_queue_patch')) { assert.equal(JSON.parse(values[0])[0].next.status, 'running'); return { rows: [{ result: doc }] }; }
              if (sql.includes('ivx_senior_ledger_put') && ${JSON.stringify(mode)} === 'mutation_failure') throw Error('ambiguous direct failure');
              if (sql.startsWith('insert into public.ivx_durable_events') && ${JSON.stringify(mode)} === 'event_failure') throw Error('supplemental event unavailable');
              return { rows: [{ result: null }] };
            }, release: () => {},
          });
          this.emit('connect', client);
          return client;
        }
      } }));
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://testproject.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
      process.env.SUPABASE_DB_URL = 'postgresql://postgres.testproject:test@aws-0-us-east-1.pooler.supabase.com/postgres?sslmode=require';
      globalThis.fetch = async () => { rest++; throw Error('REST unavailable'); };
      const m = await import(${JSON.stringify(new URL('./ivx-senior-shared-queue.ts', import.meta.url).pathname)});
      const file = '/app/logs/audit/senior-developer-worker/queue.json';
      const queue = m.rememberSeniorQueue(await m.readSharedSeniorDocument(file, { jobs: [] }));
      assert.equal(queue.jobs.length, 1);
      assert.equal((await m.claimSharedSeniorJob('job-1')).status, 'running');
      queue.jobs[0].status = 'running';
      await m.patchSharedSeniorQueue(queue, new Set(['job-1']));
      if (${JSON.stringify(mode)} === 'mutation_failure') await assert.rejects(m.putSharedSeniorResult({ jobId: 'job-1' }), /ambiguous direct failure/);
      else {
        await m.putSharedSeniorResult({ jobId: 'job-1' });
        await m.appendSharedSeniorProofEvent('/app/logs/audit/senior-developer-worker/proof-ledger.json', { jobId: 'job-1' });
      }
      assert.equal(rest, 0);
      assert.equal(pools, 1);
      assert.equal(queries.filter(q => q.sql.includes('ivx_senior_ledger_put')).length, 1);
      const store = await import(${JSON.stringify(new URL('./ivx-postgres-autonomous-task-store.ts', import.meta.url).pathname)});
      process.env.SUPABASE_DB_URL = process.env.SUPABASE_DB_URL.replace('postgres.testproject', 'postgres.otherproject');
      const before = queries.length;
      await assert.rejects(store.readSeniorQueuePostgresDocument('senior-developer-worker/queue.json'), /project_mismatch/);
      assert.equal(queries.length, before);
    `], { stdout: 'pipe', stderr: 'pipe', timeout: 10000 });
    const [code, error] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(error).not.toContain('Error:');
    expect(code).toBe(0);
  });
}
