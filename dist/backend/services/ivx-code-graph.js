/**
 * IVX Code Causal Graph — repo-wide import-dependency reasoning.
 *
 * The code index (`ivx-code-index`) answers "what exists?". This module answers
 * "what depends on what?" — the causal layer the agent needs to reason about
 * blast radius before proposing a change:
 *
 *   - nodes        → every TS/TSX/JS source file
 *   - edges        → resolved relative-import edges (from → to)
 *   - dependents   → reverse edges (who imports me)
 *   - blastRadius  → transitive set of files affected if a file changes
 *   - hotspots     → files with the most dependents (highest-risk to touch)
 *   - cycles       → import cycles (refactor risk)
 *
 * Only intra-repo relative imports are graphed; bare package imports are counted
 * but not turned into edges (they're external). Persisted to
 * logs/audit/code-graph.json so it survives restarts and serves instantly.
 *
 * Read-only: walks and reads source files, never mutates them.
 */
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GRAPH_FILE = path.join(SERVER_ROOT, 'logs', 'audit', 'code-graph.json');
const IGNORE_DIRS = new Set([
    'node_modules', '.git', '.expo', 'dist', 'build', 'tmp', 'core',
    '.rork', '.next', 'coverage', '.turbo', '.cache', 'logs', 'ios', 'android',
]);
const GRAPH_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const MAX_FILE_BYTES = 512 * 1024;
const MAX_BLAST_NODES = 2000;
export const IVX_CODE_GRAPH_MARKER = 'ivx-code-graph-2026-05-29';
async function* walk(dir) {
    let entries;
    try {
        entries = await readdir(dir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        if (entry.name.startsWith('.') && entry.name !== '.github')
            continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (IGNORE_DIRS.has(entry.name))
                continue;
            yield* walk(full);
        }
        else if (entry.isFile()) {
            if (GRAPH_EXTS.includes(path.extname(entry.name)))
                yield full;
        }
    }
}
const IMPORT_RE = /(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|import\(\s*['"]([^'"]+)['"]\s*\)/g;
function extractSpecifiers(source) {
    const out = [];
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(source)) !== null) {
        const spec = match[1] ?? match[2] ?? match[3];
        if (spec)
            out.push(spec);
    }
    return out;
}
/** Resolve a relative import specifier to a concrete repo file, if possible. */
async function resolveRelative(fromAbs, spec, fileSet) {
    if (!spec.startsWith('.'))
        return null;
    const baseDir = path.dirname(fromAbs);
    const target = path.resolve(baseDir, spec);
    const candidates = [target];
    for (const ext of RESOLVE_EXTS)
        candidates.push(target + ext);
    for (const ext of RESOLVE_EXTS)
        candidates.push(path.join(target, 'index' + ext));
    for (const cand of candidates) {
        const rel = path.relative(SERVER_ROOT, cand).replace(/\\/g, '/');
        if (fileSet.has(rel))
            return rel;
    }
    // Last resort: probe filesystem (handles odd extensions). Only accept a hit
    // that is actually a tracked graph node, so downstream edge maps always exist.
    for (const cand of candidates) {
        try {
            const info = await stat(cand);
            if (info.isFile()) {
                const rel = path.relative(SERVER_ROOT, cand).replace(/\\/g, '/');
                if (fileSet.has(rel))
                    return rel;
            }
        }
        catch { /* not here */ }
    }
    return null;
}
/** Build the import-dependency graph by walking and parsing the workspace. */
export async function buildCodeGraph() {
    const start = Date.now();
    // Pass 1: collect every graphable file (relative paths).
    const absFiles = [];
    for await (const file of walk(SERVER_ROOT))
        absFiles.push(file);
    const relFiles = absFiles.map((f) => path.relative(SERVER_ROOT, f).replace(/\\/g, '/'));
    const fileSet = new Set(relFiles);
    const importsOf = new Map();
    const dependentsOf = new Map();
    const externalCount = new Map();
    const edges = [];
    let externalEdges = 0;
    for (const rel of relFiles) {
        importsOf.set(rel, new Set());
        dependentsOf.set(rel, new Set());
        externalCount.set(rel, 0);
    }
    // Pass 2: parse imports + resolve edges.
    for (let i = 0; i < absFiles.length; i++) {
        const abs = absFiles[i];
        const rel = relFiles[i];
        let info;
        try {
            info = await stat(abs);
        }
        catch {
            continue;
        }
        if (info.size > MAX_FILE_BYTES)
            continue;
        let content = '';
        try {
            content = await readFile(abs, 'utf8');
        }
        catch {
            continue;
        }
        for (const spec of extractSpecifiers(content)) {
            if (spec.startsWith('.')) {
                const resolved = await resolveRelative(abs, spec, fileSet);
                const fromImports = importsOf.get(rel);
                const toDependents = resolved ? dependentsOf.get(resolved) : undefined;
                if (resolved && resolved !== rel && fromImports && toDependents) {
                    if (!fromImports.has(resolved)) {
                        fromImports.add(resolved);
                        toDependents.add(rel);
                        edges.push({ from: rel, to: resolved });
                    }
                }
            }
            else {
                externalCount.set(rel, (externalCount.get(rel) ?? 0) + 1);
                externalEdges += 1;
            }
        }
    }
    const nodes = relFiles.map((rel) => ({
        file: rel,
        imports: importsOf.get(rel).size,
        dependents: dependentsOf.get(rel).size,
        externalImports: externalCount.get(rel) ?? 0,
    })).sort((a, b) => a.file.localeCompare(b.file));
    const hotspots = [...nodes]
        .filter((n) => n.dependents > 0)
        .sort((a, b) => b.dependents - a.dependents)
        .slice(0, 25)
        .map((n) => ({ file: n.file, dependents: n.dependents }));
    const cycles = detectCycles(importsOf);
    return {
        marker: IVX_CODE_GRAPH_MARKER,
        generatedAt: new Date().toISOString(),
        root: SERVER_ROOT,
        durationMs: Date.now() - start,
        totals: {
            nodes: nodes.length,
            edges: edges.length,
            externalEdges,
            cycles: cycles.length,
        },
        nodes,
        edges,
        hotspots,
        cycles,
    };
}
/** Detect a bounded number of import cycles via DFS (Tarjan-lite, capped). */
function detectCycles(importsOf) {
    const cycles = [];
    const seenSignatures = new Set();
    const visited = new Set();
    const stack = [];
    const onStack = new Set();
    const MAX_CYCLES = 50;
    function dfs(node) {
        if (cycles.length >= MAX_CYCLES)
            return;
        visited.add(node);
        stack.push(node);
        onStack.add(node);
        for (const next of importsOf.get(node) ?? []) {
            if (cycles.length >= MAX_CYCLES)
                break;
            if (onStack.has(next)) {
                const idx = stack.indexOf(next);
                if (idx >= 0) {
                    const cycle = stack.slice(idx);
                    const sig = [...cycle].sort().join('|');
                    if (!seenSignatures.has(sig)) {
                        seenSignatures.add(sig);
                        cycles.push([...cycle, next]);
                    }
                }
            }
            else if (!visited.has(next)) {
                dfs(next);
            }
        }
        stack.pop();
        onStack.delete(node);
    }
    for (const node of importsOf.keys()) {
        if (!visited.has(node))
            dfs(node);
        if (cycles.length >= MAX_CYCLES)
            break;
    }
    return cycles;
}
/** Build the graph and persist it to disk. */
export async function rebuildCodeGraph() {
    const graph = await buildCodeGraph();
    try {
        await mkdir(path.dirname(GRAPH_FILE), { recursive: true });
        await writeFile(GRAPH_FILE, JSON.stringify(graph, null, 2), 'utf8');
    }
    catch { /* best-effort */ }
    return graph;
}
/** Read the persisted graph, or build a fresh one if none exists yet. */
export async function getCodeGraph() {
    try {
        const raw = await readFile(GRAPH_FILE, 'utf8');
        return { graph: JSON.parse(raw), cached: true };
    }
    catch {
        return { graph: await rebuildCodeGraph(), cached: false };
    }
}
/**
 * Compute the blast radius of changing `file`: the transitive closure of files
 * that (directly or indirectly) import it. This is the causal-reasoning answer
 * to "what could this change break?".
 */
