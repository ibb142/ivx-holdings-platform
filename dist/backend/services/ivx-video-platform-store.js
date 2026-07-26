/**
 * IVX Video Platform Store — durable S3-backed JSON documents powering the
 * enterprise video experience on top of the HLS pipeline:
 *
 *   videos/platform/follows.json     — follower → creator edges
 *   videos/platform/profiles.json    — viewer profiles (zip, audience, preferences)
 *   videos/platform/analytics.json   — per-video aggregates + per-viewer watch history
 *   videos/platform/meta.json        — per-video platform meta (audiences, property, story, creator)
 *   videos/platform/live.json        — live stream session registry
 *   videos/platform/moderation.json  — reports + moderation decisions
 *
 * Same bucket/CDN as the video pipeline (S3 → CloudFront at ivxholding.com).
 * Single-instance service ⇒ read-modify-write with a short in-memory cache is safe.
 */
export const VIDEO_PLATFORM_MARKER = 'ivx-video-platform-v3-investor-first-2026-07-04';
const PLATFORM_PREFIX = 'videos/platform';
export const VIDEO_AUDIENCES = ['investor', 'buyer', 'realtor', 'builder', 'jv'];
export const VIDEO_TYPES = ['deal', 'reel'];
/** Tolerant defaults for meta rows written before the unified-feed schema. */
export function normalizeVideoMeta(raw) {
    return {
        audiences: Array.isArray(raw?.audiences) ? raw.audiences : [],
        zip: raw?.zip ?? null,
        property_id: raw?.property_id ?? null,
        creator_id: raw?.creator_id ?? null,
        is_story: raw?.is_story === true,
        story_expires_at: raw?.story_expires_at ?? null,
        video_type: raw?.video_type === 'reel' ? 'reel' : 'deal',
        is_featured: raw?.is_featured === true,
        display_order: typeof raw?.display_order === 'number' ? raw.display_order : null,
        publish_at: raw?.publish_at ?? null,
        expires_at: raw?.expires_at ?? null,
        is_hidden: raw?.is_hidden === true,
        status: raw?.status === 'draft' ? 'draft' : 'published',
        updated_at: raw?.updated_at ?? nowIso(),
    };
}
/**
 * Is this video visible to viewers right now? Applies the admin controls:
 * hide switch, draft status, publish schedule, and expiration date.
 */
