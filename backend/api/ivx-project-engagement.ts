/**
 * IVX Project Engagement API — Backend Handler
 *
 * REST API endpoints for project media, likes, comments, shares, saves, analytics.
 * Registered in hono.ts under /api/projects/engagement/*
 */
import type { Context } from 'hono';

// ── Helpers ────────────────────────────────────────────────────────────────

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try { return await req.json() as Record<string, unknown>; } catch { return {}; }
}

function safeStr(v: unknown): string { return typeof v === 'string' ? v.trim() : ''; }

// ── Post media limits (Instagram-style post: up to 8 pictures + 2 videos) ──
export const MAX_POST_IMAGES = 8;
export const MAX_POST_VIDEOS = 2;

/**
 * Canonical project UUIDs for landing-page deal slugs, so the landing page can
 * address a post by its human slug while all media rows share one project_id.
 */
const PROJECT_SLUG_MAP: Record<string, string> = {
  'casa-rosario-001': 'fe407c4b-0807-43ec-8976-e89d30435f46',
  'perez-residence-001': 'a1e52b77-3c04-4b58-9a41-7f2d8c6e1b90',
  'JV-202603-5190': 'b7c93d21-58f6-4e0a-8d12-4a9e3f7c2d55',
};

export function resolveProjectId(id: string | undefined): string {
  if (!id) return '';
  return PROJECT_SLUG_MAP[id] ?? id;
}

// We import supabase lazily since this runs in the backend (Node)
let _supabaseAdmin: any = null;
async function getSupabaseAdmin() {
  if (_supabaseAdmin) return _supabaseAdmin;
  const { createClient } = await import('@supabase/supabase-js');
  const url = (process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '').trim();
  _supabaseAdmin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return _supabaseAdmin;
}

// ── OPTIONS ────────────────────────────────────────────────────────────────

export const projectEngagementOptions = (c: Context): Response => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'https://ivxholding.com',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    },
  });
};

// ── Media ──────────────────────────────────────────────────────────────────

