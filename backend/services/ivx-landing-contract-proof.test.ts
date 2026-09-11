import { test, afterEach } from 'bun:test';
import assert from 'node:assert/strict';
import { executeLandingUnit, __resetLandingExecutorCachesForTests } from './ivx-landing-p0-executor';
import type { DealsAssert, LandingUnit } from './ivx-landing-p0-backlog';

afterEach(__resetLandingExecutorCachesForTests);
const sha = 'a'.repeat(40);
const ctx = { agentId: 'synthetic-agent', agentNumber: 1, taskId: 'synthetic-task', sourceSha: sha, productionSha: sha, repair: false };
const unit = (check: LandingUnit['check']): LandingUnit => ({ unitId: 'synthetic-contract', lane: 'e2e', workstream: 'synthetic', title: 'Proof integrity', severity: 'P1', check });
const castFetch = (fn: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): typeof fetch => fn as typeof fetch;

test('concurrent route probes count their entire queue wait separately from QA work', async () => {
  const results = await Promise.all(Array.from({ length: 3 }, () => executeLandingUnit(
    unit({ kind: 'contract', probe: 'login-empty' }), ctx,
    { fetchImpl: castFetch(async () => Response.json({ message: 'Invalid credentials' }, { status: 401 })) })));
  const last = results[2].record;
  assert.equal(last.status, 'PASS');
  assert.ok(last.activity!.waiting_seconds >= 4.8, 'must include time queued behind both earlier probes');
  for (const { record } of results) {
    const elapsed = (Date.parse(record.completed_at) - Date.parse(record.started_at)) / 1000;
    assert.ok(Math.abs(record.activity!.active_seconds + record.activity!.waiting_seconds - elapsed) < 0.001);
    assert.equal(record.productive_seconds, record.activity!.active_seconds);
  }
}, 10_000);

const dealAssertions: DealsAssert[] = [
  { assert: 'videos' },
  { assert: 'min-count', min: 1 }, { assert: 'present', title: 'Synthetic property' },
  { assert: 'order', titles: ['Synthetic property'] }, { assert: 'published' },
  { assert: 'unique-titles' }, { assert: 'unique-ids' }, { assert: 'financials' },
  { assert: 'identity' }, { assert: 'cover' }, { assert: 'images' },
];
const completeDeal = { id: 'synthetic-deal', title: 'Synthetic property', published: true,
  address: '123 Example Street', price: 100000, image_url: 'https://cdn.example/image.png',
  video_url: 'https://cdn.example/video.mp4' };

test('an empty deals response cannot certify any property assertion', async () => {
  for (const assertion of dealAssertions) {
    __resetLandingExecutorCachesForTests();
    const result = await executeLandingUnit(unit({ kind: 'deals', assert: assertion }), ctx,
      { fetchImpl: castFetch(async () => Response.json({ deals: [], count: 0 })) });
    assert.equal(result.record.status, 'FAIL', assertion.assert);
    assert.match(result.record.bugs_found[0].detail, /no deals.*verified/i);
  }
});

test('malformed and partially invalid deals responses never certify the remaining records', async () => {
  for (const body of [{}, { deals: null }, { deals: {} }, { deals: [completeDeal, null] },
    { deals: [completeDeal, 'invalid'] }, { deals: [completeDeal, []] }]) {
    __resetLandingExecutorCachesForTests();
    const result = await executeLandingUnit(unit({ kind: 'deals', assert: { assert: 'videos' } }), ctx,
      { fetchImpl: castFetch(async () => Response.json(body)) });
    assert.equal(result.record.status, 'FAIL', JSON.stringify(body));
    assert.equal(result.record.bugs_found[0].root_cause, 'api');
  }
});

test('a valid nonempty deals contract still certifies each property assertion', async () => {
  for (const assertion of dealAssertions) {
    __resetLandingExecutorCachesForTests();
    const result = await executeLandingUnit(unit({ kind: 'deals', assert: assertion }), ctx,
      { fetchImpl: castFetch(async () => Response.json({ deals: [completeDeal], count: 1 })) });
    assert.equal(result.record.status, 'PASS', assertion.assert);
  }
});

test('a valid legacy array remains supported and an unavailable response stays failed', async () => {
  for (const status of [200, 503]) {
    __resetLandingExecutorCachesForTests();
    const result = await executeLandingUnit(unit({ kind: 'deals', assert: { assert: 'videos' } }), ctx,
      { fetchImpl: castFetch(async () => Response.json([completeDeal], { status })) });
    assert.equal(result.record.status, status === 200 ? 'PASS' : 'FAIL');
  }
});

test('media checks reject a partially invalid source before probing its remaining URLs', async () => {
  let calls = 0;
  const result = await executeLandingUnit(unit({ kind: 'media', source: 'deals-videos', assert: 'resolvable' }), ctx,
    { fetchImpl: castFetch(async () => { calls += 1; return Response.json({ deals: [completeDeal, null] }); }) });
  assert.equal(result.record.status, 'FAIL');
  assert.equal(result.record.bugs_found[0].root_cause, 'api');
  assert.equal(calls, 1);
});

