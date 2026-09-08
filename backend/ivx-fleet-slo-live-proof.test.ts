import { describe, expect, it } from 'bun:test';
import { verifyFleetSloLive } from '../scripts/ivx-fleet-slo-live-proof';

const sha = 'a'.repeat(40);
function fixture(overrides = {}) {
  const sample = { ok: true, marker: 'ivx-fleet-slo-2026-09-08-v1', retry_policy: 'ivx-fleet-retry-policy-2026-09-08-v1', commit_sha: sha, measured_at: new Date().toISOString(), durable: true, target_agents: 112, productive_agents: 3, productive_deficit: 109, productivity_ratio: 3 / 112, running_agents: 4, leased_agents: 2, heartbeat_agents: 4, retry_waiting_tasks: 1, status: 'BREACH', ...overrides };
  const metrics = { ...sample, telemetry_available: 1, slo_met: 0, sample_timestamp_seconds: Date.now() / 1_000 };
  const calls: Array<{ url: string; authenticated: boolean }> = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    expect(init.method).toBe('GET');
    expect(init.redirect).toBe('error');
    const authenticated = new Headers(init.headers).has('X-IVX-System-Key');
    calls.push({ url, authenticated });
    if (!authenticated) return new Response('{}', { status: 401 });
    if (url.includes('prometheus')) return new Response(Object.entries(metrics).filter(([, value]) => typeof value === 'number').map(([key, value]) => `ivx_fleet_${key} ${value}`).join('\n'), { headers: { 'Content-Type': 'text/plain' } });
    return Response.json(sample);
  }) as typeof fetch;
  return { config: { base: 'https://api.ivxholding.com', sha, key: 'test-key', fetcher }, calls };
}

describe('production fleet SLO proof', () => {
  it('verifies owner gate, durable JSON and Prometheus while reporting a real breach', async () => {
    const { config, calls } = fixture();
    const result = await verifyFleetSloLive(config);
    expect(result.verification).toBe('PASS');
    expect(result.slo_status).toBe('BREACH');
    expect(result.productive_agents).toBe(3);
    expect(calls.map((call) => call.authenticated)).toEqual([false, true, true]);
  });
  it.each([
    { durable: false }, { commit_sha: 'b'.repeat(40) },
    { measured_at: new Date(Date.now() - 120_000).toISOString() },
    { status: 'MET' }, { productive_agents: null },
  ])('rejects invalid evidence %j', async (invalid) => {
    await expect(verifyFleetSloLive(fixture(invalid).config)).rejects.toThrow();
  });
  it('does not send a secret to an unexpected origin', async () => {
    const { config, calls } = fixture();
    await expect(verifyFleetSloLive({ ...config, base: 'https://example.com' })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});
