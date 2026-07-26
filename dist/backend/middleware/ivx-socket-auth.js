/**
 * IVX WebSocket Authentication & Rate Limiting Middleware
 *
 * Adds token verification and per-socket rate limiting to Socket.IO.
 * Prevents unauthenticated access and message flooding.
 */
const WS_AUTH_MARKER = 'ivx-socket-auth-2026-07-16';
// ── Token verification ───────────────────────────────────────────────────────
const OWNER_TOKEN = process.env.IVX_OWNER_TOKEN ?? '';
const ALLOW_PUBLIC_WS = process.env.IVX_WS_ALLOW_PUBLIC === 'true';
/**
 * Verify a WebSocket connection's authentication token.
 * Checks handshake.auth.token or handshake.headers.authorization.
 * Returns true if authenticated, false otherwise.
 *
 * When ALLOW_PUBLIC_WS is true, unauthenticated connections are allowed
 * (for the public chat frontend). When false, all connections must be authenticated.
 */
export function verifySocketAuth(handshake) {
    // Public chat is allowed if explicitly enabled
    if (ALLOW_PUBLIC_WS)
        return true;
    // Check handshake.auth.token (Socket.IO client-side auth)
    const authToken = handshake.auth?.token;
    if (authToken && OWNER_TOKEN && authToken === OWNER_TOKEN)
        return true;
    // Check Authorization header (Bearer token)
    const authHeader = handshake.headers?.authorization;
    if (authHeader && OWNER_TOKEN) {
        const token = authHeader.replace(/^Bearer\s+/i, '').trim();
        if (token === OWNER_TOKEN)
            return true;
    }
    // In development with no token configured, allow connections
    if (!OWNER_TOKEN && process.env.NODE_ENV !== 'production')
        return true;
    return false;
}
const SOCKET_RATE_BUCKETS = new Map();
const SOCKET_RATE_BURST = 10; // 10 messages per burst
const SOCKET_RATE_REFILL_PER_SEC = 2; // 2 messages per second sustained
const SOCKET_RATE_MAX_BUCKETS = 2000;
/**
 * Check rate limit for a socket event.
 * Returns true if allowed, false if rate-limited.
 */
export function checkSocketRateLimit(socketId) {
    const now = Date.now();
    const bucket = SOCKET_RATE_BUCKETS.get(socketId) ?? {
        tokens: SOCKET_RATE_BURST,
        lastRefillMs: now,
    };
    const elapsedSec = Math.max(0, (now - bucket.lastRefillMs) / 1000);
    bucket.tokens = Math.min(SOCKET_RATE_BURST, bucket.tokens + elapsedSec * SOCKET_RATE_REFILL_PER_SEC);
    bucket.lastRefillMs = now;
    if (bucket.tokens < 1) {
        SOCKET_RATE_BUCKETS.set(socketId, bucket);
        return false;
    }
    bucket.tokens -= 1;
    SOCKET_RATE_BUCKETS.set(socketId, bucket);
    // Prune old buckets
    if (SOCKET_RATE_BUCKETS.size > SOCKET_RATE_MAX_BUCKETS) {
        const cutoff = now - 5 * 60 * 1000;
        for (const [k, b] of SOCKET_RATE_BUCKETS) {
            if (b.lastRefillMs < cutoff)
                SOCKET_RATE_BUCKETS.delete(k);
        }
    }
    return true;
}
/**
 * Clean up rate limit bucket for a disconnected socket.
 */
export function cleanupSocketRateLimit(socketId) {
    SOCKET_RATE_BUCKETS.delete(socketId);
}
export const IVX_SOCKET_AUTH_MARKER = WS_AUTH_MARKER;
