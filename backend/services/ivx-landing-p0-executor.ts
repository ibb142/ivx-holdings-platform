/**
 * IVX Landing P0 — real unit executor.
 *
 * Executes ONE atomic Landing work unit with live evidence only:
 *   - HTML/CSS checks against the production landing page
 *   - API contract / deals / reels / media checks against the production API
 *   - negative-path registration & auth contract probes (never creates members
 *     on purpose; probe payloads are invalid or duplicate by design)
 *   - security boundary probes (unauthenticated privileged routes, secret leaks, CORS)
 *   - browser-only behaviours bound to REAL GitHub Actions runs on the exact SHA
 *
 * Fail-closed: when evidence cannot be obtained the unit is BLOCKED with the
 * exact reason — it is never reported as PASS. Productive seconds exclude
 * rate-limiter waits. No secret values are ever written into evidence.
 */
import { getAllTasks, TERMINAL_SUCCESS_STATES } from './ivx-autonomous-task-engine';
import {
  fetchMainSha,
  LANDING_API_URL,
  LANDING_REPO,
  LANDING_URL,
  parseLandingTaskKey,
  type ApiAssert,
  type DealsAssert,
  type HtmlAssert,
  type LandingDefect,
  type LandingResultRecord,
  type LandingUnit,
} from './ivx-landing-p0-backlog';

export const IVX_LANDING_P0_EXECUTOR_MARKER = 'ivx-landing-p0-executor-2026-09-04';

export type LandingExecutionContext = {
  agentId: string;
  agentNumber: number | null;
  taskId: string;
  sourceSha: string;
  productionSha: string;
  repair: boolean;
};

/** Owner-mandated evidence object (full form; the compact record is persisted on the task). */
export type LandingEvidenceObject = {
  schema: 'ivx-landing-p0-evidence-v1';
  agent_id: string;
  agent_number: number | null;
  task_id: string;
  unit_id: string;
  workstream: string;
  started_at: string;
  completed_at: string;
  productive_seconds: number;
  repo_sha_before: string;
  repo_sha_after: string;
  files_inspected: string[];
  files_changed: string[];
  tests_run: string[];
  test_results: string[];
  browser_checks: string[];
  api_checks: string[];
  bugs_found: LandingDefect[];
  fixes_applied: string[];
  commit_sha: null;
  pr_number: null;
  deploy_id: null;
  production_sha: string | null;
  status: 'PASS' | 'FAIL' | 'BLOCKED';
  blocked_reason: string | null;
  evidence: string[];
};

export type LandingUnitExecution = { record: LandingResultRecord; full: LandingEvidenceObject };

export type ExecutorDeps = { fetchImpl?: typeof fetch };

type Probe = { ok: boolean; status: number; ms: number; bytes: number; contentType: string; headers: Headers | null; text: string; error: string | null };

type Verdict = { status: 'PASS' | 'FAIL' | 'BLOCKED'; detail: string; blockedReason?: string; rootCause?: LandingDefect['root_cause']; remediation?: string };

type Collector = { api: string[]; browser: string[]; files: string[]; evidence: string[]; limiterWaitMs: number };

const FETCH_TIMEOUT_MS = 12_000;
const MEDIA_CONCURRENCY = 6;
const CACHE_60S = 60 * 1000;
const CACHE_5M = 5 * 60 * 1000;

