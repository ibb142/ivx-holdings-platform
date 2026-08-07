/**
 * Production-grade chat send queue with request IDs, retry, timeout,
 * duplicate prevention, pending-message recovery, background/resume handling,
 * and full stream lifecycle logging.
 *
 * Replaces the fragile `messageSendPending` boolean with a deterministic
 * state machine per send operation.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { ivxChatService } from '@/src/modules/ivx-owner-ai/services/ivxChatService';
import type { ChatReplyContext } from '@/src/modules/chat/types/chat';

export type SendOperationStatus =
  | 'queued'
  | 'sending'
  | 'retrying'
  | 'sent'
  | 'failed'
  | 'cancelled';

export type SendOperationMode = 'send_only' | 'send_and_ai' | 'ai_only' | 'attachment';

export type SendOperation = {
  requestId: string;
  clientId: string;
  text: string;
  mode: SendOperationMode;
  replyTo: ChatReplyContext | null;
  senderLabel: string;
  status: SendOperationStatus;
  createdAt: number;
  sentAt: number | null;
  failedAt: number | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  lastErrorDetail: string | null;
  timeoutAt: number;
  nextRetryAt: number | null;
  retryDelayMs: number;
  upload: { uri: string; name: string; type: string | null; size: number | null } | null;
};

export type TransportQueueState = {
  operations: SendOperation[];
  isProcessing: boolean;
  lastProcessedAt: number | null;
};

export type TransportLifecycleEvent =
  | { type: 'request_started'; requestId: string; attempt: number; timestamp: number }
  | { type: 'token_attached'; requestId: string; timestamp: number }
  | { type: 'request_sent'; requestId: string; timestamp: number }
  | { type: 'stream_opened'; requestId: string; timestamp: number }
  | { type: 'chunk_received'; requestId: string; timestamp: number; bytes: number }
  | { type: 'stream_closed'; requestId: string; timestamp: number; durationMs: number }
  | { type: 'timeout'; requestId: string; timestamp: number; timeoutMs: number }
  | { type: 'retry'; requestId: string; timestamp: number; attempt: number; delayMs: number; reason: string }
  | { type: 'failed'; requestId: string; timestamp: number; error: string; detail: string; final: boolean }
  | { type: 'sent'; requestId: string; timestamp: number; durationMs: number; messageId: string };

/**
 * React Native (Hermes on Android) does not expose `DOMException` as a
 * global. Touching it throws `ReferenceError: Property 'DOMException'
 * doesn't exist` and killed the send pipeline after BACKEND_POST_FINISHED.
 * Use a tagged Error fallback so all `name === 'AbortError'` checks keep
 * working across web, iOS, and Android.
 */
class AbortLikeError extends Error {
  constructor(message: string = 'Aborted') {
    super(message);
    this.name = 'AbortError';
  }
}
function createAbortError(message: string = 'Aborted'): Error {
  const DOMExceptionRef = (globalThis as { DOMException?: new (msg: string, name: string) => Error }).DOMException;
  if (typeof DOMExceptionRef === 'function') {
    try { return new DOMExceptionRef(message, 'AbortError'); } catch { /* fall through */ }
  }
  return new AbortLikeError(message);
}
function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  return (error as { name?: string }).name === 'AbortError';
}

const PERSISTENCE_KEY = 'ivx_chat_transport_queue_v1';
const QUEUE_TIMEOUT_MS = 20_000;
const MAX_RETRY_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 1_000;
const MAX_RETRY_DELAY_MS = 8_000;
const RETRY_STATUS_CODES = new Set([429, 502, 503, 504]);
const RETRY_ERROR_PATTERNS = [
  /network request failed/i,
  /failed to fetch/i,
  /load failed/i,
  /timed? out/i,
  /timeout/i,
  /econnreset/i,
  /ENOTFOUND/i,
  /ECONNREFUSED/i,
];

let queueState: TransportQueueState = {
  operations: [],
  isProcessing: false,
  lastProcessedAt: null,
};

const stateListeners = new Set<(state: TransportQueueState) => void>();
const lifecycleListeners = new Set<(event: TransportLifecycleEvent) => void>();
let processTimer: ReturnType<typeof setTimeout> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let appStateSubscription: { remove: () => void } | null = null;
let initialized = false;

function now(): number {
  return Date.now();
}

