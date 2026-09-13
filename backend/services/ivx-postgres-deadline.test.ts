import { expect, spyOn, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { Client, Pool } from 'pg';
import { observePostgresPoolErrors, queryWithPostgresDeadline } from './ivx-postgres-deadline';
import { newReadTimings, readTimings, timingHeaders } from './ivx-read-timings';

for (const code of ['57014', '55P03']) {
  test(`confirmed ${code} rollback preserves the connection for the next request without replay`, async () => {
    const pool = new Pool({ max: 1, idleTimeoutMillis: 0, connectionTimeoutMillis: 1500 });
    let connects = 0;
    pool.on('connect', () => { connects++; });
    const calls: string[] = [];
    const original = Object.assign(new Error('server cancelled request'), { code });
    // Exercise real pg.Pool reuse/removal; substitute only socket I/O.
    const connect = spyOn(Client.prototype, 'connect').mockImplementation((callback: (error: Error | null) => void) => {
      queueMicrotask(() => callback(null)); return undefined as never;
    });
    const query = spyOn(Client.prototype, 'query').mockImplementation((async (sql: string) => {
      calls.push(sql);
      if (sql === 'select cancelled_request') throw original;
      return { command: sql === 'ROLLBACK' ? 'ROLLBACK' : 'SELECT', rows: [{ ok: true }] };
    }) as never);
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(queryWithPostgresDeadline(pool, 'select cancelled_request', [])).rejects.toBe(original);
      expect((await queryWithPostgresDeadline(pool, 'select following_request', [])).rows).toEqual([{ ok: true }]);
      expect(calls.filter(sql => sql === 'select cancelled_request')).toHaveLength(1);
      expect(calls.filter(sql => sql === 'ROLLBACK')).toHaveLength(1);
      expect(connects).toBe(1);
      expect(pool.totalCount).toBe(1);
      expect(pool.idleCount).toBe(1);
      expect(pool.waitingCount).toBe(0);
    } finally {
      await pool.end(); logger.mockRestore(); query.mockRestore(); connect.mockRestore();
    }
  });
}

for (const rollback of ['reject', 'wrong-command', 'connection-error']) {
  test(`unconfirmed rollback (${rollback}) still discards the connection and preserves the failure`, async () => {
    const original = Object.assign(new Error('server cancellation'), { code: '57014' });
    const releases: boolean[] = [], calls: string[] = [];
    const client = Object.assign(new EventEmitter(), {
      query: async (sql: string) => {
        calls.push(sql);
        if (sql === 'select cancelled_request') throw original;
        if (sql === 'ROLLBACK') {
          if (rollback === 'reject') throw new Error('rollback response lost');
          if (rollback === 'connection-error') client.emit('error', new Error('socket lost'));
          return { command: rollback === 'wrong-command' ? 'UNKNOWN' : 'ROLLBACK', rows: [] };
        }
        return { rows: [] };
      }, release: (destroy: boolean) => releases.push(destroy),
    });
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(queryWithPostgresDeadline({ connect: async () => client } as unknown as Pick<Pool, 'connect'>,
        'select cancelled_request', [])).rejects.toBe(original);
      expect(releases).toEqual([true]);
      expect(calls.filter(sql => sql === 'select cancelled_request')).toHaveLength(1);
      expect(client.listenerCount('error')).toBe(0);
    } finally { logger.mockRestore(); }
  });
}

test('native pool events register once and slow checkout is attributed before query execution', async () => {
  const client = Object.assign(new EventEmitter(), { query: async () => ({ rows: [] }), release: () => {} });
  const pool = Object.assign(new EventEmitter(), { waitingCount: 1, idleCount: 0, totalCount: 1,
    connect: async () => { pool.emit('connect', client); pool.emit('acquire', client); return client; } });
  observePostgresPoolErrors(pool as unknown as Pick<Pool, 'on'>, 'test');
  observePostgresPoolErrors(pool as unknown as Pick<Pool, 'on'>, 'test');
  expect(pool.listenerCount('connect')).toBe(1);
  expect(pool.listenerCount('acquire')).toBe(1);
  const clock = spyOn(performance, 'now').mockReturnValueOnce(0).mockReturnValue(601);
  const logger = spyOn(console, 'warn').mockImplementation(() => {});
  const metrics = newReadTimings();
  try {
    await readTimings.run(metrics, () => queryWithPostgresDeadline(pool as unknown as Pick<Pool, 'connect'>, 'select 1', []));
    expect(timingHeaders(metrics)['X-Pool-Acquisition-Ms']).toBe('601.0');
    expect(logger.mock.calls[0]?.[1]).toMatchObject({ connects: 1, acquires: 1, waitingAtStart: 1, acquisitionMs: 601, ok: true });
    expect(timingHeaders(newReadTimings())['X-Pool-Acquisition-Ms']).toBe('unavailable');
  } finally { clock.mockRestore(); logger.mockRestore(); }
});

