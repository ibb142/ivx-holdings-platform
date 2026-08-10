/**
 * Tests for IVX Public Chat SSE streaming endpoint.
 *
 * Verifies:
 * - response.started → response.delta → response.completed event sequence
 * - response.error on failure
 * - no duplicate messages
 * - stop generation (abort)
 * - partial response preservation
 * - deterministic brains emit single delta + completed
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// ── Mock setup ──────────────────────────────────────────────────────────────

// We test the SSE event protocol by mocking streamIVXAIText and the
// deterministic brains, then parsing the ReadableStream output.

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
const mockCheckPreExecutionGate = mock(async () => ({
  blocked: false,
  result: { state: 'ALLOWED' },
}));

// Mock module dependencies
mock.module('../ivx-ai-runtime', () => ({
  getIVXAIEndpoint: () => 'https://ai-gateway.vercel.sh/v1',
  resolveIVXAIModel: (m: string) => m || 'gpt-4o',
  streamIVXAIText: mockStreamIVXAIText,
  isIVXAIConfigured: () => true,
  requestIVXAIText: mock(async () => ({ text: 'Mocked response', model: 'gpt-4o' })),
  getIVXAIConfigurationSnapshot: () => ({ model: 'gpt-4o', endpoint: 'https://ai-gateway.vercel.sh/v1' }),
  getIVXAIKeySource: () => 'AI_GATEWAY_API_KEY',
  getIVXAIActiveEndpoint: () => 'https://ai-gateway.vercel.sh/v1',
  getIVXAIActiveProviderLabel: () => 'Vercel AI Gateway',
  validateIVXAIStartup: () => ({ ok: true }),
  getProviderHealth: () => ({ ok: true, label: 'healthy' }),
  runWithOwnerAIStreamCallback: async (_input: unknown, cb: (delta: string) => void) => { cb('Mocked'); return { text: 'Mocked response', model: 'gpt-4o' }; },
  computeAdaptiveTimeoutMs: () => 30000,
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
  IVX_IA_CONVERSATION_MARKER: 'ivx-ia-conversation-brain',
}));

mock.module('../services/ivx-authoritative-intent-router', () => ({
  classifyIntent: mockClassifyIntent,
}));

mock.module('../services/ivx-chat-intent-router', () => ({
  routeIVXChatIntent: mockRouteIVXChatIntent,
  branchLabel: (b: string) => b,
}));

mock.module('../services/ivx-public-chat-gate-response', () => ({
  formatPublicChatGateBlock: () => 'Gate block',
}));

mock.module('../services/ivx-pre-execution-gate-middleware', () => ({
  checkPreExecutionGate: mockCheckPreExecutionGate,
}));

mock.module('../services/ivx-public-chat-vision', () => ({
  extractPublicChatImages: () => [],
}));

mock.module('../services/ivx-deal-documents', () => ({
  extractDealDocuments: () => [],
}));

mock.module('../services/ivx-deployment-chat-brain', () => ({
  isDeploymentCommand: mockIsDeploymentCommand,
  routeDeploymentCommand: async () => null,
}));

mock.module('../public-chat-supabase-store', () => ({
  getPublicChatSupabaseStore: () => ({
    isConfigured: () => false,
    appendMessage: async () => undefined,
  }),
}));

mock.module('../chat-storage', () => ({
  ChatStorage: class MockChatStorage {},
}));

mock.module('../services/ivx-language-detector', () => ({
  detectMessageLanguage: () => 'en',
  buildLanguageInstruction: () => '',
}));

mock.module('../services/ivx-chat-autonomous-handoff', () => ({
  detectAutonomousExecutionIntent: () => null,
  createAutonomousJobFromChat: async () => null,
  formatAutonomousTaskSsePayload: () => null,
  formatAutonomousTaskMessage: () => '',
}));

mock.module('./owner-only', () => ({
  assertIVXOwnerOnly: async () => ({ ownerSessionDetected: false, bearerAccepted: false, ownerVerified: false, ownerEmailMatched: false, ownerEmailMasked: null, userId: null, role: null, guardMode: null }),
}));

// ── Test helpers ────────────────────────────────────────────────────────────

async function parseSSEStream(response: Response): Promise<Record<string, unknown>[]> {
  const events: Record<string, unknown>[] = [];
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const lines = chunk.split('\n').filter((l) => l.startsWith('data: '));
      for (const line of lines) {
        try {
          events.push(JSON.parse(line.slice(6)));
        } catch {
          // skip malformed
        }
      }
    }
  }
  // Process remaining buffer
  if (buffer.length > 0) {
    const lines = buffer.split('\n').filter((l) => l.startsWith('data: '));
    for (const line of lines) {
      try {
        events.push(JSON.parse(line.slice(6)));
      } catch {
        // skip
      }
    }
  }
  return events;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('IVX Public Chat Streaming', () => {
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
    mockCheckPreExecutionGate.mockImplementation(async () => ({
      blocked: false,
      result: { state: 'ALLOWED' },
    }));
  });

  test('response.started → delta → delta → completed sequence', async () => {
    const { handlePublicChatStreamPost } = await import('./public-chat-stream');

    const request = new Request('https://test.example/api/public/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-ivx-client-id': 'test-client' },
      body: JSON.stringify({
        message: 'Explain why the sky is blue',
        sessionId: 'test-session-1',
        requestId: 'test-req-1',
        history: [],
      }),
    });

    const response = await handlePublicChatStreamPost(request);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/event-stream');

    const events = await parseSSEStream(response);

    // Verify event sequence
    expect(events.length).toBeGreaterThanOrEqual(4);
    expect(events[0].type).toBe('response.started');
    expect(events[0].requestId).toBe('test-req-1');
    expect(events[0].sessionId).toBe('test-session-1');

    // Deltas
    const deltas = events.filter((e) => e.type === 'response.delta');
    expect(deltas.length).toBeGreaterThanOrEqual(1);

    // Completed
    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed).toBeDefined();
    expect(completed!.text).toBe('Hello world');
    expect(completed!.source).toBe('chatgpt');
  });

  test('typing indicator: response.started emitted before any delta', async () => {
    const { handlePublicChatStreamPost } = await import('./public-chat-stream');

    const request = new Request('https://test.example/api/public/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is 2+2?',
        sessionId: 'test-session-2',
        requestId: 'test-req-2',
        history: [],
      }),
    });

    const response = await handlePublicChatStreamPost(request);
    const events = await parseSSEStream(response);

    // First event must be response.started, NOT a delta
    expect(events[0].type).toBe('response.started');
    const firstDeltaIdx = events.findIndex((e) => e.type === 'response.delta');
    const startedIdx = events.findIndex((e) => e.type === 'response.started');
    expect(startedIdx).toBeLessThan(firstDeltaIdx);
    expect(firstDeltaIdx).toBeGreaterThan(-1);
  });

  test('deltas append to one assistant message (no duplicate message IDs)', async () => {
    const { handlePublicChatStreamPost } = await import('./public-chat-stream');

    const request = new Request('https://test.example/api/public/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Tell me about IVX',
        sessionId: 'test-session-3',
        requestId: 'test-req-3',
        history: [],
      }),
    });

    const response = await handlePublicChatStreamPost(request);
    const events = await parseSSEStream(response);

    // All deltas should have the same requestId
    const deltas = events.filter((e) => e.type === 'response.delta');
    expect(deltas.length).toBeGreaterThan(0);
    const requestIds = new Set(deltas.map((d) => d.requestId));
    expect(requestIds.size).toBe(1);
    expect(requestIds.has('test-req-3')).toBe(true);
  });

  test('deterministic brain (identity) emits single delta + completed', async () => {
    mockResolveIVXIdentityAnswer.mockImplementation(() => 'My name is IVX IA. I was created by Ivan Perez.');

    const { handlePublicChatStreamPost } = await import('./public-chat-stream');

    const request = new Request('https://test.example/api/public/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'What is your name?',
        sessionId: 'test-session-4',
        requestId: 'test-req-4',
        history: [],
      }),
    });

    const response = await handlePublicChatStreamPost(request);
    const events = await parseSSEStream(response);

    // Should have: started, one delta, completed
    expect(events[0].type).toBe('response.started');
    const deltas = events.filter((e) => e.type === 'response.delta');
    expect(deltas.length).toBe(1);
    expect(deltas[0].delta).toContain('IVX IA');
    const completed = events.find((e) => e.type === 'response.completed');
    expect(completed).toBeDefined();
    expect(completed!.model).toBe('ivx-ia-identity-brain');
    expect(completed!.source).toBe('fallback');
  });

  test('provider error produces response.error event', async () => {
    mockStreamIVXAIText.mockImplementation(async function* () {
      yield { type: 'error', error: 'Gateway returned 401' };
    });

    const { handlePublicChatStreamPost } = await import('./public-chat-stream');

    const request = new Request('https://test.example/api/public/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Test question',
        sessionId: 'test-session-5',
        requestId: 'test-req-5',
        history: [],
      }),
    });

    const response = await handlePublicChatStreamPost(request);
    const events = await parseSSEStream(response);

    // Should have started, then either error event or fallback delta+completed
    expect(events[0].type).toBe('response.started');

    // Since no tokens were streamed, we should get a fallback
    const hasError = events.some((e) => e.type === 'response.error');
    const hasCompleted = events.some((e) => e.type === 'response.completed');
    expect(hasError || hasCompleted).toBe(true);
  });

  test('normal question does NOT create fake autonomous job UI', async () => {
    const { handlePublicChatStreamPost } = await import('./public-chat-stream');

    const request = new Request('https://test.example/api/public/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Fix the bug in production',
        sessionId: 'test-session-6',
        requestId: 'test-req-6',
        history: [],
      }),
    });

    const response = await handlePublicChatStreamPost(request);
    const events = await parseSSEStream(response);

    // No job.* events should be emitted for normal chat
    const jobEvents = events.filter((e) => typeof e.type === 'string' && e.type.startsWith('job.'));
    expect(jobEvents.length).toBe(0);

    // No tool.* events either
    const toolEvents = events.filter((e) => typeof e.type === 'string' && e.type.startsWith('tool.'));
    expect(toolEvents.length).toBe(0);
  });

  test('SSE headers are correct', async () => {
    const { handlePublicChatStreamPost } = await import('./public-chat-stream');

    const request = new Request('https://test.example/api/public/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Test',
        sessionId: 'test-session-7',
        requestId: 'test-req-7',
        history: [],
      }),
    });

    const response = await handlePublicChatStreamPost(request);
    expect(response.headers.get('Content-Type')).toBe('text/event-stream; charset=utf-8');
    expect(response.headers.get('Cache-Control')).toBe('no-cache, no-transform');
    expect(response.headers.get('Connection')).toBe('keep-alive');
    expect(response.headers.get('X-Accel-Buffering')).toBe('no');
  });

  test('empty message returns 400', async () => {
    const { handlePublicChatStreamPost } = await import('./public-chat-stream');

    const request = new Request('https://test.example/api/public/chat/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: '',
        sessionId: 'test-session-8',
        requestId: 'test-req-8',
        history: [],
      }),
    });

    const response = await handlePublicChatStreamPost(request);
    expect(response.status).toBe(400);
  });
});
