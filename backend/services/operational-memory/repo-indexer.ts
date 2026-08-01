/**
 * IVX Operational Memory — repo-wide architecture indexer.
 * Walks the workspace, summarizes top-level surfaces, and records architecture
 * snapshots into the vector memory store. Skips heavy / generated dirs.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { upsertMemory } from './vector-memory';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const IGNORE_DIRS = new Set<string>([
  'node_modules', '.git', '.expo', 'dist', 'build', 'tmp', 'core',
  '.next', 'coverage', '.turbo', '.cache', 'logs',
]);

const SOURCE_EXTS = new Set<string>(['.ts', '.tsx', '.js', '.jsx', '.sql', '.md', '.json']);
const MAX_FILE_BYTES = 256 * 1024;
const MAX_CONTENT_CHARS = 6000;

export type RepoIndexEntry = {
  relativePath: string;
  kind: 'route' | 'component' | 'service' | 'backend' | 'migration' | 'config' | 'doc' | 'other';
  summary: string;
  bytes: number;
  loc: number;
};

function classify(rel: string): RepoIndexEntry['kind'] {
  if (rel.startsWith('expo/app/')) return 'route';
  if (rel.startsWith('expo/components/')) return 'component';
  if (rel.startsWith('expo/src/') || rel.startsWith('expo/lib/')) return 'service';
  if (rel.startsWith('backend/')) return 'backend';
  if (rel.endsWith('.sql')) return 'migration';
  if (rel.endsWith('.md')) return 'doc';
  if (rel === 'package.json' || rel.endsWith('config.ts') || rel.endsWith('config.js') || rel.endsWith('.json')) return 'config';
  return 'other';
}

async function* walk(dir: string): AsyncGenerator<string> {
  let entries;
  try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.github') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      yield* walk(full);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name);
      if (!SOURCE_EXTS.has(ext)) continue;
      yield full;
    }
  }
}

function summarizeContent(content: string, kind: RepoIndexEntry['kind']): string {
  const lines = content.split(/\r?\n/);
  const exports: string[] = [];
  const imports: string[] = [];
  for (const line of lines.slice(0, 200)) {
    const trimmed = line.trim();
    if (trimmed.startsWith('import ') && imports.length < 8) imports.push(trimmed.slice(0, 200));
    if (/^export\s+(default|const|function|class|type|interface|async)/.test(trimmed) && exports.length < 12) {
      exports.push(trimmed.slice(0, 200));
    }
  }
  const head = content.slice(0, 800);
  return [
    `kind=${kind}`,
    imports.length ? `imports:\n${imports.join('\n')}` : '',
    exports.length ? `exports:\n${exports.join('\n')}` : '',
    `head:\n${head}`,
  ].filter(Boolean).join('\n\n').slice(0, MAX_CONTENT_CHARS);
}

/**
 * Build a list of indexable repo entries (does not write to memory).
 */
export async function buildRepoIndex(): Promise<RepoIndexEntry[]> {
  const out: RepoIndexEntry[] = [];
  for await (const file of walk(SERVER_ROOT)) {
    const rel = path.relative(SERVER_ROOT, file).replace(/\\/g, '/');
    let info;
    try { info = await stat(file); } catch { continue; }
    if (info.size > MAX_FILE_BYTES) continue;
    let content = '';
    try { content = await readFile(file, 'utf8'); } catch { continue; }
    const kind = classify(rel);
    out.push({
      relativePath: rel,
      kind,
      summary: summarizeContent(content, kind),
      bytes: info.size,
      loc: content.split(/\r?\n/).length,
    });
  }
  return out;
}

export type IndexRunResult = {
  ok: boolean;
  scanned: number;
  indexed: number;
  skipped: number;
  durationMs: number;
  errors: string[];
};

/**
 * Walk the repo, write each file's summary into the operational memory store
 * under category 'repo_index', and a top-level architecture summary under
 * 'architecture'. Bounded by maxFiles to keep cost predictable.
 */
export async function runRepoIndex(maxFiles = 400): Promise<IndexRunResult> {
  const start = Date.now();
  const entries = await buildRepoIndex();
  const cap = Math.min(Math.max(Math.floor(maxFiles), 10), 2000);
  const target = entries.slice(0, cap);
  const errors: string[] = [];
  let indexed = 0;
  for (const entry of target) {
    try {
      await upsertMemory({
        category: 'repo_index',
        title: entry.relativePath,
        content: entry.summary,
        metadata: { kind: entry.kind, bytes: entry.bytes, loc: entry.loc },
        source: 'repo_index',
        refId: entry.relativePath,
      });
      indexed += 1;
    } catch (error) {
      errors.push(`${entry.relativePath}: ${error instanceof Error ? error.message : 'unknown'}`);
      if (errors.length > 25) break;
    }
  }

  // Top-level architecture summary
  try {
    const byKind = entries.reduce<Record<string, number>>((acc, e) => { acc[e.kind] = (acc[e.kind] ?? 0) + 1; return acc; }, {});
    await upsertMemory({
      category: 'architecture',
      title: 'Repo architecture snapshot',
      content: `Total source files scanned: ${entries.length}\nBy kind: ${JSON.stringify(byKind)}\nIndexed entries: ${indexed}/${target.length}`,
      metadata: { byKind, totalScanned: entries.length, indexed },
      source: 'repo_index',
      refId: 'architecture-summary',
    });
  } catch (error) {
    errors.push(`architecture-summary: ${error instanceof Error ? error.message : 'unknown'}`);
  }

  return {
    ok: errors.length === 0,
    scanned: entries.length,
    indexed,
    skipped: Math.max(0, entries.length - target.length),
    durationMs: Date.now() - start,
    errors: errors.slice(0, 10),
  };
}
