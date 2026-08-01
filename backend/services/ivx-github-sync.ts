/**
 * IVX Holdings — GitHub Sync (in-process, backend-native)
 *
 * TypeScript port of `expo/sync-github.mjs` + `expo/sync-paths.mjs` so the
 * owner-only sync route (POST /api/ivx/autonomy/github/sync) no longer has to
 * spawn `node expo/sync-github.mjs`. Those .mjs files were not present in the
 * production Docker image (only `COPY backend ./backend` and a few `expo/`
 * subfolders are shipped), which made every sync fail with
 * `MODULE_NOT_FOUND: /app/expo/sync-github.mjs`.
 *
 * This module lives under `backend/` which is always copied into the runtime
 * image, so the sync logic is guaranteed to exist wherever the server runs.
 *
 * Functionality is preserved 1:1 with the original script:
 *   - GitHub commit creation (Git Tree API, single atomic commit)
 *   - Repository updates (blob upload + tree + commit + ref update)
 *   - Path synchronization (recursive scan from the resolved sync root)
 *   - Branch ensure/create
 *   - Dry-run + delete-remote modes
 *
 * Secrets are never logged here; the caller redacts the token from the returned
 * log buffer before surfacing it.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, relative, dirname, sep } from 'path';
import { createHash } from 'crypto';

const API = 'https://api.github.com';

const IGNORE_DIRS = new Set<string>([
  'node_modules', '.git', '.expo', 'dist', 'build', '.ivx',
  '.DS_Store', '__pycache__', 'tmp', 'core',
  'logs',
  'dist-audit-ios', 'dist-audit-ios-final', 'dist-audit-ios-postfix',
  'dist-audit-web', 'dist-audit-web-final', 'dist-audit-web-postfix',
]);

const IGNORE_FILES = new Set<string>([
  '.env', '.env.production', '.env.staging', '.env.local',
  '.env.development', 'ivx-eslint.config.js', 'bun.lock',
  'package-lock.json', 'yarn.lock',
]);

const IGNORE_EXTENSIONS = new Set<string>([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico',
  '.mp4', '.mov', '.avi', '.lock',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB GitHub blob limit

export interface GithubSyncOptions {
  /** GitHub token with `repo` scope. */
  token: string;
  /** Owner/repo slug, e.g. `ibb142/rork-app`. */
  repoSlug: string;
  /** Target branch (defaults handled by caller, e.g. `main`). */
  branch: string;
  /** When true, compute the diff but never push. */
  dryRun: boolean;
  /** Commit message used when changes are pushed. */
  message: string;
  /** When true, remote files absent locally are deleted from the tree. */
  deleteRemote?: boolean;
  /**
   * Optional explicit root to scan. When omitted, the sync root is resolved by
   * walking up from `process.cwd()` looking for `.git` / `ivx.json`
   * (SYNC_ROOT env overrides), matching the original `getSyncPaths` behavior.
   */
  rootDir?: string;
  /** Hard wall-clock budget; the sync aborts and reports `timedOut` if exceeded. */
  timeoutMs: number;
}

export interface GithubSyncResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** Newly created commit SHA, when a push occurred. */
  commitSha: string | null;
}

interface LocalFile {
  path: string;
  fullPath: string;
  size: number;
}

class SyncTimeoutError extends Error {}

function normalizePath(value: string): string {
  return value.split(sep).join('/');
}

/** Port of `findSyncRoot` from `expo/sync-paths.mjs`. */
function findSyncRoot(startDir: string): string {
  let currentDir = startDir;
  while (true) {
    if (existsSync(join(currentDir, '.git')) || existsSync(join(currentDir, 'ivx.json'))) {
      return currentDir;
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) return startDir;
    currentDir = parentDir;
  }
}

function resolveSyncRoot(explicitRoot?: string): string {
  if (explicitRoot && explicitRoot.trim().length > 0) return explicitRoot;
  const envRoot = process.env.SYNC_ROOT?.trim();
  if (envRoot && envRoot.length > 0) return envRoot;
  return findSyncRoot(process.cwd());
}

function getPathParts(relativePath: string): string[] {
  return String(relativePath || '').split(/[\\/]+/).filter(Boolean);
}

function getPathExtension(relativePath: string): string {
  const filename = getPathParts(relativePath).at(-1) ?? '';
  return filename.includes('.') ? `.${filename.split('.').pop()?.toLowerCase()}` : '';
}

function isIgnoredRelativePath(relativePath: string): boolean {
  const parts = getPathParts(relativePath);
  if (parts.some((part) => IGNORE_DIRS.has(part))) return true;
  // Tokens without `workflow` scope cannot modify .github/workflows; skip them
  // so tree creation does not 404 the entire sync.
  if (parts.length >= 2 && parts[0] === '.github' && parts[1] === 'workflows') return true;
  const filename = parts.at(-1) ?? '';
  if (IGNORE_FILES.has(filename)) return true;
  return IGNORE_EXTENSIONS.has(getPathExtension(relativePath));
}

