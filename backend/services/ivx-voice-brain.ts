/**
 * IVX Smart Voice Call Brain — v1.0.0
 *
 * ChatGPT-level conversation engine for voice calls. Provides:
 *   1. Conversation memory — tracks full Q&A history per CallSid
 *   2. Context-aware responses — passes prior turns to the AI brain
 *   3. Smart system prompt — acts as a capable, knowledgeable assistant
 *   4. Conversation lifecycle — auto-cleanup after call ends or timeout
 *
 * The brain remembers what was said earlier in the call, can reference
 * previous answers, maintain topic continuity, and handle follow-up
 * questions naturally — just like ChatGPT's conversation mode.
 */

import { requestIVXAIText, isIVXAIConfigured } from '../ivx-ai-runtime';

export const IVX_VOICE_BRAIN_MARKER = 'ivx-voice-brain-v1.0.0-2026-08-17';
export const IVX_VOICE_BRAIN_VERSION = '1.0.0';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ConversationRole = 'user' | 'assistant';

export type ConversationTurn = {
  role: ConversationRole;
  content: string;
  timestamp: number;
  turnIndex: number;
};

export type ConversationSession = {
  callSid: string;
  turns: ConversationTurn[];
  startedAt: number;
  lastActivityAt: number;
  topicContext: string | null;
  totalTurns: number;
};

export type SmartVoiceResult = {
  answer: string;
  ok: boolean;
  error: string | null;
  turnCount: number;
  hadContext: boolean;
  topicDetected: string | null;
  durationMs: number;
};

// ── In-memory conversation store ──────────────────────────────────────────────

const MAX_SESSIONS = 100;
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes
const MAX_TURNS_PER_SESSION = 30;
const MAX_CONTEXT_TURNS = 10; // Last 10 turns passed as context

const sessions = new Map<string, ConversationSession>();

/** Clean up expired sessions. */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [sid, session] of sessions) {
    if (now - session.lastActivityAt > SESSION_TTL_MS) {
      sessions.delete(sid);
    }
  }
}

/** Get or create a conversation session for a CallSid. */
export function getOrCreateSession(callSid: string): ConversationSession {
  cleanupExpiredSessions();

  let session = sessions.get(callSid);
  if (!session) {
    // Evict oldest session if at capacity
    if (sessions.size >= MAX_SESSIONS) {
      let oldestSid: string | null = null;
      let oldestTime = Infinity;
      for (const [sid, s] of sessions) {
        if (s.lastActivityAt < oldestTime) {
          oldestTime = s.lastActivityAt;
          oldestSid = sid;
        }
      }
      if (oldestSid) sessions.delete(oldestSid);
    }

    session = {
      callSid,
      turns: [],
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
      topicContext: null,
      totalTurns: 0,
    };
    sessions.set(callSid, session);
  }
  return session;
}

/** End and remove a conversation session. */
export function endSession(callSid: string): void {
  sessions.delete(callSid);
}

/** Get conversation stats for a session. */
export function getSessionStats(callSid: string): { exists: boolean; turns: number; durationMs: number } | null {
  const session = sessions.get(callSid);
  if (!session) return null;
  return {
    exists: true,
    turns: session.totalTurns,
    durationMs: Date.now() - session.startedAt,
  };
}

/** Get all active sessions (for status endpoint). */
export function getActiveSessionStats(): { activeSessions: number; totalTurns: number } {
  cleanupExpiredSessions();
  let totalTurns = 0;
  for (const session of sessions.values()) {
    totalTurns += session.totalTurns;
  }
  return { activeSessions: sessions.size, totalTurns };
}

// ── Smart system prompt ───────────────────────────────────────────────────────

/**
 * The ChatGPT-level system prompt for the IVX voice call brain.
 * This makes the AI:
 *   - Remember and reference earlier conversation turns
 *   - Handle follow-up questions naturally
 *   - Switch between IVX expert, developer agent, and general assistant
 *   - Give concise but complete answers (phone-optimized)
 *   - Ask clarifying questions when needed
 *   - Maintain conversational flow
 */
