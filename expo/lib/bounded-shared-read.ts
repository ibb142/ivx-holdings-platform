/** Share optional remote discovery without allowing it to block the UI. */
export function createBoundedSharedRead<T>(read: (signal: AbortSignal) => Promise<T>, fallback: T, timeoutMs = 6_000) {
  let cached: { value: T; at: number } | null = null;
  let pending: { promise: Promise<T>; controller: AbortController } | null = null;
  let generation = 0;
  return {
    peek: () => cached?.value ?? null,
    invalidate() {
      generation += 1;
      cached = null;
      pending?.controller.abort();
      pending = null;
    },
    get(): Promise<T> {
      if (cached && Date.now() - cached.at < (cached.value === fallback ? 10_000 : 60_000)) return Promise.resolve(cached.value);
      if (pending) return pending.promise;
      const controller = new AbortController();
      const currentGeneration = generation;
      const deadline = new Promise<T>(resolve => controller.signal.addEventListener('abort', () => resolve(fallback), { once: true }));
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const promise = Promise.race([Promise.resolve().then(() => read(controller.signal)), deadline])
        .catch(() => fallback)
        .then(value => {
          if (generation === currentGeneration) cached = { value, at: Date.now() };
          return value;
        })
        .finally(() => {
          clearTimeout(timer);
          if (pending?.controller === controller) pending = null;
        });
      pending = { promise, controller };
      return promise;
    },
  };
}
