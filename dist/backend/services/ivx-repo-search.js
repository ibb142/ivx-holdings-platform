/**
 * IVX Cross-Repo Search
 *
 * Uses GitHub Code Search API via existing `GITHUB_TOKEN`. Read-only,
 * owner-only at the API layer. Never logs the token. Falls back to a
 * structured `missing_access` payload if the token is absent or lacks
 * org/code-search scope.
 */
export const IVX_REPO_SEARCH_MARKER = 'ivx-repo-search-2026-05-28';
export async function searchAcrossIVXRepos(query, opts = {}) {
    const token = (process.env.GITHUB_TOKEN ?? '').trim();
    if (!token) {
        return {
            ok: false,
            marker: IVX_REPO_SEARCH_MARKER,
            status: 'missing_access',
            query,
            scope: 'org',
            hits: [],
            missingEnvNames: ['GITHUB_TOKEN'],
            error: 'GITHUB_TOKEN is not configured; cross-repo search disabled.',
        };
    }
    const org = (opts.org ?? 'ivxholding').trim();
    const perPage = Math.min(Math.max(opts.perPage ?? 25, 1), 50);
    const q = `${query} org:${org}`;
    const url = `https://api.github.com/search/code?q=${encodeURIComponent(q)}&per_page=${perPage}`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                Accept: 'application/vnd.github+json',
                Authorization: `Bearer ${token}`,
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'ivx-senior-dev-ai',
            },
        });
        if (response.status === 401 || response.status === 403) {
            return {
                ok: false,
                marker: IVX_REPO_SEARCH_MARKER,
                status: 'missing_access',
                query,
                scope: 'org',
                hits: [],
                missingEnvNames: ['GITHUB_TOKEN'],
                error: `GitHub returned HTTP ${response.status} for code search; token may lack org/code-search scope.`,
            };
        }
        const payload = await response.json().catch(() => ({}));
        const hits = (payload.items ?? []).map((it) => ({
            repository: it.repository?.full_name ?? '',
            path: it.path ?? '',
            htmlUrl: it.html_url ?? '',
            score: typeof it.score === 'number' ? it.score : 0,
        }));
        return {
            ok: response.ok,
            marker: IVX_REPO_SEARCH_MARKER,
            status: response.ok ? 'verified' : 'not_verified',
            query,
            scope: 'org',
            totalCount: payload.total_count,
            incomplete: payload.incomplete_results,
            hits,
            missingEnvNames: [],
            error: response.ok ? undefined : `GitHub returned HTTP ${response.status}.`,
        };
    }
    catch (error) {
        return {
            ok: false,
            marker: IVX_REPO_SEARCH_MARKER,
            status: 'not_verified',
            query,
            scope: 'org',
            hits: [],
            missingEnvNames: [],
            error: error instanceof Error ? error.message : 'cross-repo search failed',
        };
    }
}
