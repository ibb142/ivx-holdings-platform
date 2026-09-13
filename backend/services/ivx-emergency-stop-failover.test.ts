import { describe, expect, it } from 'bun:test';
import { emergencyStopPostgresConfig, emergencyStopReadCanFailOver } from './ivx-emergency-stop-postgres';

const moduleUrl = new URL('./ivx-emergency-stop-gate.ts', import.meta.url).href;
function scenario(restStatus: number, active: unknown, directFails = false, missingRow = false) {
  const child = Bun.spawnSync([process.execPath, '--eval', `
    import { spyOn } from 'bun:test';
    import { Client, Pool } from 'pg';
    let reads = 0, connects = 0, closed = 0;
    const nativeCheckout = Pool.prototype.connect;
    spyOn(Pool.prototype, 'connect').mockImplementation(function () {
      const config = this.options;
      if (config.ssl.rejectUnauthorized !== true || config.query_timeout !== 3000 || config.statement_timeout !== 3000) throw new Error('unbounded or unverified connection');
      return nativeCheckout.call(this);
    });
    spyOn(Client.prototype, 'connect').mockImplementation(callback => {
      connects++; queueMicrotask(() => callback(null));
    });
    spyOn(Client.prototype, 'query').mockImplementation(async (sql, args) => {
      if (sql.startsWith('BEGIN')) {
        if (!sql.includes("statement_timeout = '2500ms'") || !sql.includes("lock_timeout = '1000ms'")) throw new Error('missing local deadline');
        return { rows: [] };
      }
      if (sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (!sql.startsWith('SELECT ') || args[0] !== 'emergency_stop') throw new Error('unexpected SQL');
      reads++;
      if (${directFails}) throw new Error('direct timeout');
      return {rows: ${missingRow} ? [] : [{control_name:'emergency_stop', active:${JSON.stringify(active)}}]};
    });
    spyOn(Client.prototype, 'end').mockImplementation(function () {
      closed++; this.emit('end'); return Promise.resolve();
    });
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://testproject.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only';
    process.env.SUPABASE_DB_URL = 'postgresql://postgres:test@db.testproject.supabase.co/postgres';
    globalThis.fetch = async () => Response.json({}, {status:${restStatus}});
    const {assertEmergencyStopInactive} = await import(${JSON.stringify(moduleUrl)});
    const outcomes = await Promise.allSettled(Array.from({length:112}, () => assertEmergencyStopInactive('test')));
    const { resetEmergencyStopPoolForTests } = await import(${JSON.stringify(new URL('./ivx-emergency-stop-postgres.ts', import.meta.url).href)});
    await resetEmergencyStopPoolForTests();
    console.log(JSON.stringify({reads,connects,closed,
      passed:outcomes.filter(x=>x.status==='fulfilled'&&x.value.source==='postgres').length,
      stopped:outcomes.filter(x=>x.status==='rejected'&&x.reason.message.startsWith('EMERGENCY_STOP_ACTIVE:')).length,
      unavailable:outcomes.filter(x=>x.status==='rejected'&&x.reason.message.startsWith('EMERGENCY_STOP_UNAVAILABLE:')).length}));
  `], { stdout: 'pipe', stderr: 'pipe', timeout: 10_000 });
  if (child.exitCode !== 0) throw new Error(new TextDecoder().decode(child.stderr));
  return JSON.parse(new TextDecoder().decode(child.stdout).trim().split('\n').at(-1)!);
}

describe('owner stop transport recovery', () => {
  it('recovers 112 simultaneous guards through one bounded direct read', () => {
    expect(scenario(503, false)).toEqual({reads:1, connects:1, closed:1, passed:112, stopped:0, unavailable:0});
  });
  it('honors the real owner stop on the alternative transport', () => {
    expect(scenario(503, true)).toEqual({reads:1, connects:1, closed:1, passed:0, stopped:112, unavailable:0});
  });
  it('fails closed and closes the connection when both transports fail', () => {
    expect(scenario(503, false, true)).toEqual({reads:1, connects:1, closed:1, passed:0, stopped:0, unavailable:112});
  });
  it('never treats malformed or absent direct control data as permission', () => {
    expect(scenario(503, 'false').unavailable).toBe(112);
    expect(scenario(503, false, false, true).unavailable).toBe(112);
  });
  it('does not bypass REST authorization or throttling', () => {
    for (const status of [401,403,429]) {
      expect(scenario(status, false)).toEqual({reads:0, connects:0, closed:0, passed:0, stopped:0, unavailable:112});
    }
  });
  it('permits only transport failures and 5xx to select the fallback', () => {
    for (const error of [new Error('fetch failed'),new Error('getaddrinfo ENOTFOUND base'),new DOMException('aborted','TimeoutError'),new Error('HTTP 503')]) expect(emergencyStopReadCanFailOver(error)).toBe(true);
    for (const error of [new Error('HTTP 403 timeout'), new Error('HTTP 429'),new SyntaxError('Unexpected JSON token')]) expect(emergencyStopReadCanFailOver(error)).toBe(false);
  });
  it('rejects a different database or invalid host instead of reading an unrelated owner stop', () => {
    for (const db of ['postgresql://postgres:test@base/postgres','postgresql://postgres:test@db.other.supabase.co/postgres','postgresql://postgres.other:test@aws-0-us-west-2.pooler.supabase.com/postgres']) {
      expect(() => emergencyStopPostgresConfig({EXPO_PUBLIC_SUPABASE_URL:'https://testproject.supabase.co',SUPABASE_DB_URL:db})).toThrow('project_mismatch');
    }
    const config = emergencyStopPostgresConfig({EXPO_PUBLIC_SUPABASE_URL:'https://testproject.supabase.co',SUPABASE_DB_URL:'postgresql://postgres.testproject:test@aws-0-us-west-2.pooler.supabase.com/postgres?sslmode=disable'});
    expect(config.ssl.rejectUnauthorized).toBe(true);
    expect(config.ssl.ca).toBeDefined();
  });
});
