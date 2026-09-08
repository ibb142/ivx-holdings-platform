import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const key = `__ivxAuditStoreTest${Date.now()}`;
const docs = new Map();
globalThis[key] = { docs, failWrites: false, events: [] };
const adapter = `const state = globalThis[${JSON.stringify(key)}];
export const isDurableStoreConfigured = () => true;
export const readDurableJson = async (key, fallback) => structuredClone(state.docs.get(key) ?? fallback);
export const writeDurableJson = async (key, value) => { if (state.failWrites) throw new Error('Simulated database failure'); state.docs.set(key, structuredClone(value)); };
export const appendDurableEvent = async (key, event) => { state.events.push({ key, event }); };`;
const adapterUrl = `data:text/javascript;base64,${Buffer.from(adapter).toString('base64')}`;
const original = await readFile(new URL('../backend/services/ivx-audit-item-store.ts', import.meta.url), 'utf8');
const source = stripTypeScriptTypes(original.replace("from './ivx-durable-store'", `from '${adapterUrl}'`));
const store = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('an audit set is persisted and discoverable with no local state directory', async () => {
  const set = await store.createAuditItemSet('Synthetic private audit');
  assert.equal((await store.getAuditItemSet(set.auditId)).title, set.title);
  assert.ok((await store.listAuditItemSets()).some(s => s.auditId === set.auditId));
  assert.ok([...docs.keys()].some(k => k.endsWith(`${set.auditId}/state.json`)));
});
test('item evidence and status survive independent reads through the durable adapter', async () => {
  const set = await store.createAuditItemSet('Synthetic item evidence');
  await store.upsertAuditItems(set.auditId, [{ number: 1, systemArea: 'test', issue: 'test', verification: '{"receipt":"synthetic-job"}' }]);
  const before = await store.getAuditItemSet(set.auditId);
  await store.updateAuditItemStatus(set.auditId, before.items[0].id, { status: 'in_progress' });
  const after = await store.getAuditItemSet(set.auditId);
  assert.equal(after.items[0].verification, '{"receipt":"synthetic-job"}');
  assert.equal(after.items[0].status, 'in_progress');
});
test('concurrent set creation preserves both index entries in one runtime', async () => {
  const sets = await Promise.all([store.createAuditItemSet('Synthetic A'), store.createAuditItemSet('Synthetic B')]);
  const ids = (await store.listAuditItemSets(100)).map(s => s.auditId);
  for (const set of sets) assert.ok(ids.includes(set.auditId));
});
test('a failed durable write cannot be reported as a successfully saved audit', async () => {
  globalThis[key].failWrites = true;
  try { await assert.rejects(store.createAuditItemSet('Synthetic failed write'), /database failure/); }
  finally { globalThis[key].failWrites = false; }
});
