import { configuredAdmissionLimit } from './ivx-fleet-admission-policy';

export const FLEET_CONFIG = Object.freeze({
  GLOBAL_CONCURRENCY_LIMIT: 112,
  MINIMUM_WORK_WINDOW_HOURS: 20,
  MAXIMUM_WORK_WINDOW_HOURS: 24,
  LEASE_RENEWAL_INTERVAL_MS: 30_000,
  LEASE_EXPIRY_TIMEOUT_MS: 90_000,
});

/** A global ceiling may lower admission, but never overrides a path's stop. */
export function fleetPathConcurrency(env: NodeJS.ProcessEnv, pathKey: string, fallback: number): number {
  const global = env.GLOBAL_WORKER_CONCURRENCY_LIMIT;
  const ceiling = configuredAdmissionLimit(global, FLEET_CONFIG.GLOBAL_CONCURRENCY_LIMIT);
  return Math.min(ceiling, configuredAdmissionLimit(env[pathKey], global === undefined ? fallback : ceiling));
}

/** Service continuity targets; individual tasks retain their own deadlines.
 * Durable queue recovery resumes unfinished work after process replacement.
 * Owner stop, missing authority and budget exhaustion always take precedence.
 */
export function readFleetOperatingWindow(env: NodeJS.ProcessEnv = process.env) {
  const hours = (key: string, fallback: number): number => {
    const raw = env[key];
    if (raw === undefined) return fallback;
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new Error(`INVALID_${key}`);
    return Number(raw);
  };
  const minimumHours = hours('MIN_AUTONOMY_HOURS', FLEET_CONFIG.MINIMUM_WORK_WINDOW_HOURS);
  const maximumHours = hours('MAX_AUTONOMY_HOURS', FLEET_CONFIG.MAXIMUM_WORK_WINDOW_HOURS);
  if (minimumHours < 20 || maximumHours > 24 || minimumHours > maximumHours) {
    throw new Error('INVALID_FLEET_OPERATING_WINDOW');
  }
  return { minimumHours, maximumHours, scope: 'recoverable_service_objective' as const };
}
