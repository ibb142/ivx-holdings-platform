import { IVX_OWNER_AI_PROFILE } from '@/constants/ivx-owner-ai';
import { getIVXOwnerAIConfigAudit } from '@/lib/ivx-supabase-client';
import { isDevTestModeEnabled } from '@/lib/dev-test-mode';
import {
  getIVXOwnerAIErrorDiagnostics,
  ivxAIRequestService,
  sanitizeOwnerAIVisibleText,
  type IVXOwnerAIProbeResult,
} from '@/src/modules/ivx-owner-ai/services/ivxAIRequestService';
import {
  cancelInFlightAIRequest,
  executeReliably,
  type ReliabilityOptions,
  type ReliabilityTrace,
} from './aiReliability';
import { resolveChatAIHealthFromProbe } from './aiProbePolicy';
import type {
  ChatMessage,
  ChatRoomRuntimeSignals,
  ServiceRuntimeHealth,
} from '../types/chat';
import type { IVXOwnerAIToolOutput } from '@/shared/ivx';

type AIReplyResult = {
  answer: string;
  requestId: string;
  conversationId: string;
  model: string;
  source: 'remote_api' | 'local_app_brain' | 'provider_fallback' | 'local_runtime' | 'unknown';
  endpoint?: string;
  deploymentMarker?: string;
  selectedTool?: string | null;
  toolOutputs?: IVXOwnerAIToolOutput[];
  reliabilityTrace?: ReliabilityTrace;
};

export type RequestAIReplyOptions = ReliabilityOptions;

type OwnerCommandResult = {
  command: string;
  args: string;
  response: string;
  handled: boolean;
};

type KnowledgeQueryResult = {
  answer: string;
  source: 'knowledge' | 'ai_fallback';
  confidence: number;
};

const OWNER_COMMAND_PREFIX = '/';

function safeString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try { return String(value); } catch { return ''; }
}

function safeTrimARS(value: unknown): string {
  return safeString(value).trim();
}

/**
 * Final client-side rescue for a real Owner AI answer that arrives on the same
 * line as an internal fallback marker. sanitizeOwnerAIVisibleText intentionally
 * removes lines containing those markers. Some backend/provider responses put
 * both the marker and the human answer on ONE line (for example
 * "provider fallback: Hello Ivan"). Dropping the whole line leaves an empty
 * answer and the chat renders the synthetic red "unable to display" bubble.
 *
 * We only rescue user-facing text after known marker phrases. Structured audit
 * metadata rows remain dropped, so this does not expose internal diagnostics.
 */
function rescueOwnerAIVisibleAnswer(value: unknown): string {
  const sanitized = sanitizeOwnerAIVisibleText(value);
  if (sanitized) {
    return sanitized;
  }

  const raw = safeTrimARS(value);
  if (!raw) {
    return '';
  }

  const structuredMetadata = /^(?:source:\s*owner_audit_report|detected_intent:|selected_route:|audit_endpoint_called:|audit_failure:)/i;
  const markerPattern = /\b(?:DEV_TEST_MODE|shared fallback|fallback reply delivered|fallback path answered|provider fallback|degraded fallback mode)\b\s*(?:[:=\-–—]+\s*)?/ig;

  const rescued = raw
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !structuredMetadata.test(line))
    .map((line) => line.replace(markerPattern, '').trim())
    .filter((line) => line.length > 0)
    .join('\n')
    .trim();

  return sanitizeOwnerAIVisibleText(rescued) || rescued;
}

let cachedAIHealth: ServiceRuntimeHealth = 'inactive';
let lastProbeTimestamp = 0;
const PROBE_CACHE_TTL_MS = 60000;

const OWNER_COMMANDS: Record<string, { description: string; handler: (args: string) => string }> = {
  status: {
    description: 'Show current room and system status',
    handler: (_args: string) => {
      return 'Room status: checking live state. Use the room status card above for real-time backend status, storage mode, and delivery method.';
    },
  },
  help: {
    description: 'List available owner commands',
    handler: (_args: string) => {
      const commandList = Object.entries(OWNER_COMMANDS)
        .map(([cmd, info]) => `/${cmd} — ${info.description}`)
        .join('\n');
      return `Available owner commands:\n${commandList}`;
    },
  },
  clear: {
    description: 'Clear local message cache (does not delete server messages)',
    handler: (_args: string) => {
      return 'Local message cache cleared. Pull to refresh to reload from server.';
    },
  },
  broadcast: {
    description: 'Send a broadcast notification to all participants',
    handler: (args: string) => {
      if (!safeTrimARS(args)) {
        return 'Usage: /broadcast <message>';
      }
      return `Broadcast queued: "${safeTrimARS(args)}". Participants will be notified on next sync.`;
    },
  },
  reconnect: {
    description: 'Force reconnect to the shared room backend',
    handler: (_args: string) => {
      return 'Reconnect triggered. The room state manager will re-detect the backend and re-establish subscriptions.';
    },
  },
  probe: {
    description: 'Run a health probe on the AI backend',
    handler: (_args: string) => {
      return 'AI health probe triggered. Check the AI indicator badge for updated status.';
    },
  },
};