for (const stage of ['checkout', 'setup', 'query', 'commit']) {
  test(`reports ${stage} failure without SQL, parameters or provider error text`, async () => {
    const error = Object.assign(new Error('password=private-error-value'), { code: '57014' });
    const sql = "select public.example_rpc($1::jsonb) /* private-query-value */";
    const calls: string[] = [];
    const client = Object.assign(new EventEmitter(), {
      query: async (text: string) => {
        calls.push(text);
        if ((stage === 'setup' && text.startsWith('BEGIN')) || (stage === 'query' && text === sql)
          || (stage === 'commit' && text === 'COMMIT')) throw error;
        return { rows: [] };
      },
      release: () => {},
    });
    const pool = Object.assign(new EventEmitter(), { connect: async () => {
      if (stage === 'checkout') throw error;
      return client;
    } });
    observePostgresPoolErrors(pool as unknown as Pick<Pool, 'on'>, 'autonomous-repair');
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    const metrics = newReadTimings();
    try {
      await expect(readTimings.run(metrics, () => queryWithPostgresDeadline(pool as unknown as Pick<Pool, 'connect'>,
        sql, [{ token: 'private-parameter-value' }]))).rejects.toBe(error);
      expect(logger).toHaveBeenCalledTimes(1);
      const line = String(logger.mock.calls[0]?.[0]);
      const diagnostic = JSON.parse(line.slice(line.indexOf('{')));
      expect(diagnostic).toMatchObject({ pool: 'autonomous-repair', stage, sqlState: '57014' });
      expect(diagnostic.queryHash).toMatch(/^[a-f0-9]{16}$/);
      expect(diagnostic.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(line).not.toContain('private-');
      expect(line).not.toContain('example_rpc');
      expect(calls.filter(call => call === sql)).toHaveLength(stage === 'checkout' || stage === 'setup' ? 0 : 1);
      expect(client.listenerCount('error')).toBe(0);
      const sqlTiming = timingHeaders(metrics)['X-SQL-Execution-Ms'];
      if (stage === 'checkout' || stage === 'setup') expect(sqlTiming).toBe('unavailable');
      else expect(Number(sqlTiming)).toBeGreaterThanOrEqual(0);
      expect(metrics.sqlPending).toBe(0);
    } finally { logger.mockRestore(); }
  });
}

test('SQL timings exclude checkout, setup and commit while summing actual request queries', async () => {
  let now = 0;
  const clock = spyOn(performance, 'now').mockImplementation(() => now);
  const calls: string[] = [], releases: boolean[] = [];
  const client = Object.assign(new EventEmitter(), {
    query: async (sql: string) => {
      calls.push(sql);
      now += sql.startsWith('BEGIN') ? 31 : sql === 'COMMIT' ? 19 : 13;
      return { rows: [{ result: 1 }] };
    }, release: (destroy: boolean) => releases.push(destroy),
  });
  const pool = { connect: async () => { now += 17; return client; } } as unknown as Pick<Pool, 'connect'>;
  const metrics = newReadTimings();
  try {
    await readTimings.run(metrics, async () => {
      await queryWithPostgresDeadline(pool, 'select first', []);
      await queryWithPostgresDeadline(pool, 'select second', []);
    });
    expect(timingHeaders(metrics)).toMatchObject({
      'X-Pool-Acquisition-Ms': '17.0', 'X-IVX-Pool-Wait-Ms': '34.0', 'X-SQL-Execution-Ms': '26.0',
    });
    expect(metrics.sqlCompleted).toBe(2); expect(metrics.sqlPending).toBe(0);
    expect(calls.filter(sql => sql.startsWith('select'))).toEqual(['select first', 'select second']);
    expect(releases).toEqual([false, false]);
  } finally { clock.mockRestore(); }
});

test('pending SQL is unavailable and completing another request cannot borrow its timing', async () => {
  let unblock!: () => void, announceStart!: () => void;
  const started = new Promise<void>(resolve => { announceStart = resolve; });
  const hold = new Promise<void>(resolve => { unblock = resolve; });
  function pool(held: boolean) {
    const client = Object.assign(new EventEmitter(), {
      query: async (sql: string) => {
        if (sql === 'select measured' && held) { announceStart(); await hold; }
        return { rows: [] };
      }, release: () => {},
    });
    return { connect: async () => client } as unknown as Pick<Pool, 'connect'>;
  }
  const a = newReadTimings(), b = newReadTimings();
  const first = readTimings.run(a, () => queryWithPostgresDeadline(pool(true), 'select measured', []));
  try {
    await started;
    expect(a.sqlPending).toBe(1);
    expect(timingHeaders(a)['X-SQL-Execution-Ms']).toBe('unavailable');
    await readTimings.run(b, () => queryWithPostgresDeadline(pool(false), 'select measured', []));
    const secondHeaders = timingHeaders(b);
    expect(Number(secondHeaders['X-SQL-Execution-Ms'])).toBeGreaterThanOrEqual(0);
    expect(a.sqlCompleted).toBe(0); expect(b.sqlCompleted).toBe(1);
    unblock(); await first;
    expect(a.sqlPending).toBe(0); expect(a.sqlCompleted).toBe(1);
    expect(timingHeaders(b)).toEqual(secondHeaders);
    expect(timingHeaders(newReadTimings())['X-SQL-Execution-Ms']).toBe('unavailable');
  } finally { unblock(); await first; }
});

test('untrusted error codes are omitted and failed logging preserves the original error', async () => {
  const error = Object.assign(new Error('secret'), { code: 'secret-error-code' });
  const pool = { connect: async () => { throw error; } } as unknown as Pick<Pool, 'connect'>;
  const logger = spyOn(console, 'error').mockImplementation(() => { throw new Error('log unavailable'); });
  try {
    await expect(queryWithPostgresDeadline(pool, 'select $1', ['secret'])).rejects.toBe(error);
    expect(logger).toHaveBeenCalledTimes(1);
    const line = String(logger.mock.calls[0]?.[0]);
    expect(line).not.toContain('secret');
    expect(JSON.parse(line.slice(line.indexOf('{'))).sqlState).toBeNull();
  } finally { logger.mockRestore(); }
});

for (const deadline of ['default', 'assignment'] as const) {
for (const failAt of [null, 'select mutation', 'COMMIT', 'BEGIN', 'SET LOCAL lock_timeout']) {
  test(`${deadline} deadline transaction ${failAt ?? 'success'} cleans up without replay`, async () => {
    const calls: string[] = [], releases: boolean[] = [];
    const error = new Error('query timeout');
    const client = Object.assign(new EventEmitter(), {
      query: async (text: string) => { calls.push(text); if (failAt && text.includes(failAt)) throw error; return { rows: [{ result: 1 }] }; },
      release: (destroy: boolean) => releases.push(destroy),
    });
    const pool = { connect: async () => client } as unknown as Pick<Pool, 'connect'>;
    const result = queryWithPostgresDeadline(pool, 'select mutation', [], deadline);
    if (failAt) {
      await expect(result).rejects.toBe(error);
      expect(calls).not.toContain('ROLLBACK'); expect(releases).toEqual([true]);
    } else {
      expect((await result).rows).toEqual([{ result: 1 }]);
      expect(calls.at(-1)).toBe('COMMIT'); expect(releases).toEqual([false]);
    }
    const setupFailure = failAt === 'BEGIN' || failAt === 'SET LOCAL lock_timeout';
    expect(calls.filter(x => x === 'select mutation').length).toBe(setupFailure ? 0 : 1);
    expect(client.listenerCount('error')).toBe(0);
    expect(calls[0]).toContain("BEGIN; SET LOCAL statement_timeout = '2500ms'; SET LOCAL lock_timeout = '1000ms'; SET LOCAL idle_in_transaction_session_timeout = '5s'");
    if (!failAt) expect(calls.length).toBe(3);
  });
}
}

for (const disconnectAt of ['BEGIN', 'select mutation', 'COMMIT']) {
  test(`connection error at ${disconnectAt} rejects without replay or listener leaks`, async () => {
    const calls: string[] = [], releases: boolean[] = [];
    const error = new Error('Connection terminated unexpectedly');
    const client = Object.assign(new EventEmitter(), {
      query: async (text: string) => {
        calls.push(text);
        if (text.includes(disconnectAt)) client.emit('error', error);
        return { rows: [{ result: 1 }] };
      },
      release: (destroy: boolean) => releases.push(destroy),
    });
    await expect(queryWithPostgresDeadline({ connect: async () => client } as unknown as Pick<Pool, 'connect'>,
      'select mutation', [])).rejects.toBe(error);
    expect(releases).toEqual([true]);
    expect(calls).not.toContain('ROLLBACK');
    expect(calls.filter(x => x === 'select mutation').length).toBe(disconnectAt === 'BEGIN' ? 0 : 1);
    expect(client.listenerCount('error')).toBe(0);
  });
}

for (const code of [undefined, '08006', '57P01', '57014']) {
  test(`failed connection cleanup preserves rejection and pool capacity: ${code ?? 'client timeout'}`, async () => {
    const error = Object.assign(new Error('Query read timeout'), { code });
    const calls: string[] = [], releases: boolean[] = [];
    const client = Object.assign(new EventEmitter(), {
      query: async (text: string) => {
        calls.push(text);
        if (text === 'select mutation') throw error;
        if (text === 'ROLLBACK' && code !== '57014') {
          return new Promise<never>(() => {});
        }
        return { rows: [] };
      },
      release: (destroy: boolean) => releases.push(destroy),
    });
    const logger = spyOn(console, 'error').mockImplementation(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const operation = queryWithPostgresDeadline(
        { connect: async () => client } as unknown as Pick<Pool, 'connect'>, 'select mutation', []);
      const outcome = await Promise.race([
        operation.then(() => 'unexpected success', failure => failure),
        new Promise(resolve => { timer = setTimeout(() => resolve('cleanup stalled'), 100); }),
      ]);
      expect(outcome).toBe(error);
      expect(releases).toEqual([true]);
      expect(calls.filter(text => text === 'select mutation')).toHaveLength(1);
      expect(calls.includes('ROLLBACK')).toBe(code === '57014');
      expect(client.listenerCount('error')).toBe(0);
    } finally {
      clearTimeout(timer);
      logger.mockRestore();
    }
  });
}
