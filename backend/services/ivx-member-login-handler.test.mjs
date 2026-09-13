import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMemberLoginRequest } from './ivx-member-login-handler.ts';

const deploymentMarker = 'login-handler-test';
const jsonResponse = (body, status = 200) => Response.json(body, { status });
const request = body => new Request('https://example.com/api/members/login', {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('malformed emails return generic 401 below 200ms without calling Auth or the store', async () => {
  let calls = 0;
  const loginMember = async () => { calls++; throw new Error('Must not access a dependency'); };
  for (const email of ['not-an-email', 'a@@example.com', 'a b@example.com', 'a@', 'a'.repeat(255) + '@example.com']) {
    const started = performance.now();
    const response = await handleMemberLoginRequest(request({ email, password: 'secret' }), { loginMember, jsonResponse, deploymentMarker });
    assert.equal(response.status, 401);
    assert.equal((await response.json()).message, 'Invalid email or password.');
    assert.ok(performance.now() - started < 200);
  }
  assert.equal(calls, 0);
});

test('empty and non-object JSON bodies preserve validation errors and never call Auth', async () => {
  let calls = 0;
  const loginMember = async () => { calls++; throw new Error('Must not call Auth'); };
  for (const body of [null, [], true, 'email', {}, { email: 'a@example.com' }, { email: 'a@example.com', password: '' }]) {
    assert.equal((await handleMemberLoginRequest(request(body), { loginMember, jsonResponse, deploymentMarker })).status, 400);
  }
  assert.equal(calls, 0);
});

test('valid input reaches Auth once with the exact password including whitespace', async () => {
  const calls = [];
  const loginMember = async (...args) => { calls.push(args); return { success: true, message: 'ok', deploymentMarker }; };
  const response = await handleMemberLoginRequest(request({ email: ' Member@Example.com ', password: '  exact password  ' }), { loginMember, jsonResponse, deploymentMarker });
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [['member@example.com', '  exact password  ']]);
});

test('plausible unknown credentials require Auth; confirmed invalid is 401 and outage remains 503', async () => {
  for (const [result, status] of [
    [{ success: false, message: 'Invalid email or password.' }, 401],
    [{ success: false, message: 'Please verify your email.', requiresVerification: true }, 403],
    [{ success: false, message: 'Please try again.', errorCode: 'auth_upstream_timeout', retryable: true }, 503],
  ]) {
    let calls = 0;
    const loginMember = async () => { calls++; return { ...result, deploymentMarker }; };
    const response = await handleMemberLoginRequest(request({ email: 'plausible@example.com', password: 'wrong-but-plausible' }), { loginMember, jsonResponse, deploymentMarker });
    assert.equal(response.status, status); assert.equal(calls, 1);
  }
});
