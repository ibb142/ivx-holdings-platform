/**
 * IVX Landing Page Inspector
 *
 * Live, read-only HTTP fetch + parse of the public IVX landing page
 * (ivxholding.com). Unlike `ivx-senior-dev-tools.toolLandingAudit`, which only
 * reads the LOCAL landing source in `expo/ivxholding-landing`, this inspector
 * fetches the actual rendered HTML over the network so the Owner AI can answer
 * questions about what is really live on the site: project cards, project names
 * (e.g. "Casa Rosario"), CTAs, links, and per-project details when present.
 *
 * Everything here is read-only. No secrets are used or returned.
 */
const DEFAULT_LANDING_URL = 'https://ivxholding.com';
const FETCH_TIMEOUT_MS = 12_000;
/** Words that look like headings but are navigation/marketing chrome, not project names. */
const NON_PROJECT_HEADING_WORDS = new Set([
    'home', 'about', 'about us', 'contact', 'contact us', 'login', 'log in', 'sign in',
    'sign up', 'signup', 'register', 'menu', 'projects', 'our projects', 'portfolio',
    'invest', 'investments', 'how it works', 'faq', 'faqs', 'team', 'our team', 'blog',
    'news', 'careers', 'privacy', 'terms', 'get started', 'learn more', 'features',
    'testimonials', 'pricing', 'dashboard', 'welcome', 'overview', 'services',
    'why ivx', 'why choose us', 'footer', 'header', 'navigation',
]);
function resolveLandingUrl(override) {
    const explicit = typeof override === 'string' ? override.trim() : '';
    if (explicit) {
        return explicit;
    }
    const fromEnv = (process.env.IVX_LANDING_URL ?? '').trim();
    if (fromEnv) {
        return fromEnv;
    }
    return DEFAULT_LANDING_URL;
}
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
function extractFirstMatch(html, pattern) {
    const match = html.match(pattern);
    return match?.[1] ? decodeHtmlEntities(match[1].trim()) : null;
}
function extractHeadings(html) {
    const headings = [];
    const headingPattern = /<(h[1-3])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let match;
    while ((match = headingPattern.exec(html)) !== null) {
        const text = stripTags(match[2] ?? '');
        if (text && text.length <= 160) {
            headings.push(text);
        }
    }
    return Array.from(new Set(headings)).slice(0, 60);
}
function extractLinks(html) {
    const links = [];
    const linkPattern = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = linkPattern.exec(html)) !== null) {
        const href = decodeHtmlEntities((match[1] ?? '').trim());
        const text = stripTags(match[2] ?? '');
        if (href && !href.startsWith('javascript:')) {
            links.push({ text, href });
        }
    }
    // De-dup by href+text
    const seen = new Set();
    return links
        .filter((link) => {
        const key = `${link.text}|${link.href}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    })
        .slice(0, 80);
}
function extractImageAlts(html) {
    const alts = [];
    const imgPattern = /<img\b[^>]*\balt\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let match;
    while ((match = imgPattern.exec(html)) !== null) {
        const alt = decodeHtmlEntities((match[1] ?? '').trim());
        if (alt) {
            alts.push(alt);
        }
    }
    return Array.from(new Set(alts)).slice(0, 60);
}
function isCtaLink(link) {
    const text = link.text.toLowerCase();
    const href = link.href.toLowerCase();
    return /\b(invest|get\s+started|sign\s*up|signup|register|join|apply|contact|book|schedule|learn\s+more|view\s+project|explore|buy|reserve|start)\b/.test(text)
        || /\/(signup|sign-up|register|invest|apply|contact|get-started|join)\b/.test(href);
}
function looksLikeProjectName(heading) {
    const trimmed = heading.trim();
    const lower = trimmed.toLowerCase();
    if (!trimmed || trimmed.length < 3 || trimmed.length > 60) {
        return false;
    }
    if (NON_PROJECT_HEADING_WORDS.has(lower)) {
        return false;
    }
    // A project name is typically a proper noun: 1–5 words, each starting with a
    // capital letter (e.g. "Casa Rosario", "The Highlands Residences").
    const words = trimmed.split(/\s+/);
    if (words.length > 6) {
        return false;
    }
    const capitalizedWords = words.filter((word) => /^[A-Z][\p{L}'-]*$/u.test(word) || /^\d/.test(word));
    // At least half the words look like proper-noun parts.
    return capitalizedWords.length >= Math.ceil(words.length / 2);
}
/**
 * Extract per-project details from plain text near a project name. Heuristic but
 * grounded in the live page text — captures labelled values when present.
 */
function extractProjectDetail(text, label) {
    const match = text.match(label);
    return match?.[1] ? match[1].trim().replace(/\s+/g, ' ').slice(0, 80) : null;
}
export function extractLandingProjectsFromHtml(html) {
    const headings = extractHeadings(html);
    const fullText = stripTags(html);
    const projects = [];
    const seenNames = new Set();
    for (const heading of headings) {
        if (!looksLikeProjectName(heading)) {
            continue;
        }
        const key = heading.toLowerCase();
        if (seenNames.has(key)) {
            continue;
        }
        // Capture the window of text following the project name on the page.
        const index = fullText.indexOf(heading);
        const rawText = index >= 0 ? fullText.slice(index, index + 600) : heading;
        // Only treat as a project if the surrounding text has investment-like signals,
        // OR the name is multi-word proper noun (likely a property/project).
        const hasInvestmentSignal = /\b(price|roi|return|invest|ownership|timeline|completion|location|units?|yield|\$|usd|eur|sqm|sq\s*ft|bedrooms?)\b/i.test(rawText);
        const isMultiWordProper = heading.trim().split(/\s+/).length >= 2;
        if (!hasInvestmentSignal && !isMultiWordProper) {
            continue;
        }
        seenNames.add(key);
        projects.push({
            name: heading,
            location: extractProjectDetail(rawText, /\blocation[:\s]+([^.|\n]{2,60})/i),
            price: extractProjectDetail(rawText, /\b(?:price|from|starting at)[:\s]+([$€£]?\s?[\d.,]+\s?[a-zA-Z]{0,3}[^.|\n]{0,20})/i)
                ?? extractProjectDetail(rawText, /([$€£]\s?[\d.,]+\s?(?:million|m|k)?)/i),
            roi: extractProjectDetail(rawText, /\b(?:roi|return|yield)[:\s]+([\d.,]+\s?%[^.|\n]{0,20})/i)
                ?? extractProjectDetail(rawText, /([\d.,]+\s?%\s?(?:roi|return|yield|annual)?)/i),
            timeline: extractProjectDetail(rawText, /\b(?:timeline|completion|delivery|duration)[:\s]+([^.|\n]{2,40})/i),
            ownershipMinimum: extractProjectDetail(rawText, /\b(?:ownership|minimum|min\.?\s*investment|from)[:\s]+([^.|\n]{2,40})/i),
            rawText,
        });
    }
    return projects.slice(0, 20);
}
/**
 * Fetch and parse the live IVX landing page. Read-only. Returns a structured,
 * AI-groundable result. On network/HTTP failure, returns `ok:false` with the
 * exact reason instead of throwing.
 */
export async function inspectLandingPage(input) {
    const url = resolveLandingUrl(input?.url);
    const fetchedAt = new Date().toISOString();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            method: 'GET',
            redirect: 'follow',
            signal: controller.signal,
            headers: {
                'User-Agent': 'IVX-Owner-AI-LandingInspector/1.0 (+read-only)',
                Accept: 'text/html,application/xhtml+xml',
            },
        });
        clearTimeout(timeout);
        const html = await response.text();
        if (!response.ok) {
            return {
                ok: false,
                url,
                httpStatus: response.status,
                fetchedAt,
                title: null,
                metaDescription: null,
                headings: [],
                links: [],
                ctas: [],
                imageAlts: [],
                projects: [],
                projectNames: [],
                textLength: html.length,
                error: `Landing page returned HTTP ${response.status}.`,
            };
        }
        const links = extractLinks(html);
        const projects = extractLandingProjectsFromHtml(html);
        const fullText = stripTags(html);
        return {
            ok: true,
            url,
            httpStatus: response.status,
            fetchedAt,
            title: extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i),
            metaDescription: extractFirstMatch(html, /<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)
                ?? extractFirstMatch(html, /<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i),
            headings: extractHeadings(html),
            links,
            ctas: links.filter(isCtaLink).slice(0, 20),
            imageAlts: extractImageAlts(html),
            projects,
            projectNames: projects.map((project) => project.name),
            textLength: fullText.length,
            error: null,
        };
    }
    catch (error) {
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : 'unknown error';
        const reason = controller.signal.aborted ? `Landing page fetch timed out after ${FETCH_TIMEOUT_MS}ms.` : message;
        return {
            ok: false,
            url,
            httpStatus: null,
            fetchedAt,
            title: null,
            metaDescription: null,
            headings: [],
            links: [],
            ctas: [],
            imageAlts: [],
            projects: [],
            projectNames: [],
            textLength: 0,
            error: `Could not fetch the landing page (${url}): ${reason}`,
        };
    }
}
