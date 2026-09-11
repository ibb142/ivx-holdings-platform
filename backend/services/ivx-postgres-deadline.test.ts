import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { queryWithPostgresDeadline } from './ivx-postgres-deadline';

for (const failAt of [null, 'select mutation', 'COMMIT', 'BEGIN', 'SET LOCAL lock_timeout']) {
  test(`deadline transaction ${failAt ?? 'success'} cleans up without replay`, async () => {
    const calls: string[] = [], releases: boolean[] = [];
    const error = new Error('query timeout');
    const client = Object.assign(new EventEmitter(), {
      query: async (text: string) => { calls.push(text); if (failAt && text.includes(failAt)) throw error; return { rows: [{ result: 1 }] }; },
      release: (destroy: boolean) => releases.push(destroy),
    });
    const pool = { connect: async () => client } as unknown as Pick<Pool, 'connect'>;
    const result = queryWithPostgresDeadline(pool, 'select mutation', []);
    if (failAt) {
      await expect(result).rejects.toBe(error);
      expect(calls.at(-1)).toBe('ROLLBACK'); expect(releases).toEqual([true]);
    } else {
      expect((await result).rows).toEqual([{ result: 1 }]);
      expect(calls.at(-1)).toBe('COMMIT'); expect(releases).toEqual([false]);
    }
    const setupFailure = failAt === 'BEGIN' || failAt === 'SET LOCAL lock_timeout';
    expect(calls.filter(x => x === 'select mutation').length).toBe(setupFailure ? 0 : 1);
    expect(client.listenerCount('error')).toBe(0);
    expect(calls[0]).toContain("BEGIN; SET LOCAL statement_timeout = '4s'; SET LOCAL lock_timeout = '2s'; SET LOCAL idle_in_transaction_session_timeout = '8s'");
    if (!failAt) expect(calls.length).toBe(3);
  });
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
    expect(calls.at(-1)).toBe('ROLLBACK');
    expect(calls.filter(x => x === 'select mutation').length).toBe(disconnectAt === 'BEGIN' ? 0 : 1);
    expect(client.listenerCount('error')).toBe(0);
  });
}
