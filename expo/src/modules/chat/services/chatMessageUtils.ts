/**
 * Pure, React-free helpers extracted from `expo/app/ivx/chat.tsx`
 * as the first slice of the chat.tsx modularization (PLAN.md item).
 *
 * Behavior must remain byte-identical to the originals.
 * Nothing in this file depends on React, hooks, or runtime state.
 */
import { IVX_OWNER_AI_PROFILE } from '@/constants/ivx-owner-ai';
import type { IVXMessage, IVXUploadInput } from '@/shared/ivx';
import type { ChatReplyContext } from '@/src/modules/chat/types/chat';

// ---------- Branch / runtime status types (extracted from chat.tsx) ----------

export type ResolvedSendBranch = 'primary_realtime' | 'alternate_shared' | 'snapshot_fallback' | 'local_only';

export type SendBranchProofRow = {
  branch: ResolvedSendBranch | null;
  label: string;
  context: string;
};

export type DeliveryBranchKind = 'remote_db_insert' | 'local_fallback' | 'auth_session_failure' | 'not_observed';
export type RuntimeSourceKind = 'remote_api' | 'local_app_brain' | 'provider_fallback' | string;
export type RuntimeStatusKind = 'live' | 'probing' | string;

export function resolveSendBranchPure(
  deliveryBranch: DeliveryBranchKind,
  runtimeSource: RuntimeSourceKind,
  httpStatus: string,
): SendBranchProofRow {
  if (deliveryBranch === 'not_observed') {
    return { branch: null, label: 'pending', context: 'no send observed' };
  }
  const statusFragment = httpStatus !== 'pending' && httpStatus !== 'none' ? ` · ${httpStatus}` : '';
  if (deliveryBranch === 'remote_db_insert') {
    if (runtimeSource === 'remote_api' || runtimeSource === 'local_app_brain') {
      return { branch: 'primary_realtime', label: 'primary_realtime', context: `assistant db insert${statusFragment}` };
    }
    if (runtimeSource === 'provider_fallback') {
      return { branch: 'alternate_shared', label: 'alternate_shared', context: `gateway db insert${statusFragment}` };
    }
    return { branch: 'primary_realtime', label: 'primary_realtime', context: `db insert · source ${runtimeSource}${statusFragment}` };
  }
  if (deliveryBranch === 'local_fallback') {
    return { branch: 'snapshot_fallback', label: 'snapshot_fallback', context: `local fallback path${statusFragment}` };
  }
  if (deliveryBranch === 'auth_session_failure') {
    return { branch: 'local_only', label: 'local_only', context: `auth/session unavailable${statusFragment}` };
  }
  return { branch: 'local_only', label: 'local_only', context: `unresolved branch${statusFragment}` };
}

export function getRuntimeFallbackStatePure(source: RuntimeSourceKind): string {
  if (source === 'remote_api' || source === 'local_app_brain') return 'cleared';
  if (source === 'provider_fallback') return 'active';
  return 'pending';
}

export function getRuntimeDegradedStatePure(status: RuntimeStatusKind): string {
  if (status === 'live') return 'cleared';
  if (status === 'probing') return 'pending';
  return status;
}

export function formatRuntimeTimestampPure(value: string | null): string {
  if (!value) return 'pending';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleTimeString();
}

export function getControlRoomTonePure(status: string): 'pass' | 'warn' | 'error' | 'pending' {
  if (status === 'verified' || status === 'connected' || status === 'available') return 'pass';
  if (status === 'blocked' || status === 'missing_access' || status === 'not_connected') return 'error';
  return 'pending';
}

export function getControlRoomStatusLabelPure(status: string): string {
  return status.replace(/_/g, ' ');
}

export const IVX_REPLY_CONTEXT_PREFIX = '[[ivx_reply_context:';
export const IVX_REPLY_CONTEXT_SUFFIX = ']]';

export type ParsedReplyBody = {
  replyTo: ChatReplyContext | null;
  body: string;
};

