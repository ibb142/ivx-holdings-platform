/**
 * IVX Operational Memory — GitHub / Render / Supabase operational adapters.
 * All adapters are read-mostly. Mutating actions are intentionally surfaced
 * through existing owner-approved routes (Block 21 / 22). These adapters give
 * the autonomous loop visibility into the operational surface.
 */
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function nowIso() {
    return new Date().toISOString();
}
function parseGitHubSlug() {
    const url = readTrimmed(process.env.GITHUB_REPO_URL) || readTrimmed(process.env.GITHUB_REPO);
    if (!url)
        return null;
    const m = url.match(/github\.com[:/]([^/]+)\/([^/.]+)(\.git)?/i) || url.match(/^([^/]+)\/([^/.]+)$/);
    if (!m)
        return null;
    return { owner: m[1], repo: m[2] };
}
export async function getGitHubRepoStatus() {
    const slug = parseGitHubSlug();
    const token = readTrimmed(process.env.GITHUB_TOKEN);
    const base = {
        ok: false,
        configured: Boolean(slug && token),
        owner: slug?.owner ?? null,
        repo: slug?.repo ?? null,
        defaultBranch: null,
        latestSha: null,
        latestMessage: null,
        latestAuthor: null,
        latestCommittedAt: null,
        error: null,
    };
    if (!slug) {
        base.error = 'GITHUB_REPO_URL is not configured.';
        return base;
    }
    try {
        const headers = { Accept: 'application/vnd.github+json' };
        if (token)
            headers.Authorization = `Bearer ${token}`;
        const repoResp = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.repo}`, { headers });
        if (!repoResp.ok) {
            base.error = `GitHub repo lookup HTTP ${repoResp.status}.`;
            return base;
        }
        const repoJson = await repoResp.json();
        const branch = readTrimmed(repoJson.default_branch) || 'main';
        base.defaultBranch = branch;
        const commitResp = await fetch(`https://api.github.com/repos/${slug.owner}/${slug.repo}/commits/${branch}`, { headers });
        if (!commitResp.ok) {
            base.error = `GitHub commit lookup HTTP ${commitResp.status}.`;
            return base;
        }
        const commitJson = await commitResp.json();
        base.latestSha = readTrimmed(commitJson.sha) || null;
        base.latestMessage = readTrimmed(commitJson.commit?.message) || null;
        base.latestAuthor = readTrimmed(commitJson.commit?.author?.name) || null;
        base.latestCommittedAt = readTrimmed(commitJson.commit?.author?.date) || null;
        base.ok = true;
        return base;
    }
    catch (error) {
        base.error = error instanceof Error ? error.message : 'GitHub status failed.';
        return base;
    }
}
export async function getRenderServiceStatus() {
    const apiKey = readTrimmed(process.env.RENDER_API_KEY);
    const serviceId = readTrimmed(process.env.RENDER_SERVICE_ID);
    const base = {
        ok: false,
        configured: Boolean(apiKey && serviceId),
        serviceId: serviceId || null,
        serviceName: null,
        latestDeployId: null,
        latestDeployStatus: null,
        latestDeployCommit: null,
        latestDeployFinishedAt: null,
        error: null,
    };
    if (!apiKey || !serviceId) {
        base.error = 'RENDER_API_KEY or RENDER_SERVICE_ID not configured.';
        return base;
    }
    try {
        const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' };
        const svc = await fetch(`https://api.render.com/v1/services/${serviceId}`, { headers });
        if (svc.ok) {
            const svcJson = await svc.json();
            base.serviceName = readTrimmed(svcJson.name) || null;
        }
        const dep = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys?limit=1`, { headers });
        if (!dep.ok) {
            base.error = `Render deploys lookup HTTP ${dep.status}.`;
            return base;
        }
        const depJson = await dep.json();
        const latest = Array.isArray(depJson) ? depJson[0]?.deploy : undefined;
        base.latestDeployId = readTrimmed(latest?.id) || null;
        base.latestDeployStatus = readTrimmed(latest?.status) || null;
        base.latestDeployCommit = readTrimmed(latest?.commit?.id) || null;
        base.latestDeployFinishedAt = readTrimmed(latest?.finishedAt) || null;
        base.ok = true;
        return base;
    }
    catch (error) {
        base.error = error instanceof Error ? error.message : 'Render status failed.';
        return base;
    }
}
export async function getSupabaseStatus() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    const key = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
    const base = {
        ok: false,
        configured: Boolean(url && key),
        projectUrl: url || null,
        serviceRolePresent: Boolean(key),
        reachable: false,
        pgVersion: null,
        vectorExtension: false,
        operationalMemoryTable: false,
        agentTasksTable: false,
        error: null,
    };
    if (!url || !key) {
        base.error = 'Supabase URL or service-role key not configured.';
        return base;
    }
    try {
        const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
        const resp = await fetch(`${url}/rest/v1/rpc/ivx_exec_sql`, {
            method: 'POST', headers,
            body: JSON.stringify({ sql_text: `select version() as v,
        (select count(*) from pg_extension where extname='vector')::int as has_vector,
        (select count(*) from pg_tables where schemaname='public' and tablename='ivx_operational_memory')::int as has_mem,
        (select count(*) from pg_tables where schemaname='public' and tablename='ivx_agent_tasks')::int as has_tasks;` }),
        });
        if (!resp.ok) {
            base.error = `Supabase RPC HTTP ${resp.status}.`;
            return base;
        }
        const json = await resp.json();
        if (json.ok === false) {
            base.error = readTrimmed(json.error) || 'ivx_exec_sql reported failure.';
            return base;
        }
        const row = Array.isArray(json.rows) ? json.rows[0] : undefined;
        base.reachable = true;
        base.pgVersion = row ? String(row.v ?? '').slice(0, 200) : null;
        base.vectorExtension = Number(row?.has_vector ?? 0) > 0;
        base.operationalMemoryTable = Number(row?.has_mem ?? 0) > 0;
        base.agentTasksTable = Number(row?.has_tasks ?? 0) > 0;
        base.ok = base.vectorExtension && base.operationalMemoryTable && base.agentTasksTable;
        return base;
    }
    catch (error) {
        base.error = error instanceof Error ? error.message : 'Supabase status failed.';
        return base;
    }
}
export async function getOperationalSnapshot() {
    const [github, render, supabase] = await Promise.all([
        getGitHubRepoStatus().catch((error) => ({
            ok: false, configured: false, owner: null, repo: null, defaultBranch: null,
            latestSha: null, latestMessage: null, latestAuthor: null, latestCommittedAt: null,
            error: error instanceof Error ? error.message : 'github failed',
        })),
        getRenderServiceStatus().catch((error) => ({
            ok: false, configured: false, serviceId: null, serviceName: null,
            latestDeployId: null, latestDeployStatus: null, latestDeployCommit: null,
            latestDeployFinishedAt: null, error: error instanceof Error ? error.message : 'render failed',
        })),
        getSupabaseStatus().catch((error) => ({
            ok: false, configured: false, projectUrl: null, serviceRolePresent: false, reachable: false,
            pgVersion: null, vectorExtension: false, operationalMemoryTable: false, agentTasksTable: false,
            error: error instanceof Error ? error.message : 'supabase failed',
        })),
    ]);
    return {
        ok: github.ok && render.ok && supabase.ok,
        generatedAt: nowIso(),
        github, render, supabase,
    };
}
