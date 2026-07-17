/**
 * IVX Video Platform API — enterprise Instagram-grade video experience.
 *
 * Routes (registered in hono.ts under /api/ivx/video-platform/*):
 *   GET  /feed                        — CANONICAL unified feed (single source of truth for
 *                                       landing page, Android, iOS, Expo, desktop, TV).
 *                                       Deterministic identical order on every platform:
 *                                       3 investor deal videos → 1 featured investor video → repeat.
 *                                       Project reels (?type=reel) never interrupt the deal flow.
 *                                       (?channel=investor|buyer|realtor|builder|jv, ?type=reel,
 *                                        ?project_id=, ?viewer_id= (liked/saved flags only),
 *                                        ?zip=, ?cursor=, ?limit=)
 *   GET  /channels                    — audience channels + property channels with counts
 *   POST /events                      — analytics beacons (view/watch/complete/double_tap_like/share/profile)
 *   GET  /videos/:videoId/analytics   — per-video aggregates
 *   POST /videos/:videoId/meta        — tag audiences / property / zip / creator / story
 *   POST /videos/:videoId/report      — viewer report → moderation queue
 *   POST /follow                      — toggle follow { follower_id, creator_id }
 *   GET  /follow/:followerId          — creators this viewer follows
 *   GET  /stories                     — active (non-expired) stories
 *   POST /stories                     — promote a video to a 24h story
 *   GET  /live                        — live sessions (?include_ended=1)
 *   POST /live/start                  — { host_id, title, playback_url? } → session with ingest_url + playback_url
 *   GET  /live/:sessionId/status      — session lifecycle (created|live|ended|failed)
 *   POST /live/:sessionId/ingest      — binary MPEG-TS segment body (?duration=seconds) → live HLS playlist
 *   POST /live/:sessionId/stop        — host stop; finalizes playlist with ENDLIST
 *   POST /live/:sessionId/moderate    — owner force-end { moderator_id, reason? }
 *   GET  /creator/:creatorId/dashboard — creator analytics rollup
 *   GET  /moderation/queue            — open reports + decisions
 *   POST /moderation/:videoId         — { action: approve|reject|flag, reason?, moderator_id? }
 */

import {
  VIDEO_PLATFORM_MARKER,
  VIDEO_AUDIENCES,
  addReport,
  canonicalSort,
  composeInvestorFirstHome,
  composeUnifiedFeed,
  getAnalyticsDoc,
  getDealMetaDoc,
  getFollowState,
  getMetaDoc,
  getModerationDoc,
  getVideoStats,
  getViewerProfile,
  getLiveSession,
  ingestLiveSegment,
  isDealMetaVisible,
  isMetaVisible,
  listLiveSessions,
  normalizeDealMeta,
  normalizeVideoMeta,
  recordEvents,
  recordModerationDecision,
  startLiveSession,
  stopLiveSession,
  toggleFollow,
  upsertDealMeta,
  upsertVideoMeta,
  type DealMeta,
  type PlatformEvent,
  type RankableVideo,
  type RankContext,
  type VideoMeta,
} from '../services/ivx-video-platform-store';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': 'https://ivxholding.com',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, Range',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS },
  });
}

export const videoPlatformOptions = (): Response => new Response(null, { status: 204, headers: CORS_HEADERS });

/* ---------------- TTL Response Cache ----------------
 * In-process TTL cache for read-heavy feed endpoints.
 * Caches the serialized JSON response for a short window (default 30s)
 * so that burst traffic serves from memory instead of hitting Supabase.
 * Per-cache-key locking prevents thundering-herd on cache miss.
 */
type CacheEntry = { body: string; status: number; expiresAt: number };
const FEED_CACHE = new Map<string, CacheEntry>();
const FEED_CACHE_LOCKS = new Map<string, Promise<CacheEntry>>();
const FEED_CACHE_TTL_MS = 30_000;
const FEED_CACHE_MAX = 100;

function feedCacheKey(path: string): string {
  return path;
}

function getCachedEntry(key: string): CacheEntry | null {
  const entry = FEED_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    FEED_CACHE.delete(key);
    return null;
  }
  return entry;
}

function setCachedEntry(key: string, body: string, status: number): void {
  if (FEED_CACHE.size >= FEED_CACHE_MAX) {
    const oldest = [...FEED_CACHE.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
    if (oldest) FEED_CACHE.delete(oldest[0]);
  }
  FEED_CACHE.set(key, { body, status, expiresAt: Date.now() + FEED_CACHE_TTL_MS });
}

function cachedJson(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
      'X-IVX-Cache': 'HIT',
      ...CORS_HEADERS,
    },
  });
}

async function withFeedCache(key: string, handler: () => Promise<Response>): Promise<Response> {
  const cached = getCachedEntry(key);
  if (cached) return cachedJson(cached.body, cached.status);

  const inflight = FEED_CACHE_LOCKS.get(key);
  if (inflight) {
    const entry = await inflight;
    return cachedJson(entry.body, entry.status);
  }

  const promise = (async () => {
    const resp = await handler();
    const body = await resp.text();
    setCachedEntry(key, body, resp.status);
    return { body, status: resp.status, expiresAt: Date.now() + FEED_CACHE_TTL_MS };
  })();
  FEED_CACHE_LOCKS.set(key, promise);
  try {
    const entry = await promise;
    return new Response(entry.body, {
      status: entry.status,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
        'X-IVX-Cache': 'MISS',
        ...CORS_HEADERS,
      },
    });
  } finally {
    FEED_CACHE_LOCKS.delete(key);
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try { return await req.json() as Record<string, unknown>; } catch { return {}; }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/* ---------------- Supabase ---------------- */

let _sb: any = null;
async function getSB() {
  if (_sb) return _sb;
  const { createClient } = await import('@supabase/supabase-js');
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  _sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _sb;
}

type PlaybackIndexLike = Record<string, {
  status: string;
  hls_url: string | null;
  poster_url: string | null;
  thumbnail_url: string | null;
  duration?: number | null;
}>;

async function loadPlaybackIndex(): Promise<PlaybackIndexLike> {
  try {
    const { getPlaybackIndex } = await import('../services/ivx-video-pipeline');
    return (await getPlaybackIndex()) as PlaybackIndexLike;
  } catch {
    return {};
  }
}

async function loadEngagementCounts(sb: any, ids: string[]): Promise<Record<string, { likes: number; comments: number; shares: number; saves: number }>> {
  const counts: Record<string, { likes: number; comments: number; shares: number; saves: number }> = {};
  for (const id of ids) counts[id] = { likes: 0, comments: 0, shares: 0, saves: 0 };
  if (ids.length === 0) return counts;
  const [likesRes, commentsRes, sharesRes, savesRes] = await Promise.all([
    sb.from('project_likes').select('project_id').in('project_id', ids),
    sb.from('project_comments').select('project_id').in('project_id', ids).eq('is_approved', true).is('deleted_at', null),
    sb.from('project_shares').select('project_id').in('project_id', ids),
    sb.from('project_saves').select('project_id').in('project_id', ids),
  ]);
  for (const row of likesRes.data || []) { const k = String(row.project_id); if (counts[k]) counts[k].likes += 1; }
  for (const row of commentsRes.data || []) { const k = String(row.project_id); if (counts[k]) counts[k].comments += 1; }
  for (const row of sharesRes.data || []) { const k = String(row.project_id); if (counts[k]) counts[k].shares += 1; }
  for (const row of savesRes.data || []) { const k = String(row.project_id); if (counts[k]) counts[k].saves += 1; }
  return counts;
}

/* ---------------- feed ---------------- */

function decodeCursor(raw: string | null): number {
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf-8')) as { o?: number };
    return Math.max(0, Number(parsed.o) || 0);
  } catch {
    return 0;
  }
}

