import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import pg from 'pg';
import { ownerChatRequestKey, runOwnerChatOnce, reconcileOwnerChatRequest, type ChatRequestRecord, type ChatRequestStore } from '../backend/services/ivx-owner-chat-admission';

interface Database {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

/** Real SQL counterpart of the indexed PostgREST INSERT/read/CAS operations. */
function storeFor(db: Database): ChatRequestStore {
  return {
    async insert(key, record) {
      try {
        await db.query('insert into public.ivx_durable_documents(doc_key,value) values ($1,$2::jsonb)', [key, JSON.stringify(record)]);
        return true;
      } catch (error) { if ((error as { code?: string }).code === '23505') return false; throw error; }
    },
    async read(key) {
      const result = await db.query('select value from public.ivx_durable_documents where doc_key=$1 limit 1', [key]);
      return (result.rows[0]?.value as ChatRequestRecord | undefined) ?? null;
    },
    async complete(key, token, record) {
      const result = await db.query("update public.ivx_durable_documents set value=$3::jsonb,updated_at=now() where doc_key=$1 and value->>'token'=$2 and value->>'state'='running' returning doc_key", [key, token, JSON.stringify(record)]);
      return result.rows.length === 1;
    },
  };
}

export async function proveOwnerChatAdmission(a: Database, b: Database): Promise<Record<string, unknown>> {
  const owner = `isolated-fixture-${randomUUID()}`;
  const keyFor = (id: string) => ownerChatRequestKey(owner, 'fixture-chat', id);
  const keys: string[] = [];
  await a.query('create table if not exists public.ivx_durable_documents(doc_key text primary key,value jsonb,updated_at timestamptz default now())');
  try {
    let providerCalls = 0; let release!: () => void; let entered!: () => void;
    const running = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const input = { key: keyFor('concurrent'), requestId: 'concurrent', fingerprint: 'fixture-concurrent' };
    keys.push(input.key);
    const execute = async () => { providerCalls++; entered(); await gate; return Response.json({ status: 'ok', answer: 'saved once', assistantMessageId: 'message-1', assistantPersisted: true }); };
    const first = runOwnerChatOnce({ ...input, store: storeFor(a), execute });
    await running;
    const competing = await runOwnerChatOnce({ ...input, store: storeFor(b), execute });
    assert.equal(competing.status, 409);
    release();
    const firstBody = await (await first).text();
    const replay = await runOwnerChatOnce({ ...input, store: storeFor(b), execute });
    assert.equal(await replay.text(), firstBody);
    assert.equal(providerCalls, 1);
    const recovered = await reconcileOwnerChatRequest(storeFor(b), input.key, 'owner-request:concurrent');
    assert.equal(recovered?.assistantMessageId, 'message-1');
    assert.equal(recovered?.answer, 'saved once');

    for (const operation of ['insert', 'complete'] as const) {
      const key = keyFor(`lost-${operation}`); keys.push(key);
      const store = storeFor(a);
      const underlying = store[operation].bind(store);
      if (operation === 'insert') {
        store.insert = async (k, record) => { await (underlying as ChatRequestStore['insert'])(k, record); throw new Error('injected lost insert acknowledgement'); };
      } else {
        store.complete = async (k, token, record) => { await (underlying as ChatRequestStore['complete'])(k, token, record); throw new Error('injected lost completion acknowledgement'); };
      }
      let calls = 0;
      const executeOnce = async () => { calls++; return Response.json({ answer: operation }); };
      const request = { key, requestId: operation, fingerprint: operation, execute: executeOnce };
      assert.equal((await runOwnerChatOnce({ ...request, store })).status, 200);
      assert.equal((await runOwnerChatOnce({ ...request, store: storeFor(b) })).status, 200);
      assert.equal(calls, 1);
    }

    const crashKey = keyFor('crash'); keys.push(crashKey);
    await storeFor(a).insert(crashKey, { version: 1, fingerprint: 'crash', token: 'previous-process', state: 'running', startedAt: '2000-01-01T00:00:00Z' });
    const blocked = await runOwnerChatOnce({ key: crashKey, requestId: 'crash', fingerprint: 'crash', store: storeFor(b), execute: async () => { throw new Error('must never run'); } });
    assert.equal(blocked.status, 409);
    assert.equal(await storeFor(b).complete(crashKey, 'wrong-token', { version: 1, fingerprint: 'crash', token: 'wrong-token', state: 'completed', startedAt: '2000-01-01T00:00:00Z' }), false);
    return { verification: 'PASS', scope: 'isolated SQL admission; no production provider or owner session',
      checks: ['competing admissions, one executor', 'exact terminal replay', 'lost insert acknowledgement', 'lost completion acknowledgement', 'restart without unsafe takeover', 'completion token fencing', 'original message link'],
      providerCallsForConcurrentMessage: providerCalls, productionRowsTouched: 0 };
  } finally {
    for (const key of keys) await a.query('delete from public.ivx_durable_documents where doc_key=$1', [key]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.IVX_HA_TEST_DATABASE_URL;
  const url = new URL(connectionString ?? 'postgres://invalid/');
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.pathname !== '/ivx_ha_test') throw new Error('Local ivx_ha_test database required');
  const a = new pg.Client({ connectionString, query_timeout: 5000 }), b = new pg.Client({ connectionString, query_timeout: 5000 });
  await Promise.all([a.connect(), b.connect()]);
  try {
    const report = { ...await proveOwnerChatAdmission(a, b), engine: 'PostgreSQL', independentConnections: 2 };
    await mkdir('qa/evidence/fleet-ha', { recursive: true });
    await writeFile('qa/evidence/fleet-ha/owner-chat-admission.json', JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report));
  } finally { await Promise.all([a.end(), b.end()]); }
}
