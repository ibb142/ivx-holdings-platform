import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions } from './owner-only';

export const IVX_REELS_MARKER = 'ivx-reels-owned-engine-v2-2026-08-12';

const DATA_ROOT = (process.env.IVX_DATA_DIR || '/app/data').trim();
const REELS_ROOT = join(DATA_ROOT, 'reels');
const MEDIA_ROOT = join(REELS_ROOT, 'media');
const REGISTRY_PATH = join(REELS_ROOT, 'registry.json');
const MAX_VIDEO_BYTES = 150 * 1024 * 1024;

export type IVXReelRecord = {
  id: string;
  caption: string;
  fileName: string;
  mediaPath: string;
  mimeType: string;
  bytes: number;
  status: 'published';
  createdAt: string;
  publishedAt: string;
  views: number;
  likes: number;
};

type Registry = { version: 1; reels: IVXReelRecord[] };

function json(payload: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function ensureStore(): Promise<void> {
  await mkdir(MEDIA_ROOT, { recursive: true });
  if (!existsSync(REGISTRY_PATH)) {
    await writeFile(REGISTRY_PATH, JSON.stringify({ version: 1, reels: [] } satisfies Registry, null, 2), 'utf8');
  }
}

async function readRegistry(): Promise<Registry> {
  await ensureStore();
  try {
    const parsed = JSON.parse(await readFile(REGISTRY_PATH, 'utf8')) as Registry;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.reels)) throw new Error('invalid registry');
    return parsed;
  } catch {
    const fresh: Registry = { version: 1, reels: [] };
    await writeFile(REGISTRY_PATH, JSON.stringify(fresh, null, 2), 'utf8');
    return fresh;
  }
}

