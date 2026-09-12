type Video = { id: string };

/** Share only overlapping public reads. Viewer state is never an input or result. */
export function createPlatformFeedLoader<V extends Video, M, C, P, A, D>(sources: {
  videos: (projectId: string | null) => Promise<V[]>;
  meta: () => Promise<M>;
  counts: (ids: string[]) => Promise<C>;
  playback: () => Promise<P>;
  analytics: () => Promise<A>;
  deals: () => Promise<D>;
  mediaCandidates: (videos: V[], meta: M) => Promise<Set<string>>;
}, maxPending = 32) {
  type Snapshot = { videos: V[]; meta: M; counts: C; playback: P; analytics: A; deals: D; mediaCandidates: Set<string> };
  const pending = new Map<string, Promise<Snapshot>>();
  const call = <T>(dependency: string, read: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    const report = (outcome: 'success' | 'failure', error?: unknown) => {
      try {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        // Fixed dependency names only: no project IDs, URLs, values or error messages.
        console.info('[IVX Feed dependency] ' + JSON.stringify({
          dependency, outcome, elapsedMs: Math.max(0, Date.now() - startedAt),
          sqlState: typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : null,
        }));
      } catch { /* Diagnostics must not change feed behavior. */ }
    };
    return Promise.resolve().then(read).then(
      value => { report('success'); return value; },
      error => { report('failure', error); throw error; },
    );
  };

  return async (projectId: string | null): Promise<Snapshot> => {
    const key = JSON.stringify(projectId);
    let work = pending.get(key);
    if (!work) {
      if (pending.size >= maxPending) throw new Error('Feed source read capacity exceeded');
      const videos = call('videos', () => sources.videos(projectId));
      const meta = call('meta', sources.meta);
      const counts = videos.then(rows => call('counts', () => sources.counts(rows.map(row => String(row.id)))));
      const mediaCandidates = Promise.all([videos, meta]).then(([rows, metadata]) => call('media_metadata', () => sources.mediaCandidates(rows, metadata)));
      // Start independent reads together, instead of adding their individual
      // deadlines. Keep failed reads attached until every producer settles so a
      // timeout cannot cause duplicate background work on the next request.
      work = call('total', () => Promise.allSettled([videos, meta, counts, call('playback', sources.playback),
        call('analytics', sources.analytics), call('deals', sources.deals), mediaCandidates] as const).then(results => {
        for (const result of results) if (result.status === 'rejected') throw result.reason;
        const [v, m, c, p, a, d, candidateIds] = results as [
          PromiseFulfilledResult<V[]>, PromiseFulfilledResult<M>, PromiseFulfilledResult<C>,
          PromiseFulfilledResult<P>, PromiseFulfilledResult<A>, PromiseFulfilledResult<D>, PromiseFulfilledResult<Set<string>>,
        ];
        return { videos: v.value, meta: m.value, counts: c.value, playback: p.value,
          analytics: a.value, deals: d.value, mediaCandidates: candidateIds.value };
      })).finally(() => { if (pending.get(key) === work) pending.delete(key); });
      pending.set(key, work);
    }
    // Callers normalize metadata while composing their own page. Never let one
    // request mutate another request's shared snapshot. No settled value is cached.
    return structuredClone(await work);
  };
}
