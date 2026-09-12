import { expect, test } from 'bun:test';

async function isolated(source: string, runtime = 'bun') {
  const command = runtime === 'node' ? ['node', '--import', import.meta.resolve('tsx'), '--input-type=module'] : [process.execPath];
  const child = Bun.spawn([...command, '-e', `
    import { strict as assert } from 'node:assert';
    import { EventEmitter } from 'node:events';
    import { createRequire } from 'node:module';
    const require = createRequire(${JSON.stringify(import.meta.url)});
    const { queryWithSeniorQueueReadBudget: query, readSeniorQueueJson: readJson } =
      require(${JSON.stringify(new URL('./ivx-senior-queue-read-budget.ts', import.meta.url).pathname)});
    ${source}
  `], { stdout: 'pipe', stderr: 'pipe', timeout: 5000 });
  const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  expect({ exitCode, stderr: exitCode ? stderr : '' }).toEqual({ exitCode: 0, stderr: '' });
}

test('late pool checkout is destroyed without sending SQL', () => isolated(`
  let resolveCheckout, calls = 0;
  const releases = [];
  const client = Object.assign(new EventEmitter(), {
    query: async () => { calls++; return { rows: [] }; },
    release: destroy => releases.push(destroy),
  });
  await assert.rejects(query({ connect: () => new Promise(resolve => resolveCheckout = resolve) },
    'select 1', [], 30), { code: 'IVX_QUEUE_READ_TIMEOUT' });
  resolveCheckout(client);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls, 0);
  assert.deepEqual(releases, [true]);
  assert.equal(client.listenerCount('error'), 0);
`));

for (const stage of ['setup', 'query', 'commit']) {
  test(`a stalled ${stage} releases once, never replays and handles late rejection`, () => isolated(`
    const calls = [], releases = [];
    let rejectPending;
    const client = Object.assign(new EventEmitter(), {
      query: async sql => {
        calls.push(sql);
        const current = sql.startsWith('BEGIN') ? 'setup' : sql === 'COMMIT' ? 'commit' : 'query';
        if (current === ${JSON.stringify(stage)}) return new Promise((_, reject) => rejectPending = reject);
        return { rows: [{ result: 1 }] };
      }, release: destroy => releases.push(destroy),
    });
    await assert.rejects(query({ connect: async () => client }, 'select 1', [], 30),
      { code: 'IVX_QUEUE_READ_TIMEOUT' });
    assert.deepEqual(releases, [true]);
    rejectPending(new Error('late connection termination'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.deepEqual(releases, [true]);
    assert.equal(client.listenerCount('error'), 0);
    assert.equal(calls.filter(sql => sql === 'select 1').length, ${stage === 'setup' ? 0 : 1});
    assert(!calls.includes('ROLLBACK'));
  `));
}

test('one deadline includes checkout and setup, and original database failures remain visible', () => isolated(`
  const releases = [], calls = [];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const client = Object.assign(new EventEmitter(), {
    query: async sql => { calls.push(sql); await delay(35); return { rows: [] }; },
    release: destroy => releases.push(destroy),
  });
  await assert.rejects(query({ connect: async () => { await delay(35); return client; } },
    'select 1', [], 55), { code: 'IVX_QUEUE_READ_TIMEOUT' });
  await delay(40);
  assert.equal(calls.length, 1);
  assert.deepEqual(releases, [true]);
  const error = Object.assign(new Error('provider secret'), { code: '57014' });
  const logs = [];
  console.error = line => logs.push(line);
  client.query = async sql => { if (sql.startsWith('BEGIN')) return { rows: [] }; throw error; };
  await assert.rejects(query({ connect: async () => client }, 'select $1', ['secret bind'], 100), e => e === error);
  assert.deepEqual(releases, [true, true]);
  assert(!logs[0].includes('secret'));
  assert.equal(JSON.parse(logs[0].slice(logs[0].indexOf('{'))).sqlState, '57014');
`));

