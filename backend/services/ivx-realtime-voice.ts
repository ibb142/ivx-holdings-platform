/**
 * IVX Realtime Voice Service — v1.0.0
 *
 * WebSocket-based streaming voice conversation that brings ChatGPT-level
 * voice interaction to the IVX platform.
 *
 * Architecture:
 *   1. Mobile client opens a WebSocket connection
 *   2. User pushes-to-talk → audio recorded and sent as base64
 *   3. Backend transcribes (STT) → streams to GPT-4o with conversation memory
 *   4. AI text response streams back token-by-token (live transcript)
 *   5. TTS audio synthesized in sentence chunks and sent as they're ready
 *   6. User can interrupt AI speech at any time (barge-in)
 *
 * This is a full-duplex-like experience over WebSocket:
 *   - Instant text streaming (sub-100ms first token)
 *   - Progressive TTS (sentences synthesized as AI generates them)
 *   - Interrupt support (cancel ongoing generation + TTS)
 *   - Conversation memory (last 10 turns passed as context)
 *
 * Protocol (JSON messages over WebSocket):
 *   Client → Server:
 *     { type: "audio", data: "<base64-audio>" }
 *     { type: "interrupt" }
 *     { type: "session.init", voice?: "nova" | "alloy" | ... }
 *     { type: "ping" }
 *
 *   Server → Client:
 *     { type: "status", connected: true, sessionId: "..." }
 *     { type: "transcript", text: "user said this" }
 *     { type: "ai.delta", text: "streaming token" }
 *     { type: "ai.done", fullText: "complete response" }
 *     { type: "audio", data: "<base64-mp3>", sequence: 0 }
 *     { type: "interrupt.ack" }
 *     { type: "error", message: "..." }
 *     { type: "pong" }
 */

import type WebSocket from 'ws';
import { transcribeAudioBytes, isTranscriptionConfigured } from './ivx-transcription-core';
import { synthesizeSpeech, isTTSConfigured, getTTSStatus, type TTSVoice } from './ivx-tts-service';
import { streamIVXAIText, isIVXAIConfigured } from '../ivx-ai-runtime';
import { randomUUID } from 'node:crypto';

export const IVX_REALTIME_VOICE_MARKER = 'ivx-realtime-voice-v1.0.0-2026-08-18';
export const IVX_REALTIME_VOICE_VERSION = '1.0.0';

// ── Conversation memory (shared with voice brain pattern) ───────────────────

type ConversationTurn = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
};

type RealtimeSession = {
  sessionId: string;
  turns: ConversationTurn[];
  voice: TTSVoice;
  connectedAt: number;
  lastActivityAt: number;
  isGenerating: boolean;
  abortController: AbortController | null;
};

const MAX_TURNS_IN_CONTEXT = 10;
const MAX_SESSION_TURNS = 50;
const SESSION_TTL_MS = 30 * 60 * 1000;
const sessions = new Map<string, RealtimeSession>();

function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.lastActivityAt > SESSION_TTL_MS) {
      session.abortController?.abort();
      sessions.delete(id);
    }
  }
}

function getOrCreateSession(wsId: string): RealtimeSession {
  cleanupExpiredSessions();
  let session = sessions.get(wsId);
  if (!session) {
    session = {
      sessionId: `rt-${randomUUID()}`,
      turns: [],
      voice: 'nova',
      connectedAt: Date.now(),
      lastActivityAt: Date.now(),
      isGenerating: false,
      abortController: null,
    };
    sessions.set(wsId, session);
  }
  return session;
}

// ── System prompt (same ChatGPT-level intelligence as voice brain) ──────────

