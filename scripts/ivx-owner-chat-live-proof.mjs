import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const api = 'https://api.ivxholding.com';
const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const proof = { sourceSha: sha, startedAt: new Date().toISOString(), passed: false,
  scope: 'production owner authentication, request receipts, JSON/SSE and replica replay',
  phase4Certified: false, chatHistoryCertified: false, restartCertified: false,
  checks: [], requests: [], instances: [], error: null };
let token;
const instances = new Set();
const hash = text => createHash('sha256').update(text).digest('hex');
function requireEvidence(response) {
  assert.equal(response.headers.get('x-ivx-serving-commit'), sha, 'RESPONSE_RELEASE_MISMATCH');
  const instance = response.headers.get('x-ivx-serving-instance');
  assert.match(instance || '', /^[a-f0-9-]{36}$/, 'RESPONSE_INSTANCE_UNAVAILABLE');
  instances.add(instance);
  return instance;
}
async function json(url, init = {}, authenticated = true) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(75_000),
    headers: { 'content-type': 'application/json', connection: 'close',
      ...(authenticated ? { authorization: `Bearer ${token}` } : {}), ...init.headers } });
  const text = await response.text();
  return { response, text, body: JSON.parse(text) };
}
async function chat(body) {
  const result = await json(`${api}/api/ivx/owner-ai`, { method: 'POST', body: JSON.stringify(body) });
  const instance = requireEvidence(result.response);
  proof.requests.push({ requestId: body.requestId, route: 'owner-ai', instance,
    httpStatus: result.response.status, code: result.body.code || null,
    replayed: result.response.headers.get('x-ivx-request-replayed') === 'true', responseHash: hash(result.text) });
  return result;
}
async function stream(path, body) {
  const response = await fetch(api + path, { method: 'POST', signal: AbortSignal.timeout(75_000),
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json',
      accept: 'text/event-stream', connection: 'close' }, body: JSON.stringify(body) });
  assert.equal(response.status, 200, 'STREAM_HTTP_FAILED');
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/, 'STREAM_CONTENT_TYPE_FAILED');
  const instance = requireEvidence(response);
  const events = [], decoder = new TextDecoder();
  let buffered = '';
  for await (const chunk of response.body) {
    buffered += decoder.decode(chunk, { stream: true });
    let boundary;
    while ((boundary = buffered.indexOf('\n\n')) !== -1) {
      const event = buffered.slice(0, boundary); buffered = buffered.slice(boundary + 2);
      const data = event.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (data) events.push(JSON.parse(data));
    }
  }
  buffered += decoder.decode();
  assert.equal(buffered.trim(), '', 'STREAM_TRUNCATED');
  assert.equal(events.some(event => event.type === 'error'), false, 'STREAM_ERROR');
  proof.requests.push({ requestId: body.requestId, route: path, instance,
    deltas: events.filter(event => event.type === 'delta').length,
    terminalCount: events.filter(event => ['done', 'final'].includes(event.type)).length });
  return events;
}
try {
  const supabase = new URL(process.env.SUPABASE_URL || 'https://invalid/');
  assert.equal(supabase.origin, 'https://kvclcdjmjghndxsngfzb.supabase.co', 'UNEXPECTED_AUTH_PROJECT');
  const password = ['OWNER_NEW_PASSWORD', 'OWNER_PASSWORD', 'IVX_OWNER_PASSWORD', 'IVX_OWNER_NEW_PASSWORD', 'OWNER_LOGIN_PASSWORD', 'IVX_OWNER_LOGIN_PASSWORD']
    .map(name => process.env[name]).find(value => value?.trim());
  assert.ok(password && process.env.SUPABASE_ANON_KEY, 'OWNER_CREDENTIAL_UNAVAILABLE');
  const signedIn = await json(`${supabase.origin}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: process.env.SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: 'iperez4242@gmail.com', password }) }, false);
  assert.equal(signedIn.response.status, 200, 'OWNER_PASSWORD_GRANT_FAILED');
  token = signedIn.body.access_token;
  assert.ok(token, 'OWNER_TOKEN_MISSING');
  const user = await json(`${supabase.origin}/auth/v1/user`, { headers: { apikey: process.env.SUPABASE_ANON_KEY } });
  assert.equal(user.response.status, 200, 'OWNER_TOKEN_VERIFICATION_FAILED');
  assert.equal(user.body.id, signedIn.body.user.id, 'OWNER_IDENTITY_MISMATCH');
  const gate = await json(`${api}/api/ivx/verify/env-status`);
  assert.equal(gate.response.status, 200, 'OWNER_AUTHORIZATION_FAILED');
  assert.equal(gate.body.ok, true, 'OWNER_AUTHORIZATION_NOT_CONFIRMED');
  proof.checks.push('real password grant, token verification and protected owner gate');
  const denied = await json(`${api}/api/ivx/owner-ai`, { method: 'POST', body: '{}' }, false);
  assert.ok([401, 403].includes(denied.response.status), 'UNAUTHENTICATED_OWNER_REQUEST_ACCEPTED');
  proof.checks.push('unauthenticated owner request rejected');

  const requestId = `phase4-live-${randomUUID()}`;
  const suffix = randomUUID().replaceAll('-', '');
  const expected = `north_${suffix}`;
  const request = { requestId, mode: 'chat', message: `Return only the result of joining north_ and ${suffix}.` };
  const racing = await Promise.all([chat(request), chat(request)]);
  const originals = racing.filter(result => result.response.status === 200 && result.response.headers.get('x-ivx-request-replayed') !== 'true');
  assert.equal(originals.length, 1, 'CONCURRENT_REQUEST_NOT_EXECUTED_ONCE');
  const original = originals[0];
  assert.equal(original.body.status, 'ok', 'MODEL_RESPONSE_FAILED');
  assert.equal(original.body.source, 'remote_api', 'MODEL_RESPONSE_NOT_REMOTE');
  assert.equal(original.body.answer.trim(), expected, 'MODEL_ANSWER_INCORRECT');
  assert.equal(original.body.requestId, requestId, 'RESPONSE_IDENTITY_CHANGED');
  for (const result of racing.filter(result => result !== original)) {
    if (result.response.status === 409) assert.equal(result.body.code, 'OWNER_CHAT_REQUEST_PENDING', 'CONCURRENT_FAILURE_NOT_PENDING');
    else { assert.equal(result.response.status, 200, 'CONCURRENT_FAILURE'); assert.equal(result.text, original.text, 'CONCURRENT_REPLAY_CHANGED'); }
  }
  const servingInstances = new Set(racing.map(result => result.response.headers.get('x-ivx-serving-instance')));
  for (let attempt = 0; attempt < 8; attempt++) {
    const replay = await chat(request);
    assert.equal(replay.response.status, 200, 'TERMINAL_REPLAY_FAILED');
    assert.equal(replay.response.headers.get('x-ivx-request-replayed'), 'true', 'TERMINAL_REQUEST_EXECUTED_AGAIN');
    assert.equal(replay.text, original.text, 'TERMINAL_REPLAY_CHANGED');
    servingInstances.add(replay.response.headers.get('x-ivx-serving-instance'));
    if (servingInstances.size >= 2) break;
  }
  assert.ok(servingInstances.size >= 2, 'SECOND_API_REPLICA_NOT_OBSERVED');
  proof.checks.push('one concurrent original and exact terminal replay across two observed API processes');
  const conflict = await chat({ ...request, message: 'Return only the word changed.' });
  assert.equal(conflict.response.status, 409, 'CHANGED_CONTENT_ACCEPTED_FOR_OLD_ID');
  assert.equal(conflict.body.code, 'OWNER_CHAT_IDENTITY_CONFLICT', 'CHANGED_CONTENT_NOT_CLASSIFIED');
  const distinct = await chat({ ...request, requestId: `phase4-live-${randomUUID()}` });
  assert.equal(distinct.response.status, 200, 'NEW_MESSAGE_FAILED');
  assert.notEqual(distinct.body.requestId, requestId, 'NEW_MESSAGE_REUSED_OLD_ID');
  assert.notEqual(distinct.response.headers.get('x-ivx-request-replayed'), 'true', 'NEW_MESSAGE_REPLAYED_OLD_RECEIPT');
  assert.equal(distinct.body.answer.trim(), expected, 'NEW_MESSAGE_ANSWER_INCORRECT');
  proof.checks.push('changed content conflicts; equal text with a new identity executes independently');
  const canonicalReplay = await stream('/api/ivx/owner-ai', request);
  const final = canonicalReplay.filter(event => event.type === 'final');
  assert.equal(final.length, 1, 'CANONICAL_SSE_TERMINAL_COUNT');
  assert.equal(final[0].status, 200, 'CANONICAL_SSE_FAILED');
  assert.equal(final[0].body.answer.trim(), expected, 'CANONICAL_SSE_REPLAY_CHANGED');
  assert.equal(canonicalReplay.filter(event => event.type === 'delta').length, 0, 'CANONICAL_REPLAY_CALLED_PROVIDER');
  const direct = { requestId: `phase4-stream-${randomUUID()}`, prompt: `Return only the result of joining north_ and ${randomUUID().replaceAll('-', '')}.`, maxOutputTokens: 128 };
  const directExpected = direct.prompt.match(/north_ and ([a-f0-9]+)\./)[1];
  const events = await stream('/api/ivx/owner-ai/stream', direct);
  const done = events.filter(event => event.type === 'done');
  assert.equal(done.length, 1, 'DIRECT_STREAM_TERMINAL_COUNT');
  assert.equal(done[0].text.trim(), `north_${directExpected}`, 'DIRECT_STREAM_ANSWER_INCORRECT');
  assert.equal(done[0].receiptPersisted, true, 'DIRECT_STREAM_RECEIPT_MISSING');
  assert.equal(done[0].replayed, false, 'DIRECT_STREAM_FIRST_REQUEST_REPLAYED');
  assert.ok(events.some(event => event.type === 'delta'), 'DIRECT_STREAM_NO_DELTAS');
  const replayEvents = await stream('/api/ivx/owner-ai/stream', direct);
  assert.equal(replayEvents.filter(event => event.type === 'delta').length, 0, 'DIRECT_REPLAY_CALLED_PROVIDER');
  const replayDone = replayEvents.filter(event => event.type === 'done');
  assert.equal(replayDone.length, 1, 'DIRECT_REPLAY_TERMINAL_COUNT');
  assert.equal(replayDone[0].text, done[0].text, 'DIRECT_REPLAY_CHANGED');
  assert.equal(replayDone[0].replayed, true, 'DIRECT_REPLAY_NOT_CONFIRMED');
  proof.checks.push('canonical SSE replay and progressive direct provider stream with durable replay');
  proof.passed = true;
} catch (error) {
  // Never serialize request options, tokens, password grant bodies or raw SDK errors.
  const reason = error?.message || '';
  proof.error = reason.match(/\b[A-Z][A-Z0-9_]{8,}\b/)?.[0] || 'LIVE_ACCEPTANCE_FAILED';
  process.exitCode = 1;
} finally {
  proof.completedAt = new Date().toISOString(); proof.instances = [...instances];
  await mkdir('qa/evidence/owner-chat-live', { recursive: true });
  await writeFile('qa/evidence/owner-chat-live/proof.json', JSON.stringify(proof, null, 2) + '\n');
  console.log(JSON.stringify(proof));
}
