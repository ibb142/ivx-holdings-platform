import assert from 'node:assert/strict';
import { Client } from 'pg';
import { buildAutonomousPlanningPageQuery } from '../backend/services/ivx-autonomous-planning-query';

type Row = { task_id: string; idempotency_key: string | null; assigned_agent_number: number | null; state: string; created_at: string };
type Database = { query: (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }> };
const current = 'b'.repeat(40);
const old = 'a'.repeat(40);
const families = ['landing-p0:', 'landing-p0-repair:', 'landing-p0-patrol:', 'module-audit:', 'autonomous-secondary:'];
const started = ['LEASED', 'RUNNING', 'PAUSED', 'EXECUTION_COMPLETED', 'QA_IN_PROGRESS', 'READY_FOR_DEPLOYMENT', 'DEPLOYING', 'DEPLOYED', 'PRODUCTION_VERIFYING'];

function baseline(sha: string | undefined, cursor?: { createdAt: string; taskId: string }, limit = 1000) {
  return {
    text: `SELECT task_id, idempotency_key, assigned_agent_number, state, created_at::text AS created_at
      FROM public.ivx_autonomous_tasks
      WHERE ($1::timestamptz IS NULL OR (created_at, task_id) > ($1::timestamptz, $2::text))
      ${sha === undefined ? '' : `AND (NOT (idempotency_key LIKE ANY($4::text[]))
        OR idempotency_key LIKE ANY($5::text[]) OR state = ANY($6::text[])
        OR (lease_holder IS NOT NULL AND (state = 'QUEUED' OR lease_expires_at IS NULL OR lease_expires_at > now())))`}
      ORDER BY ivx_autonomous_tasks.created_at, task_id LIMIT $3`,
    values: [cursor?.createdAt ?? null, cursor?.taskId ?? null, limit,
      ...(sha === undefined ? [] : [families.map(p => `${p}%`), families.map(p => `${p}${sha}:%`), started])],
  };
}

