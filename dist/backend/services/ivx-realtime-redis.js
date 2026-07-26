const ADAPTER_MARKER = 'ivx-realtime-redis-adapter-2026-07-14';
export function getRealtimeConfig() {
    const redisUrl = process.env.REDIS_URL ?? null;
    const enabled = redisUrl !== null && process.env.IVX_REDIS_ADAPTER_ENABLED === 'true';
    const instanceId = `${process.env.HOST ?? 'localhost'}-${process.env.PORT ?? '3000'}-${Date.now()}`;
    return {
        enabled,
        redisUrl,
        instanceId,
        marker: ADAPTER_MARKER,
        maxPayloadBytes: 1_000_000,
        pingIntervalMs: 10_000,
        pingTimeoutMs: 30_000,
    };
}
/**
 * Attach Redis adapter to Socket.IO server if Redis is available.
 * Returns true if adapter was attached, false if running in-memory.
 */
export async function attachRedisAdapter(io) {
    const config = getRealtimeConfig();
    if (!config.enabled || !config.redisUrl) {
        console.log('[IVX Realtime] Using in-memory adapter (single instance)', { marker: ADAPTER_MARKER });
        return false;
    }
    try {
        const adapterModuleName = '@socket.io/redis-adapter';
        const redisModuleName = 'redis';
        const adapterModule = (await import(adapterModuleName));
        const redisModule = (await import(redisModuleName));
        const pubClient = redisModule.createClient({ url: config.redisUrl });
        const subClient = pubClient.duplicate();
        await Promise.all([pubClient.connect(), subClient.connect()]);
        io.adapter(adapterModule.createAdapter(pubClient, subClient));
        console.log('[IVX Realtime] Redis adapter attached', {
            marker: ADAPTER_MARKER,
            instanceId: config.instanceId,
        });
        return true;
    }
    catch (error) {
        console.error('[IVX Realtime] Redis adapter failed, falling back to in-memory', {
            error: error instanceof Error ? error.message : String(error),
            marker: ADAPTER_MARKER,
        });
        return false;
    }
}
/**
 * Message dedup key generator — prevents duplicate messages across
 * instances by using a composite key of roomId + timestamp + textHash.
 */
export function generateDedupKey(roomId, text, timestamp) {
    const textHash = text.length > 64 ? text.slice(0, 64) : text;
    return `dedup:${roomId}:${timestamp}:${Buffer.from(textHash).toString('base64url')}`;
}
export function createPresenceState(roomId, onlineCount) {
    return {
        roomId,
        onlineCount,
        instanceId: getRealtimeConfig().instanceId,
        updatedAt: new Date().toISOString(),
    };
}
export const IVX_REALTIME_MARKER = ADAPTER_MARKER;
