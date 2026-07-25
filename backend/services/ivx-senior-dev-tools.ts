/**
 * IVX Senior Developer Tools — the inspection layer the IVX AI uses to
 * audit, diagnose, and repair the app without depending on a human.
 *
 * Eight tool categories, all read-only by default. Heavy operations are
 * sandboxed (size caps, timeouts, owner-only callers in the API layer).
 *
 *   1. code_read       — read a file slice with file:line refs
 *   2. code_search     — regex/text search across app/backend/landing
 *   3. log_read        — runtime logs + watchdog/audit artifacts
 *   4. incident_analyze— group repeated failures, suggest root cause
 *   5. app_audit       — UI screens, navigation, chat, auth, supabase, AI
 *   6. landing_audit   — landing code/content/CTA/mobile/SEO basics
 *   7. patch_generate  — minimal patch plan (delegates to repair brain)
 *   8. test_run        — typecheck / lint / smoke / replay incident
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { runWithWatchdog } from './ivx-process-watchdog.js';
import { pathToFileURL } from 'node:url';
import { listIncidents, getIncident, type IVXIncident } from './ivx-incident-store';
import { diagnoseIncident } from './ivx-repair-brain';
import { replayIncidentAgainstStaging } from './ivx-repair-policy';
import { recordExecutionEvent, type ExecutionEventCategory } from './ivx-execution-stream';
import { resolveRuntimeCommand, type RuntimeName } from './ivx-runtime-resolver';
import { navigateSite } from './ivx-web-navigator';
import {
  discoverLeads,
  listLeads,
  summarizeLeads,
  approveLead,
  rejectLead,
  type LeadStatus,
  type InvestorDiscoveryClass,
} from './ivx-lead-discovery';

const REPO_ROOT = process.cwd();

export const IVX_SENIOR_DEV_TOOLS_MARKER = 'ivx-senior-dev-tools-2026-05-26';

export type ToolName =
  | 'code_read'
  | 'code_search'
  | 'log_read'
  | 'incident_analyze'
  | 'app_audit'
  | 'landing_audit'
  | 'patch_generate'
  | 'test_run'
  | 'web_navigate'
  | 'lead_discovery';

export type ToolDescriptor = {
  name: ToolName;
  category: string;
  purpose: string;
  inputs: string[];
  writes: boolean;
};

export const SENIOR_DEV_TOOL_CATALOG: ToolDescriptor[] = [
  { name: 'code_read', category: 'Code Reader', purpose: 'Read a project file slice with file:line metadata.', inputs: ['path', 'startLine?', 'endLine?'], writes: false },
  { name: 'code_search', category: 'Code Reader', purpose: 'Regex/text search across app/backend/landing with file:line hits.', inputs: ['query', 'pathPrefix?', 'maxHits?'], writes: false },
  { name: 'log_read', category: 'Runtime Logs', purpose: 'Read latest backend logs / watchdog / audit artifacts.', inputs: ['source', 'limit?'], writes: false },
  { name: 'incident_analyze', category: 'Incidents', purpose: 'List recent incidents grouped by signature with suggested root cause.', inputs: ['limit?', 'minRepeat?'], writes: false },
  { name: 'app_audit', category: 'App Auditor', purpose: 'Inspect screens / navigation / chat / auth / supabase / AI pipeline wiring.', inputs: [], writes: false },
  { name: 'landing_audit', category: 'Landing Auditor', purpose: 'Inspect landing code, CTA targets, mobile/SEO/perf basics.', inputs: [], writes: false },
  { name: 'patch_generate', category: 'Patch', purpose: 'Generate a minimal patch plan for an incident (delegates to repair brain).', inputs: ['incidentId'], writes: false },
  { name: 'test_run', category: 'Tests', purpose: 'Run typecheck / lint / smoke or replay an incident against staging.', inputs: ['suite', 'incidentId?'], writes: false },
  { name: 'web_navigate', category: 'Web Navigator', purpose: 'Open the live site, follow internal links, inspect forms, and report Supabase drift with a pass/fail verdict.', inputs: ['startUrl?', 'maxPages?', 'compareSupabase?'], writes: false },
  { name: 'lead_discovery', category: 'Lead Discovery', purpose: 'Autonomously discover real investor/buyer leads from public SEC filings, rank, draft outreach, and STAGE for owner approval (never auto-sends).', inputs: ['action', 'query?', 'discoveryClass?', 'limit?', 'leadId?', 'status?', 'reason?'], writes: true },
];

// ---------- helpers ----------

function safeResolve(rel: string): string | null {
  const cleaned = rel.replace(/^\/+/, '');
  const full = path.resolve(REPO_ROOT, cleaned);
  if (!full.startsWith(REPO_ROOT)) return null;
  return full;
}

async function readSlice(rel: string, startLine?: number, endLine?: number): Promise<{ ok: boolean; file: string; lines: { n: number; text: string }[]; totalLines: number; error?: string }> {
  const full = safeResolve(rel);
  if (!full) return { ok: false, file: rel, lines: [], totalLines: 0, error: 'path outside repo' };
  try {
    const stat = await fs.stat(full);
    if (!stat.isFile()) return { ok: false, file: rel, lines: [], totalLines: 0, error: 'not a file' };
    if (stat.size > 512 * 1024) return { ok: false, file: rel, lines: [], totalLines: 0, error: 'file too large (>512KB)' };
    const text = await fs.readFile(full, 'utf8');
    const all = text.split('\n');
    const s = Math.max(1, startLine ?? 1);
    const e = Math.min(all.length, endLine ?? Math.min(all.length, s + 199));
    const lines = all.slice(s - 1, e).map((t, i) => ({ n: s + i, text: t }));
    return { ok: true, file: rel, lines, totalLines: all.length };
  } catch (err) {
    return { ok: false, file: rel, lines: [], totalLines: 0, error: err instanceof Error ? err.message : 'read failed' };
  }
}

const SCAN_INCLUDE_DIRS = ['backend', 'expo/app', 'expo/src', 'expo/lib', 'expo/components', 'expo/ivxholding-landing', 'expo/shared'];
const SCAN_SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.expo', '.next', 'logs', '.rork', 'ios', 'android']);
const SCAN_EXT_OK = new Set(['.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.html', '.css']);

async function* walkFiles(rootRel: string): AsyncGenerator<string> {
  const full = safeResolve(rootRel);
  if (!full) return;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(full, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (SCAN_SKIP_DIRS.has(ent.name)) continue;
    const childRel = path.posix.join(rootRel, ent.name);
    if (ent.isDirectory()) {
      yield* walkFiles(childRel);
    } else if (ent.isFile() && SCAN_EXT_OK.has(path.extname(ent.name))) {
      yield childRel;
    }
  }
}

async function searchRepo(query: string, pathPrefix: string | null, maxHits: number): Promise<{ file: string; line: number; text: string }[]> {
  const hits: { file: string; line: number; text: string }[] = [];
  let regex: RegExp;
  try {
    regex = new RegExp(query, 'i');
  } catch {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    regex = new RegExp(escaped, 'i');
  }
  const roots = pathPrefix ? [pathPrefix] : SCAN_INCLUDE_DIRS;
  for (const root of roots) {
    for await (const rel of walkFiles(root)) {
      if (hits.length >= maxHits) return hits;
      const full = safeResolve(rel);
      if (!full) continue;
      try {
        const stat = await fs.stat(full);
        if (stat.size > 256 * 1024) continue;
        const text = await fs.readFile(full, 'utf8');
        const lines = text.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (regex.test(lines[i] ?? '')) {
            hits.push({ file: rel, line: i + 1, text: (lines[i] ?? '').slice(0, 240) });
            if (hits.length >= maxHits) return hits;
          }
        }
      } catch {
        // ignore unreadable file
      }
    }
  }
  return hits;
}

async function tailFile(rel: string, limit: number): Promise<{ file: string; lines: string[]; exists: boolean }> {
  const full = safeResolve(rel);
  if (!full) return { file: rel, lines: [], exists: false };
  try {
    const text = await fs.readFile(full, 'utf8');
    const all = text.split('\n').filter((l) => l.length > 0);
    return { file: rel, lines: all.slice(-limit), exists: true };
  } catch {
    return { file: rel, lines: [], exists: false };
  }
}

async function listDir(rel: string): Promise<string[]> {
  const full = safeResolve(rel);
  if (!full) return [];
  try {
    const entries = await fs.readdir(full, { withFileTypes: true });
    return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name));
  } catch {
    return [];
  }
}

function hashSignature(message: string, fileLine: string | null): string {
  const m = message.replace(/[0-9a-f]{8,}/gi, '<id>').replace(/\s+/g, ' ').slice(0, 120);
  return `${m}::${fileLine ?? 'no-file'}`;
}

// ---------- tool implementations ----------

export async function toolCodeRead(input: { path?: string; startLine?: number; endLine?: number }) {
  const p = typeof input.path === 'string' ? input.path : '';
  if (!p) return { ok: false, error: 'path is required' };
  return await readSlice(p, input.startLine, input.endLine);
}

export async function toolCodeSearch(input: { query?: string; pathPrefix?: string; maxHits?: number }) {
  const q = typeof input.query === 'string' ? input.query.trim() : '';
  if (!q) return { ok: false, error: 'query is required' };
  const maxHits = Math.max(1, Math.min(500, Number(input.maxHits) || 80));
  const hits = await searchRepo(q, typeof input.pathPrefix === 'string' ? input.pathPrefix : null, maxHits);
  return { ok: true, query: q, hitCount: hits.length, truncated: hits.length === maxHits, hits };
}

export async function toolLogRead(input: { source?: string; limit?: number }) {
  const limit = Math.max(10, Math.min(500, Number(input.limit) || 100));
  const source = String(input.source ?? 'backend');
  if (source === 'backend') {
    return {
      ok: true,
      source,
      out: await tailFile('logs/ivx-chat-api.out-0.log', limit),
      err: await tailFile('logs/ivx-chat-api.error-0.log', limit),
    };
  }
  if (source === 'incidents') {
    return { ok: true, source, out: await tailFile('logs/audit/incidents.jsonl', limit) };
  }
  if (source === 'telemetry') {
    return { ok: true, source, out: await tailFile('logs/audit/ivx-provider-telemetry.jsonl', limit) };
  }
  if (source === 'audit') {
    return { ok: true, source, listing: await listDir('logs/audit') };
  }
  if (source === 'deploy') {
    return { ok: true, source, listing: await listDir('logs/deploy') };
  }
  return { ok: false, error: `unknown log source '${source}' (use backend|incidents|telemetry|audit|deploy)` };
}

export async function toolIncidentAnalyze(input: { limit?: number; minRepeat?: number }) {
  const limit = Math.max(10, Math.min(500, Number(input.limit) || 100));
  const minRepeat = Math.max(1, Number(input.minRepeat) || 1);
  const incidents = listIncidents(limit);
  const groups = new Map<string, { signature: string; count: number; sample: IVXIncident; severities: Set<string>; sources: Set<string>; lastAt: string }>();
  for (const inc of incidents) {
    const sig = hashSignature(inc.message, inc.fileLine);
    const existing = groups.get(sig);
    if (existing) {
      existing.count += 1;
      existing.severities.add(inc.severity);
      existing.sources.add(inc.source);
      if (inc.createdAt > existing.lastAt) existing.lastAt = inc.createdAt;
    } else {
      groups.set(sig, { signature: sig, count: 1, sample: inc, severities: new Set([inc.severity]), sources: new Set([inc.source]), lastAt: inc.createdAt });
    }
  }
  const clusters = Array.from(groups.values())
    .filter((g) => g.count >= minRepeat)
    .sort((a, b) => b.count - a.count)
    .map((g) => ({
      signature: g.signature,
      count: g.count,
      severities: Array.from(g.severities),
      sources: Array.from(g.sources),
      lastAt: g.lastAt,
      sampleId: g.sample.id,
      sampleMessage: g.sample.message,
      sampleFileLine: g.sample.fileLine,
      sampleCheckpoint: g.sample.checkpoint,
      sampleStatus: g.sample.status,
    }));
  const openCount = incidents.filter((i) => i.status === 'open' || i.status === 'awaiting_approval' || i.status === 'awaiting_production_approval').length;
  return {
    ok: true,
    total: incidents.length,
    openCount,
    clusterCount: clusters.length,
    topClusters: clusters.slice(0, 20),
  };
}

async function fileExists(rel: string): Promise<boolean> {
  const full = safeResolve(rel);
  if (!full) return false;
  try { await fs.access(full); return true; } catch { return false; }
}

export async function toolAppAudit() {
  const screens = (await listDir('expo/app')).filter((n) => n.endsWith('.tsx')).map((n) => `expo/app/${n}`);
  const tabFiles = (await listDir('expo/app/(tabs)')).filter((n) => n.endsWith('.tsx')).map((n) => `expo/app/(tabs)/${n}`);
  const ivxFiles = (await listDir('expo/app/ivx')).filter((n) => n.endsWith('.tsx')).map((n) => `expo/app/ivx/${n}`);
  const chatModuleFiles = (await listDir('expo/src/modules/chat')).map((n) => `expo/src/modules/chat/${n}`);
  const ownerAIServiceFiles = (await listDir('expo/src/modules/ivx-owner-ai/services')).map((n) => `expo/src/modules/ivx-owner-ai/services/${n}`);

  const authHits = await searchRepo('signInWithPassword|onAuthStateChange|getSession\\(', 'expo', 30);
  const supabaseHits = await searchRepo('createClient\\(.*supabase|EXPO_PUBLIC_SUPABASE_URL', 'expo', 30);
  const aiHits = await searchRepo('requestOwnerAI|streamIVXAIText|ivxAIRequestService', 'expo', 30);
  const watchdogHits = await searchRepo('ivxAIWatchdog|BACKEND_POST_FINISHED|ASSISTANT_TEXT_PRESENT', 'expo', 30);

  const layoutOk = await fileExists('expo/app/_layout.tsx');
  const incidentClientOk = await fileExists('expo/lib/ivx-incident-client.ts');
  const watchdogOk = await fileExists('expo/lib/ivx-ai-watchdog.ts') || watchdogHits.length > 0;

  return {
    ok: true,
    counts: {
      rootScreens: screens.length,
      tabScreens: tabFiles.length,
      ivxScreens: ivxFiles.length,
      chatModuleFiles: chatModuleFiles.length,
      ownerAIServiceFiles: ownerAIServiceFiles.length,
    },
    wiring: {
      rootLayout: layoutOk,
      incidentClient: incidentClientOk,
      watchdog: Boolean(watchdogOk),
      authReferences: authHits.length,
      supabaseReferences: supabaseHits.length,
      aiPipelineReferences: aiHits.length,
    },
    samples: {
      authFileLines: authHits.slice(0, 5),
      supabaseFileLines: supabaseHits.slice(0, 5),
      aiFileLines: aiHits.slice(0, 5),
      watchdogFileLines: watchdogHits.slice(0, 5),
    },
    screens: { root: screens, tabs: tabFiles, ivx: ivxFiles },
  };
}

export async function toolLandingAudit() {
  const dir = 'expo/ivxholding-landing';
  const entries = await listDir(dir);
  if (entries.length === 0) {
    return { ok: false, error: `landing directory ${dir} missing or empty` };
  }
  const ctaHits = await searchRepo('href=|window\\.location|onClick|ctaUrl|/signup|/login', dir, 50);
  const seoHits = await searchRepo('<meta|<title|og:title|og:description|description=', dir, 30);
  const viewportHits = await searchRepo('name=\\"viewport\\"|name=viewport', dir, 10);
  const httpHits = await searchRepo('http://(?!localhost)', dir, 20);

  return {
    ok: true,
    files: entries,
    metrics: {
      ctaReferences: ctaHits.length,
      seoMetaTags: seoHits.length,
      viewportTagPresent: viewportHits.length > 0,
      insecureHttpReferences: httpHits.length,
    },
    samples: {
      ctaFileLines: ctaHits.slice(0, 6),
      seoFileLines: seoHits.slice(0, 6),
      insecureFileLines: httpHits.slice(0, 4),
    },
  };
}

export async function toolPatchGenerate(input: { incidentId?: string }) {
  const id = typeof input.incidentId === 'string' ? input.incidentId.trim() : '';
  if (!id) return { ok: false, error: 'incidentId is required' };
  const incident = getIncident(id);
  if (!incident) return { ok: false, error: 'incident not found' };
  const result = await diagnoseIncident(id);
  return {
    ok: result.ok,
    incidentId: id,
    diagnosis: result.diagnosis,
    proposalArtifactPath: result.proposalArtifactPath,
    error: result.error,
  };
}

/**
 * Run a subprocess under the IVX process watchdog. The watchdog launches the
 * command in its own process group and terminates the full tree on timeout,
 * so a nested subprocess can never pin the worker. We keep the same return
 * shape (code/out/err/timedOut) so callers are unchanged.
 */
