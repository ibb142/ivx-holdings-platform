/**
 * IVX Text-to-Speech (TTS) Service — v2.0.0 (Rork-independent)
 *
 * Generates voice messages from text using direct provider APIs.
 * Supports two independent provider paths:
 *   1. Direct Vercel AI Gateway → /v4/ai/speech-model (if vck_ key present)
 *   2. OpenAI direct API → /v1/audio/speech (if sk- key present)
 *
 * No Rork Toolkit proxy dependency. IVX is fully independent.
 */

import { getIVXApiKey, detectIVXProviderType, OPENAI_DIRECT_BASE } from './ivx-provider-autodetect';

export const IVX_TTS_SERVICE_MARKER = 'ivx-tts-service-v2.0.0-rork-independent-2026-08-17';

/** Voices for xAI grok-tts (primary via Gateway) */
export type GrokTTSVoice = 'eve' | 'ara' | 'rex' | 'sal' | 'leo';
/** Voices for OpenAI tts-1 (fallback via direct API) */
export type OpenAITTSVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | 'coral' | 'sage';
/** Union of all supported TTS voices */
export type TTSVoice = GrokTTSVoice | OpenAITTSVoice;

const GROK_VOICES: GrokTTSVoice[] = ['eve', 'ara', 'rex', 'sal', 'leo'];
const OPENAI_VOICES: OpenAITTSVoice[] = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer', 'coral', 'sage'];

export type TTSResult = {
  ok: boolean;
  audioBase64: string | null;
  audioBytes: Uint8Array | null;
  format: 'mp3';
  voice: string;
  model: string;
  provider: 'vercel_gateway' | 'openai_direct' | 'none';
  durationMs: number;
  error: string | null;
};

export type TTSStatus = {
  configured: boolean;
  provider: 'vercel_gateway' | 'openai_direct' | 'none';
  model: string;
  voices: string[];
  endpoint: string | null;
  marker: string;
  version: string;
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Check if OpenAI direct TTS is available (sk- key). */
function isOpenAITTSAvailable(): boolean {
  const key = getIVXApiKey();
  return Boolean(key && key.startsWith('sk-'));
}

/** Check if direct Vercel AI Gateway TTS is available (vck_ key). */
function isGatewayTTSAvailable(): boolean {
  const key = getIVXApiKey();
  return Boolean(key && key.startsWith('vck_'));
}

/** Resolve the TTS model based on provider. */
function getTTSModel(): string {
  if (isGatewayTTSAvailable()) {
    return readTrimmed(process.env.IVX_TTS_MODEL) || 'xai/grok-tts';
  }
  return readTrimmed(process.env.IVX_TTS_MODEL) || 'tts-1';
}

/** Check if TTS is configured (any provider available). */
export function isTTSConfigured(): boolean {
  return isGatewayTTSAvailable() || isOpenAITTSAvailable();
}

/** Get TTS service status for health endpoints. */
export function getTTSStatus(): TTSStatus {
  const gatewayAvailable = isGatewayTTSAvailable();
  const openaiAvailable = isOpenAITTSAvailable();
  const provider: TTSStatus['provider'] = gatewayAvailable
    ? 'vercel_gateway'
    : openaiAvailable
      ? 'openai_direct'
      : 'none';
  const model = getTTSModel();
  const voices = gatewayAvailable ? GROK_VOICES : openaiAvailable ? OPENAI_VOICES : [...GROK_VOICES, ...OPENAI_VOICES];

  let endpoint: string | null = null;
  if (gatewayAvailable) {
    endpoint = 'https://ai-gateway.vercel.sh/v4/ai/speech-model';
  } else if (openaiAvailable) {
    endpoint = `${OPENAI_DIRECT_BASE}/audio/speech`;
  }

  return {
    configured: isTTSConfigured(),
    provider,
    model,
    voices,
    endpoint,
    marker: IVX_TTS_SERVICE_MARKER,
    version: '2.0.0',
  };
}

/**
 * Synthesize text to speech via direct Vercel AI Gateway (vck_ key).
 * Uses xai/grok-tts with the /v4/ai/speech-model endpoint.
 */
async function synthesizeWithGateway(
  text: string,
  voice: string,
): Promise<TTSResult> {
  const start = Date.now();
  const apiKey = getIVXApiKey();
  const model = getTTSModel();
  const endpoint = 'https://ai-gateway.vercel.sh/v4/ai/speech-model';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'ai-model-id': model,
        'ai-gateway-protocol-version': '0.0.1',
      },
      body: JSON.stringify({
        text,
        voice,
        outputFormat: 'mp3',
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const errorMsg = `Gateway TTS returned HTTP ${response.status}: ${errText.slice(0, 300)}`;
      console.error('[IVX TTS]', errorMsg);
      return {
        ok: false,
        audioBase64: null,
        audioBytes: null,
        format: 'mp3',
        voice,
        model,
        provider: 'vercel_gateway',
        durationMs: Date.now() - start,
        error: errorMsg,
      };
    }

    const body = await response.json() as Record<string, unknown>;
    const audioBase64 = readTrimmed(body.audio);

    if (!audioBase64) {
      return {
        ok: false,
        audioBase64: null,
        audioBytes: null,
        format: 'mp3',
        voice,
        model,
        provider: 'vercel_gateway',
        durationMs: Date.now() - start,
        error: 'Gateway TTS returned empty audio data',
      };
    }

    const audioBytes = new Uint8Array(Buffer.from(audioBase64, 'base64'));

    console.log(`[IVX TTS] Synthesized ${audioBytes.byteLength} bytes via Gateway/${model}/${voice} in ${Date.now() - start}ms`);

    return {
      ok: true,
      audioBase64,
      audioBytes,
      format: 'mp3',
      voice,
      model,
      provider: 'vercel_gateway',
      durationMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[IVX TTS] Gateway synthesis error:', errorMsg);
    return {
      ok: false,
      audioBase64: null,
      audioBytes: null,
      format: 'mp3',
      voice,
      model,
      provider: 'vercel_gateway',
      durationMs: Date.now() - start,
      error: errorMsg,
    };
  }
}

/**
 * Synthesize text to speech via OpenAI direct API (fallback).
 * Uses tts-1 model with voice "alloy" as default.
 */
async function synthesizeWithOpenAI(
  text: string,
  voice: string,
): Promise<TTSResult> {
  const start = Date.now();
  const apiKey = getIVXApiKey();
  const model = 'tts-1';
  const endpoint = `${OPENAI_DIRECT_BASE}/audio/speech`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: text,
        voice,
        response_format: 'mp3',
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      const errorMsg = `OpenAI TTS returned HTTP ${response.status}: ${errText.slice(0, 300)}`;
      console.error('[IVX TTS]', errorMsg);
      return {
        ok: false,
        audioBase64: null,
        audioBytes: null,
        format: 'mp3',
        voice,
        model,
        provider: 'openai_direct',
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
        provider: 'openai_direct',
        durationMs: Date.now() - start,
        error: 'OpenAI TTS returned empty audio data',
      };
    }

    const audioBase64 = Buffer.from(audioBytes).toString('base64');

    console.log(`[IVX TTS] Synthesized ${audioBytes.byteLength} bytes via OpenAI/${model}/${voice} in ${Date.now() - start}ms`);

    return {
      ok: true,
      audioBase64,
      audioBytes,
      format: 'mp3',
      voice,
      model,
      provider: 'openai_direct',
      durationMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[IVX TTS] OpenAI synthesis error:', errorMsg);
    return {
      ok: false,
      audioBase64: null,
      audioBytes: null,
      format: 'mp3',
      voice,
      model,
      provider: 'openai_direct',
      durationMs: Date.now() - start,
      error: errorMsg,
    };
  }
}

