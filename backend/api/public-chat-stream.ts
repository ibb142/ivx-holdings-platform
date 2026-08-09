/**
 * IVX Public Chat SSE streaming endpoint.
 *
 * Streams token deltas from the AI gateway to the client as Server-Sent Events
 * so the UI can render text progressively instead of waiting for the full
 * completion. Structured event protocol:
 *
 *   data: {"type":"response.started","requestId":"...","sessionId":"...","model":"..."}
 *   data: {"type":"response.delta","delta":"partial text..."}
 *   data: {"type":"response.completed","text":"full text","model":"...","source":"chatgpt"}
 *   data: {"type":"response.error","error":"sanitized message"}
 *
 * If the message is routed to a deterministic brain (identity / conversation /
 * fallback) the full text is emitted as a single delta + completed event so
 * the frontend streaming contract stays uniform.
 */
import {
  buildFallbackAnswer,
  buildSystemPrompt,
  buildTranscript,
  isPublicChatAIConfigured,
  sanitizePublicChatHistory,
  type PublicChatHistoryItem,
  type PublicChatSource,
} from '../public-chat-ai';
import { detectMessageLanguage, buildLanguageInstruction } from '../services/ivx-language-detector';
import { getIVXAIEndpoint, resolveIVXAIModel, streamIVXAIText } from '../ivx-ai-runtime';
import { resolveIVXIdentityAnswer } from '../services/ivx-ia-identity-brain';
import { resolveIVXConversationAnswer } from '../services/ivx-ia-conversation-brain';
import { classifyIntent } from '../services/ivx-authoritative-intent-router';
import { routeIVXChatIntent, branchLabel, type IVXChatBranch } from '../services/ivx-chat-intent-router';
import { isVagueExecutionRequest } from '../public-chat-ai';
import { formatPublicChatGateBlock } from '../services/ivx-public-chat-gate-response';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';
import { extractPublicChatImages } from '../services/ivx-public-chat-vision';
import { extractDealDocuments } from '../services/ivx-deal-documents';
import {
  getPublicChatSupabaseStore,
} from '../public-chat-supabase-store';
import type { ChatStorage } from '../chat-storage';
import { isDeploymentCommand, routeDeploymentCommand } from '../services/ivx-deployment-chat-brain';

// ── Persistence (mirrors handlePublicChatPost) ──────────────────────────────

let publicChatHistoryStorage: ChatStorage | null = null;

export function setPublicChatStreamStorage(storage: ChatStorage): void {
  publicChatHistoryStorage = storage;
}

const PUBLIC_CHAT_SESSION_ROOM_PREFIX = 'pcs-';

function sessionRoomId(sessionId: string): string {
  return `${PUBLIC_CHAT_SESSION_ROOM_PREFIX}${sessionId}`;
}

