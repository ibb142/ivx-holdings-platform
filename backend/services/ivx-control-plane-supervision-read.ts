/** Keep slow certification/repair work from blocking the live telemetry view. */
export function createSupervisionRead<T>(read: () => Promise<T>, waitMs = 5_000, cacheMs = 30_000) {
  let pending: Promise<T | null> | null = null;
  let cached: { value: T; at: number } | null = null;
  return async (): Promise<T | null> => {
    if (cached && Date.now() - cached.at < cacheMs) return cached.value;
    if (!pending) {
      pending = Promise.resolve().then(read).then(value => {
        cached = { value, at: Date.now() };
        return value;
      }).catch(() => null).finally(() => { pending = null; });
    }
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), waitMs); });
    try { return await Promise.race([pending, deadline]); }
    finally { clearTimeout(timer!); }
  };
}
