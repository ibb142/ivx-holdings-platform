import { expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { queryWithPostgresDeadline } from './ivx-postgres-deadline';
import { EventEmitter } from 'node:events';

for (const failAt of [null, 'select mutation', 'COMMIT', 'BEGIN']) {
  test(`deadline transaction ${failAt ?? 'success'} cleans up without replay`, async () => {
    const calls: string[] = [], releases: boolean[] = [];
    const error = new Error('query timeout');
    const pool = { connect: async () => Object.assign(new EventEmitter(), {
      query: async (text: string) => { calls.push(text); if (text === failAt) throw error; return { rows: [{ result: 1 }] }; },
      release: (destroy: boolean) => releases.push(destroy),
    }) } as unknown as Pick<Pool, 'connect'>;
    const result = queryWithPostgresDeadline(pool, 'select mutation', []);
    if (failAt) {
      await expect(result).rejects.toBe(error);
      expect(calls.at(-1)).toBe('ROLLBACK'); expect(releases).toEqual([true]);
    } else {
      expect((await result).rows).toEqual([{ result: 1 }]);
      expect(calls.at(-1)).toBe('COMMIT'); expect(releases).toEqual([false]);
    }
    expect(calls.filter(x => x === 'select mutation').length).toBe(failAt === 'BEGIN' ? 0 : 1);
    if (failAt !== 'BEGIN') expect(calls.slice(0,5)).toEqual([
      'BEGIN', "SET LOCAL statement_timeout = '4s'", "SET LOCAL lock_timeout = '2s'",
      "SET LOCAL idle_in_transaction_session_timeout = '8s'", 'select mutation',
    ]);
});
}

test('a checked-out client disconnect fails the operation without crashing or replaying', async () => {
  const client = new EventEmitter();
  const calls: string[] = [], releases: boolean[] = [];
  const disconnected = new Error('Connection terminated unexpectedly');
  Object.assign(client, {
    query: async (text: string) => {
      calls.push(text);
      if (text === 'select mutation') client.emit('error', disconnected);
      return { rows: [{ result: 1 }] };
    },
    release: (destroy: boolean) => { releases.push(destroy); assertListener(); },
  });
  function assertListener() { expect(client.listenerCount('error')).toBe(1); }
  const pool = { connect: async () => client } as unknown as Pick<Pool, 'connect'>;
  await expect(queryWithPostgresDeadline(pool, 'select mutation', [])).rejects.toBe(disconnected);
  expect(calls.filter(text => text === 'select mutation')).toHaveLength(1);
  expect(calls.at(-1)).toBe('ROLLBACK');
  expect(calls).not.toContain('COMMIT');
  expect(releases).toEqual([true]);
  expect(client.listenerCount('error')).toBe(0);
});
