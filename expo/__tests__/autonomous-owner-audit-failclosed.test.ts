import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readTelemetryJson, TelemetryJsonError } from '../src/modules/ivx-autonomous/safeJsonFetch';

const screenSource = readFileSync(resolve(import.meta.dir, '../app/ivx/autonomous-owner-audit.tsx'), 'utf8');
const nervousSource = readFileSync(resolve(import.meta.dir, '../../.github/workflows/ivx-autonomous-nervous-system.yml'), 'utf8');

describe('Autonomous Owner Audit fail-closed telemetry', () => {
  test('rejects HTML instead of throwing raw JSON parse error', async () => {
    const response = new Response('<html><body>proxy error</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });

    let caught: unknown = null;
    try {
      await readTelemetryJson(response, 'https://api.ivxholding.com/api/ivx/autonomous/control-plane');
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(TelemetryJsonError);
    expect((caught as TelemetryJsonError).code).toBe('NON_JSON_RUNTIME_RESPONSE');
  });

  test('accepts valid JSON telemetry', async () => {
    const response = new Response(JSON.stringify({ ok: true, jobs: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });
    const parsed = await readTelemetryJson<{ ok: boolean; jobs: unknown[] }>(response, 'https://api.ivxholding.com/test');
    expect(parsed.ok).toBe(true);
    expect(parsed.jobs).toEqual([]);
  });

  test('screen never converts telemetry failure into false zero metrics', () => {
    expect(screenSource).toContain('TELEMETRY UNAVAILABLE — ZERO VALUES SUPPRESSED');
    expect(screenSource).toContain("telemetryHealthy ? value : '—'");
    expect(screenSource).toContain('UNKNOWN — TELEMETRY FAILED');
    expect(screenSource).toContain('telemetry failure is NEVER converted into 0 jobs');
    expect(screenSource).not.toContain('await controlResponse.json()');
    expect(screenSource).not.toContain('await jobsResponse.json()');
  });

  test('nervous system has all three layers and catches non-JSON runtime responses', () => {
    expect(nervousSource).toContain('Layer 1 GPS - surface reachability radar');
    expect(nervousSource).toContain('Layer 2 NERVOUS - JSON contract and 112 telemetry');
    expect(nervousSource).toContain('Layer 3 AUTONOMOUS - classify incidents and choose action');
    expect(nervousSource).toContain('NON_JSON_RUNTIME_RESPONSE');
    expect(nervousSource).toContain('falseZeroForbidden:true');
    expect(nervousSource).toContain('owner_audit_control_plane');
    expect(nervousSource).toContain('owner_audit_worker_jobs');
  });
});
