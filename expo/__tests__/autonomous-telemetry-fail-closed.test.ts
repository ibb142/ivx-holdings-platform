import { describe, expect, test } from 'bun:test';
import {
  readTelemetryJson,
  TelemetryJsonError,
} from '../src/modules/ivx-autonomous/safeJsonFetch';

describe('Autonomous telemetry fail-closed contract', () => {
  test('rejects a 200 HTML response as NON_JSON_RUNTIME_RESPONSE', async () => {
    const response = new Response('<!doctype html><html><body>proxy error</body></html>', {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });

    await expect(readTelemetryJson(response, 'https://api.ivxholding.com/audit')).rejects.toMatchObject({
      name: 'TelemetryJsonError',
      code: 'NON_JSON_RUNTIME_RESPONSE',
      status: 200,
    });
  });

  test('rejects invalid JSON instead of returning an empty object/array', async () => {
    const response = new Response('{"ok":true,', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });

    await expect(readTelemetryJson(response, 'https://api.ivxholding.com/jobs')).rejects.toMatchObject({
      code: 'INVALID_JSON',
    });
  });

  test('accepts valid JSON telemetry', async () => {
    const response = new Response(JSON.stringify({ ok: true, jobs: [{ jobId: 'job-1' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json; charset=utf-8' },
    });

    const body = await readTelemetryJson<{ ok: boolean; jobs: Array<{ jobId: string }> }>(response, 'https://api.ivxholding.com/jobs');
    expect(body.ok).toBe(true);
    expect(body.jobs[0]?.jobId).toBe('job-1');
  });

  test('carries safe diagnostics without throwing the native JSON parser error', async () => {
    const response = new Response('<html>login</html>', {
      status: 401,
      headers: { 'content-type': 'text/html' },
    });

    try {
      await readTelemetryJson(response, 'https://api.ivxholding.com/control-plane');
      throw new Error('expected telemetry error');
    } catch (error) {
      expect(error).toBeInstanceOf(TelemetryJsonError);
      const telemetryError = error as TelemetryJsonError;
      expect(telemetryError.code).toBe('NON_JSON_RUNTIME_RESPONSE');
      expect(telemetryError.preview).toContain('login');
      expect(telemetryError.message).not.toContain('Unexpected character');
    }
  });
});
