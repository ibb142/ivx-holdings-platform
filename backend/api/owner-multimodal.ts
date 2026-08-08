/**
 * Owner-only multimodal upload + analysis routes.
 *
 * Provides image/PDF/video ingestion via Supabase storage signed URLs,
 * Google Drive public/shared link import, and AI-Gateway-backed analysis.
 *
 * Design notes / honest scope:
 * - Images: full vision analysis through gpt-4o-mini using base64 inline image.
 * - PDFs: text extracted with a lightweight pure-JS heuristic (no native deps),
 *   then summarized via the AI Gateway. Long docs are chunked.
 * - Text/JSON files: decoded and analyzed as business documents.
 * - Videos: stored + signed URL returned + metadata summary. Frame extraction
 *   and full transcription require a separate worker (documented).
 * - Google Drive: public/shared file links are accepted (no OAuth dance);
 *   full owner-OAuth Drive ingestion requires a Google client and is out of
 *   scope for this pass.
 * - Owner-only: every route is guarded by assertIVXOwnerOnly.
 * - Storage: accepts IVX chat uploads from ivx-chat-uploads and legacy owner
 *   files from IVX_OWNER_AI_BUCKET. Files are never made public by these routes.
 */

import { generateText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { IVX_CHAT_UPLOAD_BUCKET, IVX_OWNER_AI_BUCKET } from '../../expo/shared/ivx';
import { assertIVXOwnerOnly, ownerOnlyJson, ownerOnlyOptions, type IVXOwnerRequestContext } from './owner-only';
import { autoDetectGatewayBaseUrl, normalizeModelForGateway } from '../services/ivx-provider-autodetect';

const DEPLOYMENT_MARKER = 'ivx-owner-multimodal-2026-05-06t1300z';

const MAX_INLINE_BYTES = 25 * 1024 * 1024; // 25 MB inline analyze ceiling
const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB per video
const MAX_PDF_TEXT_CHARS = 60_000; // chunked summary input ceiling
const MAX_PROMPT_CHARS = 4_000;

const ALLOWED_IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

const ALLOWED_PDF_MIME = new Set([
  'application/pdf',
  'application/x-pdf',
]);

const ALLOWED_VIDEO_MIME = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-matroska',
  'video/x-m4v',
  'video/3gpp',
]);

const ALLOWED_TEXT_MIME = new Set([
  'application/json',
  'text/csv',
  'text/markdown',
  'text/plain',
]);

type FileKind = 'image' | 'pdf' | 'video' | 'text' | 'other';

type DBClient = IVXOwnerRequestContext['client'];

type SignedUploadResult = {
  bucket: string;
  path: string;
  signedUploadUrl: string;
  token: string;
  readUrl: string | null;
  fileName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  kind: FileKind;
};

function nowIso(): string {
  return new Date().toISOString();
}

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeFileName(value: string): string {
  const base = value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-').slice(-120);
  return base || `file-${Date.now()}`;
}

function classifyKind(mime: string | null): FileKind {
  if (!mime) return 'other';
  const lower = mime.toLowerCase();
  if (ALLOWED_IMAGE_MIME.has(lower)) return 'image';
  if (ALLOWED_PDF_MIME.has(lower)) return 'pdf';
  if (ALLOWED_VIDEO_MIME.has(lower)) return 'video';
  if (ALLOWED_TEXT_MIME.has(lower) || lower.startsWith('text/')) return 'text';
  return 'other';
}

function ensureKindAllowed(kind: FileKind, requested: FileKind): void {
  if (kind === 'other' || kind === 'text') {
    throw new Error(`Unsupported mime type for ${requested} upload.`);
  }
  if (kind !== requested) {
    throw new Error(`MIME type does not match requested ${requested} kind (got ${kind}).`);
  }
}

function ensureSizeAllowed(kind: FileKind, sizeBytes: number | null): void {
  if (typeof sizeBytes !== 'number' || sizeBytes <= 0) return;
  const cap = kind === 'video' ? MAX_VIDEO_BYTES : MAX_INLINE_BYTES;
  if (sizeBytes > cap) {
    throw new Error(`File exceeds maximum allowed size of ${cap} bytes for ${kind}.`);
  }
}

