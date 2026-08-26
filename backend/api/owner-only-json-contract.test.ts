import { describe, expect, test } from 'bun:test';
import { ownerOnlyJson } from './owner-only';

describe('ownerOnlyJson strict JSON transport contract', () => {
  test('always returns parseable JSON with explicit JSON MIME and nosniff', async () => {
    const response = ownerOnlyJson({ ok: true, marker: 'json-contract', text: '<html>not actually html</html>' }, 200);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-ivx-json-contract')).toBe('strict-v1');
    const text = await response.text();
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text).ok).toBe(true);
  });

  test('measures the hard limit in UTF-8 bytes so multibyte content cannot be proxy-truncated', async () => {
    const response = ownerOnlyJson({ ok: true, answer: '😀'.repeat(300_000) }, 200);
    const text = await response.text();
    const bytes = Buffer.byteLength(text, 'utf8');
    expect(bytes).toBeLessThanOrEqual(900_000);
    expect(Number(response.headers.get('content-length'))).toBe(bytes);
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text).responseTruncated).toBe(true);
  });

  test('serialization failure falls back to valid JSON instead of an empty/HTML response', async () => {
    const circular: Record<string, unknown> = { ok: true };
    circular.self = circular;
    const response = ownerOnlyJson(circular, 200);
    const text = await response.text();
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(() => JSON.parse(text)).not.toThrow();
    expect(JSON.parse(text).responseTruncated).toBe(true);
  });
});
