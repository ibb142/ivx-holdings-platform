import { cp, lstat, mkdtemp, rm, symlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const EXCLUDED = new Set(['node_modules', 'logs', 'tmp', 'coverage', 'dist', 'build']);

/** Each real coder receives a private source snapshot. Successful patches and
 * failed-attempt rollback must never mutate another job or the running API. */
export async function withIsolatedCoderWorkspace<T>(sourceRoot: string, run: (root: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(path.join(tmpdir(), 'ivx-coder-'));
  try {
    await cp(sourceRoot, root, {
      recursive: true, mode: constants.COPYFILE_FICLONE,
      filter: async source => {
        const relative = path.relative(sourceRoot, source);
        if (!relative) return true;
        const segments = relative.split(path.sep);
        if (segments.some(part => EXCLUDED.has(part) || (part.startsWith('.') && part !== '.github'))) return false;
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
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
