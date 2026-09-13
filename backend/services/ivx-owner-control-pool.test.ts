import { afterEach, expect, spyOn, test } from 'bun:test';
import { Client } from 'pg';
import { EventEmitter } from 'node:events';
import * as control from './ivx-emergency-stop-postgres';

const environment = { ...process.env };
afterEach(async () => {
  await (control as { resetEmergencyStopPoolForTests?: () => Promise<void> }).resetEmergencyStopPoolForTests?.();
  process.env = { ...environment };
});
function fixture() {
  process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
  process.env.SUPABASE_DB_URL = 'postgresql://postgres:test@db.example.supabase.co/postgres';
  let connections = 0, closed = 0, active = false, fail = false;
  const sql: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  // Exercise the installed pg.Pool queue and reuse, substituting wire I/O only.
  const connect = spyOn(Client.prototype, 'connect').mockImplementation(function (callback?: (error: Error | null) => void) {
    connections++; if (callback) { queueMicrotask(() => callback(null)); return undefined as never; }
    return Promise.resolve() as never;
  });
  const query = spyOn(Client.prototype, 'query').mockImplementation((async (text: string) => {
    sql.push(text);
    if (!text.startsWith('SELECT ')) return { rows: [] };
    await gate;
    if (fail) throw Object.assign(new Error('cancelled'), { code: '57014' });
    return { rows: [{ control_name: 'emergency_stop', active }] };
  }) as never);
  const end = spyOn(Client.prototype, 'end').mockImplementation(function (this: Client) {
    closed++; (this as unknown as EventEmitter).emit('end'); return Promise.resolve() as never;
  });
  return { sql, release, connections: () => connections, closed: () => closed,
    setActive: (value: boolean) => { active = value; }, setFailure: (value: boolean) => { fail = value; },
    async cleanup() {
      release();
      await (control as { resetEmergencyStopPoolForTests?: () => Promise<void> }).resetEmergencyStopPoolForTests?.();
      connect.mockRestore(); query.mockRestore(); end.mockRestore();
    },
  };
}

test('112 simultaneous direct owner reads use one connection and one query', async () => {
  const f = fixture();
  try {
    const reads = Array.from({ length: 112 }, () => control.readEmergencyStopPostgres());
    await new Promise<void>(resolve => setImmediate(resolve)); f.release();
    const values = await Promise.all(reads);
    expect(values).toHaveLength(112);
    expect(f.connections()).toBe(1);
    expect(f.sql.filter(sql => sql.startsWith('SELECT '))).toHaveLength(1);
  } finally { await f.cleanup(); }
});
test('successive reads reuse a connection but observe a newly activated stop', async () => {
  const f = fixture(); f.release();
  try {
    expect(await control.readEmergencyStopPostgres()).toEqual([{ control_name: 'emergency_stop', active: false }]);
    f.setActive(true);
    expect(await control.readEmergencyStopPostgres()).toEqual([{ control_name: 'emergency_stop', active: true }]);
    expect(f.connections()).toBe(1);
    expect(f.sql.filter(sql => sql.startsWith('SELECT '))).toHaveLength(2);
  } finally { await f.cleanup(); }
});
test('owner reads install transaction-local deadlines before reading the stop', async () => {
  const f = fixture(); f.release();
  try {
    await control.readEmergencyStopPostgres();
    expect(f.sql[0]).toContain('BEGIN');
    expect(f.sql[0]).toContain("statement_timeout = '2500ms'");
    expect(f.sql[0]).toContain("lock_timeout = '1000ms'");
    expect(f.sql.at(-1)).toBe('COMMIT');
  } finally { await f.cleanup(); }
});
test('a rejected read is not cached and its connection cannot be reused', async () => {
  const f = fixture(); f.release(); f.setFailure(true);
  try {
    await expect(control.readEmergencyStopPostgres()).rejects.toThrow('cancelled');
    expect(f.closed()).toBe(1);
    f.setFailure(false); f.setActive(true);
    expect(await control.readEmergencyStopPostgres()).toEqual([{ control_name: 'emergency_stop', active: true }]);
    expect(f.connections()).toBe(2);
  } finally { await f.cleanup(); }
});
test('an existing pool cannot answer a newly configured project', async () => {
  const f = fixture(); f.release();
  try {
    await control.readEmergencyStopPostgres();
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://other.supabase.co';
    process.env.SUPABASE_DB_URL = 'postgresql://postgres:test@db.other.supabase.co/postgres';
    await expect(control.readEmergencyStopPostgres()).rejects.toThrow('binding_changed');
    expect(f.connections()).toBe(1);
    expect(f.sql.filter(sql => sql.startsWith('SELECT '))).toHaveLength(1);
  } finally { await f.cleanup(); }
});
