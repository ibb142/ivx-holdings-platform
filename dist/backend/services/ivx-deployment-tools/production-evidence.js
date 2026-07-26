/**
 * IVX Production Evidence Tool
 *
 * Tests all production endpoints and compares deployed commits:
 *   - /health + commit SHA
 *   - /version
 *   - Frontend URLs (landing, chat)
 *   - Chat API
 *   - Registration flow
 *   - Member lookup
 *   - GitHub SHA vs Render SHA vs Production SHA comparison
 */
// ─── Helpers ──────────────────────────────────────────────────────────
const PRODUCTION_URLS = {
    api: 'https://api.ivxholding.com',
    chat: 'https://chat.ivxholding.com',
    landing: 'https://ivxholding.com',
};
async function testEndpoint(name, url, method = 'GET', opts = {}) {
    const start = Date.now();
    try {
        const res = await fetch(url, {
            method,
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(opts.timeout ?? 15000),
        });
        const latency = Date.now() - start;
        const text = await res.text().catch(() => null);
        let bodyPreview = null;
        if (text) {
            try {
                const json = JSON.parse(text);
                bodyPreview = JSON.stringify({
                    ok: json.ok,
                    status: json.status,
                    commit: json.commitShort ?? json.commit?.slice(0, 8),
                    bootTime: json.bootTime,
                }).slice(0, 300);
            }
            catch {
                bodyPreview = text.slice(0, 200);
            }
        }
        const expectedOk = opts.expectedStatus ? res.status === opts.expectedStatus : res.ok;
        return {
            name,
            url,
            method,
            status: res.status,
            ok: expectedOk,
            latencyMs: latency,
            error: expectedOk ? null : `HTTP ${res.status}`,
            bodyPreview,
        };
    }
    catch (err) {
        const latency = Date.now() - start;
        return {
            name, url, method,
            status: null,
            ok: false,
            latencyMs: latency,
            error: err instanceof Error ? err.message : String(err),
            bodyPreview: null,
        };
    }
}
// ─── Endpoint Tests ───────────────────────────────────────────────────
export async function testAllEndpoints() {
    const tests = await Promise.all([
        // Core health/version
        testEndpoint('API Health', `${PRODUCTION_URLS.api}/health`),
        testEndpoint('API Version', `${PRODUCTION_URLS.api}/version`),
        testEndpoint('API Render Deploy Status', `${PRODUCTION_URLS.api}/api/ivx/deploy/status`),
        // Frontend URLs
        testEndpoint('Landing Page', PRODUCTION_URLS.landing),
        testEndpoint('Chat Frontend', PRODUCTION_URLS.chat),
        // API endpoints
        testEndpoint('Chat API (POST)', `${PRODUCTION_URLS.api}/api/chat`, 'POST', { expectedStatus: 201 }),
        testEndpoint('Members API', `${PRODUCTION_URLS.api}/api/members`, 'GET', { expectedStatus: 401 }), // Expecting auth required
        testEndpoint('Registration API', `${PRODUCTION_URLS.api}/api/members/register`, 'GET', { expectedStatus: 405 }), // Should be POST only
        // Deployment engine endpoints
        testEndpoint('Deploy Engine Health', `${PRODUCTION_URLS.api}/api/ivx/deploy/health`),
        testEndpoint('Deploy Engine Status', `${PRODUCTION_URLS.api}/api/ivx/deploy/status`),
    ]);
    return tests;
}
// ─── Commit Comparison ────────────────────────────────────────────────
export async function compareCommits() {
    const GITHUB_API = 'https://api.github.com';
    const repo = 'ibb142/ivx-holdings-platform';
    const token = (process.env.GITHUB_TOKEN ?? '').trim();
    const commits = [];
    // GitHub HEAD
    if (token) {
        try {
            const ghRes = await fetch(`${GITHUB_API}/repos/${repo}/commits/main`, {
                headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
            });
            if (ghRes.ok) {
                const ghData = await ghRes.json();
                commits.push({
                    source: 'GitHub HEAD',
                    sha: ghData.sha,
                    shortSha: ghData.sha.slice(0, 8),
                    message: ghData.commit.message,
                    date: ghData.commit.author.date,
                    error: null,
                });
            }
            else {
                commits.push({ source: 'GitHub HEAD', sha: null, shortSha: null, message: null, date: null, error: `HTTP ${ghRes.status}` });
            }
        }
        catch (err) {
            commits.push({ source: 'GitHub HEAD', sha: null, shortSha: null, message: null, date: null, error: err instanceof Error ? err.message : String(err) });
        }
    }
    else {
        commits.push({ source: 'GitHub HEAD', sha: null, shortSha: null, message: null, date: null, error: 'GITHUB_TOKEN not configured' });
    }
    // Render latest deploy
    const renderKey = (process.env.RENDER_API_KEY ?? '').trim();
    const renderServiceId = (process.env.RENDER_SERVICE_ID ?? '').trim();
    if (renderKey && renderServiceId) {
        try {
            const renderRes = await fetch(`https://api.render.com/v1/services/${encodeURIComponent(renderServiceId)}/deploys?limit=1`, { headers: { Authorization: `Bearer ${renderKey}`, Accept: 'application/json' } });
            if (renderRes.ok) {
                const renderData = await renderRes.json();
                const latestDeploy = renderData?.[0]?.deploy;
                const sha = latestDeploy?.commit?.id ?? null;
                commits.push({
                    source: 'Render Deploy',
                    sha,
                    shortSha: sha ? sha.slice(0, 8) : null,
                    message: latestDeploy?.commit?.message ?? null,
                    date: latestDeploy?.createdAt ?? null,
                    error: null,
                });
            }
            else {
                commits.push({ source: 'Render Deploy', sha: null, shortSha: null, message: null, date: null, error: `HTTP ${renderRes.status}` });
            }
        }
        catch (err) {
            commits.push({ source: 'Render Deploy', sha: null, shortSha: null, message: null, date: null, error: err instanceof Error ? err.message : String(err) });
        }
    }
    else {
        commits.push({ source: 'Render Deploy', sha: null, shortSha: null, message: null, date: null, error: 'RENDER_API_KEY or RENDER_SERVICE_ID not configured' });
    }
    // Production (from /health)
    try {
        const prodRes = await fetch(`${PRODUCTION_URLS.api}/health`, { signal: AbortSignal.timeout(15000) });
        if (prodRes.ok) {
            const prodData = await prodRes.json();
            const sha = prodData.commit ?? null;
            commits.push({
                source: 'Production',
                sha,
                shortSha: prodData.commitShort ?? (sha ? sha.slice(0, 8) : null),
                message: null,
                date: prodData.bootTime ?? null,
                error: null,
            });
        }
        else {
            commits.push({ source: 'Production', sha: null, shortSha: null, message: null, date: null, error: `HTTP ${prodRes.status}` });
        }
    }
    catch (err) {
        commits.push({ source: 'Production', sha: null, shortSha: null, message: null, date: null, error: err instanceof Error ? err.message : String(err) });
    }
    // Check if all SHAs match
    const shas = commits.map(c => c.shortSha).filter(Boolean);
    const match = shas.length >= 2 && new Set(shas).size === 1;
    return { commits, match };
}
// ─── Full Evidence Report ─────────────────────────────────────────────
export async function generateFullEvidence() {
    const [endpoints, commitResult] = await Promise.all([
        testAllEndpoints(),
        compareCommits(),
    ]);
    const errors = [];
    for (const ep of endpoints) {
        if (!ep.ok)
            errors.push(`${ep.name}: ${ep.error}`);
    }
    for (const c of commitResult.commits) {
        if (c.error)
            errors.push(`${c.source}: ${c.error}`);
    }
    const healthEndpoint = endpoints.find(e => e.name === 'API Health');
    const healthStatus = healthEndpoint?.ok ? 'healthy' : 'unhealthy';
    return {
        generatedAt: new Date().toISOString(),
        endpoints,
        commits: commitResult.commits,
        commitMatch: commitResult.match,
        allEndpointsOk: endpoints.every(e => e.ok),
        healthStatus,
        errors,
    };
}
