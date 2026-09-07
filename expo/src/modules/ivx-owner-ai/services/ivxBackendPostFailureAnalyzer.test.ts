import { describe, expect, it } from 'bun:test';
import {
  analyzeBackendPostFailures,
  classifyBackendPostFailure,
  classifyBackendPostFailureReason,
  isBackendPostFailure,
  type AnalyzableWatchdogReport,
} from './ivxBackendPostFailureAnalyzer';

function makeReport(overrides: Partial<AnalyzableWatchdogReport> & { traceId: string }): AnalyzableWatchdogReport {
  return {
    finalStatus: 'BLOCKED',
    failedCheckpoint: 'BACKEND_POST_FINISHED',
    failureReason: null,
    statusCode: null,
    backendResponse: null,
    startedAt: '2026-06-01T00:00:00.000Z',
    endedAt: '2026-06-01T00:00:01.000Z',
    requestId: null,
    ...overrides,
  };
}

describe('classifyBackendPostFailureReason', () => {
  it('classifies 401/403 + owner-route markers as owner_ai_route_failure', () => {
    expect(classifyBackendPostFailureReason({ statusCode: 401, reason: null, backendResponse: null })).toBe('owner_ai_route_failure');
    expect(classifyBackendPostFailureReason({ statusCode: 403, reason: 'forbidden', backendResponse: null })).toBe('owner_ai_route_failure');
    expect(
      classifyBackendPostFailureReason({ statusCode: null, reason: 'Owner AI route fell back to /public/chat (owner_route_auth_401)', backendResponse: null }),
    ).toBe('owner_ai_route_failure');
    expect(
      classifyBackendPostFailureReason({ statusCode: null, reason: 'IVX auth guard failed: invalid or expired Supabase session', backendResponse: null }),
    ).toBe('owner_ai_route_failure');
  });

  it('classifies timeouts (text or 408)', () => {
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'Owner AI request timed out after 12000ms', backendResponse: null })).toBe('timeout');
    expect(classifyBackendPostFailureReason({ statusCode: 408, reason: null, backendResponse: null })).toBe('timeout');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'Timed out after 90000ms — no progress past BACKEND_POST_STARTED.', backendResponse: null })).toBe('timeout');
    expect(
      classifyBackendPostFailureReason({
        statusCode: 503,
        reason: 'IVX auth guard failed: Supabase session lookup timed out.',
        backendResponse: null,
      }),
    ).toBe('timeout');
  });

  it('classifies 5xx and service-unavailable HTML as backend_exception', () => {
    expect(classifyBackendPostFailureReason({ statusCode: 500, reason: 'startedAt is not defined', backendResponse: null })).toBe('backend_exception');
    expect(classifyBackendPostFailureReason({ statusCode: 503, reason: null, backendResponse: null })).toBe('backend_exception');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'service_unavailable_html', backendResponse: '<!doctype html>' })).toBe('backend_exception');
  });

  it('classifies fetch/abort failures as network_error', () => {
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'Network request failed', backendResponse: null })).toBe('network_error');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'Owner AI request aborted by caller', backendResponse: null })).toBe('network_error');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'Failed to fetch', backendResponse: null })).toBe('network_error');
  });

  it('classifies invalid/empty responses as parse_error', () => {
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'response_invalid', backendResponse: null })).toBe('parse_error');
    expect(classifyBackendPostFailureReason({ statusCode: 200, reason: 'Backend returned empty answer', backendResponse: null })).toBe('parse_error');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'Unexpected token < in JSON', backendResponse: null })).toBe('parse_error');
  });

  it('classifies other 4xx as status_code, and falls through to other', () => {
    expect(classifyBackendPostFailureReason({ statusCode: 400, reason: 'Message is required.', backendResponse: null })).toBe('status_code');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'mysterious', backendResponse: null })).toBe('other');
  });

  it('classifies 404 / not-found as route_missing (never status_code)', () => {
    expect(classifyBackendPostFailureReason({ statusCode: 404, reason: null, backendResponse: null })).toBe('route_missing');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'route_missing', backendResponse: null })).toBe('route_missing');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'Cannot POST /api/ivx/owner-ai', backendResponse: null })).toBe('route_missing');
  });

  it('classifies AI provider / 429 rate-limit failures as provider', () => {
    expect(classifyBackendPostFailureReason({ statusCode: 429, reason: null, backendResponse: null })).toBe('provider');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'provider_exhausted', backendResponse: null })).toBe('provider');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'AI gateway model error', backendResponse: null })).toBe('provider');
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: 'Too many requests (rate limit)', backendResponse: null })).toBe('provider');
  });

  it('never returns UNKNOWN when a status code or response body exists', () => {
    // Unusual status with no recognizable reason text -> status_code, not other.
    expect(classifyBackendPostFailureReason({ statusCode: 418, reason: null, backendResponse: null })).toBe('status_code');
    // No status but a real body that matches no pattern -> still not the ambiguous 'other'.
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: null, backendResponse: '{"weird":"payload"}' })).toBe('status_code');
    // Genuinely nothing to classify from -> other (UNKNOWN).
    expect(classifyBackendPostFailureReason({ statusCode: null, reason: null, backendResponse: null })).toBe('other');
  });
});

