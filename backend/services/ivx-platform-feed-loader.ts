type Video = { id: string };

/** Share only overlapping public reads. Viewer state is never an input or result. */
export function createPlatformFeedLoader<V extends Video, M, C, P, A, D>(sources: {
  videos: (projectId: string | null) => Promise<V[]>;
  meta: () => Promise<M>;
  counts: (ids: string[]) => Promise<C>;
  playback: () => Promise<P>;
  analytics: () => Promise<A>;
  deals: () => Promise<D>;
  playable: (videos: V[], meta: M) => Promise<Set<string>>;
}, maxPending = 32) {
  type Snapshot = { videos: V[]; meta: M; counts: C; playback: P; analytics: A; deals: D; playable: Set<string> };
  const pending = new Map<string, Promise<Snapshot>>();
  const call = <T>(read: () => Promise<T>): Promise<T> => Promise.resolve().then(read);

  return async (projectId: string | null): Promise<Snapshot> => {
    const key = JSON.stringify(projectId);
    let work = pending.get(key);
    if (!work) {
      if (pending.size >= maxPending) throw new Error('Feed source read capacity exceeded');
      const videos = call(() => sources.videos(projectId));
      const meta = call(sources.meta);
      const counts = videos.then(rows => sources.counts(rows.map(row => String(row.id))));
      const playable = Promise.all([videos, meta]).then(([rows, metadata]) => sources.playable(rows, metadata));
      // Start independent reads together, instead of adding their individual
      // deadlines. Keep failed reads attached until every producer settles so a
      // timeout cannot cause duplicate background work on the next request.
      work = Promise.allSettled([videos, meta, counts, call(sources.playback),
        call(sources.analytics), call(sources.deals), playable] as const).then(results => {
        for (const result of results) if (result.status === 'rejected') throw result.reason;
        const [v, m, c, p, a, d, playableIds] = results as [
          PromiseFulfilledResult<V[]>, PromiseFulfilledResult<M>, PromiseFulfilledResult<C>,
          PromiseFulfilledResult<P>, PromiseFulfilledResult<A>, PromiseFulfilledResult<D>, PromiseFulfilledResult<Set<string>>,
        ];
        return { videos: v.value, meta: m.value, counts: c.value, playback: p.value,
          analytics: a.value, deals: d.value, playable: playableIds.value };
      }).finally(() => { if (pending.get(key) === work) pending.delete(key); });
      pending.set(key, work);
    }
    // Callers normalize metadata while composing their own page. Never let one
    // request mutate another request's shared snapshot. No settled value is cached.
    return structuredClone(await work);
  };
}