function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ o: offset }), 'utf-8').toString('base64url');
}

/** GET /api/ivx/video-platform/feed — ranked, personalized, cursor-paginated. */
type FeedDeal = {
  id: string;
  title: string | null;
  price: number | null;
  min_investment: number | null;
  expected_roi: string | null;
  deal_type: string | null;
  url: string;
};

/**
 * Load JV deal info for the video page — matched by meta.property_id or the
 * video's project_id against jv_deals.id. Falls back to fuzzy title/project-name
 * matching because project_videos.project_id is often the video's own UUID, not the
 * deal slug. Returns a map keyed by videoId. Never throws; missing deals → null.
 */
async function loadFeedDeals(sb: any, candidates: string[], titles: Record<string, string>): Promise<Record<string, FeedDeal>> {
  const out: Record<string, FeedDeal> = {};
  const idRe = /^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$/;
  const ids = Array.from(new Set(candidates.filter((c) => idRe.test(c))));
  const allDeals: any[] = [];

  try {
    const { data } = await sb
      .from('jv_deals')
      .select('id,title,project_name,estimated_value,appraised_value,total_investment,min_investment,expected_roi,type')
      .limit(200);
    for (const d of data ?? []) {
      const id = String(d.id);
      const deal: FeedDeal = {
        id,
        title: d.title ?? d.project_name ?? null,
        price: d.estimated_value ?? d.appraised_value ?? d.total_investment ?? null,
        min_investment: d.min_investment ?? null,
        expected_roi: d.expected_roi != null ? String(d.expected_roi) : null,
        deal_type: d.type ?? null,
        url: `https://ivxholding.com/?deal=${id}#deals`,
      };
      allDeals.push({ ...d, __deal: deal });
      // Exact match by id: assign to any video whose candidate id matches the deal id
      if (ids.includes(id)) {
        for (const p of Object.entries(titles)) {
          const [videoId, _title] = p;
          if (!out[videoId]) out[videoId] = deal;
        }
      }
    }

    // Fuzzy fallback: match video titles against deal title/project_name.
    for (const [videoId, title] of Object.entries(titles)) {
      if (out[videoId] || !title) continue;
      const t = title.toLowerCase();
      const words = t.split(/[^a-z0-9]+/).filter((w) => w.length > 2);
      let best: { deal: FeedDeal; score: number } | null = null;
      for (const d of allDeals) {
        const dealTitle = String(d.title ?? d.project_name ?? '').toLowerCase();
        const dealName = String(d.project_name ?? '').toLowerCase();
        const matches = words.filter((w) => dealTitle.includes(w) || dealName.includes(w)).length;
        const score = matches / Math.max(words.length, 1);
        if (score >= 0.3 && (!best || score > best.score)) {
          best = { deal: d.__deal, score };
        }
      }
      if (best) {
        out[videoId] = best.deal;
      }
    }
  } catch {
    /* deal enrichment is best-effort */
  }
  return out;
}