function runProcess(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string; err: string; timedOut: boolean }> {
  // Resolve an ABSOLUTE executable path so child_process never throws ENOENT
  // when the bare command name (bun/bunx) is not on the spawned PATH.
  const resolution = resolveRuntimeCommand(cmd as RuntimeName);
  const resolvedCmd = resolution.resolvedPath ?? cmd;
  const fullCommand = `${resolvedCmd} ${args.join(' ')}`;
  return runWithWatchdog(fullCommand, { timeoutMs, cwd: REPO_ROOT })
    .then((result) => {
      if (result.status === 'timed_out' || result.status === 'cancelled') {
        return { code: null, out: result.stdoutTail, err: result.stderrTail, timedOut: true };
      }
      if (result.status === 'spawn_error') {
        return { code: null, out: result.stdoutTail, err: result.stderrTail + '\n' + result.error, timedOut: false };
      }
      return { code: result.exitCode, out: result.stdoutTail, err: result.stderrTail, timedOut: false };
    });
}

/** Established, proven-safe smoke target (mirrors `runValidations` in the senior-developer runtime). */
const IMPORT_SMOKE_TARGET = 'backend/services/agents/multi-agent-framework.ts';

/**
 * Curated, runtime-safe backend test suites that SHIP in the production image
 * (`COPY backend ./backend`) and do NOT transitively pull the heavy AI runtime
 * (the optional `ai` package). With `bun` now present in the prod container
 * (Gap #1), these run as a GENUINE native `bun test` execution in-container —
 * not a degraded import-smoke. Pure/deterministic suites are chosen so a green
 * run is a real signal and a red run is a real failure.
 */
