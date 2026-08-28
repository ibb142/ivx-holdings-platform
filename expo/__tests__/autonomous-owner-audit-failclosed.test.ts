import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readTelemetryJson, TelemetryJsonError } from '../src/modules/ivx-autonomous/safeJsonFetch';
import { IVX_FAIL_CLOSED_POLICY } from '../src/modules/ivx-autonomous/failClosedPolicy';

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
    // STRUCTURAL GATE: every metric renders through the telemetry-healthy ternary
    // helper that degrades to an em-dash instead of a fabricated zero.
    expect(screenSource).toMatch(/const metric = \(value: string \| number\) =>\s*telemetryHealthy \? value : '—'/);
    // Fail-closed banner when telemetry is unavailable.
    expect(screenSource).toMatch(/telemetryState === 'unavailable'/);
    expect(screenSource).toMatch(/FAIL-CLOSED/);
    // UNKNOWN state is surfaced on failure — never a fake zero.
    expect(screenSource).toContain('UNKNOWN — TELEMETRY FAILED');
    expect(screenSource).toMatch(/no telemetry failure becomes fake zero/i);
    // Telemetry flows through the JSON-contract reader; raw response.json() is banned.
    expect(screenSource).toMatch(/readTelemetryJson|safeJsonFetch/);
    expect(screenSource).not.toMatch(/await\s+\w*Response\.json\(\)/);
  });

  test('nervous system has all three layers and catches non-JSON runtime responses', () => {
    // Layer identity is matched structurally (prefix), so step titles can evolve
    // without losing the three-layer fail-closed coverage guarantee.
    expect(nervousSource).toMatch(/Layer 1 GPS - surface reachability radar/);
    expect(nervousSource).toMatch(/Layer 2 NERVOUS - JSON contract and 112 telemetry/);
    expect(nervousSource).toMatch(/Layer 3 AUTONOMOUS - classify incidents/);
    expect(nervousSource).toContain('NON_JSON_RUNTIME_RESPONSE');
    // Machine-identity rejections are classified, not swallowed.
    expect(nervousSource).toContain('MACHINE_IDENTITY_REJECTED');
    // Fail-closed policy is versioned in the app contract and enforced there.
    expect(IVX_FAIL_CLOSED_POLICY.falseZeroForbidden).toBe(true);
    expect(IVX_FAIL_CLOSED_POLICY.failClosed).toBe(true);
    expect(IVX_FAIL_CLOSED_POLICY.ownerGateHighRiskOnly).toBe(true);
    // The nervous-system diagnosis JSON carries the fail-closed policy inline.
    const policyMatch = nervousSource.match(/policy:\{([^}]*)\}/);
    expect(policyMatch).not.toBeNull();
    expect(policyMatch![1]).toContain('failClosed:true');
    expect(policyMatch![1]).toContain('ownerGateHighRiskOnly:true');
    expect(nervousSource).toContain('owner_audit_control_plane');
    expect(nervousSource).toContain('owner_audit_worker_jobs');
    expect(nervousSource).toContain('owner_gate_required');
  });
});
