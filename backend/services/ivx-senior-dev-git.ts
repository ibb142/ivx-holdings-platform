/**
 * IVX-SENIOR-DEV-01 — GitHub Git Service
 *
 * Standalone GitHub Contents API client for the autonomous senior developer
 * worker. Replicates the proven commit pattern from
 * backend/api/ivx-developer-deploy-control.ts (runGithubCommitFile) but as a
 * reusable service so the worker can commit file changes without going through
 * the HTTP owner-gate (the owner approval is enforced at the WAITING_APPROVAL
 * phase of the worker state machine before this service is ever called).
 *
 * Reads credentials from process.env:
 *   - GITHUB_TOKEN (required)
 *   - GITHUB_REPO_URL or GITHUB_OWNER + GITHUB_REPO (required)
 *   - GITHUB_DEFAULT_BRANCH (optional, defaults to "main")
 */

const GITHUB_API = 'https://api.github.com';
const MAX_CONTENT_LENGTH = 1_500_000;

export interface GithubRepoIdentity {
  owner: string;
  repo: string;
}

export interface GithubCommitResult {
  ok: boolean;
  commitSha: string | null;
  commitUrl: string | null;
  fileUrl: string | null;
  mode: 'create_new_file' | 'update_existing_file';
  error: string | null;
}

export interface GithubFileContent {
  ok: boolean;
  content: string | null;
  sha: string | null;
  error: string | null;
}

function readEnv(name: string): string {
  return (process.env[name] ?? '').trim();
}

export function parseGithubRepoUrl(url: string): GithubRepoIdentity | null {
  if (!url) return null;
  const trimmed = url.trim();
  // git@github.com:owner/repo.git
  const sshMatch = trimmed.match(/git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] };
  // https://github.com/owner/repo(.git)?
  const httpsMatch = trimmed.match(/https?:\/\/github\.com\/([^/]+)\/([^/\s]+?)(?:\.git)?(?:\/.*)?$/);
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] };
  // owner/repo shorthand
  const shortMatch = trimmed.match(/^([^/\s]+)\/([^/\s]+)$/);
  if (shortMatch) return { owner: shortMatch[1], repo: shortMatch[2] };
  return null;
}

export function resolveGithubRepoIdentity(): GithubRepoIdentity {
  const fromUrl = readEnv('GITHUB_REPO_URL');
  if (fromUrl) {
    const parsed = parseGithubRepoUrl(fromUrl);
    if (parsed) return parsed;
  }
  const owner = readEnv('GITHUB_OWNER');
  const repo = readEnv('GITHUB_REPO') || readEnv('GITHUB_REPOSITORY');
  if (owner && repo) return { owner, repo };
  const repository = readEnv('GITHUB_REPOSITORY');
  if (repository && repository.includes('/')) {
    const parsed = parseGithubRepoUrl(repository);
    if (parsed) return parsed;
  }
  throw new Error(
    'GITHUB_REPO_URL is missing or invalid. It was not loaded from process.env. ' +
      'Expected format: https://github.com/owner/repo or git@github.com:owner/repo.git'
  );
}

function githubToken(): string {
  const token = readEnv('GITHUB_TOKEN');
  if (!token) {
    throw new Error('GITHUB_TOKEN is required for the senior developer worker to commit.');
  }
  return token;
}

function githubHeaders(): HeadersInit {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${githubToken()}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function sanitizeRepoPath(path: string): string {
  const repoPath = path.replace(/^\/+/, '');
  if (!repoPath || repoPath.includes('..') || repoPath.endsWith('/')) {
    throw new Error(`Unsafe repository path: ${path}`);
  }
  const lower = repoPath.toLowerCase();
  const blocked =
    lower === '.env' ||
    lower.startsWith('.env.') ||
    lower.endsWith('.pem') ||
    lower.endsWith('.key') ||
    lower.includes('/.env') ||
    lower.includes('secret') ||
    lower.includes('private-key');
  if (blocked && lower !== '.env.example') {
    throw new Error(`Refusing to write likely secret-bearing path: ${repoPath}`);
  }
  return repoPath;
}

function encodeRepoPath(repoPath: string): string {
  return repoPath.split('/').map((part) => encodeURIComponent(part)).join('/');
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text: text.slice(0, 600) };
  }
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Read a file from the GitHub repository (raw content, decoded).
 */