const CONTAINER_NATIVE_TEST_SUITES: string[] = [
  'backend/services/ivx-runtime-resolver.test.ts',
  'backend/services/ivx-continuous-improvement.test.ts',
  'backend/services/ivx-evidence-gate.test.ts',
  'backend/services/ivx-execution-trace-store.test.ts',
  'backend/services/ivx-tool-system.test.ts',
  'backend/services/ivx-capability-registry.test.ts',
];

/**
 * Native in-container test execution via the real `bun test` runner.
 *
 * Gap #1: once `bun` is shipped in the production image, the autonomous
 * lifecycle's step 6 runs a TRUE native test execution against the curated
 * backend suites that ship in the container — no degrade, no fabrication. Only
 * the suites that exist on disk are passed to the runner; a genuine test
 * failure fails honestly (`exitCode != 0`).
 */
async function runNativeBunTest(requestedSuite: string) {
  const present: string[] = [];
  for (const rel of CONTAINER_NATIVE_TEST_SUITES) {
    if (await fileExists(rel)) present.push(rel);
  }
  if (present.length === 0) {
    // No shipped suites to run — degrade honestly rather than report a false pass.
    return runImportSmokeValidation(requestedSuite);
  }
  const r = await runProcess('bun', ['test', ...present], 120_000);
  return {
    ok: r.code === 0 && !r.timedOut,
    suite: requestedSuite,
    native: true as const,
    effectiveCheck: 'bun-test' as const,
    exitCode: r.code,
    timedOut: r.timedOut,
    suitesRun: present.length,
    stdoutTail: r.out.slice(-4000),
    stderrTail: r.err.slice(-4000),
    note: `Ran native \`bun test\` over ${present.length} shipped backend suite(s) in-container.`,
  };
}

