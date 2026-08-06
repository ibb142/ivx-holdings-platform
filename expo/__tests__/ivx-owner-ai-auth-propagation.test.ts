import { beforeEach, describe, expect, mock, test } from 'bun:test';

// react-native is mocked comprehensively by test-preload.ts (Platform, Linking, AppState, Alert, StyleSheet, Animated)

// Mock @supabase/supabase-js before any transitive import
mock.module('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }) }),
  }),
}));

const asyncStorageMemory = new Map<string, string>();

mock.module('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (key: string) => asyncStorageMemory.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      asyncStorageMemory.set(key, value);
    },
    removeItem: async (key: string) => {
      asyncStorageMemory.delete(key);
    },
    clear: async () => {
      asyncStorageMemory.clear();
    },
  },
}));

const mockSessionToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

const mockSupabase = {
  auth: {
    getSession: async () => ({
      data: { session: { access_token: mockSessionToken, refresh_token: 'refresh', expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    }),
    refreshSession: async () => ({
      data: { session: null },
      error: { message: 'No session' },
    }),
  },
};

mock.module('@/lib/supabase', () => ({
  supabase: mockSupabase,
  getSupabaseClient: () => mockSupabase,
}));

mock.module('@/lib/ivx-supabase-client', () => ({
  getIVXAccessToken: async () => mockSessionToken,
  getIVXOwnerAIConfigAudit: () => ({
    currentEnvironment: 'production',
    configuredBaseUrl: 'https://api.ivxholding.com',
    configuredFrom: 'EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL',
    devFallbackBaseUrl: null,
    projectApiBaseUrl: null,
    directApiBaseUrl: null,
    webPreviewBaseUrl: null,
    canonicalBaseUrl: 'https://api.ivxholding.com',
    activeBaseUrl: 'https://api.ivxholding.com',
    activeHost: 'api.ivxholding.com',
    directApiHost: null,
    explicitProductionPinApplied: true,
    activeEndpoint: 'https://api.ivxholding.com/api/ivx/owner-ai',
    candidateEndpoints: ['https://api.ivxholding.com/api/ivx/owner-ai'],
    healthCheckUrl: 'https://api.ivxholding.com/health',
    route53AuditUrl: null,
    route53UpsertUrl: null,
    appApiHealthCheckUrl: null,
    appApiRoute53AuditUrl: null,
    routingPolicy: 'production_explicit',
    selectionReason: 'test',
    fallbackUsed: false,
    fallbackReason: null,
    productionReady: true,
    blocksRemoteRequests: false,
    configurationError: null,
    pointsToDevHost: false,
    workflowTrace: [],
    mismatchWarnings: [],
  }),
  getIVXOwnerAICandidateEndpoints: () => ['https://api.ivxholding.com/api/ivx/owner-ai'],
  getIVXOwnerAIEndpoint: () => 'https://api.ivxholding.com/api/ivx/owner-ai',
  getIVXSupabaseClient: () => mockSupabase,
}));

describe('IVX Owner AI auth header propagation', () => {
  let fetchCalls: { url: string; headers: Record<string, string> }[] = [];
  let logCalls: unknown[][] = [];
  const originalFetch = globalThis.fetch;
  const originalConsoleLog = console.log;

  beforeEach(() => {
    fetchCalls = [];
    logCalls = [];
    asyncStorageMemory.clear();

    console.log = (...args: unknown[]) => {
      logCalls.push(args);
    };

    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const headers: Record<string, string> = {};
      if (init?.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((value, key) => { headers[key] = value; });
        } else if (Array.isArray(init.headers)) {
          init.headers.forEach(([key, value]) => { headers[key] = value; });
        } else {
          Object.assign(headers, init.headers);
        }
      }
      fetchCalls.push({ url, headers });
      if (url.includes('/api/ivx/audit-report')) {
        return new Response(JSON.stringify({
          ok: true,
          ownerOnly: true,
          readOnly: true,
          destructiveActionsEnabled: false,
          backend: {
            aiRuntimeConfigured: true,
            aiRuntime: {
              model: 'openai/gpt-4o-mini',
              endpoint: 'https://api.ivxholding.com/v3/ai/openai/gpt-4o-mini',
              hasGatewayUrl: true,
              hasGatewayApiKey: true,
            },
          },
          supabase: {
            config: { hasSupabaseUrl: true, hasAnonKey: true, hasServiceKey: true, hasDbPasswordOrUrl: true },
            readOnlyCatalogQueries: {
              tables: { ok: true },
              schemas: { ok: true },
              columns: { ok: true },
              rls: { ok: true },
            },
          },
          amazon: {
            config: { hasAccessKeyId: true, hasSecretAccessKey: true },
            summary: { passed: 6, failed: 4, total: 10 },
          },
          code: { activeExternalRuntimeControlReferences: [], filesChecked: ['backend/api/ivx-owner-ai.ts'] },
          verdict: {
            backendAccess: 'yes',
            supabaseInspection: 'yes',
            amazonAccess: 'partial',
            externalRuntimeControlDependency: 'not_active',
            honestBlockers: [],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.includes('/api/ivx/owner-ai')) {
        return new Response(JSON.stringify({
          requestId: 'test-owner-ai-request',
          conversationId: 'test-owner-room',
          answer: 'Senior developer answer: HTTP status 200, JWT auth checked, sandbox notes allowed, operator logic valid, full control wording is visible without secrets.',
          model: 'openai/gpt-4o-mini',
          status: 'ok',
          source: 'remote_api',
          provider: 'chatgpt',
          deploymentMarker: 'test-owner-ai-marker',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({ ok: true, secretValuesReturned: false, ownerOnly: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
  });

  test('agent jobs live-activity sends Authorization: Bearer header and logs bearerHeaderPresent without leaking token', async () => {
    const { getIVXAgentLiveActivity } = await import('../src/modules/ivx-owner-ai/services/ivxAgentJobsService');

    const result = await getIVXAgentLiveActivity();

    // Verify fetch was called with Authorization header
    const apiCall = fetchCalls.find(call => call.url.includes('/api/ivx/agent-jobs/live-activity'));
    expect(apiCall).toBeDefined();
    expect(apiCall?.headers['Authorization']).toBe(`Bearer ${mockSessionToken}`);

    // Verify logs show bearerHeaderPresent: true
    const bearerLog = logCalls.find(args =>
      args[0] === '[IVXAgentJobsService] Sending request' &&
      (args[1] as Record<string, unknown>)?.bearerHeaderPresent === true
    );
    expect(bearerLog).toBeDefined();

    // Verify token is NOT leaked in any log
    const allLogsString = JSON.stringify(logCalls);
    expect(allLogsString.includes(mockSessionToken)).toBe(false);

    expect(result.ok).toBe(true);
  });

  test('senior developer audit sends Authorization: Bearer header and logs bearerHeaderPresent without leaking token', async () => {
    const { auditSeniorDeveloperProductionReadiness } = await import('../src/modules/ivx-developer/seniorDeveloperApprovalService');

    const result = await auditSeniorDeveloperProductionReadiness();

    // Verify fetch was called with Authorization header
    const apiCall = fetchCalls.find(call => call.url.includes('/api/ivx/senior-developer/credential-audit'));
    expect(apiCall).toBeDefined();
    expect(apiCall?.headers['Authorization']).toBe(`Bearer ${mockSessionToken}`);

    // Verify logs show bearerHeaderPresent: true
    const bearerLog = logCalls.find(args =>
      args[0] === '[SeniorDeveloperApprovalService] Sending owner-approved request' &&
      (args[1] as Record<string, unknown>)?.bearerHeaderPresent === true
    );
    expect(bearerLog).toBeDefined();

    // Verify token is NOT leaked in any log
    const allLogsString = JSON.stringify(logCalls);
    expect(allLogsString.includes(mockSessionToken)).toBe(false);

    expect(result.httpStatus).toBe(200);
    expect(result.ok).toBe(true);
  });

  test('CTO dashboard sends Authorization: Bearer header and logs bearerHeaderPresent without leaking token', async () => {
    const { getIVXCTODashboardOverview } = await import('../src/modules/ivx-owner-ai/services/ivxCTODashboardService');

    const result = await getIVXCTODashboardOverview();

    // Verify fetch was called with Authorization header
    const apiCall = fetchCalls.find(call => call.url.includes('/api/ivx/cto-dashboard/overview'));
    expect(apiCall).toBeDefined();
    expect(apiCall?.headers['Authorization']).toBe(`Bearer ${mockSessionToken}`);

    // Verify logs show bearerHeaderPresent: true
    const bearerLog = logCalls.find(args =>
      args[0] === '[IVXCTODashboardService] Sending request' &&
      (args[1] as Record<string, unknown>)?.bearerHeaderPresent === true
    );
    expect(bearerLog).toBeDefined();

    // Verify token is NOT leaked in any log
    const allLogsString = JSON.stringify(logCalls);
    expect(allLogsString.includes(mockSessionToken)).toBe(false);

    expect(result.ok).toBe(true);
  });

  test('owner audit report uses gateway config fields and does not falsely report ChatGPT missing', async () => {
    const { ivxAIRequestService } = await import('../src/modules/ivx-owner-ai/services/ivxAIRequestService');

    const result = await ivxAIRequestService.requestOwnerAI({
      conversationId: 'test-owner-room',
      message: 'Give me ChatGPT functionality end to end audit proof status',
      mode: 'chat',
    });

    expect(result.answer).toContain('ChatGPT runtime: installed/configured yes.');
    expect(result.answer).toContain('Runtime config missing: none detected by the owner audit endpoint.');
    expect(result.answer).not.toContain('ChatGPT runtime: not fully configured.');
    expect(fetchCalls.some(call => call.url.includes('/api/ivx/audit-report'))).toBe(true);
  });

  test('senior developer language is allowed through owner AI response filter', async () => {
    const { ivxAIRequestService, assertCleanOwnerAIResponseText } = await import('../src/modules/ivx-owner-ai/services/ivxAIRequestService');
    const technicalAnswer = 'Senior developer proof: HTTP status 200, JWT bearer auth, sandbox execution notes, JavaScript operator checks, restricted route analysis, full control wording, and https://api.ivxholding.com are allowed.';

    expect(assertCleanOwnerAIResponseText(technicalAnswer)).toBe(technicalAnswer);

    const result = await ivxAIRequestService.requestOwnerAI({
      conversationId: 'test-owner-room',
      message: 'Explain the current auth status',
      mode: 'chat',
    });

    expect(result.answer).toContain('HTTP status 200');
    expect(result.answer).toContain('JWT auth checked');
  });
});