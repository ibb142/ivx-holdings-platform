import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { UPGRADE_TASK_QUERY, UPGRADE_LOG_QUERY, UPGRADE_LOG_KEY, summarizeUpgradeAudit } from '../scripts/ops/audit-quantum-upgrade.mjs';
const require = createRequire(import.meta.url);
const { PGlite } = require(process.env.IVX_PGLITE_MODULE || '@electric-sql/pglite');

test('bounded SQL distinguishes keyword matches, malformed evidence and recorded claims without changing rows', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table public.ivx_autonomous_tasks (
      task_id text primary key, state text, version bigint, assigned_agent_number int,
      lease_expires_at timestamptz, last_heartbeat_at timestamptz,
      created_at timestamptz, updated_at timestamptz, payload jsonb);
      create index on public.ivx_autonomous_tasks(created_at, task_id);
      create table public.ivx_durable_documents (doc_key text primary key, value jsonb, updated_at timestamptz);`);
    const fixtures = [
      ['old-quantum', { state: 'VERIFIED' }],
      ['staging', { title: 'Fix pagination and imagination counters' }],
      ['irrelevant', { title: 'ordinary repairs' }],
      ['agi-no-evidence', {}],
      ['self_upgrade-legacy', { state: 'QUEUED', evidence: [{ step: 'test', status: 'passed', timestamp: '2026-09-13T00:00:00Z', output: 'PRIVATE_OUTPUT' }] }],
      ['agi-malformed', { evidence: '{broken-json' }],
      ['quantum-latest', { state: 'FAILED', evidence: Array.from({ length: 25 }, (_, i) => ({ evidenceId: 'evid-' + i,
        evidenceType: 'test_result', createdAt: '2026-09-13T00:00:00Z', commitSha: 'a'.repeat(40),
        contentHash: 'b'.repeat(64), source: 'PRIVATE_SOURCE', summary: 'PRIVATE_SUMMARY' })) }],
    ];
    for (let i = 0; i < fixtures.length; i++) {
      const [id, payload] = fixtures[i];
      await db.query(`insert into public.ivx_autonomous_tasks values ($1,'FAILED',$2,7,null,null,$3,$3,$4)`,
        [id, i === 6 ? '9007199254740993' : i === 0 ? '999999999999999999' : String(i + 1),
          new Date(Date.UTC(2026,8,13,0,i)).toISOString(), JSON.stringify(payload)]);
    }
    await db.query('insert into public.ivx_durable_documents values ($1,$2,now())',
      [UPGRADE_LOG_KEY, JSON.stringify([{ upgradeId: 'recorded-upgrade', timestamp: '2026-09-09T00:00:00Z',
        success: true, verified10of10: true, capabilityScoreOutOf10: 10, summary: 'PRIVATE_SUMMARY', proofHash: 'c'.repeat(16) }])]);
    const before = (await db.query('select task_id,version::text,payload from public.ivx_autonomous_tasks order by task_id')).rows;
    await db.exec('begin read only');
    const tasks = (await db.query(UPGRADE_TASK_QUERY, [6])).rows[0];
    const dailyLog = (await db.query(UPGRADE_LOG_QUERY, [UPGRADE_LOG_KEY])).rows[0];
    await db.exec('commit');
    const report = summarizeUpgradeAudit({ tasks: { status: 'OBSERVED', data: tasks }, dailyLog: { status: 'OBSERVED', data: dailyLog } }, 6);
    assert.equal(tasks.sampled_tasks, 6); assert.equal(tasks.older_tasks_unscanned, true);
    assert.equal(tasks.matches_in_sample, 4);
    assert.deepEqual(tasks.tasks.map(task => task.task_id), ['quantum-latest','agi-malformed','self_upgrade-legacy','agi-no-evidence']);
    assert.equal(tasks.tasks[0].version, '9007199254740993');
    assert.equal(tasks.tasks[0].evidence_count, 25); assert.equal(tasks.tasks[0].evidence_preview.length, 20);
    assert.equal(tasks.tasks[0].evidence_preview_truncated, true);
    assert.equal(tasks.tasks[0].evidence_preview[0].evidence_type, 'test_result');
    assert.equal(tasks.tasks[1].evidence_review, 'INVALID_EVIDENCE_FORMAT');
    assert.equal(tasks.tasks[2].evidence_preview[0].format, 'legacy');
    assert.equal(tasks.tasks[2].state_consistent, false);
    assert.equal(tasks.tasks[3].evidence_review, 'NO_EMBEDDED_EVIDENCE');
    assert.equal(dailyLog.entries[0].reported_success, true);
    assert.equal(report.upgradeVerified, false);
    assert.equal(JSON.stringify(report).includes('PRIVATE'), false);
    assert.deepEqual((await db.query('select task_id,version::text,payload from public.ivx_autonomous_tasks order by task_id')).rows, before);
    await db.exec('delete from public.ivx_autonomous_tasks; delete from public.ivx_durable_documents;');
    const empty = (await db.query(UPGRADE_TASK_QUERY, [6])).rows[0];
    assert.equal(empty.matches_in_sample, 0); assert.equal(empty.older_tasks_unscanned, false);
    assert.deepEqual(empty.tasks, []);
    const missing = (await db.query(UPGRADE_LOG_QUERY, [UPGRADE_LOG_KEY])).rows[0];
    assert.equal(missing.document_found, false); assert.deepEqual(missing.entries, []);
  } finally { await db.close(); }
});