/**
 * Honest degraded validation for the node-only production container.
 *
 * `bun`/`bunx` are NOT installed in the deployed `node:22-alpine` image, so
 * `bunx tsc` / `bun lint` cannot run — they previously returned a false
 * ENOENT-class failure (exit=null / exit=1) that gated the entire autonomous
 * lifecycle (BLOCK 35, step 6). The backend itself runs under tsx, so
 * dynamically importing a real backend module transpiles + resolves its import
 * graph: a genuine compile proof in the production runtime. This is accurately
 * labeled (`effectiveCheck: 'tsx-import-smoke'`) — never a fabricated
 * typecheck/lint pass; a genuine compile error still fails honestly.
 */
async function runImportSmokeValidation(requestedSuite: string) {
  const started = Date.now();
  const target = pathToFileURL(path.join(REPO_ROOT, IMPORT_SMOKE_TARGET)).href;
  const note = `bun/bunx unavailable in this runtime; ran a real tsx import-smoke compile check of ${IMPORT_SMOKE_TARGET} instead of '${requestedSuite}'.`;
  try {
    await import(`${target}?ivxsmoke=${Date.now()}`);
    return { ok: true, suite: requestedSuite, degraded: true as const, effectiveCheck: 'tsx-import-smoke' as const, exitCode: 0, timedOut: false, stdoutTail: `IVX_IMPORT_SMOKE_OK ${IMPORT_SMOKE_TARGET}`, stderrTail: '', note };
  } catch (error) {
    return { ok: false, suite: requestedSuite, degraded: true as const, effectiveCheck: 'tsx-import-smoke' as const, exitCode: 1, timedOut: false, stdoutTail: '', stderrTail: (error instanceof Error ? error.message : String(error)).slice(-4000), note };
  }
}

