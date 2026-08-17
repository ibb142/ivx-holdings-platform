/**
 * IVX Voice Chat API — v1.0.0
 *
 * End-to-end voice chat: user sends an audio voice message → IVX transcribes it
 * (speech-to-text via ElevenLabs Scribe / OpenAI Whisper) → sends the transcript
 * to the IVX AI brain (GPT-4o) for a response → synthesizes the response to
 * speech (text-to-speech via OpenAI TTS) → returns the audio reply as base64 MP3.
 *
 * The caller sends audio (as base64 or a URL) and gets back:
 *   - transcribedText: what the user said
 *   - aiResponse: the text reply from the AI brain
 *   - audioReplyBase64: the voice message reply (MP3 audio)
 *   - audioReplyDataUri: data:audio/mp3;base64,... for direct playback
 *
 * This closes the gap: IVX IA can now SEND voice messages, not just text.
 */

import { transcribeAudioBytes, isTranscriptionConfigured } from '../services/ivx-transcription-core';
import { synthesizeSpeech, isTTSConfigured, getTTSStatus, type TTSVoice } from '../services/ivx-tts-service';
import { requestIVXAIText, isIVXAIConfigured, resolveIVXAIModel } from '../ivx-ai-runtime';

export const IVX_VOICE_CHAT_API_MARKER = 'ivx-voice-chat-api-v1.0.0-2026-08-17';

// ── Types ─────────────────────────────────────────────────────────────────────

export type VoiceChatResult = {
  ok: boolean;
  transcribedText: string | null;
  aiResponse: string | null;
  audioReplyBase64: string | null;
  audioReplyDataUri: string | null;
  voice: TTSVoice;
  transcriptionProvider: string | null;
  ttsModel: string | null;
  durationMs: number;
  error: string | null;
};

