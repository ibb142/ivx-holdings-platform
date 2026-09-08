import { getDirectApiBaseUrl } from '@/lib/api-base';
import { getIVXAccessToken } from '@/lib/ivx-supabase-client';

export type PublicChatRole = 'user' | 'assistant';

export type PublicChatHistoryItem = {
  role: PublicChatRole;
  content: string;
};

export type PublicChatApiSource = 'chatgpt' | 'fallback' | 'autonomous' | 'deployment-brain';

export type PublicChatApiResponse = {
  ok: true;
  requestId: string;
  sessionId: string;
  answer: string;
  model: string;
  source: PublicChatApiSource;
  deploymentMarker: string;
  commit?: string;
  commitShort?: string;
  block17Marker?: string;
  rateLimitRemaining: number;
  rateLimitResetAt: string;
  timestamp: string;
  endpoint: string | null;
  persistence?: 'supabase' | 'json' | 'none';
  jobId?: string | null;
  jobStatus?: string | null;
  jobStage?: string | null;
};

export type PublicChatSessionMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  content?: string;
  source?: string;
  model?: string | null;
  sessionId?: string;
  createdAt: string;
};

export type PublicChatHistoryResponse = {
  ok: true;
  sessionId: string;
  messageCount: number;
  messages: PublicChatSessionMessage[];
  persistence?: 'supabase' | 'json';
  deploymentMarker: string;
  block17Marker?: string;
  timestamp: string;
};

export type PublicChatSessionSummary = {
  sessionId: string;
  messageCount: number;
  lastUpdatedAt: string;
  lastMessagePreview: string;
  lastSource?: string | null;
  lastModel?: string | null;
};

export type PublicChatSessionsResponse = {
  ok: true;
  sessionCount: number;
  sessions: PublicChatSessionSummary[];
  persistence?: 'supabase' | 'json';
  deploymentMarker: string;
  block17Marker?: string;
  timestamp: string;
};

export type PublicHealthResponse = {
  ok: boolean;
  status: string;
  service: string;
  deploymentMarker: string;
  routes: string[];
  aiEnabled?: boolean;
  openAIModel?: string;
  aiProvider?: 'chatgpt' | 'fallback';
  aiEndpoint?: string | null;
};

/** Image attachment forwarded to the BLOCK 3 visual-intelligence layer. */
export type PublicChatImageInput = {
  url: string;
  type?: string;
};

/** Deal-room document forwarded to the BLOCK 4/5 OCR + analyst layer. */
export type PublicChatDocumentInput = {
  url: string;
  name?: string;
  type?: string;
};

export type SendPublicChatInput = {
  message: string;
  history: PublicChatHistoryItem[];
  sessionId: string;
  requestId: string;
  clientId?: string;
  images?: PublicChatImageInput[];
  documents?: PublicChatDocumentInput[];
};

/**
 * Build request headers, attaching the stable per-device client id and, when
 * available, the logged-in owner bearer. The streaming backend validates the
 * bearer before routing execution commands to the real Senior Developer Worker.
 */
async function buildPublicChatHeaders(clientId?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream, application/json',
  };
  const trimmed = readTrimmed(clientId);
  if (trimmed) {
    headers['x-ivx-client-id'] = trimmed;
  }
  try {
    const token = await getIVXAccessToken();
    if (token && token.split('.').length === 3) {
      headers.Authorization = `Bearer ${token}`;
    }
  } catch {
    // Public/member chat remains available without an owner bearer.
  }
  return headers;
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function getPublicChatBaseUrl(): string {
  return getDirectApiBaseUrl();
}

