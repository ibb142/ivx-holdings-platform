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

type QueuePool = {
  name: 'short' | 'long';
  maxConcurrent: number;
  active: number;
  waiters: Array<() => void>;
};

const shortPool: QueuePool = {
  name: 'short',
  maxConcurrent: Number.parseInt(process.env.IVX_AI_SHORT_POOL_MAX ?? '8', 10) || 8,
  active: 0,
  waiters: [],
};

const longPool: QueuePool = {
  name: 'long',
  maxConcurrent: Number.parseInt(process.env.IVX_AI_LONG_POOL_MAX ?? '2', 10) || 2,
  active: 0,
  waiters: [],
};

export type IVXAIQueueLane = 'short' | 'long';

export function classifyRequestLane(input: { promptChars: number; maxOutputTokens: number | null | undefined }): IVXAIQueueLane {
  const tokens = input.maxOutputTokens ?? 0;
  if (tokens >= 4000) return 'long';
  if (input.promptChars >= 8000) return 'long';
  return 'short';
}

export type IVXAIQueueOptions = { signal?: AbortSignal | null; timeoutMs?: number };
const MAX_WAITERS = 112;

function acquire(pool: QueuePool, options: IVXAIQueueOptions): Promise<void> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason ?? new Error('AI request cancelled'));
  if (pool.active < pool.maxConcurrent) {
    pool.active += 1;
    return Promise.resolve();
  }
  if (pool.waiters.length >= MAX_WAITERS) return Promise.reject(new Error('AI queue capacity exceeded'));
  const configured = options.timeoutMs ?? Number(process.env.IVX_AI_QUEUE_WAIT_TIMEOUT_MS ?? 30000);
  const timeoutMs = Number.isFinite(configured) && configured > 0 ? Math.min(configured, 60000) : 30000;
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
    };
    const rejectWaiter = (error: unknown) => {
      if (settled) return;
      settled = true;
      const index = pool.waiters.indexOf(grant);
      if (index >= 0) pool.waiters.splice(index, 1);
      cleanup();
      reject(error);
    };
    const onAbort = () => rejectWaiter(options.signal?.reason ?? new Error('AI request cancelled'));
    const grant = () => {
      if (settled) return;
      settled = true;
      cleanup();
      pool.active += 1;
      resolve();
    };
    const timer = setTimeout(() => {
      const error = new Error('AI queue wait timed out');
      error.name = 'TimeoutError';
      rejectWaiter(error);
    }, timeoutMs);
    pool.waiters.push(grant);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}

function release(pool: QueuePool): void {
  pool.active = Math.max(0, pool.active - 1);
  const next = pool.waiters.shift();
  if (next) {
    next();
  }
}

export type IVXAIQueueAcquisition = {
  lane: IVXAIQueueLane;
  waitMs: number;
  release: () => void;
};

export async function acquireAIQueueSlot(lane: IVXAIQueueLane, options: IVXAIQueueOptions = {}): Promise<IVXAIQueueAcquisition> {
  const pool = lane === 'long' ? longPool : shortPool;
  const startedAt = Date.now();
  await acquire(pool, options);
  let released = false;
  return {
    lane,
    waitMs: Date.now() - startedAt,
    release: () => { if (!released) { released = true; release(pool); } },
  };
}

export function getAIQueueSnapshot(): {
  short: { active: number; waiting: number; maxConcurrent: number };
  long: { active: number; waiting: number; maxConcurrent: number };
} {
  return {
    short: { active: shortPool.active, waiting: shortPool.waiters.length, maxConcurrent: shortPool.maxConcurrent },
    long: { active: longPool.active, waiting: longPool.waiters.length, maxConcurrent: longPool.maxConcurrent },
  };
}