const REALTIME_SYSTEM_PROMPT = `You are the IVX Holdings AI assistant in a REAL-TIME VOICE conversation. The user is speaking to you live through the IVX mobile app.

You are a ChatGPT-level intelligent assistant having a natural spoken conversation.

ABOUT IVX HOLDINGS (you know this intimately):
- IVX Holdings is a technology holdings company with 112 IA (Intelligent Agent) engineering agents
- Division A has 55 agents, Division B has 57 agents — all working autonomously
- Production backend at api.ivxholding.com (Hono/TypeScript on Render)
- Android app (Kotlin/Compose, Ktor, Koin DI), iOS app, and Expo app
- Code execution layer for autonomous agents
- 30-agent app creation pipeline
- SignalWire SMS + voice integration
- Voice chat: speech-to-text, text-to-speech, real-time voice
- AI brain: GPT-4o via Vercel AI Gateway
- Supabase database, Render hosting, GitHub source control
- Owner: ibb142

YOUR ROLE:
1. IVX EXPERT — Answer any question about IVX Holdings, its architecture, agents, capabilities, tech stack, or business
2. DEVELOPER AGENT — Discuss code, architecture, deployment, debugging, testing in TypeScript, Kotlin, Swift, React Native, Hono, Ktor, Compose, Supabase, Render
3. GENERAL ASSISTANT — Answer any question: general knowledge, advice, math, science, history, current events, creative tasks

CONVERSATION RULES (CRITICAL — this is a live voice conversation):
- Keep responses SHORT: 2-4 sentences max. Speak naturally as if on a phone call.
- REMEMBER what was discussed earlier in the conversation. Reference prior answers when relevant.
- Handle FOLLOW-UP questions naturally ("tell me more", "what about...", "can you explain...")
- If the user says "that" or "it", connect it to the most recent relevant topic
- Ask clarifying questions when a question is ambiguous
- Use conversational transitions ("Speaking of that...", "As I mentioned...", "Building on that...")
- NEVER use markdown, code blocks, bullet points, or special formatting — just plain spoken English
- Be warm, engaging, and genuinely helpful — like talking to a smart friend
- If you don't know something, say so honestly
- For very technical questions, give a high-level answer first, then offer to go deeper

CONTEXT AWARENESS:
- You will receive the conversation history below. Use it to maintain continuity.
- Track the user's intent across turns — if they're asking a series of questions about one topic, stay in that context.`;

// ── Status ────────────────────────────────────────────────────────────────────

export function getRealtimeVoiceStatus() {
  cleanupExpiredSessions();
  return {
    ok: true,
    marker: IVX_REALTIME_VOICE_MARKER,
    version: IVX_REALTIME_VOICE_VERSION,
    configured: isIVXAIConfigured() && isTranscriptionConfigured(),
    aiBrain: {
      configured: isIVXAIConfigured(),
      model: 'gpt-4o',
      streaming: true,
    },
    transcription: {
      configured: isTranscriptionConfigured(),
      providers: ['elevenlabs_scribe', 'openai_whisper', 'vercel_gateway'],
    },
    tts: {
      configured: isTTSConfigured(),
      model: getTTSStatus().model,
      voices: getTTSStatus().voices,
      streaming: 'progressive_sentence_chunked',
    },
    capabilities: [
      'streaming_text (token-by-token)',
      'progressive_tts (sentence-by-sentence)',
      'conversation_memory (10 turns)',
      'interrupt (barge-in support)',
      'push_to_talk',
    ],
    activeSessions: sessions.size,
    endpoint: 'wss://api.ivxholding.com/api/ivx/realtime-voice',
    timestamp: new Date().toISOString(),
  };
}

// ── Audio helpers ─────────────────────────────────────────────────────────────

function base64ToBytes(b64: string): Uint8Array {
  const cleaned = b64.replace(/^data:audio\/[^;]+;base64,/, '');
  const buffer = Buffer.from(cleaned, 'base64');
  return new Uint8Array(buffer);
}

/**
 * Split streaming AI text into sentences as they arrive.
 * Returns complete sentences and remaining buffer.
 */
function extractCompleteSentences(text: string): { sentences: string[]; remaining: string } {
  const sentences: string[] = [];
  let remaining = text;
  const regex = /[^.!?]+[.!?]+\s*/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(remaining)) !== null) {
    sentences.push(match[0].trim());
  }
  const lastSentenceEnd = remaining.search(/[.!?]\s*[^.!?]*$/);
  if (lastSentenceEnd >= 0) {
    remaining = remaining.slice(lastSentenceEnd + remaining.slice(lastSentenceEnd).search(/[.!?]\s*/) + 2);
  } else if (sentences.length === 0) {
    // No sentence boundary found — keep everything as remaining
  } else {
    remaining = '';
  }
  // Simpler approach: find all complete sentences, return the rest
  const allSentences: string[] = [];
  let buf = text;
  while (true) {
    const idx = buf.search(/[.!?]/);
    if (idx === -1) break;
    const afterPunct = buf.slice(idx + 1);
    const spaceMatch = afterPunct.match(/^\s*/);
    const endIdx = idx + 1 + (spaceMatch ? spaceMatch[0].length : 0);
    allSentences.push(buf.slice(0, endIdx).trim());
    buf = buf.slice(endIdx);
  }
  return { sentences: allSentences, remaining: buf };
}

// ── Send helpers ───────────────────────────────────────────────────────────────