async function createSignedUploadEntry(
  client: DBClient,
  ownerUserId: string,
  body: Record<string, unknown>,
  requestedKind: FileKind,
): Promise<SignedUploadResult> {
  const fileName = safeFileName(readTrimmed(body.fileName) || `${requestedKind}-${Date.now()}`);
  const mimeType = readTrimmed(body.mimeType) || null;
  const sizeBytes = typeof body.sizeBytes === 'number' ? body.sizeBytes
    : typeof body.size === 'number' ? body.size : null;
  const kind = classifyKind(mimeType);
  ensureKindAllowed(kind, requestedKind);
  ensureSizeAllowed(kind, sizeBytes);

  const storagePath = `owner-multimodal/${ownerUserId}/${requestedKind}/${Date.now()}-${fileName}`;
  const signed = await client.storage.from(IVX_OWNER_AI_BUCKET).createSignedUploadUrl(storagePath);
  if (signed.error || !signed.data) {
    throw new Error(signed.error?.message ?? 'Failed to create signed upload URL.');
  }
  const readUrl = await client.storage.from(IVX_OWNER_AI_BUCKET).createSignedUrl(storagePath, 60 * 60);

  return {
    bucket: IVX_OWNER_AI_BUCKET,
    path: storagePath,
    signedUploadUrl: signed.data.signedUrl,
    token: signed.data.token,
    readUrl: readUrl.data?.signedUrl ?? null,
    fileName,
    mimeType,
    sizeBytes,
    kind,
  };
}

function getErrorStatus(error: unknown): number {
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  // Auth guard failures must return 401/403, never 500.
  if (message.includes('missing bearer token') || message.includes('invalid or expired')) return 401;
  if (message.includes('privileged ivx access is required') || message.includes('owner') || message.includes('auth guard failed') || message.includes('auth config failed') || message.includes('role guard failed')) return 403;
  if (message.includes('exceeds maximum') || message.includes('unsupported mime') || message.includes('does not match requested')) return 400;
  return 500;
}

function errorPayload(error: unknown): Record<string, unknown> {
  const message = error instanceof Error ? error.message : 'Unknown owner multimodal error.';
  return { error: message, detail: message, deploymentMarker: DEPLOYMENT_MARKER };
}

/** Resolve a stored file's signed read URL by Supabase storage path. */
function resolveAnalysisBucket(value: unknown): string {
  const requested = readTrimmed(value);
  if (requested === IVX_CHAT_UPLOAD_BUCKET || requested === IVX_OWNER_AI_BUCKET) {
    return requested;
  }
  return IVX_OWNER_AI_BUCKET;
}

async function resolveSignedReadUrl(client: DBClient, storagePath: string, bucket: string = IVX_OWNER_AI_BUCKET): Promise<string> {
  const signed = await client.storage.from(bucket).createSignedUrl(storagePath, 60 * 60);
  if (signed.error || !signed.data?.signedUrl) {
    throw new Error(signed.error?.message ?? 'Failed to resolve signed read URL.');
  }
  return signed.data.signedUrl;
}

async function downloadStoredFile(client: DBClient, storagePath: string, bucket: string = IVX_OWNER_AI_BUCKET): Promise<{ bytes: Uint8Array; mimeType: string | null }> {
  const dl = await client.storage.from(bucket).download(storagePath);
  if (dl.error || !dl.data) {
    throw new Error(dl.error?.message ?? 'Failed to download stored file.');
  }
  const buffer = await dl.data.arrayBuffer();
  const mimeType = (dl.data as Blob).type || null;
  return { bytes: new Uint8Array(buffer), mimeType };
}

/* ---------------- OpenAI API helpers ---------------- */

function getGatewayApiKey(): string {
  return readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.IVX_AI_GATEWAY_KEY);
}

function getGatewayBaseUrl(): string {
  return autoDetectGatewayBaseUrl();
}

function getVisionModel(): string {
  return normalizeModelForGateway(readTrimmed(process.env.IVX_OWNER_AI_VISION_MODEL) || 'gpt-4o');
}

function getTextModel(): string {
  return normalizeModelForGateway(readTrimmed(process.env.IVX_OWNER_AI_MODEL) || 'gpt-4o');
}

function ensureGatewayConfigured(): void {
  if (!getGatewayApiKey()) {
    throw new Error('OPENAI_API_KEY is not configured for multimodal analysis.');
  }
}

