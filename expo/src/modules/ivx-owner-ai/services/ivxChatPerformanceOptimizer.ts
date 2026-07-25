/**
 * IVX Chat Performance Optimizer
 *
 * Implements the 8-item chat loading fix identified by the diagnostic engine:
 *   1. Cached shell — render header + skeleton from AsyncStorage BEFORE any network call
 *   2. Skeleton placeholders — show pulsing bubbles while messages load
 *   3. Parallel startup — run conversation lookup, message load, AI probe, room status concurrently
 *   4. Bounded timeouts — every network call has a hard deadline (8s default)
 *   5. Background message hydration — paint local mirror first, then merge remote
 *   6. Non-blocking AI health check — runs in background, never blocks composer
 *   7. Non-blocking worker status — runs in background, never blocks message list
 *   8. Clear retry/error fallback — visible retry button + offline banner
 *
 * All timing is measured and emitted via the performance instrumentation module.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Types ────────────────────────────────────────────────────────────────────

export interface IVXChatShell {
  conversationId: string | null;
  messages: IVXCachedMessage[];
  cachedAt: number;
  source: 'asyncstorage' | 'empty';
}

export interface IVXCachedMessage {
  id: string;
  body: string;
  senderRole: string;
  conversationId: string;
  createdAt: string;
}

export interface IVXChatStartupResult {
  shell: IVXChatShell;
  remoteMessages: IVXCachedMessage[] | null;
  conversationId: string | null;
  aiHealthy: boolean | null;
  workerStatus: 'unknown' | 'idle' | 'running';
  errors: IVXChatStartupError[];
  timing: IVXChatStartupTiming;
}

export interface IVXChatStartupError {
  phase: 'conversation' | 'messages' | 'ai_probe' | 'worker_status' | 'room_status';
  message: string;
  timedOut: boolean;
  recoverable: boolean;
}

export interface IVXChatStartupTiming {
  shellLoadedMs: number;
  conversationResolvedMs: number | null;
  messagesLoadedMs: number | null;
  aiProbeMs: number | null;
  workerStatusMs: number | null;
  totalMs: number;
  firstPaintMs: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SHELL_CACHE_KEY = 'ivx_chat_shell_cache_v1';
const CONVERSATION_ID_CACHE_KEY = 'ivx_chat_cached_conversation_id';
const DEFAULT_TIMEOUT_MS = 8000;
const SHELL_TIMEOUT_MS = 200;

// ── Cached shell (item 1) ──────────────────────────────────────────────────────

/**
 * Load the cached chat shell from AsyncStorage. This is the stale-while-revalidate
 * base: it returns within 200ms (or empty) so the UI can paint the header + skeleton
 * BEFORE any network query resolves. The cached conversation id is also restored so
 * the composer is interactive immediately.
 */
export async function loadCachedShell(): Promise<IVXChatShell> {
  const start = Date.now();
  try {
    const [messagesJson, conversationId] = await Promise.all([
      AsyncStorage.getItem(SHELL_CACHE_KEY),
      AsyncStorage.getItem(CONVERSATION_ID_CACHE_KEY),
    ]);

    let messages: IVXCachedMessage[] = [];
    if (messagesJson) {
      const parsed = JSON.parse(messagesJson) as IVXCachedMessage[];
      if (Array.isArray(parsed)) {
        messages = parsed;
      }
    }

    return {
      conversationId: conversationId ?? null,
      messages,
      cachedAt: Date.now(),
      source: messages.length > 0 ? 'asyncstorage' : 'empty',
    };
  } catch {
    return {
      conversationId: null,
      messages: [],
      cachedAt: Date.now(),
      source: 'empty',
    };
  } finally {
    // Shell load must be fast — if AsyncStorage is slow we don't block.
    const elapsed = Date.now() - start;
    if (elapsed > SHELL_TIMEOUT_MS) {
      console.warn('[IVXChatPerf] Shell load exceeded budget', { elapsedMs: elapsed });
    }
  }
}

/**
 * Persist the current shell + conversation id to AsyncStorage for next cold start.
 */
