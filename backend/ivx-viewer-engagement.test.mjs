import assert from 'node:assert/strict';
import test from 'node:test';
import { loadViewerEngagement } from './services/ivx-viewer-engagement.ts';

const video = '00000000-0000-4000-8000-000000000001';
const otherVideo = '00000000-0000-4000-8000-000000000002';
const user = '00000000-0000-4000-8000-000000000010';
const guest = 'guest-regression-1515';

function database(rows, errors = {}) {
  const calls = [];
  const sb = { from(table) {
    const call = { table };
    calls.push(call);
    const q = {
      select() { return q; },
      in(column, ids) { assert.equal(column, 'project_id'); call.ids = ids; return q; },
      eq(column, value) { call.eq = [column, value]; return q; },
      or(filter) { call.or = filter; return q; },
      then(resolve, reject) {
        let error = errors[table] || null;
        // Model the actual Postgres UUID type check, including its rejection of
        // the old user_id.eq.guest-* OR predicate observed in production.
        const id = call.or?.match(/^user_id\.eq\.([^,]+),guest_id\.eq\.(.+)$/);
        if (call.or && (!id || !/^[0-9a-f-]{36}$/i.test(id[1]))) error = { code: '22P02' };
        const data = error ? null : (rows[table] || []).filter(row =>
          call.ids.includes(row.project_id) && (call.eq
            ? row[call.eq[0]] === call.eq[1]
            : row.user_id === id[1] || row.guest_id === id[2]));
        return Promise.resolve({ data, error }).then(resolve, reject);
      },
    };
    return q;
  } };
  return { sb, calls };
}

test('guest likes and saves survive a fresh read and remain scoped to the page', async () => {
  const { sb, calls } = database({
    project_likes: [{ project_id: video, guest_id: guest }, { project_id: otherVideo, guest_id: guest }],
    project_saves: [{ project_id: video, guest_id: guest }],
  });
  for (let reload = 0; reload < 2; reload++) {
    const state = await loadViewerEngagement(sb, [video], guest);
    assert.deepEqual([...state.liked], [video]);
    assert.deepEqual([...state.saved], [video]);
  }
  assert.ok(calls.every(call => !call.or));
});

for (const identityColumn of ['user_id', 'guest_id']) {
  test(`UUID viewer restores rows held in ${identityColumn}`, async () => {
    const { sb } = database({ project_likes: [{ project_id: video, [identityColumn]: user }] });
    const state = await loadViewerEngagement(sb, [video], user);
    assert.equal(state.liked.has(video), true);
    assert.equal(state.saved.size, 0);
  });
}

test('another guest cannot inherit a viewer like or save', async () => {
  const { sb } = database({
    project_likes: [{ project_id: video, guest_id: guest }],
    project_saves: [{ project_id: video, user_id: user }],
  });
  const state = await loadViewerEngagement(sb, [video], 'guest-other');
  assert.equal(state.liked.size + state.saved.size, 0);
});

test('guest text is passed as an exact value, not interpolated into filter syntax', async () => {
  const hostileText = `guest-x,user_id.eq.${user}`;
  const { sb, calls } = database({ project_likes: [{ project_id: video, user_id: user }] });
  const state = await loadViewerEngagement(sb, [video], hostileText);
  assert.equal(state.liked.size, 0);
  assert.ok(calls.every(call => call.eq[1] === hostileText && !call.or));
});

for (const table of ['project_likes', 'project_saves']) {
  test(`${table} failure is unavailable, not a false unliked/unsaved state`, async () => {
    const { sb } = database({}, { [table]: { code: '57014', message: 'private database detail' } });
    await assert.rejects(loadViewerEngagement(sb, [video], guest), /^Error: Viewer engagement read unavailable$/);
  });
}

test('anonymous and empty pages need no viewer database reads', async () => {
  const { sb, calls } = database({});
  await loadViewerEngagement(sb, [video], null);
  await loadViewerEngagement(sb, [], guest);
  assert.equal(calls.length, 0);
});
