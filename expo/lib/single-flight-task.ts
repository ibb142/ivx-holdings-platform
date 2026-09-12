/** Share pending work; a later call can start again after success or failure. */
export function createSingleFlightTask<T>(task: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    if (!pending) {
      pending = Promise.resolve().then(task).finally(() => {
        pending = null;
      });
    }
    return pending;
  };
}
