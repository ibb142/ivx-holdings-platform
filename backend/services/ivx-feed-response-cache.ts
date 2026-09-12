type Entry = { body: string; status: number; observedAt: number; private?: boolean; retryAfter?: number };

/** Anonymous feed cache with an absolute age bound and shared pending reads. */
export function createFeedResponseCache(options: {
  headers?: Record<string, string>;
  now?: () => number;
  responseTimeoutMs?: number;
  maxEntries?: number;
  /** Opt in only for public metadata routes whose authorization is already checked. */
  staleWhileRevalidate?: boolean;
} = {}) {
  const now = options.now ?? Date.now;
  const responseTimeoutMs = options.responseTimeoutMs ?? 6000;
  const maxEntries = options.maxEntries ?? 100;
  const staleWhileRevalidate = options.staleWhileRevalidate === true;
  const freshMs = 30_000, maximumAgeMs = 90_000;
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Entry>>();
  let activeReads = 0;

  function unavailable(): Entry {
    return { body: JSON.stringify({ error: 'Feed temporarily unavailable. Please retry.', code: 'FEED_UNAVAILABLE' }), status: 503, observedAt: now() };
  }
  function response(entry: Entry, shared: boolean, cache: string): Response {
    const age = Math.max(0, now() - entry.observedAt);
    const headers = new Headers({ ...options.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-IVX-Cache': cache });
    headers.set('X-IVX-Cache-Age-Ms', String(age));
    if (entry.status === 503) headers.set('Retry-After', '3');
    if (shared && !entry.private && entry.status === 200 && age < freshMs) {
      headers.set('Cache-Control', `public, max-age=${Math.floor((freshMs - age) / 1000)}, must-revalidate`);
    }
    if (cache === 'STALE') headers.set('Warning', '110 - "Response is stale"');
    return new Response(entry.body, { status: entry.status, headers });
  }
  function start(handler: () => Promise<Response>, key: string | null): Promise<Entry> {
    const observedAt = now();
    activeReads++;
    const failedRefresh = (): Entry => {
      const previous = key ? entries.get(key) : undefined;
      // Back off a known failed refresh without renewing the content's age or
      // caching an error. Cold requests retain their unavailable response.
      if (previous) previous.retryAfter = now() + 3000;
      return unavailable();
    };
    const work = Promise.resolve().then(handler).then(async (result): Promise<Entry> => {
      if (result.status >= 500) return failedRefresh();
      // Once a source withdraws access, old public content cannot cover a later
      // failure. Routes that need synchronous authorization keep SWR disabled.
      if (key && result.status >= 400) entries.delete(key);
      const body = await result.text();
      if (result.status === 200) {
        const data: unknown = JSON.parse(body);
        if (!data || typeof data !== 'object') return failedRefresh();
        const elapsed = now() - observedAt;
        if (elapsed < 0 || elapsed >= maximumAgeMs) return failedRefresh();
        const entry = { body, status: result.status, observedAt, private: (data as Record<string, unknown>).personalized === true };
        if (key && entry.private) entries.delete(key);
        if (key && !entry.private && elapsed < freshMs) {
          if (entries.size >= maxEntries && !entries.has(key)) entries.delete(entries.keys().next().value!);
          entries.set(key, entry);
        }
        return entry;
      }
      return { body, status: result.status, observedAt };
    }).catch(failedRefresh).finally(() => {
      activeReads--;
      if (key && pending.get(key) === work) pending.delete(key);
    });
    if (key) pending.set(key, work);
    return work;
  }

  return async function withFeedCache(req: Request, handler: () => Promise<Response>): Promise<Response> {
    const url = new URL(req.url);
    const shared = req.method === 'GET' && !req.headers.has('Authorization') && !req.headers.has('Cookie') && !url.searchParams.has('viewer_id');
    const key = shared ? req.url : null;
    const cached = key ? entries.get(key) : undefined;
    const age = cached ? now() - cached.observedAt : Infinity;
    if (cached && age >= 0 && age < freshMs) return response(cached, true, 'HIT');
    if (key && (age < 0 || age >= maximumAgeMs)) entries.delete(key);
    const serveWhileRefreshing = staleWhileRevalidate && cached && age >= freshMs && age < maximumAgeMs;
    if (serveWhileRefreshing && (cached.retryAfter ?? 0) > now()) return response(cached, true, 'STALE');
    let work = key ? pending.get(key) : undefined;
    if (!work) {
      if (activeReads >= maxEntries) return serveWhileRefreshing
        ? response(cached, true, 'STALE') : response(unavailable(), false, 'BYPASS');
      work = start(handler, key);
    }
    // Only return previously observed public content, within its original age
    // bound. The bounded producer remains shared until it actually settles.
    if (serveWhileRefreshing) return response(cached, true, 'STALE');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const entry = await Promise.race([work, new Promise<Entry>(resolve => {
        timer = setTimeout(() => resolve(unavailable()), responseTimeoutMs);
      })]);
      // A response deadline must not delete the pending read and start another
      // expensive DB request. The producer remains shared until it settles.
      const currentAge = cached ? now() - cached.observedAt : Infinity;
      if (entry.status >= 500 && cached && currentAge >= 0 && currentAge < maximumAgeMs) {
        return response(cached, true, 'STALE');
      }
      return response(entry, shared, shared ? 'MISS' : 'BYPASS');
    } finally { if (timer) clearTimeout(timer); }
  };
}