function sanitizeSessionId(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.replace(/[^A-Za-z0-9_:-]/g, '-').slice(0, 80);
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function createId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function sanitizeClientId(value: unknown): string {
  const trimmed = readTrimmed(value);
  return trimmed.replace(/[^A-Za-z0-9_:.-]/g, '').slice(0, 128);
}

function resolveClientIdentifier(request: Request): string {
  const headerClientId = sanitizeClientId(request.headers.get('x-ivx-client-id'));
  if (headerClientId) return headerClientId;
  const forwarded = readTrimmed(request.headers.get('cf-connecting-ip'))
    || readTrimmed(request.headers.get('x-real-ip'))
    || readTrimmed(request.headers.get('x-forwarded-for')).split(',')[0]?.trim()
    || 'anonymous';
  return forwarded || 'anonymous';
}

function sanitizeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return readTrimmed(raw)
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .replace(/(apikey[=:]\s*)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .slice(0, 280) || fallback;
}

function sanitizeHistory(history: unknown): PublicChatHistoryItem[] {
  if (!Array.isArray(history)) return [];
  const normalized = history
    .slice(0, 50)
    .map((item) => {
      const record = item as Record<string, unknown>;
      const role = record?.role === 'assistant' ? 'assistant' : record?.role === 'user' ? 'user' : null;
      const content = readTrimmed(record?.content);
      if (!role || !content) return null;
      return { role, content } as PublicChatHistoryItem;
    })
    .filter((item): item is PublicChatHistoryItem => item !== null);
  return sanitizePublicChatHistory(normalized);
}

async function persistPublicTurn(input: {
  sessionId: string;
  clientId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  source: string;
  model?: string | null;
}): Promise<void> {
  const store = getPublicChatSupabaseStore();
  if (store.isConfigured()) {
    try {
      await store.appendMessage(input);
      return;
    } catch {
      // fall through to JSON
    }
  }
  if (publicChatHistoryStorage) {
    try {
      publicChatHistoryStorage.createMessage({
        roomId: sessionRoomId(input.sessionId),
        username: input.role === 'assistant' ? 'IVX Assistant' : input.clientId,
        text: input.content,
        source: input.role === 'assistant' ? 'assistant' : input.role === 'system' ? 'system' : 'user',
      });
    } catch {
      // never block on persistence
    }
  }
}

// ── SSE helpers ──────────────────────────────────────────────────────────────

function sseLine(payload: Record<string, unknown>): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const SSE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, x-ivx-client-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// ── Deterministic brain check (mirrors generatePublicChatAnswer fast paths) ──

type DeterministicResult = {
  answer: string;
  model: string;
  source: PublicChatSource;
} | null;

function checkDeterministicBrains(
  message: string,
  sessionId: string,
): DeterministicResult {
  // Identity brain
  const identityAnswer = resolveIVXIdentityAnswer(message);
  if (identityAnswer) {
    return { answer: identityAnswer, model: 'ivx-ia-identity-brain', source: 'fallback' };
  }
  // Conversation brain
  const conversationAnswer = resolveIVXConversationAnswer(message);
  if (conversationAnswer) {
    return { answer: conversationAnswer, model: 'ivx-ia-conversation-brain', source: 'fallback' };
  }
  return null;
}

// ── Main streaming handler ──────────────────────────────────────────────────

export async function handlePublicChatStreamPost(request: Request): Promise<Response> {
  const encoder = new TextEncoder();

  // OPTIONS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: SSE_HEADERS });
  }

  const clientId = resolveClientIdentifier(request);

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    return new Response(
      JSON.stringify({ ok: false, error: 'Invalid JSON body.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const message = readTrimmed(body.message).slice(0, 2000);
  const requestedSessionId = sanitizeSessionId(body.sessionId);
  const sessionId = requestedSessionId || createId('public-session');
  const requestId = readTrimmed(body.requestId) || createId('public-stream');
  const history = sanitizeHistory(body.history);
  const images = extractPublicChatImages(body);
  const documents = extractDealDocuments(body);

  if (!message && images.length === 0 && documents.length === 0) {
    return new Response(
      JSON.stringify({ ok: false, error: 'Message is required.' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (payload: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(sseLine(payload)));
      };

      const sendErrorAndClose = (error: string) => {
        send({ type: 'response.error', error, requestId, sessionId });
        controller.close();
      };

      try {
        // ── response.started ──────────────────────────────────────────────
        send({
          type: 'response.started',
          requestId,
          sessionId,
          timestamp: new Date().toISOString(),
        });

        // ── Persist user message (fire-and-forget) ────────────────────────
        void persistPublicTurn({
          sessionId,
          clientId,
          role: 'user',
          content:
            message ||
            (images.length > 0 ? `[image attachment x${images.length}]` : '') ||
            (documents.length > 0 ? `[deal document x${documents.length}]` : ''),
          source: 'user',
          model: null,
        }).catch(() => undefined);

        // ── Pre-execution gate ────────────────────────────────────────────
        try {
          const gate = await checkPreExecutionGate(request, {
            prompt: message,
            ownerSessionPresent: false,
            entryPoint: 'public-chat',
            skipLiveProbes: true,
          });
          if (gate.blocked && gate.result.state === 'BLOCKED') {
            const answer = formatPublicChatGateBlock(gate.result);
            send({ type: 'response.delta', delta: answer, requestId });
            send({
              type: 'response.completed',
              text: answer,
              model: 'ivx-pre-execution-gate',
              source: 'fallback',
              requestId,
              sessionId,
            });
            void persistPublicTurn({
              sessionId, clientId, role: 'assistant',
              content: answer, source: 'system', model: 'ivx-pre-execution-gate',
            }).catch(() => undefined);
            controller.close();
            return;
          }
        } catch {
          // non-blocking
        }

        // ── Deployment command routing ────────────────────────────────────
        if (message && isDeploymentCommand(message)) {
          const brainResult = await routeDeploymentCommand(message);
          if (brainResult) {
            send({ type: 'response.delta', delta: brainResult, requestId });
            send({
              type: 'response.completed',
              text: brainResult,
              model: 'ivx-deployment-brain',
              source: 'deployment-brain',
              requestId,
              sessionId,
            });
            void persistPublicTurn({
              sessionId, clientId, role: 'assistant',
              content: brainResult, source: 'deployment-brain', model: 'ivx-deployment-brain',
            }).catch(() => undefined);
            controller.close();
            return;
          }
        }

        // ── Deterministic brains (identity / conversation) ────────────────
        const deterministic = checkDeterministicBrains(message, sessionId);
        if (deterministic) {
          // Emit as a single delta so the frontend contract is uniform
          send({ type: 'response.delta', delta: deterministic.answer, requestId });
          send({
            type: 'response.completed',
            text: deterministic.answer,
            model: deterministic.model,
            source: deterministic.source,
            requestId,
            sessionId,
          });
          void persistPublicTurn({
            sessionId, clientId, role: 'assistant',
            content: deterministic.answer, source: deterministic.source, model: deterministic.model,
          }).catch(() => undefined);
          controller.close();
          return;
        }

        // ── Authoritative intent router ───────────────────────────────────
        const authoritativeDecision = classifyIntent({
          message,
          isOwner: false,
          isPublicPath: true,
          hasImageAttachments: images.length > 0,
        });

        const isVagueExec = isVagueExecutionRequest(message);
        const isExecutionRoute = authoritativeDecision.selectedRoute === 'CLARIFICATION'
          || authoritativeDecision.selectedRoute === 'DEVELOPER_WORKER'
          || authoritativeDecision.selectedRoute === 'DEPLOYMENT_ACTION';

        if (isExecutionRoute && !isVagueExec && authoritativeDecision.safetyStage.publicBoundary === 'public_blocked') {
          const blockAnswer = `This request requires owner authentication. Safe technical questions, code reviews, architecture designs, and product information are available without login. Try rephrasing your question if you want an explanation rather than an execution.`;
          send({ type: 'response.delta', delta: blockAnswer, requestId });
          send({
            type: 'response.completed',
            text: blockAnswer,
            model: 'ivx-authoritative-router',
            source: 'fallback',
            requestId,
            sessionId,
          });
          void persistPublicTurn({
            sessionId, clientId, role: 'assistant',
            content: blockAnswer, source: 'fallback', model: 'ivx-authoritative-router',
          }).catch(() => undefined);
          controller.close();
          return;
        }

        // Legacy router (audit only)
        const routeDecision = routeIVXChatIntent(message, images.length > 0);
        void branchLabel;
        const authoritativeApproved = authoritativeDecision.selectedRoute === 'PUBLIC_LLM_RESPONSE'
          || (isExecutionRoute && isVagueExec);
        if (routeDecision.requiresOwnerSession && !authoritativeApproved) {
          const blockAnswer = `This request requires owner authentication. Safe technical questions, code reviews, and architecture designs are available without login.`;
          send({ type: 'response.delta', delta: blockAnswer, requestId });
          send({
            type: 'response.completed',
            text: blockAnswer,
            model: 'ivx-chat-intent-router',
            source: 'fallback',
            requestId,
            sessionId,
          });
          void persistPublicTurn({
            sessionId, clientId, role: 'assistant',
            content: blockAnswer, source: 'fallback', model: 'ivx-chat-intent-router',
          }).catch(() => undefined);
          controller.close();
          return;
        }

        // ── Check if AI is configured ─────────────────────────────────────
        if (!isPublicChatAIConfigured()) {
          const fallbackAnswer = buildFallbackAnswer(message);
          send({ type: 'response.delta', delta: fallbackAnswer, requestId });
          send({
            type: 'response.completed',
            text: fallbackAnswer,
            model: 'ivx-local-fallback',
            source: 'fallback',
            requestId,
            sessionId,
          });
          void persistPublicTurn({
            sessionId, clientId, role: 'assistant',
            content: fallbackAnswer, source: 'fallback', model: 'ivx-local-fallback',
          }).catch(() => undefined);
          controller.close();
          return;
        }

        // ── Build system prompt + user prompt (same as requestIVXAIAnswer) ──
        const model = resolveIVXAIModel('gpt-4o');
        const endpoint = getIVXAIEndpoint(model);
        if (!endpoint) {
          const fallbackAnswer = buildFallbackAnswer(message);
          send({ type: 'response.delta', delta: fallbackAnswer, requestId });
          send({
            type: 'response.completed',
            text: fallbackAnswer,
            model: 'ivx-local-fallback',
            source: 'fallback',
            requestId,
            sessionId,
          });
          controller.close();
          return;
        }

        // Image attachments require multimodal messages which streamIVXAIText
        // does not support yet. For image requests, fall back to the
        // non-streaming requestIVXAIText path and emit the full answer as a
        // single delta. Text-only requests get real token streaming.
        if (images.length > 0) {
          const { requestIVXAIText } = await import('../ivx-ai-runtime');
          const { buildBusinessContextBlock, loadBusinessContext } = await import('../services/ivx-business-context');
          const { buildDealIntelligenceBlock } = await import('../services/ivx-deal-intelligence');
          let businessContext: string | null = null;
          try {
            const ctx = await loadBusinessContext();
            const baseBlock = buildBusinessContextBlock(ctx);
            const dealIntel = buildDealIntelligenceBlock(ctx.projects);
            businessContext = dealIntel ? `${baseBlock}\n\n${dealIntel}` : baseBlock;
          } catch { /* non-blocking */ }

          const promptParts = [
            'Recent public chat transcript:',
            buildTranscript(history),
            '',
          ];
          if (businessContext) { promptParts.push(businessContext, ''); }
          promptParts.push(
            `Note: ${images.length} image attachment(s) accompany this message — analyze them as part of your answer.`,
            '',
            `User message: ${message || 'Analyze the attached image(s).'}`,
            '',
            'Reply directly to the user message. If the user asks for an exact token or proof string, include it exactly.',
          );
          const system = buildSystemPrompt(sessionId, true, documents, null, null, message);
          try {
            const result = await requestIVXAIText({
              module: 'public-chat',
              requestId,
              model,
              system,
              prompt: promptParts.join('\n'),
              images,
            });
            send({ type: 'response.delta', delta: result.text, requestId });
            send({
              type: 'response.completed',
              text: result.text,
              model: result.providerMetadata.model,
              source: 'chatgpt',
              endpoint: result.providerMetadata.endpoint,
              requestId,
              sessionId,
            });
            void persistPublicTurn({
              sessionId, clientId, role: 'assistant',
              content: result.text, source: 'chatgpt', model: result.providerMetadata.model,
            }).catch(() => undefined);
          } catch (imgErr) {
            const errMsg = sanitizeErrorMessage(imgErr, 'AI request failed.');
            const fallbackAnswer = buildFallbackAnswer(message);
            send({ type: 'response.delta', delta: fallbackAnswer, requestId });
            send({
              type: 'response.completed',
              text: fallbackAnswer,
              model: 'ivx-local-fallback',
              source: 'fallback',
              requestId,
              sessionId,
              error: errMsg,
            });
            void persistPublicTurn({
              sessionId, clientId, role: 'assistant',
              content: fallbackAnswer, source: 'fallback', model: 'ivx-local-fallback',
            }).catch(() => undefined);
          }
          controller.close();
          return;
        }

        // ── Text-only: real streaming from the AI gateway ─────────────────
        const promptParts = [
          'Recent public chat transcript:',
          buildTranscript(history),
          '',
          `User message: ${message}`,
          '',
          'Reply directly to the user message. If the user asks for an exact token or proof string, include it exactly.',
        ];

        const system = buildSystemPrompt(
          sessionId,
          false,
          documents,
          null,
          null,
          message,
        );

        let accumulated = '';
        let streamError: string | null = null;

        try {
          for await (const chunk of streamIVXAIText({
            module: 'public-chat',
            requestId,
            model,
            system,
            prompt: promptParts.join('\n'),
          })) {
            if (chunk.type === 'delta' && chunk.delta) {
              accumulated += chunk.delta;
              send({ type: 'response.delta', delta: chunk.delta, requestId });
            } else if (chunk.type === 'done') {
              // Use accumulated text (may include partial if error occurred)
              const finalText = chunk.text || accumulated;
              const finalModel = chunk.providerMetadata?.model || model;
              send({
                type: 'response.completed',
                text: finalText,
                model: finalModel,
                source: 'chatgpt',
                endpoint: chunk.providerMetadata?.endpoint || endpoint,
                requestId,
                sessionId,
                ...(chunk.error ? { error: chunk.error } : {}),
              });
              // Persist the completed assistant message
              void persistPublicTurn({
                sessionId, clientId, role: 'assistant',
                content: finalText, source: 'chatgpt', model: finalModel,
              }).catch(() => undefined);
            } else if (chunk.type === 'error') {
              streamError = chunk.error || 'AI stream failed';
            }
          }

          // If stream produced an error but no done event, emit error
          if (streamError && accumulated.length === 0) {
            // Try fallback
            const fallbackAnswer = buildFallbackAnswer(message);
            send({ type: 'response.delta', delta: fallbackAnswer, requestId });
            send({
              type: 'response.completed',
              text: fallbackAnswer,
              model: 'ivx-local-fallback',
              source: 'fallback',
              requestId,
              sessionId,
            });
            void persistPublicTurn({
              sessionId, clientId, role: 'assistant',
              content: fallbackAnswer, source: 'fallback', model: 'ivx-local-fallback',
            }).catch(() => undefined);
          } else if (streamError && accumulated.length > 0) {
            // Partial response was streamed — emit completed with partial text
            send({
              type: 'response.completed',
              text: accumulated,
              model,
              source: 'chatgpt',
              requestId,
              sessionId,
              error: streamError,
            });
            void persistPublicTurn({
              sessionId, clientId, role: 'assistant',
              content: accumulated, source: 'chatgpt', model,
            }).catch(() => undefined);
          }
        } catch (streamErr) {
          const errMsg = sanitizeErrorMessage(streamErr, 'AI streaming failed');
          if (accumulated.length > 0) {
            // Partial response was streamed — preserve it
            send({
              type: 'response.completed',
              text: accumulated,
              model,
              source: 'chatgpt',
              requestId,
              sessionId,
              error: errMsg,
            });
            void persistPublicTurn({
              sessionId, clientId, role: 'assistant',
              content: accumulated, source: 'chatgpt', model,
            }).catch(() => undefined);
          } else {
            // No text was streamed — send error event
            send({ type: 'response.error', error: errMsg, requestId, sessionId });
            // Also try a fallback answer so the user sees something
            const fallbackAnswer = buildFallbackAnswer(message);
            send({ type: 'response.delta', delta: fallbackAnswer, requestId });
            send({
              type: 'response.completed',
              text: fallbackAnswer,
              model: 'ivx-local-fallback',
              source: 'fallback',
              requestId,
              sessionId,
            });
            void persistPublicTurn({
              sessionId, clientId, role: 'assistant',
              content: fallbackAnswer, source: 'fallback', model: 'ivx-local-fallback',
            }).catch(() => undefined);
          }
        }

        controller.close();
      } catch (error) {
        const errMsg = sanitizeErrorMessage(error, 'Unable to process streaming chat request.');
        try {
          send({ type: 'response.error', error: errMsg, requestId, sessionId });
        } catch {
          // controller may already be closed
        }
        try {
          controller.close();
        } catch {
          // already closed
        }
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
