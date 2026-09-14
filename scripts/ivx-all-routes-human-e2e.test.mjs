import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expectedRoutePath, routeDestinationId } from './ivx-route-destination.mjs';

const source = readFileSync(new URL('./ivx-all-routes-human-e2e.sh', import.meta.url), 'utf8');

test('each generated route clears only a prior native validation dialog before opening the route', () => {
  const dismiss = source.indexOf('- tapOn:\n    text: "OK"\n    optional: true');
  const open = source.indexOf('- openLink: "ivx-app:///${route#/}"');
  const currentRouteAlert = source.indexOf('- assertNotVisible: "Missing Information"');
  assert.ok(dismiss > 0, 'expected the optional prior-dialog dismissal');
  assert.ok(dismiss < open, 'the stale dialog must be dismissed before opening the next route');
  assert.ok(open < currentRouteAlert, 'the newly opened route must still fail on its own validation alert');
});

test('every route waits for its own navigator destination before screen inspection', () => {
  const open = source.indexOf('- openLink: "ivx-app:///${route#/}"');
  const wait = source.indexOf('- extendedWaitUntil:');
  const inspect = source.indexOf('- assertNotVisible: "Missing Information"');
  assert.ok(open < wait && wait < inspect);
  assert.equal(expectedRoutePath('/admin/member'), '/admin/members');
  assert.equal(expectedRoutePath('/ivx'), '/ivx/inbox');
  for (const path of ['/', '/login', '/owner-access', '/verify-access']) {
    assert.equal(expectedRoutePath(path), '/home');
  }
  for (const path of ['/chat-hub', '/admin/dashboard', '/property/123', '/chat-room']) {
    const matcher = new RegExp(routeDestinationId(path));
    assert.ok(matcher.test(`ivx-current-route${path}`));
    assert.ok(!matcher.test('ivx-current-route/login'));
    assert.ok(!matcher.test('ivx-current-route/analytics-brain'));
    assert.ok(!matcher.test(`ivx-current-route${path}-stale`));
  }
  assert.ok(new RegExp(routeDestinationId('/a.b')).test('ivx-current-route/a.b'));
  assert.ok(!new RegExp(routeDestinationId('/a.b')).test('ivx-current-route/axb'));
});

test('route failure assertions and the chat-hub readiness assertion remain enabled', () => {
  for (const marker of [
    '- assertNotVisible: "Something went wrong"',
    '- assertNotVisible: "IVX Provider Error"',
    '- assertNotVisible: "Application error"',
    '- assertVisible:\n    id: "public-chat-message-input"',
    '- assertNotVisible: "IVX public chat unavailable"',
  ]) assert.ok(source.includes(marker), `missing gate assertion: ${marker}`);
});
