import { cp, lstat, mkdtemp, open, readdir, rm, symlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXCLUDED = new Set(['node_modules', 'logs', 'tmp', 'coverage', 'dist', 'build']);

export type CoderWorkspaceEvidence = {
  schema: 'ivx-coder-workspace-v1';
  workspaceId: string;
  phase: 'READY' | 'FINISHED';
  startedAt: string;
  finishedAt: string | null;
  cleanup: 'pending' | 'removed' | 'failed';
  outcome: 'returned' | 'threw' | null;
  scope: 'source_snapshot_excluding_dependencies_and_generated_files';
  sourceBeforeSha256: string;
  sourceAfterSha256: string | null;
  snapshotBeforeSha256: string;
  snapshotAfterSha256: string | null;
  sourceUnchanged: boolean | null;
  sourceFileCount: number;
  changedFiles: { path: string; beforeSha256: string | null; afterSha256: string | null }[];
};

function included(relative: string): boolean {
  return !relative.split(path.sep).some(part => EXCLUDED.has(part) || (part.startsWith('.') && part !== '.github'));
}

// Hash regular source files only. Never copy content, absolute source paths or
// excluded credential/dependency files into a durable job receipt.
async function manifest(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const buffer = Buffer.allocUnsafe(64 * 1024);
  async function visit(relative: string): Promise<void> {
    for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
      const file = path.join(relative, entry.name);
      if (!included(file) || entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await visit(file);
      else if (entry.isFile()) {
        const hash = createHash('sha256');
        const handle = await open(path.join(root, file), constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          while (true) {
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
            if (bytesRead === 0) break;
            hash.update(buffer.subarray(0, bytesRead));
          }
        } finally { await handle.close(); }
        files.set(file.split(path.sep).join('/'), hash.digest('hex'));
      }
    }
  }
  await visit('');
  return files;
}

function digest(files: Map<string, string>): string {
  return createHash('sha256').update(JSON.stringify([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))).digest('hex');
}

/** Each real coder receives a private source snapshot. Successful patches and
 * failed-attempt rollback must never mutate another job or the running API. */
export async function withIsolatedCoderWorkspace<T>(sourceRoot: string, run: (root: string) => Promise<T>,
  onEvidence?: (evidence: CoderWorkspaceEvidence) => Promise<void>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'ivx-coder-'));
  const startedAt = new Date().toISOString();
  let evidence: CoderWorkspaceEvidence | undefined;
  let result: T | undefined;
  let failure: unknown;
  let failed = false;
  try {
    const sourceBefore = await manifest(sourceRoot);
    await cp(sourceRoot, root, {
      recursive: true, mode: constants.COPYFILE_FICLONE,
      filter: async source => {
        const relative = path.relative(sourceRoot, source);
        if (!relative) return true;
        if (!included(relative)) return false;
        // A repository symlink must not import external credentials or provide
        // a write path back to the live source. Dependencies are mounted below.
        return !(await lstat(source)).isSymbolicLink();
      },
    });
    const dependencies = path.join(sourceRoot, 'node_modules');
    try {
      await lstat(dependencies);
      await symlink(dependencies, path.join(root, 'node_modules'), 'dir');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const snapshotBefore = await manifest(root);
    evidence = {
      schema: 'ivx-coder-workspace-v1', workspaceId: path.basename(root), phase: 'READY', startedAt,
      finishedAt: null, cleanup: 'pending', outcome: null,
      scope: 'source_snapshot_excluding_dependencies_and_generated_files',
      sourceBeforeSha256: digest(sourceBefore), sourceAfterSha256: null,
      snapshotBeforeSha256: digest(snapshotBefore), snapshotAfterSha256: null,
      sourceUnchanged: null, sourceFileCount: sourceBefore.size, changedFiles: [],
    };
    if (evidence.sourceBeforeSha256 !== evidence.snapshotBeforeSha256) throw new Error('CODER_SNAPSHOT_CHANGED_DURING_COPY');
    // The worker awaits its fenced durable write before any model or patch work.
    await onEvidence?.(structuredClone(evidence));
    try {
      result = await run(root);
      evidence.outcome = 'returned';
    } catch (error) {
      evidence.outcome = 'threw';
      failed = true; failure = error;
    }
    const snapshotAfter = await manifest(root);
    evidence.snapshotAfterSha256 = digest(snapshotAfter);
    evidence.sourceAfterSha256 = digest(await manifest(sourceRoot));
    evidence.sourceUnchanged = evidence.sourceBeforeSha256 === evidence.sourceAfterSha256;
    evidence.changedFiles = [...new Set([...snapshotBefore.keys(), ...snapshotAfter.keys()])].sort()
      .filter(file => snapshotBefore.get(file) !== snapshotAfter.get(file))
      .map(file => ({ path: file, beforeSha256: snapshotBefore.get(file) ?? null, afterSha256: snapshotAfter.get(file) ?? null }));
    if (!evidence.sourceUnchanged) throw new Error('CODER_SOURCE_CHANGED_DURING_EXECUTION');
  } catch (error) {
    if (!failed) { failed = true; failure = error; }
  } finally {
    try {
      await rm(root, { recursive: true, force: true });
      if (evidence) evidence.cleanup = 'removed';
    } catch (error) {
      if (evidence) evidence.cleanup = 'failed';
      if (!failed) { failed = true; failure = error; }
    }
    if (evidence) {
      evidence.phase = 'FINISHED';
      evidence.finishedAt = new Date().toISOString();
      try { await onEvidence?.(structuredClone(evidence)); }
      catch (error) { if (!failed) { failed = true; failure = error; } }
    }
  }
  if (failed) throw failure;
  return result as T;
}
