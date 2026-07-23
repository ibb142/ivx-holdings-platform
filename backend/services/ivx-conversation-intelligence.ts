/**
 * IVX Conversation Intelligence — Phase 12
 *
 * Conversation summaries, entity resolution, reference resolution,
 * topic tracking, unresolved-question tracking, task-to-message linking,
 * latest-message prioritization, duplicate-answer suppression,
 * response continuity after restart.
 */

import { randomUUID } from 'crypto';

// ─── Types ────────────────────────────────────────────────────────

export type IVXConversationEntity = {
  id: string;
  type: 'deal' | 'investor' | 'buyer' | 'property' | 'task' | 'file' | 'screen';
  name: string;
  mentionedAt: string;
  resolvedFrom: 'explicit' | 'reference' | 'context';
};

export type IVXConversationTopic = {
  id: string;
  topic: string;
  startedAt: string;
  lastActiveAt: string;
  messageCount: number;
  resolved: boolean;
};

export type IVXUnresolvedQuestion = {
  id: string;
  question: string;
  askedAt: string;
  resolvedAt: string | null;
  resolution: string | null;
};

export type IVXConversationSummary = {
  summaryId: string;
  summary: string;
  keyEntities: IVXConversationEntity[];
  topics: IVXConversationTopic[];
  unresolvedQuestions: IVXUnresolvedQuestion[];
  messageRange: { start: number; end: number };
  createdAt: string;
  language: string;
};

export type IVXConversationState = {
  conversationId: string;
  messages: IVXConversationMessageRecord[];
  entities: Map<string, IVXConversationEntity>;
  topics: IVXConversationTopic[];
  unresolvedQuestions: IVXUnresolvedQuestion[];
  currentSummary: IVXConversationSummary | null;
  lastAnswer: string | null;
  language: string;
  taskLinks: Map<string, string>; // messageId → taskId
};

export type IVXConversationMessageRecord = {
  messageId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  taskId: string | null;
};

// ─── Entity Resolution ────────────────────────────────────────────

const ENTITY_PATTERNS: Array<{ type: IVXConversationEntity['type']; pattern: RegExp }> = [
  { type: 'deal', pattern: /\b(casa rosario|perez residence|jacksonville|jv-\d+|deal\s+\w+)/gi },
  { type: 'investor', pattern: /\b(investor\s+\w+|accredited\s+\w+)/gi },
  { type: 'property', pattern: /\b(property\s+\w+|parcel\s+\w+)/gi },
  { type: 'file', pattern: /\b([\w-]+\.(ts|tsx|js|json|sql|yml|yaml))\b/gi },
  { type: 'screen', pattern: /\b(home|market|portfolio|crm|chat|videos|reels|settings)\s+(screen|tab|page)\b/gi },
];

export function extractEntities(message: string): IVXConversationEntity[] {
  const entities: IVXConversationEntity[] = [];
  const now = new Date().toISOString();

  for (const { type, pattern } of ENTITY_PATTERNS) {
    const matches = message.matchAll(pattern);
    for (const match of matches) {
      const name = match[0].trim();
      if (name.length > 2) {
        entities.push({
          id: randomUUID(),
          type,
          name,
          mentionedAt: now,
          resolvedFrom: 'explicit',
        });
      }
    }
  }

  return entities;
}

// ─── Reference Resolution ─────────────────────────────────────────

