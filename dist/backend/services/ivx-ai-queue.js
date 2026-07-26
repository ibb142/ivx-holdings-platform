/**
 * IVX AI runtime queue protection.
 *
 * Long, expensive generations (large maxOutputTokens / long prompts) must not
 * block normal short chat requests. We split the pool into two semaphores:
 *
 *  - "short" pool: high concurrency, for normal chat
 *  - "long"  pool: limited concurrency, for big reports / decomposition
 *
 * A request that exceeds the "long" threshold acquires a slot from the long
 * pool. While long generations run, short requests still flow through their own
 * pool unaffected. Queue wait time is reported back so telemetry can show when
 * the queue is contended.
 */
const shortPool = {
    name: 'short',
    maxConcurrent: Number.parseInt(process.env.IVX_AI_SHORT_POOL_MAX ?? '8', 10) || 8,
    active: 0,
    waiters: [],
};
const longPool = {
    name: 'long',
    maxConcurrent: Number.parseInt(process.env.IVX_AI_LONG_POOL_MAX ?? '2', 10) || 2,
    active: 0,
    waiters: [],
};
export function classifyRequestLane(input) {
    const tokens = input.maxOutputTokens ?? 0;
    if (tokens >= 4000)
        return 'long';
    if (input.promptChars >= 8000)
        return 'long';
    return 'short';
}
function acquire(pool) {
    if (pool.active < pool.maxConcurrent) {
        pool.active += 1;
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        pool.waiters.push(() => {
            pool.active += 1;
            resolve();
        });
    });
}
function release(pool) {
    pool.active = Math.max(0, pool.active - 1);
    const next = pool.waiters.shift();
    if (next) {
        next();
    }
}
export async function acquireAIQueueSlot(lane) {
    const pool = lane === 'long' ? longPool : shortPool;
    const startedAt = Date.now();
    await acquire(pool);
    return {
        lane,
        waitMs: Date.now() - startedAt,
        release: () => release(pool),
    };
}
export function getAIQueueSnapshot() {
    return {
        short: { active: shortPool.active, waiting: shortPool.waiters.length, maxConcurrent: shortPool.maxConcurrent },
        long: { active: longPool.active, waiting: longPool.waiters.length, maxConcurrent: longPool.maxConcurrent },
    };
}
