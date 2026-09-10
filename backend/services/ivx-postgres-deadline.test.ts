import { expect, test } from 'bun:test';
import type { Pool } from 'pg';
import { queryWithPostgresDeadline } from './ivx-postgres-deadline';

for (const failAt of [null, 'select mutation', 'COMMIT', 'BEGIN']) {
  test(`deadline transaction ${failAt ?? 'success'} cleans up without replay`, async () => {
    const calls: string[] = [], releases: boolean[] = [];
    const error = new Error('query timeout');
    const pool = { connect: async () => ({
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
