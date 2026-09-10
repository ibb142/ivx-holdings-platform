/**
 * IVX Media Understanding — real OCR for scanned/image-only documents and real
 * video reading for the Owner AI / public chat.
 *
 * Two capabilities live here, both grounded in the IVX AI runtime (Vercel AI
 * Gateway):
 *
 *   - `ocrDocumentBytes()` — hands the raw bytes of a scanned/image-only PDF (or
 *     an image) to a vision model as a `file` content part so the model performs
 *     true OCR and returns the readable text. Used as the `ocrDocument` dep of
 *     the deal-document extractor, so scanned PDFs are no longer just flagged.
 *
 *   - `extractVideoAttachments()` + `understandVideos()` — normalize video
 *     attachments from a chat payload and send each video to a video-capable
 *     model as a `file` part, returning a grounded description (scene, on-screen
 *     text, key figures, property/project details).
 *
 * Everything degrades honestly: when the model/runtime is unavailable, oversize,
 * or returns nothing, the helpers return null / an honest status instead of
 * throwing into the reply.
 */

import { isIVXAIConfigured, requestIVXAIText, resolveIVXAIModel } from '../ivx-ai-runtime';

/** Max bytes we download for OCR (PDF/image) — keeps the file part bounded. */
const MAX_OCR_BYTES = 12 * 1024 * 1024;
/** Max bytes we download for video understanding (video files are larger). */
const MAX_VIDEO_BYTES = 20 * 1024 * 1024;
/** Per-document OCR text cap so the prompt stays bounded. */
const MAX_OCR_CHARS = 12_000;

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Vision model used for OCR (gpt-4o reads PDF/image file parts natively). */
function getOcrModel(): string {
  return resolveIVXAIModel(
    readTrimmed(process.env.IVX_OCR_MODEL) || readTrimmed(process.env.PUBLIC_CHAT_MODEL) || 'gpt-4o',
  );
}

/** Video-capable model (Gemini reads video file parts; override via env). */
function getVideoModel(): string {
  return resolveIVXAIModel(readTrimmed(process.env.IVX_VIDEO_MODEL) || 'google/gemini-2.0-flash');
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * OCR a document/image's raw bytes via a vision model. Returns extracted text,
 * or null when OCR is unavailable or produced nothing. Never throws.
 */
export async function ocrDocumentBytes(
  bytes: Uint8Array,
  mediaType: string,
  name: string | null,
): Promise<string | null> {
  if (!isIVXAIConfigured() || bytes.byteLength === 0 || bytes.byteLength > MAX_OCR_BYTES) {
    return null;
  }
  try {
    const base64 = toBase64(bytes);
    const result = await requestIVXAIText({
      module: 'document-ocr',
      model: getOcrModel(),
      system:
        'You are an OCR and document-reading engine. The attached file is a scanned or image-only document. ' +
        'Transcribe ALL readable text exactly as it appears, preserving tables, line items, labels, numbers, ' +
        'currency amounts, dates, and totals. Do not summarize, do not add commentary, do not invent values. ' +
        'If part is illegible, write [illegible] in place. Output only the transcribed text.',
      prompt: `Transcribe the full text of this document${name ? ` (${name})` : ''}.`,
      files: [{ data: base64, mediaType, filename: name }],
      maxOutputTokens: 4000,
    });
    const text = readTrimmed(result.text);
    if (!text) {
      return null;
    }
    return text.length > MAX_OCR_CHARS ? text.slice(0, MAX_OCR_CHARS) : text;
  } catch (error) {
    console.log('[MediaUnderstanding] OCR failed:', error instanceof Error ? error.message : 'unknown');
    return null;
  }
}

export type VideoAttachment = {
  url: string;
  name: string | null;
  mimeType: string | null;
};

const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv'];

function looksLikeVideo(url: string, mime: string): boolean {
  const lowerMime = mime.toLowerCase();
  if (lowerMime.startsWith('video/')) {
    return true;
  }
  if (lowerMime && !lowerMime.startsWith('video/') && lowerMime !== 'application/octet-stream') {
    return false;
  }
  const lowerUrl = url.toLowerCase().split('?')[0] ?? '';
  return VIDEO_EXTENSIONS.some((ext) => lowerUrl.endsWith(ext));
}

function videoMediaType(video: VideoAttachment): string {
  const mime = (video.mimeType ?? '').toLowerCase();
  if (mime.startsWith('video/')) {
    return mime;
  }
  const name = (video.name ?? video.url).toLowerCase().split('?')[0] ?? '';
  if (name.endsWith('.mov')) return 'video/quicktime';
  if (name.endsWith('.webm')) return 'video/webm';
  if (name.endsWith('.m4v')) return 'video/x-m4v';
  return 'video/mp4';
}

/**
 * Normalize arbitrary attachment input into video attachments. Accepts
 * `videos`, `attachments[]`, `files[]`, `videoUrls`, and single `videoUrl`
 * shapes; keeps only video MIME types / extensions and de-dups by URL.
 */
export function extractVideoAttachments(input: unknown): VideoAttachment[] {
  if (!input || typeof input !== 'object') {
    return [];
  }
  const out: VideoAttachment[] = [];
  const push = (url: unknown, name: unknown, mime: unknown): void => {
    const trimmedUrl = readTrimmed(url);
    if (!trimmedUrl) {
      return;
    }
    const trimmedMime = readTrimmed(mime);
    if (!looksLikeVideo(trimmedUrl, trimmedMime)) {
      return;
    }
    out.push({ url: trimmedUrl, name: readTrimmed(name) || null, mimeType: trimmedMime || null });
  };

  const record = input as Record<string, unknown>;
  const arrays: unknown[] = [];
  if (Array.isArray(record.videos)) arrays.push(...record.videos);
  if (Array.isArray(record.attachments)) arrays.push(...record.attachments);
  if (Array.isArray(record.files)) arrays.push(...record.files);
  for (const item of arrays) {
    if (typeof item === 'string') {
      push(item, null, null);
      continue;
    }
    if (item && typeof item === 'object') {
      const a = item as Record<string, unknown>;
      push(
        a.url ?? a.videoUrl ?? a.fileUrl ?? a.attachmentUrl ?? a.uri,
        a.name ?? a.fileName ?? a.filename ?? a.title,
        a.mimeType ?? a.mime ?? a.contentType ?? a.type,
      );
    }
  }
  if (Array.isArray(record.videoUrls)) {
    for (const u of record.videoUrls) push(u, null, null);
  }
  const single = record.videoUrl;
  if (single) push(single, record.videoName, record.videoMime ?? record.mimeType);

  const seen = new Set<string>();
  return out.filter((video) => (seen.has(video.url) ? false : (seen.add(video.url), true)));
}

export type VideoUnderstandingStatus = 'understood' | 'too-large' | 'failed';

export type VideoUnderstanding = {
  url: string;
  name: string | null;
  status: VideoUnderstandingStatus;
  description: string;
  reason: string | null;
};

async function fetchVideoBytes(url: string): Promise<{ bytes: Uint8Array; mediaType: string | null } | null> {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) {
    return null;
  }
  const contentLength = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(contentLength) && contentLength > MAX_VIDEO_BYTES) {
    return null;
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > MAX_VIDEO_BYTES) {
    return null;
  }
  return { bytes: new Uint8Array(buffer), mediaType: response.headers.get('content-type') };
}