export async function computeBlastRadius(file) {
    const { graph } = await getCodeGraph();
    const target = file.replace(/\\/g, '/').replace(/^\.\//, '');
    const node = graph.nodes.find((n) => n.file === target || n.file.endsWith('/' + target));
    if (!node) {
        return { file: target, found: false, directDependents: [], affected: [], affectedCount: 0, truncated: false };
    }
    const resolved = node.file;
    // Build reverse adjacency from edges.
    const reverse = new Map();
    for (const edge of graph.edges) {
        if (!reverse.has(edge.to))
            reverse.set(edge.to, []);
        reverse.get(edge.to).push(edge.from);
    }
    const direct = reverse.get(resolved) ?? [];
    const affected = new Set();
    const queue = [...direct];
    let truncated = false;
    while (queue.length > 0) {
        if (affected.size >= MAX_BLAST_NODES) {
            truncated = true;
            break;
        }
        const current = queue.shift();
        if (affected.has(current))
            continue;
        affected.add(current);
        for (const dep of reverse.get(current) ?? []) {
            if (!affected.has(dep))
                queue.push(dep);
        }
    }
    return {
        file: resolved,
        found: true,
        directDependents: [...direct].sort(),
        affected: [...affected].sort(),
        affectedCount: affected.size,
        truncated,
    };
}
export async function getCodeGraphSummary() {
    try {
        const raw = await readFile(GRAPH_FILE, 'utf8');
        const graph = JSON.parse(raw);
        return {
            marker: graph.marker,
            generatedAt: graph.generatedAt,
            totals: graph.totals,
            hotspots: graph.hotspots.slice(0, 10),
            available: true,
        };
    }
    catch {
        return { marker: IVX_CODE_GRAPH_MARKER, generatedAt: null, totals: null, hotspots: [], available: false };
    }
}
