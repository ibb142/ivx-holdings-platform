/**
 * IVX Public Chat SSE streaming client.
 *
 * Uses fetch + ReadableStream to parse Server-Sent Events from
 * /api/public/chat/stream. Emits structured events so the UI can:
 *   - show a minimal typing indicator before first token
 *   - append deltas progressively to one assistant message
 *   - persist the final response
 *   - stop generation via AbortController
 *   - handle stream errors with retry
 *
 * Does NOT use setTimeout, fake typing, or post-hoc text splitting.
 * All deltas originate from the live AI gateway response.
 */
import { getDirectApiBaseUrl } from '@/lib/api-base';
import type { PublicChatHistoryItem } from './public-chat';

// ── Stream event types ─────────────────────────────────────────────────────

export type AutonomousTaskEvent = {
  type: 'response.autonomous_task';
  ok: boolean;
  jobId: string | null;
  status: string;
  stage: string;
  progressPercent: number;
  attached: boolean;
  error: string | null;
  intent: {
    isExecutionCommand: boolean;
    requiresApproval: boolean;
    approvalCategories: string[];
    autoExecute: boolean;
    executionMode: string;
    templateMode: string;
  };
};

export type ChatStreamEvent =
  | { type: 'response.started'; requestId: string; sessionId: string; timestamp: string }
  | { type: 'response.delta'; delta: string; requestId: string }
  | { type: 'response.completed'; text: string; model: string; source: string; endpoint?: string | null; requestId: string; sessionId: string; error?: string; jobId?: string | null; jobStatus?: string; jobStage?: string }
  | { type: 'response.autonomous_task'; ok: boolean; jobId: string | null; status: string; stage: string; progressPercent: number; attached: boolean; error: string | null; intent: { isExecutionCommand: boolean; requiresApproval: boolean; approvalCategories: string[]; autoExecute: boolean; executionMode: string; templateMode: string } }
  | { type: 'response.error'; error: string; requestId: string; sessionId: string };

export type StreamCallbacks = {
  onEvent: (event: ChatStreamEvent) => void;
  onError: (error: string) => void;
  onComplete: (finalText: string, model: string, source: string) => void;
  onAutonomousTask?: (event: AutonomousTaskEvent) => void;
};

export type StreamPublicChatInput = {
  message: string;
  history: PublicChatHistoryItem[];
  sessionId: string;
  requestId: string;
  clientId?: string;
  signal?: AbortSignal | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function buildStreamHeaders(clientId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'text/event-stream',
  };
  const trimmed = typeof clientId === 'string' ? clientId.trim() : '';
  if (trimmed) {
    headers['x-ivx-client-id'] = trimmed;
  }
  return headers;
}

function getStreamBaseUrl(): string {
  return getDirectApiBaseUrl();
}

/**
 * Parse an SSE chunk into individual `data:` lines.
 * Each line is a JSON-encoded event.
 */
function parseSSEChunk(chunk: string): string[] {
  return chunk
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => line.slice(6).trim())
    .filter((line) => line.length > 0);
}

// ── Main streaming function ────────────────────────────────────────────────

/**
 * Stream a public chat message via SSE.
 *
 * Returns a promise that resolves when the stream completes (response.completed
 * or response.error). The caller can abort early via the AbortSignal — already
 * received text is preserved in the deltas emitted so far.
 */
export async function streamPublicChatMessage(
  input: StreamPublicChatInput,
  callbacks: StreamCallbacks,
): Promise<void> {
  const baseUrl = getStreamBaseUrl();
  const url = `${baseUrl}/public/chat/stream`;
  const controller = new AbortController();

  // Link external signal to our controller
  if (input.signal) {
    if (input.signal.aborted) {
      controller.abort();
    } else {
      input.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: buildStreamHeaders(input.clientId),
      body: JSON.stringify({
        requestId: input.requestId,
        sessionId: input.sessionId,
        message: input.message,
        history: input.history,
      }),
      signal: controller.signal,
    });
  } catch (fetchError) {
    if (controller.signal.aborted) {
      // User stopped generation — not an error, just resolve
      return;
    }
    const msg = fetchError instanceof Error ? fetchError.message : 'Network request failed.';
    callbacks.onError(msg);
    return;
  }

  if (!response.ok) {
    let errMsg = `Request failed with HTTP ${response.status}.`;
    try {
      const text = await response.text();
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) errMsg = parsed.error;
    } catch {
      // use default error message
    }
    callbacks.onError(errMsg);
    return;
  }

  const body = response.body;
  if (!body) {
    callbacks.onError('No response body received from streaming endpoint.');
    return;
  }

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalText = '';
  let finalModel = 'unknown';
  let finalSource = 'chatgpt';
  let completed = false;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Process complete SSE events (separated by \n\n)
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';

      for (const eventChunk of events) {
        const lines = parseSSEChunk(eventChunk);
        for (const line of lines) {
          try {
            const payload = JSON.parse(line) as ChatStreamEvent;
            callbacks.onEvent(payload);

            if (payload.type === 'response.completed') {
              finalText = payload.text;
              finalModel = payload.model;
              finalSource = payload.source;
              completed = true;
            } else if (payload.type === 'response.error') {
              callbacks.onError(payload.error);
              completed = true;
            }
          } catch {
            // Skip malformed JSON line
          }
        }
      }
    }

    // Process any remaining buffer
    if (buffer.length > 0) {
      const lines = parseSSEChunk(buffer);
      for (const line of lines) {
        try {
          const payload = JSON.parse(line) as ChatStreamEvent;
          callbacks.onEvent(payload);
          if (payload.type === 'response.completed') {
            finalText = payload.text;
            finalModel = payload.model;
            finalSource = payload.source;
            completed = true;
          } else if (payload.type === 'response.error') {
            callbacks.onError(payload.error);
            completed = true;
          }
        } catch {
          // Skip
        }
      }
    }
  } catch (readError) {
    if (controller.signal.aborted) {
      // User stopped — resolve with whatever we have
      if (finalText.length > 0 || !completed) {
        callbacks.onComplete(finalText, finalModel, finalSource);
      }
      return;
    }
    const msg = readError instanceof Error ? readError.message : 'Stream read failed.';
    callbacks.onError(msg);
    return;
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // already released
    }
  }

  if (completed) {
    callbacks.onComplete(finalText, finalModel, finalSource);
  } else if (!controller.signal.aborted) {
    // Stream ended without completion event
    if (finalText.length > 0) {
      callbacks.onComplete(finalText, finalModel, finalSource);
    } else {
      callbacks.onError('Stream ended unexpectedly without a response.');
    }
  }
}
