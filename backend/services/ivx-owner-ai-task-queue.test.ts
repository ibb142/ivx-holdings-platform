import { describe, expect, spyOn, test } from 'bun:test';
import * as ownerVariables from '../api/ivx-owner-variables';
import {
  ensureTaskTable,
  listTasks,
  isTransientBootstrapStatus,
  __resetBootstrapStateForTests,
  isTransientSupabaseStatus,
  isSafeSupabaseRestRetry,
  IVX_SUPABASE_QUEUE_RESILIENCE_MARKER,
  SUPABASE_FAILURE_THRESHOLD,
  SUPABASE_BACKOFF_MS,
  classify503Source,
} from './ivx-owner-ai-task-queue';

describe('owner AI incident attribution', () => {
  test('attributes the observed owner-profile outage to authentication', () => {
    expect(classify503Source({ httpStatus: 503, message: JSON.stringify({
      error: 'IVX owner verification is temporarily unavailable. Please retry.',
      code: 'AUTH_SERVICE_UNAVAILABLE', retryable: true,
    }) })).toBe('authentication_unavailable');
  });

  test('keeps an explicit auth outage separate from generic provider wording', () => {
    expect(classify503Source({ httpStatus: 503,
      message: '{"code":"AUTH_SERVICE_UNAVAILABLE","error":"Identity provider timeout"}',
    })).toBe('authentication_unavailable');
  });

  test('identifies database pressure and the observed query timeout', () => {
    expect(classify503Source({ httpStatus: 503, message: '{"code":"DATABASE_PRESSURE"}' })).toBe('database_unavailable');
    expect(classify503Source({ httpStatus: 503, message: 'Query read timeout' })).toBe('database_unavailable');
  });

  test('does not infer a provider failure from HTTP status alone', () => {
    expect(classify503Source({ httpStatus: 503, message: 'Service temporarily unavailable' })).toBe('unknown');
    expect(classify503Source({ httpStatus: 502, message: '' })).toBe('unknown');
  });

  test('retains explicit provider, gateway and timeout attribution', () => {
    expect(classify503Source({ httpStatus: 503, message: 'OpenAI provider unavailable' })).toBe('provider_transient');
    expect(classify503Source({ httpStatus: 502, message: 'Bad gateway' })).toBe('gateway_or_render_edge');
    expect(classify503Source({ httpStatus: 504, message: 'Deadline exceeded' })).toBe('timeout_converted');
  });
});

