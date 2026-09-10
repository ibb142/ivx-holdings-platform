import type { FleetLeaseRequest, FleetLeaseResult, FleetTaskLeaseIdentity, FleetTaskMutationResult } from './ivx-autonomous-task-engine';

export const POSTGRES_FLEET_CLAIM_BATCH_SIZE = 4;

/** A committed physical lease takes precedence over an older display snapshot.
 * Local executions and owner controls still veto dispatch.
 */
export function preparedContinuityAllowed(input: {
  enabled: boolean; stopping: boolean; hasLocalRun: boolean; atCapacity: boolean;
  state?: { pauseState: boolean; disabledState: boolean; health: string; activeTaskId?: string | null };
}): boolean {
  return input.enabled && !input.stopping && !input.hasLocalRun && !input.atCapacity
    && Boolean(input.state && !input.state.pauseState && !input.state.disabledState && input.state.health !== 'failed');
}

/** Commit and dispatch each bounded group before asking PostgreSQL for more.
 * A later timeout must not discard work already started by an earlier group.
 */
export async function refillFleetBatches(requests: readonly FleetLeaseRequest[], options: {
  batchSize: number;
  lease: (requests: readonly FleetLeaseRequest[]) => Promise<FleetLeaseResult[]>;
  start: (leases: readonly FleetTaskLeaseIdentity[]) => Promise<FleetTaskMutationResult[]>;
  onStarted: (result: FleetTaskMutationResult) => boolean | Promise<boolean>;
  release: (lease: FleetTaskLeaseIdentity) => Promise<void>;
  shouldStop: () => boolean;
}): Promise<void> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) throw new Error('Positive fleet batch size required');
  for (let offset = 0; offset < requests.length; offset += options.batchSize) {
    if (options.shouldStop()) return;
    const leased = (await options.lease(requests.slice(offset, offset + options.batchSize)))
      .filter(result => result.ok && result.task);
    if (!leased.length) continue;
    const identities = leased.map(result => ({ taskId: result.task!.taskId, workerId: result.workerId }));
    const accepted = new Set<string>();
    try {
      if (options.shouldStop()) return;
      const started = await options.start(identities);
      for (const result of started) {
        if (options.shouldStop()) break;
        if (result.ok && result.task && await options.onStarted(result)) accepted.add(result.task.taskId);
      }
    } finally {
      // RUNNING in PostgreSQL is not proof that a local executor accepted it.
      // Release every unaccepted lease, including shutdown and callback errors.
      // The release operation retains the physical-worker ownership fence.
      const errors: unknown[] = [];
      for (const identity of identities) {
        if (accepted.has(identity.taskId)) continue;
        try { await options.release(identity); } catch (error) { errors.push(error); }
      }
      if (errors.length) throw new AggregateError(errors, 'PREPARED_TASK_RELEASE_FAILED');
    }
  }
}
