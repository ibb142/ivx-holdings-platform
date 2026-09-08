import { getDirectApiBaseUrl } from '@/lib/api-base';

export type PublicChatRole = 'user' | 'assistant';

export type PublicChatHistoryItem = {
  role: PublicChatRole;
  content: string;
};

export type PublicChatApiResponse = {
  ok: true;
  requestId: string;
  sessionId: string;
  answer: string;
  model: string;
  source: 'chatgpt' | 'fallback' | 'autonomous' | 'deployment-brain';
  deploymentMarker: string;
  commit?: string;
  commitShort?: string;
  block17Marker?: string;
  rateLimitRemaining: number;
  rateLimitResetAt: string;
  timestamp: string;
  endpoint: string | null;
  persistence?: 'supabase' | 'json' | 'none';
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
 * Build request headers, attaching the stable per-device client id so the
 * backend authorizes chat history by device instead of the volatile request IP.
 */
function buildPublicChatHeaders(clientId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const trimmed = readTrimmed(clientId);
  if (trimmed) {
    headers['x-ivx-client-id'] = trimmed;
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

export async function sendPublicChatMessage(input: SendPublicChatInput): Promise<PublicChatApiResponse> {
  const baseUrl = getPublicChatBaseUrl();
  const url = `${baseUrl}/public/chat`;
  const images = input.images ?? [];
  const documents = input.documents ?? [];
  console.log('[PublicChat] Sending message to:', url, {
    requestId: input.requestId,
    sessionId: input.sessionId,
    historyCount: input.history.length,
    imageCount: images.length,
    documentCount: documents.length,
    preview: input.message.slice(0, 120),
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: buildPublicChatHeaders(input.clientId),
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

  const payload = await response.json() as PublicChatApiResponse;
  console.log('[PublicChat] Message response:', {
    requestId: payload.requestId,
    source: payload.source,
    model: payload.model,
    persistence: payload.persistence,
    deploymentMarker: payload.deploymentMarker,
    block17Marker: payload.block17Marker,
  });
  return payload;
}

export async function fetchPublicChatHistory(sessionId: string, limit: number = 80, clientId?: string): Promise<PublicChatHistoryResponse> {
  const baseUrl = getPublicChatBaseUrl();
  const url = `${baseUrl}/public/chat/history?sessionId=${encodeURIComponent(sessionId)}&limit=${encodeURIComponent(String(limit))}`;
  console.log('[PublicChat] Fetching history:', { sessionId, limit });

  const response = await fetch(url, {
    method: 'GET',
    headers: buildPublicChatHeaders(clientId),
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
    headers: buildPublicChatHeaders(clientId),
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
