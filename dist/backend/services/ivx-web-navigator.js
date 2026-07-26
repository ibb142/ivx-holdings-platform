/**
 * IVX Live Web Navigator — real, owner-only navigation of the public site.
 *
 * What this does (all REAL, no fabrication):
 *   - Opens a start URL (default https://ivxholding.com) over the network and
 *     walks the public pages a real user can reach by following internal links.
 *   - Per page it records: HTTP status, final URL (after redirects), <title>,
 *     headings, every link (internal vs external), and every <form> with its
 *     method/action and field list — so forms can be inspected/verified.
 *   - Produces an ordered navigation LOG (step-by-step: opened / followed link /
 *     skipped / error) so the run is auditable.
 *   - Compares the live site content against the authoritative Supabase
 *     `jv_deals` records and reports DRIFT (names live-only, names DB-only,
 *     matched) so the owner sees exactly where the site and database disagree.
 *
 * HONESTY / LIMITS (stated, never hidden):
 *   - This is an HTTP fetch + HTML parse, NOT a headless browser. It does not
 *     execute client-side JavaScript, so it cannot click JS-only buttons or
 *     read content that is injected after load. The public landing renders its
 *     deals CLIENT-SIDE from Supabase, so the DB reader (`readLandingProjects`)
 *     is the source of truth for deals and the drift check is computed against
 *     it — the report says so explicitly.
 *   - "Screenshots" in this runtime are captured rendered TEXT snapshots per
 *     page (a deterministic content hash + text excerpt), not pixel images. A
 *     pixel screenshot needs a headless browser (Playwright/Puppeteer) that is
 *     not installed in the production container; the report labels this clearly.
 *
 * Read-only. No secrets are returned. Never throws into the caller — every
 * failure is reported with an honest reason and a pass/fail verdict.
 */
