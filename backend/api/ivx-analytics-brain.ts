/**
 * IVX Analytics Brain API Handlers
 *
 * Endpoints for event ingestion, member analysis, scam detection,
 * retention cohorts, and brain dashboard.
 */

import { 
  ingestBehaviorEvent, 
  ingestBatchEvents,
  analyzeMember, 
  analyzeAssetForScam, 
  computeRetentionCohorts,
  getBrainDashboard,
  type BehaviorEvent,
  type ScamAnalysisInput,
} from '../services/ivx-analytics-brain';

export function analyticsBrainOptions(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-IVX-Owner-Token',
    },
  });
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ ok: false, error: message, timestamp: new Date().toISOString() }, status);
}

async function parseBody<T>(req: Request): Promise<T | null> {
  try {
    return await req.json() as T;
  } catch {
    return null;
  }
}

// ── Event Ingestion ────────────────────────────────────────────────────────

export async function handleAnalyticsEventIngest(req: Request): Promise<Response> {
  const body = await parseBody<BehaviorEvent>(req);
  if (!body) return errorResponse('Invalid JSON body', 400);
  if (!body.session_id) return errorResponse('session_id is required', 400);
  if (!body.event_type) return errorResponse('event_type is required', 400);

  try {
    const result = await ingestBehaviorEvent(body);
    return jsonResponse({ ...result, timestamp: new Date().toISOString() });
  } catch (e) {
    return errorResponse(`Ingestion failed: ${(e as Error).message}`, 500);
  }
}

export async function handleAnalyticsBatchIngest(req: Request): Promise<Response> {
  const body = await parseBody<{ events: BehaviorEvent[] }>(req);
  if (!body?.events) return errorResponse('events array is required', 400);
  if (!Array.isArray(body.events)) return errorResponse('events must be an array', 400);
  if (body.events.length > 500) return errorResponse('Max 500 events per batch', 400);

  try {
    const result = await ingestBatchEvents(body.events);
    return jsonResponse({ ...result, timestamp: new Date().toISOString() });
  } catch (e) {
    return errorResponse(`Batch ingestion failed: ${(e as Error).message}`, 500);
  }
}

// ── Member Analysis ────────────────────────────────────────────────────────

export async function handleAnalyticsMemberAnalyze(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const memberId = url.searchParams.get('member_id');
  const isAnonymous = url.searchParams.get('anonymous') === 'true';

  if (!memberId) return errorResponse('member_id parameter is required', 400);

  try {
    const result = await analyzeMember(memberId, isAnonymous);
    if (!result) return errorResponse('Member not found', 404);
    return jsonResponse({ ok: true, member: result, timestamp: new Date().toISOString() });
  } catch (e) {
    return errorResponse(`Analysis failed: ${(e as Error).message}`, 500);
  }
}

export async function handleAnalyticsMemberGet(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const memberId = url.searchParams.get('member_id');
  const isAnonymous = url.searchParams.get('anonymous') === 'true';

  if (!memberId) return errorResponse('member_id parameter is required', 400);

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sbUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const matchField = isAnonymous ? 'anonymous_id' : 'user_id';
    const { data: profile } = await sb
      .from('member_behavior_profiles')
      .select('*')
      .eq(matchField, memberId)
      .maybeSingle();

    if (!profile) return errorResponse('Member not found', 404);

    const { data: events } = await sb
      .from('member_behavior_events')
      .select('*')
      .eq(matchField, memberId)
      .order('timestamp', { ascending: false })
      .limit(50);

    const { data: pathway } = await sb
      .from('conversion_pathways')
      .select('*')
      .eq(matchField, memberId)
      .maybeSingle();

    return jsonResponse({
      ok: true,
      profile,
      recent_events: events || [],
      conversion_pathway: pathway || null,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(`Failed: ${(e as Error).message}`, 500);
  }
}

// ── Scam Detection ──────────────────────────────────────────────────────────

export async function handleAnalyticsScamAnalyze(req: Request): Promise<Response> {
  const body = await parseBody<ScamAnalysisInput>(req);
  if (!body) return errorResponse('Invalid JSON body', 400);
  if (!body.asset_id) return errorResponse('asset_id is required', 400);
  if (!body.asset_type) return errorResponse('asset_type is required', 400);
  if (!body.asset_data) return errorResponse('asset_data is required', 400);

  try {
    const result = await analyzeAssetForScam(body);
    return jsonResponse({ ok: true, analysis: result, timestamp: new Date().toISOString() });
  } catch (e) {
    return errorResponse(`Scam analysis failed: ${(e as Error).message}`, 500);
  }
}

export async function handleAnalyticsScamList(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sbUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

    const { data } = await sb
      .from('asset_scam_analysis')
      .select('*')
      .order('scam_score', { ascending: false })
      .limit(limit);

    return jsonResponse({ ok: true, analyses: data || [], count: data?.length || 0, timestamp: new Date().toISOString() });
  } catch (e) {
    return errorResponse(`Failed: ${(e as Error).message}`, 500);
  }
}

