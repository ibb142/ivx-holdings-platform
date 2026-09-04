import { describe, expect, test } from 'bun:test';
import {
  ensureTaskTable,
  isTransientBootstrapStatus,
  __resetBootstrapStateForTests,
  isTransientSupabaseStatus,
  isSafeSupabaseRestRetry,
  IVX_SUPABASE_QUEUE_RESILIENCE_MARKER,
  SUPABASE_FAILURE_THRESHOLD,
  SUPABASE_BACKOFF_MS,
} from './ivx-owner-ai-task-queue';

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
    const originalFetch = globalThis.fetch;
    let calls = 0;

    globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input.toString();
      calls++;
      if (url.includes('rest/v1/ivx_owner_ai_tasks')) {
        return new Response(JSON.stringify({ message: 'relation does not exist' }), { status: 404 });
      }
      if (url.includes('database/query')) {
        return calls === 2
          ? new Response('[]', { status: 544, headers: { 'content-type': 'application/json' } })
          : new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return originalFetch(input, init);
    };

    try {
      const result = await ensureTaskTable();
      expect(result).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });

  test('ensureTaskTable returns false after max retries on repeated 544', async () => {
    __resetBootstrapStateForTests();
    setBootstrapEnv();
    const originalFetch = globalThis.fetch;
    let calls = 0;

    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = input.toString();
      calls++;
      if (url.includes('rest/v1/ivx_owner_ai_tasks')) {
        return new Response(JSON.stringify({ message: 'relation does not exist' }), { status: 404 });
      }
      if (url.includes('database/query')) {
        return new Response('[]', { status: 544, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    };

    try {
      const result = await ensureTaskTable();
      expect(result).toBe(false);
      expect(calls).toBeGreaterThanOrEqual(3);
    } finally {
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