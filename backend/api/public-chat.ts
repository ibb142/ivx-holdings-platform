import {
  extractPublicChatImages,
  generatePublicChatAnswer,
  sanitizePublicChatHistory,
  type PublicChatHistoryItem,
  type PublicChatSource,
} from '../public-chat-ai';
import { checkPreExecutionGate } from '../services/ivx-pre-execution-gate-middleware';
import { formatPublicChatGateBlock } from '../services/ivx-public-chat-gate-response';
import { extractDealDocuments } from '../services/ivx-deal-documents';
import { isDeploymentCommand, routeDeploymentCommand } from '../services/ivx-deployment-chat-brain';
import type { ChatStorage } from '../chat-storage';
import type { ChatRoomMessage } from '../chat-types';
import {
  getPublicChatSupabaseStore,
  type PublicChatPersistedMessage,
  type PublicChatPersistedRole,
} from '../public-chat-supabase-store';

type PublicChatRequestBody = {
  message?: unknown;
  history?: unknown;
  sessionId?: unknown;
  requestId?: unknown;
  images?: unknown;
  imageUrls?: unknown;
  imageUrl?: unknown;
  attachments?: unknown;
  attachmentUrl?: unknown;
  documents?: unknown;
  documentUrl?: unknown;
  files?: unknown;
  fileUrls?: unknown;
  fileUrl?: unknown;
};

type PublicChatSuccessResponse = {
  ok: true;
  requestId: string;
  sessionId: string;
  answer: string;
  model: string;
  source: PublicChatSource;
  deploymentMarker: string;
  commit: string;
  commitShort: string;
  rateLimitRemaining: number;
  rateLimitResetAt: string;
  timestamp: string;
  endpoint: string | null;
  persistence: 'supabase' | 'json' | 'none';
};

type RateLimitEntry = {
  count: number;
  windowStartedAt: number;
  lastSeenAt: number;
};

const DEPLOYMENT_MARKER = 'ivx-public-chat-2026-04-23t1200z';
/**
 * Live build proof surfaced on every /public/chat reply so the in-app chat can
 * render a developer-proof line (route · model · commit · live backend · time).
 * Render injects RENDER_GIT_COMMIT at deploy time; falls back to other common CI
 * commit vars, then 'unknown' for local runs.
 */
const LIVE_COMMIT_SHA = (
  process.env.RENDER_GIT_COMMIT?.trim() ||
  process.env.GIT_COMMIT?.trim() ||
  process.env.SOURCE_VERSION?.trim() ||
  'unknown'
);
const LIVE_COMMIT_SHORT = LIVE_COMMIT_SHA === 'unknown' ? 'unknown' : LIVE_COMMIT_SHA.slice(0, 8);
const BLOCK17_MARKER = 'ivx-public-chat-history-2026-05-16t-block17';
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const MAX_REQUESTS_PER_WINDOW = 20;
const MAX_MESSAGE_LENGTH = 2000;
const PUBLIC_CHAT_SESSION_ROOM_PREFIX = 'pcs-';
const MAX_SESSION_HISTORY_LIMIT = 100;
const DEFAULT_SESSION_HISTORY_LIMIT = 40;
const MAX_SESSIONS_PER_CLIENT = 25;
const RATE_LIMIT_MAX_ENTRIES = 10_000;
/** Maximum inline history items accepted per request — prevents oversized payloads from clients. */
const MAX_INLINE_HISTORY_ITEMS = 50;
const rateLimitStore = new Map<string, RateLimitEntry>();

let publicChatHistoryStorage: ChatStorage | null = null;

/**
 * Inject the long-lived ChatStorage instance used to persist public-chat
 * sessions and history. Called once from `backend/hono.ts` after the
 * storage is constructed; avoids circular imports.
 */
export function setPublicChatHistoryStorage(storage: ChatStorage): void {
  publicChatHistoryStorage = storage;
  console.log('[IVXPublicChat] History storage wired', {
    marker: BLOCK17_MARKER,
  });
}

