import type { FleetLeaseRequest, FleetLeaseResult, FleetTaskLeaseIdentity, FleetTaskMutationResult } from './ivx-autonomous-task-engine';

export const POSTGRES_FLEET_CLAIM_BATCH_SIZE = 4;

/** Commit and dispatch each bounded group before asking PostgreSQL for more.
 * A later timeout must not discard work already started by an earlier group.
 */
export async function refillFleetBatches(requests: readonly FleetLeaseRequest[], options: {
  batchSize: number;
  lease: (requests: readonly FleetLeaseRequest[]) => Promise<FleetLeaseResult[]>;
  start: (leases: readonly FleetTaskLeaseIdentity[]) => Promise<FleetTaskMutationResult[]>;
  onStarted: (result: FleetTaskMutationResult) => void;
  shouldStop: () => boolean;
}): Promise<void> {
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1) throw new Error('Positive fleet batch size required');
  for (let offset = 0; offset < requests.length; offset += options.batchSize) {
    if (options.shouldStop()) return;
    const leased = (await options.lease(requests.slice(offset, offset + options.batchSize)))
      .filter(result => result.ok && result.task);
    if (options.shouldStop()) return;
    if (!leased.length) continue;
    const started = await options.start(leased.map(result => ({ taskId: result.task!.taskId, workerId: result.workerId })));
    if (options.shouldStop()) return;
    for (const result of started) {
      if (result.ok && result.task) options.onStarted(result);
    }
  }
}
