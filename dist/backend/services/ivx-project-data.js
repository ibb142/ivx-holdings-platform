/**
 * IVX Project Data Reader (authoritative source: Supabase `jv_deals`)
 *
 * The public landing page (ivxholding.com) does NOT contain the projects in its
 * static HTML — it renders them CLIENT-SIDE from the Supabase `jv_deals` table
 * (`sb.from('jv_deals').select('*')`). A plain HTTP fetch of the page therefore
 * only sees the static fallback card, never the live project rows. This reader
 * queries `jv_deals` directly over the Supabase REST API with the backend
 * service-role key so the Owner AI can name the real projects (e.g. "Casa
 * Rosario"), list the others, and return per-deal details (location, price,
 * ROI, timeline, ownership minimum, media count).
 *
 * Read-only. The service-role key is never returned. On missing config or a
 * failed request it returns an honest `ok:false` with the exact reason / the
 * exact missing environment variable.
 */
const TABLE = 'jv_deals';
const FETCH_TIMEOUT_MS = 12_000;
function readTrimmed(value) {
    return typeof value === 'string' ? value.trim() : '';
}
function firstString(deal, keys) {
    for (const key of keys) {
        const value = readTrimmed(deal[key]);
        if (value) {
            return value;
        }
    }
    return null;
}
function firstNumber(deal, keys) {
    for (const key of keys) {
        const raw = deal[key];
        const num = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
        if (Number.isFinite(num) && num > 0) {
            return num;
        }
    }
    return null;
}
function formatCurrency(value) {
    if (value === null) {
        return null;
    }
    return `$${value.toLocaleString('en-US')}`;
}
function countPhotos(deal) {
    const raw = deal.photos ?? deal.images ?? deal.media;
    if (Array.isArray(raw)) {
        return raw.length;
    }
    if (typeof raw === 'string') {
        try {
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed.length : 0;
        }
        catch {
            return 0;
        }
    }
    return 0;
}
/**
 * Normalize a raw `jv_deals` row into a project record. Mirrors the exact
 * column fallbacks the landing page renderer uses (snake_case + camelCase).
 */
export function normalizeDeal(deal) {
    const name = firstString(deal, ['title', 'name', 'projectName', 'project_name']) ?? readTrimmed(deal.id) ?? 'Untitled deal';
    const composedLocation = [firstString(deal, ['city']), firstString(deal, ['state']), firstString(deal, ['country'])].filter(Boolean).join(', ');
    const location = firstString(deal, ['propertyAddress', 'property_address', 'addressShort', 'address_short'])
        ?? (composedLocation.length > 0 ? composedLocation : null);
    const roiNum = firstNumber(deal, ['expectedROI', 'expected_roi']);
    const priceNum = firstNumber(deal, ['salePrice', 'sale_price', 'propertyValue', 'property_value', 'estimated_value', 'totalInvestment', 'total_investment', 'amount']);
    const minNum = firstNumber(deal, ['minInvestment', 'min_investment', 'minimum_investment']);
    const publishedRaw = deal.published;
    return {
        id: readTrimmed(deal.id) || name,
        name,
        location: location !== null && location.length > 0 ? location : null,
        price: formatCurrency(priceNum),
        roi: roiNum === null ? null : `${roiNum}%`,
        timeline: firstString(deal, ['timeline', 'completionTimeline', 'completion_timeline', 'exitStrategy', 'exit_strategy', 'distributionFrequency', 'distribution_frequency']),
        ownershipMinimum: formatCurrency(minNum),
        status: firstString(deal, ['status']),
        published: publishedRaw === true || readTrimmed(publishedRaw).toLowerCase() === 'true',
        mediaCount: countPhotos(deal),
    };
}
/** Replicates the landing page's published+active filter (with the same fallbacks). */
export function filterPublishedDeals(deals) {
    const activeStatuses = new Set(['active', 'published', 'live']);
    const isTrashed = (deal) => {
        const status = readTrimmed(deal.status).toLowerCase();
        return status === 'trashed' || status === 'deleted' || status === 'permanently_deleted';
    };
    const isPublished = (deal) => deal.published === true || readTrimmed(deal.published).toLowerCase() === 'true';
    const visible = deals.filter((deal) => !isTrashed(deal));
    let result = visible.filter((deal) => {
        const status = readTrimmed(deal.status).toLowerCase();
        return isPublished(deal) && (activeStatuses.has(status) || status === '');
    });
    if (result.length === 0) {
        result = visible.filter(isPublished);
    }
    if (result.length === 0) {
        result = visible;
    }
    return result;
}
function resolveSupabaseConfig() {
    const url = readTrimmed(process.env.EXPO_PUBLIC_SUPABASE_URL).replace(/\/+$/, '');
    const key = readTrimmed(process.env.SUPABASE_SERVICE_ROLE_KEY) || readTrimmed(process.env.SUPABASE_SERVICE_KEY);
    const missing = [];
    if (!url) {
        missing.push('EXPO_PUBLIC_SUPABASE_URL');
    }
    if (!key) {
        missing.push('SUPABASE_SERVICE_ROLE_KEY');
    }
    return { url, key, missing };
}
/**
 * Read the live `jv_deals` rows (authoritative project source) and return the
 * published, normalized projects. Read-only over Supabase REST with the
 * service-role key. Honest failure on missing config / HTTP error.
 */
export async function readLandingProjects() {
    const fetchedAt = new Date().toISOString();
    const { url, key, missing } = resolveSupabaseConfig();
    const base = {
        ok: false,
        configured: missing.length === 0,
        source: `supabase:${TABLE}`,
        fetchedAt,
        httpStatus: null,
        totalRows: 0,
        publishedCount: 0,
        projects: [],
        projectNames: [],
        error: null,
        missingEnv: missing,
    };
    if (missing.length > 0) {
        base.error = `Project data source not configured. Missing backend env: ${missing.join(', ')}.`;
        return base;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        const endpoint = `${url}/rest/v1/${TABLE}?select=*&order=display_order.asc.nullslast&order=created_at.desc&limit=50`;
        const response = await fetch(endpoint, {
            method: 'GET',
            signal: controller.signal,
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                Accept: 'application/json',
            },
        });
        clearTimeout(timeout);
        base.httpStatus = response.status;
        if (!response.ok) {
            const body = await response.text().catch(() => '');
            base.error = `Supabase REST returned HTTP ${response.status} for ${TABLE}.${body ? ` ${body.slice(0, 200)}` : ''}`;
            return base;
        }
        const rows = (await response.json());
        const allRows = Array.isArray(rows) ? rows : [];
        const published = filterPublishedDeals(allRows);
        const projects = published.map(normalizeDeal);
        return {
            ...base,
            ok: true,
            totalRows: allRows.length,
            publishedCount: projects.length,
            projects,
            projectNames: projects.map((project) => project.name),
            error: null,
        };
    }
    catch (error) {
        clearTimeout(timeout);
        const message = error instanceof Error ? error.message : 'unknown error';
        const reason = controller.signal.aborted ? `Request timed out after ${FETCH_TIMEOUT_MS}ms.` : message;
        base.error = `Could not query ${TABLE}: ${reason}`;
        return base;
    }
}
