/** Share expensive durable reads while preserving the time they were observed. */
export function createDashboardReadCache<T>(
  read: () => Promise<T>,
  valid: (value: T) => boolean,
  ttlMs = 5000,
  clock = Date.now,
): () => Promise<{ value: T; observedAt: string }> {
  let cached: { value: T; observedAt: string } | null = null;
  let pending: Promise<{ value: T; observedAt: string }> | null = null;
  return () => {
    if (cached && clock() - Date.parse(cached.observedAt) < ttlMs) return Promise.resolve(cached);
    if (!pending) {
      pending = Promise.resolve().then(read).then(value => {
        const result = { value, observedAt: new Date(clock()).toISOString() };
        cached = valid(value) ? result : null;
        return result;
      }).finally(() => { pending = null; });
    }
    return pending;
  };
}
