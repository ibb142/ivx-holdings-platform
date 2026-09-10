import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withIsolatedCoderWorkspace } from './ivx-coder-workspace';

test('concurrent coders edit private snapshots without exposing credentials or contaminating source', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'ivx-source-test-'));
  const roots: string[] = [];
  try {
    await mkdir(path.join(source, 'node_modules'));
    await writeFile(path.join(source, 'source.ts'), 'original');
    await writeFile(path.join(source, '.env'), 'fixture-only');
    await symlink(path.join(source, 'source.ts'), path.join(source, 'escape.ts'));
    await Promise.all(['first', 'second'].map(value => withIsolatedCoderWorkspace(source, async root => {
      roots.push(root);
      expect(await readFile(path.join(root, 'source.ts'), 'utf8')).toBe('original');
      await writeFile(path.join(root, 'source.ts'), value);
      await Promise.resolve();
      expect(await readFile(path.join(root, 'source.ts'), 'utf8')).toBe(value);
      await expect(access(path.join(root, '.env'))).rejects.toThrow();
      await expect(access(path.join(root, 'escape.ts'))).rejects.toThrow();
      await access(path.join(root, 'node_modules'));
    })));
    expect(new Set(roots).size).toBe(2);
    expect(await readFile(path.join(source, 'source.ts'), 'utf8')).toBe('original');
    for (const root of roots) await expect(access(root)).rejects.toThrow();
    let failedRoot = '';
    await expect(withIsolatedCoderWorkspace(source, async root => { failedRoot = root; throw new Error('failed validation'); })).rejects.toThrow('failed validation');
    await expect(access(failedRoot)).rejects.toThrow();
  } finally { await rm(source, { recursive: true, force: true }); }
});