function createRequestUuid(): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return cryptoRef.randomUUID();
  }

  const seed = `${Date.now().toString(16).padStart(12, '0')}${Math.random().toString(16).slice(2).padEnd(20, '0')}`.slice(0, 32);
  return `${seed.slice(0, 8)}-${seed.slice(8, 12)}-4${seed.slice(13, 16)}-a${seed.slice(17, 20)}-${seed.slice(20, 32)}`;
}

export async function probeAIBackendHealth(): Promise<IVXOwnerAIProbeResult> {
  const now = Date.now();
  const routingAudit = getIVXOwnerAIConfigAudit();
  if (now - lastProbeTimestamp < PROBE_CACHE_TTL_MS && cachedAIHealth !== 'inactive') {
    console.log('[AIReplyService] Using cached AI health:', cachedAIHealth);
    return {
      health: cachedAIHealth,
      roomStatus: null,
      source: 'local_app_brain',
      endpoint: null,
      deploymentMarker: null,
      capabilities: null,
    };
  }

  console.log('[AIReplyService] Probing AI backend health...');

  try {
    const probe = await ivxAIRequestService.probeOwnerAIHealth();
    cachedAIHealth = probe.health;
    lastProbeTimestamp = now;
    console.log('[AIReplyService] AI backend probe result:', {
      health: probe.health,
      source: probe.source,
      endpoint: probe.endpoint,
      deploymentMarker: probe.deploymentMarker,
    });
    return probe;
  } catch (error) {
    const message = (error as Error)?.message ?? '';
    console.log('[AIReplyService] AI backend probe: inactive (error:', message, ')');
    cachedAIHealth = 'inactive';
    lastProbeTimestamp = now;
    return {
      health: 'inactive',
      roomStatus: null,
      source: 'remote_api',
      endpoint: routingAudit.activeEndpoint,
      deploymentMarker: null,
      capabilities: null,
    };
  }
}

export async function requestAIReply(
  messageText: string,
  conversationId: string,
  senderLabel?: string | null,
  options?: RequestAIReplyOptions,
): Promise<AIReplyResult> {
  const safeMessageText = safeString(messageText);
  console.log('[AIReplyService] Requesting AI reply for:', safeMessageText.slice(0, 60));

  const routingAudit = getIVXOwnerAIConfigAudit();
  try {
    const requestId = createRequestUuid();
    const { value: response, trace } = await executeReliably(
      conversationId,
      async (_signal, attempt) => {
        if (attempt > 1) {
          console.log('[AIReplyService] Retry attempt', attempt, 'for conversation', conversationId);
        }
        return await ivxAIRequestService.requestOwnerAI({
          requestId,
          conversationId,
          message: messageText,
          senderLabel: senderLabel ?? null,
          mode: 'chat',
          persistUserMessage: false,
          persistAssistantMessage: true,
          devTestModeActive: isDevTestModeEnabled(),
        });
      },
      options,
    );

    const sanitizedAnswer = rescueOwnerAIVisibleAnswer(response.answer);
    if (!sanitizedAnswer) {
      throw new Error('IVX Owner AI returned no renderable reply text after sanitization/rescue.');
    }

    console.log('[AIReplyService] AI reply received:', {
      requestId: response.requestId,
      conversationId: response.conversationId,
      source: response.source,
      endpoint: response.endpoint,
      deploymentMarker: response.deploymentMarker,
      model: response.model,
      selectedTool: response.selectedTool ?? null,
      toolOutputCount: response.toolOutputs?.length ?? 0,
      answerLength: sanitizedAnswer.length,
    });

    cachedAIHealth = response.source === 'remote_api' || response.source === 'local_app_brain' ? 'active' : 'degraded';
    lastProbeTimestamp = Date.now();

    return {
      answer: sanitizedAnswer,
      requestId: response.requestId,
      conversationId: response.conversationId,
      model: response.model,
      source: response.source ?? 'remote_api',
      endpoint: response.endpoint,
      deploymentMarker: response.deploymentMarker,
      selectedTool: response.selectedTool ?? null,
      toolOutputs: response.toolOutputs,
      reliabilityTrace: trace,
    };
  } catch (error) {
    const msg = (error as Error)?.message ?? 'Unknown error';
    const diagnostics = getIVXOwnerAIErrorDiagnostics(error);
    console.log('[AIReplyService] AI reply request exhausted provider and local guard paths:', {
      message: msg,
      stack: error instanceof Error ? error.stack ?? null : null,
      routingPolicy: routingAudit.routingPolicy,
      diagnostics,
      raw: error,
    });

    cachedAIHealth = 'inactive';
    lastProbeTimestamp = Date.now();
    throw error;
  }
}