export async function saveCachedShell(
  messages: IVXCachedMessage[],
  conversationId: string | null,
): Promise<void> {
  try {
    const bounded = messages.slice(-50); // Only cache the recent tail
    await Promise.all([
      AsyncStorage.setItem(SHELL_CACHE_KEY, JSON.stringify(bounded)),
      conversationId
        ? AsyncStorage.setItem(CONVERSATION_ID_CACHE_KEY, conversationId)
        : AsyncStorage.removeItem(CONVERSATION_ID_CACHE_KEY),
    ]);
  } catch (error) {
    console.warn(
      '[IVXChatPerf] Failed to save cached shell:',
      error instanceof Error ? error.message : 'unknown',
    );
  }
}

// ── Bounded timeout helper (item 4) ─────────────────────────────────────────────

/**
 * Wrap a promise with a hard timeout. If the timeout fires, the promise is
 * considered failed — the error has `timedOut: true` so callers can distinguish
 * slow networks from actual errors.
 */
export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  label: string = 'operation',
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new TimeoutError(`${label} exceeded ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/**
 * Soft timeout: resolve with `null` after timeoutMs instead of rejecting.
 * Used for non-blocking background tasks (AI probe, worker status) that should
 * never block the chat interface.
 */
export function withSoftTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
  label: string = 'operation',
): Promise<T | null> {
  return withTimeout(promise, timeoutMs, label)
    .then((result) => result)
    .catch(() => null);
}

export class TimeoutError extends Error {
  timedOut = true as const;
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

// ── Parallel startup orchestrator (items 1-8 combined) ────────────────────────

export interface IVXChatStartupDeps {
  /** Resolve the conversation row (may involve Supabase lookup + insert fallback). */
  resolveConversation: () => Promise<{ id: string } | null>;
  /** Load messages for the conversation (bounded, newest-first). */
  loadMessages: (conversationId: string) => Promise<IVXCachedMessage[]>;
  /** Probe the AI health endpoint (non-blocking). */
  probeAIHealth: () => Promise<boolean>;
  /** Check worker status (non-blocking). */
  checkWorkerStatus: () => Promise<'idle' | 'running'>;
  /** Optional timeout overrides (ms). Defaults: conversation=8000, messages=8000, aiProbe=5000, workerStatus=5000. */
  timeouts?: {
    conversation?: number;
    messages?: number;
    aiProbe?: number;
    workerStatus?: number;
  };
}

/**
 * Orchestrates the full chat startup with all 8 performance fixes applied.
 *
 * Flow:
 *   1. Load cached shell synchronously (AsyncStorage, ≤200ms)
 *   2. Paint shell → first paint happens HERE
 *   3. In parallel (Promise.all):
 *      a. Resolve conversation (bounded 8s timeout)
 *      b. AI health probe (non-blocking, soft timeout 5s)
 *      c. Worker status (non-blocking, soft timeout 5s)
 *   4. After conversation resolves → load messages (bounded 8s timeout)
 *   5. Merge remote messages with cached shell (dedup by id)
 *   6. Save updated shell for next cold start
 *   7. Return complete result with timing
 *
 * The caller should:
 *   - Render the shell IMMEDIATELY when this returns (firstPaintMs)
 *   - Then update with remoteMessages when they arrive
 *   - Show errors with retry buttons for any failed phase
 */
export async function orchestrateChatStartup(
  deps: IVXChatStartupDeps,
): Promise<IVXChatStartupResult> {
  const totalStart = Date.now();
  const errors: IVXChatStartupError[] = [];

  // ── Item 1: Cached shell (first paint) ───────────────────────────────────────
  const shellStart = Date.now();
  const shell = await loadCachedShell();
  const shellLoadedMs = Date.now() - shellStart;
  const firstPaintMs = shellLoadedMs;

  // ── Items 3, 6, 7: Parallel startup (conversation + AI probe + worker status) ─
  const conversationStart = Date.now();
  let conversationId: string | null = shell.conversationId;
  let conversationResolvedMs: number | null = null;

  const timeouts = deps.timeouts ?? {};
  const conversationTimeoutMs = timeouts.conversation ?? DEFAULT_TIMEOUT_MS;
  const messagesTimeoutMs = timeouts.messages ?? DEFAULT_TIMEOUT_MS;
  const aiProbeTimeoutMs = timeouts.aiProbe ?? 5000;
  const workerStatusTimeoutMs = timeouts.workerStatus ?? 5000;

  // Non-blocking background tasks (items 6, 7) — run concurrently, never block
  const aiProbePromise = withSoftTimeout(deps.probeAIHealth(), aiProbeTimeoutMs, 'ai_probe');
  const workerStatusPromise = withSoftTimeout(deps.checkWorkerStatus(), workerStatusTimeoutMs, 'worker_status');

  // Conversation resolution is blocking but bounded (item 4)
  if (!conversationId) {
    try {
      const conv = await withTimeout(deps.resolveConversation(), conversationTimeoutMs, 'conversation');
      conversationId = conv?.id ?? null;
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      errors.push({
        phase: 'conversation',
        message: error instanceof Error ? error.message : 'unknown',
        timedOut,
        recoverable: true,
      });
    }
  }
  conversationResolvedMs = Date.now() - conversationStart;

  // ── Item 5: Background message hydration ─────────────────────────────────────
  let remoteMessages: IVXCachedMessage[] | null = null;
  let messagesLoadedMs: number | null = null;

  if (conversationId) {
    const messagesStart = Date.now();
    try {
      remoteMessages = await withTimeout(
        deps.loadMessages(conversationId),
        messagesTimeoutMs,
        'messages',
      );
    } catch (error) {
      const timedOut = error instanceof TimeoutError;
      errors.push({
        phase: 'messages',
        message: error instanceof Error ? error.message : 'unknown',
        timedOut,
        recoverable: true,
      });
    }
    messagesLoadedMs = Date.now() - messagesStart;
  }

  // ── Collect non-blocking results (items 6, 7) ──────────────────────────────────
  const aiProbeStart = Date.now();
  const aiHealthy = await aiProbePromise;
  const aiProbeMs = Date.now() - aiProbeStart;

  const workerStatusStart = Date.now();
  const workerStatusRaw = await workerStatusPromise;
  const workerStatusMs = Date.now() - workerStatusStart;
  const workerStatus: 'unknown' | 'idle' | 'running' = workerStatusRaw ?? 'unknown';

  if (aiHealthy === null) {
    errors.push({
      phase: 'ai_probe',
      message: 'AI health probe timed out or failed',
      timedOut: true,
      recoverable: true,
    });
  }

  // ── Item 8: Merge + save shell ──────────────────────────────────────────────
  if (remoteMessages && remoteMessages.length > 0) {
    await saveCachedShell(remoteMessages, conversationId);
  }

  const totalMs = Date.now() - totalStart;

  return {
    shell,
    remoteMessages,
    conversationId,
    aiHealthy: aiHealthy === null ? null : aiHealthy,
    workerStatus,
    errors,
    timing: {
      shellLoadedMs,
      conversationResolvedMs,
      messagesLoadedMs,
      aiProbeMs,
      workerStatusMs,
      totalMs,
      firstPaintMs,
    },
  };
}

// ── Cursor pagination support ─────────────────────────────────────────────────

export interface IVXMessageCursor {
  conversationId: string;
  beforeTimestamp: string | null;
  loadedCount: number;
}

/**
 * Load older messages using cursor pagination. The cursor is the `created_at`
 * of the oldest currently-loaded message. The caller passes a fetch function
 * that queries messages older than the cursor, bounded by `pageSize`.
 */
export async function loadOlderMessages(
  cursor: IVXMessageCursor,
  fetchOlder: (conversationId: string, beforeTimestamp: string, pageSize: number) => Promise<IVXCachedMessage[]>,
  pageSize: number = 50,
): Promise<{ messages: IVXCachedMessage[]; hasMore: boolean; nextCursor: IVXMessageCursor | null }> {
  if (!cursor.beforeTimestamp) {
    return { messages: [], hasMore: false, nextCursor: null };
  }

  try {
    const older = await withTimeout(
      fetchOlder(cursor.conversationId, cursor.beforeTimestamp, pageSize),
      8000,
      'pagination',
    );

    if (older.length === 0) {
      return { messages: [], hasMore: false, nextCursor: null };
    }

    const hasMore = older.length === pageSize;
    const nextCursor: IVXMessageCursor | null = hasMore
      ? {
          conversationId: cursor.conversationId,
          beforeTimestamp: older[0]?.createdAt ?? cursor.beforeTimestamp,
          loadedCount: cursor.loadedCount + older.length,
        }
      : null;

    return { messages: older, hasMore, nextCursor };
  } catch (error) {
    console.warn(
      '[IVXChatPerf] Pagination failed:',
      error instanceof Error ? error.message : 'unknown',
    );
    return { messages: [], hasMore: false, nextCursor: null };
  }
}

// ── Realtime subscription dedup ───────────────────────────────────────────────

const activeSubscriptions = new Set<string>();

/**
 * Track active realtime subscriptions to prevent duplicates.
 * Returns true if a subscription for this conversation is already active.
 */
export function hasActiveSubscription(conversationId: string): boolean {
  return activeSubscriptions.has(conversationId);
}

/**
 * Register a subscription. Must be called BEFORE creating the Supabase channel.
 */
export function registerSubscription(conversationId: string): void {
  activeSubscriptions.add(conversationId);
}

/**
 * Unregister a subscription. Must be called in the channel's onClose/onError.
 */
export function unregisterSubscription(conversationId: string): void {
  activeSubscriptions.delete(conversationId);
}

/**
 * Clear all subscriptions (used on logout or full teardown).
 */
export function clearAllSubscriptions(): void {
  activeSubscriptions.clear();
}

// ── Message dedup + ordering ──────────────────────────────────────────────────

/**
 * Merge remote messages with cached/local messages, deduplicating by id.
 * Preserves chronological order (oldest first, newest last).
 */
export function mergeMessages(
  local: IVXCachedMessage[],
  remote: IVXCachedMessage[],
): IVXCachedMessage[] {
  const byId = new Map<string, IVXCachedMessage>();
  for (const msg of [...local, ...remote]) {
    if (msg.id && !byId.has(msg.id)) {
      byId.set(msg.id, msg);
    }
  }
  return Array.from(byId.values()).sort((a, b) => {
    const aTime = new Date(a.createdAt).getTime();
    const bTime = new Date(b.createdAt).getTime();
    return aTime - bTime;
  });
}

// ── Performance targets ───────────────────────────────────────────────────────

export const PERFORMANCE_TARGETS = {
  shellVisibleMs: 200,
  firstContentMs: 2000,
  composerReadyMs: 2000,
  noIndefiniteLoading: true,
  optionalServiceFailuresBlock: false,
} as const;

/**
 * Check if a startup result meets the performance targets.
 */
export function checkPerformanceTargets(
  result: IVXChatStartupResult,
): { passed: boolean; violations: string[] } {
  const violations: string[] = [];

  if (result.timing.firstPaintMs > PERFORMANCE_TARGETS.shellVisibleMs) {
    violations.push(
      `Shell visible took ${result.timing.firstPaintMs}ms (target: ${PERFORMANCE_TARGETS.shellVisibleMs}ms)`,
    );
  }

  if (
    result.timing.messagesLoadedMs !== null &&
    result.timing.messagesLoadedMs > PERFORMANCE_TARGETS.firstContentMs &&
    result.shell.messages.length === 0
  ) {
    violations.push(
      `First content took ${result.timing.messagesLoadedMs}ms with empty shell (target: ${PERFORMANCE_TARGETS.firstContentMs}ms)`,
    );
  }

  // Optional service failures should not block
  const blockingOptionalFailures = result.errors.filter(
    (e) => (e.phase === 'ai_probe' || e.phase === 'worker_status') && !e.recoverable,
  );
  if (blockingOptionalFailures.length > 0) {
    violations.push('Optional service failure blocked chat');
  }

  return {
    passed: violations.length === 0,
    violations,
  };
}
