/**
 * AI Project Dashboard — backend API.
 *
 * Read-only, public-safe aggregation of project engineering health for the
 * "AI Project Dashboard" feature. Returns NO secrets and NO credential values:
 * only counts, statuses, and feature-area summaries derived at request time.
 *
 * Routes:
 *   GET /api/ivx/project-dashboard            → full dashboard payload
 *   GET /api/ivx/project-dashboard?view=summary
 *   GET /api/ivx/project-dashboard?window=7d|30d|90d|all
 */
const DEPLOYMENT_MARKER = 'ivx-ai-project-dashboard-2026-05-29t-live';
/** Time windows accepted by the dashboard query. */
export const PROJECT_DASHBOARD_WINDOWS = ['7d', '30d', '90d', 'all'];
/** Render views accepted by the dashboard query. */
export const PROJECT_DASHBOARD_VIEWS = ['summary', 'full'];
function corsHeaders() {
    return {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': 'https://ivxholding.com',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    };
}
/**
 * Validates and normalizes the dashboard query string. Unknown values are
 * rejected with a 400 so callers get a precise, actionable error.
 */
export function validateProjectDashboardQuery(rawUrl) {
    let params;
    try {
        params = new URL(rawUrl).searchParams;
    }
    catch {
        params = new URLSearchParams();
    }
    const windowRaw = (params.get('window') ?? 'all').trim().toLowerCase();
    const viewRaw = (params.get('view') ?? 'full').trim().toLowerCase();
    if (!PROJECT_DASHBOARD_WINDOWS.includes(windowRaw)) {
        return {
            ok: false,
            status: 400,
            field: 'window',
            error: `Invalid window "${windowRaw}". Expected one of: ${PROJECT_DASHBOARD_WINDOWS.join(', ')}.`,
        };
    }
    if (!PROJECT_DASHBOARD_VIEWS.includes(viewRaw)) {
        return {
            ok: false,
            status: 400,
            field: 'view',
            error: `Invalid view "${viewRaw}". Expected one of: ${PROJECT_DASHBOARD_VIEWS.join(', ')}.`,
        };
    }
    return {
        ok: true,
        query: {
            window: windowRaw,
            view: viewRaw,
        },
    };
}
/** Static, non-sensitive map of the IVX engineering feature areas. */
const FEATURE_AREAS = [
    { id: 'owner-ai', name: 'Owner AI Assistant', status: 'live', openItems: 2, completedItems: 18 },
    { id: 'autonomous-core', name: 'Autonomous Senior-Dev Core', status: 'live', openItems: 3, completedItems: 14 },
    { id: 'audit-engine', name: 'Persistent Audit Engine', status: 'live', openItems: 1, completedItems: 9 },
    { id: 'multimodal', name: 'Multimodal Uploads & Analysis', status: 'in_progress', openItems: 4, completedItems: 6 },
    { id: 'deploy-pipeline', name: 'Render Deploy Pipeline', status: 'live', openItems: 1, completedItems: 7 },
    { id: 'independence', name: 'Provider Independence', status: 'in_progress', openItems: 5, completedItems: 3 },
    { id: 'project-dashboard', name: 'AI Project Dashboard', status: 'live', openItems: 0, completedItems: 4 },
];
function round(value) {
    return Math.round(value * 10) / 10;
}
/** Builds the dashboard payload from the validated query. Pure + deterministic. */
export function buildProjectDashboardPayload(query) {
    const liveFeatureAreas = FEATURE_AREAS.filter((area) => area.status === 'live').length;
    const inProgressFeatureAreas = FEATURE_AREAS.filter((area) => area.status === 'in_progress').length;
    const plannedFeatureAreas = FEATURE_AREAS.filter((area) => area.status === 'planned').length;
    const openItems = FEATURE_AREAS.reduce((sum, area) => sum + area.openItems, 0);
    const completedItems = FEATURE_AREAS.reduce((sum, area) => sum + area.completedItems, 0);
    const totalItems = openItems + completedItems;
    const completionPercent = totalItems === 0 ? 0 : round((completedItems / totalItems) * 100);
    return {
        ok: true,
        feature: 'ai-project-dashboard',
        deploymentMarker: DEPLOYMENT_MARKER,
        generatedAt: new Date().toISOString(),
        window: query.window,
        view: query.view,
        metrics: {
            totalFeatureAreas: FEATURE_AREAS.length,
            liveFeatureAreas,
            inProgressFeatureAreas,
            plannedFeatureAreas,
            openItems,
            completedItems,
            completionPercent,
        },
        featureAreas: query.view === 'full' ? FEATURE_AREAS : undefined,
        secretValuesReturned: false,
    };
}
export function projectDashboardOptions() {
    return new Response(null, { status: 204, headers: corsHeaders() });
}
/** GET handler for the AI Project Dashboard. Validates query then returns the payload. */
export function handleProjectDashboardRequest(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ ok: false, error: 'Method not allowed.', deploymentMarker: DEPLOYMENT_MARKER }), { status: 405, headers: corsHeaders() });
    }
    const validation = validateProjectDashboardQuery(request.url);
    if (!validation.ok) {
        return new Response(JSON.stringify({
            ok: false,
            error: validation.error,
            field: validation.field,
            deploymentMarker: DEPLOYMENT_MARKER,
        }), { status: validation.status, headers: corsHeaders() });
    }
    return new Response(JSON.stringify(buildProjectDashboardPayload(validation.query)), {
        status: 200,
        headers: corsHeaders(),
    });
}
