import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, readFile, access, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { withIsolatedCoderWorkspace, type CoderWorkspaceEvidence } from './ivx-coder-workspace';

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

test('two independent repairs retain overlapping workspace receipts and exact content hashes', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'ivx-source-proof-'));
  const receipts: CoderWorkspaceEvidence[] = [];
  const roots: string[] = [];
  let release!: () => void;
  const bothRunning = new Promise<void>(resolve => { release = resolve; });
  const sha = (value: string) => createHash('sha256').update(value).digest('hex');
  try {
    await writeFile(path.join(source, 'first.ts'), 'first original');
    await writeFile(path.join(source, 'second.ts'), 'second original');
    await writeFile(path.join(source, '.env'), 'fixture secret');
    await Promise.all(['first', 'second'].map(name => withIsolatedCoderWorkspace(source, async root => {
      roots.push(root);
      if (roots.length === 2) release();
      await bothRunning;
      expect(receipts.filter(row => row.phase === 'READY')).toHaveLength(2);
      await writeFile(path.join(root, `${name}.ts`), `${name} changed`);
      return name;
    }, async evidence => { receipts.push(evidence); })));
    const finished = receipts.filter(row => row.phase === 'FINISHED');
    expect(finished).toHaveLength(2);
    expect(new Set(finished.map(row => row.workspaceId)).size).toBe(2);
    expect(Math.max(...finished.map(row => Date.parse(row.startedAt))))
      .toBeLessThanOrEqual(Math.min(...finished.map(row => Date.parse(row.finishedAt!))));
    for (const row of finished) {
      expect(row.cleanup).toBe('removed');
      expect(row.outcome).toBe('returned');
      expect(row.sourceUnchanged).toBe(true);
      expect(row.sourceFileCount).toBe(2);
      expect(row.sourceBeforeSha256).toBe(row.snapshotBeforeSha256);
      expect(row.sourceBeforeSha256).toBe(row.sourceAfterSha256);
      expect(row.snapshotAfterSha256).not.toBe(row.snapshotBeforeSha256);
      expect(row.changedFiles).toHaveLength(1);
      const file = row.changedFiles[0]!;
      const name = file.path.replace('.ts', '');
      expect(file.beforeSha256).toBe(sha(`${name} original`));
      expect(file.afterSha256).toBe(sha(`${name} changed`));
      await expect(access(path.join(tmpdir(), row.workspaceId))).rejects.toThrow();
    }
    expect(JSON.stringify(receipts)).not.toContain('fixture secret');
    expect(JSON.stringify(receipts)).not.toContain('.env');
    expect(await readFile(path.join(source, 'first.ts'), 'utf8')).toBe('first original');
    expect(await readFile(path.join(source, 'second.ts'), 'utf8')).toBe('second original');
  } finally { release(); await rm(source, { recursive: true, force: true }); }
});

test('failed receipt persistence prevents execution and cleanup is still recorded', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'ivx-source-proof-'));
  const receipts: CoderWorkspaceEvidence[] = [];
  let ran = false;
  try {
    await writeFile(path.join(source, 'source.ts'), 'original');
    await expect(withIsolatedCoderWorkspace(source, async () => { ran = true; }, async evidence => {
      receipts.push(evidence);
      if (evidence.phase === 'READY') throw new Error('durable receipt rejected');
    })).rejects.toThrow('durable receipt rejected');
    expect(ran).toBe(false);
    expect(receipts.at(-1)?.cleanup).toBe('removed');
    expect(receipts.at(-1)?.outcome).toBeNull();
    expect(receipts.at(-1)?.sourceUnchanged).toBeNull();
  } finally { await rm(source, { recursive: true, force: true }); }
});

test('failed execution keeps changed-file evidence and removes its private workspace', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'ivx-source-proof-'));
  const receipts: CoderWorkspaceEvidence[] = [];
  try {
    await writeFile(path.join(source, 'source.ts'), 'original');
    await expect(withIsolatedCoderWorkspace(source, async root => {
      await writeFile(path.join(root, 'created.ts'), 'new');
      await rm(path.join(root, 'source.ts'));
      throw new Error('validation failed');
    }, async evidence => { receipts.push(evidence); })).rejects.toThrow('validation failed');
    const final = receipts.at(-1)!;
    expect(final.outcome).toBe('threw');
    expect(final.cleanup).toBe('removed');
    expect(final.sourceUnchanged).toBe(true);
    expect(final.changedFiles.find(row => row.path === 'created.ts')?.beforeSha256).toBeNull();
    expect(final.changedFiles.find(row => row.path === 'source.ts')?.afterSha256).toBeNull();
    await expect(access(path.join(tmpdir(), final.workspaceId))).rejects.toThrow();
  } finally { await rm(source, { recursive: true, force: true }); }
});

test('a source change is reported explicitly instead of certifying isolation', async () => {
  const source = await mkdtemp(path.join(tmpdir(), 'ivx-source-proof-'));
  const receipts: CoderWorkspaceEvidence[] = [];
  try {
    await writeFile(path.join(source, 'source.ts'), 'original');
    await expect(withIsolatedCoderWorkspace(source, async () => {
      await writeFile(path.join(source, 'source.ts'), 'external change');
    }, async evidence => { receipts.push(evidence); })).rejects.toThrow('CODER_SOURCE_CHANGED_DURING_EXECUTION');
    expect(receipts.at(-1)?.sourceUnchanged).toBe(false);
    expect(receipts.at(-1)?.cleanup).toBe('removed');
  } finally { await rm(source, { recursive: true, force: true }); }
});