describe('isBackendPostFailure', () => {
  it('matches only BACKEND_POST_FINISHED non-success reports', () => {
    expect(isBackendPostFailure(makeReport({ traceId: 'a' }))).toBe(true);
    expect(isBackendPostFailure(makeReport({ traceId: 'b', finalStatus: 'SUCCESS', failedCheckpoint: null }))).toBe(false);
    expect(isBackendPostFailure(makeReport({ traceId: 'c', failedCheckpoint: 'ASSISTANT_BUBBLE_VISIBLE' }))).toBe(false);
  });
});

describe('classifyBackendPostFailure', () => {
  it('carries evidence fields (statusCode, reason, timestamp, requestId)', () => {
    const result = classifyBackendPostFailure(
      makeReport({ traceId: 't1', statusCode: 401, failureReason: 'owner_route_auth_401', requestId: 'req-1', endedAt: '2026-06-01T00:00:05.000Z' }),
    );
    expect(result.cause).toBe('owner_ai_route_failure');
    expect(result.statusCode).toBe(401);
    expect(result.requestId).toBe('req-1');
    expect(result.at).toBe('2026-06-01T00:00:05.000Z');
  });
});

describe('analyzeBackendPostFailures', () => {
  it('groups by cause, ranks by frequency, and returns the top 5 with evidence', () => {
    const reports: AnalyzableWatchdogReport[] = [
      makeReport({ traceId: 'a1', statusCode: 401, failureReason: 'owner_route_auth_401', requestId: 'r-a1', endedAt: '2026-06-01T00:00:01Z' }),
      makeReport({ traceId: 'a2', statusCode: 403, failureReason: 'owner_route_auth_403', requestId: 'r-a2', endedAt: '2026-06-01T00:00:02Z' }),
      makeReport({ traceId: 'a3', statusCode: 401, failureReason: 'owner_route_auth_401', requestId: 'r-a3', endedAt: '2026-06-01T00:00:03Z' }),
      makeReport({ traceId: 't1', failureReason: 'Owner AI request timed out after 12000ms', endedAt: '2026-06-01T00:00:04Z' }),
      makeReport({ traceId: 't2', failureReason: 'Total timeout exceeded', endedAt: '2026-06-01T00:00:05Z' }),
      makeReport({ traceId: 'b1', statusCode: 500, failureReason: 'startedAt is not defined', endedAt: '2026-06-01T00:00:06Z' }),
      // Not a backend-post failure — must be ignored.
      makeReport({ traceId: 'ignore', finalStatus: 'SUCCESS', failedCheckpoint: null }),
    ];

    const analysis = analyzeBackendPostFailures(reports, () => '2026-06-01T12:00:00.000Z');
    expect(analysis.totalReports).toBe(7);
    expect(analysis.totalFailures).toBe(6);

    const top = analysis.top5;
    expect(top[0]?.cause).toBe('owner_ai_route_failure');
    expect(top[0]?.count).toBe(3);
    expect(top[0]?.statusCodes).toEqual([401, 403]);
    expect(top[0]?.requestIds).toContain('r-a3');
    expect(top[0]?.traceIds[0]).toBe('a3'); // newest-first

    const timeoutGroup = analysis.groups.find((g) => g.cause === 'timeout');
    expect(timeoutGroup?.count).toBe(2);

    const backendGroup = analysis.groups.find((g) => g.cause === 'backend_exception');
    expect(backendGroup?.count).toBe(1);
    expect(backendGroup?.statusCodes).toEqual([500]);

    expect(analysis.generatedAt).toBe('2026-06-01T12:00:00.000Z');
  });

  it('returns an empty analysis when there are no failures', () => {
    const analysis = analyzeBackendPostFailures([
      makeReport({ traceId: 's1', finalStatus: 'SUCCESS', failedCheckpoint: null }),
    ]);
    expect(analysis.totalFailures).toBe(0);
    expect(analysis.groups).toEqual([]);
    expect(analysis.top5).toEqual([]);
  });

  it('ranks the most frequent cause first even when added last', () => {
    const reports: AnalyzableWatchdogReport[] = [
      makeReport({ traceId: 'n1', failureReason: 'Network request failed' }),
      makeReport({ traceId: 'p1', failureReason: 'response_invalid' }),
      makeReport({ traceId: 'p2', failureReason: 'response_invalid' }),
      makeReport({ traceId: 'p3', failureReason: 'response_invalid' }),
    ];
    const analysis = analyzeBackendPostFailures(reports);
    expect(analysis.top5[0]?.cause).toBe('parse_error');
    expect(analysis.top5[0]?.count).toBe(3);
  });
});