test('each negative registration probe isolates its target field with all other required fields present', async () => {
  const cases = [
    { probe: 'register-missing-name', field: 'firstName', message: 'First name is required.' },
    { probe: 'register-missing-last-name', field: 'lastName', message: 'Last name is required.' },
    { probe: 'register-missing-cell', field: 'phone', message: 'Phone number is required.' },
    { probe: 'register-invalid-role', field: 'roles', message: 'Please select a valid role.' },
  ];
  for (const scenario of cases) {
    __resetLandingExecutorCachesForTests();
    const result = await executeLandingUnit(unit({ kind: 'contract', probe: scenario.probe }), ctx, { fetchImpl: castFetch(async (_url, init) => {
      const payload = JSON.parse(String(init?.body));
      assert.equal(payload.acceptTerms, true);
      assert.equal(payload.dateOfBirth, '1990-01-01');
      assert.equal(payload.gender, 'prefer_not_to_say');
      assert.equal(payload.zipCode, '33101');
      for (const field of ['firstName', 'lastName', 'phone', 'roles']) {
        if (field !== scenario.field) assert.ok(payload[field], `${scenario.probe}: missing unrelated ${field}`);
      }
      if (scenario.field === 'roles') assert.deepEqual(payload.roles, ['zzz-invalid-role']);
      else assert.equal(scenario.field in payload, false);
      return Response.json({ message: scenario.message }, { status: 400 });
    }) });
    assert.equal(result.record.status, 'PASS');
  }
});

test('rejection for unrelated terms cannot certify role validation', async () => {
  const result = await executeLandingUnit(unit({ kind: 'contract', probe: 'register-invalid-role' }), ctx, { fetchImpl: castFetch(async () => Response.json({ message: 'Accept the terms first.' }, { status: 400 })) });
  assert.equal(result.record.status, 'FAIL');
  assert.match(result.record.bugs_found[0].detail, /unverified field/);
});

test('positive registration and token-expiry claims require appropriate acceptance fixtures without production mutations', async () => {
  for (const probe of ['register-picture-optional', 'register-invalid-zip', 'expired-token']) {
    const result = await executeLandingUnit(unit({ kind: 'contract', probe }), ctx, { fetchImpl: castFetch(async () => assert.fail('No live probe is appropriate without its acceptance fixture')) });
    assert.equal(result.record.status, 'BLOCKED');
    assert.equal(result.record.api_checks, 0);
  }
});

test('zero media never passes availability, MIME, HTTPS, uniqueness or weight checks', async () => {
  for (const assertion of ['resolvable', 'mime', 'https', 'no-duplicates', 'weight', 'no-missing'] as const) {
    __resetLandingExecutorCachesForTests();
    const result = await executeLandingUnit(unit({ kind: 'media', source: 'deals-videos', assert: assertion }), ctx, { fetchImpl: castFetch(async () => Response.json({ deals: [{ id: 'synthetic-deal', title: 'Synthetic property' }] })) });
    assert.equal(result.record.status, 'FAIL', assertion);
    assert.match(result.record.bugs_found[0].detail, /no media was verified/);
  }
});

test('an unavailable video cannot pass MIME validation', async () => {
  const result = await executeLandingUnit(unit({ kind: 'media', source: 'deals-videos', assert: 'mime' }), ctx, { fetchImpl: castFetch(async (input) => String(input).endsWith('/api/deals')
    ? Response.json({ deals: [{ id: 'synthetic-deal', video_url: 'https://cdn.example/video.mp4' }] })
    : new Response('', { status: 404 })) });
  assert.equal(result.record.status, 'FAIL');
  assert.match(result.record.bugs_found[0].detail, /MIME not verified/);
});

test('missing content type does not certify a video and unknown image size does not certify its weight', async () => {
  const video = await executeLandingUnit(unit({ kind: 'media', source: 'deals-videos', assert: 'mime' }), ctx, { fetchImpl: castFetch(async (input) => String(input).endsWith('/api/deals')
    ? Response.json({ deals: [{ id: 'synthetic-deal', video_url: 'https://cdn.example/video.mp4' }] })
    : new Response(null, { status: 200 })) });
  assert.equal(video.record.status, 'FAIL');
  __resetLandingExecutorCachesForTests();
  const image = await executeLandingUnit(unit({ kind: 'media', source: 'deals-images', assert: 'weight' }), ctx, { fetchImpl: castFetch(async (input) => String(input).endsWith('/api/deals')
    ? Response.json({ deals: [{ id: 'synthetic-deal', image_url: 'https://cdn.example/image.png' }] })
    : new Response(null, { status: 200, headers: { 'content-type': 'image/png' } })) });
  assert.equal(image.record.status, 'BLOCKED');
});

test('actual successful video responses still pass the media MIME check', async () => {
  const result = await executeLandingUnit(unit({ kind: 'media', source: 'deals-videos', assert: 'mime' }), ctx, { fetchImpl: castFetch(async (input) => String(input).endsWith('/api/deals')
    ? Response.json({ deals: [{ id: 'synthetic-deal', video_url: 'https://cdn.example/video.mp4' }] })
    : new Response(null, { status: 206, headers: { 'content-type': 'video/mp4', 'content-length': '1024' } })) });
  assert.equal(result.record.status, 'PASS');
});
