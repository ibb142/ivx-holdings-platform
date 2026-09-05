export const IVX_DURABLE_PRESSURE_GUARD_MARKER = 'ivx-durable-pressure-guard-2026-09-05-v1';

const DEFAULT_MAX = 12;
const MAX_CONCURRENT = Math.max(4, Math.min(32, Number.parseInt(process.env.IVX_DURABLE_MAX_CONCURRENT ?? String(DEFAULT_MAX), 10) || DEFAULT_MAX));

let inFlight = 0;
const waiters: Array<() => void> = [];

async function acquire(): Promise<void> {
  if (inFlight < MAX_CONCURRENT) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function release(): void {
  inFlight = Math.max(0, inFlight - 1);
  const next = waiters.shift();
  if (next) next();
}

export async function withDurablePressureGuard<T>(operation: () => Promise<T>): Promise<T> {
  await acquire();
  try {
    return await operation();
  } finally {
    release();
  }
}

export function getDurablePressureGuardStatus() {
  return {
    marker: IVX_DURABLE_PRESSURE_GUARD_MARKER,
    maxConcurrent: MAX_CONCURRENT,
    inFlight,
    queued: waiters.length,
  };
}
