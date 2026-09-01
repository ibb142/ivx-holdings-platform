import { describe, expect, test } from 'bun:test';
import {
  classifyForRetry,
  computeBackoffMs,
  executeReliably,
  cancelInFlightAIRequest,
  getInFlightAIRequestCount,
} from '../src/modules/chat/services/aiReliability';
// Re-declare a minimal error shape that matches IVXOwnerAIRequestError.
// We avoid importing the real class because ivxAIRequestService transitively
// imports react-native, which breaks bun-test.
class IVXOwnerAIRequestError extends Error {
  diagnostics: any;
  reliabilityTrace?: any;
  constructor(message: string, diagnostics: any) {
    super(message);
    this.name = 'IVXOwnerAIRequestError';
    this.diagnostics = diagnostics;
  }
}

function makeDiagnostics(overrides: Record<string, unknown>) {
  return {
    stage: 'http',
    classification: 'http_error',
    statusCode: null,
    endpoint: null,
    baseUrl: null,
    requestId: null,
    detail: 'test',
    responsePreview: null,
    routingPolicy: 'remote_api_primary',
    selectionReason: 'test',
    fallbackUsed: false,
    ...overrides,
  } as any;
}

describe('classifyForRetry', () => {
  test('AbortError → no retry, reason abort', () => {
    const err = new DOMException('Aborted', 'AbortError');
    const r = classifyForRetry(err);
    expect(r.retry).toBe(false);
    expect(r.reason).toBe('abort');
  });

  test('HTTP 500 → no retry', () => {
    const err = new IVXOwnerAIRequestError('boom', makeDiagnostics({ statusCode: 500, classification: 'backend_failure' }));
    const r = classifyForRetry(err);
    expect(r.retry).toBe(false);
    expect(r.reason).toBe('backend_failure');
    expect(r.statusCode).toBe(500);
  });

  test('HTTP 429 → retry', () => {
    const err = new IVXOwnerAIRequestError('rate', makeDiagnostics({ statusCode: 429, classification: 'http_error' }));
    expect(classifyForRetry(err).retry).toBe(true);
  });

  test('HTTP 401 → no retry', () => {
    const err = new IVXOwnerAIRequestError('auth', makeDiagnostics({ statusCode: 401, classification: 'auth_rejected' }));
    expect(classifyForRetry(err).retry).toBe(false);
  });

  test('service_unavailable_html → retry', () => {
    const err = new IVXOwnerAIRequestError('html', makeDiagnostics({ classification: 'service_unavailable_html', statusCode: 200 }));
    expect(classifyForRetry(err).retry).toBe(true);
  });

  test('network_unreachable → retry', () => {
    const err = new IVXOwnerAIRequestError('net', makeDiagnostics({ classification: 'network_unreachable' }));
    expect(classifyForRetry(err).retry).toBe(true);
  });

  test('plain Error with "network request failed" → retry', () => {
    const r = classifyForRetry(new Error('Network request failed'));
    expect(r.retry).toBe(true);
    expect(r.reason).toBe('network_unreachable');
  });

  test('unknown plain Error → no retry', () => {
    const r = classifyForRetry(new Error('weird'));
    expect(r.retry).toBe(false);
  });
});

describe('computeBackoffMs', () => {
  test('returns 0 when random returns 0', () => {
    expect(computeBackoffMs(1, 500, 4000, () => 0)).toBe(0);
  });

  test('grows exponentially up to max with full jitter', () => {
    const max = 4000;
    // With random()=0.5 we get half of the exponential window.
    expect(computeBackoffMs(1, 500, max, () => 0.5)).toBe(250);
    expect(computeBackoffMs(2, 500, max, () => 0.5)).toBe(500);
    expect(computeBackoffMs(3, 500, max, () => 0.5)).toBe(1000);
    // Caps at maxDelayMs even for large attempt numbers.
    expect(computeBackoffMs(20, 500, max, () => 0.999)).toBeLessThanOrEqual(max);
  });
});

describe('executeReliably', () => {
  test('returns immediately on first success', async () => {
    const { value, trace } = await executeReliably('conv-ok', async () => 42, { maxAttempts: 3, baseDelayMs: 1 });
    expect(value).toBe(42);
    expect(trace.finalOutcome).toBe('ok');
    expect(trace.attempts.length).toBe(1);
    expect(getInFlightAIRequestCount()).toBe(0);
  });

  test('retries transient 503 then succeeds', async () => {
    let n = 0;
    const { value, trace } = await executeReliably(
      'conv-retry',
      async () => {
        n += 1;
        if (n < 2) {
          throw new IVXOwnerAIRequestError('svc', makeDiagnostics({ statusCode: 503, classification: 'backend_failure' }));
        }
        return 'ok';
      },
      { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 },
    );
    expect(value).toBe('ok');
    expect(trace.attempts.filter((a: any) => a.classification === 'retry').length).toBe(1);
    expect(trace.finalOutcome).toBe('ok');
  });

  test('does not retry non-transient errors', async () => {
    let n = 0;
    await expect(executeReliably(
      'conv-401',
      async () => {
        n += 1;
        throw new IVXOwnerAIRequestError('auth', makeDiagnostics({ statusCode: 401, classification: 'auth_rejected' }));
      },
      { maxAttempts: 3, baseDelayMs: 1 },
    )).rejects.toBeInstanceOf(IVXOwnerAIRequestError);
    expect(n).toBe(1);
  });

  test('caller abort cancels in-flight request', async () => {
    const ctrl = new AbortController();
    const promise = executeReliably(
      'conv-abort',
      async (signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
      { signal: ctrl.signal, maxAttempts: 3, baseDelayMs: 1 },
    );
    setTimeout(() => ctrl.abort(), 5);
    await expect(promise).rejects.toBeInstanceOf(DOMException);
    expect(getInFlightAIRequestCount()).toBe(0);
  });

  test('starting a new request cancels prior in-flight request for same conversation', async () => {
    let firstAborted = false;
    const first = executeReliably(
      'conv-superseded',
      async (signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => { firstAborted = true; reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
      }),
      { maxAttempts: 1, baseDelayMs: 1 },
    );
    // Yield so the executor registers its abort listener.
    await new Promise((r) => setTimeout(r, 5));
    const second = executeReliably('conv-superseded', async () => 'second', { maxAttempts: 1, baseDelayMs: 1 });
    await expect(first).rejects.toBeInstanceOf(DOMException);
    const { value } = await second;
    expect(value).toBe('second');
    expect(firstAborted).toBe(true);
  });

  test('cancelInFlightAIRequest aborts an active request', async () => {
    const promise = executeReliably(
      'conv-manual-cancel',
      async (signal) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }),
      { maxAttempts: 1, baseDelayMs: 1 },
    );
    await new Promise((r) => setTimeout(r, 5));
    cancelInFlightAIRequest('conv-manual-cancel', 'test');
    await expect(promise).rejects.toBeInstanceOf(DOMException);
  });
});
