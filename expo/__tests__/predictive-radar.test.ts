import { describe, expect, test } from 'bun:test';
import { assessPredictiveHealth } from '@/src/modules/ivx-autonomous/predictiveRadar';

const sample = (overrides: Partial<Parameters<typeof assessPredictiveHealth>[0][number]> = {}) => ({
  at: Date.now(),
  latencyMs: 180,
  ok: true,
  status: 200,
  jsonValid: true,
  contentTypeValid: true,
  heartbeatAgeMs: 10_000,
  queueDepth: 1,
  failedJobs: 0,
  authFailure: false,
  ...overrides,
});

describe('predictive nervous radar', () => {
  test('stays green for healthy stable telemetry', () => {
    const assessment = assessPredictiveHealth(Array.from({ length: 8 }, () => sample()));
    expect(assessment.level).toBe('GREEN');
    expect(assessment.recommendedAction).toBe('observe');
  });

  test('warns before total failure when latency and heartbeat degrade', () => {
    const samples = [
      sample({ latencyMs: 150 }), sample({ latencyMs: 180 }), sample({ latencyMs: 220 }), sample({ latencyMs: 240 }),
      sample({ latencyMs: 900 }), sample({ latencyMs: 1200 }), sample({ latencyMs: 1700, heartbeatAgeMs: 100_000 }), sample({ latencyMs: 2200, heartbeatAgeMs: 120_000 }),
    ];
    const assessment = assessPredictiveHealth(samples);
    expect(['WATCH', 'WARNING']).toContain(assessment.level);
    expect(assessment.level).not.toBe('GREEN');
    expect(assessment.reasons.join(' ')).toMatch(/Latency|heartbeat/i);
  });

  test('goes critical on runtime failure or auth failure storm', () => {
    const assessment = assessPredictiveHealth([
      sample(), sample(), sample({ status: 401, ok: false, authFailure: true }), sample({ status: 401, ok: false, authFailure: true }),
    ]);
    expect(assessment.level).toBe('CRITICAL');
    expect(assessment.recommendedAction).toBe('fail_closed');
  });

  test('detects bad JSON/content type even before HTTP goes red', () => {
    const assessment = assessPredictiveHealth([
      sample(), sample(), sample({ jsonValid: false, contentTypeValid: false }), sample({ jsonValid: false, contentTypeValid: false }),
    ]);
    expect(assessment.level).not.toBe('GREEN');
    expect(assessment.reasons.join(' ')).toMatch(/JSON|Content-Type/i);
  });
});
