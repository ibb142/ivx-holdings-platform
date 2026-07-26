import { describe, expect, test } from 'bun:test';
import { handleIVXDevelopmentControlRequest, handleIVXDevelopmentActionRequest, } from './ivx-development-control';
function makeRequest(method, body) {
    return new Request('https://api.ivxholding.com/api/ivx/development-control', {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
    });
}
describe('handleIVXDevelopmentControlRequest auth mapping', () => {
    test('missing bearer token returns 401 (not 500)', async () => {
        const response = await handleIVXDevelopmentControlRequest(makeRequest('GET'));
        expect(response.status).toBe(401);
        const payload = (await response.json());
        expect(payload.ok).toBe(false);
        expect(payload.error.toLowerCase()).toContain('bearer');
    });
    test('invalid bearer token returns 401 (not 500)', async () => {
        const request = new Request('https://api.ivxholding.com/api/ivx/development-control', {
            method: 'GET',
            headers: { Authorization: 'Bearer not-a-real-supabase-jwt' },
        });
        const response = await handleIVXDevelopmentControlRequest(request);
        expect([401, 403]).toContain(response.status);
        const payload = (await response.json());
        expect(payload.ok).toBe(false);
    });
});
describe('handleIVXDevelopmentActionRequest auth mapping', () => {
    test('missing bearer token returns 401 (not 500)', async () => {
        const response = await handleIVXDevelopmentActionRequest(makeRequest('POST', { action: 'inspect' }));
        expect(response.status).toBe(401);
        const payload = (await response.json());
        expect(payload.ok).toBe(false);
        expect(payload.error.toLowerCase()).toContain('bearer');
    });
});
