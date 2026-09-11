import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedDefinition, repairPendingExecutionIndex, sessionConnection, main } from './pending-execution-index.mjs';

function fixture({ valid = false, definition = expectedDefinition, competing = false, acquired = true } = {}) {
  let index = { indisvalid: valid, indisready: valid, definition };
  const statements = [];
  return { statements, query: async (text) => {
    statements.push(text);
    if (text.includes('pg_try_advisory_lock')) return { rows: [{ acquired }] };
    if (text.includes('pg_advisory_unlock')) return { rows: [{ pg_advisory_unlock: true }] };
    if (text.includes('pg_get_indexdef')) return { rows: index ? [index] : [] };
    if (text.includes('pg_stat_progress_create_index')) return { rows: competing ? [{ pid: 99 }] : [] };
    if (text.startsWith('DROP INDEX CONCURRENTLY')) { index = null; return { rows: [] }; }
    if (text.includes('CREATE INDEX CONCURRENTLY')) { index = { indisvalid: true, indisready: true, definition: expectedDefinition }; return { rows: [] }; }
    throw new Error('unexpected statement');
  } };
}

test('an interrupted build is replaced concurrently and verified before success', async () => {
  const db = fixture();
  assert.equal((await repairPendingExecutionIndex(db)).status, 'rebuilt_invalid');
  assert.equal(db.statements.filter(s => s.startsWith('DROP INDEX CONCURRENTLY')).length, 1);
  assert.equal(db.statements.filter(s => s.includes('CREATE INDEX CONCURRENTLY')).length, 1);
  assert.ok(db.statements.at(-1).includes('pg_advisory_unlock'));
});

test('a valid exact index is idempotent and unrelated definitions are preserved', async () => {
  const valid = fixture({ valid: true });
  assert.equal((await repairPendingExecutionIndex(valid)).status, 'already_valid');
  assert.ok(!valid.statements.some(s => /DROP INDEX|CREATE INDEX/.test(s)));
  const other = fixture({ definition: 'different index' });
  await assert.rejects(repairPendingExecutionIndex(other), /index_definition_mismatch/);
  assert.ok(!other.statements.some(s => /DROP INDEX|CREATE INDEX/.test(s)));
  assert.ok(other.statements.at(-1).includes('pg_advisory_unlock'));
});

test('concurrent maintenance is refused without dropping or rebuilding its index', async () => {
  for (const settings of [{ competing: true }, { acquired: false }]) {
    const db = fixture(settings);
    await assert.rejects(repairPendingExecutionIndex(db), /index_maintenance_already_running/);
    assert.ok(!db.statements.some(s => /DROP INDEX|CREATE INDEX/.test(s)));
  }
});

test('only verified same-project session connections can carry maintenance state', () => {
  const own = 'postgresql://postgres.kvclcdjmjghndxsngfzb:synthetic@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
  const session = sessionConnection(own);
  assert.equal(session.port,5432);
  assert.equal(session.ssl.rejectUnauthorized,true);
  assert.equal(session.query_timeout,0);
  assert.equal(session.statement_timeout,1800000);
  assert.equal(sessionConnection(own.replace('postgres.kvclcdjmjghndxsngfzb','postgres.other')),null);
  assert.equal(sessionConnection(own.replace('.pooler.supabase.com','.attacker.example')),null);
  assert.equal(sessionConnection(own.replace('/postgres','/other')),null);
});

test('local invocation cannot obtain production credentials or apply DDL', async () => {
  const saved = process.env.IVX_APPLY_PENDING_INDEX;
  delete process.env.IVX_APPLY_PENDING_INDEX;
  try { await assert.rejects(main(), /production_workflow_authority_required/); }
  finally { if (saved !== undefined) process.env.IVX_APPLY_PENDING_INDEX=saved; }
});
