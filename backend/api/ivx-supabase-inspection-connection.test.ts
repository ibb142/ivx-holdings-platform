import { expect, test } from 'bun:test';

for (const scenario of ['checked-out disconnect', 'idle disconnect', 'stalled transaction setup']) {
  test(`read-only inspection survives a real PostgreSQL ${scenario} and recovers`, async () => {
    const child = Bun.spawn([process.execPath, '-e', `
      import assert from 'node:assert/strict';
      import { createServer } from 'node:net';
      import { mock } from 'bun:test';
      import pg from 'pg';
      const scenario = ${JSON.stringify(scenario)};
      const timeout = setTimeout(() => process.exit(2), 10000);
      const unhandled = [];
      process.on('uncaughtException', error => unhandled.push(error));
      process.on('unhandledRejection', error => unhandled.push(error));
      const packet = (type, body) => {
        const length = Buffer.alloc(4); length.writeInt32BE(4 + body.length);
        return Buffer.concat([Buffer.from(type), length, body]);
      };
      const ready = () => packet('Z', Buffer.from('I'));
      const complete = command => packet('C', Buffer.from(command + '\\0'));
      let connections = 0, activeSocket, pool;
      const commands = [];
      const sockets = new Set();
      const server = createServer(socket => {
        const connection = ++connections; activeSocket = socket; sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('error', () => {});
        let startup = true, buffered = Buffer.alloc(0);
        socket.on('data', chunk => {
          buffered = Buffer.concat([buffered, chunk]);
          while (buffered.length >= (startup ? 4 : 5)) {
            const size = buffered.readInt32BE(startup ? 0 : 1) + (startup ? 0 : 1);
            if (buffered.length < size) return;
            const message = buffered.subarray(0, size); buffered = buffered.subarray(size);
            if (startup) {
              startup = false;
              socket.write(Buffer.concat([packet('R', Buffer.alloc(4)), ready()]));
              continue;
            }
            const type = String.fromCharCode(message[0]);
            if (type === 'X') { socket.end(); return; }
            if (type === 'Q') {
              const sql = message.subarray(5, -1).toString(); commands.push(sql);
              if (scenario === 'stalled transaction setup' && connection === 1) continue;
              socket.write(Buffer.concat([complete(sql.startsWith('BEGIN') ? 'BEGIN' : 'COMMIT'), ready()]));
            } else if (type === 'P') {
              const offset = message.indexOf(0, 5) + 1;
              commands.push(message.subarray(offset, message.indexOf(0, offset)).toString());
              if (scenario === 'checked-out disconnect' && connection === 1) { socket.destroy(); return; }
              socket.write(packet('1', Buffer.alloc(0)));
            } else if (type === 'B') socket.write(packet('2', Buffer.alloc(0)));
            else if (type === 'D') socket.write(packet('n', Buffer.alloc(0)));
            else if (type === 'E') socket.write(complete('SELECT 0'));
            else if (type === 'S') socket.write(ready());
          }
        });
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      // Keep the installed pg client and real TCP protocol; substitute only
      // the connection destination, never production TLS or credentials.
      const RealPool = pg.Pool;
      mock.module('pg', () => ({ Pool: class extends RealPool {
        constructor(config) {
          super({ ...config, connectionString: undefined, ssl: false, host: '127.0.0.1', port: server.address().port, user: 'fixture', password: 'fixture', database: 'fixture' });
          pool = this;
        }
      } }));
      process.env.SUPABASE_INSPECTION_DATABASE_URL = 'postgres://fixture:fixture@localhost/fixture';
      process.env.SUPABASE_URL = 'https://fixture.supabase.co';
      process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co';
      process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture.' + Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url') + '.fixture';
      globalThis.fetch = async () => Response.json({ definitions: { fixture_table: { description: 'REST fallback fixture' } } });
      const { inspectSupabaseTables } = await import('./backend/api/ivx-supabase-inspection.ts');
      try {
        const started = Date.now();
        const first = await inspectSupabaseTables('public', null, 1);
        if (scenario !== 'idle disconnect') {
          assert.equal(first[0]?.table_name, 'fixture_table');
          assert.equal(pool.totalCount, 0, 'broken checked-out connection must be discarded');
          assert.equal(commands.filter(sql => sql.includes('information_schema.tables')).length, scenario === 'checked-out disconnect' ? 1 : 0, 'never replay the interrupted statement');
          if (scenario === 'stalled transaction setup') {
            assert.ok(Date.now() - started >= 4500, 'exercise the actual configured client deadline');
            assert.ok(Date.now() - started < 7000, 'cleanup must not wait for a second query timeout');
          }
        } else {
          assert.deepEqual(first, []);
          const ended = new Promise(resolve => pool.once('remove', resolve));
          activeSocket.destroy();
          await ended;
          assert.equal(pool.totalCount, 0, 'pool must evict the disconnected idle client');
        }
        assert.deepEqual(await inspectSupabaseTables('public', null, 1), []);
        assert.equal(connections, 2, 'next read uses a fresh connection');
        for (const sql of commands.filter(sql => sql.startsWith('BEGIN'))) {
          assert.ok(sql.startsWith('BEGIN READ ONLY'), 'inspection must keep its read-only transaction');
          assert.ok(sql.includes("statement_timeout = '4s'"), 'inspection must use a server deadline');
        }
        assert.equal(unhandled.length, 0, 'connection failure must remain a handled query/pool error');
      } finally {
        await pool?.end();
        for (const socket of sockets) socket.destroy();
        await new Promise(resolve => server.close(resolve));
        clearTimeout(timeout);
      }
      process.exit(0);
    `], { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited, new Response(child.stdout).text(), new Response(child.stderr).text(),
    ]);
    expect({ exitCode, details: exitCode === 0 ? '' : stdout + stderr }).toEqual({ exitCode: 0, details: '' });
  }, 15_000);
}
