import { describe, expect, test } from 'bun:test';
import { safeMergeRenderEnvVars, redactMergeResultForLogging, } from '../services/ivx-render-env-merge';
function createMockFetch(responses) {
    const calls = [];
    const mockFetch = (async (url, init) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const method = init?.method ?? 'GET';
        calls.push({ url: urlStr, method, body: typeof init?.body === 'string' ? init.body : undefined });
        const match = responses.find((r) => r.match(urlStr, method));
        if (!match) {
            return new Response('Not found', { status: 404 });
        }
        return new Response(JSON.stringify(match.response.body), {
            status: match.response.status,
            headers: { 'Content-Type': 'application/json' },
        });
    });
    mockFetch.calls = calls;
    return mockFetch;
}
const SAMPLE_ENV_VARS = [
    { envVar: { key: 'OPENAI_API_KEY', value: 'vck_test123' } },
    { envVar: { key: 'SUPABASE_SERVICE_ROLE_KEY', value: 'eyJtest456' } },
    { envVar: { key: 'EXPO_PUBLIC_SUPABASE_URL', value: 'https://x.supabase.co' } },
    { envVar: { key: 'EXPO_PUBLIC_SUPABASE_ANON_KEY', value: 'eyJanon789' } },
    { envVar: { key: 'GITHUB_REPO_URL', value: 'https://github.com/ibb142/repo' } },
    { envVar: { key: 'GITHUB_TOKEN', value: 'ghp_testtoken' } },
    { envVar: { key: 'RENDER_API_KEY', value: 'rnd_testkey' } },
    { envVar: { key: 'RENDER_SERVICE_ID', value: 'srv-testid' } },
];
const REQUIRED_KEYS = [
    'OPENAI_API_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
    'GITHUB_REPO_URL',
    'GITHUB_TOKEN',
    'RENDER_API_KEY',
    'RENDER_SERVICE_ID',
];
function createStatefulFetch(initialVars) {
    let currentVars = [...initialVars];
    let putBody = null;
    const statefulFetch = (async (url, init) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const method = init?.method ?? 'GET';
        if (urlStr.includes('/env-vars') && method === 'GET') {
            return new Response(JSON.stringify(currentVars), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        if (urlStr.includes('/env-vars') && method === 'PUT') {
            if (typeof init?.body === 'string') {
                const parsed = JSON.parse(init.body);
                putBody = parsed;
                currentVars = parsed.map((v) => ({ envVar: v }));
            }
            return new Response(JSON.stringify(currentVars), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        return new Response('{}', { status: 404 });
    });
    return { fetch: statefulFetch, getPutBody: () => putBody };
}
describe('Safe Render Env Merge', () => {
    test('adds one variable without deleting others', async () => {
        const { fetch: statefulFetch, getPutBody } = createStatefulFetch(SAMPLE_ENV_VARS);
        const result = await safeMergeRenderEnvVars({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            updates: { NEW_VAR: 'newval' },
            requiredKeys: [...REQUIRED_KEYS, 'NEW_VAR'],
            fetchImpl: statefulFetch,
        });
        expect(result.ok).toBe(true);
        expect(result.added).toContain('NEW_VAR');
        expect(result.updated).toHaveLength(0);
        expect(result.preserved).toHaveLength(8);
        const putBody = getPutBody();
        expect(putBody).not.toBeNull();
        expect(putBody.some((v) => v.key === 'OPENAI_API_KEY')).toBe(true);
        expect(putBody.some((v) => v.key === 'SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
        expect(putBody.some((v) => v.key === 'NEW_VAR')).toBe(true);
        expect(putBody.length).toBe(9);
    });
    test('updates one variable without deleting others', async () => {
        const { fetch: statefulFetch, getPutBody } = createStatefulFetch(SAMPLE_ENV_VARS);
        const result = await safeMergeRenderEnvVars({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            updates: { GITHUB_TOKEN: 'ghp_newtoken' },
            requiredKeys: REQUIRED_KEYS,
            fetchImpl: statefulFetch,
        });
        expect(result.ok).toBe(true);
        expect(result.updated).toContain('GITHUB_TOKEN');
        expect(result.added).toHaveLength(0);
        expect(result.preserved).toHaveLength(7);
        const putBody = getPutBody();
        expect(putBody.length).toBe(8);
        expect(putBody.some((v) => v.key === 'OPENAI_API_KEY')).toBe(true);
        expect(putBody.some((v) => v.key === 'SUPABASE_SERVICE_ROLE_KEY')).toBe(true);
    });
    test('failed read prevents write', async () => {
        const mockFetch = createMockFetch([
            {
                match: (url, method) => url.includes('/env-vars') && method === 'GET',
                response: { status: 401, body: { error: 'Unauthorized' } },
            },
        ]);
        const result = await safeMergeRenderEnvVars({
            renderApiKey: 'rnd_bad',
            serviceId: 'srv-test',
            updates: { NEW_VAR: 'val' },
            fetchImpl: mockFetch,
        });
        expect(result.ok).toBe(false);
        expect(result.error).toContain('GET failed');
        expect(result.variablesBefore).toBe(0);
        expect(mockFetch.calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    });
    test('failed post-write validation reports failure', async () => {
        let callCount = 0;
        const statefulFetch = (async (url, init) => {
            const urlStr = typeof url === 'string' ? url : url.toString();
            const method = init?.method ?? 'GET';
            if (urlStr.includes('/env-vars') && method === 'GET') {
                callCount++;
                if (callCount === 1) {
                    return new Response(JSON.stringify(SAMPLE_ENV_VARS), { status: 200, headers: { 'Content-Type': 'application/json' } });
                }
                const missing = SAMPLE_ENV_VARS.filter((v) => v.envVar.key !== 'OPENAI_API_KEY');
                return new Response(JSON.stringify(missing), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response(JSON.stringify(SAMPLE_ENV_VARS), { status: 200, headers: { 'Content-Type': 'application/json' } });
        });
        const result = await safeMergeRenderEnvVars({
            renderApiKey: 'rnd_test',
            serviceId: 'srv-test',
            updates: { GITHUB_TOKEN: 'ghp_newtoken' },
            requiredKeys: REQUIRED_KEYS,
            fetchImpl: statefulFetch,
        });
        expect(result.ok).toBe(false);
        expect(result.missingAfterValidation).toContain('OPENAI_API_KEY');
        expect(result.rollbackInstructions).toContain('Rollback');
    });
    test('secret values remain redacted in logging output', () => {
        const result = {
            traceId: 'test-trace',
            ok: true,
            variablesBefore: 8,
            variablesAfter: 9,
            added: ['NEW_VAR'],
            updated: ['GITHUB_TOKEN'],
            preserved: ['OPENAI_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
            missingAfterValidation: [],
            rollbackInstructions: 'No rollback needed.',
            error: null,
            secretValuesReturned: false,
        };
        const redacted = redactMergeResultForLogging(result);
        const serialized = JSON.stringify(redacted);
        expect(serialized).not.toContain('ghp_');
        expect(serialized).not.toContain('vck_');
        expect(serialized).not.toContain('rnd_');
        expect(serialized).not.toContain('eyJ');
        expect(redacted.secretValuesReturned).toBe(false);
    });
    test('concurrent updates do not lose variables', async () => {
        let currentVars = [...SAMPLE_ENV_VARS];
        let writeInProgress = false;
        const writeQueue = [];
        const mockFetch = (async (url, init) => {
            const urlStr = typeof url === 'string' ? url : url.toString();
            const method = init?.method ?? 'GET';
            if (urlStr.includes('/env-vars') && method === 'GET') {
                return new Response(JSON.stringify(currentVars), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            if (urlStr.includes('/env-vars') && method === 'PUT') {
                if (writeInProgress) {
                    await new Promise((resolve) => writeQueue.push(resolve));
                }
                writeInProgress = true;
                const body = JSON.parse(init?.body);
                currentVars = body.map((v) => ({ envVar: v }));
                await new Promise((resolve) => setTimeout(resolve, 10));
                writeInProgress = false;
                if (writeQueue.length > 0)
                    writeQueue.shift()();
                return new Response(JSON.stringify(currentVars), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response('{}', { status: 404 });
        });
        const [result1, result2] = await Promise.all([
            safeMergeRenderEnvVars({
                renderApiKey: 'rnd_test',
                serviceId: 'srv-test',
                updates: { VAR_A: 'val_a' },
                requiredKeys: [...REQUIRED_KEYS, 'VAR_A'],
                fetchImpl: mockFetch,
            }),
            safeMergeRenderEnvVars({
                renderApiKey: 'rnd_test',
                serviceId: 'srv-test',
                updates: { VAR_B: 'val_b' },
                requiredKeys: [...REQUIRED_KEYS, 'VAR_B'],
                fetchImpl: mockFetch,
            }),
        ]);
        expect(result1.ok).toBe(true);
        expect(result2.ok).toBe(true);
        const allVars = currentVars.map((v) => v.envVar.key);
        expect(allVars).toContain('VAR_A');
        expect(allVars).toContain('VAR_B');
        expect(allVars).toContain('OPENAI_API_KEY');
    });
});
