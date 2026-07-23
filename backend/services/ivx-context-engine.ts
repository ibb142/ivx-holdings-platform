/**
 * IVX Context Engine — Phase 2
 *
 * Constructs a structured context package before every AI answer.
 * Pulls from: user, screen, conversation, entities, memory, retrieved sources,
 * production state, permissions, open tasks, and uncertainties.
 *
 * Token budgeting ensures irrelevant history is not sent to the model.
 */

import { getProviderHealth } from '../ivx-ai-runtime';

// ─── Types ────────────────────────────────────────────────────────

export type IVXContextUser = {
  id: string | null;
  email: string | null;
  role: 'owner' | 'member' | 'anonymous';
  isAuthenticated: boolean;
};

export type IVXContextScreen = {
  route: string | null;
  tab: string | null;
  selectedEntityId: string | null;
  selectedEntityType: string | null;
};

export type IVXContextConversation = {
  messageId: string | null;
  summary: string | null;
  recentMessages: IVXContextMessage[];
  messageCount: number;
};

export type IVXContextMessage = {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  truncated: boolean;
};

export type IVXContextEntity = {
  type: 'deal' | 'investor' | 'buyer' | 'property' | 'member' | 'task';
  id: string;
  name: string;
  data: Record<string, unknown>;
};

export type IVXContextMemory = {
  id: string;
  category: string;
  content: string;
  confidence: number;
  verified: boolean;
  source: string;
};

export type IVXContextRetrievedSource = {
  source: string;
  content: string;
  relevanceScore: number;
  url: string | null;
  freshness: 'live' | 'cached' | 'stale';
};

export type IVXContextProduction = {
  githubSha: string | null;
  runtimeSha: string | null;
  shaMatch: boolean | null;
  healthStatus: string | null;
  bootTime: string | null;
  apkVersion: string | null;
};

export type IVXContextPermissions = {
  canWrite: boolean;
  canDeploy: boolean;
  canCommit: boolean;
  canExecuteAutonomous: boolean;
  approvalRequired: boolean;
  approvalPhrase: string | null;
};

export type IVXContextOpenTask = {
  taskId: string;
  description: string;
  stage: string;
  status: string;
  blocker: string | null;
};

export type IVXContextUncertainty = {
  description: string;
  status: 'UNKNOWN' | 'NOT_TESTED' | 'BLOCKED' | 'CONFLICTING';
  detail: string;
};

export type IVXContextPackage = {
  user: IVXContextUser;
  screen: IVXContextScreen;
  conversation: IVXContextConversation;
  entities: IVXContextEntity[];
  memory: IVXContextMemory[];
  retrievedSources: IVXContextRetrievedSource[];
  production: IVXContextProduction;
  permissions: IVXContextPermissions;
  openTasks: IVXContextOpenTask[];
  uncertainties: IVXContextUncertainty[];
  tokenBudget: IVXTokenBudget;
  builtAt: string;
};

export type IVXTokenBudget = {
  totalBudget: number;
  allocated: number;
  remaining: number;
  allocations: {
    conversation: number;
    memory: number;
    retrievedSources: number;
    production: number;
    entities: number;
    systemPrompt: number;
  };
};

// ─── Token Estimation ─────────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ─── Token Budgeting ──────────────────────────────────────────────

const DEFAULT_TOKEN_BUDGET = 12000;

function allocateTokenBudget(
  totalBudget: number,
  context: {
    messageCount: number;
    memoryCount: number;
    retrievedCount: number;
    entityCount: number;
  },
): IVXTokenBudget {
  // Reserve system prompt
  const systemPrompt = 500;
  const remaining = totalBudget - systemPrompt;

  // Weighted allocation
  const conversationWeight = Math.min(0.4, 0.2 + context.messageCount * 0.03);
  const memoryWeight = Math.min(0.2, 0.05 + context.memoryCount * 0.02);
  const retrievedWeight = Math.min(0.2, 0.05 + context.retrievedCount * 0.02);
  const entityWeight = Math.min(0.15, 0.05 + context.entityCount * 0.02);
  const productionWeight = 0.1;

  const sum = conversationWeight + memoryWeight + retrievedWeight + entityWeight + productionWeight;

  return {
    totalBudget,
    allocated: systemPrompt,
    remaining,
    allocations: {
      conversation: Math.floor(remaining * (conversationWeight / sum)),
      memory: Math.floor(remaining * (memoryWeight / sum)),
      retrievedSources: Math.floor(remaining * (retrievedWeight / sum)),
      production: Math.floor(remaining * (productionWeight / sum)),
      entities: Math.floor(remaining * (entityWeight / sum)),
      systemPrompt,
    },
  };
}

