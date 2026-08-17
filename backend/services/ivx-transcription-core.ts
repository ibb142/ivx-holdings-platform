/**
 * Shared speech-to-text core.
 *
 * Used by both the owner audio-transcribe route and the video worker's audio
 * stage. Tries ElevenLabs Scribe first, then falls back to OpenAI Whisper.
 * Throws a precise, non-configured error when no provider key is present so the
 * caller can surface an exact runtime dependency.
 */

import { autoDetectGatewayBaseUrl, getIVXApiKey, detectIVXProviderType, VERCEL_AI_GATEWAY_BASE } from './ivx-provider-autodetect';

export type TranscriptionProvider = 'elevenlabs_scribe' | 'openai_whisper' | 'vercel_gateway';

export type TranscriptionCoreResult = {
  text: string;
  provider: TranscriptionProvider;
  model: string;
  languageCode: string | null;
  durationSeconds: number | null;
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getElevenLabsApiKey(): string {
  return readTrimmed(process.env.ELEVENLABS_API_KEY) || readTrimmed(process.env.ELEVENLABS_SECRET_KEY);
}

export function getOpenAITranscriptionApiKey(): string {
  return readTrimmed(process.env.OPENAI_API_KEY) || readTrimmed(process.env.WHISPER_API_KEY) || readTrimmed(process.env.IVX_AI_GATEWAY_KEY);
}

function getOpenAITranscriptionBaseUrl(): string {
  const configured = readTrimmed(process.env.OPENAI_AUDIO_BASE_URL) || readTrimmed(process.env.IVX_OPENAI_AUDIO_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '');
  return autoDetectGatewayBaseUrl();
}

export function isTranscriptionConfigured(): boolean {
  return Boolean(getElevenLabsApiKey() || getOpenAITranscriptionApiKey());
}

/** Check if the Vercel AI Gateway transcription endpoint is available (vck_ key). */
function isGatewayTranscriptionAvailable(): boolean {
  const key = getIVXApiKey();
  return Boolean(key && key.startsWith('vck_'));
}

function extractTextFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload as Record<string, unknown>;
  const text = readTrimmed(record.text) || readTrimmed(record.transcript);
  if (text) return text;
  const words = Array.isArray(record.words) ? record.words : [];
  return words
    .map((word) => typeof word === 'object' && word ? readTrimmed((word as Record<string, unknown>).text) : '')
    .filter(Boolean)
    .join(' ')
    .trim();
}

function extractLanguageCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  return readTrimmed(record.language_code) || readTrimmed(record.language) || null;
}

function extractDurationSeconds(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  const candidates = [record.audio_duration_secs, record.duration, record.duration_seconds];
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate;
  }
  return null;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) as unknown : null;
  } catch {
    return { error: text.slice(0, 400) };
  }
}

function extractProviderError(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback;
  const record = payload as Record<string, unknown>;
  const detail = record.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (detail && typeof detail === 'object') {
    const message = (detail as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  const error = record.error;
  if (typeof error === 'string' && error.trim()) return error.trim();
  if (error && typeof error === 'object') {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string' && message.trim()) return message.trim();
  }
  return fallback;
}

function toFile(bytes: Uint8Array, fileName: string, mimeType: string): File {
  const safeName = readTrimmed(fileName).replace(/[^a-zA-Z0-9._-]/g, '-').slice(-120) || `audio-${Date.now()}.m4a`;
  return new File([bytes as unknown as BlobPart], safeName, { type: mimeType });
}

async function transcribeWithElevenLabs(file: File): Promise<TranscriptionCoreResult> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY is not configured.');

  const body = new FormData();
  body.append('model_id', 'scribe_v2');
  body.append('diarize', 'false');
  body.append('file', file, file.name);

  const response = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(extractProviderError(payload, `ElevenLabs Scribe returned HTTP ${response.status}.`));
  }
  const text = extractTextFromPayload(payload);
  if (!text) throw new Error('ElevenLabs Scribe returned an empty transcript.');
  return {
    text,
    provider: 'elevenlabs_scribe',
    model: 'scribe_v2',
    languageCode: extractLanguageCode(payload),
    durationSeconds: extractDurationSeconds(payload),
  };
}