function sanitizeSessionId(value: unknown): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.replace(/[^A-Za-z0-9_:-]/g, '-').slice(0, 80);
}

function sessionRoomId(sessionId: string): string {
  return `${PUBLIC_CHAT_SESSION_ROOM_PREFIX}${sessionId}`;
}

function parseLimit(value: unknown, fallback: number, max: number): number {
  const raw = typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(Math.max(Math.floor(raw), 1), max);
}

function toPublicSessionMessage(message: ChatRoomMessage): {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  content: string;
  source: string;
  model: string | null;
  sessionId: string;
  createdAt: string;
} {
  const role: 'user' | 'assistant' | 'system' = message.source === 'assistant'
    ? 'assistant'
    : message.source === 'system'
      ? 'system'
      : 'user';

  return {
    id: message.id,
    role,
    text: message.text,
    content: message.text,
    source: message.source,
    model: null,
    sessionId: message.roomId.startsWith(PUBLIC_CHAT_SESSION_ROOM_PREFIX)
      ? message.roomId.slice(PUBLIC_CHAT_SESSION_ROOM_PREFIX.length)
      : message.roomId,
    createdAt: message.createdAt,
  };
}

function toPublicSupabaseMessage(message: PublicChatPersistedMessage): {
  id: string;
  role: PublicChatPersistedRole;
  text: string;
  content: string;
  source: string;
  model: string | null;
  sessionId: string;
  createdAt: string;
} {
  return {
    id: message.id,
    role: message.role,
    text: message.content,
    content: message.content,
    source: message.source,
    model: message.model,
    sessionId: message.session_id,
    createdAt: message.created_at,
  };
}

function sanitizeErrorMessage(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : fallback;
  return readTrimmed(raw)
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .replace(/(apikey[=:]\s*)[A-Za-z0-9._\-]+/gi, '$1[redacted]')
    .slice(0, 280) || fallback;
}

function jsonResponse(payload: Record<string, unknown>, status: number = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
  });
}