// ─── Context Truncation ───────────────────────────────────────────

function truncateMessages(
  messages: IVXContextMessage[],
  tokenBudget: number,
): IVXContextMessage[] {
  const result: IVXContextMessage[] = [];
  let usedTokens = 0;

  // Prioritize most recent messages
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tokens = estimateTokens(msg.content);
    if (usedTokens + tokens > tokenBudget) {
      // Truncate this message
      const remaining = tokenBudget - usedTokens;
      if (remaining > 50) {
        const charLimit = remaining * 4;
        result.unshift({
          ...msg,
          content: msg.content.slice(0, charLimit) + '…[truncated]',
          truncated: true,
        });
      }
      break;
    }
    result.unshift(msg);
    usedTokens += tokens;
  }

  return result;
}

function truncateMemory(
  memory: IVXContextMemory[],
  tokenBudget: number,
): IVXContextMemory[] {
  const result: IVXContextMemory[] = [];
  let usedTokens = 0;

  // Sort by confidence (highest first) then by verified
  const sorted = [...memory].sort((a, b) => {
    if (a.verified !== b.verified) return a.verified ? -1 : 1;
    return b.confidence - a.confidence;
  });

  for (const m of sorted) {
    const tokens = estimateTokens(m.content);
    if (usedTokens + tokens > tokenBudget) break;
    result.push(m);
    usedTokens += tokens;
  }

  return result;
}

function truncateRetrievedSources(
  sources: IVXContextRetrievedSource[],
  tokenBudget: number,
): IVXContextRetrievedSource[] {
  const result: IVXContextRetrievedSource[] = [];
  let usedTokens = 0;

  const sorted = [...sources].sort((a, b) => b.relevanceScore - a.relevanceScore);

  for (const s of sorted) {
    const tokens = estimateTokens(s.content);
    if (usedTokens + tokens > tokenBudget) {
      const remaining = tokenBudget - usedTokens;
      if (remaining > 50) {
        const charLimit = remaining * 4;
        result.push({
          ...s,
          content: s.content.slice(0, charLimit) + '…[truncated]',
        });
      }
      break;
    }
    result.push(s);
    usedTokens += tokens;
  }

  return result;
}

// ─── Context Builder ──────────────────────────────────────────────

export type IVXContextBuilderInput = {
  user?: Partial<IVXContextUser> | null;
  screen?: Partial<IVXContextScreen> | null;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string; timestamp?: string }> | null;
  conversationSummary?: string | null;
  entities?: IVXContextEntity[] | null;
  memory?: IVXContextMemory[] | null;
  retrievedSources?: IVXContextRetrievedSource[] | null;
  production?: Partial<IVXContextProduction> | null;
  permissions?: Partial<IVXContextPermissions> | null;
  openTasks?: IVXContextOpenTask[] | null;
  uncertainties?: IVXContextUncertainty[] | null;
  tokenBudget?: number | null;
};

export function buildContextPackage(input: IVXContextBuilderInput): IVXContextPackage {
  const messageCount = input.conversationHistory?.length || 0;
  const memoryCount = input.memory?.length || 0;
  const retrievedCount = input.retrievedSources?.length || 0;
  const entityCount = input.entities?.length || 0;

  const tokenBudget = allocateTokenBudget(
    input.tokenBudget || DEFAULT_TOKEN_BUDGET,
    { messageCount, memoryCount, retrievedCount, entityCount },
  );

  // Build conversation messages with truncation
  const rawMessages: IVXContextMessage[] = (input.conversationHistory || []).map((m) => ({
    role: m.role,
    content: m.content,
    timestamp: m.timestamp || new Date().toISOString(),
    truncated: false,
  }));
  const truncatedMessages = truncateMessages(rawMessages, tokenBudget.allocations.conversation);

  // Truncate memory and sources
  const truncatedMemory = truncateMemory(input.memory || [], tokenBudget.allocations.memory);
  const truncatedSources = truncateRetrievedSources(
    input.retrievedSources || [],
    tokenBudget.allocations.retrievedSources,
  );

  return {
    user: {
      id: input.user?.id || null,
      email: input.user?.email || null,
      role: input.user?.role || 'anonymous',
      isAuthenticated: input.user?.isAuthenticated || false,
    },
    screen: {
      route: input.screen?.route || null,
      tab: input.screen?.tab || null,
      selectedEntityId: input.screen?.selectedEntityId || null,
      selectedEntityType: input.screen?.selectedEntityType || null,
    },
    conversation: {
      messageId: null,
      summary: input.conversationSummary || null,
      recentMessages: truncatedMessages,
      messageCount,
    },
    entities: (input.entities || []).slice(0, 10),
    memory: truncatedMemory,
    retrievedSources: truncatedSources,
    production: {
      githubSha: input.production?.githubSha || null,
      runtimeSha: input.production?.runtimeSha || null,
      shaMatch: input.production?.shaMatch || null,
      healthStatus: input.production?.healthStatus || null,
      bootTime: input.production?.bootTime || null,
      apkVersion: input.production?.apkVersion || null,
    },
    permissions: {
      canWrite: input.permissions?.canWrite || false,
      canDeploy: input.permissions?.canDeploy || false,
      canCommit: input.permissions?.canCommit || false,
      canExecuteAutonomous: input.permissions?.canExecuteAutonomous || false,
      approvalRequired: input.permissions?.approvalRequired !== false,
      approvalPhrase: input.permissions?.approvalPhrase || null,
    },
    openTasks: (input.openTasks || []).slice(0, 5),
    uncertainties: input.uncertainties || [],
    tokenBudget,
    builtAt: new Date().toISOString(),
  };
}