export function parseOwnerCommand(text: unknown): OwnerCommandResult | null {
  const trimmed = safeTrimARS(text);
  if (!trimmed.startsWith(OWNER_COMMAND_PREFIX)) {
    return null;
  }

  const parts = trimmed.slice(OWNER_COMMAND_PREFIX.length).split(/\s+/);
  const command = (parts[0] ?? '').toLowerCase();
  const args = parts.slice(1).join(' ');

  if (!command) {
    return null;
  }

  const handler = OWNER_COMMANDS[command];
  if (!handler) {
    return {
      command,
      args,
      response: `Unknown command: /${command}. Type /help to see available commands.`,
      handled: true,
    };
  }

  console.log('[AIReplyService] Owner command detected:', command, 'args:', args);
  return {
    command,
    args,
    response: handler.handler(args),
    handled: true,
  };
}

export async function requestKnowledgeAnswer(
  query: string,
  conversationId: string,
  senderLabel?: string | null,
): Promise<KnowledgeQueryResult> {
  console.log('[AIReplyService] Knowledge query:', query.slice(0, 60));

  try {
    const result = await requestAIReply(
      `[Knowledge Query] ${query}`,
      conversationId,
      senderLabel,
    );

    return {
      answer: result.answer,
      source: 'ai_fallback',
      confidence: 0.7,
    };
  } catch (error) {
    console.log('[AIReplyService] Knowledge query failed:', (error as Error)?.message);
    throw error;
  }
}

export function invalidateAIHealthCache(): void {
  cachedAIHealth = 'inactive';
  lastProbeTimestamp = 0;
  console.log('[AIReplyService] AI health cache invalidated');
}

/** Cancel any in-flight reliable AI request for the conversation. */
export function cancelPendingAIReply(conversationId: string, reason: string = 'user_cancel'): void {
  cancelInFlightAIRequest(conversationId, reason);
}

export function getCachedAIHealth(): ServiceRuntimeHealth {
  return cachedAIHealth;
}

export function buildRuntimeSignalsFromProbe(probe: IVXOwnerAIProbeResult): ChatRoomRuntimeSignals {
  const toHealth = (success: boolean | undefined): ServiceRuntimeHealth => success === true ? 'active' : 'inactive';
  const aiChatCapability = probe.capabilities?.ai_chat;

  return {
    aiBackendHealth: resolveChatAIHealthFromProbe({
      health: probe.health,
      aiChatCapability,
    }),
    aiBackendSource: probe.source,
    knowledgeBackendHealth: toHealth(probe.capabilities?.knowledge_answers),
    ownerCommandAvailability: toHealth(probe.capabilities?.owner_commands),
    codeAwareServiceAvailability: toHealth(probe.capabilities?.code_aware_support),
    aiResponseState: 'inactive',
  };
}

export function createAssistantChatMessage(
  conversationId: string,
  text: string,
  senderLabel?: string,
): ChatMessage {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  const id = cryptoRef?.randomUUID?.()
    ?? `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    id,
    conversationId,
    senderId: 'ivx-owner-ai-assistant',
    senderLabel: senderLabel ?? 'IVX Owner AI',
    text,
    createdAt: new Date().toISOString(),
    sendStatus: 'sent',
    optimistic: false,
  };
}

export function createCommandResponseMessage(
  conversationId: string,
  text: string,
): ChatMessage {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  const id = cryptoRef?.randomUUID?.()
    ?? `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  return {
    id,
    conversationId,
    senderId: 'ivx-owner-ai-system',
    senderLabel: 'System',
    text,
    createdAt: new Date().toISOString(),
    sendStatus: 'sent',
    optimistic: false,
  };
}
