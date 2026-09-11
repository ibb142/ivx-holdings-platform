import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildBlock1Certificate } from './ivx-block1-certificate.mjs';
const sha = 'a'.repeat(40);
const valid = () => ({ sha, health: { ok: true, commit: sha }, provider: { aiProviderReady: true },
  member: { commit: sha, certified: true, checks: Object.fromEntries(['runtimeConfig', 'ownerLogin', 'memberRegistration', 'memberLogin', 'memberPersistence', 'regularClassification', 'vipClassification', 'cleanup'].map(name => [name, { ok: true }])) },
  inference: { ok: true, commit: sha, source: 'chatgpt', answer: 'Observed completion' } });
test('certification requires every observed dependency on the exact approved SHA', () => {
  assert.equal(buildBlock1Certificate(valid()).certified, true);
  for (const change of [
    x => { x.health.commit = 'b'.repeat(40); }, x => { x.member.commit = 'b'.repeat(40); },
    x => { x.member.certified = false; }, x => { x.member.checks.cleanup.ok = false; },
    x => { delete x.member.checks.ownerLogin; }, x => { x.provider.aiProviderReady = false; },
    x => { x.inference = {}; }, x => { x.inference.commit = 'b'.repeat(40); },
    x => { x.inference.answer = ' '; }, x => { x.inference.source = 'fallback'; },
  ]) { const input = valid(); change(input); assert.throws(() => buildBlock1Certificate(input)); }
});