export function isMetaVisible(meta, now = Date.now()) {
    if (meta.is_hidden)
        return false;
    if (meta.status === 'draft')
        return false;
    if (meta.publish_at && Date.parse(meta.publish_at) > now)
        return false;
    if (meta.expires_at && Date.parse(meta.expires_at) <= now)
        return false;
    return true;
}
const MAX_VIEWER_IDS_PER_VIDEO = 1000;
const MAX_HISTORY_PER_VIEWER = 200;
const MAX_REPORTS = 2000;
const CACHE_TTL_MS = 8_000;
function env(name) {
    const value = process.env[name];
    return typeof value === 'string' ? value.trim() : '';
}
function nowIso() {
    return new Date().toISOString();
}
/* ---------------- S3 JSON doc access ---------------- */
let _s3 = null;
async function getS3() {
    if (_s3)
        return _s3;
    const { S3Client } = await import('@aws-sdk/client-s3');
    const accessKeyId = env('AWS_ACCESS_KEY_ID');
    const secretAccessKey = env('AWS_SECRET_ACCESS_KEY');
    if (!accessKeyId || !secretAccessKey) {
        throw new Error('AWS credentials missing on runtime (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY).');
    }
    _s3 = new S3Client({ region: env('AWS_REGION') || 'us-east-1', credentials: { accessKeyId, secretAccessKey } });
    return _s3;
}
function bucket() {
    return env('S3_BUCKET_NAME') || 'ivxholding.com';
}
const docCache = new Map();
async function readDoc(name, fallback) {
    const cached = docCache.get(name);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS)
        return cached.value;
    try {
        const { GetObjectCommand } = await import('@aws-sdk/client-s3');
        const s3 = await getS3();
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: `${PLATFORM_PREFIX}/${name}` }));
        const bytes = await res.Body?.transformToByteArray();
        if (!bytes)
            return fallback;
        const value = JSON.parse(Buffer.from(bytes).toString('utf-8'));
        docCache.set(name, { at: Date.now(), value });
        return value;
    }
    catch {
        return cached?.value ?? fallback;
    }
}
async function writeDoc(name, value) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await getS3();
    await s3.send(new PutObjectCommand({
        Bucket: bucket(),
        Key: `${PLATFORM_PREFIX}/${name}`,
        Body: Buffer.from(JSON.stringify(value), 'utf-8'),
        ContentType: 'application/json',
        CacheControl: 'no-cache',
    }));
    docCache.set(name, { at: Date.now(), value });
}
/* ---------------- follows ---------------- */
export async function toggleFollow(followerId, creatorId) {
    const doc = await readDoc('follows.json', {});
    const edges = doc[followerId] ?? {};
    let following;
    if (edges[creatorId]) {
        delete edges[creatorId];
        following = false;
    }
    else {
        edges[creatorId] = nowIso();
        following = true;
    }
    doc[followerId] = edges;
    await writeDoc('follows.json', doc);
    return { following, follower_count: countFollowers(doc, creatorId) };
}
function countFollowers(doc, creatorId) {
    let count = 0;
    for (const edges of Object.values(doc))
        if (edges[creatorId])
            count += 1;
    return count;
}
export async function getFollowState(followerId) {
    const doc = await readDoc('follows.json', {});
    return { following: Object.keys(doc[followerId] ?? {}) };
}
export async function getFollowerCount(creatorId) {
    const doc = await readDoc('follows.json', {});
    return countFollowers(doc, creatorId);
}
/* ---------------- viewer profiles ---------------- */
export async function upsertViewerProfile(viewerId, patch) {
    const doc = await readDoc('profiles.json', {});
    const existing = doc[viewerId] ?? { zip: null, audience: null, preferences: [], updated_at: nowIso() };
    const next = {
        zip: patch.zip !== undefined ? patch.zip : existing.zip,
        audience: patch.audience !== undefined ? patch.audience : existing.audience,
        preferences: Array.isArray(patch.preferences) ? patch.preferences.slice(0, 20) : existing.preferences,
        updated_at: nowIso(),
    };
    doc[viewerId] = next;
    await writeDoc('profiles.json', doc);
    return next;
}
export async function getViewerProfile(viewerId) {
    const doc = await readDoc('profiles.json', {});
    return doc[viewerId] ?? null;
}
function emptyStats() {
    return { views: 0, unique_viewers: 0, viewer_ids: [], watch_ms: 0, completions: 0, double_tap_likes: 0, shares: 0, last_event_at: null };
}
export async function recordEvents(events) {
    const doc = await readDoc('analytics.json', { videos: {}, history: {} });
    let recorded = 0;
    let profileTouched = false;
    const profileDoc = await readDoc('profiles.json', {});
    for (const ev of events.slice(0, 100)) {
        if (ev.type === 'profile' && ev.viewer_id) {
            const existing = profileDoc[ev.viewer_id] ?? { zip: null, audience: null, preferences: [], updated_at: nowIso() };
            profileDoc[ev.viewer_id] = {
                zip: typeof ev.zip === 'string' && ev.zip ? ev.zip : existing.zip,
                audience: typeof ev.audience === 'string' && ev.audience ? ev.audience : existing.audience,
                preferences: Array.isArray(ev.preferences) ? ev.preferences.slice(0, 20) : existing.preferences,
                updated_at: nowIso(),
            };
            profileTouched = true;
            recorded += 1;
            continue;
        }
        const videoId = typeof ev.video_id === 'string' ? ev.video_id.trim() : '';
        if (!videoId)
            continue;
        const stats = doc.videos[videoId] ?? emptyStats();
        const viewerId = typeof ev.viewer_id === 'string' ? ev.viewer_id.trim() : '';
        switch (ev.type) {
            case 'view':
                stats.views += 1;
                if (viewerId && !stats.viewer_ids.includes(viewerId)) {
                    stats.viewer_ids.push(viewerId);
                    if (stats.viewer_ids.length > MAX_VIEWER_IDS_PER_VIDEO)
                        stats.viewer_ids.shift();
                    stats.unique_viewers += 1;
                }
                if (viewerId) {
                    const hist = doc.history[viewerId] ?? { watched: [], updated_at: nowIso() };
                    hist.watched = hist.watched.filter((id) => id !== videoId);
                    hist.watched.push(videoId);
                    if (hist.watched.length > MAX_HISTORY_PER_VIEWER)
                        hist.watched.shift();
                    hist.updated_at = nowIso();
                    doc.history[viewerId] = hist;
                }
                break;
            case 'watch':
                stats.watch_ms += Math.max(0, Math.min(Number(ev.watch_ms) || 0, 3_600_000));
                break;
            case 'complete':
                stats.completions += 1;
                break;
            case 'double_tap_like':
                stats.double_tap_likes += 1;
                break;
            case 'share':
                stats.shares += 1;
                break;
            default:
                continue;
        }
        stats.last_event_at = nowIso();
        doc.videos[videoId] = stats;
        recorded += 1;
    }
    await writeDoc('analytics.json', doc);
    if (profileTouched)
        await writeDoc('profiles.json', profileDoc);
    return { recorded };
}
export async function getAnalyticsDoc() {
    return readDoc('analytics.json', { videos: {}, history: {} });
}
export async function getVideoStats(videoId) {
    const doc = await getAnalyticsDoc();
    return doc.videos[videoId] ?? emptyStats();
}
/* ---------------- video platform meta (channels / stories / creator) ---------------- */
export async function upsertVideoMeta(videoId, patch) {
    const doc = await readDoc('meta.json', {});
    const existing = normalizeVideoMeta(doc[videoId]);
    const audiences = Array.isArray(patch.audiences)
        ? patch.audiences.map((a) => String(a).toLowerCase()).filter((a) => VIDEO_AUDIENCES.includes(a))
        : existing.audiences;
    const next = {
        audiences,
        zip: patch.zip !== undefined ? patch.zip : existing.zip,
        property_id: patch.property_id !== undefined ? patch.property_id : existing.property_id,
        creator_id: patch.creator_id !== undefined ? patch.creator_id : existing.creator_id,
        is_story: patch.is_story !== undefined ? patch.is_story === true : existing.is_story,
        story_expires_at: patch.story_expires_at !== undefined ? patch.story_expires_at : existing.story_expires_at,
        video_type: patch.video_type !== undefined ? (patch.video_type === 'reel' ? 'reel' : 'deal') : existing.video_type,
        is_featured: patch.is_featured !== undefined ? patch.is_featured === true : existing.is_featured,
        display_order: patch.display_order !== undefined ? (typeof patch.display_order === 'number' && Number.isFinite(patch.display_order) ? patch.display_order : null) : existing.display_order,
        publish_at: patch.publish_at !== undefined ? patch.publish_at : existing.publish_at,
        expires_at: patch.expires_at !== undefined ? patch.expires_at : existing.expires_at,
        is_hidden: patch.is_hidden !== undefined ? patch.is_hidden === true : existing.is_hidden,
        status: patch.status !== undefined ? (patch.status === 'draft' ? 'draft' : 'published') : existing.status,
        updated_at: nowIso(),
    };
    doc[videoId] = next;
    await writeDoc('meta.json', doc);
    return next;
}
export async function getMetaDoc() {
    return readDoc('meta.json', {});
}
/** Tolerant defaults for deal meta rows. */
export function normalizeDealMeta(raw) {
    return {
        is_featured: raw?.is_featured === true,
        priority: typeof raw?.priority === 'number' && Number.isFinite(raw.priority) ? raw.priority : 0,
        display_order: typeof raw?.display_order === 'number' ? raw.display_order : null,
        publish_at: raw?.publish_at ?? null,
        expires_at: raw?.expires_at ?? null,
        is_hidden: raw?.is_hidden === true,
        status: raw?.status === 'draft' ? 'draft' : 'published',
        updated_at: raw?.updated_at ?? nowIso(),
    };
}
/** Is this deal visible right now? Hide switch, draft, schedule, expiration. */
export function isDealMetaVisible(meta, now = Date.now()) {
    if (meta.is_hidden)
        return false;
    if (meta.status === 'draft')
        return false;
    if (meta.publish_at && Date.parse(meta.publish_at) > now)
        return false;
    if (meta.expires_at && Date.parse(meta.expires_at) <= now)
        return false;
    return true;
}
export async function getDealMetaDoc() {
    return readDoc('deals-meta.json', {});
}
export async function upsertDealMeta(dealId, patch) {
    const doc = await readDoc('deals-meta.json', {});
    const existing = normalizeDealMeta(doc[dealId]);
    const next = {
        is_featured: patch.is_featured !== undefined ? patch.is_featured === true : existing.is_featured,
        priority: patch.priority !== undefined ? (typeof patch.priority === 'number' && Number.isFinite(patch.priority) ? patch.priority : 0) : existing.priority,
        display_order: patch.display_order !== undefined ? (typeof patch.display_order === 'number' && Number.isFinite(patch.display_order) ? patch.display_order : null) : existing.display_order,
        publish_at: patch.publish_at !== undefined ? patch.publish_at : existing.publish_at,
        expires_at: patch.expires_at !== undefined ? patch.expires_at : existing.expires_at,
        is_hidden: patch.is_hidden !== undefined ? patch.is_hidden === true : existing.is_hidden,
        status: patch.status !== undefined ? (patch.status === 'draft' ? 'draft' : 'published') : existing.status,
        updated_at: nowIso(),
    };
    doc[dealId] = next;
    await writeDoc('deals-meta.json', doc);
    return next;
}
/* ---------------- live sessions (HTTP-HLS ingest) ---------------- */
const LIVE_STORAGE_PREFIX = 'videos/live';
const MAX_LIVE_SEGMENTS = 2000;
function publicBaseUrl() {
    return (env('IVX_PUBLIC_BASE_URL') || 'https://ivxholding.com').replace(/\/+$/, '');
}
/** Normalize legacy live.json rows (pre-ingest schema) into the current shape. */
function normalizeLiveSession(raw) {
    const status = raw.status === 'created' || raw.status === 'live' || raw.status === 'ended' || raw.status === 'failed' ? raw.status : 'ended';
    return {
        id: raw.id,
        host_id: raw.host_id,
        title: raw.title,
        playback_url: raw.playback_url ?? null,
        ingest_url: raw.ingest_url ?? null,
        status,
        created_at: raw.created_at ?? raw.started_at ?? nowIso(),
        started_at: raw.started_at ?? null,
        ended_at: raw.ended_at ?? null,
        ended_reason: raw.ended_reason ?? null,
        moderated_by: raw.moderated_by ?? null,
        viewer_peak: raw.viewer_peak ?? 0,
        segment_count: raw.segment_count ?? 0,
        last_segment_at: raw.last_segment_at ?? null,
        segments: Array.isArray(raw.segments) ? raw.segments : [],
    };
}
/** Best-effort mirror of the session into the Supabase live_sessions table. */
async function syncLiveSessionRow(session) {
    try {
        const url = (env('EXPO_PUBLIC_SUPABASE_URL') || env('SUPABASE_URL')).replace(/\/+$/, '');
        const key = env('SUPABASE_SERVICE_ROLE_KEY') || env('SUPABASE_SERVICE_KEY') || env('EXPO_PUBLIC_SUPABASE_ANON_KEY');
        if (!url || !key)
            return;
        await fetch(`${url}/rest/v1/live_sessions?on_conflict=id`, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates',
            },
            body: JSON.stringify({
                id: session.id,
                host_id: session.host_id,
                title: session.title,
                status: session.status,
                ingest_url: session.ingest_url,
                playback_url: session.playback_url,
                segment_count: session.segment_count,
                viewer_peak: session.viewer_peak,
                ended_reason: session.ended_reason,
                moderated_by: session.moderated_by,
                created_at: session.created_at,
                started_at: session.started_at,
                ended_at: session.ended_at,
                updated_at: nowIso(),
            }),
        });
    }
    catch (err) {
        console.error('[ivx-live] supabase mirror failed:', err instanceof Error ? err.message : err);
    }
}
function buildLivePlaylist(session, ended) {
    const targetDuration = Math.max(4, Math.ceil(session.segments.reduce((max, s) => Math.max(max, s.duration), 4)));
    const lines = [
        '#EXTM3U',
        '#EXT-X-VERSION:3',
        `#EXT-X-TARGETDURATION:${targetDuration}`,
        '#EXT-X-MEDIA-SEQUENCE:0',
        '#EXT-X-PLAYLIST-TYPE:EVENT',
    ];
    for (const seg of session.segments) {
        lines.push(`#EXTINF:${seg.duration.toFixed(3)},`);
        lines.push(`seg_${String(seg.seq).padStart(5, '0')}.ts`);
    }
    if (ended)
        lines.push('#EXT-X-ENDLIST');
    return `${lines.join('\n')}\n`;
}
async function putLiveObject(key, body, contentType, cacheControl) {
    const { PutObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await getS3();
    await s3.send(new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        Body: typeof body === 'string' ? Buffer.from(body, 'utf-8') : Buffer.from(body),
        ContentType: contentType,
        CacheControl: cacheControl,
    }));
}
/**
 * Create a live session. Without an external playback_url the session gets an
 * HTTP-HLS ingest endpoint and starts in status 'created'; the first ingested
 * segment flips it to 'live'.
 */