async function transcribeWithWhisper(file: File): Promise<TranscriptionCoreResult> {
  const apiKey = getOpenAITranscriptionApiKey();
  if (!apiKey) throw new Error('OpenAI Whisper fallback is not configured.');

  const body = new FormData();
  body.append('model', readTrimmed(process.env.OPENAI_WHISPER_MODEL) || 'whisper-1');
  body.append('response_format', 'json');
  body.append('file', file, file.name);

  const response = await fetch(`${getOpenAITranscriptionBaseUrl()}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body,
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(extractProviderError(payload, `Whisper returned HTTP ${response.status}.`));
  }
  const text = extractTextFromPayload(payload);
  if (!text) throw new Error('Whisper returned an empty transcript.');
  return {
    text,
    provider: 'openai_whisper',
    model: readTrimmed(process.env.OPENAI_WHISPER_MODEL) || 'whisper-1',
    languageCode: extractLanguageCode(payload),
    durationSeconds: extractDurationSeconds(payload),
  };
}

/**
 * Transcribe a File via the Vercel AI Gateway speech-to-text endpoint.
 * Uses /v4/ai/transcription-model with xai/grok-stt model.
 */
async function transcribeWithGateway(file: File): Promise<TranscriptionCoreResult> {
  const apiKey = getIVXApiKey();
  if (!apiKey) throw new Error('IVX AI Gateway key is not configured.');

  const model = readTrimmed(process.env.IVX_GATEWAY_STT_MODEL) || 'xai/grok-stt';
  const endpoint = 'https://ai-gateway.vercel.sh/v4/ai/transcription-model';

  // Read file as base64
  const arrayBuffer = await file.arrayBuffer();
  const audioBase64 = Buffer.from(arrayBuffer).toString('base64');

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'ai-model-id': model,
      'ai-gateway-protocol-version': '0.0.1',
    },
    body: JSON.stringify({
      audio: audioBase64,
      mediaType: file.type || 'audio/m4a',
    }),
  });
  const payload = await parseJsonResponse(response);
  if (!response.ok) {
    throw new Error(extractProviderError(payload, `Gateway transcription returned HTTP ${response.status}.`));
  }
  const text = extractTextFromPayload(payload);
  if (!text) throw new Error('Gateway transcription returned an empty transcript.');
  return {
    text,
    provider: 'vercel_gateway',
    model,
    languageCode: extractLanguageCode(payload),
    durationSeconds: extractDurationSeconds(payload),
  };
}

/** Transcribe a File via ElevenLabs (preferred) → Gateway (vck_) → Whisper (fallback). */
export async function transcribeAudioFile(file: File): Promise<TranscriptionCoreResult> {
  if (!isTranscriptionConfigured() && !isGatewayTranscriptionAvailable()) {
    throw new Error('Transcription is not configured (set ELEVENLABS_API_KEY, OPENAI_API_KEY, or IVX_AI_GATEWAY_KEY).');
  }
  // Try ElevenLabs Scribe first (if configured)
  if (getElevenLabsApiKey()) {
    try {
      return await transcribeWithElevenLabs(file);
    } catch (elevenLabsError) {
      // Fall through to Gateway or Whisper
      if (!getOpenAITranscriptionApiKey() && !isGatewayTranscriptionAvailable()) throw elevenLabsError;
    }
  }
  // Try Vercel AI Gateway transcription (vck_ key)
  if (isGatewayTranscriptionAvailable()) {
    try {
      return await transcribeWithGateway(file);
    } catch (gatewayError) {
      if (!getOpenAITranscriptionApiKey()) throw gatewayError;
    }
  }
  // Fallback to OpenAI Whisper (sk- key)
  return await transcribeWithWhisper(file);
}

/** Transcribe raw audio bytes (used by the video worker after audio extraction). */
export async function transcribeAudioBytes(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string = 'audio/m4a',
): Promise<TranscriptionCoreResult> {
  if (!bytes || bytes.byteLength === 0) {
    throw new Error('Audio bytes are empty.');
  }
  return transcribeAudioFile(toFile(bytes, fileName, mimeType));
}
