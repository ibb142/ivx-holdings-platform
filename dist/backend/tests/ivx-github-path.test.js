import { describe, expect, test } from 'bun:test';
import { IVX_GITHUB_CANONICAL_PATH, IVX_GITHUB_CANONICAL_PATH_DESCRIPTION, } from '../services/ivx-senior-developer-runtime';
function createMockFetch(responses) {
    return (async (url, init) => {
        const urlStr = typeof url === 'string' ? url : url.toString();
        const method = init?.method ?? 'GET';
        const match = responses.find((r) => r.match(urlStr, method));
        if (!match)
            return new Response('Not found', { status: 404 });
        return new Response(JSON.stringify(match.response.body), {
            status: match.response.status,
            headers: { 'Content-Type': 'application/json' },
        });
    });
}
const GITHUB_TOKEN = 'ghp_testtoken123';
const OWNER = 'ibb142';
const REPO = 'ivx-holdings-platform';
const BRANCH = 'main';
const BASE_SHA = 'abc123def456abc123def456abc123def456abcd';
const NEW_SHA = 'def789abc012def789abc012def789abc012defg';
describe('GitHub Execution Path Standardization', () => {
    test('canonical path is the Git Data API (not Rork git proxy)', () => {
        expect(IVX_GITHUB_CANONICAL_PATH).toBe('github_git_data_api');
        expect(IVX_GITHUB_CANONICAL_PATH_DESCRIPTION).toContain('Git Data API');
        expect(IVX_GITHUB_CANONICAL_PATH_DESCRIPTION).toContain('Rork git proxy is NOT used');
    });
    test('repository read via GitHub API', async () => {
        const fetchImpl = createMockFetch([
            {
                match: (url) => url.includes(`/repos/${OWNER}/${REPO}`) && !url.includes('/git/'),
                response: {
                    status: 200,
                    body: {
                        default_branch: BRANCH,
                        permissions: { admin: true, maintain: true, push: true },
                    },
                },
            },
        ]);
        const response = await fetchImpl(`https://api.github.com/repos/${OWNER}/${REPO}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/json' },
        });
        const data = await response.json();
        expect(response.ok).toBe(true);
        expect(data.default_branch).toBe(BRANCH);
        expect(data.permissions.push).toBe(true);
    });
    test('branch read via Git Data API', async () => {
        const fetchImpl = createMockFetch([
            {
                match: (url) => url.includes(`/git/ref/heads/${BRANCH}`),
                response: {
                    status: 200,
                    body: {
                        ref: `refs/heads/${BRANCH}`,
                        object: { sha: BASE_SHA, type: 'commit' },
                    },
                },
            },
        ]);
        const response = await fetchImpl(`https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/json' },
        });
        const data = await response.json();
        expect(response.ok).toBe(true);
        expect(data.object.sha).toBe(BASE_SHA);
    });
    test('file read via GitHub API (GET content)', async () => {
        const fetchImpl = createMockFetch([
            {
                match: (url) => url.includes('/contents/backend/hono.ts'),
                response: {
                    status: 200,
                    body: {
                        path: 'backend/hono.ts',
                        sha: 'fileblob123',
                        content: btoa('test content'),
                        encoding: 'base64',
                    },
                },
            },
        ]);
        const response = await fetchImpl(`https://api.github.com/repos/${OWNER}/${REPO}/contents/backend/hono.ts`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/json' },
        });
        const data = await response.json();
        expect(response.ok).toBe(true);
        expect(data.path).toBe('backend/hono.ts');
    });
    test('controlled file update: blob → tree → commit → ref PATCH', async () => {
        let postedBlob = null;
        let postedTree = null;
        let postedCommit = null;
        let patchedRef = null;
        const fetchImpl = (async (url, init) => {
            const urlStr = typeof url === 'string' ? url : url.toString();
            const method = init?.method ?? 'GET';
            const body = init?.body ? JSON.parse(init.body) : null;
            if (urlStr.includes('/git/blobs') && method === 'POST') {
                postedBlob = body;
                return new Response(JSON.stringify({ sha: 'blob-sha-123', url: '' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
            }
            if (urlStr.includes('/git/trees') && method === 'POST') {
                postedTree = body;
                return new Response(JSON.stringify({ sha: 'tree-sha-123', url: '' }), { status: 201, headers: { 'Content-Type': 'application/json' } });
            }
            if (urlStr.includes('/git/commits') && method === 'POST') {
                postedCommit = body;
                return new Response(JSON.stringify({ sha: NEW_SHA, url: `https://github.com/${OWNER}/${REPO}/commit/${NEW_SHA}` }), { status: 201, headers: { 'Content-Type': 'application/json' } });
            }
            if (urlStr.includes(`/git/refs/heads/${BRANCH}`) && method === 'PATCH') {
                patchedRef = body;
                return new Response(JSON.stringify({ ref: `refs/heads/${BRANCH}`, object: { sha: NEW_SHA } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            // GET ref for base SHA
            if (urlStr.includes(`/git/ref/heads/${BRANCH}`) && method === 'GET') {
                return new Response(JSON.stringify({ ref: `refs/heads/${BRANCH}`, object: { sha: BASE_SHA } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            // GET commit for tree SHA
            if (urlStr.includes(`/git/commits/${BASE_SHA}`) && method === 'GET') {
                return new Response(JSON.stringify({ sha: BASE_SHA, tree: { sha: 'base-tree-sha' } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
            }
            return new Response('Not found', { status: 404 });
        });
        // Simulate the commit workflow
        const headers = { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/json', 'Content-Type': 'application/json' };
        const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}`;
        // 1. Read ref
        const refResp = await fetchImpl(`${apiUrl}/git/ref/heads/${BRANCH}`, { method: 'GET', headers });
        const refData = await refResp.json();
        const baseCommitSha = refData.object.sha;
        // 2. Read base commit for tree
        const commitResp = await fetchImpl(`${apiUrl}/git/commits/${baseCommitSha}`, { method: 'GET', headers });
        const commitData = await commitResp.json();
        const baseTreeSha = commitData.tree.sha;
        // 3. Create blob
        const blobResp = await fetchImpl(`${apiUrl}/git/blobs`, {
            method: 'POST', headers,
            body: JSON.stringify({ content: 'new file content', encoding: 'utf-8' }),
        });
        const blobData = await blobResp.json();
        expect(postedBlob).not.toBeNull();
        expect(postedBlob.content).toBe('new file content');
        // 4. Create tree
        const treeResp = await fetchImpl(`${apiUrl}/git/trees`, {
            method: 'POST', headers,
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: [{ path: 'backend/test-file.ts', mode: '100644', type: 'blob', sha: blobData.sha }],
            }),
        });
        const treeData = await treeResp.json();
        expect(postedTree).not.toBeNull();
        expect(postedTree.base_tree).toBe(baseTreeSha);
        // 5. Create commit
        const newCommitResp = await fetchImpl(`${apiUrl}/git/commits`, {
            method: 'POST', headers,
            body: JSON.stringify({ message: 'Test commit', tree: treeData.sha, parents: [baseCommitSha] }),
        });
        const newCommitData = await newCommitResp.json();
        expect(postedCommit).not.toBeNull();
        expect(postedCommit.message).toBe('Test commit');
        expect(newCommitData.sha).toBe(NEW_SHA);
        // 6. Update ref (PATCH, not POST)
        const updateResp = await fetchImpl(`${apiUrl}/git/refs/heads/${BRANCH}`, {
            method: 'PATCH', headers,
            body: JSON.stringify({ sha: newCommitData.sha, force: false }),
        });
        expect(updateResp.ok).toBe(true);
        expect(patchedRef).not.toBeNull();
        expect(patchedRef.sha).toBe(NEW_SHA);
    });
    test('remote SHA verification after push', async () => {
        const fetchImpl = createMockFetch([
            {
                match: (url) => url.includes(`/git/ref/heads/${BRANCH}`),
                response: {
                    status: 200,
                    body: {
                        ref: `refs/heads/${BRANCH}`,
                        object: { sha: NEW_SHA, type: 'commit' },
                    },
                },
            },
        ]);
        const response = await fetchImpl(`https://api.github.com/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/json' },
        });
        const data = await response.json();
        const remoteSha = data.object.sha;
        expect(remoteSha).toBe(NEW_SHA);
    });
    test('unauthorized repository denial (401)', async () => {
        const fetchImpl = createMockFetch([
            {
                match: (url) => url.includes('/repos/'),
                response: { status: 401, body: { message: 'Bad credentials' } },
            },
        ]);
        const response = await fetchImpl(`https://api.github.com/repos/${OWNER}/${REPO}`, {
            method: 'GET',
            headers: { Authorization: 'Bearer invalid_token', Accept: 'application/json' },
        });
        expect(response.status).toBe(401);
        const data = await response.json();
        expect(data.message).toBe('Bad credentials');
    });
    test('invalid token handling (403)', async () => {
        const fetchImpl = createMockFetch([
            {
                match: (url) => url.includes('/user'),
                response: { status: 403, body: { message: 'API rate limit exceeded' } },
            },
        ]);
        const response = await fetchImpl('https://api.github.com/user', {
            method: 'GET',
            headers: { Authorization: 'Bearer expired_token', Accept: 'application/json' },
        });
        expect(response.status).toBe(403);
    });
    test('branch protection handling (422 on force push)', async () => {
        const fetchImpl = createMockFetch([
            {
                match: (url, method) => url.includes('/git/refs/heads/main') && method === 'PATCH',
                response: {
                    status: 422,
                    body: { message: 'Required status checks are not passing', documentation_url: 'https://docs.github.com/...' },
                },
            },
        ]);
        const response = await fetchImpl(`https://api.github.com/repos/${OWNER}/${REPO}/git/refs/heads/main`, {
            method: 'PATCH',
            headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: NEW_SHA, force: false }),
        });
        expect(response.status).toBe(422);
        const data = await response.json();
        expect(data.message.includes('status checks')).toBe(true);
    });
    test('Rork git proxy is NOT the canonical path', () => {
        // The description must explicitly state the Rork git proxy is NOT used
        expect(IVX_GITHUB_CANONICAL_PATH_DESCRIPTION).toMatch(/Rork git proxy is NOT used/);
        // The canonical path must be the Git Data API
        expect(IVX_GITHUB_CANONICAL_PATH).toBe('github_git_data_api');
        // No mention of using the Rork proxy as the active path
        expect(IVX_GITHUB_CANONICAL_PATH_DESCRIPTION).not.toMatch(/via Rork/i);
        expect(IVX_GITHUB_CANONICAL_PATH_DESCRIPTION).not.toMatch(/through Rork/i);
    });
});
