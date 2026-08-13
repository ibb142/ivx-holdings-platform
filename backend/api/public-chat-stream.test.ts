/**
 * Tests for IVX Public Chat SSE streaming endpoint.
 *
 * Exercises the production Request -> Response contract exposed by
 * handlePublicChatStreamPost and parses the current data-only SSE envelope.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

async function* defaultStreamGen(): AsyncGenerator<{
  type: 'delta' | 'done' | 'error';
  delta?: string;
  text?: string;
  error?: string;
  usage?: unknown;
  providerMetadata?: { model: string; endpoint: string };
}> {
  yield { type: 'delta', delta: 'Hello' };
  yield { type: 'delta', delta: ' world' };
  yield {
    type: 'done',
    text: 'Hello world',
    providerMetadata: { model: 'gpt-4o', endpoint: 'https://ai-gateway.vercel.sh/v1' },
  };
}

const mockStreamIVXAIText = mock(defaultStreamGen);
const mockResolveIVXIdentityAnswer = mock((_msg: string): string | null => null);
const mockResolveIVXConversationAnswer = mock((_msg: string): string | null => null);
const mockClassifyIntent = mock(() => ({
  selectedRoute: 'PUBLIC_LLM_RESPONSE',
  safetyStage: { publicBoundary: 'public_safe' },
  intent: 'general_ai',
  confidence: 0.95,
  traceId: 'test-trace',
  reason: 'safe question',
}));
const mockRouteIVXChatIntent = mock(() => ({
  branch: 'general_ai',
  intent: 'general_ai',
  requiresOwnerSession: false,
}));
const mockIsDeploymentCommand = mock(() => false);
const mockRouteDeploymentCommand = mock(async () => null);
const mockCheckPreExecutionGate = mock(async () => ({
  blocked: false,
  result: { state: 'ALLOWED' },
}));

mock.module('../ivx-ai-runtime', () => ({
  getIVXAIEndpoint: () => 'https://ai-gateway.vercel.sh/v1',
  resolveIVXAIModel: (m: string) => m || 'gpt-4o',
  streamIVXAIText: mockStreamIVXAIText,
  requestIVXAIText: async () => ({
    text: 'mock response',
    providerMetadata: { model: 'gpt-4o', endpoint: 'https://ai-gateway.vercel.sh/v1' },
  }),
  isIVXAIConfigured: () => true,
}));

mock.module('../public-chat-ai', () => ({
  buildFallbackAnswer: (msg: string) => `Fallback: ${msg}`,
  buildSystemPrompt: () => 'System prompt',
  buildTranscript: () => 'No previous messages.',
  isPublicChatAIConfigured: () => true,
  sanitizePublicChatHistory: (h: any[]) => h,
  isVagueExecutionRequest: () => false,
}));

mock.module('../services/ivx-ia-identity-brain', () => ({
  resolveIVXIdentityAnswer: mockResolveIVXIdentityAnswer,
  IVX_IA_IDENTITY_MARKER: 'ivx-ia-identity-brain',
}));
mock.module('../services/ivx-ia-conversation-brain', () => ({
  resolveIVXConversationAnswer: mockResolveIVXConversationAnswer,
}));
mock.module('../services/ivx-authoritative-intent-router', () => ({
  classifyIntent: mockClassifyIntent,
}));
mock.module('../services/ivx-chat-intent-router', () => ({
  routeIVXChatIntent: mockRouteIVXChatIntent,
  branchLabel: () => 'General AI',
}));
mock.module('../services/ivx-deployment-chat-brain', () => ({
  isDeploymentCommand: mockIsDeploymentCommand,
  routeDeploymentCommand: mockRouteDeploymentCommand,
}));
mock.module('../services/ivx-pre-execution-gate-middleware', () => ({
  checkPreExecutionGate: mockCheckPreExecutionGate,
}));

const { handlePublicChatStreamPost } = await import('./public-chat-stream');

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://ivx.test/api/public-chat/stream', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ivx-client-id': 'qa-client' },
    body: JSON.stringify(body),
  });
}

async function readSSE(response: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await response.text();
  return text.split('\n\n').filter(Boolean).map((chunk) => {
    const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'))?.slice(5).trim() ?? '{}';
    const data = JSON.parse(dataLine);
    return { event: typeof data.type === 'string' ? data.type : '', data };
  });
}

beforeEach(() => {
  mockStreamIVXAIText.mockImplementation(defaultStreamGen);
  mockResolveIVXIdentityAnswer.mockImplementation(() => null);
  mockResolveIVXConversationAnswer.mockImplementation(() => null);
  mockClassifyIntent.mockImplementation(() => ({
    selectedRoute: 'PUBLIC_LLM_RESPONSE',
    safetyStage: { publicBoundary: 'public_safe' },
    intent: 'general_ai',
    confidence: 0.95,
    traceId: 'test-trace',
    reason: 'safe question',
  }));
  mockRouteIVXChatIntent.mockImplementation(() => ({
    branch: 'general_ai',
    intent: 'general_ai',
    requiresOwnerSession: false,
  }));
  mockIsDeploymentCommand.mockImplementation(() => false);
  mockRouteDeploymentCommand.mockImplementation(async () => null);
  mockCheckPreExecutionGate.mockImplementation(async () => ({
    blocked: false,
    result: { state: 'ALLOWED' },
  }));
});

describe('public chat SSE streaming', () => {
  test('emits started, deltas, and completed in order', async () => {
    const response = await handlePublicChatStreamPost(makeRequest({
      message: 'Hello',
      sessionId: 'test-session',
      requestId: 'test-request',
      history: [],
    }));
    expect(response.status).toBe(200);
    const events = await readSSE(response);
    expect(events.map((e) => e.event)).toEqual([
      'response.started',
      'response.delta',
      'response.delta',
      'response.completed',
    ]);
    expect(events[1]?.data.delta).toBe('Hello');
    expect(events[2]?.data.delta).toBe(' world');
    expect(events[3]?.data.text).toBe('Hello world');
  });

  test('falls back and completes when a non-auth AI stream fails', async () => {
    mockStreamIVXAIText.mockImplementation(async function* () {
      yield { type: 'error', error: 'provider unavailable' };
    });
    const response = await handlePublicChatStreamPost(makeRequest({
      message: 'Hello',
      sessionId: 'test-session',
      requestId: 'test-fallback',
      history: [],
    }));
    const events = await readSSE(response);
    expect(events.map((e) => e.event)).toEqual([
      'response.started',
      'response.delta',
      'response.completed',
    ]);
    expect(events[1]?.data.delta).toBe('Fallback: Hello');
    expect(events[2]?.data.source).toBe('fallback');
  });

  test('emits response.error for an AI provider authentication failure', async () => {
    mockStreamIVXAIText.mockImplementation(async function* () {
      yield { type: 'error', error: 'status=401 unauthorized' };
    });
    const response = await handlePublicChatStreamPost(makeRequest({
      message: 'Hello',
      sessionId: 'test-session',
      requestId: 'test-auth-error',
      history: [],
    }));
    const events = await readSSE(response);
    expect(events[0]?.event).toBe('response.started');
    expect(events.some((event) => event.event === 'response.error')).toBe(true);
    expect(events.find((event) => event.event === 'response.error')?.data.errorType).toBe('auth_expired');
    expect(events.at(-1)?.event).toBe('response.completed');
    expect(events.at(-1)?.data.source).toBe('error');
  });

  test('deterministic identity answer emits one delta and completed', async () => {
    mockResolveIVXIdentityAnswer.mockImplementation(() => 'IVX identity answer');
    const response = await handlePublicChatStreamPost(makeRequest({
      message: 'Who is IVX?',
      sessionId: 'test-session',
      requestId: 'test-identity',
      history: [],
    }));
    const events = await readSSE(response);
    expect(events.map((e) => e.event)).toEqual([
      'response.started',
      'response.delta',
      'response.completed',
    ]);
    expect(events[1]?.data.delta).toBe('IVX identity answer');
  });
});
