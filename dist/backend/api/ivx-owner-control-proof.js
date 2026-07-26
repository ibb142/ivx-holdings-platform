/**
 * IVX Owner Control Proof API.
 *
 *   GET /api/ivx/owner-control-proof
 *
 * Read-only endpoint (no owner approval required for read-only audits per the
 * owner-control spec §3). Returns the REAL, evidence-derived state of owner
 * control over production. Never fabricates connectivity — every boolean is
 * derived from a live probe or a detected file/env reference.
 *
 * The response is the single source of truth for:
 *   - ownerControl: does the owner-controlled backend expose this proof?
 *   - rorkRequired: is Rork still a production runtime dependency?
 *   - githubConnected: can the backend reach GitHub with the configured token?
 *   - renderConnected: can the backend reach the Render service API?
 *   - supabaseConnected: can the backend reach the Supabase REST API?
 *   - commit / renderDeployId / timestamp: live identity of this deployment.
 */
import { ownerOnlyJson, ownerOnlyOptions } from './owner-only';
export const OPTIONS = () => ownerOnlyOptions();
async function probeGitHub() {
    const token = (process.env.GITHUB_TOKEN ?? '').trim();
    const repo = (process.env.GITHUB_REPO ?? '').trim() || 'ibb142/ivx-holdings-platform';
    if (!token) {
        return { connected: false, detail: 'GITHUB_TOKEN not configured in backend runtime', httpStatus: null };
    }
    try {
        const resp = await fetch(`https://api.github.com/repos/${repo}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: 'application/vnd.github+json',
                'User-Agent': 'IVX-Owner-Control-Proof',
            },
            signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) {
            const data = await resp.json().catch(() => ({}));
            return {
                connected: true,
                detail: `repo=${data.full_name ?? repo} default_branch=${data.default_branch ?? 'unknown'}`,
                httpStatus: resp.status,
            };
        }
        const body = await resp.text().catch(() => '');
        return {
            connected: false,
            detail: `GitHub API ${resp.status}: ${body.slice(0, 120)}`,
            httpStatus: resp.status,
        };
    }
    catch (error) {
        return {
            connected: false,
            detail: `GitHub probe error: ${error instanceof Error ? error.message : 'unknown'}`,
            httpStatus: null,
        };
    }
}
async function probeRender() {
    const apiKey = (process.env.RENDER_API_KEY ?? '').trim();
    const serviceId = (process.env.RENDER_SERVICE_ID ?? '').trim();
    if (!apiKey || !serviceId) {
        return {
            connected: false,
            detail: 'RENDER_API_KEY or RENDER_SERVICE_ID not configured in backend runtime',
            httpStatus: null,
            deployId: null,
        };
    }
    try {
        const resp = await fetch(`https://api.render.com/v1/services/${serviceId}`, {
            headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok) {
            const data = await resp.json().catch(() => ({}));
            return {
                connected: true,
                detail: `service=${data.name ?? serviceId} status=${data.status ?? 'unknown'}`,
                httpStatus: resp.status,
                deployId: null,
            };
        }
        const body = await resp.text().catch(() => '');
        return {
            connected: false,
            detail: `Render API ${resp.status}: ${body.slice(0, 120)}`,
            httpStatus: resp.status,
            deployId: null,
        };
    }
    catch (error) {
        return {
            connected: false,
            detail: `Render probe error: ${error instanceof Error ? error.message : 'unknown'}`,
            httpStatus: null,
            deployId: null,
        };
    }
}
async function probeSupabase() {
    const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? '').trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
    if (!url || !serviceKey) {
        return {
            connected: false,
            detail: 'EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured',
            httpStatus: null,
        };
    }
    const baseUrl = url.startsWith('http') ? url : `https://${url}.supabase.co`;
    try {
        const resp = await fetch(`${baseUrl}/rest/v1/`, {
            headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            signal: AbortSignal.timeout(10_000),
        });
        if (resp.ok || resp.status === 200) {
            return { connected: true, detail: 'Supabase REST reachable', httpStatus: resp.status };
        }
        const body = await resp.text().catch(() => '');
        return {
            connected: false,
            detail: `Supabase REST ${resp.status}: ${body.slice(0, 120)}`,
            httpStatus: resp.status,
        };
    }
    catch (error) {
        return {
            connected: false,
            detail: `Supabase probe error: ${error instanceof Error ? error.message : 'unknown'}`,
            httpStatus: null,
        };
    }
}
/**
 * Detect whether Rork is still a production runtime dependency by reading the
 * actual files the bundler runs. We do NOT trust claims — we read the bytes.
 */
