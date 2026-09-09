import assert from 'node:assert/strict';
import { test } from 'node:test';
import { processIdentityMatchesObservedInstance } from './ivx-fleet-ha-identities';

const apiReplica = 'srv-api-788d9df44f-pf9vm';
const processIdentity = `srv-api:${apiReplica}:17:b95dd96c-d5b`;

test('matches an application process identity to its Render physical instance', () => {
  assert.equal(processIdentityMatchesObservedInstance(processIdentity, new Set([apiReplica])), true);
});

test('accepts the exact process identity used by shared PostgreSQL topology', () => {
  assert.equal(processIdentityMatchesObservedInstance(processIdentity, new Set([processIdentity])), true);
});

test('matches the production container hostname to the Render public instance ID', () => {
  const healthId = 'srv-d7t9ivreo5us73ftose0:srv-d7t9ivreo5us73ftose0-78c5c6dd98-csbv4:17:6a51f93a-ab0';
  assert.equal(processIdentityMatchesObservedInstance(healthId, new Set(['srv-d7t9ivreo5us73ftose0-csbv4'])), true);
});

test('rejects a matching replica suffix from a different service', () => {
  assert.equal(processIdentityMatchesObservedInstance(processIdentity, new Set(['srv-other-pf9vm'])), false);
});

test('rejects an unobserved replica within the correct service', () => {
  assert.equal(processIdentityMatchesObservedInstance(processIdentity, new Set(['srv-api-xnzz8'])), false);
});

test('rejects a process on a different physical instance', () => {
  assert.equal(processIdentityMatchesObservedInstance(processIdentity, new Set(['srv-api-788d9df44f-xnzz8'])), false);
});

test('requires an exact identity segment rather than a substring match', () => {
  assert.equal(processIdentityMatchesObservedInstance(processIdentity, new Set(['pf9vm'])), false);
  assert.equal(processIdentityMatchesObservedInstance(`${processIdentity}:extra`, new Set([apiReplica])), false);
  assert.equal(processIdentityMatchesObservedInstance(null, new Set([apiReplica])), false);
});