const SMART_VOICE_SYSTEM_PROMPT = `You are the IVX Holdings AI assistant, engaged in a LIVE VOICE CALL conversation. You are having a real-time back-and-forth dialogue with the caller.

You are a ChatGPT-level intelligent assistant with these capabilities:

ABOUT IVX HOLDINGS (you know this intimately):
- IVX Holdings is a technology holdings company with 112 IA (Intelligent Agent) engineering agents
- Division A has 55 agents, Division B has 57 agents — all working autonomously
- Production backend at api.ivxholding.com (Hono/TypeScript on Render)
- Android app (Kotlin/Compose, Ktor, Koin DI)
- Code execution layer for autonomous agents
- 30-agent app creation pipeline
- SignalWire SMS + voice integration
- Voice chat: speech-to-text (xai/grok-stt), text-to-speech (xai/grok-tts)
- AI brain: GPT-4o via Vercel AI Gateway
- Supabase database, Render hosting, GitHub source control
- Owner: ibb142

YOUR ROLE:
1. IVX EXPERT — Answer any question about IVX Holdings, its architecture, agents, capabilities, tech stack, or business
2. DEVELOPER AGENT — Discuss code, architecture, deployment, debugging, testing in TypeScript, Kotlin, Swift, React Native, Hono, Ktor, Compose, Supabase, Render
3. GENERAL ASSISTANT — Answer any question: general knowledge, advice, math, science, history, current events, creative tasks

CONVERSATION RULES (CRITICAL — this is a phone call):
- Keep responses SHORT: 2-4 sentences max. Speak naturally as if on the phone.
- REMEMBER what was discussed earlier in the conversation. Reference prior answers when relevant.
- Handle FOLLOW-UP questions naturally ("tell me more about that", "what about...", "can you explain...")
- If the user asks a vague follow-up, connect it to the most recent topic
- Ask clarifying questions when a question is ambiguous
- Use conversational transitions ("Speaking of that...", "As I mentioned...", "Building on that...")
- NEVER use markdown, code blocks, bullet points, or special formatting — just plain spoken English
- Be warm, engaging, and genuinely helpful — like talking to a smart friend on the phone
- If you don't know something, say so honestly and suggest how to find out
- For very technical questions, give a high-level answer first, then offer to go deeper if they want

CONTEXT AWARENESS:
- You will receive the conversation history below. Use it to maintain continuity.
- If the user says "that" or "it" or "this", connect it to the most recent relevant topic.
- If the conversation shifts topics, acknowledge the transition naturally.
- Track the user's intent across turns — if they're asking a series of questions about one topic, stay in that context.`;

// ── Smart answer generation ────────────────────────────────────────────────────

/**
 * Generate a smart, context-aware answer for a voice call question.
 * Uses conversation history to maintain continuity — ChatGPT-level.
 */