// ── Retention Cohorts ──────────────────────────────────────────────────────

export async function handleAnalyticsRetention(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const periodType = (url.searchParams.get('period') || 'weekly') as 'daily' | 'weekly' | 'monthly';

  try {
    const cohorts = await computeRetentionCohorts(periodType);
    return jsonResponse({ ok: true, cohorts, count: cohorts.length, timestamp: new Date().toISOString() });
  } catch (e) {
    return errorResponse(`Retention analysis failed: ${(e as Error).message}`, 500);
  }
}

// ── Brain Dashboard ─────────────────────────────────────────────────────────

export async function handleAnalyticsDashboard(req: Request): Promise<Response> {
  try {
    const dashboard = await getBrainDashboard();
    return jsonResponse({ ok: true, dashboard, timestamp: new Date().toISOString() });
  } catch (e) {
    return errorResponse(`Dashboard failed: ${(e as Error).message}`, 500);
  }
}

// ── Members List ────────────────────────────────────────────────────────────

export async function handleAnalyticsMembersList(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get('limit') || '50');
  const offset = parseInt(url.searchParams.get('offset') || '0');
  const sortBy = url.searchParams.get('sort') || 'intent_score';
  const minIntent = parseInt(url.searchParams.get('min_intent') || '0');

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sbUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

    let query = sb
      .from('member_behavior_profiles')
      .select('id, user_id, anonymous_id, email, total_sessions, total_screen_views, total_actions, intent_score, funnel_stage, last_seen, first_seen, brain_recommendations, brain_risk_flags, interest_jv_deals, interest_tokenized_assets, interest_portfolio, interest_investing')
      .gte('intent_score', minIntent)
      .order(sortBy, { ascending: false })
      .range(offset, offset + limit - 1);

    const { data, count } = await query;

    return jsonResponse({
      ok: true,
      members: data || [],
      total: count || 0,
      limit,
      offset,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(`Failed: ${(e as Error).message}`, 500);
  }
}

// ── Conversion Pathways ────────────────────────────────────────────────────

export async function handleAnalyticsPathways(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const stage = url.searchParams.get('stage');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sbUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

    let query = sb
      .from('conversion_pathways')
      .select('*')
      .order('conversion_probability', { ascending: false })
      .limit(limit);

    if (stage) {
      query = query.eq('current_stage', stage);
    }

    const { data } = await query;

    return jsonResponse({
      ok: true,
      pathways: data || [],
      count: data?.length || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(`Failed: ${(e as Error).message}`, 500);
  }
}

// ── Brain Analysis Runs (Audit Trail) ──────────────────────────────────────

export async function handleAnalyticsRuns(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const type = url.searchParams.get('type');
  const limit = parseInt(url.searchParams.get('limit') || '20');

  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sbUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
    const sbKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || '').trim();
    const sb = createClient(sbUrl, sbKey, { auth: { autoRefreshToken: false, persistSession: false } });

    let query = sb
      .from('brain_analysis_runs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (type) {
      query = query.eq('analysis_type', type);
    }

    const { data } = await query;

    return jsonResponse({
      ok: true,
      runs: data || [],
      count: data?.length || 0,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return errorResponse(`Failed: ${(e as Error).message}`, 500);
  }
}