async function runVisionAnalysis(input: {
  imageBytes: Uint8Array;
  mimeType: string | null;
  prompt: string;
}): Promise<string> {
  ensureGatewayConfigured();
  const apiKey = getGatewayApiKey();
  const baseURL = getGatewayBaseUrl();
  const provider = createOpenAI({ apiKey, baseURL });
  const model = getVisionModel();

  const result = await generateText({
    model: provider.chat(model),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: input.prompt.slice(0, MAX_PROMPT_CHARS) },
          {
            type: 'image',
            image: input.imageBytes,
            mediaType: input.mimeType ?? 'image/jpeg',
          },
        ],
      },
    ],
  });

  const text = readTrimmed(result.text);
  if (!text) throw new Error('Vision model returned an empty response.');
  return text;
}

async function runTextAnalysis(input: { system?: string; prompt: string }): Promise<string> {
  ensureGatewayConfigured();
  const apiKey = getGatewayApiKey();
  const baseURL = getGatewayBaseUrl();
  const provider = createOpenAI({ apiKey, baseURL });
  const model = getTextModel();

  const result = await generateText({
    model: provider.chat(model),
    system: input.system,
    prompt: input.prompt.slice(0, MAX_PROMPT_CHARS * 4),
  });

  const text = readTrimmed(result.text);
  if (!text) throw new Error('Text model returned an empty response.');
  return text;
}

/* ---------------- PDF text extraction (lightweight, pure JS) ---------------- */

/**
 * Best-effort extraction of plain text from a PDF without native deps.
 * Pulls text from BT/ET blocks and Tj/TJ operators. Sufficient for
 * basic AI summary; not a replacement for a real PDF library for OCR'd PDFs.
 */
function extractPdfText(bytes: Uint8Array): { text: string; pageCount: number } {
  const decoder = new TextDecoder('latin1');
  const raw = decoder.decode(bytes);
  const pageCountMatch = raw.match(/\/Type\s*\/Page[^s]/g);
  const pageCount = pageCountMatch ? pageCountMatch.length : 0;

  const collected: string[] = [];
  const btBlockRegex = /BT([\s\S]*?)ET/g;
  let m: RegExpExecArray | null;
  while ((m = btBlockRegex.exec(raw)) !== null) {
    const block = m[1];
    if (!block) continue;
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjm: RegExpExecArray | null;
    while ((tjm = tjRegex.exec(block)) !== null) {
      collected.push(unescapePdfString(tjm[1] ?? ''));
    }
    const tjArrRegex = /\[((?:[^\]\\]|\\.)*)\]\s*TJ/g;
    let tam: RegExpExecArray | null;
    while ((tam = tjArrRegex.exec(block)) !== null) {
      const inner = tam[1] ?? '';
      const partRegex = /\(([^)]*)\)/g;
      let pm: RegExpExecArray | null;
      while ((pm = partRegex.exec(inner)) !== null) {
        collected.push(unescapePdfString(pm[1] ?? ''));
      }
    }
    collected.push('\n');
  }

  const text = collected.join(' ').replace(/[ \t]+/g, ' ').replace(/\n[\s\n]*/g, '\n').trim();
  return { text: text.slice(0, MAX_PDF_TEXT_CHARS), pageCount };
}

function unescapePdfString(value: string): string {
  return value
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

/* ---------------- Google Drive helpers ---------------- */

function parseDriveFileId(url: string): string | null {
  const trimmed = readTrimmed(url);
  if (!trimmed) return null;
  const dPath = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (dPath?.[1]) return dPath[1];
  const idParam = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idParam?.[1]) return idParam[1];
  const docPath = trimmed.match(/\/(?:document|spreadsheets|presentation)\/d\/([a-zA-Z0-9_-]{10,})/);
  if (docPath?.[1]) return docPath[1];
  return null;
}

function buildDriveDownloadUrl(fileId: string): string {
  return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
}

async function downloadDriveFile(fileId: string): Promise<{ bytes: Uint8Array; mimeType: string | null; fileName: string }> {
  const url = buildDriveDownloadUrl(fileId);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    throw new Error(`Google Drive returned HTTP ${response.status}. The file may be private or require owner OAuth.`);
  }
  const mimeType = response.headers.get('content-type');
  const disposition = response.headers.get('content-disposition') ?? '';
  const nameMatch = disposition.match(/filename="([^"]+)"/) ?? disposition.match(/filename\*=UTF-8''([^;]+)/);
  const fileName = safeFileName(nameMatch?.[1] ? decodeURIComponent(nameMatch[1]) : `drive-${fileId}`);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (bytes.byteLength > MAX_VIDEO_BYTES) {
    throw new Error('Drive file exceeds maximum allowed size.');
  }
  return { bytes, mimeType: mimeType ?? null, fileName };
}

