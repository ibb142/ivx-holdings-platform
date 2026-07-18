import { describe, expect, it } from 'bun:test';
import {
  applyChaos,
  classify503Source,
  classifyFailureForRetry,
  computeRetryDelayMs,
  isTerminalTaskStatus,
  nextStatusAfterFailure,
  auditDatabaseEnvConfig,
  IVX_TASK_TERMINAL_STATUSES,
} from './ivx-owner-ai-task-queue';

describe('retry classification (owner rule: retry only transient failures)', () => {
  it('treats 429/502/503/504/408 as transient', () => {
    for (const status of [429, 502, 503, 504, 408]) {
      expect(classifyFailureForRetry({ httpStatus: status, message: 'x' }).transient).toBe(true);
    }
  });

  it('never retries 400/401/403/404/422', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyFailureForRetry({ httpStatus: status, message: 'x' }).transient).toBe(false);
    }
  });

  it('treats timeouts, resets and network failures as transient', () => {
    const messages = [
      'Owner AI request timed out after 58000ms',
      'connection reset by peer',
      'ECONNRESET',
      'socket hang up',
      'Network request failed',
      'fetch failed',
      'temporarily unavailable',
      'rate limit exceeded',
    ];
    for (const message of messages) {
      expect(classifyFailureForRetry({ httpStatus: null, message }).transient).toBe(true);
    }
  });

  it('never retries invalid input or credentials', () => {
    for (const message of ['invalid input provided', 'invalid credentials', 'invalid api key', 'unauthorized request']) {
      expect(classifyFailureForRetry({ httpStatus: null, message }).transient).toBe(false);
    }
  });

  it('permanent message patterns win over transient status codes', () => {
    const result = classifyFailureForRetry({ httpStatus: 503, message: 'provider not configured' });
    expect(result.transient).toBe(false);
  });
});

describe('backoff with jitter', () => {
  it('grows exponentially and respects the cap', () => {
    const noJitter = () => 0.5; // random()*2-1 = 0 → no jitter
    expect(computeRetryDelayMs(1, 2_000, 60_000, 0.25, noJitter)).toBe(2_000);
    expect(computeRetryDelayMs(2, 2_000, 60_000, 0.25, noJitter)).toBe(4_000);
    expect(computeRetryDelayMs(3, 2_000, 60_000, 0.25, noJitter)).toBe(8_000);
    expect(computeRetryDelayMs(10, 2_000, 60_000, 0.25, noJitter)).toBe(60_000);
  });

  it('jitter stays within the configured ratio and never below 500ms', () => {
    for (let i = 0; i < 200; i++) {
      const delay = computeRetryDelayMs(2, 2_000, 60_000, 0.25);
      expect(delay).toBeGreaterThanOrEqual(3_000);
      expect(delay).toBeLessThanOrEqual(5_000);
    }
    expect(computeRetryDelayMs(1, 100, 60_000, 0.25, () => 0)).toBeGreaterThanOrEqual(500);
  });
});

describe('failure outcome (dead-letter rules)', () => {
  it('permanent failure → FAILED, never dead-letter', () => {
    expect(nextStatusAfterFailure(1, 5, false)).toEqual({ status: 'FAILED', deadLetter: false });
  });

  it('transient below max retries → RETRYING', () => {
    expect(nextStatusAfterFailure(1, 5, true)).toEqual({ status: 'RETRYING', deadLetter: false });
    expect(nextStatusAfterFailure(4, 5, true)).toEqual({ status: 'RETRYING', deadLetter: false });
  });

  it('transient at max retries → FAILED + dead-letter', () => {
    expect(nextStatusAfterFailure(5, 5, true)).toEqual({ status: 'FAILED', deadLetter: true });
    expect(nextStatusAfterFailure(6, 5, true)).toEqual({ status: 'FAILED', deadLetter: true });
  });
});

describe('503 source classification (Phase 1 instrumentation)', () => {
  it('distinguishes application configuration 503s', () => {
    expect(classify503Source({ httpStatus: 503, message: 'AI gateway not configured' })).toBe('application_configuration');
    expect(classify503Source({ httpStatus: 503, message: 'environment variables are missing' })).toBe('application_configuration');
  });

  it('distinguishes relation-missing 503s', () => {
    expect(classify503Source({ httpStatus: 503, message: 'relation ivx_messages does not exist' })).toBe('application_relation_missing');
  });

  it('distinguishes timeout-converted failures', () => {
    expect(classify503Source({ httpStatus: 504, message: 'upstream timeout' })).toBe('timeout_converted');
    expect(classify503Source({ httpStatus: 503, message: 'request timed out after 90000ms' })).toBe('timeout_converted');
  });

  it('distinguishes provider and gateway failures', () => {
    expect(classify503Source({ httpStatus: 503, message: 'openai rate limit hit' })).toBe('provider_transient');
    expect(classify503Source({ httpStatus: 503, message: 'bad gateway from render edge' })).toBe('gateway_or_render_edge');
    expect(classify503Source({ httpStatus: 503, message: 'queue is saturated' })).toBe('queue_saturation');
  });
});

describe('chaos injection hook (reproduces the exact 503 scenario safely)', () => {
  it('consumes one failure per attempt then allows success', () => {
    const first = applyChaos({ failures_remaining: 2, simulated_status: 503 });
    expect(first.shouldFail).toBe(true);
    expect(first.simulatedStatus).toBe(503);
    expect(first.updated?.failures_remaining).toBe(1);

    const second = applyChaos(first.updated);
    expect(second.shouldFail).toBe(true);
    expect(second.updated?.failures_remaining).toBe(0);

    const third = applyChaos(second.updated);
    expect(third.shouldFail).toBe(false);
  });

  it('no chaos state → never fails synthetically', () => {
    expect(applyChaos(null).shouldFail).toBe(false);
  });
});

describe('terminal states (one final status only)', () => {
  it('exactly VERIFIED/FAILED/BLOCKED/CANCELED are terminal', () => {
    expect(IVX_TASK_TERMINAL_STATUSES).toEqual(['VERIFIED', 'FAILED', 'BLOCKED', 'CANCELED']);
    for (const status of IVX_TASK_TERMINAL_STATUSES) {
      expect(isTerminalTaskStatus(status)).toBe(true);
    }
    for (const status of ['RECEIVED', 'PERSISTED', 'QUEUED', 'RUNNING', 'WAITING_APPROVAL', 'RETRYING', 'COMPLETED']) {
      expect(isTerminalTaskStatus(status)).toBe(false);
    }
  });
});

describe('database env audit (Phase 6 — no credential requests by default)', () => {
  it('reports canonical mode and alias presence without values', () => {
    const audit = auditDatabaseEnvConfig();
    expect(audit.canonicalMode).toBe('supabase_rest_service_role');
    expect(Object.keys(audit.directPostgresAliases)).toContain('SUPABASE_DB_URL');
    expect(Object.keys(audit.directPostgresAliases)).toContain('DATABASE_URL');
    expect(Object.keys(audit.directPostgresAliases)).toContain('POSTGRES_URL');
    expect(typeof audit.conclusion).toBe('string');
    // Never leak values — only booleans.
    for (const value of Object.values(audit.directPostgresAliases)) {
      expect(typeof value).toBe('boolean');
    }
  });
});
