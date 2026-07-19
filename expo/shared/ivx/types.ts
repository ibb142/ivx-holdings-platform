import type { PrivilegedIVXRole } from './access';

export const IVX_OWNER_AI_API_PATH = '/api/ivx/owner-ai';
export const IVX_OWNER_AI_BUCKET = 'ivx-owner-files';
export const IVX_CHAT_UPLOAD_BUCKET = 'ivx-chat-uploads';
export const IVX_OWNER_AI_MAX_UPLOAD_BYTES: number | null = null;

export const IVX_OWNER_AI_TABLES = {
  conversations: 'ivx_conversations',
  messages: 'ivx_messages',
  inboxState: 'ivx_inbox_state',
  aiRequests: 'ivx_ai_requests',
  knowledgeDocuments: 'ivx_knowledge_documents',
  knowledgeChunks: 'ivx_knowledge_chunks',
  commandLogs: 'ivx_command_logs',
  accessTestRows: 'ivx_access_test_rows',
} as const;

export type IVXOwnerRole = PrivilegedIVXRole;
export type IVXMessageSenderRole = 'owner' | 'assistant' | 'system';
export type IVXAttachmentKind = 'text' | 'image' | 'video' | 'pdf' | 'file' | 'command' | 'system';
export type IVXUploadSource = 'web' | 'mobile';
export type IVXRequestMode = 'chat' | 'command';

export type IVXConversation = {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessageText: string | null;
  lastMessageAt: string | null;
};

export type IVXMessage = {
  id: string;
  conversationId: string;
  senderUserId: string | null;
  senderRole: IVXMessageSenderRole;
  senderLabel: string | null;
  body: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentMime: string | null;
  attachmentSize: number | null;
  attachmentKind: IVXAttachmentKind;
  createdAt: string;
  updatedAt: string;
  /** Optional durable task id attached by execution-mode responses (client-only; not persisted to DB). */
  taskId?: string | null;
};

export type IVXInboxItem = {
  conversationId: string;
  slug: string;
  title: string;
  subtitle: string | null;
  unreadCount: number;
  lastReadAt: string | null;
  lastMessageText: string | null;
  lastMessageAt: string | null;
};

export type IVXWebUploadFile = {
  arrayBuffer: () => Promise<ArrayBuffer>;
  type?: string;
  size?: number;
  name?: string;
};

export type IVXUploadInput = {
  uri?: string;
  file?: IVXWebUploadFile | null;
  name: string;
  type?: string | null;
  size?: number | null;
};

export type IVXUploadedFile = {
  bucket: string;
  path: string;
  publicUrl: string;
  fileName: string;
  mimeType: string | null;
  size: number | null;
  source: IVXUploadSource;
};

export type IVXOwnerAuthContext = {
  userId: string;
  email: string | null;
  role: IVXOwnerRole;
  accessToken: string;
};

export type IVXOwnerAIRequest = {
  requestId?: string;
  conversationId?: string;
  message: string;
  senderLabel?: string | null;
  mode?: IVXRequestMode;
  persistUserMessage?: boolean;
  persistAssistantMessage?: boolean;
  devTestModeActive?: boolean;
  continuationToken?: string | null;
};

export type IVXOwnerAIToolOutput = {
  tool: string;
  ok: boolean;
  input: Record<string, unknown>;
  output?: unknown;
  error?: string;
  timestamp: string;
};

export type IVXOwnerAIRouterDebug = {
  selectedIntent: string;
  selectedTool: string | null;
  manualMode: boolean;
  route: string;
  reason: string;
};

export type IVXAgentRuntimeV2Snapshot = {
  version: 'agent_runtime_v2';
  marker: string;
  requestId: string | null;
  conversationId: string | null;
  generatedAt?: string;
  backendState: {
    fallbackMasking: false;
    trueStateExposed: true;
    destructiveActionsRequireApproval: true;
  };
  memory: Record<string, unknown>;
  planner: Record<string, unknown>;
  taskTree: Record<string, unknown>;
  streaming: Record<string, unknown>;
  retryRecovery: Record<string, unknown>;
  toolChain: unknown[];
  multiAgent: Record<string, unknown>;
  businessReasoning: Record<string, unknown>;
};