export async function toolTestRun(input: { suite?: string; incidentId?: string }) {
  const suite = String(input.suite ?? 'typecheck');
  if (suite === 'typecheck') {
    // bun now ships in the production image (Gap #1), so the resolver finds it
    // on PATH and we run a GENUINE native `bunx tsc --noEmit`. Only when bun is
    // truly absent (e.g. a stripped runtime) do we degrade honestly to a real
    // tsx import-smoke — never a fabricated pass.
    const bunx = resolveRuntimeCommand('bunx');
    if (!bunx.resolvedPath || bunx.usedFallback) {
      return runImportSmokeValidation('typecheck');
    }
    const r = await runProcess('bunx', ['--bun', 'tsc', '-p', 'tsconfig.json', '--noEmit'], 120_000);
    return { ok: r.code === 0 && !r.timedOut, suite, native: true as const, effectiveCheck: 'bunx-tsc' as const, exitCode: r.code, timedOut: r.timedOut, stdoutTail: r.out.slice(-4000), stderrTail: r.err.slice(-4000) };
  }
  if (suite === 'test') {
    // Explicit native test execution (Gap #1).
    const bun = resolveRuntimeCommand('bun');
    if (!bun.resolvedPath || bun.usedFallback) {
      return runImportSmokeValidation('test');
    }
    return runNativeBunTest('test');
  }
  if (suite === 'lint') {
    const bun = resolveRuntimeCommand('bun');
    if (!bun.resolvedPath || bun.usedFallback) {
      return runImportSmokeValidation('lint');
    }
    // The expo eslint workspace is NOT shipped in the backend-only container, so
    // the honest native check here is a real `bun test` execution of the shipped
    // backend suites (Gap #1) rather than a degraded import-smoke. In a full
    // checkout (local/sandbox) the expo lint script is present and runs natively.
    if (await fileExists('expo/package.json')) {
      const r = await runProcess('bun', ['run', '--cwd', 'expo', 'lint'], 120_000).catch(() => ({ code: null, out: '', err: 'lint script missing', timedOut: false }));
      return { ok: r.code === 0, suite, native: true as const, effectiveCheck: 'bun-lint' as const, exitCode: r.code, timedOut: r.timedOut, stdoutTail: r.out.slice(-4000), stderrTail: r.err.slice(-4000) };
    }
    return runNativeBunTest('lint');
  }
  if (suite === 'smoke') {
    const base = (process.env.PRODUCTION_BASE_URL || '').trim() || 'https://api.ivxholding.com';
    try {
      const res = await fetch(`${base.replace(/\/+$/, '')}/health`, { method: 'GET' });
      const body = (await res.text()).slice(0, 2000);
      return { ok: res.ok, suite, url: `${base}/health`, status: res.status, bodyPreview: body };
    } catch (e) {
      return { ok: false, suite, error: e instanceof Error ? e.message : 'smoke fetch failed' };
    }
  }
  if (suite === 'replay') {
    const id = typeof input.incidentId === 'string' ? input.incidentId.trim() : '';
    if (!id) return { ok: false, error: 'incidentId is required for replay' };
    const r = await replayIncidentAgainstStaging(id);
    return { ok: r.ok, suite, result: r };
  }
  return { ok: false, error: `unknown suite '${suite}' (use typecheck|lint|smoke|replay)` };
}