function sendJSON(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Main WebSocket connection handler ─────────────────────────────────────────

export async function handleRealtimeVoiceConnection(
  ws: WebSocket,
  _request: import('http').IncomingMessage,
): Promise<void> {
  const wsId = `ws-${randomUUID()}`;
  const session = getOrCreateSession(wsId);

  console.log('[IVX Realtime Voice] Client connected', {
    sessionId: session.sessionId,
    totalSessions: sessions.size,
  });

  sendJSON(ws, {
    type: 'status',
    connected: true,
    sessionId: session.sessionId,
    marker: IVX_REALTIME_VOICE_MARKER,
    aiConfigured: isIVXAIConfigured(),
    transcriptionConfigured: isTranscriptionConfigured(),
    ttsConfigured: isTTSConfigured(),
  });

  let audioBuffer: Uint8Array[] = [];

  ws.on('message', async (rawData: import('ws').RawData) => {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(rawData.toString()) as Record<string, unknown>;
    } catch {
      sendJSON(ws, { type: 'error', message: 'Invalid JSON message' });
      return;
    }

    const type = String(message.type || '').trim();
    session.lastActivityAt = Date.now();

    // ── Ping/Pong ──
    if (type === 'ping') {
      sendJSON(ws, { type: 'pong', timestamp: Date.now() });
      return;
    }

    // ── Session init ──
    if (type === 'session.init') {
      const voice = String(message.voice || 'nova') as TTSVoice;
      session.voice = voice;
      sendJSON(ws, {
        type: 'session.ready',
        sessionId: session.sessionId,
        voice: session.voice,
        turnCount: session.turns.length,
      });
      return;
    }

    // ── Interrupt (barge-in) ──
    if (type === 'interrupt') {
      if (session.isGenerating && session.abortController) {
        session.abortController.abort();
        session.isGenerating = false;
        session.abortController = null;
      }
      audioBuffer = [];
      sendJSON(ws, { type: 'interrupt.ack', timestamp: Date.now() });
      return;
    }

    // ── Audio chunk (push-to-talk) ──
    if (type === 'audio') {
      const data = String(message.data || '');
      if (!data) {
        sendJSON(ws, { type: 'error', message: 'Audio data required' });
        return;
      }

      // Cancel any ongoing generation (user started talking again)
      if (session.isGenerating && session.abortController) {
        session.abortController.abort();
        session.isGenerating = false;
        session.abortController = null;
      }

      audioBuffer.push(base64ToBytes(data));
      return;
    }

    // ── Audio complete (user released push-to-talk) ──
    if (type === 'audio.end') {
      if (audioBuffer.length === 0) {
        sendJSON(ws, { type: 'error', message: 'No audio received' });
        return;
      }

      // Combine all audio chunks
      const totalLength = audioBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of audioBuffer) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      audioBuffer = [];

      // Process the complete audio
      await processUserAudio(ws, session, combined, String(message.fileName || `voice-${Date.now()}.m4a`), String(message.mimeType || 'audio/m4a'));
      return;
    }

    sendJSON(ws, { type: 'error', message: `Unknown message type: ${type}` });
  });

  ws.on('close', () => {
    if (session.abortController) {
      session.abortController.abort();
    }
    sessions.delete(wsId);
    console.log('[IVX Realtime Voice] Client disconnected', {
      sessionId: session.sessionId,
      totalTurns: session.turns.length,
    });
  });

  ws.on('error', (error: Error) => {
    console.error('[IVX Realtime Voice] WebSocket error', {
      sessionId: session.sessionId,
      error: error.message,
    });
    if (session.abortController) {
      session.abortController.abort();
    }
    sessions.delete(wsId);
  });
}

// ── Process user audio: transcribe → AI → TTS ────────────────────────────────