async function writeRegistry(registry: Registry): Promise<void> {
  await ensureStore();
  const tmp = `${REGISTRY_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(registry, null, 2), 'utf8');
  const data = await readFile(tmp);
  await writeFile(REGISTRY_PATH, data);
}

function sanitizeFileName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'reel.mp4';
}

function extensionFor(fileName: string, mimeType: string): string {
  const ext = extname(fileName).toLowerCase();
  if (/^\.[a-z0-9]{1,6}$/.test(ext)) return ext;
  if (mimeType === 'video/webm') return '.webm';
  if (mimeType === 'video/quicktime') return '.mov';
  return '.mp4';
}

function publicRecord(record: IVXReelRecord): Record<string, unknown> {
  return {
    id: record.id,
    caption: record.caption,
    mimeType: record.mimeType,
    bytes: record.bytes,
    status: record.status,
    createdAt: record.createdAt,
    publishedAt: record.publishedAt,
    views: record.views,
    likes: record.likes,
    mediaUrl: `/api/ivx/social/reels/media/${record.id}`,
  };
}

async function requireOwner(request: Request): Promise<Response | null> {
  try {
    await assertIVXOwnerOnly(request);
    return null;
  } catch (error) {
    return ownerOnlyJson({
      ok: false,
      error: error instanceof Error ? error.message : 'IVX owner authentication required.',
    }, 401);
  }
}

export function reelsOptions(): Response {
  return ownerOnlyOptions();
}

export async function handleReelsStatus(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;
  const registry = await readRegistry();
  return ownerOnlyJson({
    ok: true,
    marker: IVX_REELS_MARKER,
    provider: 'IVX Holdings',
    ownership: '100% IVX-owned backend and storage',
    externalSocialApiRequired: false,
    durableStorage: DATA_ROOT,
    publishedCount: registry.reels.length,
    routes: {
      publish: '/api/ivx/social/reels/publish',
      feed: '/api/ivx/social/reels/feed',
      media: '/api/ivx/social/reels/media/:id',
      view: '/api/ivx/social/reels/:id/view',
      like: '/api/ivx/social/reels/:id/like',
    },
  });
}

export async function handleReelsPublish(request: Request): Promise<Response> {
  const denied = await requireOwner(request);
  if (denied) return denied;

  const contentType = request.headers.get('content-type') || '';
  let caption = '';
  let bytes: Uint8Array;
  let fileName = 'reel.mp4';
  let mimeType = 'video/mp4';

  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData();
    const file = form.get('video');
    caption = String(form.get('caption') || '').trim().slice(0, 2200);
    if (!(file instanceof File)) return ownerOnlyJson({ ok: false, error: 'multipart field "video" is required.' }, 400);
    if (!file.type.startsWith('video/')) return ownerOnlyJson({ ok: false, error: 'Only video/* files are accepted.' }, 415);
    if (file.size <= 0 || file.size > MAX_VIDEO_BYTES) return ownerOnlyJson({ ok: false, error: `Video must be between 1 byte and ${MAX_VIDEO_BYTES} bytes.` }, 413);
    bytes = new Uint8Array(await file.arrayBuffer());
    fileName = sanitizeFileName(file.name || 'reel.mp4');
    mimeType = file.type || 'video/mp4';
  } else {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    caption = typeof body.caption === 'string' ? body.caption.trim().slice(0, 2200) : '';
    const videoBase64 = typeof body.videoBase64 === 'string' ? body.videoBase64.trim() : '';
    if (!videoBase64) return ownerOnlyJson({ ok: false, error: 'Provide multipart video or JSON videoBase64.' }, 400);
    const raw = videoBase64.includes(',') ? videoBase64.slice(videoBase64.indexOf(',') + 1) : videoBase64;
    try {
      bytes = Uint8Array.from(Buffer.from(raw, 'base64'));
    } catch {
      return ownerOnlyJson({ ok: false, error: 'Invalid base64 video payload.' }, 400);
    }
    if (bytes.byteLength <= 0 || bytes.byteLength > MAX_VIDEO_BYTES) return ownerOnlyJson({ ok: false, error: `Video must be between 1 byte and ${MAX_VIDEO_BYTES} bytes.` }, 413);
    fileName = sanitizeFileName(typeof body.fileName === 'string' ? body.fileName : 'reel.mp4');
    mimeType = typeof body.mimeType === 'string' && body.mimeType.startsWith('video/') ? body.mimeType : 'video/mp4';
  }

  await ensureStore();
  const id = randomUUID();
  const diskName = `${id}${extensionFor(fileName, mimeType)}`;
  const mediaPath = join(MEDIA_ROOT, diskName);
  await writeFile(mediaPath, bytes);

  const now = new Date().toISOString();
  const record: IVXReelRecord = {
    id,
    caption,
    fileName,
    mediaPath,
    mimeType,
    bytes: bytes.byteLength,
    status: 'published',
    createdAt: now,
    publishedAt: now,
    views: 0,
    likes: 0,
  };
  const registry = await readRegistry();
  registry.reels.unshift(record);
  await writeRegistry(registry);

  return ownerOnlyJson({
    ok: true,
    marker: IVX_REELS_MARKER,
    status: 'VERIFIED_STORED_AND_PUBLISHED',
    reel: publicRecord(record),
    proof: {
      persisted: existsSync(mediaPath),
      bytesStored: bytes.byteLength,
      registryRecorded: true,
      externalSocialApiUsed: false,
    },
  }, 201);
}

export async function handleReelsFeed(_request: Request): Promise<Response> {
  const registry = await readRegistry();
  return json({
    ok: true,
    marker: IVX_REELS_MARKER,
    count: registry.reels.length,
    reels: registry.reels.map(publicRecord),
  });
}

export async function handleReelsMedia(request: Request, id: string): Promise<Response> {
  const registry = await readRegistry();
  const record = registry.reels.find((item) => item.id === id);
  if (!record || !existsSync(record.mediaPath)) return new Response('Not found', { status: 404 });
  const file = await readFile(record.mediaPath);
  const range = request.headers.get('range');
  if (!range) {
    return new Response(file, {
      status: 200,
      headers: {
        'Content-Type': record.mimeType,
        'Content-Length': String(file.byteLength),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'public, max-age=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
  const match = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!match) return new Response('Invalid range', { status: 416 });
  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : file.byteLength - 1;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= file.byteLength) {
    return new Response('Range not satisfiable', { status: 416, headers: { 'Content-Range': `bytes */${file.byteLength}` } });
  }
  const boundedEnd = Math.min(end, file.byteLength - 1);
  const chunk = file.subarray(start, boundedEnd + 1);
  return new Response(chunk, {
    status: 206,
    headers: {
      'Content-Type': record.mimeType,
      'Content-Length': String(chunk.byteLength),
      'Content-Range': `bytes ${start}-${boundedEnd}/${file.byteLength}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function mutateCounter(id: string, key: 'views' | 'likes'): Promise<IVXReelRecord | null> {
  const registry = await readRegistry();
  const record = registry.reels.find((item) => item.id === id);
  if (!record) return null;
  record[key] += 1;
  await writeRegistry(registry);
  return record;
}

export async function handleReelsView(_request: Request, id: string): Promise<Response> {
  const record = await mutateCounter(id, 'views');
  return record ? json({ ok: true, reel: publicRecord(record) }) : json({ ok: false, error: 'Reel not found.' }, 404);
}

export async function handleReelsLike(_request: Request, id: string): Promise<Response> {
  const record = await mutateCounter(id, 'likes');
  return record ? json({ ok: true, reel: publicRecord(record) }) : json({ ok: false, error: 'Reel not found.' }, 404);
}
