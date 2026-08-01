/**
 * IVX Resumable Video Upload — tus-style chunked uploads on S3 native multipart.
 *
 * Flow:
 *   POST /upload/init                → { uploadId, partSize } (session JSON in S3)
 *   PUT  /upload/:uploadId/part/:n   → raw bytes for part n (1-based, >=5MB except last)
 *   GET  /upload/:uploadId/status    → received parts + bytes (resume point)
 *   POST /upload/:uploadId/complete  → S3 CompleteMultipartUpload → pipeline transcode
 *
 * Sessions live in S3 (videos/uploads/{uploadId}.json) so uploads survive
 * runtime restarts/deploys — the client can resume from any part at any time.
 * Background/offline uploads: the client persists { uploadId, part } locally
 * and replays the remaining parts whenever connectivity returns.
 */

import { randomUUID } from 'node:crypto';

export const RESUMABLE_MARKER = 'ivx-video-resumable-v1-2026-07-03';

export const RESUMABLE_PART_SIZE = 8 * 1024 * 1024; // 8MB
const MIN_PART_SIZE = 5 * 1024 * 1024; // S3 minimum for non-final parts
const UPLOADS_PREFIX = 'videos/uploads';
const ORIGINAL_PREFIX = 'videos/original';

export type ResumableSession = {
  upload_id: string;
  video_id: string;
  s3_upload_id: string;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  part_size: number;
  total_parts: number;
  parts: Record<string, { etag: string; size: number; uploaded_at: string }>;
  user_id: string | null;
  project_id: string | null;
  title: string | null;
  status: 'open' | 'completed' | 'aborted';
  created_at: string;
  updated_at: string;
  marker: string;
};

function env(name: string): string {
  const value = process.env[name];
  return typeof value === 'string' ? value.trim() : '';
}

function bucket(): string {
  return env('S3_BUCKET_NAME') || 'ivxholding.com';
}

let _s3: import('@aws-sdk/client-s3').S3Client | null = null;

async function getS3(): Promise<import('@aws-sdk/client-s3').S3Client> {
  if (_s3) return _s3;
  const { S3Client } = await import('@aws-sdk/client-s3');
  const accessKeyId = env('AWS_ACCESS_KEY_ID');
  const secretAccessKey = env('AWS_SECRET_ACCESS_KEY');
  if (!accessKeyId || !secretAccessKey) throw new Error('AWS credentials missing on runtime.');
  _s3 = new S3Client({ region: env('AWS_REGION') || 'us-east-1', credentials: { accessKeyId, secretAccessKey } });
  return _s3;
}

function sessionKey(uploadId: string): string {
  return `${UPLOADS_PREFIX}/${uploadId}.json`;
}

async function readSession(uploadId: string): Promise<ResumableSession | null> {
  const safe = uploadId.replace(/[^a-zA-Z0-9-]/g, '');
  if (!safe) return null;
  try {
    const { GetObjectCommand } = await import('@aws-sdk/client-s3');
    const s3 = await getS3();
    const res = await s3.send(new GetObjectCommand({ Bucket: bucket(), Key: sessionKey(safe) }));
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) return null;
    return JSON.parse(Buffer.from(bytes).toString('utf-8')) as ResumableSession;
  } catch {
    return null;
  }
}