export async function handleProjectMediaGet(c: Context): Promise<Response> {
  const rawId = c.req.param('projectId');
  if (!rawId) return json({ error: 'projectId required' }, 400);
  const projectId = resolveProjectId(rawId);

  try {
    const sb = await getSupabaseAdmin();
    const [mediaRes, videoRes] = await Promise.all([
      sb.from('project_media').select('id,project_id,media_type,url,media_url,thumbnail_url,cover_image_url,title,description,duration_sec,width,height,position,is_approved,created_at').eq('project_id', projectId).eq('is_approved', true).order('position').limit(50),
      sb.from('project_videos').select('id,project_id,media_id,title,video_url,thumbnail_url,cover_url,duration_sec,width,height,orientation,is_pinned,is_approved,view_count,created_at').eq('project_id', projectId).eq('is_approved', true).order('is_pinned', { ascending: false }).order('created_at', { ascending: true }).limit(20),
    ]);

    const images = (mediaRes.data || []).filter((m: any) => m.media_type === 'image').slice(0, MAX_POST_IMAGES);
    const videos = (videoRes.data || []).slice(0, MAX_POST_VIDEOS);

    return json({
      project_id: projectId,
      slug: rawId !== projectId ? rawId : null,
      images,
      videos,
      limits: { max_images: MAX_POST_IMAGES, max_videos: MAX_POST_VIDEOS },
      counts: { images: images.length, videos: videos.length },
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

export async function handleProjectMediaUpload(c: Context): Promise<Response> {
  const rawId = c.req.param('projectId');
  const projectId = resolveProjectId(rawId);
  const body = await readBody(c.req.raw as unknown as Request);

  try {
    const sb = await getSupabaseAdmin();

    // Enforce Instagram-style post limits: max 8 pictures + 2 videos per post
    const mediaType = body.media_type === 'video' ? 'video' : 'image';
    const { count: existingCount } = await sb
      .from('project_media')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', projectId)
      .eq('media_type', mediaType);
    const limit = mediaType === 'video' ? MAX_POST_VIDEOS : MAX_POST_IMAGES;
    if ((existingCount ?? 0) >= limit) {
      return json({
        error: `Post limit reached: max ${MAX_POST_IMAGES} pictures and ${MAX_POST_VIDEOS} videos per post. This post already has ${existingCount} ${mediaType}${(existingCount ?? 0) === 1 ? '' : 's'}.`,
        limit_reached: true,
        media_type: mediaType,
        current_count: existingCount ?? 0,
        max_allowed: limit,
      }, 409);
    }

    const { data, error } = await sb.from('project_media').insert({
      project_id: projectId,
      media_type: body.media_type || 'image',
      url: body.url,
      thumbnail_url: body.thumbnail_url || body.url,
      cover_image_url: body.cover_image_url || null,
      title: body.title || null,
      description: body.description || null,
      duration_sec: body.duration_sec || null,
      width: body.width || null,
      height: body.height || null,
      file_size_bytes: body.file_size_bytes || null,
      position: existingCount ?? 0,
    }).select().single();

    if (error) return json({ error: error.message }, 500);

    let videoRecord = null;
    if (body.media_type === 'video') {
      const { data: vid, error: vidErr } = await sb.from('project_videos').insert({
        project_id: projectId,
        media_id: data.id,
        video_url: body.url,
        thumbnail_url: body.thumbnail_url || null,
        cover_url: body.cover_image_url || null,
        title: body.title || null,
        duration_sec: body.duration_sec || 0,
        width: body.width || null,
        height: body.height || null,
        orientation: body.orientation || 'landscape',
      }).select().single();
      if (!vidErr) videoRecord = vid;
    }

    return json({ success: true, media: data, video: videoRecord });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

export async function handleProjectMediaDelete(c: Context): Promise<Response> {
  const projectId = resolveProjectId(c.req.param('projectId'));
  const mediaId = c.req.param('mediaId');

  try {
    const sb = await getSupabaseAdmin();
    // Remove the companion video row first (if this media item is a video)
    await sb.from('project_videos').delete().eq('media_id', mediaId).eq('project_id', projectId);
    const { error } = await sb.from('project_media').delete().eq('id', mediaId).eq('project_id', projectId);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

export async function handleProjectVideoPin(c: Context): Promise<Response> {
  const projectId = resolveProjectId(c.req.param('projectId'));
  const videoId = c.req.param('videoId');

  try {
    const sb = await getSupabaseAdmin();
    await sb.from('project_videos').update({ is_pinned: false }).eq('project_id', projectId);
    const { error } = await sb.from('project_videos').update({ is_pinned: true }).eq('id', videoId);
    if (error) return json({ error: error.message }, 500);
    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Likes ──────────────────────────────────────────────────────────────────

export async function handleProjectLikeToggle(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const body = await readBody(c.req.raw as unknown as Request);
  const userId = safeStr(body.user_id);
  const guestId = safeStr(body.guest_id);

  if (!userId && !guestId) return json({ error: 'user_id or guest_id required' }, 400);

  try {
    const sb = await getSupabaseAdmin();
    let existingQuery = sb.from('project_likes').select('id').eq('project_id', projectId);
    existingQuery = userId ? existingQuery.eq('user_id', userId) : existingQuery.eq('guest_id', guestId);
    const { data: existing } = await existingQuery.maybeSingle();

    let liked = !existing;
    if (existing) {
      // Verify the delete actually removed the row (RLS can silently block it
      // when running on the anon key) so the client never shows a false state.
      const { data: deleted } = await sb.from('project_likes').delete().eq('id', existing.id).select('id');
      if (!deleted || deleted.length === 0) liked = true;
    } else {
      const row = userId
        ? { project_id: projectId, user_id: userId }
        : { project_id: projectId, guest_id: guestId };
      const { error: insertError } = await sb.from('project_likes').insert(row);
      if (insertError) return json({ error: insertError.message }, 500);
    }

    const { count } = await sb.from('project_likes').select('*', { count: 'exact', head: true }).eq('project_id', projectId);
    return json({ liked, like_count: count ?? 0 });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Comments ───────────────────────────────────────────────────────────────

export async function handleProjectCommentsGet(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const limit = Math.min(Number(c.req.query('limit') || '20'), 50);
  const offset = Math.max(Number(c.req.query('offset') || '0'), 0);

  try {
    const sb = await getSupabaseAdmin();
    const { data, count } = await sb.from('project_comments')
      .select('*', { count: 'exact' })
      .eq('project_id', projectId)
      .eq('is_approved', true)
      .is('deleted_at', null)
      .is('parent_id', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    return json({ comments: data || [], total: count ?? 0 });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

export async function handleProjectCommentAdd(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const body = await readBody(c.req.raw as unknown as Request);

  const commentBody = safeStr(body.body);
  if (!commentBody || commentBody.length > 2000) {
    return json({ error: 'body is required (max 2000 chars)' }, 400);
  }

  try {
    const sb = await getSupabaseAdmin();
    const { data, error } = await sb.from('project_comments').insert({
      project_id: projectId,
      user_id: safeStr(body.user_id) || null,
      guest_name: safeStr(body.guest_name) || null,
      parent_id: safeStr(body.parent_id) || null,
      body: commentBody,
      is_owner_reply: body.is_owner_reply === true,
    }).select().single();

    if (error) return json({ error: error.message }, 500);
    return json({ success: true, comment: data });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

export async function handleProjectCommentDelete(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const commentId = c.req.param('commentId');

  try {
    const sb = await getSupabaseAdmin();
    await sb.from('project_comments').update({ deleted_at: new Date().toISOString() }).eq('id', commentId).eq('project_id', projectId);
    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

export async function handleProjectCommentApprove(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const commentId = c.req.param('commentId');
  const body = await readBody(c.req.raw as unknown as Request);
  const approved = body.approved !== false;

  try {
    const sb = await getSupabaseAdmin();
    await sb.from('project_comments').update({ is_approved: approved }).eq('id', commentId).eq('project_id', projectId);
    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Engagement Summary ─────────────────────────────────────────────────────

export async function handleProjectEngagementGet(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const userId = safeStr(c.req.query('user_id') || '');

  try {
    const sb = await getSupabaseAdmin();
    const [likes, comments, shares, saves] = await Promise.all([
      sb.from('project_likes').select('*', { count: 'exact', head: true }).eq('project_id', projectId),
      sb.from('project_comments').select('*', { count: 'exact', head: true }).eq('project_id', projectId).eq('is_approved', true).is('deleted_at', null),
      sb.from('project_shares').select('*', { count: 'exact', head: true }).eq('project_id', projectId),
      sb.from('project_saves').select('*', { count: 'exact', head: true }).eq('project_id', projectId),
    ]);

    let userLiked = false;
    let userSaved = false;
    if (userId) {
      const [lr, sr] = await Promise.all([
        sb.from('project_likes').select('id').eq('project_id', projectId).eq('user_id', userId).maybeSingle(),
        sb.from('project_saves').select('id').eq('project_id', projectId).eq('user_id', userId).maybeSingle(),
      ]);
      userLiked = !!lr.data;
      userSaved = !!sr.data;
    }

    return json({
      like_count: likes.count ?? 0,
      comment_count: comments.count ?? 0,
      share_count: shares.count ?? 0,
      save_count: saves.count ?? 0,
      user_liked: userLiked,
      user_saved: userSaved,
    });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Bulk Engagement (for landing page) ─────────────────────────────────────

export async function handleProjectBulkEngagementGet(c: Context): Promise<Response> {
  const projectIdsStr = c.req.query('ids') || '';
  const projectIds = projectIdsStr.split(',').map(s => s.trim()).filter(Boolean);

  if (projectIds.length === 0) return json({ engagements: {} });

  try {
    const sb = await getSupabaseAdmin();
    const { data } = await sb.from('project_engagement').select('project_id,views,likes,comments,shares,saves').in('project_id', projectIds).limit(200);
    const result: Record<string, any> = {};
    for (const row of (data || [])) {
      result[row.project_id] = {
        like_count: row.like_count || 0,
        comment_count: row.comment_count || 0,
        share_count: row.share_count || 0,
        save_count: row.save_count || 0,
      };
    }
    return json({ engagements: result });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Analytics ──────────────────────────────────────────────────────────────

export async function handleProjectAnalyticsGet(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const days = Math.min(Number(c.req.query('days') || '30'), 365);

  try {
    const sb = await getSupabaseAdmin();
    const since = new Date();
    since.setDate(since.getDate() - days);

    // Columns match the upsert path below (invest_clicks/detail_views), not event_type/count.
    const { data } = await sb.from('project_analytics')
      .select('id,project_id,date,invest_clicks,detail_views')
      .eq('project_id', projectId)
      .gte('date', since.toISOString().split('T')[0])
      .order('date', { ascending: false });

    return json({ analytics: data || [] });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

export async function handleProjectTrackClick(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const body = await readBody(c.req.raw as unknown as Request);
  const clickType = safeStr(body.click_type) || 'invest';

  try {
    const sb = await getSupabaseAdmin();
    const field = clickType === 'invest' ? 'invest_clicks' : clickType === 'detail' ? 'detail_views' : 'invest_clicks';

    // Simple upsert using rpc or raw query
    await sb.rpc('upsert_project_analytics', { p_project_id: projectId }).catch(() => {});

    // Also try direct increment via raw SQL
    try {
      const today = new Date().toISOString().split('T')[0];
      await sb.from('project_analytics').upsert({
        project_id: projectId,
        date: today,
        [field]: 1,
      }, { onConflict: 'project_id,date', ignoreDuplicates: false }).catch(() => {});

      // Now increment
      await sb.rpc('increment_analytics_field', {
        p_project_id: projectId,
        p_date: today,
        p_field: field,
      }).catch(() => {});
    } catch {}

    return json({ success: true });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Shares ─────────────────────────────────────────────────────────────────

export async function handleProjectShareTrack(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const body = await readBody(c.req.raw as unknown as Request);
  const shareType = safeStr(body.share_type) || 'other';

  const ALLOWED_SHARE_TYPES = new Set(['copy_link', 'whatsapp', 'sms', 'email', 'social', 'referral', 'other']);
  const normalizedType = ALLOWED_SHARE_TYPES.has(shareType) ? shareType : 'other';

  try {
    const sb = await getSupabaseAdmin();
    await sb.from('project_shares').insert({
      project_id: projectId,
      user_id: safeStr(body.user_id) || null,
      guest_id: safeStr(body.guest_id) || null,
      share_type: normalizedType,
      share_url: safeStr(body.share_url) || (ALLOWED_SHARE_TYPES.has(shareType) ? null : shareType),
    });

    const { count } = await sb.from('project_shares').select('*', { count: 'exact', head: true }).eq('project_id', projectId);
    return json({ success: true, share_count: count ?? 0 });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}

// ── Saves ──────────────────────────────────────────────────────────────────

export async function handleProjectSaveToggle(c: Context): Promise<Response> {
  const projectId = c.req.param('projectId');
  const body = await readBody(c.req.raw as unknown as Request);
  const userId = safeStr(body.user_id);
  const guestId = safeStr(body.guest_id);

  if (!userId && !guestId) return json({ error: 'user_id or guest_id required' }, 400);

  try {
    const sb = await getSupabaseAdmin();
    let existingQuery = sb.from('project_saves').select('id').eq('project_id', projectId);
    existingQuery = userId ? existingQuery.eq('user_id', userId) : existingQuery.eq('guest_id', guestId);
    const { data: existing } = await existingQuery.maybeSingle();

    let saved = !existing;
    if (existing) {
      const { data: deleted } = await sb.from('project_saves').delete().eq('id', existing.id).select('id');
      if (!deleted || deleted.length === 0) saved = true;
    } else {
      const row = userId
        ? { project_id: projectId, user_id: userId }
        : { project_id: projectId, guest_id: guestId };
      await sb.from('project_saves').insert(row);
    }

    const { count } = await sb.from('project_saves').select('*', { count: 'exact', head: true }).eq('project_id', projectId);
    return json({ saved, save_count: count ?? 0 });
  } catch (err: any) {
    return json({ error: err.message }, 500);
  }
}
