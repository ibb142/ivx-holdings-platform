import assert from 'node:assert/strict';
import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { ORDER_SEEN_SQL, CHAIN_SNAPSHOT_SQL } from './autonomous-chain-evidence.mjs';

// Disposable CI database only. No production URLs, environment fallbacks or
// application credentials are accepted by this fixture test.
const client = new pg.Client({ host: '127.0.0.1', port: 5432, user: 'postgres', password: 'postgres',
  database: 'phase4_chain_contracts', connectionTimeoutMillis: 5_000, query_timeout: 6_000 });
client.on('error', () => { process.exitCode = 1; });
const room = '11111111-1111-4111-8111-111111111111';
const token = 'audit-contract-fixture-token';
const message = `Authorized repair\nAudit tracking token: ${token}`;
const input = { ownerId: 'owner-fixture', conversationId: room, sourceChatMessageId: 'request-fixture', goal: message };
const job = { jobId: 'job-fixture-1', ownerId: input.ownerId, input };
const queueKey = 'senior-developer-worker/queue.json';
const receiptKey = 'owner-chat-requests/fixture';
const params = [input.sourceChatMessageId, input.ownerId, room, message, receiptKey];
const seen = async () => (await client.query(ORDER_SEEN_SQL, [token, room])).rows[0].seen;
const snapshot = async () => (await client.query(CHAIN_SNAPSHOT_SQL, params)).rows[0];
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query("SET LOCAL statement_timeout = '4s'");
  await client.query(`CREATE TABLE public.ivx_messages (id bigint generated always as identity primary key,
    conversation_id uuid, sender_role text, body text);
    CREATE TABLE public.ivx_durable_documents (doc_key text primary key, value jsonb);`);
  await client.query(await readFile(new URL('../supabase/migrations/20260912224306_owner_message_preflight_index.sql', import.meta.url), 'utf8'));
  await client.query("SET LOCAL statement_timeout = '4s'");
  // A representative single-conversation history must use the token index,
  // without planner hints or changing the production query's deadline.
  await client.query(`INSERT INTO public.ivx_messages (conversation_id,sender_role,body)
    SELECT $1::uuid, CASE WHEN n % 4 = 0 THEN 'owner' ELSE 'assistant' END,
      repeat(md5(n::text), 24) FROM generate_series(1,33000) n`, [room]);
  // Include the retained queue and archives when checking the plan. An empty
  // document table misses the UNION/EXISTS row estimates seen in production.
  await client.query(`INSERT INTO public.ivx_durable_documents (doc_key,value)
    SELECT 'senior-developer-worker/archive/fixture-' || n || '/hash.json',
      jsonb_build_object('job',jsonb_build_object('input',jsonb_build_object('goal',repeat(md5(n::text),24))))
    FROM generate_series(1,600) n`);
  await client.query(`INSERT INTO public.ivx_durable_documents (doc_key,value)
    SELECT $1, jsonb_build_object('jobs',jsonb_agg(jsonb_build_object('input',jsonb_build_object('goal',md5(n::text)))))
    FROM generate_series(1,275) n`, [queueKey]);
  await client.query('ANALYZE public.ivx_messages');
  await client.query('ANALYZE public.ivx_durable_documents');
  const explain = (await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + ORDER_SEEN_SQL, [token, room])).rows[0]['QUERY PLAN'][0];
  const nodes = [];
  const visit = plan => { nodes.push(plan); for (const child of plan.Plans ?? []) visit(child); };
  visit(explain.Plan);
  assert.ok(nodes.some(node => node['Index Name'] === 'idx_ivx_messages_owner_body_trgm'), 'Token preflight must use its partial index');
  assert.equal(nodes.some(node => node['Node Type'] === 'Seq Scan' && node['Relation Name'] === 'ivx_messages'), false);
  console.log(JSON.stringify({ fixtureRows: 33000, archivedJobs: 600, queuedJobs: 275,
    tokenIndexUsed: true, executionMs: explain['Execution Time'] }));
  await client.query('DELETE FROM public.ivx_messages');
  await client.query('DELETE FROM public.ivx_durable_documents');
  // LIKE metacharacters stay literal, and only Owner rows in this conversation
  // count. Queue/archive branches retain their existing literal strpos checks.
  for (const special of ['literal_under_score', 'literal%percent', 'literal!escape', String.raw`literal\backslash`]) {
    const lookalike = special.replace(/[_%!\\]/g, 'X');
    await client.query('INSERT INTO public.ivx_messages (conversation_id,sender_role,body) VALUES ($1,\'owner\',$2), ($1,\'assistant\',$3), ($4,\'owner\',$3)',
      [room, lookalike, special, '22222222-2222-4222-8222-222222222222']);
    assert.equal((await client.query(ORDER_SEEN_SQL, [special, room])).rows[0].seen, false);
    await client.query('INSERT INTO public.ivx_messages (conversation_id,sender_role,body) VALUES ($1,\'owner\',$2)', [room, 'prefix ' + special + ' suffix']);
    assert.equal((await client.query(ORDER_SEEN_SQL, [special, room])).rows[0].seen, true);
    await client.query('DELETE FROM public.ivx_messages');
  }
  assert.equal(await seen(), false);
  assert.deepEqual(await snapshot(), { jobIds: [], ownerMessageCount: 0, receipt: null });
  await client.query('INSERT INTO public.ivx_messages (conversation_id,sender_role,body) VALUES ($1,$2,$3)', [room, 'owner', message]);
  assert.equal(await seen(), true);
  await client.query('INSERT INTO public.ivx_durable_documents VALUES ($1,$2)', [queueKey, JSON.stringify({ jobs: [job] })]);
  const receipt = { state: 'completed', identity: { ownerId: input.ownerId, conversationId: room,
    requestId: input.sourceChatMessageId }, response: { status: 202, body: JSON.stringify({ executionStatus: { taskId: job.jobId } }) } };
  await client.query('INSERT INTO public.ivx_durable_documents VALUES ($1,$2)', [receiptKey, JSON.stringify(receipt)]);
  const first = await snapshot();
  assert.deepEqual(first.jobIds, [job.jobId]);
  assert.equal(first.ownerMessageCount, 1);
  assert.equal(first.receipt.status, 202);
  assert.equal(first.receipt.body, receipt.response.body);
  await client.query('INSERT INTO public.ivx_durable_documents VALUES ($1,$2)',
    ['senior-developer-worker/archive/job-fixture-1/hash.json', JSON.stringify({ job })]);
  assert.deepEqual((await snapshot()).jobIds, [job.jobId]); // Archived copies are not new jobs.
  const duplicate = { ...job, jobId: 'job-fixture-2' };
  await client.query('UPDATE public.ivx_durable_documents SET value=$2 WHERE doc_key=$1',
    [queueKey, JSON.stringify({ jobs: [duplicate, { ...job, jobId: 'other-owner', ownerId: 'other' }] })]);
  assert.deepEqual((await snapshot()).jobIds.sort(), [job.jobId, duplicate.jobId]);
  await client.query('INSERT INTO public.ivx_messages (conversation_id,sender_role,body) VALUES ($1,$2,$3)', [room, 'owner', message]);
  assert.equal((await snapshot()).ownerMessageCount, 2);
  await client.query('DELETE FROM public.ivx_messages');
  assert.equal(await seen(), true); // Queue alone prevents resubmission.
  await client.query('DELETE FROM public.ivx_durable_documents WHERE doc_key=$1', [queueKey]);
  assert.equal(await seen(), true); // Archive alone prevents resubmission.
  console.log('PostgreSQL chain queries passed: empty, persisted, duplicate, owner isolation and archive cases.');
} finally {
  try { await client.query('ROLLBACK'); } finally { await client.end(); }
}
