import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const IVX_REELS_MARKER = 'ivx-reels-live-2026-08-12';

const META_API_VERSION = (process.env.META_GRAPH_API_VERSION || 'v23.0').trim();
const POLL_INTERVAL_MS = 5_000;
const POLL_ATTEMPTS = 24;

function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = (process.env[name] || '').trim();
    if (value) return value;
  }
  return '';
}

function config() {
  const accessToken = readEnv('META_ACCESS_TOKEN', 'INSTAGRAM_ACCESS_TOKEN', 'IVX_META_ACCESS_TOKEN');
  const instagramUserId = readEnv('META_INSTAGRAM_USER_ID', 'INSTAGRAM_BUSINESS_ACCOUNT_ID', 'IVX_INSTAGRAM_USER_ID');
  return { accessToken, instagramUserId };
}

async function graphRequest(path: string, init?: RequestInit): Promise<{ ok: boolean; status: number; body: any }> {
  const { accessToken } = config();
  const url = new URL(`https://graph.facebook.com/${META_API_VERSION}/${path.replace(/^\//, '')}`);
  if (!init || init.method === 'GET') url.searchParams.set('access_token', accessToken);
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    let body: any = text;
    try { body = JSON.parse(text); } catch { /* keep text */ }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: { error: { message: error instanceof Error ? error.message : 'Meta Graph request failed' } },
    };
  }
}

async function createReelContainer(input: { videoUrl: string; caption: string; shareToFeed: boolean }): Promise<{ ok: boolean; id?: string; error?: unknown; httpStatus: number }> {
  const { accessToken, instagramUserId } = config();
  const form = new URLSearchParams();
  form.set('media_type', 'REELS');
  form.set('video_url', input.videoUrl);
  form.set('caption', input.caption);
  form.set('share_to_feed', input.shareToFeed ? 'true' : 'false');
  form.set('access_token', accessToken);
  const result = await graphRequest(`${instagramUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const id = typeof result.body?.id === 'string' ? result.body.id : undefined;
  return { ok: result.ok && Boolean(id), id, error: result.ok ? undefined : result.body, httpStatus: result.status };
}

async function waitForContainer(containerId: string): Promise<{ ok: boolean; statusCode: string; detail?: unknown }> {
  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
    const result = await graphRequest(`${containerId}?fields=status_code,status`);
    const statusCode = String(result.body?.status_code || '').toUpperCase();
    if (statusCode === 'FINISHED') return { ok: true, statusCode };
    if (statusCode === 'ERROR' || statusCode === 'EXPIRED') return { ok: false, statusCode, detail: result.body };
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return { ok: false, statusCode: 'TIMEOUT' };
}

async function publishContainer(containerId: string): Promise<{ ok: boolean; mediaId?: string; detail?: unknown; httpStatus: number }> {
  const { accessToken, instagramUserId } = config();
  const form = new URLSearchParams();
  form.set('creation_id', containerId);
  form.set('access_token', accessToken);
  const result = await graphRequest(`${instagramUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const mediaId = typeof result.body?.id === 'string' ? result.body.id : undefined;
  return { ok: result.ok && Boolean(mediaId), mediaId, detail: result.body, httpStatus: result.status };
}

async function fetchPublishedProof(mediaId: string): Promise<Record<string, unknown>> {
  const result = await graphRequest(`${mediaId}?fields=id,media_type,media_product_type,permalink,timestamp,caption`);
  if (!result.ok) return { mediaId, proofFetchHttpStatus: result.status };
  return {
    mediaId,
    mediaType: result.body?.media_type ?? null,
    mediaProductType: result.body?.media_product_type ?? null,
    permalink: result.body?.permalink ?? null,
    timestamp: result.body?.timestamp ?? null,
    caption: result.body?.caption ?? null,
  };
}

export function reelsOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleReelsStatus(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401);
  }
  const { accessToken, instagramUserId } = config();
  return ownerOnlyJson({
    ok: true,
    marker: IVX_REELS_MARKER,
    provider: 'Meta Graph API',
    apiVersion: META_API_VERSION,
    configured: Boolean(accessToken && instagramUserId),
    credentials: {
      accessTokenConfigured: Boolean(accessToken),
      instagramUserIdConfigured: Boolean(instagramUserId),
    },
    publishRoute: '/api/ivx/social/reels/publish',
    proofPolicy: 'A reel is VERIFIED only after Meta returns a media id and the published media proof endpoint resolves.',
  });
}

export async function handleReelsPublish(request: Request): Promise<Response> {
  try {
    await assertIVXOwnerOnly(request);
  } catch (error) {
    return ownerOnlyJson({ ok: false, error: error instanceof Error ? error.message : 'owner authentication required' }, 401);
  }

  const { accessToken, instagramUserId } = config();
  if (!accessToken || !instagramUserId) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_REELS_MARKER,
      status: 'BLOCKED_CONFIG',
      missing: [
        ...(!accessToken ? ['META_ACCESS_TOKEN'] : []),
        ...(!instagramUserId ? ['META_INSTAGRAM_USER_ID'] : []),
      ],
    }, 503);
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const videoUrl = typeof body.videoUrl === 'string' ? body.videoUrl.trim() : '';
  const caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, 2200) : '';
  const shareToFeed = body.shareToFeed !== false;

  if (!/^https:\/\//i.test(videoUrl)) {
    return ownerOnlyJson({ ok: false, error: 'videoUrl must be a public HTTPS URL reachable by Meta.' }, 400);
  }

  const startedAt = new Date().toISOString();
  const container = await createReelContainer({ videoUrl, caption, shareToFeed });
  if (!container.ok || !container.id) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_REELS_MARKER,
      status: 'CREATE_FAILED',
      startedAt,
      httpStatus: container.httpStatus,
      providerError: container.error,
    }, 502);
  }

  const processing = await waitForContainer(container.id);
  if (!processing.ok) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_REELS_MARKER,
      status: 'PROCESSING_FAILED',
      containerId: container.id,
      processingStatus: processing.statusCode,
      providerDetail: processing.detail ?? null,
    }, 502);
  }

  const published = await publishContainer(container.id);
  if (!published.ok || !published.mediaId) {
    return ownerOnlyJson({
      ok: false,
      marker: IVX_REELS_MARKER,
      status: 'PUBLISH_FAILED',
      containerId: container.id,
      httpStatus: published.httpStatus,
      providerDetail: published.detail ?? null,
    }, 502);
  }

  const proof = await fetchPublishedProof(published.mediaId);
  return ownerOnlyJson({
    ok: true,
    marker: IVX_REELS_MARKER,
    status: 'VERIFIED_PUBLISHED',
    startedAt,
    completedAt: new Date().toISOString(),
    containerId: container.id,
    ...proof,
  });
}
