/**
 * IVX Global Intent Capture Engine — API Routes (owner-only + public).
 *
 * Routes:
 *   GET  /api/ivx/intent-engine/dashboard          — owner dashboard (owner-only)
 *   POST /api/ivx/intent-engine/phase1              — run keyword discovery (owner-only)
 *   POST /api/ivx/intent-engine/phase2              — run intent clustering (owner-only)
 *   POST /api/ivx/intent-engine/phase3              — generate landing pages (owner-only)
 *   POST /api/ivx/intent-engine/phase4              — generate content (owner-only)
 *   POST /api/ivx/intent-engine/phase8              — run autonomous optimization (owner-only)
 *   GET  /api/ivx/intent-engine/keywords            — list keywords (owner-only)
 *   GET  /api/ivx/intent-engine/landing-pages       — list landing pages (owner-only)
 *   GET  /api/ivx/intent-engine/content             — list content (owner-only)
 *   GET  /api/ivx/intent-engine/visitors            — list visitors (owner-only)
 *   POST /api/ivx/intent-engine/visitor             — upsert visitor (PUBLIC)
 *   POST /api/ivx/intent-engine/chat                — AI conversion chat (PUBLIC)
 *   GET  /api/ivx/intent-engine/page/:slug          — get landing page data (PUBLIC, for SEO rendering)
 *   GET  /api/ivx/intent-engine/status              — engine status (PUBLIC)
 */
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';
import { isIntentEngineConfigured, runPhase1KeywordDiscovery, runPhase2IntentClustering, runPhase3LandingPages, runPhase4ContentEngine, runPhase8Optimization, getOwnerDashboard, upsertVisitor, recordAIConversation, } from '../services/ivx-intent-capture-engine';
const PUBLIC_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': 'https://ivxholding.com',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
};
function publicJson(payload, status = 200) {
    return new Response(JSON.stringify(payload), { status, headers: PUBLIC_HEADERS });
}
export const OPTIONS = () => ownerOnlyOptions();
async function requireOwner(request) {
    try {
        const owner = await assertIVXOwnerOnly(request);
        if (!owner.userId) {
            return ownerOnlyJson({ ok: false, error: 'IVX owner authentication required.' }, 401);
        }
        return null;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'IVX owner authentication failed.';
        const status = /missing bearer/i.test(message) || /invalid or expired/i.test(message) ? 401 : 403;
        return ownerOnlyJson({ ok: false, error: message }, status);
    }
}
// ── Owner-only routes ─────────────────────────────────────────────────────────
export async function handleIntentEngineDashboardRequest(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const dashboard = await getOwnerDashboard();
    return ownerOnlyJson({ ok: true, result: dashboard });
}
export async function handleIntentEnginePhase1Request(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runPhase1KeywordDiscovery();
    return ownerOnlyJson({ ok: true, result });
}
export async function handleIntentEnginePhase2Request(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runPhase2IntentClustering();
    return ownerOnlyJson({ ok: true, result });
}
export async function handleIntentEnginePhase3Request(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runPhase3LandingPages();
    return ownerOnlyJson({ ok: true, result });
}
export async function handleIntentEnginePhase4Request(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runPhase4ContentEngine();
    return ownerOnlyJson({ ok: true, result });
}
export async function handleIntentEnginePhase8Request(request) {
    const denied = await requireOwner(request);
    if (denied)
        return denied;
    const result = await runPhase8Optimization();
    return ownerOnlyJson({ ok: true, result });
}
// ── Public routes ─────────────────────────────────────────────────────────────
export async function handleIntentEngineStatusRequest() {
    return publicJson({
        ok: true,
        configured: isIntentEngineConfigured(),
        engine: 'ivx-intent-capture-engine',
        phases: ['search_intelligence', 'intent_clustering', 'landing_pages', 'content_engine', 'multilingual', 'visitor_intelligence', 'ai_conversion', 'autonomous_optimization'],
    });
}
export async function handleIntentEngineVisitorRequest(request) {
    if (request.method === 'OPTIONS')
        return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
    try {
        const body = await request.json();
        if (!body.visitor_id) {
            return publicJson({ ok: false, error: 'visitor_id is required' }, 400);
        }
        const visitor = await upsertVisitor(body);
        return publicJson({ ok: true, result: visitor });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Visitor upsert failed';
        return publicJson({ ok: false, error: message }, 500);
    }
}
export async function handleIntentEngineChatRequest(request) {
    if (request.method === 'OPTIONS')
        return new Response(null, { status: 204, headers: PUBLIC_HEADERS });
    try {
        const body = await request.json();
        if (!body.visitor_id || !body.message) {
            return publicJson({ ok: false, error: 'visitor_id and message are required' }, 400);
        }
        const result = await recordAIConversation(body);
        return publicJson({ ok: true, result });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Chat processing failed';
        return publicJson({ ok: false, error: message }, 500);
    }
}
export async function handleIntentEnginePageRequest(request, slug) {
    try {
        if (!isIntentEngineConfigured()) {
            return publicJson({ ok: false, error: 'Intent engine not configured' }, 503);
        }
        const url = (process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
        const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '';
        const res = await fetch(`${url}/rest/v1/ivx_landing_pages?slug=eq.${encodeURIComponent(slug)}&limit=1`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
        if (!res.ok) {
            return publicJson({ ok: false, error: 'Landing page query failed' }, 500);
        }
        const pages = await res.json();
        if (pages.length === 0) {
            return publicJson({ ok: false, error: 'Landing page not found' }, 404);
        }
        return publicJson({ ok: true, result: pages[0] });
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Landing page fetch failed';
        return publicJson({ ok: false, error: message }, 500);
    }
}