/**
 * Synthesize text to speech, returning base64 MP3 audio.
 *
 * Provider priority (Rork-independent):
 *   1. Direct Vercel AI Gateway (xai/grok-tts) — default voice: "eve"
 *   2. OpenAI direct API (tts-1) — default voice: "alloy"
 *
 * @param text   — The text to speak (max 4096 chars).
 * @param voice  — Voice ID (auto-resolved based on provider).
 * @param opts   — Optional speed (OpenAI only, 0.25–4.0).
 */
export async function synthesizeSpeech(
  text: string,
  voice?: TTSVoice,
  opts?: { speed?: number },
): Promise<TTSResult> {
  const start = Date.now();

  if (!isTTSConfigured()) {
    return {
      ok: false,
      audioBase64: null,
      audioBytes: null,
      format: 'mp3',
      voice: voice || 'eve',
      model: getTTSModel(),
      provider: 'none',
      durationMs: Date.now() - start,
      error: 'TTS not configured — set IVX_AI_GATEWAY_KEY (vck_) or OPENAI_API_KEY (sk-)',
    };
  }

  const trimmedText = text.trim();
  if (!trimmedText) {
    return {
      ok: false,
      audioBase64: null,
      audioBytes: null,
      format: 'mp3',
      voice: voice || 'eve',
      model: getTTSModel(),
      provider: 'none',
      durationMs: Date.now() - start,
      error: 'Text is empty — nothing to synthesize',
    };
  }

  // Truncate to 4096 chars (OpenAI limit; Gateway is similar)
  const truncatedText = trimmedText.slice(0, 4096);
  if (trimmedText.length > 4096) {
    console.warn('[IVX TTS] Text truncated from', trimmedText.length, 'to 4096 chars');
  }

  // Try direct Vercel AI Gateway first (vck_ key, xai/grok-tts)
  if (isGatewayTTSAvailable()) {
    const grokVoice: string = voice && (GROK_VOICES as string[]).includes(voice) ? voice : 'eve';
    const result = await synthesizeWithGateway(truncatedText, grokVoice);
    if (result.ok) return result;
    console.warn('[IVX TTS] Gateway failed, trying OpenAI fallback:', result.error?.slice(0, 100));
  }

  // Fallback to OpenAI direct API (sk- key)
  if (isOpenAITTSAvailable()) {
    const openaiVoice: string = voice && (OPENAI_VOICES as string[]).includes(voice) ? voice : 'alloy';
    return synthesizeWithOpenAI(truncatedText, openaiVoice);
  }

  return {
    ok: false,
    audioBase64: null,
    audioBytes: null,
    format: 'mp3',
    voice: voice || 'eve',
    model: getTTSModel(),
    provider: 'none',
    durationMs: Date.now() - start,
    error: 'All TTS providers failed or not configured',
  };
}

/**
 * Synthesize speech and return as a data URI (data:audio/mp3;base64,...).
 * Useful for direct playback in web/mobile clients.
 */
export async function synthesizeSpeechDataUri(
  text: string,
  voice?: TTSVoice,
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