export async function handlePlatformFeed(req: Request): Promise<Response> {
  const cacheKey = feedCacheKey(req.url);
  return withFeedCache(cacheKey, async () => {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '50'), 1), 200);
    const offset = decodeCursor(url.searchParams.get('cursor'));
    const channel = str(url.searchParams.get('channel')).toLowerCase() || null;
    const projectId = str(url.searchParams.get('project_id')) || null;
    const viewerId = str(url.searchParams.get('viewer_id')) || null;
    const zipParam = str(url.searchParams.get('zip')) || null;

    // ?type=reel → Project Reels rail only; default → investor deal feed with featured interleave.
    const typeParam = str(url.searchParams.get('type')).toLowerCase();
    const reelsOnly = typeParam === 'reel' || typeParam === 'reels';

    const sb = await getSB();
    let query = sb
      .from('project_videos')
      .select('id,project_id,media_id,title,video_url,thumbnail_url,cover_url,duration_sec,width,height,orientation,is_pinned,is_approved,view_count,created_at')
      .eq('is_approved', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (projectId) query = query.eq('project_id', projectId);
    const { data: vids, error } = await query;
    if (error) return json({ error: error.message, marker: VIDEO_PLATFORM_MARKER }, 500);

    const videos: any[] = vids ?? [];
    const ids = videos.map((v) => String(v.id));

    const [counts, playback, metaDoc, analyticsDoc, profile, followState] = await Promise.all([
      loadEngagementCounts(sb, ids),
      loadPlaybackIndex(),
      getMetaDoc(),
      getAnalyticsDoc(),
      viewerId ? getViewerProfile(viewerId) : Promise.resolve(null),
      viewerId ? getFollowState(viewerId) : Promise.resolve({ following: [] as string[] }),
    ]);

    const now = Date.now();
    const metaFor = (id: string): VideoMeta => normalizeVideoMeta(metaDoc[id]);

    // Admin visibility controls: hide switch, draft status, publish schedule, expiration.
    let filtered = videos.filter((v) => isMetaVisible(metaFor(String(v.id)), now));
    // Channel filter: audience-tagged videos for that channel; untagged videos stay in "for you" only.
    if (channel && (VIDEO_AUDIENCES as readonly string[]).includes(channel)) {
      filtered = filtered.filter((v) => metaFor(String(v.id)).audiences.includes(channel));
    }
    // Stories never appear in the main feed.
    filtered = filtered.filter((v) => {
      const m = metaFor(String(v.id));
      return !(m.is_story && m.story_expires_at && Date.parse(m.story_expires_at) > now);
    });

    // Canonical NEUTRAL ranking context — no viewer personalization, so every
    // platform (landing / Android / iOS / desktop) gets the IDENTICAL order.
    // viewer_id is still used below for liked/saved flags only.
    const ctx: RankContext = {
      channel,
      zip: zipParam,
      profile: null,
      watched: [],
      following: new Set<string>(),
      stats: analyticsDoc.videos,
      meta: metaDoc,
    };

    const rankable: (RankableVideo & { row: any; display_order: number | null; meta: VideoMeta })[] = filtered.map((v) => {
      const m = metaFor(String(v.id));
      return {
        id: String(v.id),
        created_at: String(v.created_at),
        like_count: counts[String(v.id)]?.likes ?? 0,
        comment_count: counts[String(v.id)]?.comments ?? 0,
        share_count: counts[String(v.id)]?.shares ?? 0,
        save_count: counts[String(v.id)]?.saves ?? 0,
        is_pinned: v.is_pinned === true,
        display_order: m.display_order,
        meta: m,
        row: v,
      };
    });

    // Type split: investor deal videos vs project reels vs featured investor videos.
    const reels = canonicalSort(rankable.filter((r) => r.meta.video_type === 'reel'), ctx);
    const dealVideos = canonicalSort(rankable.filter((r) => r.meta.video_type !== 'reel' && !r.meta.is_featured), ctx);
    const featured = canonicalSort(rankable.filter((r) => r.meta.video_type !== 'reel' && r.meta.is_featured), ctx);

    // Unified investor-first composition: 3 deal videos → 1 featured investor video → repeat.
    // Fallback: if the dedicated Reels rail is empty, serve the unified investor feed so
    // the Reels surface never appears broken to visitors.
    const composed = reelsOnly ? (reels.length > 0 ? reels : composeUnifiedFeed(dealVideos, featured)) : composeUnifiedFeed(dealVideos, featured);

    // Viewer state (liked / saved) for the page being returned.
    const page = composed.slice(offset, offset + limit);
    const pageIds = page.map((p) => p.id);
    const dealCandidates: string[] = [];
    const titles: Record<string, string> = {};
    for (const p of page) {
      const m = p.meta;
      if (m.property_id) dealCandidates.push(String(m.property_id));
      if (p.row.project_id) dealCandidates.push(String(p.row.project_id));
      titles[p.id] = p.row.title ?? ((m as Record<string, unknown>).title as string | undefined) ?? '';
    }
    const dealsById = await loadFeedDeals(sb, dealCandidates, titles);
    const viewerFollowing = new Set(followState.following);
    void profile;
    let likedSet = new Set<string>();
    let savedSet = new Set<string>();
    if (viewerId && pageIds.length > 0) {
      const [lr, sr] = await Promise.all([
        sb.from('project_likes').select('project_id').in('project_id', pageIds).or(`user_id.eq.${viewerId},guest_id.eq.${viewerId}`),
        sb.from('project_saves').select('project_id').in('project_id', pageIds).or(`user_id.eq.${viewerId},guest_id.eq.${viewerId}`),
      ]);
      likedSet = new Set((lr.data || []).map((r: any) => String(r.project_id)));
      savedSet = new Set((sr.data || []).map((r: any) => String(r.project_id)));
    }

    const feed = page.map((p) => {
      const v = p.row;
      const pb = playback[p.id];
      const m = p.meta;
      const stats = analyticsDoc.videos[p.id];
      const deal = dealsById[p.id] ?? null;
      return {
        id: p.id,
        project_id: v.project_id ? String(v.project_id) : null,
        video_url: v.video_url,
        hls_url: pb?.status === 'ready' ? pb.hls_url : null,
        poster_url: pb?.poster_url ?? null,
        preview_blur_url: (pb as { preview_blur_url?: string | null } | undefined)?.preview_blur_url ?? null,
        playback_status: pb?.status ?? null,
        thumbnail_url: v.thumbnail_url ?? pb?.thumbnail_url ?? null,
        title: v.title ?? null,
        duration_sec: v.duration_sec ?? 0,
        width: v.width ?? null,
        height: v.height ?? null,
        orientation: v.orientation ?? 'landscape',
        is_pinned: p.is_pinned,
        created_at: v.created_at,
        like_count: p.like_count,
        comment_count: p.comment_count,
        share_count: p.share_count,
        save_count: p.save_count,
        view_count: stats?.views ?? 0,
        audiences: m.audiences,
        property_id: m.property_id,
        creator_id: m.creator_id,
        zip: m.zip,
        video_type: m.video_type,
        is_featured: m.is_featured,
        display_order: m.display_order,
        publish_at: m.publish_at,
        expires_at: m.expires_at,
        status: m.status,
        viewer_liked: likedSet.has(p.id),
        viewer_saved: savedSet.has(p.id),
        viewer_following_creator: !!(m.creator_id && viewerFollowing.has(m.creator_id)),
        deal,
      };
    });

    const nextOffset = offset + page.length;
    return json({
      videos: feed,
      count: feed.length,
      total: composed.length,
      next_cursor: nextOffset < composed.length ? encodeCursor(nextOffset) : null,
      channel,
      feed_type: reelsOnly ? 'reel' : 'unified',
      ordering: 'canonical-unified-v2',
      personalized: false,
      marker: VIDEO_PLATFORM_MARKER,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'feed failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
  }); // withFeedCache
}

/* ---------------- investor-first HOME feed ---------------- */

type HomeFeedDeal = {
  id: string;
  name: string | null;
  city: string | null;
  phase: string | null;
  status: string | null;
  deal_type: string | null;
  investment_amount: number | null;
  expected_roi: string | null;
  min_investment: number | null;
  progress_percent: number | null;
  photo_url: string | null;
  url: string;
  is_featured: boolean;
  priority: number;
  display_order: number | null;
  created_at: string | null;
};

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : NaN;
  return Number.isFinite(n) ? n : null;
}

function firstPhoto(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    const p = raw.find((x) => typeof x === 'string' && x.startsWith('http'));
    return p ? String(p) : null;
  }
  if (typeof raw === 'string') {
    try { return firstPhoto(JSON.parse(raw)); } catch { return raw.startsWith('http') ? raw : null; }
  }
  return null;
}

