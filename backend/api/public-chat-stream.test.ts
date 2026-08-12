/**
 * Tests for IVX Public Chat SSE streaming endpoint.
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
  yield { type: 'done', text: 'Hello world', providerMetadata: { model: 'gpt-4o', endpoint: 'https://ai-gateway.vercel.sh/v1' } };
}

const mockStreamIVXAIText = mock(defaultStreamGen);
const mockResolveIVXIdentityAnswer = mock((_msg: string): string | null => null);
const mockResolveIVXConversationAnswer = mock((_msg: string): string | null => null);
const mockClassifyIntent = mock(() => ({ selectedRoute: 'PUBLIC_LLM_RESPONSE', safetyStage: { publicBoundary: 'public_safe' }, intent: 'general_ai', confidence: 0.95, traceId: 'test-trace', reason: 'safe question' }));
const mockRouteIVXChatIntent = mock(() => ({ branch: 'general_ai', intent: 'general_ai', requiresOwnerSession: false }));
const mockIsDeploymentCommand = mock(() => false);
const mockCheckPreExecutionGate = mock(async () => ({ blocked: false, result: { state: 'ALLOWED' } }));

mock.module('../ivx-ai-runtime', () => ({
  getIVXAIEndpoint: () => 'https://ai-gateway.vercel.sh/v1',
  resolveIVXAIModel: (m: string) => m || 'gpt-4o',
  streamIVXAIText: mockStreamIVXAIText,
  requestIVXAIText: async () => ({ text: 'mock response', providerMetadata: { model: 'gpt-4o', endpoint: 'https://ai-gateway.vercel.sh/v1' } }),
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
mock.module('../services/ivx-ia-identity-brain', () => ({ resolveIVXIdentityAnswer: mockResolveIVXIdentityAnswer, IVX_IA_IDENTITY_MARKER: 'ivx-ia-identity-brain' }));
mock.module('../services/ivx-conversation-brain', () => ({ resolveIVXConversationAnswer: mockResolveIVXConversationAnswer }));
mock.module('../services/ivx-request-classification-engine', () => ({ classifyIVXRequest: mockClassifyIntent }));
mock.module('../services/ivx-intent-router', () => ({ routeIVXChatIntent: mockRouteIVXChatIntent }));
mock.module('../services/ivx-deployment-command', () => ({ isDeploymentCommand: mockIsDeploymentCommand }));
mock.module('../services/ivx-pre-execution-gate', () => ({ checkPreExecutionGate: mockCheckPreExecutionGate }));

const { handlePublicChatStream } = await import('./public-chat-stream');

async function readSSE(response: Response): Promise<Array<{ event: string; data: any }>> {
  const text = await response.text();
  return text.split('\n\n').filter(Boolean).map((chunk) => {
    const lines = chunk.split('\n');
    const event = lines.find((line) => line.startsWith('event:'))?.slice(6).trim() ?? '';
    const dataLine = lines.find((line) => line.startsWith('data:'))?.slice(5).trim() ?? '{}';
    return { event, data: JSON.parse(dataLine) };
  });
}

beforeEach(() => {
  mockStreamIVXAIText.mockImplementation(defaultStreamGen);
  mockResolveIVXIdentityAnswer.mockImplementation(() => null);
  mockResolveIVXConversationAnswer.mockImplementation(() => null);
  mockClassifyIntent.mockImplementation(() => ({ selectedRoute: 'PUBLIC_LLM_RESPONSE', safetyStage: { publicBoundary: 'public_safe' }, intent: 'general_ai', confidence: 0.95, traceId: 'test-trace', reason: 'safe question' }));
  mockRouteIVXChatIntent.mockImplementation(() => ({ branch: 'general_ai', intent: 'general_ai', requiresOwnerSession: false }));
  mockIsDeploymentCommand.mockImplementation(() => false);
  mockCheckPreExecutionGate.mockImplementation(async () => ({ blocked: false, result: { state: 'ALLOWED' } }));
});

describe('public chat SSE streaming', () => {
  test('emits started, deltas, and completed in order', async () => {
    const response = await handlePublicChatStream({ message: 'Hello', sessionId: 'test-session', requestId: 'test-request', history: [] });
    expect(response.status).toBe(200);
    const events = await readSSE(response);
    expect(events.map((e) => e.event)).toEqual(['response.started', 'response.delta', 'response.delta', 'response.completed']);
    expect(events[1]?.data.delta).toBe('Hello');
    expect(events[2]?.data.delta).toBe(' world');
    expect(events[3]?.data.text).toBe('Hello world');
  });

  test('emits response.error when AI stream fails', async () => {
    mockStreamIVXAIText.mockImplementation(async function* () { yield { type: 'error', error: 'provider unavailable' }; });
    const response = await handlePublicChatStream({ message: 'Hello', sessionId: 'test-session', requestId: 'test-error', history: [] });
    const events = await readSSE(response);
    expect(events[0]?.event).toBe('response.started');
    expect(events.at(-1)?.event).toBe('response.error');
  });

  test('deterministic identity answer emits one delta and completed', async () => {
    mockResolveIVXIdentityAnswer.mockImplementation(() => 'IVX identity answer');
    const response = await handlePublicChatStream({ message: 'Who is IVX?', sessionId: 'test-session', requestId: 'test-identity', history: [] });
    const events = await readSSE(response);
    expect(events.map((e) => e.event)).toEqual(['response.started', 'response.delta', 'response.completed']);
    expect(events[1]?.data.delta).toBe('IVX identity answer');
  });
});