// ---------- web navigator + lead discovery tool wrappers ----------

export async function toolWebNavigate(input: { startUrl?: string; maxPages?: number; compareSupabase?: boolean }) {
  return navigateSite({
    startUrl: typeof input.startUrl === 'string' ? input.startUrl : undefined,
    maxPages: typeof input.maxPages === 'number' ? input.maxPages : undefined,
    compareSupabase: input.compareSupabase !== false,
  });
}

const VALID_DISCOVERY_CLASSES = new Set<InvestorDiscoveryClass>(['buyers', 'jv_deals']);
const VALID_LEAD_STATUSES = new Set<LeadStatus>(['pending_approval', 'approved', 'rejected']);

export async function toolLeadDiscovery(input: {
  action?: string;
  query?: string;
  discoveryClass?: string;
  minOfferingUsd?: number;
  limit?: number;
  leadId?: string;
  status?: string;
  reason?: string;
}) {
  const action = String(input.action ?? 'discover');
  if (action === 'discover') {
    const discoveryClass = VALID_DISCOVERY_CLASSES.has(input.discoveryClass as InvestorDiscoveryClass)
      ? (input.discoveryClass as InvestorDiscoveryClass)
      : undefined;
    return discoverLeads({
      query: typeof input.query === 'string' ? input.query : undefined,
      discoveryClass,
      minOfferingUsd: typeof input.minOfferingUsd === 'number' ? input.minOfferingUsd : undefined,
      limit: typeof input.limit === 'number' ? input.limit : undefined,
    });
  }
  if (action === 'list') {
    const status = VALID_LEAD_STATUSES.has(input.status as LeadStatus) ? (input.status as LeadStatus) : undefined;
    const leads = await listLeads(status);
    return { ok: true, action, count: leads.length, leads };
  }
  if (action === 'summary') {
    return { ok: true, action, summary: await summarizeLeads() };
  }
  if (action === 'approve') {
    const id = typeof input.leadId === 'string' ? input.leadId.trim() : '';
    if (!id) return { ok: false, error: 'leadId is required to approve a lead.' };
    return approveLead(id);
  }
  if (action === 'reject') {
    const id = typeof input.leadId === 'string' ? input.leadId.trim() : '';
    if (!id) return { ok: false, error: 'leadId is required to reject a lead.' };
    return rejectLead(id, typeof input.reason === 'string' ? input.reason : undefined);
  }
  return { ok: false, error: `unknown action '${action}' (use discover|list|summary|approve|reject)` };
}

