import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { collect, decryptOwnerToken, extractRows, JOBS, logUrl, PROJECT, scopedGet, summarizeRow } from './phase2-item43-native-logs.mjs';

test('rejects restart, arbitrary SQL, another project and redirects', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; throw new Error('must not call'); };
  for (const url of [`https://api.supabase.com/v1/projects/${PROJECT}/restart`, logUrl(0).replace(PROJECT, 'otherproject'), logUrl(0).replace('select+', 'delete+')]) {
    await assert.rejects(scopedGet(url, 'fixture-token', fetchImpl), /request_out_of_scope/);
  }
  assert.equal(called, false);
  await scopedGet(logUrl(0), 'fixture-token', async (_, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer fixture-token');
    return { ok: true, json: async () => ({ result: [] }) };
  });
});

test('does not publish SQL, secrets, IPs, arbitrary timestamps or assert causal attribution', () => {
  const row = { event_time: 'private@example.test', event_message: 'canceling statement due to statement timeout', metadata: [{ query: `secret=fixture-secret, ip=192.0.2.1, ${JOBS[0]}, senior-developer-worker/queue.json` }] };
  const summary = summarizeRow(row);
  assert.deepEqual(summary.errorClasses, ['statement_timeout']);
  assert.deepEqual(summary.matchingJobIds, [JOBS[0]]);
  assert.equal(summary.eventTime, null);
  assert.equal(summary.causalAttribution, 'NOT_ESTABLISHED_BY_THIS_RECORD_MATCH');
  for (const text of ['fixture-secret', '192.0.2.1', 'private@example.test', 'query']) assert.equal(JSON.stringify(summary).includes(text), false);
});

test('native empty windows and truncation remain distinct from historical acceptance', async () => {
  const calls = [];
  const proof = await collect({ SUPABASE_ACCESS_TOKEN: 'fixture-token' }, async (url, init) => {
    calls.push({ url, method: init.method });
    return { ok: true, json: async () => ({ result: calls.length === 2 ? Array.from({ length: 1000 }, () => ({ event_time: '2026-09-11 00:57:30', event_message: 'routine' })) : [] }) };
  });
  assert.equal(calls.length, 3); assert.ok(calls.every(call => call.method === 'GET'));
  assert.equal(proof.retrievalStatus, 'ROW_LIMIT_REACHED');
  assert.equal(proof.windows[0].rowCount, 0); assert.equal(proof.windows[1].completeWithinLimit, false);
  assert.equal(proof.historicalAcceptance, 'OPEN_PARTIAL');
  assert.equal(JSON.stringify(proof).includes('fixture-token'), false);
});

test('accepts only configured encryption keys with GCM authentication and hash integrity', () => {
  const configured = 'fixture-configured-key'; const plaintext = 'fixture-owner-token'; const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', createHash('sha256').update(configured).digest(), iv);
  cipher.setAAD(Buffer.from('ivx_owner_variables:v1'));
  const row = { encrypted_value: Buffer.concat([cipher.update(plaintext), cipher.final()]).toString('base64'), value_iv: iv.toString('base64'), value_tag: cipher.getAuthTag().toString('base64'), value_hash: createHash('sha256').update(plaintext).digest('hex') };
  assert.equal(decryptOwnerToken(row, { APP_SECRET: configured }), plaintext);
  assert.throws(() => decryptOwnerToken(row, { APP_SECRET: 'wrong' }), /decryption_unavailable/);
  assert.throws(() => decryptOwnerToken({ ...row, value_hash: 'invalid' }, { APP_SECRET: configured }), /decryption_unavailable/);
});

test('denials and malformed analytics responses cannot become empty success', async () => {
  await assert.rejects(scopedGet(logUrl(0), 'fixture', async () => ({ ok: false, status: 402 })), /read_http_402/);
  await assert.rejects(scopedGet(logUrl(0), 'fixture', async () => { throw new Error('secret-token'); }), /^Error: read_request_failed$/);
  assert.throws(() => extractRows({ error: 'private error text', result: [] }), /analytics_query_error/);
  assert.throws(() => extractRows({ unexpected: [] }), /analytics_shape_unrecognized/);
});
