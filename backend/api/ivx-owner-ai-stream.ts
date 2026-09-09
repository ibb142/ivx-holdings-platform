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
    const status = message.toLowerCase().includes('missing bearer') ? 401 : 403;
    return ownerOnlyJson({ ok: false, error: message }, status);
  }
  void owner;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return ownerOnlyJson({ ok: false, error: 'Invalid JSON body.' }, 400);
  }

  const prompt = readTrimmed(body.prompt) || readTrimmed(body.message);
  const system = readTrimmed(body.system) || null;
  const model = readTrimmed(body.model) || null;
  const requestId = readTrimmed(body.requestId) || `ivx-stream-${Date.now()}`;
  const maxOutputTokens = Number.isFinite(Number(body.maxOutputTokens))
    ? Math.min(Math.max(Number(body.maxOutputTokens), 64), 12_000)
    : 3000;

  if (!prompt) {
    return ownerOnlyJson({ ok: false, error: 'prompt is required.' }, 400);
  }

  const promptChars = prompt.length + (system?.length ?? 0);
  const adaptiveTimeoutMs = computeAdaptiveTimeoutMs({ promptChars, maxOutputTokens });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(sseLine({
        type: 'start',
        requestId,
        model: model ?? 'default',
        adaptiveTimeoutMs,
        promptChars,
      })));

      try {
        for await (const chunk of streamIVXAIText({
          module: 'owner-room',
          requestId,
          model,
          system,
          prompt,
          maxOutputTokens,
        })) {
          controller.enqueue(encoder.encode(sseLine(chunk)));
        }
      } catch (error) {
        controller.enqueue(encoder.encode(sseLine({
          type: 'error',
          error: error instanceof Error ? error.message : 'stream failed',
        })));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
    },
  });
}