export function safeTrim(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim();
  }
  if (value == null) {
    return '';
  }
  try {
    return String(value).trim();
  } catch {
    return '';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function createTransientMessageId(prefix: string): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return `${prefix}-${cryptoRef.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function formatMessageTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatMessageDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'unknown';
  }
  return date.toISOString().slice(0, 10);
}

export function formatMessageDateLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Recent';
  }
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const dateKey = formatMessageDateKey(value);
  if (dateKey === formatMessageDateKey(today.toISOString())) {
    return 'Today';
  }
  if (dateKey === formatMessageDateKey(yesterday.toISOString())) {
    return 'Yesterday';
  }
  return date.toLocaleDateString([], {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric',
  });
}

export function isOwnMessage(message: IVXMessage, ownerId: string): boolean {
  if (!safeTrim(ownerId)) {
    return message.senderRole === 'owner';
  }
  return message.senderUserId === ownerId || message.senderRole === 'owner';
}

export function getAttachmentLabel(message: IVXMessage): string {
  return message.attachmentName ?? message.attachmentUrl ?? 'Attachment';
}

export function getAttachmentKindFromUpload(upload: IVXUploadInput): IVXMessage['attachmentKind'] {
  const mime = upload.type?.toLowerCase() ?? '';
  const name = upload.name.toLowerCase();
  if (mime.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|heic)$/.test(name)) return 'image';
  if (mime.startsWith('video/') || /\.(mp4|mov|webm|m4v)$/.test(name)) return 'video';
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  return 'file';
}

export function parseStructuredSystemMessage(body: string | null | undefined): Array<{ label: string; value: string }> | null {
  const lines = body?.split('\n').map((line) => line.trim()).filter((line) => line.length > 0) ?? [];
  const rows = lines
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) {
        return null;
      }
      const label = line.slice(0, separatorIndex).trim();
      const value = line.slice(separatorIndex + 1).trim();
      if (!label || !value) {
        return null;
      }
      return { label, value };
    })
    .filter((row): row is { label: string; value: string } => row !== null);

  if (rows.length < 3) {
    return null;
  }

  return rows.some((row) => row.label.toLowerCase() === 'result') && rows.some((row) => row.label.toLowerCase() === 'evidence')
    ? rows
    : null;
}

// `senderRole: 'system'` is now reserved for hidden/internal/system events
// (audit markers, internal continuation tokens, etc.). All user-visible
// AI-generated content uses `senderRole: 'assistant'`. This makes the render
// filter simple and removes the temporary debug-bypass patterns that were
// masking real assistant replies.
export function isInternalTranscriptMessage(message: IVXMessage): boolean {
  if (message.senderRole === 'system') {
    return true;
  }
  return false;
}

/**
 * Regression guard: any visible AI-generated transient must use
 * `senderRole: 'assistant'`. If a caller ever passes `'system'` for a
 * visible reply we crash loudly in dev (so it surfaces immediately) and
 * log + auto-correct to `'assistant'` in production (so users never see
 * the reply disappear behind the internal-transcript filter).
 */
export function buildVisibleAssistantTransient(input: {
  id: string;
  conversationId: string;
  body: string;
  senderRole?: IVXMessage['senderRole'];
  attachmentKind?: IVXMessage['attachmentKind'];
  senderLabel?: string;
  /** Optional durable task id for execution-mode responses (client-only). */
  taskId?: string | null;
}): IVXMessage {
  const role: IVXMessage['senderRole'] = input.senderRole ?? 'assistant';
  if (role !== 'assistant') {
    const guardMessage = `[IVXOwnerChatRoute] Regression guard: visible AI reply created with senderRole='${role}'. Coercing to 'assistant'.`;
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.error(guardMessage, { id: input.id, bodyPreview: input.body.slice(0, 80) });
      throw new Error(guardMessage);
    }
    // eslint-disable-next-line no-console
    console.log(guardMessage, { id: input.id, bodyPreview: input.body.slice(0, 80) });
  }
  const nowIso = new Date().toISOString();
  const payload: IVXMessage = {
    id: input.id,
    conversationId: input.conversationId,
    senderUserId: null,
    senderRole: 'assistant',
    senderLabel: input.senderLabel ?? IVX_OWNER_AI_PROFILE.name,
    body: input.body,
    attachmentUrl: null,
    attachmentName: null,
    attachmentMime: null,
    attachmentSize: null,
    attachmentKind: input.attachmentKind ?? 'text',
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  if (input.taskId) {
    payload.taskId = input.taskId;
  }
  return payload;
}

export function encodeReplyBody(text: string, replyTo: ChatReplyContext | null): string {
  if (!replyTo) {
    return text;
  }
  try {
    const encoded = encodeURIComponent(JSON.stringify(replyTo));
    return `${IVX_REPLY_CONTEXT_PREFIX}${encoded}${IVX_REPLY_CONTEXT_SUFFIX}\n${text}`;
  } catch (error) {
    console.log('[IVXOwnerChatRoute] Failed to encode reply context:', error instanceof Error ? error.message : 'unknown');
    return text;
  }
}

export function parseReplyBody(value: string | null | undefined): ParsedReplyBody {
  const body = value ?? '';
  if (!body.startsWith(IVX_REPLY_CONTEXT_PREFIX)) {
    return { replyTo: null, body };
  }
  const suffixIndex = body.indexOf(IVX_REPLY_CONTEXT_SUFFIX);
  if (suffixIndex < 0) {
    return { replyTo: null, body };
  }
  try {
    const encoded = body.slice(IVX_REPLY_CONTEXT_PREFIX.length, suffixIndex);
    const parsed = JSON.parse(decodeURIComponent(encoded)) as Partial<ChatReplyContext>;
    const replyTo: ChatReplyContext = {
      messageId: safeTrim(parsed.messageId),
      senderLabel: safeTrim(parsed.senderLabel) || 'Original message',
      previewText: safeTrim(parsed.previewText) || 'Message',
    };
    const visibleBody = body.slice(suffixIndex + IVX_REPLY_CONTEXT_SUFFIX.length).replace(/^\n/, '');
    return replyTo.messageId ? { replyTo, body: visibleBody } : { replyTo: null, body: visibleBody };
  } catch (error) {
    console.log('[IVXOwnerChatRoute] Failed to parse reply context:', error instanceof Error ? error.message : 'unknown');
    return { replyTo: null, body };
  }
}

// ---------- AI Execution Stages (replaces simple typing indicator) ----------

export type AIExecutionStage =
  | 'idle'
  | 'uploading_attachment'
  | 'delivering_message'
  | 'searching_repo'
  | 'reading_files'
  | 'inspecting_functions'
  | 'running_checks'
  | 'preparing_patch'
  | 'awaiting_provider'
  | 'streaming_response'
  | 'blocked_waiting'
  | 'done';

export function resolveAIExecutionStage(input: {
  attachmentPending: boolean;
  sendPending: boolean;
  aiReplyPending: boolean;
  requestStage: string;
  source: string;
  failureClass: string;
  hasVisibleResponseText: boolean;
}): AIExecutionStage {
  if (input.attachmentPending) return 'uploading_attachment';
  if (input.sendPending) return 'delivering_message';
  if (!input.aiReplyPending) return input.hasVisibleResponseText ? 'done' : 'idle';

  const stage = input.requestStage;
  const failure = input.failureClass;

  if (failure && failure !== 'none' && failure !== 'pending') {
    return 'blocked_waiting';
  }
  if (stage === 'request_started' || stage === 'proxy_status_ok') return 'searching_repo';
  if (stage === 'tool_code_read' || stage === 'reading_files') return 'reading_files';
  if (stage === 'tool_code_search') return 'searching_repo';
  if (stage === 'tool_inspect' || stage === 'inspecting_functions') return 'inspecting_functions';
  if (stage === 'tool_test_run' || stage === 'running_checks') return 'running_checks';
  if (stage === 'patch_generate' || stage === 'preparing_patch') return 'preparing_patch';
  if (stage === 'verifying_result' || stage === 'response_ok') return 'streaming_response';
  if (stage === 'streaming' || stage === 'stage:stream' || stage === 'sse_start') return 'streaming_response';
  if (input.source === 'provider_fallback') return 'awaiting_provider';
  return 'awaiting_provider';
}

export function formatAIExecutionStage(stage: AIExecutionStage): string {
  switch (stage) {
    case 'idle': return '';
    case 'uploading_attachment': return 'Uploading attachment…';
    case 'delivering_message': return 'Delivering your message…';
    case 'searching_repo': return 'Searching the repository…';
    case 'reading_files': return 'Reading source files…';
    case 'inspecting_functions': return 'Inspecting functions…';
    case 'running_checks': return 'Running checks…';
    case 'preparing_patch': return 'Preparing patch…';
    case 'awaiting_provider': return 'IVX IA is thinking…';
    case 'streaming_response': return 'Streaming response…';
    case 'blocked_waiting': return 'Blocked — waiting on owner / provider…';
    case 'done': return '';
  }
}

// ---------- Proof Mode (default-on for technical questions) ----------

const TECHNICAL_PROOF_REGEX = /\b(file|line|function|patch|stack|error|crash|fix|diagnos(?:e|tics)|audit|proof|deploy|rollback|incident|supabase|render|otel|trace|repo|grep|search|typecheck|lint|e2e|maestro|playwright|provider|fallback|sse|owner ai|owner-ai|chat\.tsx)\b/i;

export function shouldDefaultToProofMode(prompt: string): boolean {
  if (!prompt || prompt.length < 4) return false;
  return TECHNICAL_PROOF_REGEX.test(prompt);
}

export function normalizeComposerText(value: unknown, fallback: unknown = ''): string {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (typeof fallback === 'string') {
    return fallback;
  }
  if (typeof fallback === 'number' || typeof fallback === 'boolean') {
    return String(fallback);
  }
  if (value == null && fallback == null) {
    return '';
  }
  try {
    if (value != null) {
      return String(value);
    }
    if (fallback != null) {
      return String(fallback);
    }
  } catch (error) {
    console.log('[IVXOwnerChatRoute] Failed to normalize composer text:', error instanceof Error ? error.message : 'unknown');
  }
  return '';
}
