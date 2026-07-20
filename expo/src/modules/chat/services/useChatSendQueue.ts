/**
 * React hook that wraps the production-grade chat transport queue
 * with a useMutation-compatible interface for minimal chat.tsx churn.
 *
 * - Replaces fragile `messageSendPending` boolean with deterministic queue state.
 * - Adds request IDs, retries, timeout cleanup, duplicate prevention.
 * - Provides real technical errors on final failure.
 * - Emits full lifecycle events for stream tracing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatReplyContext } from '@/src/modules/chat/types/chat';
import {
  enqueueSend,
  getQueueState,
  initChatTransportQueue,
  isQueueBusy,
  subscribeToQueueState,
  subscribeToLifecycle,
  retrySend,
  dismissOperation,
  type SendOperation,
  type SendOperationMode,
  type TransportLifecycleEvent,
  type TransportQueueState,
  getTechnicalErrorFor,
  teardownChatTransportQueue,
} from './chatTransportQueue';

export type ChatSendVariables = {
  text: string;
  mode: SendOperationMode;
  clientId: string;
  capturedText: string;
  replyTo: ChatReplyContext | null;
  senderLabel: string;
};

export type ChatSendResult = {
  messageId: string;
  conversationId: string;
};

export type ChatSendQueueOptions = {
  onSuccess?: (result: ChatSendResult, variables: ChatSendVariables) => void | Promise<void>;
  onError?: (error: Error, variables: ChatSendVariables) => void;
  onSettled?: (variables: ChatSendVariables) => void;
  onLifecycle?: (event: TransportLifecycleEvent) => void;
};

export type ChatSendQueueMutation = {
  mutate: (variables: ChatSendVariables) => void;
  mutateAsync: (variables: ChatSendVariables) => Promise<ChatSendResult>;
  isPending: boolean;
  isError: boolean;
  error: Error | null;
  data: ChatSendResult | null;
};

const MAX_LIFECYCLE_EVENTS = 200;

export function useChatSendQueue(options?: ChatSendQueueOptions): ChatSendQueueMutation {
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [data, setData] = useState<ChatSendResult | null>(null);

  const pendingRef = useRef<Map<string, { variables: ChatSendVariables; resolve: (r: ChatSendResult) => void; reject: (e: Error) => void }>>(new Map());
  const handledRef = useRef<Set<string>>(new Set());
  const lifecycleRef = useRef<TransportLifecycleEvent[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    void initChatTransportQueue();

    const unsubState = subscribeToQueueState((queueState) => {
      const busy = isQueueBusy();
      setIsPending(busy);

      queueState.operations.forEach((op) => {
        if (handledRef.current.has(op.requestId)) return;

        const pending = pendingRef.current.get(op.requestId);
        if (!pending) return;

        if (op.status === 'sent') {
          handledRef.current.add(op.requestId);
          pending.resolve({
            messageId: op.clientId,
            conversationId: 'ivx-owner-room',
          });
          pendingRef.current.delete(op.requestId);
          setData({ messageId: op.clientId, conversationId: 'ivx-owner-room' });
          setIsError(false);
          setError(null);
          void optionsRef.current?.onSuccess?.(
            { messageId: op.clientId, conversationId: 'ivx-owner-room' },
            pending.variables
          );
          optionsRef.current?.onSettled?.(pending.variables);
        } else if (op.status === 'failed') {
          handledRef.current.add(op.requestId);
          const techError = getTechnicalErrorFor(op.requestId) || op.lastError || 'Send failed';
          const err = new Error(techError);
          pending.reject(err);
          pendingRef.current.delete(op.requestId);
          setIsError(true);
          setError(err);
          setData(null);
          optionsRef.current?.onError?.(err, pending.variables);
          optionsRef.current?.onSettled?.(pending.variables);
        }
      });
    });

    const unsubLifecycle = subscribeToLifecycle((event) => {
      lifecycleRef.current = [...lifecycleRef.current, event].slice(-MAX_LIFECYCLE_EVENTS);
      optionsRef.current?.onLifecycle?.(event);
    });

    return () => {
      unsubState();
      unsubLifecycle();
      teardownChatTransportQueue();
    };
  }, []);

  const mutateAsync = useCallback(async (variables: ChatSendVariables): Promise<ChatSendResult> => {
    const requestId = enqueueSend({
      text: variables.text,
      mode: variables.mode,
      replyTo: variables.replyTo,
      senderLabel: variables.senderLabel,
      clientId: variables.clientId,
    });

    setIsPending(true);

    return new Promise<ChatSendResult>((resolve, reject) => {
      pendingRef.current.set(requestId, { variables, resolve, reject });

      const safetyTimer = setTimeout(() => {
        const stillPending = pendingRef.current.get(requestId);
        if (stillPending) {
          pendingRef.current.delete(requestId);
          handledRef.current.add(requestId);
          const error = new Error(
            'Send queue timeout: the request was not processed within 10 minutes. Senior-developer and factory tasks can take several minutes to run live — please retry if this was a long-running task.'
          );
          stillPending.reject(error);
          setIsPending(false);
          setIsError(true);
          setError(error);
          optionsRef.current?.onError?.(error, stillPending.variables);
          optionsRef.current?.onSettled?.(stillPending.variables);
        }
      }, 600_000);

      // Clear safety timer when resolved
      const checkTimer = setInterval(() => {
        if (!pendingRef.current.has(requestId)) {
          clearTimeout(safetyTimer);
          clearInterval(checkTimer);
        }
      }, 200);
    }).finally(() => {
      setIsPending(isQueueBusy());
    });
  }, []);

  const mutate = useCallback((variables: ChatSendVariables) => {
    void mutateAsync(variables).catch((err: Error) => {
      // Swallow unhandled rejections from fire-and-forget mutate calls.
      console.log('[useChatSendQueue] mutate fire-and-forget error:', err.message);
    });
  }, [mutateAsync]);

  return {
    mutate,
    mutateAsync,
    isPending,
    isError,
    error,
    data,
  };
}

export function useChatTransportLifecycle(): TransportLifecycleEvent[] {
  const [events, setEvents] = useState<TransportLifecycleEvent[]>([]);

  useEffect(() => {
    const unsub = subscribeToLifecycle((event) => {
      setEvents((prev) => [...prev, event].slice(-MAX_LIFECYCLE_EVENTS));
    });
    return unsub;
  }, []);

  return events;
}

export function useChatQueueOperations(): SendOperation[] {
  const [operations, setOperations] = useState<SendOperation[]>([]);

  useEffect(() => {
    const unsub = subscribeToQueueState((state) => {
      setOperations(state.operations);
    });
    return unsub;
  }, []);

  return operations;
}
