import { describe, expect, test } from 'bun:test';
import { ensureTaskTable, isTransientBootstrapStatus, __resetBootstrapStateForTests } from './ivx-owner-ai-task-queue';

describe('IVXOwnerAITaskQueue self-bootstrap DDL', () => {
  const envSnapshot = { ...process.env };

  function setBootstrapEnv(): void {
    process.env.SUPABASE_ACCESS_TOKEN = 'sbp_test_management_token_for_retry_tests';
    process.env.SUPABASE_URL = 'https://kvclcdjmjghndxsngfzb.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2Y2xjZGptamdobmR4c25nZnpiIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzE5NDAyNywiZXhwIjoyMDg4NzcwMDI3fQ.TaTRyViK-8sv3R_g1Me08sEjnyMskGXKF0u-I-PTaQ8';
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
        // Database probe: table does not exist yet
        return new Response(JSON.stringify({ message: 'relation does not exist' }), { status: 404 });
      }
      if (url.includes('database/query')) {
        // DDL call: first attempt returns 544, second returns 201
        return calls === 2
          ? new Response('[]', { status: 544, headers: { 'content-type': 'application/json' } })
          : new Response('[]', { status: 201, headers: { 'content-type': 'application/json' } });
      }
      return originalFetch(input, init);
    };

    try {
      const result = await ensureTaskTable();
      expect(result).toBe(true);
      expect(calls).toBeGreaterThanOrEqual(2); // probe + at least one DDL attempt
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
      expect(calls).toBeGreaterThanOrEqual(3); // probe + 3 DDL attempts
    } finally {
      globalThis.fetch = originalFetch;
      restoreEnv();
    }
  });
});