/** Read one video via a video-capable model. Never throws. */
export async function understandVideo(video: VideoAttachment): Promise<VideoUnderstanding> {
  const base = { url: video.url, name: video.name };
  if (!isIVXAIConfigured()) {
    return { ...base, status: 'failed', description: '', reason: 'Video understanding model is not configured.' };
  }
  let fetched: { bytes: Uint8Array; mediaType: string | null } | null = null;
  try {
    fetched = await fetchVideoBytes(video.url);
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      description: '',
      reason: `Video could not be downloaded: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }
  if (!fetched) {
    return {
      ...base,
      status: 'too-large',
      description: '',
      reason: 'Video is unreachable or larger than the 20 MB analysis limit.',
    };
  }
  try {
    const mediaType = fetched.mediaType?.startsWith('video/') ? fetched.mediaType : videoMediaType(video);
    const result = await requestIVXAIText({
      module: 'video-understanding',
      model: getVideoModel(),
      system:
        'You are a video analyst. Watch the attached video and report what actually happens. ' +
        'Describe the scenes in order, transcribe any on-screen text and spoken numbers, and extract any ' +
        'property/project details (name, location, price, ROI, timeline, condition). Never invent details ' +
        'that are not in the video. Be concise and factual.',
      prompt: `Analyze this video${video.name ? ` (${video.name})` : ''} and report what it shows.`,
      files: [{ data: toBase64(fetched.bytes), mediaType, filename: video.name }],
      maxOutputTokens: 1200,
    });
    const description = readTrimmed(result.text);
    if (!description) {
      return { ...base, status: 'failed', description: '', reason: 'The video model returned no description.' };
    }
    return { ...base, status: 'understood', description, reason: null };
  } catch (error) {
    return {
      ...base,
      status: 'failed',
      description: '',
      reason: `Video analysis failed: ${error instanceof Error ? error.message : 'unknown error'}.`,
    };
  }
}

/** Read every attached video (bounded to the first few). Never throws. */
export async function understandVideos(videos: VideoAttachment[]): Promise<VideoUnderstanding[]> {
  if (videos.length === 0) {
    return [];
  }
  // Cap concurrent/large video analysis so one message cannot exhaust the budget.
  const bounded = videos.slice(0, 3);
  return Promise.all(bounded.map((video) => understandVideo(video)));
}

/**
 * Render understood videos as one model-readable grounding block. Pure +
 * deterministic. Returns null when there is nothing to add.
 */
export function buildVideoUnderstandingBlock(results: VideoUnderstanding[]): string | null {
  if (results.length === 0) {
    return null;
  }
  const sections = results.map((video, index) => {
    const header = `VIDEO ${index + 1}: ${video.name ?? video.url} — status: ${video.status}`;
    if (video.status === 'understood' && video.description.length > 0) {
      return `${header}\n----- BEGIN VIDEO ANALYSIS -----\n${video.description}\n----- END VIDEO ANALYSIS -----`;
    }
    return `${header}\n(Not readable — ${video.reason ?? 'unavailable'})`;
  });
  return [
    'ATTACHED VIDEO ANALYSIS: the following was read directly from the attached video(s) by a video-capable model.',
    'Base any statement about the video on this analysis. Never invent details not present here.',
    '',
    sections.join('\n\n'),
  ].join('\n');
}
