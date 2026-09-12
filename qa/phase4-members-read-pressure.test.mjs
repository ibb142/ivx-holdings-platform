import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';

function source(path) {
  return stripTypeScriptTypes(readFileSync(new URL(path, import.meta.url), 'utf8'), { mode: 'strip' })
    .replace(/^import[\s\S]*?from ['"][^'"]+['"];[ \t]*$/gm, '')
    .replace(/^export /gm, '');
}
const serviceSource = source('../backend/services/ivx-canonical-members.ts');
const apiSource = source('../backend/api/ivx-canonical-members.ts');
const rows = [{ member_id: 'fixture-a', full_name: 'Fixture member', member_type: 'member', source: 'landing', sms_verified: true, verification_status: 'verified', secondary_roles: ['buyer'] }];
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve(); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

function fixture(fetchImpl = async () => Response.json(rows), authorized = true) {
  const calls = [];
  const timers = new Map();
  let timerId = 0;
  const env = { SUPABASE_URL: 'https://fixture-a.example.test', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service-key' };
  const context = {
    process: { env }, console: { error() {} }, Response, Request, URL, AbortController, structuredClone,
    fetch: async (url, init) => { calls.push({ url, init }); return fetchImpl(url, init); },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id),
  };
  const service = runInNewContext(`${serviceSource}\n({listCanonicalMembers, countCanonicalMembers, isCanonicalMembersConfigured, backfillCanonicalMembers, listCanonicalMemberSummaryRows: typeof listCanonicalMemberSummaryRows === 'function' ? listCanonicalMemberSummaryRows : undefined});`, context);
  const api = runInNewContext(`${apiSource}\n({ handleCanonicalMembersRegistry, handleCanonicalMembersList, handleCanonicalMembersSummary });`, {
    ...context, ...service,
    assertIVXOwnerOnly: async () => { if (!authorized) throw new Error('not authorized'); },
    ownerOnlyJson: (body, status) => Response.json(body, { status }),
  });
  return { calls, timers, env, service, api, expire() { assert.ok(timers.size > 0, 'pending reads have a deadline'); for (const { fn, ms } of [...timers.values()]) { assert.equal(ms, 5000); fn(); } } };
}

test('overlapping registry reads share one request and return independent member snapshots', async () => {
  const done = deferred();
  const f = fixture(async () => { await done.promise; return Response.json(rows); });
  const requests = Array.from({ length: 40 }, () => f.service.listCanonicalMembers());
  await flush();
  try { assert.equal(f.calls.length, 1); } finally { done.resolve(); }
  const values = await Promise.all(requests);
  values[0][0].secondary_roles.push('owner');
  assert.deepEqual(values[1][0].secondary_roles, ['buyer']);
  await f.service.listCanonicalMembers();
  assert.equal(f.calls.length, 2, 'settled data is not reused');
  assert.equal(f.timers.size, 0);
});

test('summary reads only grouping fields and retains the existing counts', async () => {
  const f = fixture(async (_url, init) => init.method === 'HEAD'
    ? new Response(null, { headers: { 'content-range': '0-0/1' } }) : Response.json(rows));
  const response = await f.api.handleCanonicalMembersSummary(new Request('https://fixture.test/api/ivx/members/summary'));
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.total, 1);
  assert.deepEqual(data.byType, { member: 1 });
  assert.deepEqual(data.bySource, { landing: 1 });
  assert.equal(data.smsVerified, 1);
  assert.equal(data.verified, 1);
  const get = f.calls.find(x => x.init.method !== 'HEAD');
  assert.equal(new URL(get.url).searchParams.get('select'), 'member_type,source,sms_verified,verification_status');
});

for (const method of ['handleCanonicalMembersRegistry', 'handleCanonicalMembersList', 'handleCanonicalMembersSummary']) {
  test(`${method} preserves a database failure instead of reporting zero members`, async () => {
    const f = fixture(async (_url, init) => new Response(init.method === 'HEAD' ? null : '{"message":"fixture outage"}', { status: 503 }));
    const response = await f.api[method](new Request('https://fixture.test/api/ivx/members'));
    assert.equal(response.status, 503);
    const data = await response.json();
    assert.equal(data.code, 'MEMBERS_SOURCE_UNAVAILABLE');
    assert.equal(data.ok, false);
    assert.equal(Object.hasOwn(data, 'total'), false);
    assert.equal(Object.hasOwn(data, 'members'), false);
  });
}

for (const phase of ['headers', 'body']) {
  test(`a stalled ${phase} read expires, aborts and releases its shared request`, async () => {
    const stuck = deferred();
    let calls = 0;
    const f = fixture(async () => {
      if (++calls > 1) return Response.json(rows);
      return phase === 'headers' ? stuck.promise : { ok: true, json: () => stuck.promise, text: () => stuck.promise };
    });
    const pending = f.api.handleCanonicalMembersRegistry(new Request('https://fixture.test/api/ivx/members/registry'));
    await flush();
    f.expire();
    assert.equal((await pending).status, 503);
    assert.equal(f.calls[0].init.signal.aborted, true);
    assert.equal((await f.service.listCanonicalMembers()).length, 1);
    assert.equal(f.calls.length, 2);
    stuck.resolve(phase === 'headers' ? Response.json(rows) : rows);
    await flush();
    assert.equal(f.timers.size, 0);
  });
}

test('filters and changed connection credentials cannot share registry data', async () => {
  const done = deferred();
  const f = fixture(async () => { await done.promise; return Response.json(rows); });
  const a = f.service.listCanonicalMembers({ memberType: 'buyer' });
  const b = f.service.listCanonicalMembers({ memberType: 'investor' });
  f.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture-rotated-key';
  const c = f.service.listCanonicalMembers({ memberType: 'buyer' });
  await flush();
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].init.headers.apikey, 'fixture-service-key');
  assert.equal(f.calls[2].init.headers.apikey, 'fixture-rotated-key');
  done.resolve();
  await Promise.all([a, b, c]);
});

test('missing or malformed exact count evidence cannot become a successful zero', async () => {
  for (const range of ['', '*/*', '0-0/not-a-count']) {
    const f = fixture(async () => new Response(null, { headers: { 'content-range': range } }));
    await assert.rejects(f.service.countCanonicalMembers());
  }
  const f = fixture(async () => new Response(null, { headers: { 'content-range': '*/0' } }));
  assert.equal(await f.service.countCanonicalMembers(), 0);
});

test('unauthorized requests reach no member reads', async () => {
  const f = fixture(undefined, false);
  for (const method of Object.values(f.api)) {
    assert.equal((await method(new Request('https://fixture.test/api/ivx/members'))).status, 401);
  }
  assert.equal(f.calls.length, 0);
});

test('distinct pending filters have bounded capacity while existing followers still join', async () => {
  const done = deferred();
  const f = fixture(async () => { await done.promise; return Response.json(rows); });
  const requests = Array.from({ length: 32 }, (_, i) => f.service.listCanonicalMembers({ search: `fixture-${i}` }));
  const follower = f.service.listCanonicalMembers({ search: 'fixture-0' });
  const overflow = f.service.listCanonicalMembers({ search: 'overflow' }).then(() => true, () => false);
  await flush();
  try { assert.equal(f.calls.length, 32); } finally { done.resolve(); }
  assert.equal(await overflow, false);
  await Promise.all([...requests, follower]);
  await f.service.listCanonicalMembers({ search: 'overflow' });
  assert.equal(f.calls.length, 33);
});
