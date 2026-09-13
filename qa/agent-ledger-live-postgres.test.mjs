import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { AGENT_LEDGER_LIVE_SQL, buildAgentLedgerLiveSnapshot } from '../backend/services/ivx-agent-ledger-live-snapshot.ts';

const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');

test('live matrix executes the real SQL against canonical registry and native lease records', async t => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE public.ivx_agent_states (
        agent_id text PRIMARY KEY, agent_number integer UNIQUE, agent_name text,
        company text, status text, last_heartbeat timestamptz, last_task_id text
      );
      CREATE TABLE public.ivx_autonomous_tasks (
        task_id text PRIMARY KEY, state text, assigned_agent_number integer,
        lease_holder text, worker_instance_id text, last_heartbeat_at timestamptz,
        lease_expires_at timestamptz
      );
      CREATE UNIQUE INDEX ivx_autonomous_tasks_active_holder_idx
        ON public.ivx_autonomous_tasks (lease_holder)
        WHERE lease_holder IS NOT NULL AND state IN ('LEASED', 'RUNNING', 'EXECUTION_COMPLETED',
          'QA_IN_PROGRESS', 'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING');
      INSERT INTO public.ivx_agent_states
      SELECT 'ivx_holdings_' || n, n, 'Agent ' || n, 'ivx_holdings', 'active',
        now() - interval '10 seconds', 'finished-task-' || n FROM generate_series(1, 112) n;
      UPDATE public.ivx_agent_states SET last_heartbeat=now()-interval '61 seconds' WHERE agent_number=1;
      UPDATE public.ivx_agent_states SET last_heartbeat=now()+interval '6 seconds' WHERE agent_number IN (3, 10);
      UPDATE public.ivx_agent_states SET last_heartbeat=NULL WHERE agent_number=4;
      INSERT INTO public.ivx_autonomous_tasks VALUES
        ('stolen', 'RUNNING', 2, 'agent:ivx_holdings_1', 'worker-1', now(), now()+interval '1 minute'),
        ('expired', 'RUNNING', 3, 'agent:ivx_holdings_3', 'worker-3', now(), now()-interval '1 second'),
        ('future', 'RUNNING', 4, 'agent:ivx_holdings_4', 'worker-4', now()+interval '6 seconds', now()+interval '1 minute'),
        ('stale', 'RUNNING', 5, 'agent:ivx_holdings_5', 'worker-5', now()-interval '61 seconds', now()+interval '1 minute'),
        ('no-worker', 'RUNNING', 6, 'agent:ivx_holdings_6', NULL, now(), now()+interval '1 minute'),
        ('leased', 'LEASED', 7, 'agent:ivx_holdings_7', 'worker-7', now(), now()+interval '1 minute'),
        ('no-registry', 'RUNNING', 8, 'agent:ivx_holdings_8', 'worker-8', now(), now()+interval '1 minute'),
        ('blank-worker', 'RUNNING', 9, 'agent:ivx_holdings_9', '  ', now(), now()+interval '1 minute'),
        ('fresh-task', 'RUNNING', 10, 'agent:ivx_holdings_10', 'worker-10', now()+interval '4 seconds', now()+interval '1 minute'),
        ('wrong-holder', 'RUNNING', 11, 'agent:another_company_11', 'worker-11', now(), now()+interval '1 minute'),
        ('no-lease', 'RUNNING', 12, 'agent:ivx_holdings_12', 'worker-12', now(), NULL),
        ('no-heartbeat', 'RUNNING', 13, 'agent:ivx_holdings_13', 'worker-13', NULL, now()+interval '1 minute');
      DELETE FROM public.ivx_agent_states WHERE agent_number=8;
      UPDATE public.ivx_agent_states SET agent_id='another_id_111' WHERE agent_number=111;
      UPDATE public.ivx_agent_states SET company='another_company' WHERE agent_number=112;
      INSERT INTO public.ivx_agent_states VALUES ('ivx_holdings_113',113,'Outside','ivx_holdings','active',now(),NULL);
    `);
    const counts = async () => (await db.query(`SELECT
      (SELECT count(*) FROM public.ivx_agent_states) AS agents,
      (SELECT count(*) FROM public.ivx_autonomous_tasks) AS tasks`)).rows;
    const before = await counts();
    await db.exec('BEGIN READ ONLY');
    const { rows } = await db.query(AGENT_LEDGER_LIVE_SQL);
    const snapshot = buildAgentLedgerLiveSnapshot(rows);
    await db.exec('COMMIT');

    await t.test('112 ordered slots do not turn missing or foreign identities into registered agents', () => {
      assert.equal(snapshot.matrix112.length, 112);
      assert.deepEqual(snapshot.matrix112.map(r => r.agent_number), Array.from({ length: 112 }, (_, i) => i + 1));
      assert.equal(snapshot.summary.registered_count, 109);
      assert.equal(snapshot.summary.missing_count, 3);
      assert.equal(snapshot.summary.registry_complete, false);
      assert.equal(snapshot.matrix112[7].heartbeat_state, 'MISSING_AGENT');
    });
    await t.test('agent presence is separate from task execution and worker ownership overrides assignment', () => {
      assert.equal(snapshot.matrix112[0].heartbeat_state, 'STALE');
      assert.equal(snapshot.matrix112[0].active_work, true);
      assert.equal(snapshot.matrix112[0].running_task_id, 'stolen');
      assert.equal(snapshot.matrix112[1].heartbeat_state, 'FRESH');
      assert.equal(snapshot.matrix112[1].status, 'active');
      assert.equal(snapshot.matrix112[1].active_work, false);
      assert.equal(snapshot.summary.active_concurrent_count, 3);
      assert.equal(snapshot.summary.fresh_heartbeat_count, 105);
    });
    await t.test('stale, future, expired, unowned and non-running tasks contribute no active count', () => {
      for (const agent of [3, 4, 5, 6, 7, 9, 11, 12, 13]) {
        assert.equal(snapshot.matrix112[agent - 1].active_work, false, `agent ${agent}`);
      }
      assert.equal(snapshot.matrix112[2].heartbeat_state, 'CLOCK_SKEW');
      assert.equal(snapshot.matrix112[3].heartbeat_state, 'NO_HEARTBEAT');
      assert.equal(snapshot.matrix112[9].active_work, true);
    });
    await t.test('matrix and summary use the same database observation without changing records', async () => {
      assert.equal(new Set(rows.map(r => new Date(r.measured_at).toISOString())).size, 1);
      assert.equal(snapshot.timestamp, new Date(rows[0].measured_at).toISOString());
      assert.equal(snapshot.metrics.reduce((sum, r) => sum + r.agent_count, 0), 112);
      assert.equal(snapshot.metrics.reduce((sum, r) => sum + r.active_concurrent_count, 0), 3);
      assert.deepEqual(await counts(), before);
    });
    await t.test('a complete idle registry reports no observed work rather than operational success', async () => {
      await db.exec(`DELETE FROM public.ivx_autonomous_tasks;
        UPDATE public.ivx_agent_states SET agent_id='ivx_holdings_'||agent_number, company='ivx_holdings';
        INSERT INTO public.ivx_agent_states VALUES ('ivx_holdings_8',8,'Agent 8','ivx_holdings','active',now(),NULL);`);
      const complete = buildAgentLedgerLiveSnapshot((await db.query(AGENT_LEDGER_LIVE_SQL)).rows);
      assert.equal(complete.summary.registry_complete, true);
      assert.equal(complete.summary.active_concurrent_count, 0);
      assert.equal(complete.status, 'NO_ACTIVE_WORK_OBSERVED');
    });
  } finally { await db.close(); }
});