function toHomeFeedDeal(row: Record<string, unknown>, meta: DealMeta): HomeFeedDeal {
  const id = String(row.id);
  const total = num(row.total_investment) ?? num(row.estimated_value) ?? num(row.appraised_value);
  const raised = num(row.amount_raised) ?? num(row.funds_raised) ?? num(row.raised_amount);
  const explicitProgress = num(row.progress_percent) ?? num(row.funding_progress) ?? num(row.construction_progress);
  const progress = explicitProgress ?? (raised != null && total != null && total > 0
    ? Math.min(100, Math.round((raised / total) * 100))
    : null);
  const city = typeof row.city === 'string' && row.city
    ? (typeof row.state === 'string' && row.state ? `${row.city}, ${row.state}` : String(row.city))
    : (typeof row.property_address === 'string' ? String(row.property_address) : null);
  const phase = [row.construction_phase, row.phase, row.project_phase, row.stage]
    .map((v) => (typeof v === 'string' && v.trim() ? v.trim() : null))
    .find((v) => v != null) ?? null;
  return {
    id,
    name: (row.project_name ?? row.title ?? null) as string | null,
    city,
    phase,
    status: (row.status ?? null) as string | null,
    deal_type: (row.type ?? null) as string | null,
    investment_amount: total,
    expected_roi: row.expected_roi != null ? String(row.expected_roi) : null,
    min_investment: num(row.min_investment),
    progress_percent: progress,
    photo_url: firstPhoto(row.photos),
    url: `https://ivxholding.com/?deal=${id}#deals`,
    is_featured: meta.is_featured,
    priority: meta.priority,
    display_order: meta.display_order,
    created_at: (row.created_at ?? null) as string | null,
  };
}

/**
 * Canonical deterministic deal ordering — identical on every platform:
 * featured first → priority desc → admin display_order (nulls last) →
 * newest first → id tiebreak.
 */
function sortHomeFeedDeals(deals: HomeFeedDeal[]): HomeFeedDeal[] {
  return [...deals].sort((a, b) => {
    if (a.is_featured !== b.is_featured) return a.is_featured ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    const ao = a.display_order;
    const bo = b.display_order;
    if (ao !== null || bo !== null) {
      if (ao === null) return 1;
      if (bo === null) return -1;
      if (ao !== bo) return ao - bo;
    }
    const cmp = String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
    if (cmp !== 0) return cmp;
    return a.id.localeCompare(b.id);
  });
}

/**
 * GET /api/ivx/video-platform/home-feed — the SINGLE SOURCE OF TRUTH for the
 * investor-first home layout on landing page, Android, iOS, tablet, desktop:
 *
 *   Featured Deal 1–3 → 1 Featured Project Video → Deal 4–6 → 1 video → …
 *
 * Every video block is attached to a real project (deal enrichment required) —
 * unattached videos never appear. One admin publish updates every platform.
 */