export async function startLiveSession(input) {
    const { randomUUID } = await import('node:crypto');
    const doc = await readDoc('live.json', {});
    const id = randomUUID();
    const external = typeof input.playbackUrl === 'string' && input.playbackUrl.length > 0;
    const session = {
        id,
        host_id: input.hostId,
        title: input.title,
        playback_url: external ? input.playbackUrl : `${publicBaseUrl()}/${LIVE_STORAGE_PREFIX}/${id}/live.m3u8`,
        ingest_url: external ? null : `/api/ivx/video-platform/live/${id}/ingest`,
        status: external ? 'live' : 'created',
        created_at: nowIso(),
        started_at: external ? nowIso() : null,
        ended_at: null,
        ended_reason: null,
        moderated_by: null,
        viewer_peak: 0,
        segment_count: 0,
        last_segment_at: null,
        segments: [],
    };
    doc[session.id] = session;
    await writeDoc('live.json', doc);
    await syncLiveSessionRow(session);
    return session;
}
export async function getLiveSession(sessionId) {
    const doc = await readDoc('live.json', {});
    const raw = doc[sessionId];
    return raw ? normalizeLiveSession(raw) : null;
}
/**
 * Ingest one MPEG-TS segment over HTTP: store it in S3, extend the EVENT HLS
 * playlist, and flip the session to 'live' on the first segment.
 */
