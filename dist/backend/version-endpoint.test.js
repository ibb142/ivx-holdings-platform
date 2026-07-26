import { describe, expect, test } from 'bun:test';
import { buildVersionResponse } from './services/ivx-version-endpoint';
/**
 * Proves the GET /version payload builder returns a minimal, machine-readable
 * build descriptor that external deploy checks use to verify the live commit.
 */
describe('buildVersionResponse', () => {
    test('shapes the minimal build descriptor from runtime build facts', () => {
        const payload = buildVersionResponse({
            commit: 'abc1234def5678',
            commitShort: 'abc1234d',
            deploymentMarker: 'ivx-marker-1',
            bootTime: '2026-06-15T00:00:00.000Z',
            timestamp: '2026-06-15T00:00:01.000Z',
        });
        expect(payload.ok).toBe(true);
        expect(payload.service).toBe('ivx-owner-ai-backend');
        expect(payload.commit).toBe('abc1234def5678');
        expect(payload.commitShort).toBe('abc1234d');
        expect(payload.deploymentMarker).toBe('ivx-marker-1');
        expect(payload.bootTime).toBe('2026-06-15T00:00:00.000Z');
        expect(payload.timestamp).toBe('2026-06-15T00:00:01.000Z');
    });
    test('always reports ok:true and the canonical service name regardless of commit', () => {
        const payload = buildVersionResponse({
            commit: 'unknown',
            commitShort: 'unknown',
            deploymentMarker: '',
            bootTime: '2026-06-15T00:00:00.000Z',
            timestamp: '2026-06-15T00:00:01.000Z',
        });
        expect(payload.ok).toBe(true);
        expect(payload.service).toBe('ivx-owner-ai-backend');
        expect(payload.commit).toBe('unknown');
    });
});