// ─── Context Serialization ────────────────────────────────────────

/**
 * Serialize the context package into a model-readable string.
 * Only includes non-null fields to save tokens.
 */
export function serializeContextPackage(ctx: IVXContextPackage): string {
  const parts: string[] = [];

  // User context
  if (ctx.user.isAuthenticated) {
    parts.push(`[USER] role=${ctx.user.role}${ctx.user.email ? `, email=${ctx.user.email}` : ''}`);
  } else {
    parts.push('[USER] anonymous');
  }

  // Screen context
  if (ctx.screen.route) {
    parts.push(`[SCREEN] route=${ctx.screen.route}${ctx.screen.selectedEntityId ? `, selected=${ctx.screen.selectedEntityType}:${ctx.screen.selectedEntityId}` : ''}`);
  }

  // Conversation summary
  if (ctx.conversation.summary) {
    parts.push(`[CONVERSATION_SUMMARY] ${ctx.conversation.summary}`);
  }

  // Recent messages (just the last few, truncated)
  if (ctx.conversation.recentMessages.length > 0) {
    const msgs = ctx.conversation.recentMessages
      .slice(-4)
      .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
      .join('\n');
    parts.push(`[RECENT_MESSAGES]\n${msgs}`);
  }

  // Entities
  if (ctx.entities.length > 0) {
    const entityStr = ctx.entities
      .map((e) => `${e.type}:${e.id} (${e.name})`)
      .join(', ');
    parts.push(`[ENTITIES] ${entityStr}`);
  }

  // Memory
  if (ctx.memory.length > 0) {
    const memStr = ctx.memory
      .map((m) => `[${m.verified ? 'VERIFIED' : 'UNVERIFIED'}] ${m.content}`)
      .join('\n');
    parts.push(`[MEMORY]\n${memStr}`);
  }

  // Retrieved sources
  if (ctx.retrievedSources.length > 0) {
    const srcStr = ctx.retrievedSources
      .map((s) => `(${s.source}, ${s.freshness}) ${s.content.slice(0, 200)}`)
      .join('\n');
    parts.push(`[RETRIEVED_SOURCES]\n${srcStr}`);
  }

  // Production state
  if (ctx.production.runtimeSha) {
    parts.push(`[PRODUCTION] runtime=${ctx.production.runtimeSha}, health=${ctx.production.healthStatus || 'unknown'}, shaMatch=${ctx.production.shaMatch}`);
  }

  // Open tasks
  if (ctx.openTasks.length > 0) {
    const taskStr = ctx.openTasks
      .map((t) => `${t.taskId}: ${t.description} (${t.stage})${t.blocker ? ` [BLOCKED: ${t.blocker}]` : ''}`)
      .join(', ');
    parts.push(`[OPEN_TASKS] ${taskStr}`);
  }

  // Uncertainties
  if (ctx.uncertainties.length > 0) {
    const uncStr = ctx.uncertainties
      .map((u) => `${u.status}: ${u.description}`)
      .join(', ');
    parts.push(`[UNCERTAINTIES] ${uncStr}`);
  }

  return parts.join('\n\n');
}

export const IVX_CONTEXT_ENGINE_MARKER = 'ivx-context-engine-2026-07-23-v1';