async function parseErrorResponse(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  if (!text) {
    return `Request failed with HTTP ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: string };
    return readTrimmed(parsed.error) || `Request failed with HTTP ${response.status}.`;
  } catch {
    return text.slice(0, 240);
  }
}

type StreamEvent = Record<string, unknown> & {
  type?: string;
  text?: string;
  error?: string;
  requestId?: string;
  sessionId?: string;
  model?: string;
  source?: string;
  jobId?: string | null;
  jobStatus?: string | null;
  jobStage?: string | null;
  timestamp?: string;
  deploymentMarker?: string;
  commit?: string;
  commitShort?: string;
};

function normalizeStreamSource(value: unknown): PublicChatApiSource {
  const source = readTrimmed(value).toLowerCase();
  if (source === 'autonomous') return 'autonomous';
  if (source === 'deployment-brain') return 'deployment-brain';
  if (source === 'chatgpt') return 'chatgpt';
  return 'fallback';
}

function parseStreamResponse(text: string, input: SendPublicChatInput): PublicChatApiResponse {
  let completed: StreamEvent | null = null;
  let lastError = '';

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) continue;
    const json = line.slice(5).trim();
    if (!json) continue;
    try {
      const event = JSON.parse(json) as StreamEvent;
      if (event.type === 'response.error') {
        lastError = readTrimmed(event.error);
      }
      if (event.type === 'response.completed') {
        completed = event;
      }
    } catch {
      // Ignore malformed/partial SSE rows and continue to the terminal event.
    }
  }

  if (!completed) {
    throw new Error(lastError || 'IVX chat stream ended without a completed response.');
  }

  const answer = readTrimmed(completed.text);
  if (!answer) {
    throw new Error(lastError || 'IVX chat stream returned an empty answer.');
  }

  const now = new Date().toISOString();
  return {
    ok: true,
    requestId: readTrimmed(completed.requestId) || input.requestId,
    sessionId: readTrimmed(completed.sessionId) || input.sessionId,
    answer,
    model: readTrimmed(completed.model) || 'ivx-public-chat-stream',
    source: normalizeStreamSource(completed.source),
    deploymentMarker: readTrimmed(completed.deploymentMarker) || 'ivx-owner-aware-public-chat-stream-v1',
    commit: readTrimmed(completed.commit) || undefined,
    commitShort: readTrimmed(completed.commitShort) || undefined,
    rateLimitRemaining: -1,
    rateLimitResetAt: now,
    timestamp: readTrimmed(completed.timestamp) || now,
    endpoint: '/public/chat/stream',
    persistence: undefined,
    jobId: readTrimmed(completed.jobId) || null,
    jobStatus: readTrimmed(completed.jobStatus) || null,
    jobStage: readTrimmed(completed.jobStage) || null,
  };
}

export async function fetchPublicChatHealth(): Promise<PublicHealthResponse> {
  const baseUrl = getPublicChatBaseUrl();
  const url = `${baseUrl}/health`;
  console.log('[PublicChat] Fetching health from:', url);

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const payload = await response.json() as PublicHealthResponse;
  console.log('[PublicChat] Health response:', {
    ok: payload.ok,
    aiProvider: payload.aiProvider,
    openAIModel: payload.openAIModel,
    deploymentMarker: payload.deploymentMarker,
  });
  return payload;
}

/**
 * Owner-aware canonical Chat transport.
 *
 * All chat turns use the streaming endpoint. Public/member users receive the
 * same conversational AI behavior; a valid owner bearer activates the existing
 * Chat -> Autonomous handoff for explicit build/fix/deploy commands. We collect
 * the terminal SSE event into the legacy response shape so the current UI does
 * not need a parallel message pipeline.
 */
export async function sendPublicChatMessage(input: SendPublicChatInput): Promise<PublicChatApiResponse> {
  const baseUrl = getPublicChatBaseUrl();
  const url = `${baseUrl}/public/chat/stream`;
  const images = input.images ?? [];
  const documents = input.documents ?? [];
  console.log('[PublicChat] Sending owner-aware message to:', url, {
    requestId: input.requestId,
    sessionId: input.sessionId,
    historyCount: input.history.length,
    imageCount: images.length,
    documentCount: documents.length,
    preview: input.message.slice(0, 120),
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: await buildPublicChatHeaders(input.clientId),
    body: JSON.stringify({
      requestId: input.requestId,
      sessionId: input.sessionId,
      message: input.message,
      history: input.history,
      ...(images.length > 0 ? { images } : {}),
      ...(documents.length > 0 ? { documents } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const text = await response.text();
  const payload = parseStreamResponse(text, input);
  console.log('[PublicChat] Stream response:', {
    requestId: payload.requestId,
    source: payload.source,
    model: payload.model,
    jobId: payload.jobId,
    jobStatus: payload.jobStatus,
    endpoint: payload.endpoint,
  });
  return payload;
}

export async function fetchPublicChatHistory(sessionId: string, limit: number = 80, clientId?: string): Promise<PublicChatHistoryResponse> {
  const baseUrl = getPublicChatBaseUrl();
  const url = `${baseUrl}/public/chat/history?sessionId=${encodeURIComponent(sessionId)}&limit=${encodeURIComponent(String(limit))}`;
  console.log('[PublicChat] Fetching history:', { sessionId, limit });

  const response = await fetch(url, {
    method: 'GET',
    headers: await buildPublicChatHeaders(clientId),
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const payload = await response.json() as PublicChatHistoryResponse;
  console.log('[PublicChat] History response:', {
    sessionId: payload.sessionId,
    messageCount: payload.messageCount,
    persistence: payload.persistence,
    block17Marker: payload.block17Marker,
  });
  return payload;
}

export async function fetchPublicChatSessions(limit: number = 20, clientId?: string): Promise<PublicChatSessionsResponse> {
  const baseUrl = getPublicChatBaseUrl();
  const url = `${baseUrl}/public/chat/sessions?limit=${encodeURIComponent(String(limit))}`;
  console.log('[PublicChat] Fetching sessions:', { limit });

  const response = await fetch(url, {
    method: 'GET',
    headers: await buildPublicChatHeaders(clientId),
  });

  if (!response.ok) {
    throw new Error(await parseErrorResponse(response));
  }

  const payload = await response.json() as PublicChatSessionsResponse;
  console.log('[PublicChat] Sessions response:', {
    sessionCount: payload.sessionCount,
    persistence: payload.persistence,
    block17Marker: payload.block17Marker,
  });
  return payload;
}
