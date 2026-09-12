import assert from 'node:assert/strict';
import pg from 'pg';
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