// The caller must provide an isolated, empty test database. Production is never
// used for fixture creation; the command-line entry point enforces localhost.
export async function verifyAutonomousPlanningQueries(db: Database) {
  await db.query(`CREATE TABLE public.ivx_autonomous_tasks (
    task_id text PRIMARY KEY, idempotency_key text, assigned_agent_number integer,
    state text NOT NULL, created_at timestamptz NOT NULL, lease_holder text,
    lease_expires_at timestamptz, payload jsonb NOT NULL DEFAULT '{"evidence":"preserve"}'
  )`);
  await db.query(`INSERT INTO public.ivx_autonomous_tasks
    (task_id,idempotency_key,assigned_agent_number,state,created_at,lease_holder,lease_expires_at)
    SELECT 'fixture-' || lpad(i::text,6,'0'),
      CASE i % 8
        WHEN 0 THEN 'owner:objective:' || i
        WHEN 1 THEN 'landing-p0:${current}:' || i
        WHEN 2 THEN 'module-audit:${old}:' || i
        WHEN 3 THEN 'autonomous-secondary:${current}:' || i
        WHEN 4 THEN 'landing-p0-patrol:${old}:' || i
        WHEN 5 THEN 'landing-p0;not-a-mission:' || i
        WHEN 6 THEN 'module-audit;unicode-ñ:' || i
        ELSE NULL END,
      1 + i % 112,
      (ARRAY['QUEUED','VERIFIED','PAUSED','FAILED','RUNNING','CANCELLED','EXPIRED','RECEIVED'])[1+i%8],
      '2026-01-01 00:00:00+00'::timestamptz + (i%1700) * interval '1 microsecond',
      CASE WHEN i%11=0 THEN 'worker-' || i END,
      CASE WHEN i%11<>0 OR i%5=0 THEN NULL WHEN i%5=1 THEN now()+interval '1 day' ELSE now()-interval '1 day' END
    FROM generate_series(1,4200) AS i`);
  const edges: Array<[string, string | null, string, string | null, string | null]> = [
    ['expired-queued', `module-audit:${old}:held`, 'QUEUED', 'worker', '2000-01-01'],
    ['missing-expiry', `module-audit:${old}:unknown`, 'FAILED', 'worker', null],
    ['future-terminal', `module-audit:${old}:future`, 'VERIFIED', 'worker', '2100-01-01'],
    ['expired-terminal', `module-audit:${old}:past`, 'VERIFIED', 'worker', '2000-01-01'],
    ['old-paused', `module-audit:${old}:paused`, 'PAUSED', null, null],
    ['old-unheld', `module-audit:${old}:unheld`, 'QUEUED', null, null],
    ['overlap', `landing-p0:${current}:overlap`, 'RUNNING', 'worker', '2100-01-01'],
    ['empty-key', '', 'CANCELLED', null, null],
    ['unicode-key', 'é-owner:objective', 'EXPIRED', null, null],
    ['null-active', null, 'RUNNING', null, null],
    ['quoted-id', 'owner:literal', 'VERIFIED', null, null],
  ];
  for (const [id,key,state,holder,expiry] of edges) {
    await db.query(`INSERT INTO public.ivx_autonomous_tasks
      (task_id,idempotency_key,state,created_at,lease_holder,lease_expires_at)
      VALUES ($1,$2,$3,'2026-01-01 00:00:00.000001+00',$4,$5)`,
      [id === 'quoted-id' ? "quoted-'-$-id" : id,key,state,holder,expiry]);
  }
  for (const sql of [
    'CREATE INDEX planning_cover ON public.ivx_autonomous_tasks(created_at,task_id) INCLUDE(idempotency_key,assigned_agent_number,state,lease_holder,lease_expires_at)',
    'CREATE INDEX mission_identity ON public.ivx_autonomous_tasks(idempotency_key text_pattern_ops)',
    'CREATE INDEX mission_planning ON public.ivx_autonomous_tasks(idempotency_key text_pattern_ops,created_at,task_id) INCLUDE(assigned_agent_number,state)',
    'CREATE INDEX state_index ON public.ivx_autonomous_tasks(state)',
    'CREATE INDEX lease_index ON public.ivx_autonomous_tasks(state,lease_expires_at) WHERE lease_holder IS NOT NULL',
    "CREATE INDEX held_planning ON public.ivx_autonomous_tasks((CASE WHEN state='QUEUED' OR lease_expires_at IS NULL THEN 'infinity'::timestamptz ELSE lease_expires_at END)) INCLUDE(task_id,idempotency_key,assigned_agent_number,state,created_at,lease_expires_at,lease_holder) WHERE lease_holder IS NOT NULL",
    'CREATE STATISTICS planning_lease_mcv (mcv) ON state,(lease_holder IS NOT NULL),(lease_expires_at IS NULL) FROM public.ivx_autonomous_tasks',
    'ANALYZE public.ivx_autonomous_tasks',
  ]) await db.query(sql);
  const fingerprintSql = "SELECT md5(string_agg(to_jsonb(t)::text, ',' ORDER BY task_id)) AS fingerprint FROM public.ivx_autonomous_tasks t";
  const before = (await db.query(fingerprintSql)).rows;
  let pagesVerified = 0;
  for (const sha of [current, current.toUpperCase(), old, 'c'.repeat(40), undefined]) {
    let cursor: { createdAt: string; taskId: string } | undefined;
    const ids: string[] = [];
    for (let page=0;page<30;page++) {
      const expected = baseline(sha,cursor,1000);
      const actual = buildAutonomousPlanningPageQuery(sha,cursor,1000);
      const expectedRows = (await db.query(expected.text,expected.values)).rows as Row[];
      const actualRows = (await db.query(actual.text,actual.values)).rows as Row[];
      assert.deepEqual(actualRows,expectedRows,`ordered page ${page}, SHA ${sha}`);
      pagesVerified++;
      ids.push(...actualRows.map(row=>row.task_id));
      if (actualRows.length<1000) break;
      const last=actualRows[actualRows.length-1];
      cursor={createdAt:last.created_at,taskId:last.task_id};
      assert.ok(page<29,'pagination must finish');
    }
    assert.equal(new Set(ids).size,ids.length,'overlapping branches must not duplicate tasks');
    if (sha===current) {
      for (const id of ['expired-queued','missing-expiry','future-terminal','old-paused','overlap','empty-key','unicode-key','null-active',"quoted-'-$-id"]) assert.ok(ids.includes(id),id);
      for (const id of ['expired-terminal','old-unheld']) assert.ok(!ids.includes(id),id);
    }
  }
  for (const limit of [1,7,37]) {
    const cursor={createdAt:'2026-01-01 00:00:00.000001+00',taskId:"quoted-'-$-id"};
    const expected=baseline(current,cursor,limit);
    const actual=buildAutonomousPlanningPageQuery(current,cursor,limit);
    assert.deepEqual((await db.query(actual.text,actual.values)).rows,(await db.query(expected.text,expected.values)).rows);
    pagesVerified++;
  }
  assert.deepEqual((await db.query(fingerprintSql)).rows,before,'planning must not change tasks or evidence');
  assert.throws(()=>buildAutonomousPlanningPageQuery("'; SELECT 1;--"));
  for (const size of [0,-1,1001,1.5,NaN]) assert.throws(()=>buildAutonomousPlanningPageQuery(current,undefined,size));
  return {passed:true,pagesVerified,fixtures:4211,evidenceUnchanged:true};
}

if (import.meta.main) {
  const value=process.env.IVX_PLANNING_TEST_DATABASE_URL;
  if (!value) throw new Error('IVX_PLANNING_TEST_DATABASE_URL is required');
  const url=new URL(value);
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || url.pathname!=='/ivx_planning_test') throw new Error('Isolated local planning test database required');
  const db=new Client({connectionString:value});
  await db.connect();
  try { console.log(JSON.stringify(await verifyAutonomousPlanningQueries(db))); }
  finally { await db.end(); }
}
