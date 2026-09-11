import type { FleetLeaseRequest, FleetLeaseResult } from './ivx-autonomous-task-engine';

/** Fast completion wakeups must not repoll every empty lane before its normal tick. */
export function createEmptyClaimCooldown(intervalMs: number) {
  if (!Number.isInteger(intervalMs) || intervalMs < 1 || intervalMs > 5_000) {
    throw new Error('Empty claim cooldown must be within the five-second refill interval');
  }
  const empty = new Map<string, { scope: string; observedAt: number }>();
  return {
    canClaim(workerId: string, scope: string, now = Date.now()): boolean {
      const sample = empty.get(workerId);
      if (!sample) return true;
      if (sample.scope !== scope || now < sample.observedAt || now - sample.observedAt >= intervalMs) {
        empty.delete(workerId);
        return true;
      }
      return false;
    },
    observe(requests: readonly FleetLeaseRequest[], results: readonly FleetLeaseResult[], scope: string, now = Date.now()) {
      const requested = new Set(requests.map(request => request.workerId));
      for (const result of results) {
        if (!requested.has(result.workerId)) continue;
        if (result.ok && result.task === null && !result.error) {
          empty.set(result.workerId, { scope, observedAt: now });
        } else {
          empty.delete(result.workerId);
        }
      }
    },
    clear() { empty.clear(); },
  };
}