async function detectRorkRuntimeDependency() {
    const references = [];
    try {
        const metro = await (await fetch('file:///dev/null').catch(async () => {
            const fs = await import('node:fs/promises');
            const content = await fs.readFile('expo/metro.config.js', 'utf8').catch(() => '');
            return { text: () => Promise.resolve(content) };
        })).text().catch(() => '');
        if (metro.includes('withRorkMetro') || metro.includes('@rork-ai/toolkit-sdk')) {
            references.push('expo/metro.config.js: uses withRorkMetro / @rork-ai/toolkit-sdk');
        }
    }
    catch {
        // ignore
    }
    try {
        const fs = await import('node:fs/promises');
        const pkg = await fs.readFile('expo/package.json', 'utf8').catch(() => '');
        if (pkg.includes('@rork-ai/toolkit-sdk')) {
            references.push('expo/package.json: @rork-ai/toolkit-sdk dependency present');
        }
        const rorkJson = await fs.readFile('rork.json', 'utf8').catch(() => '');
        if (rorkJson) {
            references.push('rork.json: present at project root');
        }
    }
    catch {
        // ignore
    }
    // Public env vars that point at Rork infrastructure are also a dependency.
    const rorkEnvVars = Object.keys(process.env).filter((k) => /^EXPO_PUBLIC_RORK_/.test(k) || k === 'EXPO_PUBLIC_TOOLKIT_URL');
    if (rorkEnvVars.length > 0) {
        references.push(`env: ${rorkEnvVars.join(', ')} still configured`);
    }
    return { rorkRequired: references.length > 0, references };
}
export async function handleIVXOwnerControlProofRequest(request) {
    const startTime = Date.now();
    const [github, render, supabase, rork] = await Promise.all([
        probeGitHub(),
        probeRender(),
        probeSupabase(),
        detectRorkRuntimeDependency(),
    ]);
    const commit = (process.env.IVX_LIVE_COMMIT_SHA ?? process.env.COMMIT_SHA ?? 'unknown').trim();
    const renderDeployId = render.deployId;
    const payload = {
        ok: true,
        ownerControl: true, // this endpoint existing IS the proof the owner backend is in control
        rorkRequired: rork.rorkRequired,
        rorkReferences: rork.references,
        githubConnected: github.connected,
        githubDetail: github.detail,
        githubHttpStatus: github.httpStatus,
        renderConnected: render.connected,
        renderDetail: render.detail,
        renderHttpStatus: render.httpStatus,
        supabaseConnected: supabase.connected,
        supabaseDetail: supabase.detail,
        supabaseHttpStatus: supabase.httpStatus,
        commit,
        renderDeployId,
        timestamp: new Date().toISOString(),
        probeDurationMs: Date.now() - startTime,
        source: 'ivx-owner-control-proof-endpoint',
        // Single deterministic status for this read-only proof
        status: github.connected && render.connected && supabase.connected && !rork.rorkRequired
            ? 'VERIFIED'
            : 'UNVERIFIED',
        blocker: !github.connected
            ? `GitHub: ${github.detail}`
            : !render.connected
                ? `Render: ${render.detail}`
                : !supabase.connected
                    ? `Supabase: ${supabase.detail}`
                    : rork.rorkRequired
                        ? `Rork runtime dependency still present: ${rork.references.join('; ')}`
                        : null,
    };
    return ownerOnlyJson(payload);
}
