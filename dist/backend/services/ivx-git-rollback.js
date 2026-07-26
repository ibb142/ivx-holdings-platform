/**
 * Git rollback check — verifies that the current HEAD has a reachable previous
 * commit suitable for `git revert` or `git reset --hard`, without performing
 * the rollback itself. Owner-approval is enforced by callers.
 *
 * This is read-only: it inspects the GitHub commits API via GITHUB_TOKEN.
 */
function readEnv(name) {
    const v = process.env[name];
    return typeof v === 'string' ? v.trim() : '';
}
function parseRepo(repoUrl) {
    const match = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?/i.exec(repoUrl);
    if (!match)
        return null;
    return { owner: match[1], repo: match[2] };
}
export async function checkGitRollbackReadiness() {
    const checkedAt = new Date().toISOString();
    const token = readEnv('GITHUB_TOKEN');
    const repoUrl = readEnv('GITHUB_REPO_URL');
    const missingEnvNames = [];
    if (!token)
        missingEnvNames.push('GITHUB_TOKEN');
    if (!repoUrl)
        missingEnvNames.push('GITHUB_REPO_URL');
    if (missingEnvNames.length > 0) {
        return { ok: false, status: 'missing_access', missingEnvNames, checkedAt };
    }
    const parsed = parseRepo(repoUrl);
    if (!parsed) {
        return { ok: false, status: 'failed', missingEnvNames, checkedAt, error: 'GITHUB_REPO_URL not parseable.' };
    }
    const headers = {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
    };
    try {
        const repoResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers });
        if (!repoResp.ok) {
            return {
                ok: false,
                status: 'failed',
                missingEnvNames,
                ownerSlash: `${parsed.owner}/${parsed.repo}`,
                checkedAt,
                error: `GitHub repo lookup returned ${repoResp.status}`,
            };
        }
        const repoData = (await repoResp.json());
        const defaultBranch = (repoData.default_branch || 'main').trim();
        const commitsResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?sha=${encodeURIComponent(defaultBranch)}&per_page=2`, { headers });
        if (!commitsResp.ok) {
            return {
                ok: false,
                status: 'failed',
                missingEnvNames,
                defaultBranch,
                ownerSlash: `${parsed.owner}/${parsed.repo}`,
                checkedAt,
                error: `GitHub commits lookup returned ${commitsResp.status}`,
            };
        }
        const commits = (await commitsResp.json());
        if (!Array.isArray(commits) || commits.length === 0) {
            return {
                ok: false,
                status: 'failed',
                missingEnvNames,
                defaultBranch,
                ownerSlash: `${parsed.owner}/${parsed.repo}`,
                checkedAt,
                error: 'No commits returned.',
            };
        }
        const currentSha = commits[0]?.sha;
        const previous = commits[1];
        if (!previous?.sha) {
            return {
                ok: false,
                status: 'no_previous_commit',
                missingEnvNames,
                defaultBranch,
                currentSha,
                ownerSlash: `${parsed.owner}/${parsed.repo}`,
                checkedAt,
            };
        }
        return {
            ok: true,
            status: 'ready',
            missingEnvNames,
            defaultBranch,
            currentSha,
            previousSha: previous.sha,
            previousAuthor: previous.commit?.author?.name,
            previousMessage: (previous.commit?.message || '').split('\n')[0]?.slice(0, 200),
            previousDate: previous.commit?.author?.date,
            ownerSlash: `${parsed.owner}/${parsed.repo}`,
            checkedAt,
        };
    }
    catch (error) {
        return {
            ok: false,
            status: 'failed',
            missingEnvNames,
            checkedAt,
            error: error instanceof Error ? error.message : 'GitHub request failed.',
        };
    }
}
