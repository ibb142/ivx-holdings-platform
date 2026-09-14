import { emergencyStopPostgresConfig } from './ivx-emergency-stop-postgres';

// Both controls must finish before the truth supervisor's 2.5-second deadline.
// Reserve time for the already configured, same-project Postgres transport.
export const OWNER_CONTROL_READ_TIMEOUT_MS = 2_000;
export const OWNER_CONTROL_REST_BUDGET_MS = 750;

function withinDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const aborted = () => reject(signal.reason);
    signal.addEventListener('abort', aborted, { once: true });
    work.then(value => {
      signal.removeEventListener('abort', aborted);
      if (signal.aborted) reject(signal.reason); else resolve(value);
    }, error => {
      signal.removeEventListener('abort', aborted);
      reject(error);
    });
    if (signal.aborted) aborted();
  });
}

/** A failed or late read never returns a cached permission to its caller. */
export async function readOwnerControlWithFallback<T>(
  readRest: (signal: AbortSignal) => Promise<T>,
  readPostgres: () => Promise<T>,
  canFailOverOnError: (error: unknown) => boolean = () => false,
): Promise<T> {
  let directConfigured = false;
  try { emergencyStopPostgresConfig(); directConfigured = true; } catch { /* Keep the REST-only read bounded. */ }
  const deadline = new AbortController();
  const rest = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error('owner_control_read_timeout_2000ms')), OWNER_CONTROL_READ_TIMEOUT_MS);
  const restTimer = directConfigured
    ? setTimeout(() => rest.abort(new Error('owner_control_rest_timeout_750ms')), OWNER_CONTROL_REST_BUDGET_MS)
    : undefined;
  const signal = AbortSignal.any([deadline.signal, rest.signal]);
  try {
    try {
      return await withinDeadline(readRest(signal), signal);
    } catch (error) {
      deadline.signal.throwIfAborted();
      // Campaign reads fail over only on our own transport deadline. The stop
      // gate also permits its existing 5xx/transport errors, never 401/403/429.
      if (!directConfigured || (!rest.signal.aborted && !canFailOverOnError(error))) throw error;
      return await withinDeadline(readPostgres(), deadline.signal);
    }
  } finally {
    clearTimeout(timer);
    clearTimeout(restTimer);
  }
}