function nowIso(): string {
  return new Date().toISOString();
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

/**
 * Resolve a STABLE per-device client identifier.
 *
 * Prefers the device-generated `x-ivx-client-id` header (persisted on the
 * client and unchanged across reloads/networks). The request IP is only a
 * last-resort fallback: it changes between requests on cellular/Wi-Fi/VPN,
 * which previously made session ownership flip and the chat "disappear".
 */
function resolveClientIdentifier(request: Request): string {
  const headerClientId = sanitizeClientId(request.headers.get('x-ivx-client-id'));
  if (headerClientId) {
    return headerClientId;
  }

  const forwarded = readTrimmed(request.headers.get('cf-connecting-ip'))
    || readTrimmed(request.headers.get('x-real-ip'))
    || readTrimmed(request.headers.get('x-forwarded-for')).split(',')[0]?.trim()
    || 'anonymous';

  return forwarded || 'anonymous';
}

function cleanupRateLimitStore(): void {
  const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
  rateLimitStore.forEach((entry, key) => {
    if (entry.lastSeenAt < cutoff) {
      rateLimitStore.delete(key);
    }
  });

  // Hard cap: if the Map grew beyond RATE_LIMIT_MAX_ENTRIES (e.g. a flood of
  // unique client IDs from a botnet or CDN), evict the oldest entries by
  // lastSeenAt to bound memory. Without this, a sustained attack with unique
  // IPs/headers grows the Map indefinitely until the process OOMs.
  if (rateLimitStore.size > RATE_LIMIT_MAX_ENTRIES) {
    const sorted = [...rateLimitStore.entries()].sort(
      (a, b) => a[1].lastSeenAt - b[1].lastSeenAt,
    );
    const toEvict = sorted.length - RATE_LIMIT_MAX_ENTRIES;
    for (let i = 0; i < toEvict; i++) {
      rateLimitStore.delete(sorted[i][0]);
    }
  }
}

function consumeRateLimit(clientId: string): { allowed: boolean; remaining: number; resetAt: string } {
  cleanupRateLimitStore();

  const now = Date.now();
  const current = rateLimitStore.get(clientId);
  if (!current || now - current.windowStartedAt >= RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(clientId, {
      count: 1,
      windowStartedAt: now,
      lastSeenAt: now,
    });

    return {
      allowed: true,
      remaining: MAX_REQUESTS_PER_WINDOW - 1,
      resetAt: new Date(now + RATE_LIMIT_WINDOW_MS).toISOString(),
    };
  }

  current.count += 1;
  current.lastSeenAt = now;
  rateLimitStore.set(clientId, current);

  return {
    allowed: current.count <= MAX_REQUESTS_PER_WINDOW,
    remaining: Math.max(MAX_REQUESTS_PER_WINDOW - current.count, 0),
    resetAt: new Date(current.windowStartedAt + RATE_LIMIT_WINDOW_MS).toISOString(),
  };
}

async function persistPublicTurn(input: {
  sessionId: string;
  clientId: string;
  role: PublicChatPersistedRole;
  content: string;
  source: string;
  model?: string | null;
}): Promise<'supabase' | 'json' | 'none'> {
  const store = getPublicChatSupabaseStore();
  if (store.isConfigured()) {
    try {
      await store.appendMessage(input);
      return 'supabase';
    } catch (persistError) {
      console.log('[IVXPublicChat] Supabase turn persistence skipped:', {
        sessionId: input.sessionId,
        role: input.role,
        source: input.source,
        error: sanitizeErrorMessage(persistError, 'unknown'),
        marker: BLOCK17_MARKER,
      });
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
      return 'json';
    } catch (persistError) {
      console.log('[IVXPublicChat] JSON turn persistence skipped:', {
        sessionId: input.sessionId,
        role: input.role,
        error: sanitizeErrorMessage(persistError, 'unknown'),
        marker: BLOCK17_MARKER,
      });
    }
  }

  return 'none';
}

function sanitizeHistory(history: unknown): PublicChatHistoryItem[] {
  if (!Array.isArray(history)) {
    return [];
  }

  const normalizedHistory = history
    .slice(0, MAX_INLINE_HISTORY_ITEMS)
    .map((item) => {
      const record = item as Record<string, unknown>;
      const role = record?.role === 'assistant' ? 'assistant' : record?.role === 'user' ? 'user' : null;
      const content = readTrimmed(record?.content);

      if (!role || !content) {
        return null;
      }

      return { role, content } satisfies PublicChatHistoryItem;
    })
    .filter((item): item is PublicChatHistoryItem => item !== null);

  return sanitizePublicChatHistory(normalizedHistory);
}

export async function handlePublicChatPost(request: Request): Promise<Response> {
  const clientId = resolveClientIdentifier(request);
  const rateLimit = consumeRateLimit(clientId);
  if (!rateLimit.allowed) {
    return jsonResponse({
      error: 'Rate limit reached. Please wait a moment before sending another message.',
      deploymentMarker: DEPLOYMENT_MARKER,
      rateLimitRemaining: rateLimit.remaining,
      rateLimitResetAt: rateLimit.resetAt,
    }, 429);
  }

  try {
    const body = await request.json().catch(() => ({})) as PublicChatRequestBody;
    const message = readTrimmed(body.message).slice(0, MAX_MESSAGE_LENGTH);
    const requestedSessionId = sanitizeSessionId(body.sessionId);
    const sessionId = requestedSessionId || createId('public-session');
    const requestId = readTrimmed(body.requestId) || createId('public-request');
    const history = sanitizeHistory(body.history);
    const images = extractPublicChatImages(body);
    const documents = extractDealDocuments(body);

    if (!message && images.length === 0 && documents.length === 0) {
      return jsonResponse({
        error: 'Message is required.',
        deploymentMarker: DEPLOYMENT_MARKER,
        rateLimitRemaining: rateLimit.remaining,
        rateLimitResetAt: rateLimit.resetAt,
      }, 400);
    }

    console.log('[IVXPublicChat] Incoming public chat request:', {
      clientId,
      sessionId,
      requestId,
      messagePreview: message.slice(0, 120),
      historyCount: history.length,
      imageCount: images.length,
      documentCount: documents.length,
      deploymentMarker: DEPLOYMENT_MARKER,
    });

    // Fire-and-forget persistence — never block the chat response on Supabase.
    // When Supabase is unreachable, persistence falls back to JSON or skips
    // silently, but the user always gets their answer without waiting.
    const userPersistencePromise = persistPublicTurn({
      sessionId,
      clientId,
      role: 'user',
      content:
        message ||
        (images.length > 0 ? `[image attachment x${images.length}]` : '') ||
        (documents.length > 0 ? `[deal document x${documents.length}]` : ''),
      source: 'user',
      model: null,
    }).catch(() => 'none' as const);

    // ─── Pre-Execution Feasibility Gate (Stage 0) ───────────────────────────
    // Runs BEFORE the AI model, deployment brain, or any tool execution. Public
    // chat has no owner session, so ownerSessionPresent is always false here —
    // the gate will block any prompt that requires owner-only capabilities.
    // skipLiveProbes: true — public chat does not need live credential probes
    // (GitHub/Render/Supabase) which add latency and can hang when services are down.
    try {
      const gate = await checkPreExecutionGate(request, {
        prompt: message,
        ownerSessionPresent: false,
        entryPoint: 'public-chat',
        skipLiveProbes: true,
      });
      if (gate.blocked && gate.result.state === 'BLOCKED') {
        // A policy block is a completed chat turn, not a transport failure. Returning
        // 409 here made clients discard the truth-first blocker as a failed request,
        // which looked like a disappearing chat response. Preserve every gate field in
        // the visible answer while returning the normal public-chat success shape.
        const answer = formatPublicChatGateBlock(gate.result);
        const assistantPersistence = await persistPublicTurn({
          sessionId,
          clientId,
          role: 'assistant',
          content: answer,
          source: 'system',
          model: 'ivx-pre-execution-gate',
        }).catch(() => 'none' as const);
        const userPersistence = await userPersistencePromise;
        return jsonResponse({
          ok: true,
          requestId,
          sessionId,
          answer,
          model: 'ivx-pre-execution-gate',
          source: 'fallback' as PublicChatSource,
          deploymentMarker: DEPLOYMENT_MARKER,
          commit: LIVE_COMMIT_SHA,
          commitShort: LIVE_COMMIT_SHORT,
          rateLimitRemaining: rateLimit.remaining,
          rateLimitResetAt: rateLimit.resetAt,
          timestamp: nowIso(),
          endpoint: null,
          persistence: assistantPersistence !== 'none' ? assistantPersistence : userPersistence,
          block17Marker: BLOCK17_MARKER,
          gate: {
            state: gate.result.state,
            taskId: gate.result.taskId,
            blockerCode: gate.result.blockerCode,
            failedCapability: gate.result.failedCapability,
            requiredVariable: gate.result.requiredVariable,
            runtimeSource: gate.result.runtimeSource,
            httpStatus: gate.result.httpStatus,
            repeatedBlocker: gate.result.repeatedBlocker,
            marker: gate.result.marker,
          },
        });
      }
    } catch (gateError) {
      console.log('[IVXPublicChat] Pre-execution gate error (non-blocking):', gateError instanceof Error ? gateError.message : 'unknown');
    }

    // ── Deployment Command Routing ──────────────────────────────────────────
    // Route /deploy-* and /qa-* commands through the deployment brain BEFORE
    // calling the AI model. This gives the chat room real deployment executor
    // capabilities: GitHub status, Render deploys, Supabase audits, commit
    // matching, QA smoke tests, and production evidence — all with live results.
    if (message && isDeploymentCommand(message)) {
      const brainResult = await routeDeploymentCommand(message);
      if (brainResult) {
        console.log('[IVXPublicChat] Deployment command routed:', {
          command: message.split(/\s+/)[0],
          sessionId,
          requestId,
          marker: BLOCK17_MARKER,
        });

        await persistPublicTurn({
          sessionId,
          clientId,
          role: 'assistant',
          content: brainResult,
          source: 'deployment-brain',
          model: 'ivx-deployment-brain',
        }).catch(() => undefined);
        const userPersistence = await userPersistencePromise;

        return jsonResponse({
          ok: true,
          requestId,
          sessionId,
          answer: brainResult,
          model: 'ivx-deployment-brain',
          source: 'deployment-brain' as PublicChatSource,
          deploymentMarker: DEPLOYMENT_MARKER,
          commit: LIVE_COMMIT_SHA,
          commitShort: LIVE_COMMIT_SHORT,
          rateLimitRemaining: rateLimit.remaining,
          rateLimitResetAt: rateLimit.resetAt,
          timestamp: nowIso(),
          endpoint: null,
          persistence: userPersistence,
          block17Marker: BLOCK17_MARKER,
        });
      }
    }

    const result = await generatePublicChatAnswer({
      message,
      history,
      sessionId,
      images,
      documents,
      rawAttachments: body,
    });

    // Fire-and-forget assistant persistence too — never block the response.
    const assistantPersistencePromise = persistPublicTurn({
      sessionId,
      clientId,
      role: 'assistant',
      content: result.answer,
      source: result.source,
      model: result.model,
    }).catch(() => 'none' as const);
    const userPersistence = await Promise.race([
      userPersistencePromise,
      Promise.resolve('none' as const),
    ]);
    const persistence = userPersistence;

    const payload: PublicChatSuccessResponse = {
      ok: true,
      requestId,
      sessionId,
      answer: result.answer,
      model: result.model,
      source: result.source,
      deploymentMarker: DEPLOYMENT_MARKER,
      commit: LIVE_COMMIT_SHA,
      commitShort: LIVE_COMMIT_SHORT,
      rateLimitRemaining: rateLimit.remaining,
      rateLimitResetAt: rateLimit.resetAt,
      timestamp: nowIso(),
      endpoint: result.endpoint,
      persistence,
    };

    console.log('[IVXPublicChat] Response generated:', {
      requestId,
      sessionId,
      model: payload.model,
      source: payload.source,
      endpoint: payload.endpoint,
      answerLength: payload.answer.length,
      deploymentMarker: DEPLOYMENT_MARKER,
    });

    return jsonResponse({ ...payload, block17Marker: BLOCK17_MARKER });
  } catch (error) {
    return jsonResponse({
      error: sanitizeErrorMessage(error, 'Unable to process public chat request.'),
      deploymentMarker: DEPLOYMENT_MARKER,
      rateLimitRemaining: rateLimit.remaining,
      rateLimitResetAt: rateLimit.resetAt,
    }, 500);
  }
}

/**
 * GET /api/public/chat/history?sessionId=...&limit=...
 * Returns the persisted message history for a given public chat session.
 */
export async function handlePublicChatHistoryGet(request: Request): Promise<Response> {
  const clientId = resolveClientIdentifier(request);
  const url = new URL(request.url);
  const sessionId = sanitizeSessionId(url.searchParams.get('sessionId'));
  const limit = parseLimit(url.searchParams.get('limit'), DEFAULT_SESSION_HISTORY_LIMIT, MAX_SESSION_HISTORY_LIMIT);

  if (!sessionId) {
    return jsonResponse({
      ok: false,
      error: 'sessionId is required.',
      block17Marker: BLOCK17_MARKER,
    }, 400);
  }

  const store = getPublicChatSupabaseStore();
  if (store.isConfigured()) {
    try {
      const messages = (await store.listMessages({ sessionId, clientId, limit })).map(toPublicSupabaseMessage);
      return jsonResponse({
        ok: true,
        sessionId,
        messageCount: messages.length,
        messages,
        persistence: 'supabase',
        deploymentMarker: DEPLOYMENT_MARKER,
        block17Marker: BLOCK17_MARKER,
        timestamp: nowIso(),
      });
    } catch (error) {
      console.log('[IVXPublicChat] Supabase history read skipped:', {
        sessionId,
        error: sanitizeErrorMessage(error, 'unknown'),
        marker: BLOCK17_MARKER,
      });
    }
  }

  if (!publicChatHistoryStorage) {
    return jsonResponse({
      ok: false,
      error: 'Chat history storage is not initialized.',
      block17Marker: BLOCK17_MARKER,
    }, 503);
  }

  const roomId = sessionRoomId(sessionId);
  const ownerCheckMessages = publicChatHistoryStorage.listMessages(roomId, MAX_SESSION_HISTORY_LIMIT);
  const sessionBelongsToClient = ownerCheckMessages.length === 0 || ownerCheckMessages.some((message) => message.username === clientId);

  if (!sessionBelongsToClient) {
    return jsonResponse({
      ok: false,
      error: 'Chat history session was not found for this client.',
      deploymentMarker: DEPLOYMENT_MARKER,
      block17Marker: BLOCK17_MARKER,
      timestamp: nowIso(),
    }, 404);
  }

  const messages = ownerCheckMessages.slice(-limit).map(toPublicSessionMessage);

  return jsonResponse({
    ok: true,
    sessionId,
    messageCount: messages.length,
    messages,
    persistence: 'json',
    deploymentMarker: DEPLOYMENT_MARKER,
    block17Marker: BLOCK17_MARKER,
    timestamp: nowIso(),
  });
}

/**
 * GET /api/public/chat/sessions?limit=...
 * Returns the recent public chat sessions associated with the requesting client
 * (matched by the same IP-derived clientId that handlePublicChatPost uses).
 */
export async function handlePublicChatSessionsGet(request: Request): Promise<Response> {
  const clientId = resolveClientIdentifier(request);
  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get('limit'), 20, MAX_SESSIONS_PER_CLIENT);

  const store = getPublicChatSupabaseStore();
  if (store.isConfigured()) {
    try {
      const sessions = await store.listSessions({ clientId, limit });
      return jsonResponse({
        ok: true,
        sessionCount: sessions.length,
        sessions,
        persistence: 'supabase',
        deploymentMarker: DEPLOYMENT_MARKER,
        block17Marker: BLOCK17_MARKER,
        timestamp: nowIso(),
      });
    } catch (error) {
      console.log('[IVXPublicChat] Supabase session list skipped:', {
        error: sanitizeErrorMessage(error, 'unknown'),
        marker: BLOCK17_MARKER,
      });
    }
  }

  if (!publicChatHistoryStorage) {
    return jsonResponse({
      ok: false,
      error: 'Chat history storage is not initialized.',
      block17Marker: BLOCK17_MARKER,
    }, 503);
  }

  const rooms = publicChatHistoryStorage.listRoomsWithPrefix(PUBLIC_CHAT_SESSION_ROOM_PREFIX, MAX_SESSIONS_PER_CLIENT * 4);
  const sessions = rooms
    .filter((room) => room.usernames.includes(clientId))
    .slice(0, limit)
    .map((room) => ({
      sessionId: room.roomId.slice(PUBLIC_CHAT_SESSION_ROOM_PREFIX.length),
      messageCount: room.messageCount,
      lastUpdatedAt: room.lastUpdatedAt,
      lastMessagePreview: room.lastMessagePreview,
      lastSource: null,
      lastModel: null,
    }));

  return jsonResponse({
    ok: true,
    sessionCount: sessions.length,
    sessions,
    persistence: 'json',
    deploymentMarker: DEPLOYMENT_MARKER,
    block17Marker: BLOCK17_MARKER,
    timestamp: nowIso(),
  });
}
