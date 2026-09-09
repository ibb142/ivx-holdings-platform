import { expect, spyOn, test } from 'bun:test';
import * as store from '../services/ivx-postgres-autonomous-task-store';
import { reconcileRetryableBlockedTasks } from '../services/ivx-autonomous-blocked-reconciler';

test('the real reconciler reads the bounded recovery set instead of all queued payloads', async () => {
  const selected = spyOn(store, 'postgresAtomicQueueSelected').mockReturnValue(true);
  const recovery = spyOn(store, 'readPostgresRecoveryTasks').mockResolvedValue([]);
  const general = spyOn(store, 'readPostgresCurrentTasks').mockRejectedValue(new Error('Unbounded queued read must not run'));
  try {
    const result = await reconcileRetryableBlockedTasks();
    expect(recovery).toHaveBeenCalledTimes(1);
    expect(general).not.toHaveBeenCalled();
    expect(result.blockedSeen).toBe(0);
    expect(result.requeued).toBe(0);
    expect(result.errors).toBe(0);
  } finally {
    selected.mockRestore();
    recovery.mockRestore();
    general.mockRestore();
  }
});