export async function handlePlatformHomeFeed(req: Request): Promise<Response> {
  const cacheKey = feedCacheKey(req.url);
  return withFeedCache(cacheKey, async () => {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get('limit') || '60'), 1), 120);
    const sb = await getSB();
    const now = Date.now();

    /* ---- deals: published jv_deals + admin deal meta controls ---- */
    const [{ data: dealRows, error: dealsError }, dealMetaDoc] = await Promise.all([
      sb.from('jv_deals').select('id,title,project_name,type,description,total_investment,expected_roi,min_investment,status,published,property_address,city,state,zip_code,country,property_type,photos,created_at').eq('published', true).order('created_at', { ascending: false }).limit(100),
      getDealMetaDoc(),
    ]);
    if (dealsError) return json({ error: dealsError.message, marker: VIDEO_PLATFORM_MARKER }, 500);

    const seenDealIds = new Set<string>();
    const deals: HomeFeedDeal[] = [];
    for (const row of (dealRows ?? []) as Record<string, unknown>[]) {
      const id = String(row.id ?? '');
      if (!id || seenDealIds.has(id)) continue;
      const st = String(row.status ?? '').toLowerCase();
      if (['trashed', 'archived', 'permanently_deleted', 'expired'].includes(st)) continue;
      const meta = normalizeDealMeta(dealMetaDoc[id]);
      if (!isDealMetaVisible(meta, now)) continue;
      seenDealIds.add(id);
      deals.push(toHomeFeedDeal(row, meta));
    }
    const orderedDeals = sortHomeFeedDeals(deals);

    /* ---- featured project videos: approved + visible + attached to a real deal ---- */
    const { data: vids, error: vidsError } = await sb
      .from('project_videos')
      .select('id,project_id,media_id,title,video_url,thumbnail_url,cover_url,duration_sec,width,height,orientation,is_pinned,is_approved,view_count,created_at')
      .eq('is_approved', true)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(200);
    if (vidsError) return json({ error: vidsError.message, marker: VIDEO_PLATFORM_MARKER }, 500);

    const videos: any[] = vids ?? [];
    const ids = videos.map((v) => String(v.id));
    const [counts, playback, metaDoc, analyticsDoc] = await Promise.all([
      loadEngagementCounts(sb, ids),
      loadPlaybackIndex(),
      getMetaDoc(),
      getAnalyticsDoc(),
    ]);
    const metaFor = (id: string): VideoMeta => normalizeVideoMeta(metaDoc[id]);

    const visible = videos.filter((v) => {
      const m = metaFor(String(v.id));
      if (!isMetaVisible(m, now)) return false;
      if (m.is_story && m.story_expires_at && Date.parse(m.story_expires_at) > now) return false;
      return true;
    });

    const ctx: RankContext = {
      channel: null,
      zip: null,
      profile: null,
      watched: [],
      following: new Set<string>(),
      stats: analyticsDoc.videos,
      meta: metaDoc,
    };
    const rankable = visible.map((v) => {
      const m = metaFor(String(v.id));
      return {
        id: String(v.id),
        created_at: String(v.created_at),
        like_count: counts[String(v.id)]?.likes ?? 0,
        comment_count: counts[String(v.id)]?.comments ?? 0,
        share_count: counts[String(v.id)]?.shares ?? 0,
        save_count: counts[String(v.id)]?.saves ?? 0,
        is_pinned: v.is_pinned === true,
        display_order: m.display_order,
        meta: m,
        row: v,
      };
    });

    // Deal attachment is REQUIRED — a video must belong to one project.
    const dealById = new Map(orderedDeals.map((d) => [d.id, d]));
    // Fallback: match a video to a deal by name when project_id/property_id are UUIDs or missing.
    const titleToDealId = new Map<string, string>();
    for (const d of orderedDeals) {
      const name = (d.name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (name) titleToDealId.set(name, d.id);
    }
    function resolveAttachedDeal(r: (typeof rankable)[number]): { attached: boolean; dealId: string | null } {
      const pid = r.meta.property_id ? String(r.meta.property_id) : null;
      const proj = r.row.project_id ? String(r.row.project_id) : null;
      if (pid && dealById.has(pid)) return { attached: true, dealId: pid };
      if (proj && dealById.has(proj)) return { attached: true, dealId: proj };
      const title = String(r.row.title ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
      for (const [name, dealId] of titleToDealId) {
        if (title.includes(name) || name.includes(title)) return { attached: true, dealId };
      }
      return { attached: false, dealId: null };
    }
    const attached = rankable.filter((r) => resolveAttachedDeal(r).attached);
    // Featured project videos only; if none are flagged featured yet, fall back
    // to pinned deal-attached videos so the layout still renders end to end.
    const flagged = attached.filter((r) => r.meta.is_featured);
    const featuredPool = canonicalSort(flagged.length > 0 ? flagged : attached.filter((r) => r.is_pinned), ctx);

    // De-duplicate by attached project — max ONE featured video per project.
    const usedProjects = new Set<string>();
    const featuredVideos: any[] = [];
    for (const r of featuredPool) {
      const resolved = resolveAttachedDeal(r);
      const projectKey = resolved.dealId ?? String(r.meta.property_id ?? r.row.project_id);
      if (usedProjects.has(projectKey)) continue;
      usedProjects.add(projectKey);
      const pb = playback[r.id];
      const stats = analyticsDoc.videos[r.id];
      const deal = resolved.dealId ? dealById.get(resolved.dealId) ?? null : null;
      featuredVideos.push({
        id: r.id,
        project_id: r.row.project_id ? String(r.row.project_id) : null,
        video_url: r.row.video_url,
        hls_url: pb?.status === 'ready' ? pb.hls_url : null,
        poster_url: pb?.poster_url ?? null,
        preview_blur_url: (pb as { preview_blur_url?: string | null } | undefined)?.preview_blur_url ?? null,
        playback_status: pb?.status ?? null,
        thumbnail_url: r.row.thumbnail_url ?? pb?.thumbnail_url ?? null,
        title: r.row.title ?? null,
        duration_sec: r.row.duration_sec ?? 0,
        width: r.row.width ?? null,
        height: r.row.height ?? null,
        orientation: r.row.orientation ?? 'landscape',
        is_pinned: r.is_pinned,
        created_at: r.row.created_at,
        like_count: r.like_count,
        comment_count: r.comment_count,
        share_count: r.share_count,
        save_count: r.save_count,
        view_count: stats?.views ?? 0,
        video_type: r.meta.video_type,
        is_featured: true,
        property_id: resolved.dealId ?? r.meta.property_id,
        deal,
      });
    }

    /* ---- compose: 3 deals → 1 featured project video → repeat ---- */
    const blocks = composeInvestorFirstHome(orderedDeals, featuredVideos)
      .slice(0, limit)
      .map((b, i) => ({
        position: i,
        display_type: b.type === 'video' ? 'reel' : 'investment_card',
        ...b,
      }));

    return json({
      pattern: '3-deals-1-featured-project-video',
      ordering: 'canonical-home-v3',
      blocks,
      count: blocks.length,
      deal_count: orderedDeals.length,
      video_count: featuredVideos.length,
      total_approved_videos: videos.length,
      personalized: false,
      marker: VIDEO_PLATFORM_MARKER,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'home feed failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
  }); // withFeedCache
}

/**
 * POST /api/ivx/video-platform/deals/:dealId/meta — admin deal controls:
 * featured, priority, display order, expiration, hide, publish/draft, schedule.
 * One publish action updates every platform automatically.
 */
export async function handlePlatformDealMeta(req: Request, dealId: string): Promise<Response> {
  try {
    if (!dealId) return json({ error: 'dealId required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const body = await readBody(req);
    const meta = await upsertDealMeta(dealId, {
      is_featured: body.is_featured !== undefined ? body.is_featured === true : undefined,
      priority: body.priority !== undefined ? Number(body.priority) : undefined,
      display_order: body.display_order !== undefined ? (body.display_order === null ? null : Number(body.display_order)) : undefined,
      publish_at: body.publish_at !== undefined ? (str(body.publish_at) || null) : undefined,
      expires_at: body.expires_at !== undefined ? (str(body.expires_at) || null) : undefined,
      is_hidden: body.is_hidden !== undefined ? body.is_hidden === true : undefined,
      status: body.status !== undefined ? (str(body.status) === 'draft' ? 'draft' : 'published') : undefined,
    });
    return json({ ok: true, deal_id: dealId, meta, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'deal meta update failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** GET /api/ivx/video-platform/channels */
export async function handlePlatformChannels(): Promise<Response> {
  try {
    const sb = await getSB();
    const [metaDoc, { data: vids }] = await Promise.all([
      getMetaDoc(),
      sb.from('project_videos').select('id,project_id,title').eq('is_approved', true).limit(500),
    ]);
    const audienceCounts: Record<string, number> = {};
    for (const a of VIDEO_AUDIENCES) audienceCounts[a] = 0;
    const propertyChannels: Record<string, { project_id: string; video_count: number; sample_title: string | null }> = {};
    for (const v of (vids ?? []) as any[]) {
      const meta = metaDoc[String(v.id)];
      for (const a of meta?.audiences ?? []) if (audienceCounts[a] !== undefined) audienceCounts[a] += 1;
      const pid = v.project_id ? String(v.project_id) : null;
      if (pid && pid !== String(v.id)) {
        const entry = propertyChannels[pid] ?? { project_id: pid, video_count: 0, sample_title: null };
        entry.video_count += 1;
        if (!entry.sample_title && v.title) entry.sample_title = String(v.title);
        propertyChannels[pid] = entry;
      }
    }
    return json({
      audiences: VIDEO_AUDIENCES.map((a) => ({ id: a, label: a === 'jv' ? 'JV Deals' : a.charAt(0).toUpperCase() + a.slice(1), video_count: audienceCounts[a] })),
      properties: Object.values(propertyChannels).sort((a, b) => b.video_count - a.video_count),
      marker: VIDEO_PLATFORM_MARKER,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'channels failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/* ---------------- analytics events ---------------- */

/** POST /api/ivx/video-platform/events — single event or { events: [...] }. */
export async function handlePlatformEvents(req: Request): Promise<Response> {
  try {
    const body = await readBody(req);
    const rawEvents = Array.isArray(body.events) ? body.events : [body];
    const events: PlatformEvent[] = [];
    for (const raw of rawEvents) {
      if (!raw || typeof raw !== 'object') continue;
      const r = raw as Record<string, unknown>;
      const type = str(r.type) as PlatformEvent['type'];
      if (!['view', 'watch', 'complete', 'double_tap_like', 'share', 'profile'].includes(type)) continue;
      events.push({
        type,
        video_id: str(r.video_id) || undefined,
        viewer_id: str(r.viewer_id) || undefined,
        watch_ms: Number(r.watch_ms) || undefined,
        zip: str(r.zip) || undefined,
        audience: str(r.audience) || undefined,
        preferences: Array.isArray(r.preferences) ? r.preferences.map(String) : undefined,
      });
    }
    if (events.length === 0) return json({ error: 'no valid events', marker: VIDEO_PLATFORM_MARKER }, 400);
    const { recorded } = await recordEvents(events);
    return json({ ok: true, recorded, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'events failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** GET /api/ivx/video-platform/videos/:videoId/analytics */
export async function handlePlatformVideoAnalytics(videoId: string): Promise<Response> {
  try {
    const stats = await getVideoStats(videoId);
    const { viewer_ids: _omit, ...publicStats } = stats;
    const avgWatchSec = stats.views > 0 ? Math.round(stats.watch_ms / stats.views / 100) / 10 : 0;
    return json({ video_id: videoId, ...publicStats, avg_watch_sec: avgWatchSec, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'analytics failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** POST /api/ivx/video-platform/videos/:videoId/meta */
export async function handlePlatformVideoMeta(req: Request, videoId: string): Promise<Response> {
  try {
    if (!videoId) return json({ error: 'videoId required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const body = await readBody(req);
    const meta = await upsertVideoMeta(videoId, {
      audiences: Array.isArray(body.audiences) ? body.audiences.map(String) : undefined,
      zip: body.zip !== undefined ? (str(body.zip) || null) : undefined,
      property_id: body.property_id !== undefined ? (str(body.property_id) || null) : undefined,
      creator_id: body.creator_id !== undefined ? (str(body.creator_id) || null) : undefined,
      is_story: body.is_story !== undefined ? body.is_story === true : undefined,
      story_expires_at: body.story_expires_at !== undefined ? (str(body.story_expires_at) || null) : undefined,
      // Unified-feed admin controls — one publish action updates every platform.
      video_type: body.video_type !== undefined ? (str(body.video_type) === 'reel' ? 'reel' : 'deal') : undefined,
      is_featured: body.is_featured !== undefined ? body.is_featured === true : undefined,
      display_order: body.display_order !== undefined ? (body.display_order === null ? null : Number(body.display_order)) : undefined,
      publish_at: body.publish_at !== undefined ? (str(body.publish_at) || null) : undefined,
      expires_at: body.expires_at !== undefined ? (str(body.expires_at) || null) : undefined,
      is_hidden: body.is_hidden !== undefined ? body.is_hidden === true : undefined,
      status: body.status !== undefined ? (str(body.status) === 'draft' ? 'draft' : 'published') : undefined,
    });
    return json({ ok: true, video_id: videoId, meta, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'meta update failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/* ---------------- follow ---------------- */

/** POST /api/ivx/video-platform/follow */
export async function handlePlatformFollowToggle(req: Request): Promise<Response> {
  try {
    const body = await readBody(req);
    const followerId = str(body.follower_id);
    const creatorId = str(body.creator_id);
    if (!followerId || !creatorId) return json({ error: 'follower_id and creator_id required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const result = await toggleFollow(followerId, creatorId);
    return json({ ok: true, ...result, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'follow failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** GET /api/ivx/video-platform/follow/:followerId */
export async function handlePlatformFollowList(followerId: string): Promise<Response> {
  try {
    const state = await getFollowState(followerId);
    return json({ follower_id: followerId, ...state, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'follow lookup failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/* ---------------- stories ---------------- */

/** GET /api/ivx/video-platform/stories — active 24h stories. */
export async function handlePlatformStoriesList(): Promise<Response> {
  try {
    const sb = await getSB();
    const [metaDoc, playback] = await Promise.all([getMetaDoc(), loadPlaybackIndex()]);
    const activeIds = Object.entries(metaDoc)
      .filter(([, m]) => m.is_story && m.story_expires_at && Date.parse(m.story_expires_at) > Date.now())
      .map(([id]) => id);
    if (activeIds.length === 0) return json({ stories: [], count: 0, marker: VIDEO_PLATFORM_MARKER });

    const { data: vids } = await sb.from('project_videos').select('id,project_id,media_id,title,video_url,thumbnail_url,cover_url,duration_sec,orientation,is_pinned,created_at').in('id', activeIds);
    const stories = (vids ?? []).map((v: any) => {
      const id = String(v.id);
      const pb = playback[id];
      const m = metaDoc[id];
      return {
        id,
        title: v.title ?? null,
        video_url: v.video_url,
        hls_url: pb?.status === 'ready' ? pb.hls_url : null,
        poster_url: pb?.poster_url ?? null,
        thumbnail_url: v.thumbnail_url ?? pb?.thumbnail_url ?? null,
        duration_sec: v.duration_sec ?? 0,
        creator_id: m?.creator_id ?? null,
        expires_at: m?.story_expires_at ?? null,
        created_at: v.created_at,
      };
    }).sort((a: any, b: any) => String(b.created_at).localeCompare(String(a.created_at)));
    return json({ stories, count: stories.length, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'stories failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** POST /api/ivx/video-platform/stories — { video_id, expires_hours?, creator_id? }. */
export async function handlePlatformStoryCreate(req: Request): Promise<Response> {
  try {
    const body = await readBody(req);
    const videoId = str(body.video_id);
    if (!videoId) return json({ error: 'video_id required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const hours = Math.min(Math.max(Number(body.expires_hours) || 24, 1), 72);
    const expiresAt = new Date(Date.now() + hours * 3_600_000).toISOString();
    const meta = await upsertVideoMeta(videoId, {
      is_story: true,
      story_expires_at: expiresAt,
      creator_id: str(body.creator_id) || undefined,
    });
    return json({ ok: true, video_id: videoId, expires_at: expiresAt, meta, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'story create failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/* ---------------- live ---------------- */

/** GET /api/ivx/video-platform/live */
export async function handlePlatformLiveList(req: Request): Promise<Response> {
  try {
    const includeEnded = new URL(req.url).searchParams.get('include_ended') === '1';
    const sessions = await listLiveSessions(includeEnded);
    return json({ sessions, count: sessions.length, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'live list failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** POST /api/ivx/video-platform/live/start */
export async function handlePlatformLiveStart(req: Request): Promise<Response> {
  try {
    const body = await readBody(req);
    const hostId = str(body.host_id);
    const title = str(body.title);
    if (!hostId || !title) return json({ error: 'host_id and title required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const playbackUrl = str(body.playback_url) || null;
    if (playbackUrl && !/^https?:\/\//i.test(playbackUrl)) {
      return json({ error: 'playback_url must be an http(s) URL (HLS .m3u8 recommended)', marker: VIDEO_PLATFORM_MARKER }, 400);
    }
    const session = await startLiveSession({ hostId, title, playbackUrl });
    return json({ ok: true, session, marker: VIDEO_PLATFORM_MARKER }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'live start failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** GET /api/ivx/video-platform/live/:sessionId/status */
export async function handlePlatformLiveStatus(sessionId: string): Promise<Response> {
  try {
    const session = await getLiveSession(sessionId);
    if (!session) return json({ error: 'session not found', marker: VIDEO_PLATFORM_MARKER }, 404);
    return json({ ok: true, session, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'live status failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

const MAX_LIVE_SEGMENT_BYTES = 16 * 1024 * 1024;

/** POST /api/ivx/video-platform/live/:sessionId/ingest — binary MPEG-TS segment body */
export async function handlePlatformLiveIngest(req: Request, sessionId: string): Promise<Response> {
  try {
    const duration = Number(new URL(req.url).searchParams.get('duration')) || 4;
    const buf = new Uint8Array(await req.arrayBuffer());
    if (buf.byteLength === 0) return json({ error: 'empty segment body', marker: VIDEO_PLATFORM_MARKER }, 400);
    if (buf.byteLength > MAX_LIVE_SEGMENT_BYTES) return json({ error: 'segment exceeds 16MB limit', marker: VIDEO_PLATFORM_MARKER }, 413);
    const session = await ingestLiveSegment(sessionId, buf, duration);
    return json({
      ok: true,
      session_id: session.id,
      status: session.status,
      segment_seq: session.segment_count - 1,
      segment_count: session.segment_count,
      playback_url: session.playback_url,
      marker: VIDEO_PLATFORM_MARKER,
    }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'live ingest failed';
    const status = message.includes('not found') ? 404 : message.includes('rejected') || message.includes('not enabled') ? 409 : 500;
    return json({ error: message, marker: VIDEO_PLATFORM_MARKER }, status);
  }
}

/** POST /api/ivx/video-platform/live/:sessionId/stop */
export async function handlePlatformLiveStop(sessionId: string): Promise<Response> {
  try {
    const session = await stopLiveSession(sessionId, { reason: 'host_stop' });
    if (!session) return json({ error: 'session not found', marker: VIDEO_PLATFORM_MARKER }, 404);
    return json({ ok: true, session, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'live stop failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** POST /api/ivx/video-platform/live/:sessionId/moderate — owner force-end */
export async function handlePlatformLiveModerate(req: Request, sessionId: string): Promise<Response> {
  try {
    const body = await readBody(req);
    const moderatorId = str(body.moderator_id);
    if (!moderatorId) return json({ error: 'moderator_id required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const reason = str(body.reason) || 'moderation_force_end';
    const session = await stopLiveSession(sessionId, { reason, moderatorId });
    if (!session) return json({ error: 'session not found', marker: VIDEO_PLATFORM_MARKER }, 404);
    return json({ ok: true, session, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'live moderate failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/* ---------------- creator dashboard ---------------- */

/** GET /api/ivx/video-platform/creator/:creatorId/dashboard */
export async function handlePlatformCreatorDashboard(creatorId: string): Promise<Response> {
  try {
    const sb = await getSB();
    const [metaDoc, analyticsDoc, { getFollowerCount }] = await Promise.all([
      getMetaDoc(),
      getAnalyticsDoc(),
      import('../services/ivx-video-platform-store'),
    ]);
    const creatorVideoIds = Object.entries(metaDoc)
      .filter(([, m]) => m.creator_id === creatorId)
      .map(([id]) => id);

    const { data: vids } = creatorVideoIds.length > 0
      ? await sb.from('project_videos').select('id,title,created_at,is_approved,duration_sec').in('id', creatorVideoIds)
      : { data: [] as any[] };
    const counts = await loadEngagementCounts(sb, creatorVideoIds);

    let totalViews = 0;
    let totalWatchMs = 0;
    let totalCompletions = 0;
    const videos = (vids ?? []).map((v: any) => {
      const id = String(v.id);
      const stats = analyticsDoc.videos[id];
      totalViews += stats?.views ?? 0;
      totalWatchMs += stats?.watch_ms ?? 0;
      totalCompletions += stats?.completions ?? 0;
      return {
        id,
        title: v.title ?? null,
        created_at: v.created_at,
        is_approved: v.is_approved === true,
        duration_sec: v.duration_sec ?? 0,
        views: stats?.views ?? 0,
        unique_viewers: stats?.unique_viewers ?? 0,
        watch_ms: stats?.watch_ms ?? 0,
        completions: stats?.completions ?? 0,
        double_tap_likes: stats?.double_tap_likes ?? 0,
        likes: counts[id]?.likes ?? 0,
        comments: counts[id]?.comments ?? 0,
        shares: counts[id]?.shares ?? 0,
        saves: counts[id]?.saves ?? 0,
      };
    }).sort((a: any, b: any) => b.views - a.views);

    const followerCount = await getFollowerCount(creatorId);
    return json({
      creator_id: creatorId,
      follower_count: followerCount,
      video_count: videos.length,
      total_views: totalViews,
      total_watch_hours: Math.round(totalWatchMs / 3_600_000 * 100) / 100,
      total_completions: totalCompletions,
      videos,
      marker: VIDEO_PLATFORM_MARKER,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'dashboard failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/* ---------------- moderation ---------------- */

/** POST /api/ivx/video-platform/videos/:videoId/report */
export async function handlePlatformReport(req: Request, videoId: string): Promise<Response> {
  try {
    if (!videoId) return json({ error: 'videoId required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const body = await readBody(req);
    const reason = str(body.reason) || 'unspecified';
    const report = await addReport({ videoId, reporterId: str(body.reporter_id) || null, reason });
    return json({ ok: true, report, marker: VIDEO_PLATFORM_MARKER }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'report failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** GET /api/ivx/video-platform/moderation/queue */
export async function handlePlatformModerationQueue(): Promise<Response> {
  try {
    const sb = await getSB();
    const doc = await getModerationDoc();
    const { data: pending } = await sb
      .from('project_videos')
      .select('id,title,created_at,video_url,thumbnail_url')
      .eq('is_approved', false)
      .order('created_at', { ascending: false })
      .limit(100);
    return json({
      open_reports: doc.reports.filter((r) => !r.resolved),
      resolved_reports: doc.reports.filter((r) => r.resolved).slice(-50),
      pending_videos: pending ?? [],
      decisions: doc.decisions,
      marker: VIDEO_PLATFORM_MARKER,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'moderation queue failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** GET /api/ivx/video-platform/admin/videos — ALL videos (including hidden/draft) for admin management. */
export async function handlePlatformAdminListVideos(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const typeFilter = str(url.searchParams.get('type')).toLowerCase();
    const sb = await getSB();
    let query = sb
      .from('project_videos')
      .select('id,project_id,video_url,thumbnail_url,cover_url,title,duration_sec,width,height,orientation,is_approved,is_pinned,created_at')
      .order('created_at', { ascending: false })
      .limit(500);
    if (typeFilter === 'reel' || typeFilter === 'deal') {
      // type is stored in platform meta, not in project_videos — filter after join
    }
    const { data: vids, error } = await query;
    if (error) return json({ error: error.message, marker: VIDEO_PLATFORM_MARKER }, 500);

    const [playback, metaDoc] = await Promise.all([loadPlaybackIndex(), getMetaDoc()]);
    const videos = (vids ?? []).map((v: any) => {
      const id = String(v.id);
      const m = normalizeVideoMeta(metaDoc[id]);
      const pb = playback[id];
      return {
        id,
        project_id: v.project_id ?? null,
        video_url: v.video_url,
        hls_url: pb?.status === 'ready' ? pb.hls_url : null,
        poster_url: pb?.poster_url ?? v.cover_url ?? v.thumbnail_url ?? null,
        thumbnail_url: v.thumbnail_url ?? pb?.thumbnail_url ?? null,
        title: v.title ?? null,
        duration_sec: v.duration_sec ?? 0,
        width: v.width ?? null,
        height: v.height ?? null,
        orientation: v.orientation ?? null,
        is_approved: v.is_approved ?? false,
        is_pinned: v.is_pinned ?? false,
        created_at: v.created_at,
        video_type: m.video_type,
        is_featured: m.is_featured,
        is_hidden: m.is_hidden,
        status: m.status,
        display_order: m.display_order,
      };
    });

    const filtered = typeFilter === 'reel' || typeFilter === 'deal'
      ? videos.filter((v: any) => v.video_type === typeFilter)
      : videos;

    return json({
      ok: true,
      videos: filtered,
      count: filtered.length,
      total: videos.length,
      marker: VIDEO_PLATFORM_MARKER,
    });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'admin list failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** POST /api/ivx/video-platform/admin/add-reel — owner adds a video by URL (no developer needed). */
export async function handlePlatformAdminAddReel(req: Request): Promise<Response> {
  try {
    const body = await readBody(req);
    const videoUrl = str(body.video_url);
    if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
      return json({ ok: false, error: 'video_url is required and must be a valid http(s) URL', marker: VIDEO_PLATFORM_MARKER }, 400);
    }
    const title = str(body.title) || 'IVX Project Reel';
    const videoType = str(body.video_type) === 'reel' ? 'reel' : 'deal';
    const projectId = str(body.project_id) || null;
    const posterUrl = str(body.poster_url) || null;
    const thumbnailUrl = str(body.thumbnail_url) || null;
    const durationSec = Number(body.duration_sec) || 0;
    const width = Number(body.width) || null;
    const height = Number(body.height) || null;

    const { randomUUID } = await import('node:crypto');
    const videoId = body.video_id ? str(body.video_id) : randomUUID();

    const sb = await getSB();
    const orientation = (width && height && height > width) ? 'portrait' : 'landscape';
    const row = {
      id: videoId,
      project_id: projectId || videoId,
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      cover_url: posterUrl,
      title,
      duration_sec: durationSec,
      width,
      height,
      orientation,
      is_approved: true,
    };
    const { data, error } = await sb.from('project_videos').upsert(row, { onConflict: 'id' }).select('id').maybeSingle();
    if (error) {
      return json({ ok: false, error: `Supabase insert failed: ${error.message}`, marker: VIDEO_PLATFORM_MARKER }, 500);
    }

    // Set platform meta: type (reel or deal), status published, visible
    const meta = await upsertVideoMeta(videoId, {
      video_type: videoType,
      is_hidden: false,
      status: 'published',
      property_id: projectId || undefined,
    });

    return json({
      ok: true,
      video_id: videoId,
      title,
      video_type: videoType,
      video_url: videoUrl,
      poster_url: posterUrl,
      project_id: projectId,
      meta,
      marker: VIDEO_PLATFORM_MARKER,
    }, 201);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'add reel failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** POST /api/ivx/video-platform/admin/videos/:videoId — update video (hide/show, type, order, delete). */
export async function handlePlatformAdminUpdateVideo(req: Request, videoId: string): Promise<Response> {
  try {
    if (!videoId) return json({ error: 'videoId required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const body = await readBody(req);
    const action = str(body.action) || 'update';

    if (action === 'delete') {
      const sb = await getSB();
      const { error } = await sb.from('project_videos').delete().eq('id', videoId);
      if (error) return json({ ok: false, error: `delete failed: ${error.message}`, marker: VIDEO_PLATFORM_MARKER }, 500);
      return json({ ok: true, video_id: videoId, deleted: true, marker: VIDEO_PLATFORM_MARKER });
    }

    // Update platform meta (hide/show, type, featured, order, status, property_id)
    const meta = await upsertVideoMeta(videoId, {
      video_type: body.video_type !== undefined ? (str(body.video_type) === 'reel' ? 'reel' : 'deal') : undefined,
      is_hidden: body.is_hidden !== undefined ? body.is_hidden === true : undefined,
      is_featured: body.is_featured !== undefined ? body.is_featured === true : undefined,
      display_order: body.display_order !== undefined ? (body.display_order === null ? null : Number(body.display_order)) : undefined,
      status: body.status !== undefined ? (str(body.status) === 'draft' ? 'draft' : 'published') : undefined,
      property_id: body.property_id !== undefined ? (str(body.property_id) || null) : undefined,
    });

    // Optional: update project_videos row (title, project_id)
    const projectIdUpdate: Record<string, unknown> = {};
    if (body.title !== undefined) projectIdUpdate.title = str(body.title);
    if (body.project_id !== undefined) projectIdUpdate.project_id = str(body.project_id) || null;
    if (Object.keys(projectIdUpdate).length > 0) {
      const sb = await getSB();
      await sb.from('project_videos').update(projectIdUpdate).eq('id', videoId);
    }

    return json({ ok: true, video_id: videoId, meta, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'update failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}

/** POST /api/ivx/video-platform/moderation/:videoId — approve | reject | flag. */
export async function handlePlatformModerationDecision(req: Request, videoId: string): Promise<Response> {
  try {
    if (!videoId) return json({ error: 'videoId required', marker: VIDEO_PLATFORM_MARKER }, 400);
    const body = await readBody(req);
    const action = str(body.action) as 'approve' | 'reject' | 'flag';
    if (!['approve', 'reject', 'flag'].includes(action)) {
      return json({ error: 'action must be approve, reject, or flag', marker: VIDEO_PLATFORM_MARKER }, 400);
    }
    const sb = await getSB();
    let dbUpdate: string | null = null;
    if (action === 'approve' || action === 'reject') {
      const { error } = await sb.from('project_videos').update({ is_approved: action === 'approve' }).eq('id', videoId);
      dbUpdate = error ? String(error.message) : `project_videos.is_approved=${action === 'approve'}`;
    }
    const decision = await recordModerationDecision(videoId, {
      action,
      reason: str(body.reason) || null,
      moderator_id: str(body.moderator_id) || null,
    });
    return json({ ok: true, video_id: videoId, decision, db_update: dbUpdate, marker: VIDEO_PLATFORM_MARKER });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : 'moderation failed', marker: VIDEO_PLATFORM_MARKER }, 500);
  }
}