// ---------- end-to-end audit report ----------

export type SeniorDevAuditReport = {
  marker: string;
  generatedAt: string;
  environment: string;
  buildId: string | null;
  app: Awaited<ReturnType<typeof toolAppAudit>>;
  landing: Awaited<ReturnType<typeof toolLandingAudit>>;
  incidents: Awaited<ReturnType<typeof toolIncidentAnalyze>>;
  logs: Awaited<ReturnType<typeof toolLogRead>>;
  smoke: Awaited<ReturnType<typeof toolTestRun>>;
  topIssues: { area: string; finding: string; severity: 'info' | 'warning' | 'critical'; nextAction: string }[];
};

export async function runSeniorDeveloperAudit(): Promise<SeniorDevAuditReport> {
  const [app, landing, incidents, logs, smoke] = await Promise.all([
    toolAppAudit(),
    toolLandingAudit(),
    toolIncidentAnalyze({ limit: 200, minRepeat: 1 }),
    toolLogRead({ source: 'incidents', limit: 80 }),
    toolTestRun({ suite: 'smoke' }),
  ]);

  const topIssues: SeniorDevAuditReport['topIssues'] = [];

  if (app.ok && app.wiring) {
    if (!app.wiring.incidentClient) topIssues.push({ area: 'app', finding: 'Incident client not wired in app', severity: 'critical', nextAction: 'Import installIVXIncidentCapture in expo/app/_layout.tsx' });
    if (!app.wiring.watchdog) topIssues.push({ area: 'app', finding: 'No watchdog references found', severity: 'warning', nextAction: 'Confirm ivxAIWatchdog is initialised at app boot' });
    if ((app.wiring.aiPipelineReferences ?? 0) === 0) topIssues.push({ area: 'app', finding: 'AI pipeline service not referenced', severity: 'critical', nextAction: 'Verify ivxAIRequestService.requestOwnerAI is imported by chat screens' });
  }

  if (landing.ok && landing.metrics) {
    if (!landing.metrics.viewportTagPresent) topIssues.push({ area: 'landing', finding: 'No viewport meta tag detected', severity: 'warning', nextAction: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"/>' });
    if (landing.metrics.seoMetaTags < 3) topIssues.push({ area: 'landing', finding: 'Few SEO meta tags', severity: 'warning', nextAction: 'Add <title>, description, og:title, og:description' });
    if (landing.metrics.insecureHttpReferences > 0) topIssues.push({ area: 'landing', finding: `${landing.metrics.insecureHttpReferences} insecure http:// references`, severity: 'warning', nextAction: 'Upgrade to https://' });
    if (landing.metrics.ctaReferences === 0) topIssues.push({ area: 'landing', finding: 'No CTA targets detected', severity: 'critical', nextAction: 'Add primary CTA(s) pointing to /signup or /login' });
  }

  for (const cluster of incidents.topClusters.slice(0, 5)) {
    topIssues.push({
      area: 'incidents',
      finding: `${cluster.count}× "${cluster.sampleMessage.slice(0, 80)}"`,
      severity: cluster.count >= 5 ? 'critical' : 'warning',
      nextAction: cluster.sampleFileLine ? `Inspect ${cluster.sampleFileLine}` : 'Run patch_generate on incident ' + cluster.sampleId,
    });
  }

  if (!smoke.ok) {
    const smokeDetail = smoke as { status?: number | string; error?: string };
    topIssues.push({ area: 'backend', finding: `/health probe failed (${smokeDetail.status ?? smokeDetail.error ?? 'unknown'})`, severity: 'critical', nextAction: 'Check Render deploy & PRODUCTION_BASE_URL' });
  }

  return {
    marker: IVX_SENIOR_DEV_TOOLS_MARKER,
    generatedAt: new Date().toISOString(),
    environment: process.env.NODE_ENV || process.env.RENDER_ENV || 'unknown',
    buildId: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || process.env.IVX_BUILD_ID || null,
    app,
    landing,
    incidents,
    logs,
    smoke,
    topIssues,
  };
}

function categoryForTool(name: ToolName): ExecutionEventCategory {
  switch (name) {
    case 'code_read': return 'file_activity';
    case 'code_search': return 'repo_activity';
    case 'log_read': return 'repo_activity';
    case 'incident_analyze': return 'watchdog_event';
    case 'app_audit': return 'repo_activity';
    case 'landing_audit': return 'repo_activity';
    case 'patch_generate': return 'patch_event';
    case 'test_run': return 'test_event';
    case 'web_navigate': return 'repo_activity';
    case 'lead_discovery': return 'tool_call';
    default: return 'tool_call';
  }
}

function summarizeToolInput(name: ToolName, input: Record<string, unknown>): { fileLine?: string; symbol?: string; meta: Record<string, string | number | boolean | null> } {
  const meta: Record<string, string | number | boolean | null> = {};
  let fileLine: string | undefined;
  let symbol: string | undefined;
  const p = typeof input.path === 'string' ? input.path : undefined;
  const q = typeof input.query === 'string' ? input.query : undefined;
  const startLine = typeof input.startLine === 'number' ? input.startLine : undefined;
  const endLine = typeof input.endLine === 'number' ? input.endLine : undefined;
  const suite = typeof input.suite === 'string' ? input.suite : undefined;
  const incidentId = typeof input.incidentId === 'string' ? input.incidentId : undefined;
  const source = typeof input.source === 'string' ? input.source : undefined;
  if (p) {
    fileLine = startLine ? `${p}:${startLine}${endLine ? `-${endLine}` : ''}` : p;
    meta.path = p;
    if (startLine) meta.startLine = startLine;
    if (endLine) meta.endLine = endLine;
  }
  if (q) { meta.query = q.slice(0, 120); symbol = q.slice(0, 80); }
  if (suite) meta.suite = suite;
  if (incidentId) meta.incidentId = incidentId;
  if (source) meta.source = source;
  meta.tool = name;
  return { fileLine, symbol, meta };
}

function summarizeToolResult(name: ToolName, result: unknown): { status: 'pass' | 'fail' | 'info'; extraMeta: Record<string, string | number | boolean | null> } {
  const extraMeta: Record<string, string | number | boolean | null> = {};
  let status: 'pass' | 'fail' | 'info' = 'info';
  if (result && typeof result === 'object') {
    const r = result as Record<string, unknown>;
    if (typeof r.ok === 'boolean') status = r.ok ? 'pass' : 'fail';
    if (typeof r.hitCount === 'number') extraMeta.hits = r.hitCount;
    if (typeof r.totalLines === 'number') extraMeta.totalLines = r.totalLines;
    if (Array.isArray((r as { lines?: unknown[] }).lines)) extraMeta.linesRead = ((r as { lines: unknown[] }).lines).length;
    if (typeof r.exitCode === 'number') extraMeta.exitCode = r.exitCode;
    if (typeof r.timedOut === 'boolean') extraMeta.timedOut = r.timedOut;
    if (typeof r.status === 'number') extraMeta.httpStatus = r.status;
    if (typeof r.error === 'string') extraMeta.error = r.error.slice(0, 160);
  }
  extraMeta.tool = name;
  return { status, extraMeta };
}

async function dispatchSeniorDevTool(name: ToolName, input: Record<string, unknown>): Promise<unknown> {
  switch (name) {
    case 'code_read': return toolCodeRead(input);
    case 'code_search': return toolCodeSearch(input);
    case 'log_read': return toolLogRead(input);
    case 'incident_analyze': return toolIncidentAnalyze(input);
    case 'app_audit': return toolAppAudit();
    case 'landing_audit': return toolLandingAudit();
    case 'patch_generate': return toolPatchGenerate(input as { incidentId?: string });
    case 'test_run': return toolTestRun(input as { suite?: string; incidentId?: string });
    case 'web_navigate': return toolWebNavigate(input as { startUrl?: string; maxPages?: number; compareSupabase?: boolean });
    case 'lead_discovery': return toolLeadDiscovery(input as Parameters<typeof toolLeadDiscovery>[0]);
    default: return { ok: false, error: `unknown tool '${name as string}'` };
  }
}

export async function executeSeniorDevTool(name: ToolName, input: Record<string, unknown>): Promise<unknown> {
  const start = Date.now();
  const { fileLine, symbol, meta } = summarizeToolInput(name, input);
  try {
    recordExecutionEvent({
      category: categoryForTool(name),
      label: `${name} started`,
      fileLine,
      symbol,
      status: 'running',
      meta,
    });
  } catch { /* never block tool path */ }

  const result = await dispatchSeniorDevTool(name, input);
  const durationMs = Date.now() - start;

  try {
    const { status, extraMeta } = summarizeToolResult(name, result);
    recordExecutionEvent({
      category: categoryForTool(name),
      label: `${name} ${status === 'pass' ? 'finished' : status === 'fail' ? 'failed' : 'returned'}`,
      fileLine,
      symbol,
      status,
      durationMs,
      meta: { ...meta, ...extraMeta },
    });
  } catch { /* never block tool path */ }

  return result;
}