describe('IVXOwnerAITaskQueue self-bootstrap DDL', () => {
  const envSnapshot = { ...process.env };

  function setBootstrapEnv(): void {
    process.env.SUPABASE_ACCESS_TOKEN = 'sbp_test_management_token_for_retry_tests';
    process.env.SUPABASE_URL = 'https://localtest.supabase.co';
    // Opaque non-JWT placeholder. Never put a real credential here: this file is
    // tracked in git, and the secret_scan gate flags any service_role JWT on sight.
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-service-role-key-not-a-real-credential';
  }

  function restoreEnv(): void {
    process.env = { ...envSnapshot };
  }

  test('isTransientBootstrapStatus treats 544 as transient', () => {
    expect(isTransientBootstrapStatus(544)).toBe(true);
  });

  test('isTransientBootstrapStatus treats 429, 408, 5xx as transient', () => {
    expect(isTransientBootstrapStatus(429)).toBe(true);
    expect(isTransientBootstrapStatus(408)).toBe(true);
    expect(isTransientBootstrapStatus(500)).toBe(true);
    expect(isTransientBootstrapStatus(503)).toBe(true);
  });

  test('isTransientBootstrapStatus treats 400, 401, 403, 404, 422 as permanent', () => {
    expect(isTransientBootstrapStatus(400)).toBe(false);
    expect(isTransientBootstrapStatus(401)).toBe(false);
    expect(isTransientBootstrapStatus(403)).toBe(false);
    expect(isTransientBootstrapStatus(404)).toBe(false);
    expect(isTransientBootstrapStatus(422)).toBe(false);
  });

  test('ensureTaskTable retries on 544 and succeeds when DDL returns 201', async () => {
    __resetBootstrapStateForTests();
    setBootstrapEnv();
    // The bootstrap scenario owns its token fixture. Do not perform a live
    // Owner Variables lookup before exercising the mocked Management API.
    const tokenLookup = spyOn(ownerVariables, 'getIVXOwnerVariableRuntimeValue')
      .mockResolvedValue('sbp_test_management_token_for_retry_tests');
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let queryCalls = 0;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls++;
      if (url.includes('rest/v1/ivx_owner_ai_tasks')) {
        return new Response(JSON.stringify({ code: 'PGRST205', message: 'relation does not exist' }), { status: 404 });
      }
      if (url.includes('database/query')) {
        if (init?.method !== 'POST') return new Response('method not allowed', { status: 405 });
        queryCalls++;
        return queryCalls === 1
          ? new Response('[]', { status: 544, headers: { 'content-type': 'application/json' } })
          : new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
      }
      if (url.endsWith('/rest/v1/')) return new Response('{}', { status: 200 });
      throw new Error(`Unexpected bootstrap test request: ${url}`);
    };

    try {
      const result = await ensureTaskTable();
      expect(result).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(queryCalls).toBe(2);
    } finally {
      tokenLookup.mockRestore();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  test('ensureTaskTable returns false after max retries on repeated 544', async () => {
    __resetBootstrapStateForTests();
    setBootstrapEnv();
    const tokenLookup = spyOn(ownerVariables, 'getIVXOwnerVariableRuntimeValue')
      .mockResolvedValue('sbp_test_management_token_for_retry_tests');
    const originalFetch = globalThis.fetch;
    let calls = 0;
    let queryCalls = 0;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls++;
      if (url.includes('rest/v1/ivx_owner_ai_tasks')) {
        return new Response(JSON.stringify({ code: 'PGRST205', message: 'relation does not exist' }), { status: 404 });
      }
      if (url.includes('database/query')) {
        if (init?.method !== 'POST') return new Response('method not allowed', { status: 405 });
        queryCalls++;
        return new Response('[]', { status: 544, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    };

    try {
      const result = await ensureTaskTable();
      expect(result).toBe(false);
      expect(calls).toBeGreaterThanOrEqual(3);
      expect(queryCalls).toBe(3);
    } finally {
      tokenLookup.mockRestore();
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});

describe('IVXOwnerAITaskQueue Supabase resilience policy', () => {
  test('exports enterprise resilience marker and bounded circuit defaults', () => {
    expect(IVX_SUPABASE_QUEUE_RESILIENCE_MARKER).toContain('ivx-supabase-rest-resilience');
    expect(SUPABASE_FAILURE_THRESHOLD).toBeGreaterThanOrEqual(3);
    expect(SUPABASE_BACKOFF_MS).toBeGreaterThanOrEqual(1000);
    expect(SUPABASE_BACKOFF_MS).toBeLessThanOrEqual(60_000);
  });

  test('classifies 408/429/5xx as transient but 4xx auth/input as permanent', () => {
    for (const status of [408, 429, 500, 502, 503, 504]) expect(isTransientSupabaseStatus(status)).toBe(true);
    for (const status of [200, 201, 400, 401, 403, 404, 409, 422]) expect(isTransientSupabaseStatus(status)).toBe(false);
  });

  test('retries only read-only requests and idempotent task creation', () => {
    expect(isSafeSupabaseRestRetry('GET', 'ivx_owner_ai_tasks?limit=1')).toBe(true);
    expect(isSafeSupabaseRestRetry('HEAD', 'ivx_owner_ai_tasks')).toBe(true);
    expect(isSafeSupabaseRestRetry('POST', 'ivx_owner_ai_tasks')).toBe(true);
    expect(isSafeSupabaseRestRetry('POST', 'ivx_owner_ai_tasks?select=id')).toBe(true);
  });

  test('does not automatically retry ambiguous mutations', () => {
    expect(isSafeSupabaseRestRetry('PATCH', 'ivx_owner_ai_tasks?id=eq.1')).toBe(false);
    expect(isSafeSupabaseRestRetry('POST', 'messages?select=id')).toBe(false);
    expect(isSafeSupabaseRestRetry('DELETE', 'messages?id=eq.1')).toBe(false);
  });
});
describe('owner task list concurrent reads', () => {
  test('coalesces identical limits, isolates snapshots and reads again after settlement', async () => {
    __resetBootstrapStateForTests();
    const savedFetch = globalThis.fetch;
    const savedEnv = { ...process.env };
    process.env.SUPABASE_URL = 'https://localtest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      await gate;
      return new Response(JSON.stringify([{ id: 'task-fixture', worker_data: { phase: 'queued' } }]),
        { headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const pending = Array.from({ length: 112 }, () => listTasks(20));
      const separate = listTasks(40);
      release();
      const results = await Promise.all(pending);
      await separate;
      expect(calls).toBe(2);
      (results[0]![0] as any).worker_data.phase = 'changed';
      expect((results[1]![0] as any).worker_data.phase).toBe('queued');
      await listTasks(20);
      expect(calls).toBe(3);
    } finally {
      release();
      globalThis.fetch = savedFetch;
      process.env = savedEnv;
      __resetBootstrapStateForTests();
    }
  });

  test('does not retain an unavailable result for later reads', async () => {
    __resetBootstrapStateForTests();
    const savedFetch = globalThis.fetch;
    const savedEnv = { ...process.env };
    process.env.SUPABASE_URL = 'https://localtest.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-key';
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return calls === 1
        ? new Response('{}', { status: 401 })
        : new Response(JSON.stringify([{ id: 'recovered-task' }]));
    }) as typeof fetch;
    try {
      expect(await listTasks(20)).toEqual([]);
      expect((await listTasks(20))[0]?.id).toBe('recovered-task');
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = savedFetch;
      process.env = savedEnv;
      __resetBootstrapStateForTests();
    }
  });
});