export async function ingestLiveSegment(sessionId, bytes, durationSeconds) {
    const doc = await readDoc('live.json', {});
    const raw = doc[sessionId];
    if (!raw)
        throw new Error('live session not found');
    const session = normalizeLiveSession(raw);
    if (session.status === 'ended' || session.status === 'failed') {
        throw new Error(`live session is ${session.status}; ingest rejected`);
    }
    if (session.ingest_url === null)
        throw new Error('session uses an external playback_url; ingest not enabled');
    if (session.segments.length >= MAX_LIVE_SEGMENTS)
        throw new Error('live session segment limit reached');
    const seq = session.segment_count;
    const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.min(durationSeconds, 30) : 4;
    const segmentKey = `${LIVE_STORAGE_PREFIX}/${sessionId}/seg_${String(seq).padStart(5, '0')}.ts`;
    try {
        await putLiveObject(segmentKey, bytes, 'video/mp2t', 'public, max-age=31536000, immutable');
        session.segments.push({ seq, duration, size: bytes.byteLength, uploaded_at: nowIso() });
        session.segment_count = seq + 1;
        session.last_segment_at = nowIso();
        if (session.status === 'created') {
            session.status = 'live';
            session.started_at = nowIso();
        }
        await putLiveObject(`${LIVE_STORAGE_PREFIX}/${sessionId}/live.m3u8`, buildLivePlaylist(session, false), 'application/vnd.apple.mpegurl', 'no-cache');
    }
    catch (err) {
        session.status = 'failed';
        session.ended_at = nowIso();
        session.ended_reason = `ingest failed: ${err instanceof Error ? err.message : 'storage error'}`;
        doc[sessionId] = session;
        await writeDoc('live.json', doc);
        await syncLiveSessionRow(session);
        throw err;
    }
    doc[sessionId] = session;
    await writeDoc('live.json', doc);
    await syncLiveSessionRow(session);
    return session;
}
/** End a session (host stop or moderation). Finalizes the HLS playlist with ENDLIST. */
export async function stopLiveSession(sessionId, opts) {
    const doc = await readDoc('live.json', {});
    const raw = doc[sessionId];
    if (!raw)
        return null;
    const session = normalizeLiveSession(raw);
    session.status = 'ended';
    session.ended_at = nowIso();
    session.ended_reason = opts?.reason ?? session.ended_reason ?? 'host_stop';
    session.moderated_by = opts?.moderatorId ?? session.moderated_by;
    if (session.ingest_url && session.segments.length > 0) {
        try {
            await putLiveObject(`${LIVE_STORAGE_PREFIX}/${sessionId}/live.m3u8`, buildLivePlaylist(session, true), 'application/vnd.apple.mpegurl', 'no-cache');
        }
        catch (err) {
            console.error('[ivx-live] playlist finalize failed:', err instanceof Error ? err.message : err);
        }
    }
    doc[sessionId] = session;
    await writeDoc('live.json', doc);
    await syncLiveSessionRow(session);
    return session;
}
export async function listLiveSessions(includeEnded) {
    const doc = await readDoc('live.json', {});
    const sessions = Object.values(doc)
        .map((raw) => normalizeLiveSession(raw))
        .sort((a, b) => (b.started_at ?? b.created_at).localeCompare(a.started_at ?? a.created_at));
    return includeEnded ? sessions.slice(0, 50) : sessions.filter((s) => s.status === 'live' || s.status === 'created');
}
/* ---------------- moderation ---------------- */
export async function addReport(input) {
    const { randomUUID } = await import('node:crypto');
    const doc = await readDoc('moderation.json', { reports: [], decisions: {} });
    const report = {
        id: randomUUID(),
        video_id: input.videoId,
        reporter_id: input.reporterId,
        reason: input.reason.slice(0, 500),
        created_at: nowIso(),
        resolved: false,
    };
    doc.reports.push(report);
    if (doc.reports.length > MAX_REPORTS)
        doc.reports = doc.reports.slice(-MAX_REPORTS);
    await writeDoc('moderation.json', doc);
    return report;
}
export async function recordModerationDecision(videoId, decision) {
    const doc = await readDoc('moderation.json', { reports: [], decisions: {} });
    const full = { ...decision, decided_at: nowIso() };
    doc.decisions[videoId] = full;
    for (const report of doc.reports)
        if (report.video_id === videoId)
            report.resolved = true;
    await writeDoc('moderation.json', doc);
    return full;
}
export async function getModerationDoc() {
    return readDoc('moderation.json', { reports: [], decisions: {} });
}
/**
 * Recommendation score: recency decay + engagement + watch quality
 * + audience/zip/preference match + followed-creator boost − already-seen penalty.
 */