function getAllFiles(dir: string, base: string = dir): LocalFile[] {
  const files: LocalFile[] = [];
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry) || IGNORE_FILES.has(entry)) continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      const relDir = relative(base, full);
      if (isIgnoredRelativePath(relDir + '/_')) continue;
      files.push(...getAllFiles(full, base));
    } else {
      const relativePath = relative(base, full);
      if (!isIgnoredRelativePath(relativePath) && stat.size <= MAX_FILE_SIZE) {
        files.push({ path: normalizePath(relativePath), fullPath: full, size: stat.size });
      }
    }
  }
  return files;
}

function gitBlobSha(content: Buffer): string {
  const header = `blob ${content.length}\0`;
  return createHash('sha1').update(Buffer.concat([Buffer.from(header), content])).digest('hex');
}

/**
 * Runs a full GitHub sync entirely in-process. Returns a CLI-compatible result
 * (`exitCode`/`stdout`/`stderr`/`timedOut`) so callers can keep their existing
 * reporting logic unchanged.
 */
export async function runGithubSyncInProcess(opts: GithubSyncOptions): Promise<GithubSyncResult> {
  const { token, repoSlug, branch, dryRun, message, deleteRemote = false, timeoutMs } = opts;
  const deadline = Date.now() + timeoutMs;
  const logs: string[] = [];
  const errs: string[] = [];
  const log = (line: string): void => { logs.push(line); };

  const checkDeadline = (): void => {
    if (Date.now() > deadline) throw new SyncTimeoutError('sync exceeded time budget');
  };

  async function githubFetch(urlPath: string, options: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<any> {
    checkDeadline();
    const url = urlPath.startsWith('http') ? urlPath : `${API}${urlPath}`;
    const method = (options.method ?? 'GET').toUpperCase();
    const res = await fetch(url, {
      method,
      body: options.body,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...options.headers,
      },
    });
    if (!res.ok && !(res.status === 404 && method === 'GET')) {
      const text = await res.text();
      throw new Error(`GitHub API ${method} ${urlPath} ${res.status} ${res.statusText}: ${text.slice(0, 800)}`);
    }
    if (res.status === 404) return null;
    return res.json();
  }

  async function ensureBranch(): Promise<string> {
    const ref = await githubFetch(`/repos/${repoSlug}/git/ref/heads/${branch}`);
    if (ref) return ref.object.sha as string;
    log(`  Branch "${branch}" not found, creating from default...`);
    const repo = await githubFetch(`/repos/${repoSlug}`);
    const defaultRef = await githubFetch(`/repos/${repoSlug}/git/ref/heads/${repo.default_branch}`);
    if (!defaultRef) throw new Error('Cannot find default branch');
    await githubFetch(`/repos/${repoSlug}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: defaultRef.object.sha }),
    });
    return defaultRef.object.sha as string;
  }

  async function getRemoteTree(commitSha: string): Promise<{ treeSha: string | null; files: Map<string, string> }> {
    const commit = await githubFetch(`/repos/${repoSlug}/git/commits/${commitSha}`);
    if (!commit) return { treeSha: null, files: new Map() };
    const tree = await githubFetch(`/repos/${repoSlug}/git/trees/${commit.tree.sha}?recursive=1`);
    const files = new Map<string, string>();
    if (tree?.tree) {
      for (const item of tree.tree) {
        if (item.type === 'blob') files.set(item.path, item.sha);
      }
    }
    return { treeSha: commit.tree.sha as string, files };
  }

  async function createBlob(content: Buffer): Promise<string> {
    const result = await githubFetch(`/repos/${repoSlug}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
    });
    return result.sha as string;
  }

  async function createTree(baseTreeSha: string | null, treeItems: unknown[]): Promise<string> {
    const result = await githubFetch(`/repos/${repoSlug}/git/trees`, {
      method: 'POST',
      body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
    });
    if (!result?.sha) {
      throw new Error('GitHub tree creation did not return a tree SHA');
    }
    return result.sha as string;
  }

  async function createCommit(treeSha: string, parentSha: string, msg: string): Promise<string> {
    if (!treeSha) throw new Error('Cannot create GitHub commit without a tree SHA');
    const result = await githubFetch(`/repos/${repoSlug}/git/commits`, {
      method: 'POST',
      body: JSON.stringify({ message: msg, tree: treeSha, parents: [parentSha] }),
    });
    if (!result?.sha) throw new Error('GitHub commit creation did not return a commit SHA');
    return result.sha as string;
  }

  async function updateRef(commitSha: string): Promise<void> {
    await githubFetch(`/repos/${repoSlug}/git/refs/heads/${branch}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitSha, force: false }),
    });
  }

  try {
    if (!token) throw new Error('GITHUB_TOKEN is not set');
    if (!repoSlug) throw new Error('GITHUB_REPO or GITHUB_REPO_URL must point to the owner-controlled GitHub repo');

    const root = resolveSyncRoot(opts.rootDir);
    const startTime = Date.now();
    log('========================================');
    log('  IVX Holdings — GitHub Sync (in-process)');
    log(`  Repo: ${repoSlug} (${branch})`);
    log(`  ${dryRun ? 'DRY RUN — no changes will be made' : 'LIVE — changes will be pushed'}`);
    log(`  Remote deletes: ${deleteRemote ? 'enabled' : 'preserved'}`);
    log('========================================');

    log('[1/6] Verifying branch...');
    const headSha = await ensureBranch();
    log(`  HEAD: ${headSha.slice(0, 7)}`);

    log('[2/6] Scanning local files...');
    log(`  Root: ${root}`);
    const localFiles = getAllFiles(root);
    log(`  Found ${localFiles.length} files locally`);

    log('[3/6] Fetching remote tree...');
    const { treeSha: baseTreeSha, files: remoteFiles } = await getRemoteTree(headSha);
    log(`  Remote has ${remoteFiles.size} files`);

    log('[4/6] Computing diff...');
    const toUpload: Array<LocalFile & { content: Buffer; localSha: string; isNew: boolean }> = [];
    const unchanged: string[] = [];
    const deleted: string[] = [];

    for (const file of localFiles) {
      checkDeadline();
      const content = readFileSync(file.fullPath);
      const localSha = gitBlobSha(content);
      const remoteSha = remoteFiles.get(file.path);
      if (remoteSha === localSha) {
        unchanged.push(file.path);
      } else {
        toUpload.push({ ...file, content, localSha, isNew: !remoteSha });
      }
    }

    const localPaths = new Set(localFiles.map((f) => f.path));
    for (const [remotePath] of remoteFiles) {
      if (deleteRemote && !localPaths.has(remotePath) && !isIgnoredRelativePath(remotePath)) {
        deleted.push(remotePath);
      }
    }

    log(`  Changed/New: ${toUpload.length}`);
    log(`  Unchanged:   ${unchanged.length}`);
    log(`  Deleted:     ${deleted.length}`);

    if (toUpload.length === 0 && deleted.length === 0) {
      log('  Everything is in sync. Nothing to push.');
      return { exitCode: 0, stdout: logs.join('\n'), stderr: errs.join('\n'), timedOut: false, commitSha: null };
    }

    if (dryRun) {
      log('--- DRY RUN REPORT ---');
      for (const f of toUpload) log(`  ${f.isNew ? 'ADD' : 'MOD'} ${f.path} (${(f.size / 1024).toFixed(1)}KB)`);
      for (const p of deleted) log(`  DEL ${p}`);
      log(`Total: ${toUpload.length} uploads, ${deleted.length} deletes`);
      return { exitCode: 0, stdout: logs.join('\n'), stderr: errs.join('\n'), timedOut: false, commitSha: null };
    }

    log('[5/6] Uploading blobs & building tree...');
    const treeItems: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];
    const BATCH_SIZE = 5;
    for (let i = 0; i < toUpload.length; i += BATCH_SIZE) {
      const batch = toUpload.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map(async (file) => {
          const blobSha = await createBlob(file.content);
          log(`  + ${file.path} (${file.isNew ? 'new' : 'updated'})`);
          return { path: file.path, mode: '100644', type: 'blob', sha: blobSha };
        }),
      );
      treeItems.push(...results);
    }

    for (const deletedPath of deleted) {
      treeItems.push({ path: deletedPath, mode: '100644', type: 'blob', sha: null });
      log(`  - ${deletedPath} (deleted)`);
    }

    log('[6/6] Creating commit & updating ref...');
    const CHUNK = 100;
    let currentBase: string | null = baseTreeSha;
    let newTreeSha: string | null = null;
    for (let i = 0; i < treeItems.length; i += CHUNK) {
      const slice = treeItems.slice(i, i + CHUNK);
      try {
        newTreeSha = await createTree(currentBase, slice);
      } catch (err) {
        errs.push(`  chunk ${i / CHUNK + 1} failed (${slice.length} items). First path: ${slice[0]?.path}`);
        throw err;
      }
      currentBase = newTreeSha;
      log(`  chunk ${i / CHUNK + 1}: ${slice.length} items -> tree ${newTreeSha.slice(0, 7)}`);
    }
    if (!newTreeSha) newTreeSha = await createTree(baseTreeSha, []);
    const newCommitSha = await createCommit(newTreeSha, headSha, message);
    await updateRef(newCommitSha);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('========================================');
    log('  Sync Complete');
    log(`  Commit: ${newCommitSha.slice(0, 7)}`);
    log(`  Files:  +${toUpload.filter((f) => f.isNew).length} new, ~${toUpload.filter((f) => !f.isNew).length} modified, -${deleted.length} deleted`);
    log(`  Time:   ${elapsed}s`);
    log(`  URL:    https://github.com/${repoSlug}/commit/${newCommitSha}`);
    log('========================================');

    return { exitCode: 0, stdout: logs.join('\n'), stderr: errs.join('\n'), timedOut: false, commitSha: newCommitSha };
  } catch (err) {
    const timedOut = err instanceof SyncTimeoutError;
    const messageText = err instanceof Error ? err.message : String(err);
    errs.push(`Fatal error: ${messageText}`);
    return {
      exitCode: timedOut ? -1 : 1,
      stdout: logs.join('\n'),
      stderr: errs.join('\n'),
      timedOut,
      commitSha: null,
    };
  }
}