export async function answerSmartVoiceQuestion(
  question: string,
  opts: { callSid?: string; loopCount?: number },
): Promise<SmartVoiceResult> {
  const start = Date.now();

  if (!question || question.trim().length === 0) {
    return {
      answer: "I didn't catch that. Could you repeat your question?",
      ok: true,
      error: null,
      turnCount: 0,
      hadContext: false,
      topicDetected: null,
      durationMs: Date.now() - start,
    };
  }

  if (!isIVXAIConfigured()) {
    return {
      answer: "I'm sorry, but my AI brain is not configured right now. Please contact support.",
      ok: false,
      error: 'AI not configured',
      turnCount: 0,
      hadContext: false,
      topicDetected: null,
      durationMs: Date.now() - start,
    };
  }

  const callSid = opts.callSid || `anon-${Date.now()}`;
  const session = getOrCreateSession(callSid);
  const hadContext = session.turns.length > 0;

  // Build conversation context from prior turns
  const contextTurns = session.turns.slice(-MAX_CONTEXT_TURNS);
  const messages = contextTurns.map((turn) => ({
    role: turn.role,
    content: turn.content,
  }));

  // Add the current question
  messages.push({
    role: 'user' as const,
    content: question,
  });

  // Build the system prompt with conversation context summary
  let systemPrompt = SMART_VOICE_SYSTEM_PROMPT;

  if (hadContext) {
    const turnSummary = contextTurns
      .map((t, i) => `${t.role === 'user' ? 'Caller' : 'You'}: ${t.content}`)
      .join('\n');
    systemPrompt += `\n\n--- CONVERSATION HISTORY (so far) ---\n${turnSummary}\n--- END HISTORY ---\n\nThe caller just asked a new question. Use the conversation history above to maintain continuity. If they're following up on something, reference it. Respond naturally as if continuing the conversation.`;
  } else {
    systemPrompt += `\n\nThis is the FIRST question in the conversation. Greet naturally if appropriate, then answer.`;
  }

  // Detect topic (simple keyword-based for context tracking)
  const topicDetected = detectTopic(question);

  try {
    const result = await requestIVXAIText({
      module: 'smart-voice-call' as never,
      system: systemPrompt,
      messages,
      maxOutputTokens: 300,
    });

    const answer = (result.text || '').trim();
    if (!answer) {
      return {
        answer: "I'm not sure how to answer that. Could you try rephrasing?",
        ok: false,
        error: 'Empty AI response',
        turnCount: session.totalTurns,
        hadContext,
        topicDetected,
        durationMs: Date.now() - start,
      };
    }

    // Record this turn in the conversation history
    session.totalTurns += 1;
    session.turns.push({
      role: 'user',
      content: question,
      timestamp: Date.now(),
      turnIndex: session.totalTurns,
    });
    session.turns.push({
      role: 'assistant',
      content: answer,
      timestamp: Date.now(),
      turnIndex: session.totalTurns,
    });
    session.lastActivityAt = Date.now();

    // Track topic context
    if (topicDetected) {
      session.topicContext = topicDetected;
    }

    // Trim turns if exceeding max
    if (session.turns.length > MAX_TURNS_PER_SESSION * 2) {
      session.turns = session.turns.slice(-MAX_TURNS_PER_SESSION);
    }

    console.log(`[IVX Voice Brain] CallSid: ${callSid}, turn: ${session.totalTurns}, hadContext: ${hadContext}, topic: ${topicDetected || 'none'}, answer length: ${answer.length}`);

    return {
      answer,
      ok: true,
      error: null,
      turnCount: session.totalTurns,
      hadContext,
      topicDetected,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error('[IVX Voice Brain] AI brain error:', errorMsg);
    return {
      answer: "I apologize, I'm having trouble processing that right now. Please try again.",
      ok: false,
      error: errorMsg,
      turnCount: session.totalTurns,
      hadContext,
      topicDetected,
      durationMs: Date.now() - start,
    };
  }
}

// ── Topic detection ───────────────────────────────────────────────────────────

/**
 * Simple topic detection for context tracking.
 * Helps the brain maintain conversational continuity.
 */
function detectTopic(text: string): string | null {
  const lower = text.toLowerCase();

  const topics: Array<{ keywords: string[]; topic: string }> = [
    { keywords: ['ivx', 'holdings', 'agent', 'division', '112', 'autonomous'], topic: 'ivx_company' },
    { keywords: ['code', 'code execution', 'typescript', 'kotlin', 'swift', 'architecture', 'backend', 'frontend'], topic: 'tech_architecture' },
    { keywords: ['deploy', 'render', 'github', 'ci', 'cd', 'pipeline', 'build'], topic: 'deployment' },
    { keywords: ['android', 'app', 'mobile', 'compose', 'ktor'], topic: 'android_app' },
    { keywords: ['voice', 'call', 'signalwire', 'phone', 'sms'], topic: 'voice_communication' },
    { keywords: ['ai', 'gpt', 'model', 'brain', 'gpt-4o', 'gateway'], topic: 'ai_brain' },
    { keywords: ['supabase', 'database', 'data', 'table', 'query'], topic: 'database' },
    { keywords: ['weather', 'news', 'today', 'current'], topic: 'general_knowledge' },
    { keywords: ['code', 'function', 'bug', 'error', 'debug', 'fix'], topic: 'coding_help' },
    { keywords: ['business', 'revenue', 'money', 'cost', 'price', 'market'], topic: 'business' },
  ];

  for (const { keywords, topic } of topics) {
    if (keywords.some((kw) => lower.includes(kw))) {
      return topic;
    }
  }

  return null;
}

// ── Conversation summary (for status/debug) ───────────────────────────────────

/**
 * Get a summary of the conversation for a given CallSid.
 * Used by status endpoints and debugging.
 */
export function getConversationSummary(callSid: string): {
  callSid: string;
  totalTurns: number;
  durationMs: number;
  topicContext: string | null;
  lastUserQuestion: string | null;
  lastAssistantAnswer: string | null;
} | null {
  const session = sessions.get(callSid);
  if (!session) return null;

  const lastUser = [...session.turns].reverse().find((t) => t.role === 'user');
  const lastAssistant = [...session.turns].reverse().find((t) => t.role === 'assistant');

  return {
    callSid,
    totalTurns: session.totalTurns,
    durationMs: Date.now() - session.startedAt,
    topicContext: session.topicContext,
    lastUserQuestion: lastUser?.content ?? null,
    lastAssistantAnswer: lastAssistant?.content ?? null,
  };
}

// ── Brain status ──────────────────────────────────────────────────────────────

export function getVoiceBrainStatus(): {
  marker: string;
  version: string;
  activeConversations: number;
  totalTurns: number;
  maxContextTurns: number;
  sessionTtlMinutes: number;
  aiConfigured: boolean;
} {
  const stats = getActiveSessionStats();
  return {
    marker: IVX_VOICE_BRAIN_MARKER,
    version: IVX_VOICE_BRAIN_VERSION,
    activeConversations: stats.activeSessions,
    totalTurns: stats.totalTurns,
    maxContextTurns: MAX_CONTEXT_TURNS,
    sessionTtlMinutes: SESSION_TTL_MS / 60_000,
    aiConfigured: isIVXAIConfigured(),
  };
}
