import { expect, test } from 'bun:test';

async function scenario(body: string) {
  const child = Bun.spawn([process.execPath, '--eval', `
    import { strict as assert } from 'node:assert';
    import { spyOn } from 'bun:test';
    import { Client, Pool } from 'pg';
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://controltest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    process.env.SUPABASE_DB_URL = 'postgresql://postgres:test@db.controltest.supabase.co/postgres';
    let active = false, paused = false, restMode = 'hang', directMode = 'valid';
    let reads = 0, connections = 0, aborted = 0;
    const control = () => ({ paused, stopped: false, pausedAgents: [44], stoppedAgents: [] });
    globalThis.fetch = async (input, init) => {
      assert.equal(init.method, 'GET');
      if (restMode === 'hang') return new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => { aborted++; reject(init.signal.reason); }, { once: true });
      });
      if (/^\\d+$/.test(restMode)) return Response.json({ message: 'unavailable' }, { status: Number(restMode) });
      if (restMode === 'invalid') return Response.json([{ value: { control: {} }, control_name: 'emergency_stop', active: 'false' }]);
      if (restMode === 'missing') return Response.json([]);
      return String(input).includes('ivx_agent_controls')
        ? Response.json([{ control_name: 'emergency_stop', active }])
        : Response.json([{ value: { control: control() } }]);
    };
    spyOn(Client.prototype, 'connect').mockImplementation(callback => {
      connections++; queueMicrotask(() => callback(null));
    });
    spyOn(Client.prototype, 'query').mockImplementation(async (sql, _values) => {
      if (!sql.startsWith('SELECT ')) return { rows: [], command: sql === 'ROLLBACK' ? 'ROLLBACK' : 'COMMIT' };
      reads++;
      if (directMode === 'fail') throw new Error('direct transport unavailable');
      if (directMode === 'late') await new Promise(resolve => setTimeout(resolve, 2400));
      else await new Promise(resolve => setTimeout(resolve, 5));
      if (directMode === 'missing') return { rows: [{ emergency_rows: [], campaign_documents: [] }] };
      return { rows: [{
        emergency_rows: [{ control_name: 'emergency_stop', active: directMode === 'invalid' ? 'false' : active }],
        campaign_documents: [{ control: directMode === 'invalid' ? {} : control() }],
      }] };
    });
    spyOn(Client.prototype, 'end').mockImplementation(function () { this.emit('end'); return Promise.resolve(); });
    const { loadControlState } = await import('./backend/services/ivx-app-completion-campaign.ts');
    const { checkEmergencyStop, assertEmergencyStopInactive, resetEmergencyStopCacheForTests } = await import('./backend/services/ivx-emergency-stop-gate.ts');
    const { readCampaignControlPostgres, resetEmergencyStopPoolForTests } = await import('./backend/services/ivx-emergency-stop-postgres.ts');
    try { ${body} } finally { await resetEmergencyStopPoolForTests(); }
  `], { cwd: new URL('../../', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe', timeout: 12_000 });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0) throw new Error(stderr || `Owner control scenario exited ${code}`);
  expect(code).toBe(0);
}

test('slow REST recovers both real controls before the truth deadline and observes a fresh owner pause/stop', async () => {
  await scenario(`
    const start = performance.now();
    const first = await Promise.all([loadControlState({ required: true }), assertEmergencyStopInactive('initial')]);
    assert.equal(first[0].paused, false);
    assert.equal(first[1].source, 'postgres');
    assert.equal(reads, 1);
    assert.equal(connections, 1);
    assert(performance.now() - start < 2000);
    active = true; paused = true; resetEmergencyStopCacheForTests();
    const second = await Promise.all([loadControlState({ required: true }), checkEmergencyStop()]);
    assert.equal(second[0].paused, true);
    assert.deepEqual(second[0].pausedAgents, [44]);
    assert.equal(second[1].active, true);
    await assert.rejects(assertEmergencyStopInactive('new task'), /EMERGENCY_STOP_ACTIVE/);
    assert.equal(reads, 2);
    assert.equal(aborted, 4);
  `);
});

test('neither control uses Postgres to bypass denied, throttled, absent or malformed REST authority', async () => {
  await scenario(`
    for (restMode of ['401', '403', '429', 'missing', 'invalid']) {
      resetEmergencyStopCacheForTests();
      await assert.rejects(loadControlState({ required: true }));
      await assert.rejects(assertEmergencyStopInactive('denied'), /EMERGENCY_STOP_UNAVAILABLE/);
    }
    assert.equal(reads, 0);
    assert.equal(connections, 0);
  `);
});

for (const mode of ['missing', 'invalid', 'fail']) test(`a timed out REST read and ${mode} direct control still block work`, async () => {
  await scenario(`
    directMode = ${JSON.stringify(mode)};
    const outcomes = await Promise.allSettled([loadControlState({ required: true }), assertEmergencyStopInactive('unverified')]);
    assert(outcomes.every(result => result.status === 'rejected'));
  `);
});

test('late direct permission cannot extend the deadline or populate the emergency-stop cache', async () => {
  await scenario(`
    directMode = 'late';
    const start = performance.now();
    const result = await checkEmergencyStop();
    assert.equal(result.source, 'unavailable');
    assert.equal(result.error, 'owner_control_read_timeout_2000ms');
    assert(performance.now() - start < 2500);
    await new Promise(resolve => setTimeout(resolve, 1300));
    restMode = 'valid'; active = true;
    const fresh = await checkEmergencyStop();
    assert.equal(fresh.source, 'supabase');
    assert.equal(fresh.active, true);
  `);
});

test('112 overlapping campaign fallback reads share only the pending query and read a later stop freshly', async () => {
  await scenario(`
    const values = await Promise.all(Array.from({ length: 112 }, () => readCampaignControlPostgres()));
    assert.equal(values.length, 112);
    assert.equal(reads, 1);
    paused = true;
    assert.equal((await readCampaignControlPostgres()).control.paused, true);
    assert.equal(reads, 2);
    assert.equal(connections, 1);
  `);
});
