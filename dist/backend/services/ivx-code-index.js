/**
 * IVX repo-wide structured code index.
 *
 * Walks the workspace once and extracts a structured, queryable map of the
 * codebase that the autonomous agent can reason over without re-reading every
 * file each time:
 *   - files        → every source file with kind + LOC
 *   - routes       → backend HTTP routes registered in hono.ts (method + path)
 *   - appScreens   → expo router screens under expo/app
 *   - services     → backend service modules under backend/services
 *   - apis         → backend API handler modules under backend/api
 *   - schemas      → SQL migrations / schema docs (table names)
 *   - dependencies → npm dependencies from package.json files
 *
 * The index is persisted to `logs/audit/code-index.json` so it survives a
 * process restart and can be served instantly. Rebuild is explicit (cheap, but
 * bounded) so the agent controls when to refresh it.
 */
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const INDEX_FILE = path.join(SERVER_ROOT, 'logs', 'audit', 'code-index.json');
const IGNORE_DIRS = new Set([
    'node_modules', '.git', '.expo', 'dist', 'build', 'tmp', 'core',
    '.rork', '.next', 'coverage', '.turbo', '.cache', 'logs', 'ios', 'android',
]);
const SOURCE_EXTS = new Set(['.ts', '.tsx', '.js', '.jsx', '.sql', '.md', '.json']);
const MAX_FILE_BYTES = 512 * 1024;
export const IVX_CODE_INDEX_MARKER = 'ivx-code-index-2026-05-28';
function classify(rel) {
    if (rel.startsWith('expo/app/'))
        return 'app-screen';
    if (rel.startsWith('expo/components/'))
        return 'component';
    if (rel.startsWith('expo/src/') || rel.startsWith('expo/lib/'))
        return 'frontend-service';
    if (rel.startsWith('backend/api/'))
        return 'backend-api';
    if (rel.startsWith('backend/services/'))
        return 'backend-service';
    if (rel.startsWith('backend/'))
        return 'backend-core';
    if (rel.endsWith('.sql'))
        return 'migration';
    if (rel.endsWith('.md'))
        return 'doc';
    if (rel.endsWith('.json') || rel.endsWith('config.ts') || rel.endsWith('config.js'))
        return 'config';
    return 'other';
}
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
            if (!SOURCE_EXTS.has(path.extname(entry.name)))
                continue;
            yield full;
        }
    }
}
/** Extract backend HTTP routes registered as `app.<method>('<path>'` in hono.ts. */
function extractRoutes(honoSource) {
    const routes = [];
    const re = /app\.(get|post|put|patch|delete|options|head|all)\(\s*['"`]([^'"`]+)['"`]/g;
    let match;
    while ((match = re.exec(honoSource)) !== null) {
        const method = (match[1] ?? '').toUpperCase();
        const routePath = match[2] ?? '';
        if (routePath) {
            routes.push({ method, path: routePath });
        }
    }
    // De-duplicate identical method+path pairs.
    const seen = new Set();
    return routes.filter((route) => {
        const key = `${route.method} ${route.path}`;
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    }).sort((a, b) => a.path.localeCompare(b.path));
}
/** Extract table names from a SQL file (CREATE TABLE [IF NOT EXISTS] <name>). */
function extractSqlTables(sql) {
    const tables = new Set();
    const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?([a-zA-Z0-9_.]+)["`]?/gi;
    let match;
    while ((match = re.exec(sql)) !== null) {
        const name = (match[1] ?? '').replace(/["`]/g, '');
        if (name)
            tables.add(name);
    }
    return Array.from(tables).sort();
}
function parseDependencies(manifestRel, raw) {
    let json;
    try {
        json = JSON.parse(raw);
    }
    catch {
        return [];
    }
    const out = [];
    const collect = (field, dev) => {
        const block = json[field];
        if (block && typeof block === 'object' && !Array.isArray(block)) {
            for (const [name, version] of Object.entries(block)) {
                out.push({ manifest: manifestRel, name, version: typeof version === 'string' ? version : '*', dev });
            }
        }
    };
    collect('dependencies', false);
    collect('devDependencies', true);
    return out;
}
/** Build the structured code index by walking the workspace. */
export async function buildCodeIndex() {
    const start = Date.now();
    const files = [];
    const services = [];
    const apis = [];
    const appScreens = [];
    const schemas = [];
    const dependencies = [];
    let routes = [];
    for await (const file of walk(SERVER_ROOT)) {
        const rel = path.relative(SERVER_ROOT, file).replace(/\\/g, '/');
        let info;
        try {
            info = await stat(file);
        }
        catch {
            continue;
        }
        const kind = classify(rel);
        let content = '';
        if (info.size <= MAX_FILE_BYTES) {
            try {
                content = await readFile(file, 'utf8');
            }
            catch {
                content = '';
            }
        }
        const loc = content ? content.split(/\r?\n/).length : 0;
        files.push({ relativePath: rel, kind, loc, bytes: info.size });
        if (kind === 'backend-service')
            services.push(rel);
        if (kind === 'backend-api')
            apis.push(rel);
        if (kind === 'app-screen' && (rel.endsWith('.tsx') || rel.endsWith('.jsx')))
            appScreens.push(rel);
        if (rel === 'backend/hono.ts' && content)
            routes = extractRoutes(content);
        if (kind === 'migration' && content) {
            const tables = extractSqlTables(content);
            if (tables.length > 0)
                schemas.push({ source: rel, tables });
        }
        if (path.basename(rel) === 'package.json' && content) {
            dependencies.push(...parseDependencies(rel, content));
        }
    }
    const filesByKind = files.reduce((acc, entry) => {
        acc[entry.kind] = (acc[entry.kind] ?? 0) + 1;
        return acc;
    }, {});
    return {
        marker: IVX_CODE_INDEX_MARKER,
        generatedAt: new Date().toISOString(),
        root: SERVER_ROOT,
        durationMs: Date.now() - start,
        totals: {
            files: files.length,
            routes: routes.length,
            appScreens: appScreens.length,
            services: services.length,
            apis: apis.length,
            schemas: schemas.length,
            dependencies: dependencies.length,
        },
        filesByKind,
        files: files.sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
        routes,
        appScreens: appScreens.sort(),
        services: services.sort(),
        apis: apis.sort(),
        schemas,
        dependencies,
    };
}
/** Build the index and persist it to disk. */
export async function rebuildCodeIndex() {
    const index = await buildCodeIndex();
    try {
        await mkdir(path.dirname(INDEX_FILE), { recursive: true });
        await writeFile(INDEX_FILE, JSON.stringify(index, null, 2), 'utf8');
    }
    catch {
        // best-effort persistence; the freshly built index is still returned.
    }
    return index;
}
/** Read the persisted index, or build a fresh one if none exists yet. */
export async function getCodeIndex() {
    try {
        const raw = await readFile(INDEX_FILE, 'utf8');
        return { index: JSON.parse(raw), cached: true };
    }
    catch {
        return { index: await rebuildCodeIndex(), cached: false };
    }
}
export async function getCodeIndexSummary() {
    try {
        const raw = await readFile(INDEX_FILE, 'utf8');
        const index = JSON.parse(raw);
        return {
            marker: index.marker,
            generatedAt: index.generatedAt,
            totals: index.totals,
            filesByKind: index.filesByKind,
            available: true,
        };
    }
    catch {
        return {
            marker: IVX_CODE_INDEX_MARKER,
            generatedAt: null,
            totals: null,
            filesByKind: {},
            available: false,
        };
    }
}
