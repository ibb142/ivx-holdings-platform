/**
 * IVX Owner AI streaming endpoint.
 *
 * SSE response that streams token deltas as they arrive from the gateway. The
 * client can render partial text immediately instead of waiting for the full
 * completion (and instead of hitting a 10s watchdog wall).
 *
 * Event shapes (all JSON-encoded `data:` lines):
 *   { type: 'start', requestId, model, adaptiveTimeoutMs }
 *   { type: 'delta', delta }
 *   { type: 'done',  text, usage }
 *   { type: 'error', error }
 */
import { computeAdaptiveTimeoutMs, streamIVXAIText } from '../ivx-ai-runtime';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions, type IVXOwnerRequestContext } from './owner-only';
import { IVX_OWNER_AI_ROOM_ID } from '../../expo/constants/ivx-owner-ai';
import { ownerChatFingerprint, ownerChatRequestKey, ownerChatRequestStore, runOwnerChatOnce } from '../services/ivx-owner-chat-admission';

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function sseLine(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

export const OPTIONS = (): Response => ownerOnlyOptions();

export async function handleIVXOwnerAIStreamRequest(request: Request): Promise<Response> {
  let owner: IVXOwnerRequestContext;
  try {
    owner = await assertIVXOwnerOnly(request);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Owner authentication failed.';
    const reportedStatus = error && typeof error === 'object' ? (error as { status?: unknown }).status : null;
    const status = typeof reportedStatus === 'number' && Number.isInteger(reportedStatus) && reportedStatus >= 400 && reportedStatus <= 599
      ? reportedStatus : message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message }, status);
  }

  let body: Record<string, unknown> = {};
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid body');
    body = parsed as Record<string, unknown>;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const prompt = readTrimmed(body.prompt) || readTrimmed(body.message);
  const system = readTrimmed(body.system) || null;
  const model = readTrimmed(body.model) || null;
  const requestId = readTrimmed(body.requestId);
  const maxOutputTokens = Number.isFinite(Number(body.maxOutputTokens))
    ? Math.min(Math.max(Number(body.maxOutputTokens), 64), 12_000)
    : 3000;

  if (!prompt || !requestId || requestId.length > 512) {
    return ownerOnlyJson({ ok: false, error: 'prompt and a stable requestId of at most 512 characters are required.' }, 400);
  }

  const promptChars = prompt.length + (system?.length ?? 0);
  const adaptiveTimeoutMs = computeAdaptiveTimeoutMs({ promptChars, maxOutputTokens });
  // Use the same owner-room identity as the canonical JSON/SSE handler. Reusing
  // that identity with different execution inputs is a conflict, not a new call.
  const key = ownerChatRequestKey(owner.userId, IVX_OWNER_AI_ROOM_ID, requestId);
  const fingerprint = ownerChatFingerprint({ conversationId: IVX_OWNER_AI_ROOM_ID,
    message: prompt, streamOptions: { system, model, maxOutputTokens } });

  const encoder = new TextEncoder();
  let disconnected = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (payload: unknown): void => {
        if (disconnected) return;
        try { controller.enqueue(encoder.encode(sseLine(payload))); } catch { disconnected = true; }
      };
      emit({
        type: 'start',
        requestId,
        model: model ?? 'default',
        adaptiveTimeoutMs,
        promptChars,
      });

      try {
        const response = await runOwnerChatOnce({
          key, requestId, fingerprint, store: ownerChatRequestStore(owner.client),
          identity: { ownerId: owner.userId, conversationId: IVX_OWNER_AI_ROOM_ID, requestId },
          execute: async () => {
            try {
              let completed: Record<string, unknown> | null = null;
              for await (const chunk of streamIVXAIText({ module: 'owner-room', requestId, model, system, prompt, maxOutputTokens })) {
                if (chunk.type === 'delta') emit(chunk);
                else if (chunk.type === 'error') throw new Error(chunk.error || 'Provider stream failed.');
                else if (chunk.type === 'done') completed = { ...chunk };
              }
              if (!completed || typeof completed.text !== 'string' || !completed.text.trim()) throw new Error('Provider stream ended without a complete answer.');
              // Deltas remain live; done is emitted only after the receipt is
              // durable. This route does not claim to have inserted chat rows.
              return ownerOnlyJson({ ok: true, status: 'ok', requestId,
                conversationId: IVX_OWNER_AI_ROOM_ID, answer: completed.text,
                assistantPersisted: false, assistantMessageId: null, streamResult: completed });
            } catch (error) {
              return ownerOnlyJson({ ok: false, status: 'error', code: 'OWNER_STREAM_PROVIDER_FAILED',
                requestId, error: error instanceof Error ? error.message : 'Provider stream failed.' }, 502);
            }
          },
        });
        const payload = await response.json() as Record<string, unknown>;
        if (response.ok && payload.ok === true && payload.streamResult && typeof payload.streamResult === 'object') {
          emit({ ...payload.streamResult, requestId, receiptPersisted: true, assistantPersisted: false,
            replayed: response.headers.get('X-IVX-Request-Replayed') === 'true' });
        } else {
          emit({ type: 'error', requestId, status: response.status, code: payload.code,
            error: payload.error || 'The original stream outcome is not confirmed.' });
        }
      } catch (error) {
        emit({
          type: 'error', requestId, status: 503, code: 'OWNER_CHAT_RECONCILIATION_REQUIRED',
          error: error instanceof Error ? error.message : 'stream failed',
        });
      } finally {
        if (!disconnected) { try { controller.close(); } catch { /* already disconnected */ } }
      }
    },
    // Losing the client connection cannot erase the admitted request or its
    // eventual receipt. A later request reconciles the same owner/message key.
    cancel() { disconnected = true; },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
    },
  });
}