export function scoreVideo(video, ctx) {
    const meta = ctx.meta[video.id];
    const stats = ctx.stats[video.id];
    let score = 0;
    const ageHours = Math.max(0, (Date.now() - Date.parse(video.created_at)) / 3_600_000);
    score += 40 * Math.exp(-ageHours / 168);
    const engagement = video.like_count * 3 + video.comment_count * 4 + video.share_count * 5 + video.save_count * 4;
    score += Math.log1p(engagement) * 10;
    if (stats) {
        score += Math.log1p(stats.views) * 4;
        score += Math.log1p(stats.completions) * 6;
        score += Math.log1p(stats.watch_ms / 1000) * 2;
    }
    if (meta) {
        if (ctx.channel && meta.audiences.includes(ctx.channel))
            score += 30;
        if (ctx.profile?.audience && meta.audiences.includes(ctx.profile.audience))
            score += 18;
        if (ctx.zip && meta.zip) {
            if (meta.zip === ctx.zip)
                score += 25;
            else if (meta.zip.slice(0, 3) === ctx.zip.slice(0, 3))
                score += 12;
        }
        if (ctx.profile?.preferences?.length && meta.property_id && ctx.profile.preferences.includes(meta.property_id))
            score += 10;
        if (meta.creator_id && ctx.following.has(meta.creator_id))
            score += 20;
    }
    const seenIdx = ctx.watched.lastIndexOf(video.id);
    if (seenIdx >= 0) {
        const recencyOfWatch = (ctx.watched.length - seenIdx) / Math.max(ctx.watched.length, 1);
        score -= 35 * recencyOfWatch;
    }
    if (video.is_pinned)
        score += 15;
    return score;
}
/**
 * Canonical deterministic ordering — identical on every platform (no viewer
 * personalization). Sort: pinned first → admin display_order (nulls last) →
 * neutral engagement score → id tiebreak.
 */