async function processUserAudio(
  ws: WebSocket,
  session: RealtimeSession,
  audioBytes: Uint8Array,
  fileName: string,
  mimeType: string,
): Promise<void> {
  const startTime = Date.now();

  // Check dependencies
  if (!isTranscriptionConfigured()) {
    sendJSON(ws, { type: 'error', message: 'Transcription (STT) is not configured' });
    return;
  }
  if (!isIVXAIConfigured()) {
    sendJSON(ws, { type: 'error', message: 'AI brain is not configured' });
    return;
  }

  // Step 1: Transcribe
  let transcribedText = '';
  try {
    const result = await transcribeAudioBytes(audioBytes, fileName, mimeType);
    transcribedText = result.text.trim();
    if (!transcribedText) {
      sendJSON(ws, { type: 'error', message: 'Could not transcribe audio — please try again' });
      return;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Transcription failed';
    sendJSON(ws, { type: 'error', message: `Transcription error: ${msg}` });
    return;
  }

  // Send transcript to client immediately
  sendJSON(ws, { type: 'transcript', text: transcribedText, durationMs: Date.now() - startTime });

  // Record user turn
  session.turns.push({ role: 'user', content: transcribedText, timestamp: Date.now() });

  // Step 2: Build conversation context
  const contextTurns = session.turns.slice(-MAX_TURNS_IN_CONTEXT * 2);
  const messages = contextTurns.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  let systemPrompt = REALTIME_SYSTEM_PROMPT;
  if (contextTurns.length > 1) {
    const history = contextTurns
      .slice(0, -1) // Exclude current question
      .map((t) => `${t.role === 'user' ? 'Caller' : 'You'}: ${t.content}`)
      .join('\n');
    systemPrompt += `\n\n--- CONVERSATION HISTORY (so far) ---\n${history}\n--- END HISTORY ---\n\nThe caller just asked a new question. Use the conversation history to maintain continuity.`;
  } else {
    systemPrompt += '\n\nThis is the FIRST question in the conversation. Answer directly and naturally.';
  }

  // Step 3: Stream AI response
  session.isGenerating = true;
  session.abortController = new AbortController();

  let fullText = '';
  let sentenceBuffer = '';
  let ttsSequence = 0;
  const ttsQueue: Promise<void>[] = [];

  try {
    for await (const chunk of streamIVXAIText({
      module: 'realtime-voice' as never,
      system: systemPrompt,
      messages,
      maxOutputTokens: 300,
      abortSignal: session.abortController.signal,
    })) {
      if (chunk.type === 'delta' && chunk.delta) {
        fullText += chunk.delta;
        sentenceBuffer += chunk.delta;

        // Send text delta to client immediately
        sendJSON(ws, { type: 'ai.delta', text: chunk.delta });

        // Check for complete sentences → progressive TTS
        const { sentences, remaining } = extractCompleteSentences(sentenceBuffer);
        if (sentences.length > 0) {
          sentenceBuffer = remaining;
          for (const sentence of sentences) {
            const seq = ttsSequence++;
            // Synthesize TTS for this sentence and send audio chunk
            const ttsPromise = synthesizeAndSend(ws, sentence, session.voice, seq);
            ttsQueue.push(ttsPromise);
          }
        }
      } else if (chunk.type === 'done') {
        fullText = chunk.text ?? fullText;
      } else if (chunk.type === 'error') {
        throw new Error(chunk.error || 'AI stream failed');
      }
    }

    // Synthesize any remaining text (last partial sentence)
    if (sentenceBuffer.trim().length > 0) {
      const seq = ttsSequence++;
      const ttsPromise = synthesizeAndSend(ws, sentenceBuffer.trim(), session.voice, seq);
      ttsQueue.push(ttsPromise);
    }

    // Send AI done signal
    sendJSON(ws, {
      type: 'ai.done',
      fullText,
      durationMs: Date.now() - startTime,
    });

    // Wait for all TTS chunks to finish
    await Promise.allSettled(ttsQueue);

    // Record assistant turn
    session.turns.push({ role: 'assistant', content: fullText, timestamp: Date.now() });

    // Trim turns if exceeding max
    if (session.turns.length > MAX_SESSION_TURNS) {
      session.turns = session.turns.slice(-MAX_SESSION_TURNS);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      // Interrupted by user — not an error
      sendJSON(ws, { type: 'interrupt.ack', reason: 'user_interrupted' });
    } else {
      const msg = err instanceof Error ? err.message : 'AI generation failed';
      sendJSON(ws, { type: 'error', message: `AI error: ${msg}` });
    }
  } finally {
    session.isGenerating = false;
    session.abortController = null;
  }
}

// ── TTS synthesis and send ─────────────────────────────────────────────────────

async function synthesizeAndSend(
  ws: WebSocket,
  text: string,
  voice: TTSVoice,
  sequence: number,
): Promise<void> {
  if (!isTTSConfigured() || !text.trim()) return;

  try {
    const result = await synthesizeSpeech(text, voice);
    if (result.ok && result.audioBase64) {
      sendJSON(ws, {
        type: 'audio',
        data: result.audioBase64,
        sequence,
        format: 'mp3',
        text,
      });
    }
  } catch (err) {
    console.error('[IVX Realtime Voice] TTS error for sentence:', {
      sequence,
      textLength: text.length,
      error: err instanceof Error ? err.message : 'unknown',
    });
  }
}