export async function githubReadFile(repoPath: string, branch?: string): Promise<GithubFileContent> {
  const repo = resolveGithubRepoIdentity();
  const safePath = sanitizeRepoPath(repoPath);
  const ref = branch || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  const encoded = encodeRepoPath(safePath);
  const url = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/contents/${encoded}?ref=${encodeURIComponent(ref)}`;
  try {
    const res = await fetch(url, { headers: githubHeaders() });
    if (res.status === 404) return { ok: false, content: null, sha: null, error: 'File not found.' };
    if (!res.ok) return { ok: false, content: null, sha: null, error: `GitHub API ${res.status}` };
    const data = readRecord(await parseJsonResponse(res));
    const sha = typeof data.sha === 'string' ? data.sha : null;
    const encodedContent = typeof data.content === 'string' ? data.content.replace(/\n/g, '') : '';
    const content = encodedContent ? Buffer.from(encodedContent, 'base64').toString('utf8') : '';
    return { ok: true, content, sha, error: null };
  } catch (err) {
    return { ok: false, content: null, sha: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Commit a file to the GitHub repository via the Contents API.
 * This is the exact proven pattern from runGithubCommitFile in
 * backend/api/ivx-developer-deploy-control.ts.
 */
export async function githubCommitFile(input: {
  path: string;
  content: string;
  message?: string;
  branch?: string;
}): Promise<GithubCommitResult> {
  const repo = resolveGithubRepoIdentity();
  const branch = (input.branch || readEnv('GITHUB_DEFAULT_BRANCH') || 'main').trim();
  const repoPath = sanitizeRepoPath(input.path);
  const content = input.content;
  if (!content) {
    return { ok: false, commitSha: null, commitUrl: null, fileUrl: null, mode: 'update_existing_file', error: 'File content is required.' };
  }
  if (content.length > MAX_CONTENT_LENGTH) {
    return { ok: false, commitSha: null, commitUrl: null, fileUrl: null, mode: 'update_existing_file', error: `File content too large (max ${MAX_CONTENT_LENGTH} chars).` };
  }
  const message = (input.message || `IVX Senior Dev Worker update ${repoPath}`).trim();
  const encoded = encodeRepoPath(repoPath);

  // Fetch existing file to get its SHA (required for updates).
  const contentUrl = `${GITHUB_API}/repos/${repo.owner}/${repo.repo}/contents/${encoded}?ref=${encodeURIComponent(branch)}`;
  let existingSha = '';
  try {
    const existingRes = await fetch(contentUrl, { method: 'GET', headers: githubHeaders() });
    if (existingRes.ok) {
      const existingData = readRecord(await parseJsonResponse(existingRes));
      existingSha = typeof existingData.sha === 'string' ? existingData.sha : '';
    }
  } catch {
    // File may not exist yet — proceed without SHA (create new file).
  }

  const mode: GithubCommitResult['mode'] = existingSha ? 'update_existing_file' : 'create_new_file';

  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo.owner}/${repo.repo}/contents/${encoded}`, {
      method: 'PUT',
      headers: githubHeaders(),
      body: JSON.stringify({
        message,
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(existingSha ? { sha: existingSha } : {}),
      }),
    });
    if (!res.ok) {
      const errBody = await parseJsonResponse(res);
      const errMsg = readRecord(errBody).message || `GitHub commit failed with HTTP ${res.status}`;
      return { ok: false, commitSha: null, commitUrl: null, fileUrl: null, mode, error: String(errMsg) };
    }
    const data = readRecord(await parseJsonResponse(res));
    const commit = readRecord(data.commit);
    const file = readRecord(data.content);
    return {
      ok: true,
      commitSha: typeof commit.sha === 'string' ? commit.sha : null,
      commitUrl: typeof commit.html_url === 'string' ? commit.html_url : (typeof commit.url === 'string' ? commit.url : null),
      fileUrl: typeof file.html_url === 'string' ? file.html_url : null,
      mode,
      error: null,
    };
  } catch (err) {
    return { ok: false, commitSha: null, commitUrl: null, fileUrl: null, mode, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Get the current HEAD SHA of the default branch.
 */
export async function githubGetHeadSha(branch?: string): Promise<{ sha: string | null; error: string | null }> {
  const repo = resolveGithubRepoIdentity();
  const ref = branch || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(ref)}`, {
      headers: githubHeaders(),
    });
    if (!res.ok) return { sha: null, error: `GitHub API ${res.status}` };
    const data = readRecord(await parseJsonResponse(res));
    return { sha: typeof data.sha === 'string' ? data.sha : null, error: null };
  } catch (err) {
    return { sha: null, error: err instanceof Error ? err.message : String(err) };
  }
}

export interface GithubFileTreeResult {
  ok: boolean;
  files: string[];
  error: string | null;
}

/**
 * List the repository file tree (recursive) via the Git Trees API.
 * Returns source files relevant to engineering planning (filters out
 * node_modules, build artifacts, logs, assets, and other non-source paths
 * so the AI planning prompt stays within token limits and focuses on code).
 */
export async function githubListFiles(branch?: string): Promise<GithubFileTreeResult> {
  const repo = resolveGithubRepoIdentity();
  const ref = branch || readEnv('GITHUB_DEFAULT_BRANCH') || 'main';
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo.owner}/${repo.repo}/git/trees/${encodeURIComponent(ref)}?recursive=1`, {
      headers: githubHeaders(),
    });
    if (!res.ok) return { ok: false, files: [], error: `GitHub API ${res.status}` };
    const data = readRecord(await parseJsonResponse(res));
    const tree = Array.isArray(data.tree) ? (data.tree as Array<Record<string, unknown>>) : [];
    const allPaths = tree
      .filter((node) => node.type === 'blob' && typeof node.path === 'string')
      .map((node) => node.path as string);
    const files = allPaths.filter((p) => isRelevantSourcePath(p));
    return { ok: true, files, error: null };
  } catch (err) {
    return { ok: false, files: [], error: err instanceof Error ? err.message : String(err) };
  }
}

const RELEVANT_SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.json', '.sql', '.md', '.yaml', '.yml', '.sh',
]);

const BLOCKED_PATH_PREFIXES = [
  'node_modules/',
  '.git/',
  'dist/',
  'build/',
  'logs/',
  '.rork/',
  'android/build/',
  'android/app/build/',
  'ios-ivx-',
  'expo/.expo/',
  'expo/android/build/',
  'expo/node_modules/',
  '__tests__/mocks/',
  'deploy/',
  '.github/',
  'keys/',
  'cert-app/',
  'docs/',
];

const BLOCKED_PATH_SEGMENTS = [
  '/assets/',
  '/static/',
  'package-lock.json',
  'bun.lock',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.ico',
  '.ttf',
  '.otf',
  '.woff',
  '.mp4',
  '.mp3',
  '.wav',
  '.keystore',
  '.pem',
  '.key',
  '.env',
];

function isRelevantSourcePath(path: string): boolean {
  if (BLOCKED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  if (BLOCKED_PATH_SEGMENTS.some((seg) => path.includes(seg))) return false;
  const ext = path.slice(path.lastIndexOf('.'));
  if (!ext || !RELEVANT_SOURCE_EXTENSIONS.has(ext)) return false;
  return true;
}