export function canonicalSort(videos, ctx) {
    return [...videos].sort((a, b) => {
        if (a.is_pinned !== b.is_pinned)
            return a.is_pinned ? -1 : 1;
        const ao = a.display_order;
        const bo = b.display_order;
        if (ao !== null || bo !== null) {
            if (ao === null)
                return 1;
            if (bo === null)
                return -1;
            if (ao !== bo)
                return ao - bo;
        }
        const diff = scoreVideo(b, ctx) - scoreVideo(a, ctx);
        if (diff !== 0)
            return diff;
        return a.id.localeCompare(b.id);
    });
}
/**
 * Investor-first feed composition — the SAME pattern on every platform:
 *   Deal 1, Deal 2, Deal 3 → Featured Investor Video → Deal 4, Deal 5, Deal 6 → Featured…
 * Project reels never interrupt the investment flow (they live in the reels rail).
 */
export function composeUnifiedFeed(dealVideos, featuredVideos) {
    const out = [];
    let f = 0;
    for (let i = 0; i < dealVideos.length; i += 1) {
        out.push(dealVideos[i]);
        if ((i + 1) % 3 === 0 && f < featuredVideos.length) {
            out.push(featuredVideos[f]);
            f += 1;
        }
    }
    while (f < featuredVideos.length) {
        out.push(featuredVideos[f]);
        f += 1;
    }
    return out;
}
/**
 * Investor-first HOME layout — the SAME sequence on every platform
 * (landing page, Android, iPhone, tablet, desktop):
 *
 *   Deal 1, Deal 2, Deal 3 → 1 Featured Project Video →
 *   Deal 4, Deal 5, Deal 6 → 1 Featured Project Video → repeat.
 *
 * Videos never appear back-to-back and never interrupt a deal triple.
 * Leftover featured videos beyond the deal groups are NOT appended —
 * exactly one video per 3 deals, no random videos.
 */
export function composeInvestorFirstHome(deals, featuredVideos) {
    const out = [];
    let f = 0;
    for (let i = 0; i < deals.length; i += 1) {
        out.push({ type: 'deal', deal: deals[i] });
        if ((i + 1) % 3 === 0 && f < featuredVideos.length) {
            out.push({ type: 'video', video: featuredVideos[f] });
            f += 1;
        }
    }
    return out;
}
