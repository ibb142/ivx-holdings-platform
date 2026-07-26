const BUCKETS = new Map();
const MAX_BUCKETS = 5000;
const PRUNE_AFTER_MS = 10 * 60 * 1000;
function getClientKey(request, scope) {
    const headers = request.headers;
    const ip = headers.get('cf-connecting-ip') ??
        headers.get('x-real-ip') ??
        (headers.get('x-forwarded-for') ?? '').split(',')[0].trim() ??
        'unknown';
    const auth = headers.get('authorization') ?? '';
    // Hash the token suffix only (never log it) so different owner sessions
    // get separate buckets without leaking the token.
    const authSuffix = auth.length > 8 ? auth.slice(-8) : auth;
    return `${scope}|${ip}|${authSuffix}`;
}
function pruneIfNeeded(now) {
    if (BUCKETS.size < MAX_BUCKETS)
        return;
    for (const [k, b] of BUCKETS) {
        if (now - b.lastSeenMs > PRUNE_AFTER_MS)
            BUCKETS.delete(k);
        if (BUCKETS.size < MAX_BUCKETS * 0.8)
            break;
    }
}
/**
 * Attempt to consume 1 token. Returns null if allowed, or a 429
 * Response if rate-limited (with Retry-After).
 */
export function checkRateLimit(request, opts) {
    const now = Date.now();
    const key = getClientKey(request, opts.scope);
    const bucket = BUCKETS.get(key) ?? { tokens: opts.burst, lastRefillMs: now, lastSeenMs: now };
    // Refill
    const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
    bucket.tokens = Math.min(opts.burst, bucket.tokens + elapsedSec * opts.refillPerSecond);
    bucket.lastRefillMs = now;
    bucket.lastSeenMs = now;
    if (bucket.tokens < 1) {
        const needed = 1 - bucket.tokens;
        const retryAfterSec = Math.max(1, Math.ceil(needed / Math.max(0.0001, opts.refillPerSecond)));
        BUCKETS.set(key, bucket);
        pruneIfNeeded(now);
        return new Response(JSON.stringify({ ok: false, error: 'rate_limited', retryAfterSec, scope: opts.scope }), {
            status: 429,
            headers: {
                'content-type': 'application/json',
                'retry-after': String(retryAfterSec),
                'x-ratelimit-scope': opts.scope,
                'x-ratelimit-burst': String(opts.burst),
                'x-ratelimit-refill-per-second': String(opts.refillPerSecond),
            },
        });
    }
    bucket.tokens -= 1;
    BUCKETS.set(key, bucket);
    pruneIfNeeded(now);
    return null;
}
/** Test/debug helper — never used in production paths. */
export function _resetIVXRateLimitForTests() {
    BUCKETS.clear();
}
export const IVX_RATE_LIMIT_MARKER = 'ivx-rate-limit-2026-05-28';