/* ---------------- Route handlers ---------------- */

async function withOwner<T extends Record<string, unknown>>(
  request: Request,
  fn: (ctx: IVXOwnerRequestContext) => Promise<T>,
): Promise<Response> {
  try {
    const ctx = await assertIVXOwnerOnly(request);
    const payload = await fn(ctx);
    return ownerOnlyJson({ ok: true, deploymentMarker: DEPLOYMENT_MARKER, ...payload });
  } catch (error) {
    return ownerOnlyJson(errorPayload(error), getErrorStatus(error));
  }
}

async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  return await request.json().catch(() => ({})) as Record<string, unknown>;
}

export async function handleMultimodalImageUpload(request: Request): Promise<Response> {
  return withOwner(request, async (ctx) => {
    const body = await readJsonBody(request);
    const result = await createSignedUploadEntry(ctx.client, ctx.userId, body, 'image');
    return { upload: result };
  });
}

export async function handleMultimodalPdfUpload(request: Request): Promise<Response> {
  return withOwner(request, async (ctx) => {
    const body = await readJsonBody(request);
    const result = await createSignedUploadEntry(ctx.client, ctx.userId, body, 'pdf');
    return { upload: result };
  });
}

export async function handleMultimodalVideoUpload(request: Request): Promise<Response> {
  return withOwner(request, async (ctx) => {
    const body = await readJsonBody(request);
    const result = await createSignedUploadEntry(ctx.client, ctx.userId, body, 'video');
    return { upload: result };
  });
}

export async function handleMultimodalGoogleDriveImport(request: Request): Promise<Response> {
  return withOwner(request, async (ctx) => {
    const body = await readJsonBody(request);
    const driveUrl = readTrimmed(body.driveUrl ?? body.url);
    const fileId = parseDriveFileId(driveUrl);
    if (!fileId) {
      throw new Error('Could not parse a Google Drive file id from the provided URL.');
    }

    const { bytes, mimeType, fileName } = await downloadDriveFile(fileId);
    const kind = classifyKind(mimeType);
    const safe = safeFileName(fileName);
    const storagePath = `owner-multimodal/${ctx.userId}/drive/${Date.now()}-${safe}`;
    const direct = await ctx.client.storage.from(IVX_OWNER_AI_BUCKET).upload(storagePath, bytes, {
      contentType: mimeType ?? 'application/octet-stream',
      upsert: false,
    });
    if (direct.error) {
      throw new Error(direct.error.message);
    }
    const readUrl = await resolveSignedReadUrl(ctx.client, storagePath, IVX_OWNER_AI_BUCKET);

    return {
      file: {
        bucket: IVX_OWNER_AI_BUCKET,
        path: storagePath,
        fileName: safe,
        mimeType,
        sizeBytes: bytes.byteLength,
        kind,
        readUrl,
      },
      drive: {
        fileId,
        sourceUrl: driveUrl,
        ownerOAuthRequired: false,
        note: 'Public/shared Drive links are supported. Private owner-only files require Google OAuth setup (not enabled in this pass).',
      },
    };
  });
}

