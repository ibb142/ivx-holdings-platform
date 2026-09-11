import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
const url = new URL(connectionString ?? 'postgres://invalid/');
if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
const db = new pg.Client({ connectionString });
await db.connect();
const sha = 'a'.repeat(40), oldSha = 'b'.repeat(40);
const families = ['landing-p0:', 'landing-p0-repair:', 'landing-p0-patrol:'];
const scope = { familyPrefixes: families, activePrefixes: families.map(p => `${p}${sha}:`), inspectionSourceSha: sha };
const fixture = (id, key, priority, order = 0) => ({ taskId: id, idempotencyKey: key, assignedAgentNumber: 108,
  state: 'QUEUED', priority, executionOrder: order, dependencies: [], checkpoint: { commitSha: 'c'.repeat(40), phase: 'PLANNING' } });
const claim = async (missionScope = scope) => (await db.query('select public.ivx_autonomous_tasks_claim_batch($1::jsonb,$2,60) value',
  [JSON.stringify([{ workerId: 'agent:inspection-scope-proof', agentNumber: 108, options: { missionScope } }]), 'inspection-scope-process'])).rows[0].value[0];
const complete = async id => db.query("update public.ivx_autonomous_tasks set state='VERIFIED',lease_holder=null,worker_instance_id=null,lease_expires_at=null,payload=payload||'{\"state\":\"VERIFIED\",\"leaseHolder\":null,\"leaseExpiresAt\":null}'::jsonb where task_id=$1", [id]);
const permissions = async () => (await db.query("select prosecdef,proconfig,proacl::text from pg_proc where oid='public.ivx_autonomous_tasks_claim_batch(jsonb,text,integer)'::regprocedure")).rows[0];

async function sequence() {
  await db.query('begin');
  try {
    await db.query('truncate public.ivx_autonomous_tasks cascade');
    await db.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb)', [JSON.stringify([
      fixture('old-module', `module-audit:${oldSha}:file`, 'critical'),
      fixture('old-secondary', `autonomous-secondary:${oldSha}:file`, 'critical'),
      fixture('landing', `landing-p0:${sha}:unit`, 'low'),
      fixture('urgent', 'owner-repair:critical', 'high'),
      fixture('current-module', `module-audit:${sha}:file`, 'low', 1),
      fixture('current-secondary', `autonomous-secondary:${sha}:file`, 'low', 2),
    ])]);
    const history = async () => (await db.query("select to_jsonb(t) value from public.ivx_autonomous_tasks t where task_id like 'old-%' order by task_id")).rows;
    const originalHistory = await history();
    const order = [];
    for (const expected of ['landing', 'urgent', 'current-module', 'current-secondary']) {
      const result = await claim();
      assert.equal(result.ok, true);
      assert.equal(result.task?.taskId, expected, 'Landing priority, independent repair priority and exact inspection eligibility');
      order.push(result.task.taskId);
      assert.equal(result.task.checkpoint.commitSha, 'c'.repeat(40));
      await complete(result.task.taskId);
    }
    assert.equal((await claim()).task, null, 'only obsolete inspections remain');
    assert.deepEqual(await history(), originalHistory, 'historical payloads, states and checkpoints are untouched');
    return order;
  } finally { await db.query('rollback'); }
}

try {
  await db.query(await readFile(new URL('../supabase/migrations/20260911120700_ivx_empty_claim_pressure.sql', import.meta.url), 'utf8'));
  await assert.rejects(sequence, error => error.code === 'ERR_ASSERTION' && /priority/.test(error.message));
  const beforePermissions = await permissions();
  const repair = await readFile(new URL('../supabase/repair-functions/ivx-inspection-claim-scope.sql', import.meta.url), 'utf8');
  await db.query(repair);
  await db.query(repair);
  assert.deepEqual(await permissions(), beforePermissions, 'function privileges and execution identity remain unchanged');
  const order = await sequence();
  await db.query('begin');
  try {
    await db.query('truncate public.ivx_autonomous_tasks cascade');
    await db.query('select public.ivx_autonomous_tasks_create_batch($1::jsonb)', [JSON.stringify([
      fixture('inspection', `module-audit:${sha}:file`, 'critical'), fixture('owner', 'owner-repair:urgent', 'low'),
    ])]);
    const invalid = { ...scope, inspectionSourceSha: sha.slice(0, 7) };
    assert.equal((await claim(invalid)).task?.taskId, 'owner', 'invalid revisions cannot admit inspections');
    await complete('owner');
    assert.equal((await claim(invalid)).task, null);
    await db.query("update public.ivx_autonomous_tasks set state='RUNNING',lease_holder='agent:inspection-scope-proof',worker_instance_id='original-process',lease_expires_at=now()+interval '1 minute' where task_id='inspection'");
    const held = await claim();
    assert.equal(held.task, null);
    assert.equal(held.alreadyActiveTaskId, 'inspection', 'existing ownership is retained before any new selection');
  } finally { await db.query('rollback'); }
  console.log(JSON.stringify({ result: 'PASS', baselineAssertionFailed: true, claimOrder: order,
    historicalPayloadsPreserved: true, invalidRevisionExcluded: true, liveHolderPreserved: true,
    permissionsPreserved: true, repairIdempotent: true }));
} finally { await db.end(); }
