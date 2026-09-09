export type PersistenceStoreMode = 'dedicated' | 'jobs_fallback' | 'unavailable';
type Probe = { ok: boolean; status: number; error?: string | null };
type Resolution = { mode: PersistenceStoreMode; detail: string };

/** Share cold-start discovery; outages must not trigger DDL or change stores. */
export function createPersistenceStoreResolver(deps: {
  dedicated: () => Promise<Probe>;
  bootstrap: () => Promise<{ ok: boolean; detail: string }>;
  fallback: () => Promise<Probe>;
  now?: () => number;
}) {
  const now = deps.now ?? Date.now;
  let current: Resolution | null = null;
  let pending: Promise<Resolution> | null = null;
  let retryAt = 0;

  async function probe(): Promise<Resolution> {
    const dedicated = await deps.dedicated();
    if (dedicated.ok) return { mode: 'dedicated', detail: 'dedicated tables active' };
    if (dedicated.status !== 404) {
      return { mode: 'unavailable', detail: `dedicated store unavailable: ${dedicated.error ?? 'request failed'}` };
    }
    const bootstrap = await deps.bootstrap();
    if (bootstrap.ok) return { mode: 'dedicated', detail: bootstrap.detail };
    const fallback = await deps.fallback();
    return fallback.ok
      ? { mode: 'jobs_fallback', detail: `durable jobs-table store active; ${bootstrap.detail}` }
      : { mode: 'unavailable', detail: `no durable store reachable: ${fallback.error ?? 'request failed'}` };
  }

  return {
    snapshot: () => current,
    resolve(force = false): Promise<Resolution> {
      if (pending) return pending;
      if (!force && current && (current.mode !== 'unavailable' || now() < retryAt)) {
        return Promise.resolve(current);
      }
      pending = probe()
        .catch((): Resolution => ({ mode: 'unavailable', detail: 'store discovery unavailable' }))
        .then(result => {
          current = result;
          retryAt = result.mode === 'unavailable' ? now() + 5_000 : 0;
          return result;
        })
        .finally(() => { pending = null; });
      return pending;
    },
  };
}