export async function handleMultimodalAnalyze(request: Request, fileId: string): Promise<Response> {
  return withOwner(request, async (ctx) => {
    const body = await readJsonBody(request);
    const storagePath = readTrimmed(body.path) || decodeURIComponent(fileId);
    const bucket = resolveAnalysisBucket(body.bucket);
    const userPrompt = readTrimmed(body.prompt) || 'Describe this file. Extract any text, tables, or notable visual content. Be concise.';
    if (!storagePath) throw new Error('Storage path is required.');

    const { bytes, mimeType } = await downloadStoredFile(ctx.client, storagePath, bucket);
    const kind = classifyKind(mimeType);

    if (kind === 'image') {
      const answer = await runVisionAnalysis({ imageBytes: bytes, mimeType, prompt: userPrompt });
      return {
        file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
        analysis: { kind: 'vision', model: getVisionModel(), answer },
        timestamp: nowIso(),
      };
    }

    if (kind === 'pdf') {
      const { text, pageCount } = extractPdfText(bytes);
      if (!text) {
        return {
          file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
          analysis: {
            kind: 'pdf',
            model: getTextModel(),
            answer: 'No extractable text found in this PDF (likely scanned/OCR-required). Owner-side OCR worker is not enabled in this pass.',
            pageCount,
          },
          timestamp: nowIso(),
        };
      }
      const answer = await runTextAnalysis({
        system: 'You are an expert document analyst. Answer based only on the provided document text.',
        prompt: `${userPrompt}\n\n--- Document text (truncated) ---\n${text}`,
      });
      return {
        file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
        analysis: { kind: 'pdf', model: getTextModel(), answer, pageCount, charsAnalyzed: text.length },
        timestamp: nowIso(),
      };
    }

    if (kind === 'text') {
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(bytes).slice(0, MAX_PDF_TEXT_CHARS);
      const answer = await runTextAnalysis({
        system: 'You are an expert business file analyst. Answer based only on the provided file text.',
        prompt: `${userPrompt}\n\n--- File text (truncated) ---\n${text}`,
      });
      return {
        file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
        analysis: { kind: 'text', model: getTextModel(), answer, charsAnalyzed: text.length },
        timestamp: nowIso(),
      };
    }

    if (kind === 'video') {
      return {
        file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
        analysis: {
          kind: 'video',
          model: null,
          answer: 'Video stored. Frame-level vision and full transcription require a dedicated worker (ffmpeg + whisper) which is not enabled in this pass.',
          metadata: {
            sizeBytes: bytes.byteLength,
            mimeType,
          },
        },
        timestamp: nowIso(),
      };
    }

    throw new Error(`Unsupported file kind for analysis: ${mimeType ?? 'unknown'}.`);
  });
}

export async function handleMultimodalSummary(request: Request, fileId: string): Promise<Response> {
  return withOwner(request, async (ctx) => {
    const body = await readJsonBody(request);
    const storagePath = readTrimmed(body.path) || decodeURIComponent(fileId);
    const bucket = resolveAnalysisBucket(body.bucket);
    if (!storagePath) throw new Error('Storage path is required.');

    const { bytes, mimeType } = await downloadStoredFile(ctx.client, storagePath, bucket);
    const kind = classifyKind(mimeType);

    if (kind === 'image') {
      const answer = await runVisionAnalysis({
        imageBytes: bytes,
        mimeType,
        prompt: 'Provide a concise 3-5 sentence summary of this image. Mention any visible text.',
      });
      return {
        file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
        summary: { kind: 'vision', model: getVisionModel(), answer },
        timestamp: nowIso(),
      };
    }

    if (kind === 'pdf') {
      const { text, pageCount } = extractPdfText(bytes);
      if (!text) {
        return {
          file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
          summary: { kind: 'pdf', model: getTextModel(), answer: 'No extractable text found.', pageCount },
          timestamp: nowIso(),
        };
      }
      const answer = await runTextAnalysis({
        system: 'You produce concise executive summaries of documents.',
        prompt: `Summarize the following document in 5-8 bullet points. Preserve key numbers and entities.\n\n${text}`,
      });
      return {
        file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
        summary: { kind: 'pdf', model: getTextModel(), answer, pageCount, charsAnalyzed: text.length },
        timestamp: nowIso(),
      };
    }

    if (kind === 'text') {
      const decoder = new TextDecoder('utf-8');
      const text = decoder.decode(bytes).slice(0, MAX_PDF_TEXT_CHARS);
      const answer = await runTextAnalysis({
        system: 'You produce concise executive summaries of business files.',
        prompt: `Summarize the following file in 5-8 bullet points. Preserve key numbers and entities.\n\n${text}`,
      });
      return {
        file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
        summary: { kind: 'text', model: getTextModel(), answer, charsAnalyzed: text.length },
        timestamp: nowIso(),
      };
    }

    if (kind === 'video') {
      return {
        file: { bucket, path: storagePath, mimeType, sizeBytes: bytes.byteLength, kind },
        summary: {
          kind: 'video',
          model: null,
          answer: `Video file stored at ${storagePath}. Size ${bytes.byteLength} bytes, mime ${mimeType ?? 'unknown'}. Full content summary requires a transcription worker (not enabled).`,
        },
        timestamp: nowIso(),
      };
    }

    throw new Error(`Unsupported file kind for summary: ${mimeType ?? 'unknown'}.`);
  });
}

export function ownerMultimodalOptions(): Response {
  return ownerOnlyOptions();
}