const REFERENCE_PATTERNS = [
  { pattern: /\b(fix this|fix it|fix that)\b/i, resolvesTo: 'latest_error_or_screenshot' },
  { pattern: /\b(what is next|what'?s next|continue)\b/i, resolvesTo: 'current_ledger' },
  { pattern: /\b(same as before|same as above|like before)\b/i, resolvesTo: 'previous_requirement' },
  { pattern: /\b(this one|that one|it)\b/i, resolvesTo: 'latest_entity' },
  { pattern: /\b(the above|mentioned earlier)\b/i, resolvesTo: 'previous_context' },
];

export function detectReference(message: string): { hasReference: boolean; resolvesTo: string; pattern: string } {
  for (const { pattern, resolvesTo } of REFERENCE_PATTERNS) {
    if (pattern.test(message)) {
      return { hasReference: true, resolvesTo, pattern: pattern.source };
    }
  }
  return { hasReference: false, resolvesTo: '', pattern: '' };
}

/**
 * Resolve a reference to actual context.
 * "fix this" → the latest error/screenshot mentioned in conversation.
 * "what is next?" → the current active task ledger.
 * "same as before" → the previous requirement.
 */
export function resolveReference(
  reference: { resolvesTo: string },
  state: IVXConversationState,
): { resolved: boolean; context: string; source: string } {
  switch (reference.resolvesTo) {
    case 'latest_error_or_screenshot': {
      // Find the most recent message mentioning an error or screenshot
      for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        if (/\b(error|crash|fail|screenshot|broken|503|500|timeout)\b/i.test(msg.content)) {
          return {
            resolved: true,
            context: msg.content.slice(0, 500),
            source: `message ${msg.messageId} (${msg.timestamp})`,
          };
        }
      }
      return { resolved: false, context: '', source: 'no previous error found' };
    }

    case 'current_ledger': {
      // Find the most recent task
      const taskIds = [...state.taskLinks.values()];
      if (taskIds.length > 0) {
        const latestTaskId = taskIds[taskIds.length - 1];
        return {
          resolved: true,
          context: `Current task: ${latestTaskId}`,
          source: 'task ledger',
        };
      }
      return { resolved: false, context: 'No active task', source: 'no task found' };
    }

    case 'previous_requirement': {
      // Find the most recent user message before the current one
      const userMessages = state.messages.filter((m) => m.role === 'user');
      if (userMessages.length >= 2) {
        const prevMessage = userMessages[userMessages.length - 2];
        return {
          resolved: true,
          context: prevMessage.content.slice(0, 500),
          source: `message ${prevMessage.messageId}`,
        };
      }
      return { resolved: false, context: '', source: 'no previous requirement' };
    }

    case 'latest_entity': {
      // Find the most recently mentioned entity
      const entities = [...state.entities.values()];
      if (entities.length > 0) {
        const latest = entities[entities.length - 1];
        return {
          resolved: true,
          context: `${latest.type}: ${latest.name}`,
          source: 'entity registry',
        };
      }
      return { resolved: false, context: '', source: 'no entity found' };
    }

    default:
      return { resolved: false, context: '', source: 'unrecognized reference' };
  }
}

// ─── Topic Tracking ───────────────────────────────────────────────

export function detectTopic(message: string): string {
  const text = message.toLowerCase();

  if (/\b(registr|signup|sign.up|account|member)\b/.test(text)) return 'registration';
  if (/\b(code|bug|fix|debug|crash|error|stack trace)\b/.test(text)) return 'development';
  if (/\b(login|signin|sign.in|auth|password|session)\b/.test(text)) return 'authentication';
  if (/\b(deal|jv|investor|roi|capital)\b/.test(text)) return 'deals';
  if (/\b(deploy|render|github|commit|push)\b/.test(text)) return 'deployment';
  if (/\b(design|brand|logo|color|theme)\b/.test(text)) return 'branding';
  if (/\b(apk|android|mobile|app)\b/.test(text)) return 'mobile';
  if (/\b(landing|website|cloudfront|s3)\b/.test(text)) return 'landing';
  if (/\b(database|supabase|sql|migration|schema)\b/.test(text)) return 'database';
  if (/\b(test|qa|verify|proof)\b/.test(text)) return 'testing';
  if (/\b(security|vulnerab|audit|rls)\b/.test(text)) return 'security';

  return 'general';
}

// ─── Conversation Summary Generation ──────────────────────────────

export function generateConversationSummary(
  state: IVXConversationState,
  messageRange?: { start: number; end: number },
): IVXConversationSummary {
  const range = messageRange || { start: 0, end: state.messages.length };
  const messagesInRange = state.messages.slice(range.start, range.end);

  // Build a simple summary from user messages
  const userMessages = messagesInRange.filter((m) => m.role === 'user');
  const topics = [...new Set(userMessages.map((m) => detectTopic(m.content)))];
  const summaryText = `Conversation covered: ${topics.join(', ')}. ${userMessages.length} owner messages, ${messagesInRange.length - userMessages.length} responses.`;

  return {
    summaryId: randomUUID(),
    summary: summaryText,
    keyEntities: [...state.entities.values()].slice(-5),
    topics: state.topics,
    unresolvedQuestions: state.unresolvedQuestions.filter((q) => !q.resolvedAt),
    messageRange: range,
    createdAt: new Date().toISOString(),
    language: state.language,
  };
}

// ─── Language Detection ───────────────────────────────────────────

export function detectLanguage(message: string): string {
  const text = message.toLowerCase();
  if (/(?:qué|cómo|dónde|cuál|por qué|cuando|quién|hola|gracias|buenos|buenas|español|qué pasa)/.test(text)) return 'es';
  if (/\b(what|how|where|why|when|who|hello|thanks|good)\b/.test(text)) return 'en';
  return 'en';
}

// ─── Conversation State Management ────────────────────────────────

export function createConversationState(conversationId: string): IVXConversationState {
  return {
    conversationId,
    messages: [],
    entities: new Map(),
    topics: [],
    unresolvedQuestions: [],
    currentSummary: null,
    lastAnswer: null,
    language: 'en',
    taskLinks: new Map(),
  };
}

export function addMessageToConversation(
  state: IVXConversationState,
  message: { role: 'user' | 'assistant'; content: string; taskId?: string },
): IVXConversationState {
  const messageId = randomUUID();
  const now = new Date().toISOString();

  const record: IVXConversationMessageRecord = {
    messageId,
    role: message.role,
    content: message.content,
    timestamp: now,
    taskId: message.taskId || null,
  };

  const messages = [...state.messages, record];

  // Extract entities from user messages
  let entities = state.entities;
  if (message.role === 'user') {
    const newEntities = extractEntities(message.content);
    entities = new Map(state.entities);
    for (const entity of newEntities) {
      entities.set(entity.id, entity);
    }
  }

  // Detect reference and resolve
  if (message.role === 'user') {
    const ref = detectReference(message.content);
    if (ref.hasReference) {
      const resolved = resolveReference(ref, state);
      if (resolved.resolved) {
        // Add resolved context as an entity
        const entity: IVXConversationEntity = {
          id: randomUUID(),
          type: 'task',
          name: resolved.context.slice(0, 100),
          mentionedAt: now,
          resolvedFrom: 'reference',
        };
        entities.set(entity.id, entity);
      }
    }
  }

  // Track topic
  const topicName = detectTopic(message.content);
  const existingTopic = state.topics.find((t) => t.topic === topicName && !t.resolved);
  let topics: IVXConversationTopic[];
  if (existingTopic) {
    topics = state.topics.map((t) =>
      t.id === existingTopic.id
        ? { ...t, lastActiveAt: now, messageCount: t.messageCount + 1 }
        : t,
    );
  } else {
    topics = [...state.topics, {
      id: randomUUID(),
      topic: topicName,
      startedAt: now,
      lastActiveAt: now,
      messageCount: 1,
      resolved: false,
    }];
  }

  // Update language
  const language = message.role === 'user' ? detectLanguage(message.content) : state.language;

  // Update last answer
  const lastAnswer = message.role === 'assistant' ? message.content : state.lastAnswer;

  // Link task
  const taskLinks = new Map(state.taskLinks);
  if (message.taskId) {
    taskLinks.set(messageId, message.taskId);
  }

  return {
    ...state,
    messages,
    entities,
    topics,
    language,
    lastAnswer,
    taskLinks,
  };
}

export const IVX_CONVERSATION_INTELLIGENCE_MARKER = 'ivx-conversation-intelligence-2026-07-23-v1';
