/**
 * IVX Public Feature Handlers — registered under /api/ivx/*
 *
 * Covers: properties, members dashboard, investors dashboard,
 * CRM, JV deals, property admin, media, instagram cards.
 */
const DEPLOYMENT_MARKER = 'ivx-public-features-api-v1-2026-07-01';

// ── Supabase ───────────────────────────────────────────────────────────────
let _sb: any = null;
async function getSB() {
  if (_sb) return _sb;
  const { createClient } = await import('@supabase/supabase-js');
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _sb;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'https://ivxholding.com', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try { return await req.json() as Record<string, unknown>; } catch { return {}; }
}

function safeStr(v: unknown, fallback = ''): string { return typeof v === 'string' ? v.trim() : fallback; }

export const publicFeatureOptions = (): Response => {
  return new Response(null, { status: 204, headers: { 'Access-Control-Allow-Origin': 'https://ivxholding.com', 'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' } });
};

// ── Featured Properties ────────────────────────────────────────────────────
export async function handleFeaturedProperties(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    // Query jv_deals with published=true as featured, fall back to properties
    const { data, error } = await sb.from('jv_deals').select('id,title,project_name,type,description,total_investment,expected_roi,min_investment,status,published,property_address,city,state,zip_code,country,property_type,photos,created_at').eq('published', true).eq('status', 'active').order('created_at', { ascending: false }).limit(20);
    if (error) {
      // Fallback: try property_controls for featured IDs
      const { data: featuredIds } = await sb.from('property_controls').select('property_id').eq('is_featured', true);
      if (featuredIds && featuredIds.length > 0) {
        const ids = featuredIds.map((r: any) => r.property_id);
        const { data: props } = await sb.from('properties').select('id,name,location,city,country,price_per_share,total_shares,available_shares,min_investment,target_raise,current_raise,yield,property_type,status,description,created_at').in('id', ids).order('created_at', { ascending: false }).limit(20);
        return json({ properties: props || [], count: props?.length || 0, deploymentMarker: DEPLOYMENT_MARKER });
      }
      // Last fallback: all properties
      const { data: allProps } = await sb.from('properties').select('id,name,location,city,country,price_per_share,total_shares,available_shares,min_investment,target_raise,current_raise,yield,property_type,status,description,created_at').order('created_at', { ascending: false }).limit(20);
      return json({ properties: allProps || [], count: allProps?.length || 0, deploymentMarker: DEPLOYMENT_MARKER });
    }
    return json({ properties: data || [], count: data?.length || 0, deploymentMarker: DEPLOYMENT_MARKER });
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── Property Details ──────────────────────────────────────────────────────
export async function handlePropertyDetails(req: Request, propertyId: string): Promise<Response> {
  try {
    const sb = await getSB();
    // The landing page featured properties come from jv_deals (not properties table).
    // Try jv_deals first by string ID, then fall back to properties by numeric/string ID.
    const { data: dealData, error: dealError } = await sb.from('jv_deals').select('id,title,project_name,type,description,total_investment,expected_roi,min_investment,status,published,property_address,city,state,zip_code,country,property_type,photos,created_at').eq('id', propertyId).maybeSingle();
    if (dealData) return json({ property: dealData, deploymentMarker: DEPLOYMENT_MARKER, source: 'jv_deals' });

    // Fallback: try properties table
    const numericId = Number(propertyId);
    const isNumeric = !isNaN(numericId) && String(numericId) === propertyId;
    const query = sb.from('properties').select('id,name,location,city,country,price_per_share,total_shares,available_shares,min_investment,target_raise,current_raise,yield,property_type,status,description,created_at');
    const { data, error } = isNumeric
      ? await query.eq('id', numericId).maybeSingle()
      : await query.eq('id', propertyId).maybeSingle();
    if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 404);
    if (!data) return json({ error: 'Property not found', propertyId, deploymentMarker: DEPLOYMENT_MARKER }, 404);
    return json({ property: data, deploymentMarker: DEPLOYMENT_MARKER, source: 'properties' });
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── Members Dashboard ─────────────────────────────────────────────────────
export async function handleMembersDashboard(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    const [membersRes, walletsRes] = await Promise.all([
      sb.from('members').select('*', { count: 'exact', head: false }).order('created_at', { ascending: false }).limit(50),
      sb.from('wallets').select('*', { count: 'exact', head: true }),
    ]);
    return json({
      members: membersRes.data || [],
      totalMembers: membersRes.count || 0,
      totalWallets: walletsRes.count || 0,
      deploymentMarker: DEPLOYMENT_MARKER,
    });
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── Investors Dashboard ───────────────────────────────────────────────────
export async function handleInvestorsDashboard(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    const [investorsRes, dealsRes] = await Promise.all([
      sb.from('investors').select('*', { count: 'exact', head: false }).order('created_at', { ascending: false }).limit(50),
      sb.from('jv_deals').select('*', { count: 'exact', head: true }).eq('published', true),
    ]);
    return json({
      investors: investorsRes.data || [],
      totalInvestors: investorsRes.count || 0,
      totalDeals: dealsRes.count || 0,
      deploymentMarker: DEPLOYMENT_MARKER,
    });
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── CRM Main ──────────────────────────────────────────────────────────────
export async function handleCRMMain(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    const [investorsRes, leadsRes] = await Promise.all([
      sb.from('investors').select('*', { count: 'exact', head: false }).order('created_at', { ascending: false }).limit(20),
      sb.from('leads').select('*', { count: 'exact', head: false }).order('created_at', { ascending: false }).limit(20),
    ]);
    return json({
      investors: investorsRes.data || [],
      totalInvestors: investorsRes.count || 0,
      leads: leadsRes.data || [],
      totalLeads: leadsRes.count || 0,
      deploymentMarker: DEPLOYMENT_MARKER,
    });
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── JV Deals ──────────────────────────────────────────────────────────────
export async function handleJVDealsList(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    const { data, error, count } = await sb.from('jv_deals').select('*', { count: 'exact', head: false }).eq('published', true).order('created_at', { ascending: false }).limit(50);
    if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
    return json({ deals: data || [], count: count || 0, deploymentMarker: DEPLOYMENT_MARKER });
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── Property Admin ────────────────────────────────────────────────────────
export async function handlePropertyAdminList(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    const { data, error, count } = await sb.from('properties').select('*', { count: 'exact', head: false }).order('created_at', { ascending: false }).limit(100);
    if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
    return json({ properties: data || [], count: count || 0, deploymentMarker: DEPLOYMENT_MARKER });
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

export async function handlePropertyAdminCreate(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    const body = await readBody(req);
    const { data, error } = await sb.from('properties').insert(body).select().single();
    if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
    return json({ property: data, deploymentMarker: DEPLOYMENT_MARKER }, 201);
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── Media Upload ──────────────────────────────────────────────────────────
export async function handleMediaUpload(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    const body = await readBody(req);
    const projectId = safeStr(body.projectId || body.project_id);
    const mediaUrl = safeStr(body.url || body.mediaUrl || body.media_url);
    const mediaType = safeStr(body.type || body.mediaType || body.media_type, 'image');
    if (!projectId || !mediaUrl) return json({ error: 'projectId and url required', deploymentMarker: DEPLOYMENT_MARKER }, 400);
    const { data, error } = await sb.from('project_media').insert({ project_id: projectId, media_url: mediaUrl, media_type: mediaType, is_approved: true }).select().single();
    if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
    return json({ media: data, deploymentMarker: DEPLOYMENT_MARKER }, 201);
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── Instagram Cards ───────────────────────────────────────────────────────
export async function handleInstagramCards(req: Request): Promise<Response> {
  try {
    const sb = await getSB();
    const { data, error } = await sb.from('project_media').select('id,project_id,media_type,url,media_url,thumbnail_url,title,description,position,is_approved,created_at').eq('media_type', 'instagram_card').eq('is_approved', true).order('created_at', { ascending: false }).limit(50);
    if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
    return json({ cards: data || [], count: data?.length || 0, deploymentMarker: DEPLOYMENT_MARKER });
  } catch (err: any) { return json({ error: err.message, deploymentMarker: DEPLOYMENT_MARKER }, 500); }
}

// ── Engagement Aliases (delegate to project engagement with query params) ──
export async function handleEngagementLikes(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') || url.searchParams.get('project_id') || null;
  const sb = await getSB();
  let query = sb.from('project_likes').select('id,project_id,user_id,created_at');
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
  if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
  return json({ likes: data || [], count: data?.length || 0, projectId, deploymentMarker: DEPLOYMENT_MARKER });
}

export async function handleEngagementComments(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') || url.searchParams.get('project_id') || null;
  const sb = await getSB();
  let query = sb.from('project_comments').select('id,project_id,user_id,text,created_at');
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
  if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
  return json({ comments: data || [], count: data?.length || 0, projectId, deploymentMarker: DEPLOYMENT_MARKER });
}

export async function handleEngagementShares(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') || url.searchParams.get('project_id') || null;
  const sb = await getSB();
  let query = sb.from('project_shares').select('id,project_id,user_id,platform,created_at');
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
  if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
  return json({ shares: data || [], count: data?.length || 0, projectId, deploymentMarker: DEPLOYMENT_MARKER });
}

export async function handleEngagementSaves(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') || url.searchParams.get('project_id') || null;
  const sb = await getSB();
  let query = sb.from('project_saves').select('id,project_id,user_id,created_at');
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error } = await query.order('created_at', { ascending: false }).limit(100);
  if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
  return json({ saves: data || [], count: data?.length || 0, projectId, deploymentMarker: DEPLOYMENT_MARKER });
}

// project_analytics.project_id is a uuid column; reject non-uuid input with 400 instead of letting Postgres throw a 500.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function handleAnalytics(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const projectId = url.searchParams.get('projectId') || url.searchParams.get('project_id') || null;
  if (projectId && !UUID_RE.test(projectId)) {
    return json({ error: 'projectId must be a valid UUID', projectId, deploymentMarker: DEPLOYMENT_MARKER }, 400);
  }
  const days = parseInt(url.searchParams.get('days') || '30', 10);
  const sb = await getSB();
  const since = new Date(Date.now() - days * 86400000).toISOString();
  // Columns match the upsert path in ivx-project-engagement.ts (invest_clicks/detail_views),
  // NOT event_type/count which do not exist on this table.
  let query = sb.from('project_analytics').select('id,project_id,date,invest_clicks,detail_views', { count: 'exact', head: false }).gte('date', since.split('T')[0]);
  if (projectId) query = query.eq('project_id', projectId);
  const { data, error, count } = await query.order('date', { ascending: false }).limit(100);
  if (error) return json({ error: error.message, deploymentMarker: DEPLOYMENT_MARKER }, 500);
  return json({ events: data || [], count: count || 0, projectId, days, deploymentMarker: DEPLOYMENT_MARKER });
}