for (const runtime of ['bun', 'node']) {
test(`${runtime}: real pg connection closes after a stalled query and the pool serves the next read`, () => isolated(`
  import { createServer } from 'node:net';
  const { Pool } = require('pg');
  const sockets = new Set(), queries = [];
  let connections = 0, firstClosed;
  const closed = new Promise(resolve => firstClosed = resolve);
  const frame = (type, body) => {
    const size = Buffer.alloc(4); size.writeInt32BE(body.length + 4);
    return Buffer.concat([Buffer.from(type), size, body]);
  };
  const ready = () => frame('Z', Buffer.from('I'));
  const server = createServer(socket => {
    const index = ++connections;
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => { sockets.delete(socket); if (index === 1) firstClosed(); });
    let started = false, buffer = Buffer.alloc(0);
    socket.on('data', data => {
      buffer = Buffer.concat([buffer, data]);
      if (!started) {
        if (buffer.length < 4 || buffer.length < buffer.readInt32BE(0)) return;
        buffer = buffer.subarray(buffer.readInt32BE(0)); started = true;
        socket.write(Buffer.concat([frame('R', Buffer.alloc(4)), ready()]));
      }
      while (buffer.length >= 5 && buffer.length >= 1 + buffer.readInt32BE(1)) {
        const length = buffer.readInt32BE(1), type = buffer[0];
        const payload = buffer.subarray(5, 1 + length);
        buffer = buffer.subarray(1 + length);
        if (type === 88) { socket.end(); return; }
        if (type !== 81) continue;
        const sql = payload.toString().replace(/\\0$/, ''); queries.push(sql);
        if (index === 1 && sql === 'select 1') continue;
        socket.write(Buffer.concat([frame('C', Buffer.from('SELECT 0\\0')), ready()]));
      }
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const pool = new Pool({ host: '127.0.0.1', port: server.address().port, user: 'test',
    database: 'test', ssl: false, max: 1, connectionTimeoutMillis: 1000 });
  pool.on('error', () => {});
  try {
    await assert.rejects(query(pool, 'select 1', [], 500), { code: 'IVX_QUEUE_READ_TIMEOUT' });
    let timer;
    await Promise.race([closed, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('socket leaked')), 1000); })])
      .finally(() => clearTimeout(timer));
    assert.equal(pool.totalCount, 0);
    assert.deepEqual((await query(pool, 'select 1', [], 1000)).rows, []);
    assert.equal(connections, 2);
    assert.equal(queries.filter(sql => sql === 'select 1').length, 2);
    assert.equal(pool.idleCount, 1);
  } finally {
    await pool.end();
    for (const socket of sockets) socket.destroy();
    await new Promise(resolve => server.close(resolve));
  }
`, runtime));
}

test('REST deadline covers the body, cancels it, and a later read can recover', () => isolated(`
  let cancelled = false, signal, calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++; signal = init.signal;
    return new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  };
  await assert.rejects(readJson('https://example.test/queue', {}, 30), { code: 'IVX_QUEUE_READ_TIMEOUT' });
  assert.equal(cancelled, true);
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
  globalThis.fetch = async () => { calls++; return Response.json([{ value: { jobs: [{ jobId: 'one' }] } }]); };
  assert.deepEqual(await readJson('https://example.test/queue', {}, 100), [{ value: { jobs: [{ jobId: 'one' }] } }]);
  assert.equal(calls, 2);
`));

test('REST late headers cancel their body and HTTP failures never become an empty queue', () => isolated(`
  let resolveFetch, cancelled = false;
  globalThis.fetch = () => new Promise(resolve => resolveFetch = resolve);
  await assert.rejects(readJson('https://example.test/queue', {}, 30), { code: 'IVX_QUEUE_READ_TIMEOUT' });
  resolveFetch(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(readJson('https://example.test/queue', {}, 100), /HTTP 503/);
  globalThis.fetch = async () => new Response('broken json');
  await assert.rejects(readJson('https://example.test/queue', {}, 100), SyntaxError);
`));

for (const transport of ['postgres', 'rest']) {
  test(`shared repair read enforces 3500ms and releases its ${transport} transport`, async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import { mock } from 'bun:test';
      import { EventEmitter } from 'node:events';
      import { strict as assert } from 'node:assert';
      let releases = [], requests = 0, aborted = false;
      mock.module('pg', () => ({ Client: class {}, Pool: class extends EventEmitter {
        async connect() { return Object.assign(new EventEmitter(), {
          query: async sql => {
            if (sql.startsWith('BEGIN')) return { rows: [] };
            return new Promise(() => {});
          }, release: destroy => releases.push(destroy),
        }); }
      } }));
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://testproject.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
      if (${JSON.stringify(transport)} === 'postgres') {
        process.env.SUPABASE_DB_URL = 'postgresql://postgres.testproject:test@aws-0-us-east-1.pooler.supabase.com/postgres';
      } else {
        for (const name of ['SUPABASE_DB_URL', 'DATABASE_URL', 'POSTGRES_URL', 'SUPABASE_POOLER_URL']) delete process.env[name];
      }
      globalThis.fetch = async (_url, init) => {
        requests++;
        return new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () => { aborted = true; reject(init.signal.reason); }, { once: true });
        });
      };
      const { readSharedSeniorDocument } = await import(${JSON.stringify(new URL('./ivx-senior-shared-queue.ts', import.meta.url).pathname)});
      let watchdog;
      const start = performance.now();
      const outcome = await Promise.race([
        Promise.allSettled(Array.from({ length: 30 }, () =>
          readSharedSeniorDocument('/app/logs/audit/senior-developer-worker/queue.json', { jobs: [] })))
          .then(results => ({ results })),
        new Promise(resolve => { watchdog = setTimeout(() => resolve({ watchdog: true }), 3850); }),
      ]);
      clearTimeout(watchdog);
      assert.equal(outcome.results?.length, 30, 'the shared read did not enforce its deadline');
      assert(outcome.results.every(result => result.status === 'rejected'
        && result.reason.code === 'IVX_QUEUE_READ_TIMEOUT'), 'an outage must not become an empty successful queue');
      assert(performance.now() - start < 3850);
      if (${JSON.stringify(transport)} === 'postgres') { assert.deepEqual(releases, [true]); assert.equal(requests, 0); }
      else { assert.equal(requests, 1); assert.equal(aborted, true); }
    `], { stdout: 'pipe', stderr: 'pipe', timeout: 6000 });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).not.toContain('AssertionError');
    expect(exitCode).toBe(0);
  }, 7000);
}
