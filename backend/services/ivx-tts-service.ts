/**
 * IVX Text-to-Speech (TTS) Service — v1.0.0
 *
 * Generates voice messages from text using OpenAI TTS (tts-1 model) via the
 * Vercel AI Gateway or OpenAI direct API. The audio is returned as raw MP3 bytes
 * so the caller can stream it, store it, or send it as a voice message reply.
 *
 * Provider routing mirrors the rest of the IVX AI runtime:
 *   vck_ keys → https://ai-gateway.vercel.sh/v1/audio/speech
 *   sk-  keys → https://api.openai.com/v1/audio/speech
 *
 * If no TTS key is configured, the service degrades honestly — returns
 * `{ ok: false, error: 'TTS not configured' }` instead of throwing.
 */

import { autoDetectGatewayBaseUrl, getIVXApiKey } from './ivx-provider-autodetect';

export const IVX_TTS_SERVICE_MARKER = 'ivx-tts-service-v1.0.0-2026-08-17';

export type TTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'coral' | 'sage';

export type TTSResult = {
  ok: boolean;
  audioBase64: string | null;
  audioBytes: Uint8Array | null;
  format: 'mp3';
  voice: TTSVoice;
  model: string;
  durationMs: number;
  error: string | null;
};

export type TTSStatus = {
  configured: boolean;
  provider: 'openai_tts' | 'none';
  model: string;
  voices: TTSVoice[];
  endpoint: string | null;
  marker: string;
  version: string;
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Returns the TTS API key (same key as chat — OPENAI_API_KEY or IVX_AI_GATEWAY_KEY). */
function getTTSApiKey(): string {
  return getIVXApiKey();
}

/** Resolve the TTS endpoint from the auto-detected gateway base URL. */
function getTTSEndpoint(): string {
  const configured = readTrimmed(process.env.IVX_TTS_BASE_URL);
  if (configured) return configured.replace(/\/+$/, '') + '/audio/speech';
  const base = autoDetectGatewayBaseUrl();
  return `${base}/audio/speech`;
}

/** Resolve the TTS model (default: tts-1 for low latency). */
function getTTSModel(): string {
  return readTrimmed(process.env.IVX_TTS_MODEL) || 'tts-1';
}

/** Check if TTS is configured. */
export function isTTSConfigured(): boolean {
  return Boolean(getTTSApiKey());
}

/** Get TTS service status for health endpoints. */
export function getTTSStatus(): TTSStatus {
  return {
    configured: isTTSConfigured(),
    provider: isTTSConfigured() ? 'openai_tts' : 'none',
    model: getTTSModel(),
    voices: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'sage'],
    endpoint: isTTSConfigured() ? getTTSEndpoint() : null,
    marker: IVX_TTS_SERVICE_MARKER,
    version: '1.0.0',
  };
}

/**
 * Synthesize text to speech, returning raw MP3 audio bytes.
 *
 * @param text   — The text to speak (max 4096 chars per OpenAI TTS limit).
 * @param voice  — One of the OpenAI TTS voices (default: 'nova').
 * @param opts   — Optional speed (0.25–4.0, default 1.0) and format (always mp3).
 */
export async function synthesizeSpeech(
  text: string,
  voice: TTSVoice = 'nova',
  opts?: { speed?: number },
): Promise<TTSResult> {
  const start = Date.now();

  if (!isTTSConfigured()) {
    return {
      ok: false,
      audioBase64: null,
      audioBytes: null,
      format: 'mp3',
      voice,
      model: getTTSModel(),
      durationMs: Date.now() - start,
      error: 'TTS not configured — set OPENAI_API_KEY or IVX_AI_GATEWAY_KEY',
    };
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return {
      ok: false,
      audioBase64: null,
      audioBytes: null,
      format: 'mp3',
      voice,
      model: getTTSModel(),
      durationMs: Date.now() - start,
      error: 'Text is empty — nothing to synthesize',
    };
  }

  // OpenAI TTS limit is 4096 characters
  const truncatedText = trimmedText.slice(0, 4096);
  if (trimmedText.length > 4096) {
    console.warn('[IVX TTS] Text truncated from', trimmedText.length, 'to 4096 chars');
  }

  const apiKey = getTTSApiKey();
  const endpoint = getTTSEndpoint();
  const model = getTTSModel();
  const speed = opts?.speed ?? 1.0;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: truncatedText,
        voice,
        response_format: 'mp3',
        speed,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const errorMsg = `TTS API returned HTTP ${response.status}: ${errText.slice(0, 300)}`;
      console.error('[IVX TTS]', errorMsg);
      return {
        ok: false,
        audioBase64: null,
        audioBytes: null,
        format: 'mp3',
        voice,
        model,
        durationMs: Date.now() - start,
        error: errorMsg,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const audioBytes = new Uint8Array(arrayBuffer);

    if (audioBytes.byteLength === 0) {
      return {
        ok: false,
        audioBase64: null,
        audioBytes: null,
        format: 'mp3',
        voice,
        model,
        durationMs: Date.now() - start,
        error: 'TTS API returned empty audio data',
      };
    }

    const audioBase64 = Buffer.from(audioBytes).toString('base64');

    console.log(`[IVX TTS] Synthesized ${audioBytes.byteLength} bytes (${truncatedText.length} chars) in ${Date.now() - start}ms via ${model}/${voice}`);

    return {
      ok: true,
      audioBase64,
      audioBytes,
      format: 'mp3',
      voice,
      model,
      durationMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[IVX TTS] Synthesis error:', errorMsg);
    return {
      ok: false,
      audioBase64: null,
      audioBytes: null,
      format: 'mp3',
      voice,
      model,
      durationMs: Date.now() - start,
      error: errorMsg,
    };
  }
}

/**
 * Synthesize speech and return as a data URI (data:audio/mp3;base64,...).
 * Useful for direct playback in web/mobile clients.
 */
export async function synthesizeSpeechDataUri(
  text: string,
  voice: TTSVoice = 'nova',
  opts?: { speed?: number },
): Promise<{ ok: boolean; dataUri: string | null; error: string | null; durationMs: number }> {
  const result = await synthesizeSpeech(text, voice, opts);
  if (!result.ok || !result.audioBase64) {
    return { ok: false, dataUri: null, error: result.error, durationMs: result.durationMs };
  }
  return {
    ok: true,
    dataUri: `data:audio/mp3;base64,${result.audioBase64}`,
    error: null,
    durationMs: result.durationMs,
  };
}
