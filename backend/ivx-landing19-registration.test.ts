import { test } from 'bun:test';
import assert from 'node:assert/strict';
import { handleMemberRegister } from './api/ivx-members';
test('actual registration HTTP handler rejects ZIP before any network call', async () => {
  const oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; throw new Error('No external request permitted in this negative fixture'); }) as typeof fetch;
  try {
    const response = await handleMemberRegister(new Request('http://localhost/api/members/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'isolated@example.test', password: 'Strong-Password-1!x', firstName: 'QA', lastName: 'Fixture', phone: '+15555550100', country: 'US', zipCode: 'invalid!', roles: ['investor'], acceptTerms: true, dateOfBirth: '1990-01-01', gender: 'prefer_not_to_say' }) }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_POSTAL_CODE');
    assert.equal(calls, 0);
  } finally { globalThis.fetch = oldFetch; }
});
