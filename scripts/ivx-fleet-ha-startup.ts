import assert from 'node:assert/strict';

export class HAStartupPendingError extends Error {}

export function requireStartupSha(observed: unknown, expected: string, surface: string): void {
  assert(/^[a-f0-9]{40}$/.test(expected), 'Malformed certification target SHA');
  assert(typeof observed === 'string' && /^[a-f0-9]{40}$/.test(observed), `Malformed SHA at ${surface}`);
  if (observed !== expected) throw new HAStartupPendingError(`${surface}: observed ${observed}, waiting for ${expected}`);
}

export function validateHATopology(value: any, sha: string, now = Date.now()): void {
  assert.equal(value?.marker, 'ivx-api-worker-ha-2026-09-08-v1');
  const measuredAt = Date.parse(value.measuredAt);
  assert(Number.isFinite(measuredAt) && measuredAt <= now + 2_000, 'Malformed or future HA observation');
  requireStartupSha(value.commitSha, sha, 'Shared HA topology');
  if (now - measuredAt > 15_000) throw new HAStartupPendingError('Waiting for a fresh HA observation');
}

export async function waitForHAStartup<T>(read: () => Promise<T>, options: {
  attempts?: number; sleep?: (ms: number) => Promise<void>; onPending?: (attempt: number, detail: string) => void;
} = {}): Promise<T> {
  const attempts = options.attempts ?? 36;
  const sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  assert(Number.isInteger(attempts) && attempts > 0, 'Invalid startup attempt limit');
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await read(); }
    catch (error) {
      if (!(error instanceof HAStartupPendingError)) throw error;
      options.onPending?.(attempt, error.message);
      if (attempt === attempts) throw new Error(`HA startup did not converge after ${attempts} probes: ${error.message}`);
      await sleep(5_000);
    }
  }
  throw new Error('HA startup did not converge');
}