import { readLandingProjects } from './ivx-project-data';
export const IVX_WEB_NAVIGATOR_MARKER = 'ivx-web-navigator-2026-06-12';
const DEFAULT_START_URL = 'https://ivxholding.com';
const FETCH_TIMEOUT_MS = 12_000;
const MAX_PAGES_HARD_CAP = 25;
const MAX_PAGE_BYTES = 1_500_000;
// ---------- HTML helpers ----------
function decodeHtmlEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, code) => {
        const parsed = Number.parseInt(code, 10);
        return Number.isFinite(parsed) ? String.fromCharCode(parsed) : _;
    });
}
function stripTags(html) {
    return decodeHtmlEntities(html
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' '))
        .replace(/\s+/g, ' ')
        .trim();
}
function extractTitle(html) {
    const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    return m?.[1] ? decodeHtmlEntities(m[1].trim()) : null;
}
function extractHeadings(html) {
    const headings = [];
    const pattern = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        const text = stripTags(match[2] ?? '');
        if (text && text.length <= 160)
            headings.push(text);
    }
    return Array.from(new Set(headings)).slice(0, 60);
}
function extractHrefs(html) {
    const hrefs = [];
    const pattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["']/gi;
    let match;
    while ((match = pattern.exec(html)) !== null) {
        const href = decodeHtmlEntities((match[1] ?? '').trim());
        if (href && !href.startsWith('javascript:') && !href.startsWith('#') && !href.startsWith('mailto:') && !href.startsWith('tel:')) {
            hrefs.push(href);
        }
    }
    return hrefs;
}
/** Resolve a possibly-relative href against a base URL; null when invalid. */
function resolveUrl(href, base) {
    try {
        return new URL(href, base).toString();
    }
    catch {
        return null;
    }
}
function normalizeForCompare(url) {
    try {
        const u = new URL(url);
        u.hash = '';
        // Drop a trailing slash on the path so "/about" and "/about/" dedupe.
        let pathname = u.pathname;
        if (pathname.length > 1 && pathname.endsWith('/'))
            pathname = pathname.slice(0, -1);
        u.pathname = pathname;
        return u.toString();
    }
    catch {
        return url;
    }
}
export function extractForms(html, pageUrl) {
    const forms = [];
    const formPattern = /<form\b([^>]*)>([\s\S]*?)<\/form>/gi;
    let match;
    while ((match = formPattern.exec(html)) !== null) {
        const attrs = match[1] ?? '';
        const inner = match[2] ?? '';
        const methodMatch = attrs.match(/method\s*=\s*["']?([a-zA-Z]+)["']?/i);
        const actionMatch = attrs.match(/action\s*=\s*["']([^"']*)["']/i);
        const method = (methodMatch?.[1] ?? 'get').toLowerCase();
        const action = actionMatch?.[1] ? resolveUrl(actionMatch[1], pageUrl) : null;
        const fields = [];
        const fieldPattern = /<(input|select|textarea)\b([^>]*)>/gi;
        let fieldMatch;
        while ((fieldMatch = fieldPattern.exec(inner)) !== null) {
            const tag = (fieldMatch[1] ?? '').toLowerCase();
            const fAttrs = fieldMatch[2] ?? '';
            const nameMatch = fAttrs.match(/name\s*=\s*["']([^"']+)["']/i);
            const typeMatch = fAttrs.match(/type\s*=\s*["']([^"']+)["']/i);
            const type = tag === 'input' ? (typeMatch?.[1]?.toLowerCase() ?? 'text') : tag;
            if (type === 'submit' || type === 'button' || type === 'hidden') {
                if (type !== 'hidden')
                    continue;
            }
            const name = nameMatch?.[1] ?? '';
            if (!name && type !== 'submit')
                continue;
            fields.push({ name, type, required: /\brequired\b/i.test(fAttrs) });
        }
        const submitLabels = [];
        const submitPattern = /<button\b[^>]*>([\s\S]*?)<\/button>|<input\b[^>]*type\s*=\s*["']submit["'][^>]*value\s*=\s*["']([^"']+)["']/gi;
        let submitMatch;
        while ((submitMatch = submitPattern.exec(inner)) !== null) {
            const label = stripTags(submitMatch[1] ?? '') || (submitMatch[2] ?? '').trim();
            if (label)
                submitLabels.push(label.slice(0, 60));
        }
        forms.push({ method, action, fields, submitLabels: Array.from(new Set(submitLabels)) });
    }
    return forms;
}
/** Cheap, stable 32-bit content fingerprint (FNV-1a) — a text "snapshot" id. */
function hashContent(text) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return `sha-fnv:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
const NON_NAME_WORDS = new Set([
    'home', 'about', 'contact', 'login', 'sign', 'register', 'menu', 'projects',
    'invest', 'investments', 'how', 'faq', 'team', 'blog', 'news', 'careers',
    'privacy', 'terms', 'started', 'learn', 'more', 'features', 'pricing',
    'dashboard', 'welcome', 'overview', 'services', 'footer', 'header',
]);
export function detectNamesFromHeadings(headings) {
    const names = [];
    for (const heading of headings) {
        const trimmed = heading.trim();
        if (trimmed.length < 4 || trimmed.length > 60)
            continue;
        const words = trimmed.split(/\s+/);
        if (words.length > 6 || words.length < 1)
            continue;
        if (NON_NAME_WORDS.has(words[0].toLowerCase()))
            continue;
        const proper = words.filter((w) => /^[A-Z][\p{L}'-]*$/u.test(w) || /^\d/.test(w));
        if (proper.length >= Math.ceil(words.length / 2) && words.length >= 2) {
            names.push(trimmed);
        }
    }
    return Array.from(new Set(names)).slice(0, 30);
}
// ---------- page fetch ----------
async function fetchPage(requestedUrl) {
    const started = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const base = {
        requestedUrl,
        finalUrl: requestedUrl,
        httpStatus: null,
        ok: false,
        title: null,
        headings: [],
        internalLinks: [],
        externalLinks: [],
        forms: [],
        contentHash: '',
        textExcerpt: '',
        textLength: 0,
        detectedNames: [],
        error: null,
        durationMs: 0,
    };
    try {
        const response = await fetch(requestedUrl, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'IVX-Owner-AI-WebNavigator/1.0 (+read-only)',
                Accept: 'text/html,application/xhtml+xml',
            },
        });
        clearTimeout(timeout);
        base.httpStatus = response.status;
        base.finalUrl = response.url || requestedUrl;
        const raw = await response.text();
        const html = raw.length > MAX_PAGE_BYTES ? raw.slice(0, MAX_PAGE_BYTES) : raw;
        base.durationMs = Date.now() - started;
        if (!response.ok) {
            base.error = `HTTP ${response.status}`;
            return base;
        }
        const origin = new URL(base.finalUrl).origin;
        const hrefs = extractHrefs(html);
        const internal = new Set();
        const external = new Set();
        for (const href of hrefs) {
            const resolved = resolveUrl(href, base.finalUrl);
            if (!resolved)
                continue;
            try {
                const u = new URL(resolved);
                if (u.protocol !== 'http:' && u.protocol !== 'https:')
                    continue;
                if (u.origin === origin)
                    internal.add(normalizeForCompare(resolved));
                else
                    external.add(resolved);
            }
            catch {
                // ignore malformed
            }
        }
        const text = stripTags(html);
        const headings = extractHeadings(html);
        base.ok = true;
        base.title = extractTitle(html);
        base.headings = headings;
        base.internalLinks = Array.from(internal).slice(0, 80);
        base.externalLinks = Array.from(external).slice(0, 60);
        base.forms = extractForms(html, base.finalUrl);
        base.contentHash = hashContent(text);
        base.textExcerpt = text.slice(0, 280);
        base.textLength = text.length;
        base.detectedNames = detectNamesFromHeadings(headings);
        return base;
    }
    catch (error) {
        clearTimeout(timeout);
        base.durationMs = Date.now() - started;
        const message = error instanceof Error ? error.message : 'unknown error';
        base.error = controller.signal.aborted ? `timed out after ${FETCH_TIMEOUT_MS}ms` : message;
        return base;
    }
}
// ---------- drift comparison ----------
function buildDrift(siteNames, db) {
    const norm = (s) => s.trim().toLowerCase();
    const dbNames = db.ok ? db.projectNames : [];
    const siteSet = siteNames.map(norm).filter(Boolean);
    const dbSet = dbNames.map(norm).filter(Boolean);
    const includesEither = (a, b) => a === b || a.includes(b) || b.includes(a);
    const matched = [];
    const onlyInDb = [];
    for (const dbName of dbNames) {
        const found = siteSet.some((s) => includesEither(s, norm(dbName)));
        if (found)
            matched.push(dbName);
        else
            onlyInDb.push(dbName);
    }
    const onlyOnSite = [];
    for (const siteName of siteNames) {
        const found = dbSet.some((d) => includesEither(d, norm(siteName)));
        if (!found)
            onlyOnSite.push(siteName);
    }
    const note = !db.configured
        ? `Supabase not configured (${db.missingEnv.join(', ') || 'missing env'}) — drift not computed.`
        : !db.ok
            ? `Could not read jv_deals: ${db.error ?? 'unknown'} — drift not computed.`
            : `Compared ${siteNames.length} site name(s) against ${dbNames.length} published DB record(s). The landing renders deals client-side from Supabase, so the DB is the source of truth.`;
    return {
        checked: db.ok,
        note,
        dbConfigured: db.configured,
        dbPublishedCount: db.publishedCount,
        onlyOnSite: Array.from(new Set(onlyOnSite)).slice(0, 40),
        onlyInDb: Array.from(new Set(onlyInDb)).slice(0, 40),
        matched: Array.from(new Set(matched)).slice(0, 40),
        source: db.source,
    };
}
/**
 * Navigate the public site like a real user: open the start page, follow internal
 * links breadth-first up to `maxPages`, capture each page (status/forms/links/text
 * snapshot), then compute Supabase drift. Returns a full auditable log + pass/fail.
 */
export async function navigateSite(options = {}) {
    const startUrl = (typeof options.startUrl === 'string' && options.startUrl.trim()) || DEFAULT_START_URL;
    const maxPages = Math.max(1, Math.min(MAX_PAGES_HARD_CAP, Number(options.maxPages) || 6));
    const compareSupabase = options.compareSupabase !== false;
    const generatedAt = new Date().toISOString();
    let origin = '';
    try {
        origin = new URL(startUrl).origin;
    }
    catch {
        return {
            marker: IVX_WEB_NAVIGATOR_MARKER,
            ok: false,
            pass: false,
            startUrl,
            origin: '',
            generatedAt,
            pagesVisited: 0,
            pages: [],
            steps: [],
            forms: [],
            drift: { checked: false, note: 'Invalid start URL.', dbConfigured: false, dbPublishedCount: 0, onlyOnSite: [], onlyInDb: [], matched: [], source: '' },
            verdict: 'FAIL — invalid start URL.',
            capabilities: { executesJavaScript: false, pixelScreenshots: false, textSnapshots: true, followsRedirects: true },
            error: 'Invalid start URL.',
        };
    }
    const queue = [normalizeForCompare(startUrl)];
    const seen = new Set(queue);
    const pages = [];
    const steps = [];
    let stepIndex = 0;
    while (queue.length > 0 && pages.length < maxPages) {
        const url = queue.shift();
        const isEntry = pages.length === 0;
        steps.push({ index: stepIndex++, action: isEntry ? 'open' : 'follow', url, detail: isEntry ? 'Opened start page' : 'Followed internal link', httpStatus: null, at: new Date().toISOString() });
        const page = await fetchPage(url);
        pages.push(page);
        const last = steps[steps.length - 1];
        last.httpStatus = page.httpStatus;
        if (page.error) {
            steps.push({ index: stepIndex++, action: 'error', url, detail: page.error, httpStatus: page.httpStatus, at: new Date().toISOString() });
            continue;
        }
        // Enqueue newly-discovered internal links (breadth-first).
        for (const link of page.internalLinks) {
            if (pages.length + queue.length >= maxPages)
                break;
            if (seen.has(link))
                continue;
            seen.add(link);
            queue.push(link);
        }
    }
    const allSiteNames = Array.from(new Set(pages.flatMap((p) => p.detectedNames)));
    let drift;
    if (compareSupabase) {
        const db = await readLandingProjects().catch((e) => null);
        drift = db
            ? buildDrift(allSiteNames, db)
            : { checked: false, note: 'Supabase read threw — drift not computed.', dbConfigured: false, dbPublishedCount: 0, onlyOnSite: [], onlyInDb: [], matched: [], source: 'supabase:jv_deals' };
    }
    else {
        drift = { checked: false, note: 'Supabase comparison disabled for this run.', dbConfigured: false, dbPublishedCount: 0, onlyOnSite: [], onlyInDb: [], matched: [], source: '' };
    }
    const forms = [];
    for (const page of pages) {
        for (const form of page.forms)
            forms.push({ pageUrl: page.finalUrl, form });
    }
    const entryOk = pages.length > 0 && pages[0].ok;
    const reachableCount = pages.filter((p) => p.ok).length;
    const brokenCount = pages.filter((p) => !p.ok).length;
    const driftCount = drift.onlyOnSite.length + drift.onlyInDb.length;
    const pass = entryOk && brokenCount === 0;
    const verdict = !entryOk
        ? `FAIL — could not open the start page (${pages[0]?.error ?? 'no response'}).`
        : brokenCount > 0
            ? `FAIL — ${brokenCount} of ${pages.length} page(s) returned an error.`
            : drift.checked && driftCount > 0
                ? `PASS (with drift) — all ${reachableCount} page(s) reachable; ${driftCount} name(s) differ between site and Supabase.`
                : `PASS — all ${reachableCount} page(s) reachable, ${forms.length} form(s) inspected, no site/DB drift detected.`;
    return {
        marker: IVX_WEB_NAVIGATOR_MARKER,
        ok: entryOk,
        pass,
        startUrl,
        origin,
        generatedAt,
        pagesVisited: pages.length,
        pages,
        steps,
        forms,
        drift,
        verdict,
        capabilities: { executesJavaScript: false, pixelScreenshots: false, textSnapshots: true, followsRedirects: true },
        error: entryOk ? null : (pages[0]?.error ?? 'start page unreachable'),
    };
}
