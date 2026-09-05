import { buildAutonomousIncidentPayload } from '../autonomous-incident-bridge';

describe('autonomous incident bridge', () => {
  it('routes fatal client crashes into silent_failure so backend auto-repair starts', () => {
    const payload = buildAutonomousIncidentPayload({
      message: 'cannot add postgres_changes callbacks after subscribe()',
      stack: 'stack',
      platform: 'android',
      severity: 'fatal',
      metadata: { source: 'ErrorBoundary' },
      buildId: 'sha-test',
    });

    expect(payload.source).toBe('silent_failure');
    expect(payload.severity).toBe('critical');
    expect(payload.checkpoint).toBe('ErrorBoundary');
    expect(payload.buildId).toBe('sha-test');
    expect(payload.suggestedFix).toContain('stage patch');
  });

  it('keeps ordinary client errors as frontend incidents', () => {
    const payload = buildAutonomousIncidentPayload({
      message: 'recoverable request failure',
      platform: 'android',
      severity: 'error',
    });

    expect(payload.source).toBe('frontend');
    expect(payload.severity).toBe('error');
    expect(payload.suggestedFix).toBeUndefined();
  });
});
