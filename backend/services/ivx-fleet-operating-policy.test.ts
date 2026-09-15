import { expect, test } from 'bun:test';
import { FLEET_CONFIG, fleetPathConcurrency, readFleetOperatingWindow } from './ivx-fleet-operating-policy';
import { readFleetConfig } from './agents/multi-agent-framework';

test('one global ceiling reaches both worker paths without overriding a local stop', () => {
  for (const path of ['IVX_AUTONOMOUS_CONTINUITY_MAX_CONCURRENCY', 'IVX_WORKER_MAX_CONCURRENCY',
    'IVX_AI_SHORT_POOL_MAX', 'IVX_AI_LONG_POOL_MAX']) {
    expect(fleetPathConcurrency({ GLOBAL_WORKER_CONCURRENCY_LIMIT: '112' }, path, 12)).toBe(112);
    expect(fleetPathConcurrency({ GLOBAL_WORKER_CONCURRENCY_LIMIT: '112', [path]: '0' }, path, 12)).toBe(0);
    expect(fleetPathConcurrency({ GLOBAL_WORKER_CONCURRENCY_LIMIT: '112', [path]: '8' }, path, 12)).toBe(8);
    expect(fleetPathConcurrency({ GLOBAL_WORKER_CONCURRENCY_LIMIT: '8', [path]: '112' }, path, 12)).toBe(8);
    expect(fleetPathConcurrency({ GLOBAL_WORKER_CONCURRENCY_LIMIT: 'invalid', [path]: '112' }, path, 12)).toBe(0);
    expect(fleetPathConcurrency({}, path, 12)).toBe(12);
  }
});

test('20–24-hour continuity is a service objective, with invalid windows refused', () => {
  expect(readFleetOperatingWindow({})).toEqual({ minimumHours: 20, maximumHours: 24, scope: 'recoverable_service_objective' });
  expect(readFleetOperatingWindow({ MIN_AUTONOMY_HOURS: '24' }).minimumHours).toBe(24);
  for (const env of [{ MIN_AUTONOMY_HOURS: '19' }, { MAX_AUTONOMY_HOURS: '25' },
    { MIN_AUTONOMY_HOURS: '24', MAX_AUTONOMY_HOURS: '20' }, { MIN_AUTONOMY_HOURS: '20h' }]) {
    expect(() => readFleetOperatingWindow(env)).toThrow();
  }
});

test('fleet defaults admit 112 with 30/90-second leases and retain bounded task deadlines', () => {
  const env = { SUPABASE_DB_URL: 'postgres://test:test@localhost:6543/postgres' };
  const config = readFleetConfig(env);
  expect(config.localConcurrency).toBe(112);
  expect(config.heartbeatMs).toBe(FLEET_CONFIG.LEASE_RENEWAL_INTERVAL_MS);
  expect(config.leaseMs).toBe(FLEET_CONFIG.LEASE_EXPIRY_TIMEOUT_MS);
  expect(config.taskTimeoutMs).toBe(600_000);
  expect(() => readFleetConfig({ ...env, IVX_FLEET_HEARTBEAT_MS: '30001' })).toThrow();
  expect(() => readFleetConfig({ ...env, GLOBAL_WORKER_CONCURRENCY_LIMIT: '0' })).toThrow('FLEET_ADMISSION_DISABLED');
});