export type VoiceChatStatus = {
  ok: boolean;
  marker: string;
  version: string;
  configured: boolean;
  transcription: {
    configured: boolean;
    providers: string[];
  };
  tts: {
    configured: boolean;
    model: string;
    voices: TTSVoice[];
    endpoint: string | null;
  };
  aiBrain: {
    configured: boolean;
    model: string;
  };
  endpoints: Record<string, string>;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Decode a base64 string to Uint8Array, handling data URI prefix. */
function decodeBase64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

/** Fetch audio bytes from a URL (bounded to 25MB). */
async function fetchAudioFromUrl(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 25 * 1024 * 1024) return null; // 25MB max
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

/** Detect mime type from filename or content-type header. */
function detectMimeType(filename: string, fallback: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeMap: Record<string, string> = {
    'm4a': 'audio/m4a',
    'mp3': 'audio/mp3',
    'wav': 'audio/wav',
    'webm': 'audio/webm',
    'ogg': 'audio/ogg',
    'oga': 'audio/ogg',
    'flac': 'audio/flac',
    'aac': 'audio/aac',
  };
  return mimeMap[ext] || fallback || 'audio/m4a';
}

// ── AI Brain ──────────────────────────────────────────────────────────────────

const VOICE_CHAT_SYSTEM_PROMPT = `You are the IVX Holdings AI assistant in a voice chat conversation. The user sent a voice message that was transcribed to text. You must respond naturally, as if speaking back to them in a voice message.

You can:
1. Answer questions about IVX Holdings — a holdings company with 112 IA engineering agents (Division A: 55, Division B: 57) that work autonomously, with a production backend, Android app, code execution layer, and app creation pipeline.
2. Act as an IA developer agent — discuss code, architecture, deployment, testing in TypeScript, Kotlin, Swift, React Native, Hono, Ktor, Compose, Supabase, Render.
3. Answer any normal question — general knowledge, advice, anything.

Keep responses SHORT and NATURAL (2-4 sentences max). Speak conversationally as if leaving a voice message. Do not use markdown, code blocks, or special formatting. Just plain spoken English.`;

/** Get the AI brain response for a transcribed voice message. */
async function getAIResponse(userText: string): Promise<{ ok: boolean; text: string | null; error: string | null }> {
  if (!isIVXAIConfigured()) {
    return { ok: false, text: null, error: 'AI brain not configured' };
  }

  try {
    const result = await requestIVXAIText({
      module: 'voice-chat' as never,
      system: VOICE_CHAT_SYSTEM_PROMPT,
      prompt: userText,
      maxOutputTokens: 300,
    });

    const text = (result.text || '').trim();
    if (!text) {
      return { ok: false, text: null, error: 'AI brain returned empty response' };
    }

    return { ok: true, text, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[IVX Voice Chat] AI brain error:', errorMsg);
    return { ok: false, text: null, error: errorMsg };
  }
}

// ── Status ───────────────────────────────────────────────────────────────────

/** Get voice chat service status. */
export function getVoiceChatStatus(): VoiceChatStatus {
  return {
    ok: true,
    marker: IVX_VOICE_CHAT_API_MARKER,
    version: '1.0.0',
    configured: isTranscriptionConfigured() && isTTSConfigured() && isIVXAIConfigured(),
    transcription: {
      configured: isTranscriptionConfigured(),
      providers: ['elevenlabs_scribe', 'openai_whisper'],
    },
    tts: {
      configured: isTTSConfigured(),
      model: getTTSStatus().model,
      voices: getTTSStatus().voices,
      endpoint: getTTSStatus().endpoint,
    },
    aiBrain: {
      configured: isIVXAIConfigured(),
      model: resolveIVXAIModel('gpt-4o'),
    },
    endpoints: {
      status: 'GET /api/ivx/voice-chat/status',
      chat: 'POST /api/ivx/voice-chat',
      transcribe: 'POST /api/ivx/voice-chat/transcribe',
      speak: 'POST /api/ivx/voice-chat/speak',
    },
  };
}

// ── Transcribe Only ───────────────────────────────────────────────────────────

export type TranscribeResult = {
  ok: boolean;
  text: string | null;
  provider: string | null;
  durationMs: number;
  error: string | null;
};

/** Transcribe audio bytes to text (speech-to-text only). */
export async function transcribeVoiceMessage(
  audioBytes: Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<TranscribeResult> {
  const start = Date.now();

  if (!isTranscriptionConfigured()) {
    return {
      ok: false,
      text: null,
      provider: null,
      durationMs: Date.now() - start,
      error: 'Transcription not configured — set ELEVENLABS_API_KEY or OPENAI_API_KEY',
    };
  }

  try {
    const result = await transcribeAudioBytes(audioBytes, fileName, mimeType);
    return {
      ok: true,
      text: result.text,
      provider: result.provider,
      durationMs: Date.now() - start,
      error: null,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[IVX Voice Chat] Transcription error:', errorMsg);
    return {
      ok: false,
      text: null,
      provider: null,
      durationMs: Date.now() - start,
      error: errorMsg,
    };
  }
}

// ── Speak Only ────────────────────────────────────────────────────────────────

export type SpeakResult = {
  ok: boolean;
  audioBase64: string | null;
  audioDataUri: string | null;
  model: string | null;
  durationMs: number;
  error: string | null;
};

/** Synthesize text to speech (text-to-speech only). */
export async function speakText(
  text: string,
  voice?: TTSVoice,
): Promise<SpeakResult> {
  const start = Date.now();

  const result = await synthesizeSpeech(text, voice || 'nova');
  if (!result.ok || !result.audioBase64) {
    return {
      ok: false,
      audioBase64: null,
      audioDataUri: null,
      model: result.model,
      durationMs: Date.now() - start,
      error: result.error,
    };
  }

  return {
    ok: true,
    audioBase64: result.audioBase64,
    audioDataUri: `data:audio/mp3;base64,${result.audioBase64}`,
    model: result.model,
    durationMs: Date.now() - start,
    error: null,
  };
}

// ── Full Voice Chat (end-to-end) ──────────────────────────────────────────────

/**
 * Full end-to-end voice chat:
 * 1. Decode/fetch audio bytes from the request
 * 2. Transcribe (speech → text)
 * 3. Send transcript to AI brain (GPT-4o)
 * 4. Synthesize AI response to speech (text → audio)
 * 5. Return everything: transcript, AI text, audio reply
 */
export async function handleVoiceChat(request: Request): Promise<Response> {
  const start = Date.now();

  try {
    const body = await request.json() as Record<string, unknown>;
    const audioBase64 = readTrimmed(body.audioBase64);
    const audioUrl = readTrimmed(body.audioUrl);
    const voice = (readTrimmed(body.voice) || 'nova') as TTSVoice;
    const fileName = readTrimmed(body.fileName) || `voice-message-${Date.now()}.m4a`;
    const mimeType = readTrimmed(body.mimeType) || detectMimeType(fileName, 'audio/m4a');

    // Validate input
    if (!audioBase64 && !audioUrl) {
      return Response.json({
        ok: false,
        error: 'Either audioBase64 or audioUrl is required',
        marker: IVX_VOICE_CHAT_API_MARKER,
        durationMs: Date.now() - start,
      }, { status: 400 });
    }

    // Check all dependencies
    if (!isTranscriptionConfigured()) {
      return Response.json({
        ok: false,
        error: 'Transcription (speech-to-text) is not configured — set ELEVENLABS_API_KEY or OPENAI_API_KEY',
        marker: IVX_VOICE_CHAT_API_MARKER,
        durationMs: Date.now() - start,
      }, { status: 503 });
    }
    if (!isIVXAIConfigured()) {
      return Response.json({
        ok: false,
        error: 'AI brain is not configured',
        marker: IVX_VOICE_CHAT_API_MARKER,
        durationMs: Date.now() - start,
      }, { status: 503 });
    }
    if (!isTTSConfigured()) {
      return Response.json({
        ok: false,
        error: 'TTS (text-to-speech) is not configured — set OPENAI_API_KEY or IVX_AI_GATEWAY_KEY',
        marker: IVX_VOICE_CHAT_API_MARKER,
        durationMs: Date.now() - start,
      }, { status: 503 });
    }

    // Step 1: Get audio bytes
    let audioBytes: Uint8Array | null = null;
    if (audioBase64) {
      audioBytes = decodeBase64ToBytes(audioBase64);
    } else if (audioUrl) {
      audioBytes = await fetchAudioFromUrl(audioUrl);
      if (!audioBytes) {
        return Response.json({
          ok: false,
          error: `Failed to fetch audio from URL: ${audioUrl}`,
          marker: IVX_VOICE_CHAT_API_MARKER,
          durationMs: Date.now() - start,
        }, { status: 400 });
      }
    }

    if (!audioBytes || audioBytes.byteLength === 0) {
      return Response.json({
        ok: false,
        error: 'Audio data is empty or could not be decoded',
        marker: IVX_VOICE_CHAT_API_MARKER,
        durationMs: Date.now() - start,
      }, { status: 400 });
    }

    console.log(`[IVX Voice Chat] Received ${audioBytes.byteLength} bytes of audio (${mimeType})`);

    // Step 2: Transcribe (speech → text)
    const transcribeResult = await transcribeVoiceMessage(audioBytes, fileName, mimeType);
    if (!transcribeResult.ok || !transcribeResult.text) {
      return Response.json({
        ok: false,
        error: `Transcription failed: ${transcribeResult.error}`,
        marker: IVX_VOICE_CHAT_API_MARKER,
        durationMs: Date.now() - start,
      }, { status: 500 });
    }

    const transcribedText = transcribeResult.text;
    console.log(`[IVX Voice Chat] Transcribed (${transcribeResult.provider}): "${transcribedText.slice(0, 100)}"`);

    // Step 3: AI brain response
    const aiResult = await getAIResponse(transcribedText);
    if (!aiResult.ok || !aiResult.text) {
      return Response.json({
        ok: false,
        transcribedText,
        error: `AI brain failed: ${aiResult.error}`,
        marker: IVX_VOICE_CHAT_API_MARKER,
        durationMs: Date.now() - start,
      }, { status: 500 });
    }

    const aiResponse = aiResult.text;
    console.log(`[IVX Voice Chat] AI response: "${aiResponse.slice(0, 100)}"`);

    // Step 4: Synthesize AI response to speech (text → audio)
    const ttsResult = await synthesizeSpeech(aiResponse, voice);
    if (!ttsResult.ok || !ttsResult.audioBase64) {
      return Response.json({
        ok: false,
        transcribedText,
        aiResponse,
        error: `TTS failed: ${ttsResult.error}`,
        marker: IVX_VOICE_CHAT_API_MARKER,
        durationMs: Date.now() - start,
      }, { status: 500 });
    }

    console.log(`[IVX Voice Chat] TTS synthesized ${ttsResult.audioBytes?.byteLength} bytes in ${ttsResult.durationMs}ms`);

    // Step 5: Return everything
    const result: VoiceChatResult = {
      ok: true,
      transcribedText,
      aiResponse,
      audioReplyBase64: ttsResult.audioBase64,
      audioReplyDataUri: `data:audio/mp3;base64,${ttsResult.audioBase64}`,
      voice,
      transcriptionProvider: transcribeResult.provider,
      ttsModel: ttsResult.model,
      durationMs: Date.now() - start,
      error: null,
    };

    console.log(`[IVX Voice Chat] End-to-end completed in ${result.durationMs}ms`);

    return Response.json(result, { status: 200 });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[IVX Voice Chat] Handler error:', errorMsg);
    return Response.json({
      ok: false,
      error: errorMsg,
      marker: IVX_VOICE_CHAT_API_MARKER,
      durationMs: Date.now() - start,
    }, { status: 500 });
  }
}

/** Handle transcribe-only endpoint. */
export async function handleVoiceChatTranscribe(request: Request): Promise<Response> {
  const start = Date.now();

  try {
    const body = await request.json() as Record<string, unknown>;
    const audioBase64 = readTrimmed(body.audioBase64);
    const audioUrl = readTrimmed(body.audioUrl);
    const fileName = readTrimmed(body.fileName) || `voice-${Date.now()}.m4a`;
    const mimeType = readTrimmed(body.mimeType) || detectMimeType(fileName, 'audio/m4a');

    let audioBytes: Uint8Array | null = null;
    if (audioBase64) {
      audioBytes = decodeBase64ToBytes(audioBase64);
    } else if (audioUrl) {
      audioBytes = await fetchAudioFromUrl(audioUrl);
    }

    if (!audioBytes || audioBytes.byteLength === 0) {
      return Response.json({ ok: false, error: 'Audio data required', durationMs: Date.now() - start }, { status: 400 });
    }

    const result = await transcribeVoiceMessage(audioBytes, fileName, mimeType);

    return Response.json({
      ...result,
      marker: IVX_VOICE_CHAT_API_MARKER,
    }, { status: result.ok ? 200 : 500 });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: errorMsg, durationMs: Date.now() - start }, { status: 500 });
  }
}

/** Handle speak-only endpoint (text → speech). */
export async function handleVoiceChatSpeak(request: Request): Promise<Response> {
  const start = Date.now();

  try {
    const body = await request.json() as Record<string, unknown>;
    const text = readTrimmed(body.text);
    const voice = (readTrimmed(body.voice) || 'nova') as TTSVoice;

    if (!text) {
      return Response.json({ ok: false, error: 'text is required', durationMs: Date.now() - start }, { status: 400 });
    }

    const result = await speakText(text, voice);

    return Response.json({
      ...result,
      marker: IVX_VOICE_CHAT_API_MARKER,
    }, { status: result.ok ? 200 : 500 });

  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return Response.json({ ok: false, error: errorMsg, durationMs: Date.now() - start }, { status: 500 });
  }
}
