/**
 * IVX Voice Chat API — v1.0.0
 */

import { transcribeAudioBytes, isTranscriptionConfigured } from '../services/ivx-transcription-core';
import { synthesizeSpeech, isTTSConfigured, getTTSStatus, type TTSVoice } from '../services/ivx-tts-service';
import { requestIVXAIText, isIVXAIConfigured, resolveIVXAIModel } from '../ivx-ai-runtime';

export const IVX_VOICE_CHAT_API_MARKER = 'ivx-voice-chat-api-v1.0.0-2026-08-17';

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
  transcription: { configured: boolean; providers: string[] };
  tts: { configured: boolean; model: string; voices: string[]; endpoint: string | null };
  aiBrain: { configured: boolean; model: string };
  endpoints: Record<string, string>;
};

function readTrimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:[^;]+;base64,/, '');
  return new Uint8Array(Buffer.from(cleaned, 'base64'));
}

async function fetchAudioFromUrl(url: string): Promise<Uint8Array | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 25 * 1024 * 1024) return null;
    return new Uint8Array(buffer);
  } catch {
    return null;
  }
}

function detectMimeType(filename: string, fallback: string): string {
  const ext = filename.toLowerCase().split('.').pop() || '';
  const mimeMap: Record<string, string> = {
    m4a: 'audio/m4a', mp3: 'audio/mp3', wav: 'audio/wav', webm: 'audio/webm',
    ogg: 'audio/ogg', oga: 'audio/ogg', flac: 'audio/flac', aac: 'audio/aac',
  };
  return mimeMap[ext] || fallback || 'audio/m4a';
}

const VOICE_CHAT_SYSTEM_PROMPT = `You are the IVX Holdings AI assistant in a voice chat conversation. The user sent a voice message that was transcribed to text. Respond naturally and briefly in plain spoken English.`;

async function getAIResponse(userText: string): Promise<{ ok: boolean; text: string | null; error: string | null }> {
  if (!isIVXAIConfigured()) return { ok: false, text: null, error: 'AI brain not configured' };
  try {
    const result = await requestIVXAIText({ module: 'voice-chat' as never, system: VOICE_CHAT_SYSTEM_PROMPT, prompt: userText, maxOutputTokens: 300 });
    const text = (result.text || '').trim();
    if (!text) return { ok: false, text: null, error: 'AI brain returned empty response' };
    return { ok: true, text, error: null };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { ok: false, text: null, error: errorMsg };
  }
}

export function getVoiceChatStatus(): VoiceChatStatus {
  const ttsStatus = getTTSStatus();
  return {
    ok: true,
    marker: IVX_VOICE_CHAT_API_MARKER,
    version: '1.0.0',
    configured: isTranscriptionConfigured() && isTTSConfigured() && isIVXAIConfigured(),
    transcription: { configured: isTranscriptionConfigured(), providers: ['elevenlabs_scribe', 'openai_whisper'] },
    tts: { configured: isTTSConfigured(), model: ttsStatus.model, voices: ttsStatus.voices, endpoint: ttsStatus.endpoint },
    aiBrain: { configured: isIVXAIConfigured(), model: resolveIVXAIModel('gpt-4o') },
    endpoints: {
      status: 'GET /api/ivx/voice-chat/status', chat: 'POST /api/ivx/voice-chat',
      transcribe: 'POST /api/ivx/voice-chat/transcribe', speak: 'POST /api/ivx/voice-chat/speak',
    },
  };
}

export type TranscribeResult = { ok: boolean; text: string | null; provider: string | null; durationMs: number; error: string | null };

export async function transcribeVoiceMessage(audioBytes: Uint8Array, fileName: string, mimeType: string): Promise<TranscribeResult> {
  const start = Date.now();
  if (!isTranscriptionConfigured()) return { ok: false, text: null, provider: null, durationMs: Date.now() - start, error: 'Transcription not configured' };
  try {
    const result = await transcribeAudioBytes(audioBytes, fileName, mimeType);
    return { ok: true, text: result.text, provider: result.provider, durationMs: Date.now() - start, error: null };
  } catch (err) {
    return { ok: false, text: null, provider: null, durationMs: Date.now() - start, error: err instanceof Error ? err.message : String(err) };
  }
}

export type SpeakResult = { ok: boolean; audioBase64: string | null; audioDataUri: string | null; model: string | null; durationMs: number; error: string | null };

export async function speakText(text: string, voice?: TTSVoice): Promise<SpeakResult> {
  const start = Date.now();
  const result = await synthesizeSpeech(text, voice || 'nova');
  if (!result.ok || !result.audioBase64) return { ok: false, audioBase64: null, audioDataUri: null, model: result.model, durationMs: Date.now() - start, error: result.error };
  return { ok: true, audioBase64: result.audioBase64, audioDataUri: `data:audio/mp3;base64,${result.audioBase64}`, model: result.model, durationMs: Date.now() - start, error: null };
}

export async function handleVoiceChat(request: Request): Promise<Response> {
  const start = Date.now();
  try {
    const body = await request.json() as Record<string, unknown>;
    const audioBase64 = readTrimmed(body.audioBase64);
    const audioUrl = readTrimmed(body.audioUrl);
    const voice = (readTrimmed(body.voice) || 'nova') as TTSVoice;
    const fileName = readTrimmed(body.fileName) || `voice-message-${Date.now()}.m4a`;
    const mimeType = readTrimmed(body.mimeType) || detectMimeType(fileName, 'audio/m4a');
    if (!audioBase64 && !audioUrl) return Response.json({ ok: false, error: 'Either audioBase64 or audioUrl is required' }, { status: 400 });
    if (!isTranscriptionConfigured() || !isIVXAIConfigured() || !isTTSConfigured()) return Response.json({ ok: false, error: 'Voice chat dependencies are not configured' }, { status: 503 });
    let audioBytes: Uint8Array | null = audioBase64 ? decodeBase64ToBytes(audioBase64) : await fetchAudioFromUrl(audioUrl);
    if (!audioBytes?.byteLength) return Response.json({ ok: false, error: 'Audio data is empty or could not be decoded' }, { status: 400 });
    const transcribeResult = await transcribeVoiceMessage(audioBytes, fileName, mimeType);
    if (!transcribeResult.ok || !transcribeResult.text) return Response.json({ ok: false, error: `Transcription failed: ${transcribeResult.error}` }, { status: 500 });
    const aiResult = await getAIResponse(transcribeResult.text);
    if (!aiResult.ok || !aiResult.text) return Response.json({ ok: false, transcribedText: transcribeResult.text, error: `AI brain failed: ${aiResult.error}` }, { status: 500 });
    const ttsResult = await synthesizeSpeech(aiResult.text, voice);
    if (!ttsResult.ok || !ttsResult.audioBase64) return Response.json({ ok: false, error: `TTS failed: ${ttsResult.error}` }, { status: 500 });
    const result: VoiceChatResult = {
      ok: true, transcribedText: transcribeResult.text, aiResponse: aiResult.text,
      audioReplyBase64: ttsResult.audioBase64, audioReplyDataUri: `data:audio/mp3;base64,${ttsResult.audioBase64}`,
      voice, transcriptionProvider: transcribeResult.provider, ttsModel: ttsResult.model,
      durationMs: Date.now() - start, error: null,
    };
    return Response.json(result);
  } catch (err) {
    return Response.json({ ok: false, error: err instanceof Error ? err.message : String(err), marker: IVX_VOICE_CHAT_API_MARKER, durationMs: Date.now() - start }, { status: 500 });
  }
}