async function saveSession(session: ResumableSession): Promise<void> {
  const { PutObjectCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  session.updated_at = new Date().toISOString();
  await s3.send(new PutObjectCommand({
    Bucket: bucket(),
    Key: sessionKey(session.upload_id),
    Body: Buffer.from(JSON.stringify(session, null, 2), 'utf-8'),
    ContentType: 'application/json',
    CacheControl: 'no-cache',
  }));
}

export type InitResumableInput = {
  fileName: string;
  fileSize: number;
  mimeType?: string | null;
  userId?: string | null;
  projectId?: string | null;
  title?: string | null;
};

/** Create a resumable upload session backed by an S3 multipart upload. */
export async function initResumableUpload(input: InitResumableInput): Promise<ResumableSession> {
  const { CreateMultipartUploadCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  const videoId = randomUUID();
  const safeName = input.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80) || 'source.mp4';
  const storagePath = `${ORIGINAL_PREFIX}/${videoId}/${safeName}`;
  const created = await s3.send(new CreateMultipartUploadCommand({
    Bucket: bucket(),
    Key: storagePath,
    ContentType: input.mimeType || 'video/mp4',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  if (!created.UploadId) throw new Error('S3 did not return a multipart UploadId.');
  const session: ResumableSession = {
    upload_id: randomUUID(),
    video_id: videoId,
    s3_upload_id: created.UploadId,
    storage_path: storagePath,
    file_name: safeName,
    file_size: input.fileSize,
    mime_type: input.mimeType ?? null,
    part_size: RESUMABLE_PART_SIZE,
    total_parts: Math.max(1, Math.ceil(input.fileSize / RESUMABLE_PART_SIZE)),
    parts: {},
    user_id: input.userId ?? null,
    project_id: input.projectId ?? null,
    title: input.title ?? null,
    status: 'open',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    marker: RESUMABLE_MARKER,
  };
  await saveSession(session);
  return session;
}

/** Upload one part (1-based). Idempotent — re-uploading a received part overwrites it. */
export async function uploadResumablePart(uploadId: string, partNumber: number, bytes: Uint8Array): Promise<ResumableSession> {
  const session = await readSession(uploadId);
  if (!session) throw new Error('Upload session not found.');
  if (session.status !== 'open') throw new Error(`Upload session is ${session.status}.`);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > session.total_parts) {
    throw new Error(`partNumber must be 1..${session.total_parts}.`);
  }
  const isLast = partNumber === session.total_parts;
  if (!isLast && bytes.byteLength < MIN_PART_SIZE) {
    throw new Error(`Non-final parts must be at least ${MIN_PART_SIZE} bytes (got ${bytes.byteLength}).`);
  }
  const { UploadPartCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  const res = await s3.send(new UploadPartCommand({
    Bucket: bucket(),
    Key: session.storage_path,
    UploadId: session.s3_upload_id,
    PartNumber: partNumber,
    Body: Buffer.from(bytes),
  }));
  if (!res.ETag) throw new Error('S3 did not return an ETag for the part.');
  session.parts[String(partNumber)] = { etag: res.ETag, size: bytes.byteLength, uploaded_at: new Date().toISOString() };
  await saveSession(session);
  return session;
}

export type ResumableStatus = {
  upload_id: string;
  video_id: string;
  status: ResumableSession['status'];
  file_size: number;
  part_size: number;
  total_parts: number;
  received_parts: number[];
  bytes_received: number;
  next_part: number | null;
};

export function sessionStatus(session: ResumableSession): ResumableStatus {
  const received = Object.keys(session.parts).map(Number).sort((a, b) => a - b);
  let next: number | null = null;
  for (let i = 1; i <= session.total_parts; i += 1) {
    if (!session.parts[String(i)]) { next = i; break; }
  }
  return {
    upload_id: session.upload_id,
    video_id: session.video_id,
    status: session.status,
    file_size: session.file_size,
    part_size: session.part_size,
    total_parts: session.total_parts,
    received_parts: received,
    bytes_received: received.reduce((sum, n) => sum + (session.parts[String(n)]?.size ?? 0), 0),
    next_part: next,
  };
}

export async function getResumableStatus(uploadId: string): Promise<ResumableStatus | null> {
  const session = await readSession(uploadId);
  return session ? sessionStatus(session) : null;
}

/** Complete the multipart upload, register the video, and queue transcoding. */
export async function completeResumableUpload(uploadId: string): Promise<{ session: ResumableSession; videoId: string }> {
  const session = await readSession(uploadId);
  if (!session) throw new Error('Upload session not found.');
  if (session.status === 'completed') return { session, videoId: session.video_id };
  const status = sessionStatus(session);
  if (status.next_part !== null) {
    throw new Error(`Upload incomplete — missing part ${status.next_part} of ${session.total_parts}.`);
  }
  const { CompleteMultipartUploadCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  await s3.send(new CompleteMultipartUploadCommand({
    Bucket: bucket(),
    Key: session.storage_path,
    UploadId: session.s3_upload_id,
    MultipartUpload: {
      Parts: Object.entries(session.parts)
        .map(([n, p]) => ({ PartNumber: Number(n), ETag: p.etag }))
        .sort((a, b) => a.PartNumber - b.PartNumber),
    },
  }));
  session.status = 'completed';
  await saveSession(session);

  const { registerStoredVideo } = await import('./ivx-video-pipeline');
  await registerStoredVideo({
    videoId: session.video_id,
    storagePath: session.storage_path,
    fileSize: status.bytes_received,
    userId: session.user_id,
    projectId: session.project_id,
    title: session.title,
  });
  return { session, videoId: session.video_id };
}

/** Abort an open session and release the S3 multipart upload. */
export async function abortResumableUpload(uploadId: string): Promise<boolean> {
  const session = await readSession(uploadId);
  if (!session || session.status !== 'open') return false;
  const { AbortMultipartUploadCommand } = await import('@aws-sdk/client-s3');
  const s3 = await getS3();
  await s3.send(new AbortMultipartUploadCommand({
    Bucket: bucket(),
    Key: session.storage_path,
    UploadId: session.s3_upload_id,
  })).catch(() => {});
  session.status = 'aborted';
  await saveSession(session);
  return true;
}
