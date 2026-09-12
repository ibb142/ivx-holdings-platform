import { newReadTimings, readTimings } from './ivx-read-timings';
type Entry = { body: string; status: number; observedAt: number; private?: boolean };

/** Anonymous feed cache with an absolute age bound and shared pending reads. */
export function createFeedResponseCache(options: {
  headers?: Record<string, string>;
  now?: () => number;
  responseTimeoutMs?: number;
  maxEntries?: number;
  maxActiveReads?: number;
  staleWhileRevalidate?: boolean;
  refreshTimeoutMs?: number;
  fallback?: (req: Request) => Record<string, unknown>;
} = {}) {
  const now = options.now ?? Date.now;
  const responseTimeoutMs = options.responseTimeoutMs ?? 6000;
  const maxEntries = options.maxEntries ?? 100;
  const freshMs = 30_000, maximumAgeMs = 90_000;
  const entries = new Map<string, Entry>();
  const pending = new Map<string, Promise<Entry>>();
  let activeReads = 0;
  let activeSharedReads = 0;
  const retryAt = new Map<string, number>();

  function unavailable(): Entry {
    return { body: JSON.stringify({ error: 'Feed temporarily unavailable. Please retry.', code: 'FEED_UNAVAILABLE' }), status: 503, observedAt: now() };
  }
  function response(entry: Entry, shared: boolean, cache: string): Response {
    const age = Math.max(0, now() - entry.observedAt);
    const headers = new Headers({ ...options.headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-IVX-Cache': cache });
    if (entry.status === 503) headers.set('Retry-After', '3');
    if (shared && !entry.private && entry.status === 200 && age < freshMs) {
      headers.set('Cache-Control', `public, max-age=${Math.floor((freshMs - age) / 1000)}, must-revalidate`);
    }
    headers.set('X-IVX-Data-State', cache === 'STALE' ? 'stale' : entry.status === 200 ? 'available' : 'unavailable');
    if (cache === 'STALE') {
      headers.set('Warning', '110 - "Response is stale"');
      headers.set('X-IVX-Data-Age-Ms', String(age));
    }
    return new Response(entry.body, { status: entry.status, headers });
  }
  function start(handler: () => Promise<Response>, key: string | null): Promise<Entry> {
    const observedAt = now();
    activeReads++;
    if (key) activeSharedReads++;
    // The shared producer may outlive its first HTTP response. Give it its own
    // finite budget so a cold timeout cannot permanently prevent cache warming.
    const produce = () => key && options.staleWhileRevalidate
      ? readTimings.run(newReadTimings(options.refreshTimeoutMs ?? 8000), handler) : handler();
    const work = Promise.resolve().then(produce).then(async (result): Promise<Entry> => {
      if (result.status >= 500) return unavailable();
      const body = await result.text();
      if (result.status === 200) {
        const data: unknown = JSON.parse(body);
        if (!data || typeof data !== 'object' || (data as Record<string, unknown>).degraded === true) return unavailable();
        const elapsed = now() - observedAt;
        if (elapsed < 0 || elapsed >= maximumAgeMs) return unavailable();
        const entry = { body, status: result.status, observedAt, private: (data as Record<string, unknown>).personalized === true || result.headers.has('Set-Cookie') };
        if (key && !entry.private && elapsed < freshMs) {
          if (entries.size >= maxEntries && !entries.has(key)) entries.delete(entries.keys().next().value!);
          entries.set(key, entry);
        }
        return entry;
      }
      // An explicit rejection invalidates any old public snapshot.
      if (key) entries.delete(key);
      return { body, status: result.status, observedAt };
    }).catch(() => unavailable()).then(entry => {
      if (key && options.staleWhileRevalidate) {
        if (entry.status >= 500) {
          if (retryAt.size >= maxEntries) retryAt.delete(retryAt.keys().next().value!);
          retryAt.set(key, now() + 3000);
        } else retryAt.delete(key);
      }
      return entry;
    }).finally(() => {
      activeReads--;
      if (key) activeSharedReads--;
      if (key && pending.get(key) === work) pending.delete(key);
    });
    if (key) pending.set(key, work);
    return work;
  }

  return async function withFeedCache(req: Request, handler: () => Promise<Response>): Promise<Response> {
    const url = new URL(req.url);
    const shared = !req.headers.has('Authorization') && !req.headers.has('Cookie') && !url.searchParams.has('viewer_id');
    const key = shared && req.method === 'GET' ? req.url : null;
    const unavailableResponse = () => {
      if (!options.fallback) return response(unavailable(), false, 'BYPASS');
      const result = response({ body: JSON.stringify({ ...options.fallback(req), degraded: true, data_available: false, retryable: true, code: 'PUBLIC_DATA_UNAVAILABLE' }), status: 200, observedAt: now() }, false, 'FALLBACK');
      result.headers.set('X-IVX-Data-State', 'unavailable');
      result.headers.set('Retry-After', '3');
      return result;
    };
    const cached = key ? entries.get(key) : undefined;
    const age = cached ? now() - cached.observedAt : Infinity;
    if (cached && age >= 0 && age < freshMs) return response(cached, true, 'HIT');
    if (key && (age < 0 || age >= maximumAgeMs)) entries.delete(key);
    let work = key ? pending.get(key) : undefined;
    const usableStale = cached && age >= 0 && age < maximumAgeMs;
    if (!work) {
      // Personalized responses cannot share a response producer. Their public
      // source inputs already coalesce below the controller; do not turn a
      // viewer burst into empty feeds through the public producer limit.
      const atCapacity = key ? activeSharedReads >= (options.maxActiveReads ?? maxEntries)
        : activeReads - activeSharedReads >= maxEntries;
      if (atCapacity || (key && (retryAt.get(key) ?? 0) > now())) {
        return usableStale ? response(cached, true, 'STALE') : unavailableResponse();
      }
      work = start(handler, key);
    }
    if (options.staleWhileRevalidate && usableStale) return response(cached, true, 'STALE');
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
      if (entry.status >= 500 && options.fallback) return unavailableResponse();
      return response(entry, shared, shared ? 'MISS' : 'BYPASS');
    } finally { if (timer) clearTimeout(timer); }
  };
}