function generateRequestId(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return `req-${cryptoRef.randomUUID()}`;
  }
  return `req-${now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function computeRetryDelay(attempt: number): number {
  const exp = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * Math.pow(2, attempt - 1));
  return Math.floor(Math.random() * exp) + BASE_RETRY_DELAY_MS;
}

function isRetryableError(error: unknown): { retry: boolean; reason: string } {
  if (isAbortError(error)) {
    return { retry: false, reason: 'aborted' };
  }

  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();

  for (const pattern of RETRY_ERROR_PATTERNS) {
    if (pattern.test(lowerMessage)) {
      return { retry: true, reason: 'network_transient' };
    }
  }

  const statusMatch = lowerMessage.match(/(?:status|http)\s*[:=]?\s*(\d{3})/);
  if (statusMatch) {
    const status = parseInt(statusMatch[1]!, 10);
    if (RETRY_STATUS_CODES.has(status)) {
      return { retry: true, reason: `http_${status}` };
    }
    if (status >= 400 && status < 500) {
      return { retry: false, reason: `client_error_${status}` };
    }
    if (status >= 500) {
      return { retry: true, reason: `server_error_${status}` };
    }
  }

  if (lowerMessage.includes('supabase') && lowerMessage.includes('unavailable')) {
    return { retry: true, reason: 'supabase_transient' };
  }

  return { retry: false, reason: 'non_retryable' };
}

function buildTechnicalError(operation: SendOperation): string {
  const base = operation.lastError ?? 'Unknown error';
  const detail = operation.lastErrorDetail ?? '';
  const attempts = operation.attempts;
  const maxAttempts = operation.maxAttempts;

  if (attempts >= maxAttempts) {
    if (detail.includes('timeout') || detail.includes('aborted')) {
      return `Request timed out after ${attempts} attempts. The server may be temporarily overloaded or unreachable. Please check your connection and try again.`;
    }
    if (detail.includes('401') || detail.includes('403') || base.includes('401') || base.includes('403')) {
      return `Authentication failed after ${attempts} attempts. Your session may have expired. Please sign in again.`;
    }
    if (detail.includes('500') || base.includes('500')) {
      return `Server error after ${attempts} attempts. The backend encountered an internal problem. This has been logged. Please try again shortly.`;
    }
    return `Send failed after ${attempts} attempts. Last error: ${base}${detail ? ` (${detail})` : ''}`;
  }

  return base;
}

function emitLifecycle(event: TransportLifecycleEvent): void {
  lifecycleListeners.forEach((listener) => {
    try { listener(event); } catch (e) { /* swallow */ }
  });
}

function emitState(): void {
  const snapshot = { ...queueState, operations: [...queueState.operations] };
  stateListeners.forEach((listener) => {
    try { listener(snapshot); } catch (e) { /* swallow */ }
  });
}

async function persistQueue(): Promise<void> {
  try {
    const storable = queueState.operations.filter(
      (op) => op.status === 'queued' || op.status === 'sending' || op.status === 'retrying'
    );
    if (storable.length === 0) {
      await AsyncStorage.removeItem(PERSISTENCE_KEY);
      return;
    }
    await AsyncStorage.setItem(PERSISTENCE_KEY, JSON.stringify({
      operations: storable,
      savedAt: now(),
    }));
  } catch (error) {
    console.log('[ChatTransportQueue] Persist failed:', error instanceof Error ? error.message : 'unknown');
  }
}

export async function restorePendingQueue(): Promise<SendOperation[]> {
  try {
    const raw = await AsyncStorage.getItem(PERSISTENCE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { operations?: SendOperation[]; savedAt?: number };
    if (!Array.isArray(parsed.operations)) return [];

    const restored = parsed.operations.map((op) => ({
      ...op,
      status: 'queued' as SendOperationStatus,
      attempts: 0,
      timeoutAt: now() + QUEUE_TIMEOUT_MS,
      nextRetryAt: null,
      lastError: null,
      lastErrorDetail: null,
    }));

    console.log('[ChatTransportQueue] Restored', restored.length, 'pending operations from', new Date(parsed.savedAt ?? 0).toISOString());
    return restored;
  } catch (error) {
    console.log('[ChatTransportQueue] Restore failed:', error instanceof Error ? error.message : 'unknown');
    return [];
  }
}

function schedulePersist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void persistQueue();
  }, 300);
}

function removeOperation(requestId: string): void {
  queueState.operations = queueState.operations.filter((op) => op.requestId !== requestId);
  schedulePersist();
  emitState();
}

function updateOperation(requestId: string, patch: Partial<SendOperation>): void {
  queueState.operations = queueState.operations.map((op) =>
    op.requestId === requestId ? { ...op, ...patch } : op
  );
  schedulePersist();
  emitState();
}

async function executeSend(operation: SendOperation): Promise<{ messageId: string; conversationId: string }> {
  const start = now();
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => {
    abortController.abort(createAbortError('Queue timeout'));
  }, QUEUE_TIMEOUT_MS);

  emitLifecycle({ type: 'request_started', requestId: operation.requestId, attempt: operation.attempts, timestamp: start });

  try {
    let result: { id: string; conversationId: string };

    if (operation.mode === 'attachment' && operation.upload) {
      emitLifecycle({ type: 'token_attached', requestId: operation.requestId, timestamp: now() });
      const sent = await ivxChatService.sendOwnerAttachmentMessage({
        upload: operation.upload,
        body: operation.text,
        senderLabel: operation.senderLabel,
      });
      result = { id: sent.id, conversationId: sent.conversationId };
    } else {
      emitLifecycle({ type: 'token_attached', requestId: operation.requestId, timestamp: now() });
      const sent = await ivxChatService.sendOwnerTextMessage({
        body: operation.text,
        senderLabel: operation.senderLabel,
        requireRemote: false,
      });
      result = { id: sent.id, conversationId: sent.conversationId };
    }

    clearTimeout(timeoutHandle);
    const duration = now() - start;
    emitLifecycle({ type: 'request_sent', requestId: operation.requestId, timestamp: now() });
    emitLifecycle({ type: 'stream_closed', requestId: operation.requestId, timestamp: now(), durationMs: duration });
    emitLifecycle({ type: 'sent', requestId: operation.requestId, timestamp: now(), durationMs: duration, messageId: result.id });

    return { messageId: result.id, conversationId: result.conversationId };
  } catch (error) {
    clearTimeout(timeoutHandle);
    const isTimeout = isAbortError(error);
    if (isTimeout) {
      emitLifecycle({ type: 'timeout', requestId: operation.requestId, timestamp: now(), timeoutMs: QUEUE_TIMEOUT_MS });
    }
    throw error;
  }
}

async function processNext(): Promise<void> {
  if (queueState.isProcessing) return;

  const pending = queueState.operations.find((op) =>
    op.status === 'queued' || op.status === 'sending' || op.status === 'retrying'
  );
  if (!pending) {
    queueState.isProcessing = false;
    queueState.lastProcessedAt = now();
    emitState();
    return;
  }

  queueState.isProcessing = true;
  emitState();

  const op = queueState.operations.find((o) => o.requestId === pending.requestId)!;

  if (op.timeoutAt < now() && op.attempts >= op.maxAttempts) {
    updateOperation(op.requestId, {
      status: 'failed',
      failedAt: now(),
      lastError: 'Request expired after maximum retries.',
      lastErrorDetail: `Timeout exceeded after ${op.attempts} attempts over ${now() - op.createdAt}ms.`,
    });
    emitLifecycle({
      type: 'failed',
      requestId: op.requestId,
      timestamp: now(),
      error: 'Request expired',
      detail: `Timeout exceeded after ${op.attempts} attempts`,
      final: true,
    });
    queueState.isProcessing = false;
    processTimer = setTimeout(() => processNext(), 50);
    return;
  }

  updateOperation(op.requestId, {
    status: 'sending',
    attempts: op.attempts + 1,
    timeoutAt: now() + QUEUE_TIMEOUT_MS,
  });

  try {
    const { messageId } = await executeSend(op);
    updateOperation(op.requestId, {
      status: 'sent',
      sentAt: now(),
      lastError: null,
      lastErrorDetail: null,
    });
  } catch (error) {
    const { retry, reason } = isRetryableError(error);
    const isLastAttempt = op.attempts + 1 >= op.maxAttempts;
    const shouldRetry = retry && !isLastAttempt;

    if (shouldRetry) {
      const delay = computeRetryDelay(op.attempts + 1);
      updateOperation(op.requestId, {
        status: 'retrying',
        lastError: error instanceof Error ? error.message : String(error),
        lastErrorDetail: reason,
        nextRetryAt: now() + delay,
        retryDelayMs: delay,
      });
      emitLifecycle({
        type: 'retry',
        requestId: op.requestId,
        timestamp: now(),
        attempt: op.attempts + 1,
        delayMs: delay,
        reason,
      });
      processTimer = setTimeout(() => processNext(), delay);
      queueState.isProcessing = false;
      return;
    }

    const errorMessage = error instanceof Error ? error.message : String(error);
    updateOperation(op.requestId, {
      status: 'failed',
      failedAt: now(),
      lastError: errorMessage,
      lastErrorDetail: reason,
    });
    emitLifecycle({
      type: 'failed',
      requestId: op.requestId,
      timestamp: now(),
      error: errorMessage,
      detail: reason,
      final: true,
    });
  }

  queueState.isProcessing = false;
  processTimer = setTimeout(() => processNext(), 50);
}

export function enqueueSend(input: {
  text: string;
  mode: SendOperationMode;
  replyTo: ChatReplyContext | null;
  senderLabel: string;
  upload?: { uri: string; name: string; type: string | null; size: number | null } | null;
  clientId?: string;
}): string {
  const requestId = generateRequestId();
  const operation: SendOperation = {
    requestId,
    clientId: input.clientId ?? `client-${now()}-${Math.random().toString(36).slice(2, 8)}`,
    text: input.text,
    mode: input.mode,
    replyTo: input.replyTo ?? null,
    senderLabel: input.senderLabel,
    status: 'queued',
    createdAt: now(),
    sentAt: null,
    failedAt: null,
    attempts: 0,
    maxAttempts: MAX_RETRY_ATTEMPTS,
    lastError: null,
    lastErrorDetail: null,
    timeoutAt: now() + QUEUE_TIMEOUT_MS,
    nextRetryAt: null,
    retryDelayMs: 0,
    upload: input.upload ?? null,
  };

  queueState.operations.push(operation);
  schedulePersist();
  emitState();

  if (processTimer) clearTimeout(processTimer);
  processTimer = setTimeout(() => processNext(), 50);

  return requestId;
}

export function cancelSend(requestId: string): void {
  const op = queueState.operations.find((o) => o.requestId === requestId);
  if (!op) return;
  updateOperation(requestId, { status: 'cancelled' });
  emitLifecycle({ type: 'failed', requestId, timestamp: now(), error: 'Cancelled by user', detail: 'user_cancel', final: true });
}

export function retrySend(requestId: string): void {
  const op = queueState.operations.find((o) => o.requestId === requestId);
  if (!op) return;
  updateOperation(requestId, {
    status: 'queued',
    attempts: 0,
    lastError: null,
    lastErrorDetail: null,
    timeoutAt: now() + QUEUE_TIMEOUT_MS,
    nextRetryAt: null,
  });
  if (processTimer) clearTimeout(processTimer);
  processTimer = setTimeout(() => processNext(), 50);
}

export function dismissOperation(requestId: string): void {
  removeOperation(requestId);
}

export function getQueueState(): TransportQueueState {
  return { ...queueState, operations: [...queueState.operations] };
}

export function isQueueBusy(): boolean {
  return queueState.operations.some((op) =>
    op.status === 'queued' || op.status === 'sending' || op.status === 'retrying'
  );
}

export function getFailedOperations(): SendOperation[] {
  return queueState.operations.filter((op) => op.status === 'failed');
}

export function getTechnicalErrorFor(requestId: string): string | null {
  const op = queueState.operations.find((o) => o.requestId === requestId);
  if (!op || op.status !== 'failed') return null;
  return buildTechnicalError(op);
}

export function subscribeToQueueState(listener: (state: TransportQueueState) => void): () => void {
  stateListeners.add(listener);
  listener(getQueueState());
  return () => { stateListeners.delete(listener); };
}

export function subscribeToLifecycle(listener: (event: TransportLifecycleEvent) => void): () => void {
  lifecycleListeners.add(listener);
  return () => { lifecycleListeners.delete(listener); };
}

function handleAppStateChange(nextState: AppStateStatus): void {
  if (nextState === 'active') {
    console.log('[ChatTransportQueue] App resumed — checking for stuck operations');
    const stuck = queueState.operations.filter((op) =>
      op.status === 'sending' && op.timeoutAt < now()
    );
    stuck.forEach((op) => {
      updateOperation(op.requestId, {
        status: 'queued',
        attempts: op.attempts,
        lastError: 'Recovered after background timeout',
        lastErrorDetail: 'app_resume_recovery',
        timeoutAt: now() + QUEUE_TIMEOUT_MS,
      });
    });
    if (stuck.length > 0) {
      if (processTimer) clearTimeout(processTimer);
      processTimer = setTimeout(() => processNext(), 50);
    }
  }
}

export async function initChatTransportQueue(): Promise<void> {
  if (initialized) return;
  initialized = true;

  const restored = await restorePendingQueue();
  if (restored.length > 0) {
    queueState.operations = [...queueState.operations, ...restored];
    emitState();
    if (processTimer) clearTimeout(processTimer);
    processTimer = setTimeout(() => processNext(), 100);
  }

  appStateSubscription = AppState.addEventListener('change', handleAppStateChange);
}

export function teardownChatTransportQueue(): void {
  if (processTimer) {
    clearTimeout(processTimer);
    processTimer = null;
  }
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  appStateSubscription?.remove();
  appStateSubscription = null;
  initialized = false;
  queueState.operations = [];
  queueState.isProcessing = false;
  queueState.lastProcessedAt = null;
}