export const SECRET_PATTERNS: ReadonlyArray<{ code: string; pattern: RegExp }> = [
  { code: 'service_role_literal', pattern: /service_role/i },
  { code: 'openai_key', pattern: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { code: 'vercel_gateway_key', pattern: /\bvck_[A-Za-z0-9_-]{10,}/ },
  { code: 'render_key', pattern: /\brnd_[A-Za-z0-9]{10,}/ },
  { code: 'github_pat', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/ },
  { code: 'aws_access_key', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { code: 'twilio_auth_token', pattern: /\bSK[0-9a-fA-F]{32}\b/ },
];

// ── Utilities ────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function probe(fetchImpl: typeof fetch, url: string, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS): Promise<Probe> {
  const started = Date.now();
  try {
    const response = await fetchImpl(url, {
      ...init,
      headers: { 'user-agent': 'ivx-landing-p0-audit/1.0', accept: '*/*', ...(init.headers as Record<string, string> | undefined) },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = init.method === 'HEAD' ? '' : await response.text();
    const lengthHeader = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      bytes: Number.isFinite(lengthHeader) ? lengthHeader : Buffer.byteLength(text),
      contentType: (response.headers.get('content-type') ?? '').toLowerCase(),
      headers: response.headers,
      text,
      error: null,
    };
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, bytes: 0, contentType: '', headers: null, text: '', error: error instanceof Error ? error.message : String(error) };
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

// Shared in-process caches (all 112 agents run in one API process).
const cache = new Map<string, { expiresAt: number; value: Promise<unknown> }>();
function cached<T>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  const now = Date.now();
  if (hit && hit.expiresAt > now) return hit.value as Promise<T>;
  const value = loader();
  cache.set(key, { expiresAt: now + ttlMs, value });
  value.catch(() => cache.delete(key));
  return value;
}

/** Test-only: clear shared caches and limiter chains. */
export function __resetLandingExecutorCachesForTests(): void {
  cache.clear();
  limiterChains.clear();
}

// Per-route-family limiter — production rate limiters (register 5 burst/0.3rps,
// owner-login 3 burst) must never turn a real probe into a 429 false alarm.
const limiterChains = new Map<string, { tail: Promise<void>; nextAt: number }>();
async function routeBudget(family: string, minIntervalMs: number): Promise<number> {
  const entry = limiterChains.get(family) ?? { tail: Promise.resolve(), nextAt: 0 };
  let waited = 0;
  const run = entry.tail.then(async () => {
    const now = Date.now();
    const delay = Math.max(0, entry.nextAt - now);
    entry.nextAt = Math.max(now, entry.nextAt) + minIntervalMs;
    if (delay > 0) {
      waited = delay;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  });
  entry.tail = run.catch(() => undefined);
  limiterChains.set(family, entry);
  await run;
  return waited;
}

// ── HTML helpers (regex-based; no DOM library in the API image) ──────────────

type TagMatch = { attrs: Record<string, string>; inner: string; raw: string };

function parseAttrs(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    if (name === '/' ) continue;
    attrs[name] = (match[2] ?? match[3] ?? match[4] ?? '').trim();
  }
  return attrs;
}

export function tags(html: string, name: string): TagMatch[] {
  const out: TagMatch[] = [];
  const re = new RegExp(`<${name}\\b([^>]*)>`, 'gi');
  const closer = new RegExp(`</${name}\\s*>`, 'i');
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const attrs = parseAttrs(match[1] ?? '');
    const after = html.slice(match.index + match[0].length);
    const close = closer.exec(after);
    const inner = close ? after.slice(0, close.index) : '';
    out.push({ attrs, inner, raw: match[0] });
  }
  return out;
}

export function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function countTag(html: string, name: string): number {
  return (html.match(new RegExp(`<${name}\\b`, 'gi')) ?? []).length;
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

function isSkippableHref(href: string): boolean {
  const lower = href.trim().toLowerCase();
  return lower === '' || lower === '#' || lower.startsWith('#') || lower.startsWith('mailto:') || lower.startsWith('tel:') || lower.startsWith('javascript:') || lower.startsWith('sms:');
}

function decodeJwtRole(token: string): string | null {
  try {
    const payload = token.split('.')[1] ?? '';
    const json = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { role?: string };
    return typeof json.role === 'string' ? json.role : null;
  } catch {
    return null;
  }
}

/** Secret scan — returns codes only; never the matched values. */
export function scanForSecrets(text: string): string[] {
  const codes = SECRET_PATTERNS.filter(({ pattern }) => pattern.test(text)).map(({ code }) => code);
  const jwtRe = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g;
  for (const match of text.match(jwtRe) ?? []) {
    if (decodeJwtRole(match) === 'service_role') { codes.push('service_role_jwt'); break; }
  }
  return [...new Set(codes)];
}

// ── Production data loaders (cached, shared across agents) ───────────────────

type LandingPage = Probe & { fetchedAt: string };

function loadLandingHtml(fetchImpl: typeof fetch): Promise<LandingPage> {
  return cached('landing-html', CACHE_60S, async () => ({ ...(await probe(fetchImpl, `${LANDING_URL}/`, { headers: { accept: 'text/html' } })), fetchedAt: nowIso() }));
}

type DealRecord = Record<string, unknown>;

function loadDeals(fetchImpl: typeof fetch): Promise<{ probe: Probe; deals: DealRecord[] }> {
  return cached('deals', CACHE_60S, async () => {
    const result = await probe(fetchImpl, `${LANDING_API_URL}/api/deals`, { headers: { accept: 'application/json' } });
    const body = parseJson(result.text) as { deals?: unknown } | unknown[] | undefined;
    const list = Array.isArray(body) ? body : Array.isArray((body as { deals?: unknown })?.deals) ? (body as { deals: unknown[] }).deals : [];
    return { probe: result, deals: list.filter((row): row is DealRecord => typeof row === 'object' && row !== null) };
  });
}

function loadReels(fetchImpl: typeof fetch): Promise<{ probe: Probe; reels: DealRecord[] }> {
  return cached('reels', CACHE_60S, async () => {
    const result = await probe(fetchImpl, `${LANDING_API_URL}/api/reels`, { headers: { accept: 'application/json' } });
    const body = parseJson(result.text) as Record<string, unknown> | unknown[] | undefined;
    const candidates = Array.isArray(body) ? body : body ? (['reels', 'items', 'data', 'feed', 'videos'].map((k) => (body as Record<string, unknown>)[k]).find(Array.isArray) as unknown[] | undefined) ?? [] : [];
    return { probe: result, reels: candidates.filter((row): row is DealRecord => typeof row === 'object' && row !== null) };
  });
}

type CiRun = { id: number; name: string; status: string; conclusion: string | null; html_url: string; head_sha: string; updated_at: string };
type CiRuns = { runs: CiRun[]; blocked: string | null };

function loadCiRuns(fetchImpl: typeof fetch, sha: string): Promise<CiRuns> {
  return cached(`ci-runs:${sha}`, CACHE_5M, async () => {
    const token = (process.env.GITHUB_TOKEN ?? '').trim();
    if (!token) return { runs: [], blocked: 'GITHUB_TOKEN not configured on the API host — CI evidence cannot be read' };
    const result = await probe(fetchImpl, `https://api.github.com/repos/${LANDING_REPO}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=100`, {
      headers: { accept: 'application/vnd.github+json', authorization: `Bearer ${token}` },
    });
    if (result.status === 403 || result.status === 429) {
      const reset = result.headers?.get('x-ratelimit-reset');
      const resetIso = reset ? new Date(Number.parseInt(reset, 10) * 1000).toISOString() : 'unknown';
      return { runs: [], blocked: `GitHub API rate-limited for the configured token (resets ${resetIso})` };
    }
    if (!result.ok) return { runs: [], blocked: `GitHub API HTTP ${result.status || result.error}` };
    const body = parseJson(result.text) as { workflow_runs?: CiRun[] } | undefined;
    return { runs: Array.isArray(body?.workflow_runs) ? body!.workflow_runs : [], blocked: null };
  });
}

// ── Deal / media field detection ─────────────────────────────────────────────

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif|svg)(\?|#|$)/i;
const VIDEO_EXT = /\.(mp4|webm|mov|m3u8|mpd)(\?|#|$)/i;
const FINANCIAL_KEYS = /price|raise|invest|irr|roi|cash|equity|cap ?rate|valuation|cost|loan|budget|return|yield|noi|arv|amount|funding/i;
const IDENTITY_KEYS = /^(location|address|city|state|market|region|zip|zipcode|postal|county|neighborhood)$/i;
const VIDEO_KEYS = /video|reel|clip/i;
const IMAGE_KEYS = /image|photo|picture|cover|thumbnail|thumb|gallery|hero|media/i;

function dealTitle(deal: DealRecord): string {
  for (const key of ['title', 'name', 'propertyName', 'property', 'headline']) {
    const value = deal[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function dealId(deal: DealRecord): string {
  for (const key of ['id', 'slug', 'dealId', 'uuid', 'key']) {
    const value = deal[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return '';
}

function collectUrls(value: unknown, keyHint: string, depth: number, out: { images: Set<string>; videos: Set<string> }): void {
  if (depth > 4 || value == null) return;
  if (typeof value === 'string') {
    if (!/^https?:\/\//i.test(value)) return;
    if (VIDEO_EXT.test(value) || VIDEO_KEYS.test(keyHint)) out.videos.add(value);
    else if (IMAGE_EXT.test(value) || IMAGE_KEYS.test(keyHint)) out.images.add(value);
    return;
  }
  if (Array.isArray(value)) { for (const item of value) collectUrls(item, keyHint, depth + 1, out); return; }
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if (/^(url|src|href|uri|path|publicUrl|downloadUrl)$/i.test(key)) collectUrls(inner, keyHint, depth + 1, out);
      else collectUrls(inner, key, depth + 1, out);
    }
  }
}

export function dealMedia(deal: DealRecord): { images: string[]; videos: string[] } {
  const out = { images: new Set<string>(), videos: new Set<string>() };
  for (const [key, value] of Object.entries(deal)) collectUrls(value, key, 0, out);
  return { images: [...out.images], videos: [...out.videos] };
}

function dealPublished(deal: DealRecord): boolean | null {
  for (const key of ['published', 'isPublished', 'isPublic', 'visible', 'isVisible', 'active', 'isActive', 'live', 'isLive']) {
    if (typeof deal[key] === 'boolean') return deal[key] as boolean;
  }
  for (const key of ['status', 'publicationState', 'publishState', 'visibility', 'state']) {
    const value = deal[key];
    if (typeof value === 'string') return /^(published|public|live|active|open|visible|funding)$/i.test(value.trim());
  }
  return null;
}

function hasFinancials(deal: DealRecord): string[] {
  const found: string[] = [];
  const walk = (value: unknown, key: string, depth: number) => {
    if (depth > 2 || value == null) return;
    if ((typeof value === 'number' && Number.isFinite(value)) || (typeof value === 'string' && /^\$?\s?[\d,.]+\s?(%|k|m|mm)?$/i.test(value.trim()))) {
      if (FINANCIAL_KEYS.test(key)) found.push(key);
      return;
    }
    if (typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, k, depth + 1);
  };
  for (const [key, value] of Object.entries(deal)) walk(value, key, 0);
  return [...new Set(found)];
}

function hasIdentity(deal: DealRecord): boolean {
  if (!dealId(deal)) return false;
  return Object.entries(deal).some(([key, value]) => IDENTITY_KEYS.test(key) && ((typeof value === 'string' && value.trim().length > 1) || (typeof value === 'object' && value !== null)));
}

function hasCover(deal: DealRecord): boolean {
  for (const key of ['cover', 'coverImage', 'coverUrl', 'thumbnail', 'thumbnailUrl', 'heroImage', 'heroImageUrl', 'image', 'imageUrl', 'primaryImage', 'mainImage']) {
    const value = deal[key];
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return true;
    if (typeof value === 'object' && value !== null && typeof (value as { url?: unknown }).url === 'string') return true;
  }
  return dealMedia(deal).images.length > 0;
}

// ── Check implementations ────────────────────────────────────────────────────

async function headOrGet(fetchImpl: typeof fetch, url: string): Promise<Probe> {
  const head = await probe(fetchImpl, url, { method: 'HEAD' }, 10_000);
  if (head.status === 405 || head.status === 403 || head.status === 501 || head.status === 0) {
    return probe(fetchImpl, url, { method: 'GET', headers: { range: 'bytes=0-0' } }, 10_000);
  }
  return head;
}

function fail(detail: string, rootCause: LandingDefect['root_cause'], remediation: string): Verdict {
  return { status: 'FAIL', detail, rootCause, remediation };
}
function pass(detail: string): Verdict {
  return { status: 'PASS', detail };
}
function blocked(reason: string): Verdict {
  return { status: 'BLOCKED', detail: reason, blockedReason: reason };
}

async function runHtmlAsserts(fetchImpl: typeof fetch, asserts: HtmlAssert[], c: Collector): Promise<Verdict> {
  const page = await loadLandingHtml(fetchImpl);
  c.api.push(`GET ${LANDING_URL}/ → ${page.status} ${page.ms}ms ${page.bytes}B`);
  c.files.push(`${LANDING_URL}/`);
  if (page.status !== 200) return fail(`landing HTML HTTP ${page.status || page.error}`, 'infra', 'restore production landing availability');
  const html = page.text;
  const problems: string[] = [];
  const notes: string[] = [];
  for (const assert of asserts) {
    switch (assert.assert) {
      case 'element': {
        const count = countTag(html, assert.tag);
        const min = assert.min ?? 1;
        if (count < min) problems.push(`<${assert.tag}> count ${count} < ${min}`); else notes.push(`<${assert.tag}>×${count}`);
        break;
      }
      case 'meta-viewport': {
        const meta = tags(html, 'meta').find((m) => (m.attrs.name ?? '').toLowerCase() === 'viewport');
        if (!meta) problems.push('missing <meta name="viewport">');
        else if (!/width\s*=\s*device-width/i.test(meta.attrs.content ?? '')) problems.push(`viewport lacks width=device-width (${truncate(meta.attrs.content ?? '', 60)})`);
        else notes.push('viewport ok');
        break;
      }
      case 'viewport-zoomable': {
        const meta = tags(html, 'meta').find((m) => (m.attrs.name ?? '').toLowerCase() === 'viewport');
        const content = meta?.attrs.content ?? '';
        if (/user-scalable\s*=\s*(no|0)/i.test(content) || /maximum-scale\s*=\s*1(\.0+)?(\s*,|\s*$)/i.test(content)) problems.push(`viewport disables zoom (${truncate(content, 60)})`);
        else notes.push('zoom allowed');
        break;
      }
      case 'lang-title': {
        const htmlTag = /<html\b([^>]*)>/i.exec(html);
        const lang = htmlTag ? parseAttrs(htmlTag[1] ?? '').lang : undefined;
        const title = stripTags(tags(html, 'title')[0]?.inner ?? '');
        if (!lang) problems.push('missing <html lang>');
        if (!title) problems.push('missing <title>');
        if (lang && title) notes.push(`lang=${lang} title="${truncate(title, 40)}"`);
        break;
      }
      case 'img-alt': {
        const imgs = tags(html, 'img');
        const missing = imgs.filter((img) => !('alt' in img.attrs)).length;
        if (missing > 0) problems.push(`${missing}/${imgs.length} <img> without alt`); else notes.push(`${imgs.length} img with alt`);
        break;
      }
      case 'buttons-labeled': {
        const buttons = tags(html, 'button');
        const unlabeled = buttons.filter((b) => !stripTags(b.inner) && !b.attrs['aria-label'] && !b.attrs['aria-labelledby'] && !b.attrs.title && !/<img\b[^>]*\balt=/i.test(b.inner) && !/<svg\b[^>]*\b(aria-label|role=)/i.test(b.inner)).length;
        if (unlabeled > 0) problems.push(`${unlabeled}/${buttons.length} <button> without text or aria-label`); else notes.push(`${buttons.length} buttons labeled`);
        break;
      }
      case 'links-labeled': {
        const anchors = tags(html, 'a');
        const unlabeled = anchors.filter((a) => !stripTags(a.inner) && !a.attrs['aria-label'] && !a.attrs.title && !/<img\b[^>]*\balt="[^"]+"/i.test(a.inner)).length;
        if (unlabeled > 0) problems.push(`${unlabeled}/${anchors.length} <a> without text or aria-label`); else notes.push(`${anchors.length} links labeled`);
        break;
      }
      case 'form-labels': {
        const inputs = tags(html, 'input').filter((i) => !/^(hidden|submit|button|image|reset)$/i.test(i.attrs.type ?? 'text'));
        const labelFor = new Set(tags(html, 'label').map((l) => l.attrs.for).filter(Boolean));
        const unlabeled = inputs.filter((i) => !(i.attrs.id && labelFor.has(i.attrs.id)) && !i.attrs['aria-label'] && !i.attrs['aria-labelledby'] && !i.attrs.title).length;
        if (unlabeled > 0) problems.push(`${unlabeled}/${inputs.length} inputs without <label for>/aria-label/aria-labelledby`); else notes.push(`${inputs.length} inputs labeled`);
        break;
      }
      case 'heading-order': {
        const levels = [...html.matchAll(/<h([1-6])\b/gi)].map((m) => Number.parseInt(m[1], 10));
        const h1s = levels.filter((l) => l === 1).length;
        if (h1s !== 1) problems.push(`expected exactly one <h1>, found ${h1s}`);
        let previous = 0;
        const skips: string[] = [];
        for (const level of levels) { if (previous > 0 && level > previous + 1) skips.push(`h${previous}→h${level}`); previous = level; }
        if (skips.length > 0) problems.push(`heading level skips: ${[...new Set(skips)].slice(0, 5).join(', ')}`);
        if (h1s === 1 && skips.length === 0) notes.push(`headings ok (${levels.length})`);
        break;
      }
      case 'no-dead-anchors': {
        const anchors = tags(html, 'a');
        const dead = anchors.filter((a) => { const href = (a.attrs.href ?? '').trim().toLowerCase(); return (href === '' || href === '#' || href.startsWith('javascript:')) && !a.attrs.onclick && a.attrs.role !== 'button'; }).length;
        if (dead > 0) problems.push(`${dead}/${anchors.length} anchors with dead href (#/empty/javascript:)`); else notes.push(`${anchors.length} anchors have targets`);
        break;
      }
      case 'cta-present': {
        const ctaRe = /invest|register|sign ?up|sign ?in|join|apply|get started|contact|log ?in|start|learn more|view deals?/i;
        const ctas = [...tags(html, 'a'), ...tags(html, 'button')].filter((el) => ctaRe.test(stripTags(el.inner)) || ctaRe.test(el.attrs['aria-label'] ?? ''));
        const broken = ctas.filter((el) => 'href' in el.attrs && isSkippableHref(el.attrs.href ?? '') && !el.attrs.onclick).length;
        if (ctas.length === 0) problems.push('no CTA (invest/register/sign in/join/apply/contact) found');
        else if (broken > 0) problems.push(`${broken}/${ctas.length} CTA anchors without a real target`);
        else notes.push(`${ctas.length} CTAs with targets`);
        break;
      }
      case 'no-inline-secrets': {
        const codes = scanForSecrets(html);
        if (codes.length > 0) problems.push(`secret patterns in HTML: ${codes.join(', ')}`); else notes.push('no secret patterns');
        break;
      }
      case 'lazy-load': {
        const imgs = tags(html, 'img');
        if (imgs.length <= 1) { notes.push('lazy-load n/a (<=1 img)'); break; }
        const lazy = imgs.slice(1).filter((img) => (img.attrs.loading ?? '').toLowerCase() === 'lazy').length;
        if (lazy < Math.ceil((imgs.length - 1) / 2)) problems.push(`${lazy}/${imgs.length - 1} below-fold images lazy-loaded`); else notes.push(`${lazy}/${imgs.length - 1} lazy`);
        break;
      }
      case 'video-fallback': {
        const videos = tags(html, 'video');
        const bad = videos.filter((v) => !v.attrs.poster && !stripTags(v.inner.replace(/<source\b[^>]*>/gi, ''))).length;
        if (bad > 0) problems.push(`${bad}/${videos.length} <video> without poster or fallback text`); else notes.push(`${videos.length} videos with fallback`);
        break;
      }
      case 'script-budget': {
        const count = countTag(html, 'script');
        if (count > assert.maxTags) problems.push(`${count} <script> tags > budget ${assert.maxTags}`); else notes.push(`${count} scripts`);
        break;
      }
    }
  }
  c.evidence.push(`landing html sha-less snapshot ${page.bytes}B fetched ${page.fetchedAt}`);
  if (problems.length > 0) return fail(problems.join('; '), 'content', 'fix landing markup per listed items');
  return pass(notes.join('; ') || 'all assertions passed');
}

async function runCssMedia(fetchImpl: typeof fetch, query: 'mobile' | 'tablet' | 'desktop', c: Collector): Promise<Verdict> {
  const page = await loadLandingHtml(fetchImpl);
  if (page.status !== 200) return fail(`landing HTML HTTP ${page.status || page.error}`, 'infra', 'restore production landing availability');
  const inline = tags(page.text, 'style').map((s) => s.inner).join('\n');
  const sheets = tags(page.text, 'link').filter((l) => /stylesheet/i.test(l.attrs.rel ?? '') && l.attrs.href).map((l) => absolute(l.attrs.href, `${LANDING_URL}/`)).filter((v): v is string => Boolean(v)).slice(0, 6);
  const css = [inline, ...(await mapLimit(sheets, 3, async (url) => {
    const result = await cached(`css:${url}`, CACHE_5M, () => probe(fetchImpl, url, {}, 10_000));
    c.api.push(`GET ${url} → ${result.status} ${result.bytes}B`);
    c.files.push(url);
    return result.ok ? result.text : '';
  }))].join('\n');
  const widths = [...css.matchAll(/@media[^{]*?\((?:max|min)-width\s*:\s*(\d+(?:\.\d+)?)(px|em|rem)/gi)].map((m) => ({ kind: /max-width/i.test(m[0]) ? 'max' : 'min', px: Number.parseFloat(m[1]) * (m[2] === 'px' ? 1 : 16) }));
  const has = {
    mobile: widths.some((w) => (w.kind === 'max' && w.px <= 768) || (w.kind === 'min' && w.px <= 480)),
    tablet: widths.some((w) => (w.kind === 'max' && w.px > 768 && w.px <= 1100) || (w.kind === 'min' && w.px >= 600 && w.px < 1024)),
    desktop: widths.some((w) => (w.kind === 'min' && w.px >= 1024) || (w.kind === 'max' && w.px > 1100)),
  };
  c.evidence.push(`css: ${sheets.length} stylesheets, ${widths.length} @media width rules`);
  if (widths.length === 0) return fail(`no @media width rules found in ${sheets.length} stylesheet(s) + inline styles (layout likely JS-driven)`, 'content', 'confirm responsive rules; rendering verified by browser CI unit');
  return has[query] ? pass(`${query} media rules present (${widths.length} rules)`) : fail(`no ${query} media rules among ${widths.length} @media rules`, 'content', `add ${query} breakpoint rules`);
}

async function runLinks(fetchImpl: typeof fetch, scope: 'internal' | 'external', max: number, c: Collector): Promise<Verdict> {
  const page = await loadLandingHtml(fetchImpl);
  if (page.status !== 200) return fail(`landing HTML HTTP ${page.status || page.error}`, 'infra', 'restore production landing availability');
  const landingHost = new URL(LANDING_URL).host.replace(/^www\./, '');
  const urls = [...new Set(tags(page.text, 'a').map((a) => a.attrs.href ?? '').filter((h) => !isSkippableHref(h)).map((h) => absolute(h, `${LANDING_URL}/`)).filter((v): v is string => Boolean(v)))]
    .filter((url) => { const host = new URL(url).host.replace(/^www\./, ''); return scope === 'internal' ? host === landingHost : host !== landingHost; })
    .slice(0, max);
  if (urls.length === 0) return pass(`no ${scope} links on landing`);
  const results = await mapLimit(urls, MEDIA_CONCURRENCY, async (url) => ({ url, result: await headOrGet(fetchImpl, url) }));
  const dead = results.filter(({ result }) => result.status === 0 || result.status >= 400);
  for (const { url, result } of results) c.api.push(`${url} → ${result.status || result.error}`);
  if (dead.length > 0) return fail(`${dead.length}/${urls.length} ${scope} links dead: ${dead.slice(0, 6).map((d) => `${d.url} (${d.result.status || d.result.error})`).join(', ')}`, 'content', 'fix or remove dead links');
  return pass(`${urls.length} ${scope} links resolve`);
}

async function runRoutes(fetchImpl: typeof fetch, paths: string[], c: Collector): Promise<Verdict> {
  const results = await mapLimit(paths, 4, async (path) => ({ path, result: await probe(fetchImpl, `${LANDING_URL}${path}`, { headers: { accept: 'text/html' } }) }));
  const bad = results.filter(({ result }) => result.status === 0 || result.status >= 400);
  for (const { path, result } of results) c.api.push(`GET ${LANDING_URL}${path} → ${result.status || result.error} ${result.ms}ms`);
  if (bad.length > 0) return fail(`routes failing: ${bad.map((b) => `${b.path} (${b.result.status || b.result.error})`).join(', ')}`, 'content', 'serve these routes (SPA fallback or real pages)');
  return pass(`${paths.length} routes respond`);
}

async function runApi(fetchImpl: typeof fetch, path: string, asserts: ApiAssert[], c: Collector): Promise<Verdict> {
  const result = await probe(fetchImpl, `${LANDING_API_URL}${path}`, { headers: { accept: 'application/json' } });
  c.api.push(`GET ${LANDING_API_URL}${path} → ${result.status || result.error} ${result.ms}ms`);
  const json = parseJson(result.text) as Record<string, unknown> | undefined;
  const problems: string[] = [];
  for (const assert of asserts) {
    switch (assert.assert) {
      case 'status': if (!assert.is.includes(result.status)) problems.push(`status ${result.status || result.error} not in [${assert.is.join(',')}]`); break;
      case 'json': if (json === undefined) problems.push('body is not JSON'); break;
      case 'content-type-json': if (!result.contentType.includes('application/json')) problems.push(`content-type "${result.contentType || 'none'}" is not application/json`); break;
      case 'array-at': {
        const value = json?.[assert.key];
        if (!Array.isArray(value)) problems.push(`"${assert.key}" is not an array`);
        else if (value.length < (assert.min ?? 0)) problems.push(`"${assert.key}" has ${value.length} < ${assert.min}`);
        break;
      }
      case 'has-keys': for (const key of assert.keys) if (!json || !(key in json)) problems.push(`missing key "${key}"`); break;
    }
  }
  if (path === '/health' && json && json.ok === false) problems.push(`health reports ok:false (${Array.isArray(json.degradedReasons) ? json.degradedReasons.join(',') : 'degraded'})`);
  if (path === '/version' && json && typeof json.commit === 'string') c.evidence.push(`production /version commit ${json.commit}`);
  if (problems.length > 0) return fail(problems.join('; '), result.status >= 500 || result.status === 0 ? 'infra' : 'api', `fix ${path} contract`);
  return pass(`${path} ok (${result.status}, ${result.ms}ms)`);
}

async function runDeals(fetchImpl: typeof fetch, assert: DealsAssert, c: Collector): Promise<Verdict> {
  const { probe: p, deals } = await loadDeals(fetchImpl);
  c.api.push(`GET ${LANDING_API_URL}/api/deals → ${p.status || p.error} ${p.ms}ms (${deals.length} deals)`);
  if (p.status !== 200) return fail(`/api/deals HTTP ${p.status || p.error}`, 'api', 'restore public deals API');
  const titles = deals.map(dealTitle);
  c.evidence.push(`deal titles: ${titles.slice(0, 8).map((t) => `"${truncate(t, 30)}"`).join(', ')}`);
  switch (assert.assert) {
    case 'min-count': return deals.length >= assert.min ? pass(`${deals.length} deals`) : fail(`${deals.length} deals < ${assert.min}`, 'content', 'publish missing deals');
    case 'present': return titles.some((t) => t.toLowerCase().includes(assert.title.toLowerCase())) ? pass(`"${assert.title}" present`) : fail(`"${assert.title}" missing from deals`, 'content', `publish ${assert.title}`);
    case 'order': {
      const indexes = assert.titles.map((t) => titles.findIndex((title) => title.toLowerCase().includes(t.toLowerCase())));
      if (indexes.some((i) => i < 0)) return fail(`cannot verify order — missing: ${assert.titles.filter((_, i) => indexes[i] < 0).join(', ')}`, 'content', 'publish missing deals');
      const ordered = indexes.every((value, i) => i === 0 || value > indexes[i - 1]);
      return ordered ? pass(`order ok: ${assert.titles.join(' → ')}`) : fail(`order is ${indexes.map((i) => `"${truncate(titles[i], 20)}"@${i}`).join(', ')}`, 'content', `reorder deals to ${assert.titles.join(' → ')}`);
    }
    case 'published': {
      const states = deals.map((d) => ({ title: dealTitle(d), published: dealPublished(d) }));
      if (states.every((s) => s.published === null)) return blocked(`no publication field in /api/deals contract (keys: ${Object.keys(deals[0] ?? {}).slice(0, 12).join(',')})`);
      const hidden = states.filter((s) => s.published === false);
      return hidden.length === 0 ? pass(`${states.length} deals published`) : fail(`unpublished deals exposed: ${hidden.map((h) => h.title).join(', ')}`, 'content', 'publish or hide these deals');
    }
    case 'unique-titles': {
      const dupes = titles.filter((t, i) => t && titles.indexOf(t) !== i);
      return dupes.length === 0 ? pass('titles unique') : fail(`duplicate titles: ${[...new Set(dupes)].join(', ')}`, 'content', 'remove duplicate deals');
    }
    case 'unique-ids': {
      const ids = deals.map(dealId);
      const missing = ids.filter((i) => !i).length;
      const dupes = ids.filter((i, idx) => i && ids.indexOf(i) !== idx);
      if (missing > 0) return fail(`${missing} deals without id/slug`, 'api', 'expose stable deal ids');
      return dupes.length === 0 ? pass('ids unique') : fail(`duplicate ids: ${[...new Set(dupes)].join(', ')}`, 'content', 'dedupe deals');
    }
    case 'financials': {
      const missing = deals.filter((d) => hasFinancials(d).length === 0).map(dealTitle);
      return missing.length === 0 ? pass(`financial fields present (${hasFinancials(deals[0] ?? {}).slice(0, 5).join(',')})`) : fail(`deals without financial data: ${missing.join(', ')}`, 'content', 'add price/raise/return fields');
    }
    case 'identity': {
      const missing = deals.filter((d) => !hasIdentity(d)).map(dealTitle);
      return missing.length === 0 ? pass('identity fields present') : fail(`deals without id+location: ${missing.join(', ')}`, 'content', 'add location/address to deals');
    }
    case 'cover': {
      const missing = deals.filter((d) => !hasCover(d)).map(dealTitle);
      return missing.length === 0 ? pass('cover media present') : fail(`deals without cover media: ${missing.join(', ')}`, 'media', 'attach cover image');
    }
    case 'images': {
      const missing = deals.filter((d) => dealMedia(d).images.length === 0).map(dealTitle);
      return missing.length === 0 ? pass(`images present on ${deals.length} deals`) : fail(`deals without images: ${missing.join(', ')}`, 'media', 'attach property images');
    }
    case 'videos': {
      const missing = deals.filter((d) => dealMedia(d).videos.length === 0).map(dealTitle);
      return missing.length === 0 ? pass('videos present') : fail(`deals without videos: ${missing.join(', ')}`, 'media', 'attach property videos');
    }
  }
}

async function mediaUrls(fetchImpl: typeof fetch, source: 'deals-images' | 'deals-videos' | 'landing-images' | 'reels-videos', c: Collector): Promise<{ urls: string[]; owners: Map<string, Set<string>>; emptyOwners: string[]; error: string | null }> {
  const owners = new Map<string, Set<string>>();
  const emptyOwners: string[] = [];
  const add = (url: string, owner: string) => { if (!owners.has(url)) owners.set(url, new Set()); owners.get(url)!.add(owner); };
  if (source === 'deals-images' || source === 'deals-videos') {
    const { probe: p, deals } = await loadDeals(fetchImpl);
    c.api.push(`GET ${LANDING_API_URL}/api/deals → ${p.status || p.error}`);
    if (p.status !== 200) return { urls: [], owners, emptyOwners, error: `/api/deals HTTP ${p.status || p.error}` };
    for (const deal of deals) {
      const media = dealMedia(deal);
      const list = source === 'deals-images' ? media.images : media.videos;
      if (list.length === 0) emptyOwners.push(dealTitle(deal) || dealId(deal) || 'untitled');
      for (const url of list) add(url, dealTitle(deal) || dealId(deal));
    }
  } else if (source === 'landing-images') {
    const page = await loadLandingHtml(fetchImpl);
    if (page.status !== 200) return { urls: [], owners, emptyOwners, error: `landing HTTP ${page.status || page.error}` };
    for (const img of tags(page.text, 'img')) { const src = absolute(img.attrs.src ?? img.attrs['data-src'] ?? '', `${LANDING_URL}/`); if (src && /^https?:/i.test(src)) add(src, 'landing'); }
  } else {
    const { probe: p, reels } = await loadReels(fetchImpl);
    c.api.push(`GET ${LANDING_API_URL}/api/reels → ${p.status || p.error} (${reels.length} reels)`);
    if (p.status !== 200) return { urls: [], owners, emptyOwners, error: `/api/reels HTTP ${p.status || p.error}` };
    for (const reel of reels) { const media = dealMedia(reel); const list = media.videos.length > 0 ? media.videos : media.images; if (list.length === 0) emptyOwners.push(dealId(reel) || 'reel'); for (const url of list) add(url, dealId(reel) || dealTitle(reel)); }
  }
  return { urls: [...owners.keys()], owners, emptyOwners, error: null };
}

async function runMedia(fetchImpl: typeof fetch, source: 'deals-images' | 'deals-videos' | 'landing-images' | 'reels-videos', assert: 'resolvable' | 'mime' | 'https' | 'weight' | 'no-duplicates' | 'no-missing', max: number | undefined, c: Collector): Promise<Verdict> {
  const { urls, owners, emptyOwners, error } = await mediaUrls(fetchImpl, source, c);
  if (error) return fail(error, 'api', 'restore source API');
  c.evidence.push(`${source}: ${urls.length} media urls`);
  if (assert === 'no-missing') return emptyOwners.length === 0 ? pass(`every ${source.split('-')[0]} item has media`) : fail(`no media on: ${emptyOwners.join(', ')}`, 'media', 'attach media');
  if (assert === 'no-duplicates') {
    const shared = [...owners.entries()].filter(([, set]) => set.size > 1);
    return shared.length === 0 ? pass(`${urls.length} media urls, none shared across items`) : fail(`cross-mapped media: ${shared.slice(0, 5).map(([url, set]) => `${truncate(url, 60)} ← ${[...set].join(' & ')}`).join('; ')}`, 'media', 'assign each media asset to exactly one property');
  }
  if (assert === 'https') {
    const bad = urls.filter((u) => !/^https:\/\//i.test(u) || /localhost|127\.0\.0\.1|\.local\b/i.test(u));
    return bad.length === 0 ? pass(`${urls.length} media urls https`) : fail(`non-https/local media: ${bad.slice(0, 5).map((u) => truncate(u, 60)).join(', ')}`, 'media', 'serve media from https CDN');
  }
  if (urls.length === 0) return source === 'deals-videos' ? pass('no video urls to verify (see deals.videos-present)') : fail(`no ${source} urls found`, 'media', 'attach media');
  const sample = urls.slice(0, max ?? 40);
  const results = await mapLimit(sample, MEDIA_CONCURRENCY, async (url) => ({ url, result: await headOrGet(fetchImpl, url) }));
  for (const { url, result } of results) c.api.push(`${truncate(url, 90)} → ${result.status || result.error} ${result.contentType || '-'} ${result.bytes}B`);
  if (assert === 'resolvable') {
    const dead = results.filter(({ result }) => result.status === 0 || result.status >= 400);
    return dead.length === 0 ? pass(`${sample.length}/${urls.length} media urls resolve`) : fail(`${dead.length}/${sample.length} media unreachable: ${dead.slice(0, 5).map((d) => `${truncate(d.url, 60)} (${d.result.status || d.result.error})`).join(', ')}`, 'media', 'fix broken/missing media URLs');
  }
  if (assert === 'mime') {
    const expected = source.includes('video') ? /^video\/|^application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)/ : /^image\//;
    const wrong = results.filter(({ result }) => result.status < 400 && result.status !== 0 && !expected.test(result.contentType) && !(result.contentType === '' && source.includes('video')));
    return wrong.length === 0 ? pass(`${sample.length} media with correct MIME`) : fail(`${wrong.length}/${sample.length} wrong MIME: ${wrong.slice(0, 5).map((w) => `${truncate(w.url, 50)} → ${w.result.contentType || 'none'}`).join(', ')}`, 'media', 'serve media with correct content-type');
  }
  // weight
  const heavy = results.filter(({ result }) => result.bytes > 1_500_000);
  const unknown = results.filter(({ result }) => result.bytes === 0 && result.status < 400).length;
  const total = results.reduce((sum, { result }) => sum + result.bytes, 0);
  c.evidence.push(`media weight total ${total}B (${unknown} unknown sizes)`);
  return heavy.length === 0 ? pass(`no image > 1.5MB (total ${Math.round(total / 1024)}KB)`) : fail(`${heavy.length} images > 1.5MB: ${heavy.slice(0, 4).map((h) => `${truncate(h.url, 50)} ${Math.round(h.result.bytes / 1024)}KB`).join(', ')}`, 'performance', 'compress/resize images');
}

async function runReels(fetchImpl: typeof fetch, assert: 'unique' | 'by-id' | 'metadata' | 'min-count', c: Collector): Promise<Verdict> {
  const { probe: p, reels } = await loadReels(fetchImpl);
  c.api.push(`GET ${LANDING_API_URL}/api/reels → ${p.status || p.error} ${p.ms}ms (${reels.length} reels)`);
  if (p.status !== 200) return fail(`/api/reels HTTP ${p.status || p.error}`, 'api', 'restore reels API');
  switch (assert) {
    case 'min-count': return reels.length > 0 ? pass(`${reels.length} reels`) : fail('reels feed empty', 'content', 'publish reels');
    case 'unique': {
      const ids = reels.map(dealId);
      const dupes = ids.filter((i, idx) => i && ids.indexOf(i) !== idx);
      const urls = reels.flatMap((r) => dealMedia(r).videos);
      const dupeUrls = urls.filter((u, idx) => urls.indexOf(u) !== idx);
      if (dupes.length > 0 || dupeUrls.length > 0) return fail(`duplicate reels: ids ${[...new Set(dupes)].join(',') || '-'} / media ${[...new Set(dupeUrls)].slice(0, 3).map((u) => truncate(u, 50)).join(',') || '-'}`, 'content', 'dedupe reels feed');
      return pass(`${reels.length} unique reels`);
    }
    case 'by-id': {
      const ids = reels.map(dealId).filter(Boolean).slice(0, 3);
      if (ids.length === 0) return fail('reels have no ids', 'api', 'expose reel ids');
      const results = await mapLimit(ids, 3, async (id) => ({ id, result: await probe(fetchImpl, `${LANDING_API_URL}/api/reels/${encodeURIComponent(id)}`, { headers: { accept: 'application/json' } }) }));
      for (const { id, result } of results) c.api.push(`GET /api/reels/${id} → ${result.status || result.error}`);
      const bad = results.filter(({ result }) => result.status !== 200);
      return bad.length === 0 ? pass(`${ids.length} reel detail endpoints ok`) : fail(`reel detail failing: ${bad.map((b) => `${b.id} (${b.result.status || b.result.error})`).join(', ')}`, 'api', 'fix /api/reels/:id');
    }
    case 'metadata': {
      const engagementKeys = /like|comment|share|view/i;
      const noTitle = reels.filter((r) => !['title', 'caption', 'description', 'name'].some((k) => typeof r[k] === 'string' && (r[k] as string).trim())).length;
      const anyEngagement = reels.some((r) => Object.keys(r).some((k) => engagementKeys.test(k)));
      const problems: string[] = [];
      if (noTitle > 0) problems.push(`${noTitle}/${reels.length} reels without title/caption`);
      if (!anyEngagement) problems.push('no like/comment/share counters in reels contract');
      return problems.length === 0 ? pass('reel metadata + engagement fields present') : fail(problems.join('; '), 'api', 'expose caption + engagement counters on reels');
    }
  }
}

const PROBE_EMAIL = `ivx-landing-p0-probe-${Date.now().toString(36)}@invalid.ivxholding.test`;
const VALID_REGISTRATION = { firstName: 'IVX', lastName: 'Probe', name: 'IVX Probe', email: PROBE_EMAIL, phone: '+15555550100', cell: '+15555550100', role: 'investor', zip: '33101', zipCode: '33101', password: 'Probe-Password-1!x' };

function isValidationStatus(status: number): boolean {
  return status === 400 || status === 422 || status === 409;
}

async function postJson(fetchImpl: typeof fetch, path: string, body: unknown, headers: Record<string, string> = {}): Promise<Probe> {
  return probe(fetchImpl, `${LANDING_API_URL}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json', ...headers }, body: JSON.stringify(body) });
}

function messageOf(result: Probe): string {
  const json = parseJson(result.text) as Record<string, unknown> | undefined;
  const value = json?.message ?? json?.error ?? json?.detail ?? '';
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}

async function runContract(fetchImpl: typeof fetch, probeName: string, c: Collector): Promise<Verdict> {
  const registration = async (payload: Record<string, unknown>, expectFieldHint: RegExp | null): Promise<Verdict> => {
    c.limiterWaitMs += await routeBudget('member-register', 3_600);
    const result = await postJson(fetchImpl, '/api/members/register', payload);
    const message = messageOf(result);
    c.api.push(`POST /api/members/register → ${result.status || result.error} "${truncate(message, 80)}"`);
    if (result.status === 429) return blocked('production rate limiter (429) — probe deferred, not a defect');
    if (result.status === 404) return fail('registration route missing (404)', 'api', 'mount /api/members/register');
    if (result.status >= 500 || result.status === 0) return fail(`registration ${result.status || result.error} on invalid input`, 'infra', 'handle validation without 5xx');
    if (result.status >= 200 && result.status < 300) return fail(`registration ACCEPTED invalid payload (${result.status}) — member may have been created for ${PROBE_EMAIL}`, 'api', 'enforce server-side validation');
    if (!isValidationStatus(result.status)) return fail(`unexpected ${result.status} for invalid registration`, 'api', 'return 400 with message');
    if (expectFieldHint && !expectFieldHint.test(message)) return pass(`rejected (${result.status}); message does not name the field: "${truncate(message, 60)}"`);
    return pass(`rejected ${result.status}: "${truncate(message, 60)}"`);
  };
  switch (probeName) {
    case 'register-empty': return registration({}, null);
    case 'register-missing-name': { const { firstName: _a, name: _b, ...rest } = VALID_REGISTRATION; return registration(rest, /name/i); }
    case 'register-missing-last-name': { const { lastName: _a, ...rest } = VALID_REGISTRATION; return registration({ ...rest, name: 'IVX' }, /last|name/i); }
    case 'register-invalid-email': return registration({ ...VALID_REGISTRATION, email: 'not-an-email' }, /email/i);
    case 'register-missing-cell': { const { phone: _a, cell: _b, ...rest } = VALID_REGISTRATION; return registration(rest, /phone|cell|mobile/i); }
    case 'register-invalid-role': return registration({ ...VALID_REGISTRATION, role: 'zzz-invalid-role' }, /role/i);
    case 'register-invalid-zip': return registration({ ...VALID_REGISTRATION, zip: 'ABC', zipCode: 'ABC' }, /zip|postal/i);
    case 'register-picture-optional': {
      const { firstName: _a, name: _b, ...rest } = VALID_REGISTRATION;
      const verdict = await registration(rest, null);
      if (verdict.status !== 'PASS') return verdict;
      const last = c.api[c.api.length - 1] ?? '';
      return /picture|photo|avatar|image/i.test(last) ? fail('validation demands a picture — picture must be optional', 'api', 'make picture optional') : pass('picture not required by validation');
    }
    case 'register-duplicate': {
      const owner = (process.env.IVX_OWNER_EMAIL ?? '').trim();
      if (!owner) return blocked('IVX_OWNER_EMAIL not configured on API host — cannot probe duplicate registration safely');
      c.limiterWaitMs += await routeBudget('member-register', 3_600);
      const result = await postJson(fetchImpl, '/api/members/register', { ...VALID_REGISTRATION, email: owner });
      const message = messageOf(result);
      c.api.push(`POST /api/members/register (duplicate) → ${result.status || result.error} "${truncate(message, 80)}"`);
      if (result.status === 429) return blocked('production rate limiter (429) — probe deferred');
      if (result.status >= 200 && result.status < 300) return fail('duplicate registration ACCEPTED (2xx) for existing owner email', 'auth', 'reject duplicate emails with 409');
      if (result.status >= 500 || result.status === 0) return fail(`duplicate registration → ${result.status || result.error}`, 'infra', 'handle duplicates without 5xx');
      return /exist|already|duplicate|taken|registered|in use/i.test(message) || result.status === 409 ? pass(`duplicate rejected ${result.status}: "${truncate(message, 60)}"`) : pass(`duplicate rejected ${result.status} (generic message)`);
    }
    case 'register-error-message': {
      const verdict = await registration({}, null);
      if (verdict.status !== 'PASS') return verdict;
      const last = c.api[c.api.length - 1] ?? '';
      const quoted = /"([^"]*)"/.exec(last)?.[1] ?? '';
      return quoted.length >= 8 ? pass(`human-readable error: "${truncate(quoted, 60)}"`) : fail('validation error has no human-readable message', 'api', 'return { message } on 400');
    }
    case 'login-empty': {
      c.limiterWaitMs += await routeBudget('member-login', 2_500);
      const result = await postJson(fetchImpl, '/api/members/login', {});
      c.api.push(`POST /api/members/login {} → ${result.status || result.error} "${truncate(messageOf(result), 60)}"`);
      if (result.status === 429) return blocked('production rate limiter (429)');
      if (result.status === 404) return fail('login route missing', 'api', 'mount /api/members/login');
      return isValidationStatus(result.status) || result.status === 401 ? pass(`login validates (${result.status})`) : fail(`login {} → ${result.status || result.error}`, result.status >= 500 ? 'infra' : 'auth', 'return 400 on empty credentials');
    }
    case 'login-invalid': {
      c.limiterWaitMs += await routeBudget('member-login', 2_500);
      const result = await postJson(fetchImpl, '/api/members/login', { email: PROBE_EMAIL, password: 'Wrong-Password-1!' });
      const message = messageOf(result);
      c.api.push(`POST /api/members/login (invalid) → ${result.status || result.error} ${result.ms}ms "${truncate(message, 60)}"`);
      if (result.status === 429) return blocked('production rate limiter (429)');
      if (result.status >= 200 && result.status < 300) return fail('login ACCEPTED unknown credentials', 'auth', 'reject invalid credentials');
      if (result.status >= 500 || result.status === 0) return fail(`login → ${result.status || result.error}`, 'infra', 'handle invalid login without 5xx');
      return /no user|not found|does not exist|unknown user/i.test(message) ? fail(`login leaks account existence: "${truncate(message, 50)}"`, 'security', 'use a generic invalid-credentials message') : pass(`invalid credentials rejected ${result.status} in ${result.ms}ms`);
    }
    case 'owner-login-guard': {
      c.limiterWaitMs += await routeBudget('owner-login', 12_000);
      const result = await postJson(fetchImpl, '/api/ivx/owner-passwordless-login', { email: (process.env.IVX_OWNER_EMAIL ?? 'owner@example.com').trim() });
      const json = parseJson(result.text) as Record<string, unknown> | undefined;
      c.api.push(`POST /api/ivx/owner-passwordless-login → ${result.status || result.error} code=${String(json?.code ?? json?.error ?? '-').slice(0, 40)}`);
      if (result.status === 429) return blocked('production rate limiter (429)');
      const tokenIssued = json && ['accessToken', 'token', 'session'].some((k) => k in json);
      if ((result.status >= 200 && result.status < 300) || tokenIssued) return fail('passwordless owner login issued a session without emergency mode', 'security', 'require password/emergency mode for owner login');
      return result.status >= 500 || result.status === 0 ? fail(`owner login guard → ${result.status || result.error}`, 'infra', 'handle guard without 5xx') : pass(`owner passwordless login refused (${result.status})`);
    }
    case 'forgot-invalid': {
      c.limiterWaitMs += await routeBudget('member-forgot', 11_000);
      const result = await postJson(fetchImpl, '/api/members/forgot-password', { email: 'not-an-email' });
      c.api.push(`POST /api/members/forgot-password (invalid) → ${result.status || result.error}`);
      if (result.status === 429) return blocked('production rate limiter (429)');
      if (result.status === 404) return fail('forgot-password route missing', 'api', 'mount /api/members/forgot-password');
      return result.status >= 500 || result.status === 0 ? fail(`forgot-password → ${result.status || result.error}`, 'infra', 'validate input') : pass(`forgot-password handled invalid email (${result.status})`);
    }
    case 'reset-invalid': {
      const result = await postJson(fetchImpl, '/api/members/reset-password', { token: 'invalid-reset-token', password: 'New-Password-1!x' });
      c.api.push(`POST /api/members/reset-password (invalid token) → ${result.status || result.error}`);
      if (result.status >= 200 && result.status < 300) return fail('reset-password ACCEPTED an invalid token', 'security', 'validate reset tokens');
      if (result.status === 404) return fail('reset-password route missing', 'api', 'mount /api/members/reset-password');
      return result.status >= 500 || result.status === 0 ? fail(`reset-password → ${result.status || result.error}`, 'infra', 'reject invalid token with 4xx') : pass(`invalid reset token rejected (${result.status})`);
    }
    case 'protected-unauth':
    case 'expired-token':
    case 'invalid-token': {
      const expired = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.' + Buffer.from(JSON.stringify({ sub: 'probe', exp: 1_600_000_000, role: 'authenticated' })).toString('base64url') + '.invalidsignature';
      const headers: Record<string, string> = probeName === 'protected-unauth' ? {} : { authorization: `Bearer ${probeName === 'expired-token' ? expired : 'invalid.token.value'}` };
      const result = await probe(fetchImpl, `${LANDING_API_URL}/api/ivx/autonomous-core/dashboard`, { headers: { accept: 'application/json', ...headers } });
      c.api.push(`GET /api/ivx/autonomous-core/dashboard (${probeName}) → ${result.status || result.error}`);
      if (result.status === 401 || result.status === 403) return pass(`protected route rejected ${probeName} (${result.status})`);
      if (result.status >= 200 && result.status < 300) return fail(`protected route served data with ${probeName}`, 'security', 'enforce auth guard');
      return fail(`protected route → ${result.status || result.error} for ${probeName}`, 'infra', 'return 401 for bad tokens');
    }
    case 'supabase-auth-settings': {
      const url = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? process.env.IVX_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
      const anon = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY ?? '').trim();
      if (!url) return blocked('SUPABASE_URL / EXPO_PUBLIC_SUPABASE_URL not configured on API host');
      if (!anon) return blocked('EXPO_PUBLIC_SUPABASE_ANON_KEY not configured on API host — cannot verify production auth binding');
      const result = await probe(fetchImpl, `${url}/auth/v1/settings`, { headers: { apikey: anon, accept: 'application/json' } });
      const json = parseJson(result.text) as Record<string, unknown> | undefined;
      c.api.push(`GET ${url.replace(/^https?:\/\/([^.]+).*/, 'https://$1…')}/auth/v1/settings → ${result.status || result.error}`);
      if (result.status !== 200 || !json) return fail(`supabase auth settings HTTP ${result.status || result.error}`, 'auth', 'verify SUPABASE_URL + anon key binding');
      const email = (json.external as Record<string, unknown> | undefined)?.email;
      return email === true ? pass('supabase auth reachable; email provider enabled') : fail('supabase email auth provider disabled', 'auth', 'enable email provider in Supabase Auth');
    }
    case 'env-diagnostic': {
      const result = await probe(fetchImpl, `${LANDING_API_URL}/api/ivx/landing-env-diagnostic`, { headers: { accept: 'application/json' } });
      c.api.push(`GET /api/ivx/landing-env-diagnostic → ${result.status || result.error}`);
      if (result.status === 401 || result.status === 403) return pass('env diagnostic is owner-gated (not public)');
      if (result.status !== 200) return fail(`env diagnostic HTTP ${result.status || result.error}`, 'api', 'restore diagnostic route');
      const leaks = scanForSecrets(result.text);
      if (leaks.length > 0) return fail(`env diagnostic leaks secret patterns: ${leaks.join(', ')}`, 'security', 'report booleans only, never values');
      const json = parseJson(result.text) as Record<string, unknown> | undefined;
      const flattened = JSON.stringify(json ?? {});
      const supabaseMissing = /"[^"]*supabase[^"]*"\s*:\s*(false|"missing"|"not[_ -]?configured"|null)/i.test(flattened);
      return supabaseMissing ? fail('diagnostic reports Supabase auth not configured', 'auth', 'configure production Supabase env on API host') : pass('production auth env reported configured; no secret values exposed');
    }
    default: return blocked(`unknown contract probe ${probeName}`);
  }
}

async function runSecurity(fetchImpl: typeof fetch, probeName: 'unauth-privileged' | 'no-secrets-body' | 'cors', path: string, method: 'GET' | 'POST' | undefined, c: Collector): Promise<Verdict> {
  if (probeName === 'unauth-privileged') {
    const init: RequestInit = method === 'POST' ? { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: '{}' } : { headers: { accept: 'application/json' } };
    const result = await probe(fetchImpl, `${LANDING_API_URL}${path}`, init);
    c.api.push(`${method ?? 'GET'} ${path} (no auth) → ${result.status || result.error}`);
    if (result.status === 401 || result.status === 403) return pass(`rejected unauthenticated (${result.status})`);
    if (result.status === 405 || result.status === 404) return fail(`route ${path} responded ${result.status} — cannot confirm guard (route missing/method mismatch)`, 'api', 'mount route or update audit path');
    if (result.status >= 200 && result.status < 300) return fail(`privileged route ${path} served ${result.status} WITHOUT auth`, 'security', 'add owner auth guard');
    return fail(`${path} → ${result.status || result.error} without auth`, 'infra', 'return 401 for unauthenticated access');
  }
  if (probeName === 'no-secrets-body') {
    const url = path.startsWith('landing:') ? `${LANDING_URL}${path.slice('landing:'.length)}` : `${LANDING_API_URL}${path}`;
    const result = path.startsWith('landing:') ? await loadLandingHtml(fetchImpl) : await probe(fetchImpl, url, { headers: { accept: 'application/json, text/html' } });
    c.api.push(`GET ${url} → ${result.status || result.error} ${result.bytes}B`);
    if (result.status === 401 || result.status === 403) return pass('body not public (auth-gated)');
    if (result.status !== 200) return fail(`HTTP ${result.status || result.error}`, 'infra', 'restore route');
    const codes = scanForSecrets(result.text);
    return codes.length === 0 ? pass(`no secret patterns in ${result.bytes}B body`) : fail(`secret patterns exposed: ${codes.join(', ')}`, 'security', 'remove secrets from public responses; rotate exposed keys');
  }
  // cors
  const origin = LANDING_URL;
  const preflight = await probe(fetchImpl, `${LANDING_API_URL}${path}`, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': 'GET' } });
  const actual = await probe(fetchImpl, `${LANDING_API_URL}${path}`, { headers: { origin, accept: 'application/json' } });
  const allow = preflight.headers?.get('access-control-allow-origin') ?? actual.headers?.get('access-control-allow-origin') ?? '';
  const credentials = (preflight.headers?.get('access-control-allow-credentials') ?? actual.headers?.get('access-control-allow-credentials') ?? '').toLowerCase() === 'true';
  c.api.push(`OPTIONS ${path} → ${preflight.status || preflight.error} ACAO=${allow || '-'}; GET → ${actual.status || actual.error}`);
  if (!allow) return fail(`no Access-Control-Allow-Origin for origin ${origin} on ${path}`, 'api', 'enable CORS for the landing origin');
  if (allow === '*' && credentials) return fail('CORS wildcard origin combined with credentials', 'security', 'echo allowed origins instead of *');
  if (allow !== '*' && allow.replace(/\/+$/, '') !== origin) return fail(`ACAO ${allow} does not allow ${origin}`, 'api', 'allow the landing origin');
  return pass(`CORS ok (ACAO=${allow}${credentials ? ', credentials' : ''})`);
}

async function runPerf(fetchImpl: typeof fetch, base: 'landing' | 'api', path: string, maxMs: number, maxBytes: number | undefined, c: Collector): Promise<Verdict> {
  const url = `${base === 'landing' ? LANDING_URL : LANDING_API_URL}${path}`;
  const first = await probe(fetchImpl, url, { headers: { accept: base === 'landing' ? 'text/html' : 'application/json' } });
  const second = first.ms > maxMs ? await probe(fetchImpl, url, { headers: { accept: base === 'landing' ? 'text/html' : 'application/json' } }) : null;
  const best = second && second.ms < first.ms ? second : first;
  c.api.push(`GET ${url} → ${first.status || first.error} ${first.ms}ms${second ? ` / retry ${second.status} ${second.ms}ms` : ''} ${best.bytes}B`);
  if (best.status !== 200) return fail(`HTTP ${best.status || best.error}`, 'infra', 'restore availability');
  if (best.ms > maxMs) return fail(`${best.ms}ms > ${maxMs}ms budget (2 attempts)`, 'performance', 'reduce server latency / cold starts');
  if (maxBytes && best.bytes > maxBytes) return fail(`${best.bytes}B > ${maxBytes}B budget`, 'performance', 'reduce payload size');
  return pass(`${best.ms}ms, ${best.bytes}B`);
}

async function runCi(fetchImpl: typeof fetch, workflow: string, check: string, productionSha: string, c: Collector): Promise<Verdict> {
  const { runs, blocked: blockedReason } = await loadCiRuns(fetchImpl, productionSha);
  c.browser.push(`${workflow} :: ${check} @ ${productionSha.slice(0, 9)}`);
  if (blockedReason) return blocked(blockedReason);
  const matching = runs.filter((run) => run.name === workflow).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  if (matching.length === 0) return blocked(`no "${workflow}" run exists for production SHA ${productionSha.slice(0, 9)} — dispatch it (workflow_dispatch) to produce browser evidence`);
  const latest = matching[0];
  c.evidence.push(`workflow_run_id=${latest.id} ${latest.html_url} status=${latest.status} conclusion=${latest.conclusion ?? '-'}`);
  if (latest.status !== 'completed') return blocked(`"${workflow}" run ${latest.id} still ${latest.status}`);
  if (latest.conclusion === 'success') return pass(`"${workflow}" run ${latest.id} succeeded on exact SHA`);
  return fail(`"${workflow}" run ${latest.id} concluded ${latest.conclusion}`, 'ci', `open ${latest.html_url} and fix the failing ${check} job`);
}

async function runShaMatch(fetchImpl: typeof fetch, productionSha: string, c: Collector): Promise<Verdict> {
  const main = await fetchMainSha(fetchImpl);
  c.evidence.push(`main=${main ?? 'unknown'} production=${productionSha}`);
  if (!main) return blocked('main SHA unavailable (GitHub API unreachable or rate-limited)');
  return main === productionSha ? pass(`main == production (${productionSha.slice(0, 9)})`) : fail(`main ${main.slice(0, 9)} != production ${productionSha.slice(0, 9)}`, 'infra', 'deploy main to production (or wait for in-flight deploy)');
}

async function runCertificate(fetchImpl: typeof fetch, productionSha: string, c: Collector): Promise<Verdict> {
  const tasks = await getAllTasks();
  const audits = tasks.filter((t) => { const parsed = parseLandingTaskKey(t.idempotencyKey); return parsed && !parsed.repair && parsed.sha === productionSha && parsed.unitId !== 'e2e.certificate'; });
  const notDone = audits.filter((t) => !TERMINAL_SUCCESS_STATES.includes(t.state));
  const failing: string[] = [];
  for (const task of audits) {
    for (const evidence of task.evidence) {
      if (!evidence.summary.startsWith('LANDING_P0_RESULT ')) continue;
      try {
        const record = JSON.parse(evidence.summary.slice('LANDING_P0_RESULT '.length)) as { status?: string; unit_id?: string };
        if (record.status && record.status !== 'PASS') failing.push(`${record.unit_id ?? task.title}=${record.status}`);
      } catch { /* ignore malformed */ }
    }
  }
  const main = await fetchMainSha(fetchImpl);
  c.evidence.push(`audits=${audits.length} notDone=${notDone.length} failing=${failing.length} main=${main ?? 'unknown'}`);
  if (audits.length === 0) return blocked('no Landing audit units found for this SHA');
  if (notDone.length > 0) return blocked(`${notDone.length} audit units not yet VERIFIED`);
  if (failing.length > 0) return fail(`certificate FAIL — ${failing.length} unit(s) not PASS: ${[...new Set(failing)].slice(0, 12).join(', ')}`, 'unknown', 'resolve listed units, then re-run certificate');
  if (!main) return blocked('main SHA unavailable — cannot certify exact SHA');
  if (main !== productionSha) return fail(`main ${main.slice(0, 9)} != production ${productionSha.slice(0, 9)}`, 'infra', 'deploy main');
  return pass(`LANDING CERTIFICATE PASS for ${productionSha} (${audits.length} units PASS, main == production)`);
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function executeLandingUnit(unit: LandingUnit, ctx: LandingExecutionContext, deps: ExecutorDeps = {}): Promise<LandingUnitExecution> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const startedAt = nowIso();
  const startedMs = Date.now();
  const c: Collector = { api: [], browser: [], files: [], evidence: [], limiterWaitMs: 0 };
  let verdict: Verdict;
  try {
    const check = unit.check;
    switch (check.kind) {
      case 'html': verdict = await runHtmlAsserts(fetchImpl, check.asserts, c); break;
      case 'css-media': verdict = await runCssMedia(fetchImpl, check.query, c); break;
      case 'links': verdict = await runLinks(fetchImpl, check.scope, check.max, c); break;
      case 'routes': verdict = await runRoutes(fetchImpl, check.paths, c); break;
      case 'api': verdict = await runApi(fetchImpl, check.path, check.asserts, c); break;
      case 'deals': verdict = await runDeals(fetchImpl, check.assert, c); break;
      case 'media': verdict = await runMedia(fetchImpl, check.source, check.assert, check.max, c); break;
      case 'reels': verdict = await runReels(fetchImpl, check.assert, c); break;
      case 'contract': verdict = await runContract(fetchImpl, check.probe, c); break;
      case 'security': verdict = await runSecurity(fetchImpl, check.probe, check.path, check.method, c); break;
      case 'perf': verdict = await runPerf(fetchImpl, check.base, check.path, check.maxMs, check.maxBytes, c); break;
      case 'ci': verdict = await runCi(fetchImpl, check.workflow, check.check, ctx.productionSha, c); break;
      case 'sha-match': verdict = await runShaMatch(fetchImpl, ctx.productionSha, c); break;
      case 'certificate': verdict = await runCertificate(fetchImpl, ctx.productionSha, c); break;
    }
  } catch (error) {
    verdict = fail(`executor exception: ${error instanceof Error ? error.message : String(error)}`, 'unknown', 'inspect executor logs');
  }
  const completedAt = nowIso();
  const productiveSeconds = Math.max(0, Math.round(((Date.now() - startedMs - c.limiterWaitMs) / 1000) * 10) / 10);
  const defectCode = unit.unitId.replace(/[^a-z0-9.-]/gi, '_');
  const bugs: LandingDefect[] = verdict.status === 'FAIL'
    ? [{ code: defectCode, severity: unit.severity, detail: truncate(verdict.detail, 300), root_cause: verdict.rootCause ?? 'unknown', remediation: truncate(verdict.remediation ?? 'investigate', 200) }]
    : [];
  const fixes = ctx.repair && verdict.status === 'PASS' ? [`re-verified ${unit.unitId}: defect no longer reproducible`] : [];
  const evidenceLines = [...c.evidence, ...c.api.slice(0, 12), ...c.browser].map((line) => truncate(line, 200));
  const record: LandingResultRecord = {
    v: 1,
    unit_id: unit.unitId,
    agent_number: ctx.agentNumber,
    status: verdict.status,
    started_at: startedAt,
    completed_at: completedAt,
    productive_seconds: productiveSeconds,
    production_sha: ctx.productionSha,
    api_checks: c.api.length,
    browser_checks: c.browser.length,
    bugs_found: bugs,
    fixes_applied: fixes,
    blocked_reason: verdict.status === 'BLOCKED' ? truncate(verdict.blockedReason ?? verdict.detail, 240) : null,
    evidence: evidenceLines.slice(0, 6),
    repair: ctx.repair,
  };
  const full: LandingEvidenceObject = {
    schema: 'ivx-landing-p0-evidence-v1',
    agent_id: ctx.agentId,
    agent_number: ctx.agentNumber,
    task_id: ctx.taskId,
    unit_id: unit.unitId,
    workstream: unit.workstream,
    started_at: startedAt,
    completed_at: completedAt,
    productive_seconds: productiveSeconds,
    repo_sha_before: ctx.sourceSha,
    repo_sha_after: ctx.sourceSha,
    files_inspected: [...new Set(c.files)],
    files_changed: [],
    tests_run: [unit.unitId],
    test_results: [`${unit.unitId}: ${verdict.status} — ${truncate(verdict.detail, 200)}`],
    browser_checks: c.browser,
    api_checks: c.api,
    bugs_found: bugs,
    fixes_applied: fixes,
    commit_sha: null,
    pr_number: null,
    deploy_id: null,
    production_sha: ctx.productionSha,
    status: verdict.status,
    blocked_reason: record.blocked_reason,
    evidence: evidenceLines,
  };
  return { record, full };
}