export type IVXOwnerAIResponse = {
  requestId: string;
  conversationId: string;
  answer: string;
  model: string;
  status: 'ok';
  source?: 'remote_api' | 'local_app_brain' | 'provider_fallback' | 'local_runtime';
  provider?: 'chatgpt' | 'ivx_daily_improvement' | 'ivx_self_developer_runtime';
  endpoint?: string;
  deploymentMarker?: string;
  assistantMessageId?: string | null;
  assistantPersisted?: boolean;
  selectedIntent?: string | null;
  selectedTool?: string | null;
  routerDebug?: IVXOwnerAIRouterDebug;
  toolInput?: Record<string, unknown>[];
  toolOutput?: unknown[];
  fallbackUsed?: boolean;
  toolOutputs?: IVXOwnerAIToolOutput[];
  runtimeV2?: IVXAgentRuntimeV2Snapshot;
  continuationToken?: string | null;
  continuationPart?: number | null;
  continuationTotalParts?: number | null;
  continuationNextItemNumber?: number | null;
  continuationComplete?: boolean;
  continuationPrompt?: string | null;
  /**
   * FINAL IVX IA CHAT EXECUTION MODE (owner mandate 2026-07-19):
   * Present on every execution-mode response (fix/build/deploy/audit/QA/
   * refactor/migration/create module/create app/senior developer). Carries
   * the 9 owner-required fields: taskId, status, stage, liveProgress,
   * filesChanged, tests, commitSha, deploymentId, evidence. Absent on normal
   * conversation/explanation responses.
   */
  executionStatus?: IVXExecutionStatusPayload;
};

/**
 * Execution-mode status payload — the strict 9-field schema the owner mandates
 * for every developer request. Mirrors the backend
 * `IVXExecutionStatusPayload` in backend/services/ivx-execution-status-schema.ts.
 */
export type IVXExecutionStatusPayload = {
  taskId: string;
  status: string;
  stage: string;
  liveProgress: number;
  filesChanged: string[];
  tests: {
    run: boolean;
    passed: boolean;
    command: string | null;
  };
  commitSha: string | null;
  deploymentId: string | null;
  evidence: IVXExecutionEvidence | null;
  httpStatus: 200 | 202;
  category: string | null;
  statusUrl: string;
  generatedAt: string;
};

export type IVXExecutionEvidence = {
  deployedToProduction: boolean;
  liveCommit: string | null;
  commitMatch: boolean;
  healthOk: boolean;
  typecheck: {
    run: boolean;
    passed: boolean;
  };
  buildRun: boolean;
  finalStatus: string;
  error: string | null;
  answerBlock: string;
};

export type IVXOwnerAICanonicalResponse = {
  requestId: string;
  conversationId: string;
  answer: string;
  model: string;
  status: 'ok';
  source: 'remote_api' | 'local_app_brain';
  provider?: 'chatgpt';
  deploymentMarker?: string;
  assistantMessageId?: string | null;
  assistantPersisted?: boolean;
  selectedIntent?: string | null;
  selectedTool?: string | null;
  routerDebug?: IVXOwnerAIRouterDebug;
  toolInput?: Record<string, unknown>[];
  toolOutput?: unknown[];
  fallbackUsed?: boolean;
  toolOutputs?: IVXOwnerAIToolOutput[];
  runtimeV2?: IVXAgentRuntimeV2Snapshot;
  /**
   * FINAL IVX IA CHAT EXECUTION MODE (owner mandate 2026-07-19):
   * Present on execution-mode responses (fix/build/deploy/audit/QA/refactor/
   * migration/create module/create app/senior developer). Forwarded through
   * validateCanonicalOwnerAIResponse so the chat can render a live-polling
   * execution console bubble. Absent on normal conversation/explanation.
   */
  executionStatus?: IVXExecutionStatusPayload;
};

export type IVXOwnerAIRejectedResponse = {
  reason:
    | 'non_object_payload'
    | 'missing_request_id'
    | 'missing_conversation_id'
    | 'missing_answer'
    | 'missing_model'
    | 'invalid_status'
    | 'invalid_source'
    | 'invalid_deployment_marker';
  payloadType: 'null' | 'array' | 'object' | 'string' | 'number' | 'boolean' | 'undefined';
};

export type IVXOwnerAIRoomStatus = {
  storageMode: 'primary_supabase_tables' | 'alternate_room_schema' | 'snapshot_storage' | 'local_device_only';
  visibility: 'private' | 'shared' | 'local_only';
  deliveryMethod: 'primary_realtime' | 'primary_polling' | 'alternate_shared' | 'snapshot_fallback' | 'local_only';
  warning?: string;
};

export type IVXOwnerAICapabilityId =
  | 'ai_chat'
  | 'knowledge_answers'
  | 'owner_commands'
  | 'code_aware_support'
  | 'file_upload'
  | 'inbox_sync'
  | 'backend_access'
  | 'supabase_inspection'
  | 'supabase_tables'
  | 'supabase_schema'
  | 'supabase_columns'
  | 'supabase_rls';

export type IVXOwnerAICapabilityProof = {
  success: boolean;
  executable: boolean;
  functionName: string;
  checkedAt: string;
  proof: Record<string, unknown>;
  error?: string;
};

export type IVXOwnerAIHealthProbeResponse = IVXOwnerAIResponse & {
  probe: true;
  resolvedSchema: 'ivx' | 'generic' | 'none';
  roomStatus: IVXOwnerAIRoomStatus;
  capabilities: Record<IVXOwnerAICapabilityId, boolean>;
  capabilityProofs: Record<IVXOwnerAICapabilityId, IVXOwnerAICapabilityProof>;
};

export type IVXApiError = {
  error: string;
  statusCode: number;
};
