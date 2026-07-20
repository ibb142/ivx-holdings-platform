import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Alert,
  AppState,
  type AppStateStatus,
  FlatList,
  ActivityIndicator,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  type LayoutChangeEvent,
  Linking,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { MessageBubble } from '@/src/modules/chat/components/MessageBubble';
import { ExecutionConsoleBubble } from '@/src/modules/ivx-owner-ai/components/ExecutionConsoleBubble';
import { coerceExecutionStatusFromPayload } from '@/src/modules/ivx-owner-ai/hooks/useExecutionStatusPoll';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Activity, ChevronDown, ClipboardList, Cpu, Crosshair, Crown, Gauge, GitBranch, KeyRound, LayoutDashboard, LineChart, Lock, Mail, Megaphone, MessageCircle, Mic, Paperclip, Pin, PlayCircle, Radar, Radio, Rocket, Search, Send, ShieldCheck, Sparkles, Square, Terminal, Unplug, Upload, UserPlus, Users, X } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import { SafeIcon } from '@/lib/safe-icon';
import { useWebKeyboard, scrollInputIntoView } from '@/hooks/useWebKeyboard';
import Colors from '@/constants/colors';
import { IVX_OWNER_AI_PROFILE, IVX_OWNER_AI_ROOM_ID } from '@/constants/ivx-owner-ai';
import { useAuth } from '@/lib/auth-context';
import { isAdminRole } from '@/lib/auth-helpers';
import { IVX_BASELINE_OWNER_EMAILS } from '@/shared/ivx/access-control';
import { resolveDevTestModeContext } from '@/lib/dev-test-mode';
import { getIVXAccessToken, getIVXOwnerAIConfigAudit, type IVXOwnerAIConfigAudit } from '@/lib/ivx-supabase-client';
import { runOwnerSessionPreflight, OWNER_SESSION_REQUIRED_LABEL } from '@/src/modules/ivx-owner-ai/services/ownerSessionPreflight';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import { safeSetString } from '@/lib/safe-clipboard';
import type { IVXMessage, IVXOwnerAIRouterDebug, IVXOwnerAIToolOutput, IVXUploadInput, IVXExecutionStatusPayload } from '@/shared/ivx';
import { assertCleanOwnerAIResponseText, isIVXServiceUnavailableDiagnostics } from '@/src/modules/ivx-owner-ai/services/ivxAIRequestService';
import { runDurableOwnerAIFallback, resumePendingDurableTasks, shouldAttemptDurableFallback } from '@/src/modules/ivx-owner-ai/services/ivxDurableTaskService';
import { ivxAIWatchdog, type WatchdogTraceHandle } from '@/src/modules/ivx-owner-ai/services/ivxAIWatchdog';
import { IVXWatchdogBanner, IVXWatchdogDrawer } from '@/components/IVXWatchdogPanel';
import { IVXStagedTimeoutBanner, type TimeoutEvidence } from '@/components/IVXStagedTimeoutBanner';
import { createAIOrchestrator, type AIOrchestrator } from '@/src/modules/ivx-owner-ai/services/ivxOwnerAIOrchestrator';
import Constants from 'expo-constants';
import { getIVXBuildInfo } from '@/constants/build-info';
import { getIVXRuntimeInfo } from '@/lib/runtime-environment';
import { ivxDiagnostics } from '@/src/modules/ivx-developer/diagnosticsStore';
import { refreshOwnerSession } from '@/src/modules/ivx-developer/authDiagnosticsService';
import IVXAdvancedExecutionMode from '@/components/IVXAdvancedExecutionMode';
// Legacy panel kept for fallback access (not currently mounted).
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import _IVXLiveWorkVisibility from '@/components/IVXLiveWorkVisibility';
import { resolveAIExecutionStage, formatAIExecutionStage, type AIExecutionStage } from '@/src/modules/chat/services/chatMessageUtils';
import {
  getActiveRuntimeSource,
  getRuntimeSourceLabel,
  getRuntimeStatusCopy,
  hasActiveStreamingState,
  hasRuntimeFailure,
  isPendingRequestState,
  isAcceptableAssistantSource,
  isExpectedAssistantSource,
  normalizeRuntimeSource,
  shouldPreserveRequestScopedRuntime,
  shouldShowFallbackUI,
} from '@/src/modules/chat/chatRuntimeState';
import {
  buildIVXChatAuditReport,
  buildIVXFunctionalityProofList,
  buildIVXRoomRuntimeSnapshot,
  getIVXOwnerAIErrorDiagnostics,
  getLastIVXOwnerAIRuntimeProof,
  getLastIVXOwnerAIPrimaryRouteFailure,
  getLastIVXOwnerAIAuthDiagnostic,
  ivxAIRequestService,
  ivxChatService,
  ivxOwnerMemoryService,
  createIVXOwnerFileUnderstandingPrompt,
  createIVXOwnerMultiFileUnderstandingPrompt,
  ivxInboxService,
  detectIVXRoomStatus,
  invalidateIVXRoomProbeCache,
  recordIVXOwnerChatAuditEvent,
  type IVXChatAuditReport,
  type IVXFunctionalityProofItem,
  type IVXOwnerReceiveAudit,
  type IVXOwnerRealtimeSubscriptionAudit,
  type IVXOwnerSendAudit,
  type IVXProofRecord,
  type IVXRoomRuntimeSnapshot,
} from '@/src/modules/ivx-owner-ai/services';
import { isIVXLocalFirstChatEnabled } from '@/src/modules/ivx-owner-ai/services/ivxLocalFirstRuntime';
import type { IVXOwnerFileInsight } from '@/src/modules/ivx-owner-ai/services/ivxOwnerMemoryService';
import { transcribeAudioRecording } from '@/src/modules/ivx-owner-ai/services/ivxMultimodalService';
import { executeReliably, type ReliabilityTrace } from '@/src/modules/chat/services/aiReliability';
import { useChatSendQueue } from '@/src/modules/chat/services/useChatSendQueue';
import {
  isExplicitSensitiveActionConfirmation,
  resolveOwnerTrustContext,
  stripSensitiveActionConfirmationPrefix,
  type OwnerRequestClass,
} from '@/src/modules/ivx-owner-ai/services/ownerTrust';
import type { ChatMessage, ChatReplyContext, ChatRoomRuntimeSignals, ChatRoomStatus, ServiceRuntimeHealth } from '@/src/modules/chat/types/chat';
import { resolveRoomCapabilityState, type RoomCapabilityResolution } from '@/src/modules/chat/services/roomCapabilityResolver';
import { sanitizeUserFacingChatText } from '@/src/modules/chat/services/visibleTextSanitizer';
import {
  IVX_REPLY_CONTEXT_PREFIX,
  IVX_REPLY_CONTEXT_SUFFIX,
  safeTrim,
  isRecord,
  createTransientMessageId,
  formatMessageTime,
  formatMessageDateKey,
  formatMessageDateLabel,
  isOwnMessage,
  getAttachmentLabel,
  getAttachmentKindFromUpload,
  parseStructuredSystemMessage,
  isInternalTranscriptMessage,
  buildVisibleAssistantTransient,
  encodeReplyBody,
  parseReplyBody,
  normalizeComposerText,
  type ParsedReplyBody,
} from '@/src/modules/chat/services/chatMessageUtils';
import {
  controlTowerAggregator,
  executeOperatorAction,
  getActionLabel,
  type CTDashboardSnapshot,
  type CTEvidenceRecord,
  type CTRiskAssessment,
  type CTOperatorActionRun,
  type CTSystemNode,
} from '@/lib/control-tower';
import { liveIntelligenceService } from '@/lib/control-tower/live-intelligence';
import { useLiveIntelligenceSnapshot } from '@/lib/control-tower/use-live-intelligence';
import { getIVXControlRoomStatus, type IVXControlRoomItem, type IVXControlRoomItemStatus, type IVXControlRoomStatus } from '@/src/modules/ivx-owner-ai/services/ivxControlRoomService';
import { IVX_COMMAND_BRAIN, getCommandBrainPending, isCommandBrainCommand, listCommandBrainCommands, runCommandBrain } from '@/src/modules/ivx-owner-ai/services/ivxCommandBrain';
import {
  buildSeniorDeveloperApprovalCard,
  buildSeniorDeveloperJobDraft,
  buildSeniorDeveloperSubmitStatusCard,
  isSeniorDeveloperBuildRequest,
  type SeniorDeveloperJobDraft,
} from '@/src/modules/ivx-developer/seniorDeveloperBuildIntent';
import {
  getSeniorDeveloperWorkerLastProof,
  isWorkerJobComplete,
  pollSeniorDeveloperWorkerJob,
  submitSeniorDeveloperWorkerJob,
  type WorkerJobView,
} from '@/src/modules/ivx-developer/seniorDeveloperWorkerService';

type PickerAsset = {
  uri: string;
  name?: string | null;
  mimeType?: string | null;
  size?: number | null;
  file?: {
    arrayBuffer: () => Promise<ArrayBuffer>;
    name?: string;
    size?: number;
    type?: string;
  } | null;
};

type OwnerCommandResult = {
  command: string;
  args: string;
  response: string;
};

type QAProofItem = {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
};

type OwnerPromptTemplate = {
  id: 'deal_review' | 'investor_reply' | 'document_summary';
  label: string;
  prompt: string;
  testID: string;
};

type ProbeMetadata = {
  observedAt: string | null;
  source: 'remote_api' | 'local_app_brain' | 'provider_fallback' | 'pending' | 'unknown';
  endpoint: string | null;
  deploymentMarker: string | null;
  lastFailureReason: string | null;
};

type AIProxyStatusSnapshot = {
  status: 'idle' | 'checking' | 'connected' | 'blocked' | 'error';
  observedAt: string | null;
  url: string | null;
  model: string | null;
  gateway: string | null;
  configured: boolean;
  deploymentMarker: string | null;
  error: string | null;
};

type RuntimeDebugSnapshot = {
  authMode: 'owner_session' | 'open_access_dev_bypass' | 'missing_owner_session';
  ownerBypassEnabled: boolean;
  conversationId: string | null;
  requestId: string | null;
  source: 'remote_api' | 'local_app_brain' | 'provider_fallback' | 'pending' | 'unknown';
  endpoint: string | null;
  deploymentMarker: string | null;
  selectedIntent: string | null;
  selectedTool: string | null;
  requestStage: string;
  failureClass: string;
  httpStatus: string;
  responsePreview: string;
  failureDetail: string;
  lastAttemptAt: string | null;
  lastVerifiedAt: string | null;
  hasVisibleResponseText: boolean;
};

type PendingOwnerMessage = {
  clientId: string;
  text: string;
  createdAt: string;
  mode: 'send_only' | 'send_and_ai' | 'ai_only' | 'attachment';
  status: 'sending' | 'uploading' | 'uploaded' | 'failed';
  errorMessage?: string | null;
  upload?: IVXUploadInput | null;
  uploadProgress?: number | null;
  replyTo?: ChatReplyContext | null;
};

type OwnerConversationDraft = {
  text: string;
  attachmentDrafts: PendingOwnerMessage[];
  updatedAt: string;
};

const OWNER_PROMPT_TEMPLATES: readonly OwnerPromptTemplate[] = [
  {
    id: 'deal_review',
    label: 'Deal review',
    prompt: 'Review this real estate deal like a senior IVX analyst. Summarize upside, risks, missing diligence, required documents, investor suitability notes, and the exact next action list.',
    testID: 'ivx-owner-template-deal-review',
  },
  {
    id: 'investor_reply',
    label: 'Investor reply',
    prompt: 'Draft a compliant investor-support reply. Keep it clear, warm, non-promissory, and include what the investor should review before requesting allocation access.',
    testID: 'ivx-owner-template-investor-reply',
  },
  {
    id: 'document_summary',
    label: 'Doc summary',
    prompt: 'Summarize the attached document or pasted text. Extract the key financial terms, obligations, deadlines, risk disclosures, missing signatures, and follow-up questions.',
    testID: 'ivx-owner-template-document-summary',
  },
];

type BackendAuditSummary = {
  currentEnvironment: 'development' | 'production';
  routingPolicy: string;
  auditState: string;
  configSource: string;
  explicitProductionPin: string;
  configuredOwnerAIBaseUrl: string;
  activeBaseUrl: string;
  activeHost: string;
  activeEndpoint: string;
  directApiBaseUrl: string;
  directApiHost: string;
  ownerAiHealthUrl: string;
  ownerRoute53AuditUrl: string;
  ownerRoute53UpsertUrl: string;
  appApiHealthUrl: string;
  appApiRoute53AuditUrl: string;
  devFallbackBaseUrl: string;
  activeFallbackBaseUrl: string;
  selectionReason: string;
  fallbackUsed: string;
  whyFallbackSelected: string;
  wasFallbackUsed: string;
  productionGuard: string;
  productionGuardBlocked: boolean;
  failureMode: string;
  recommendedResolution: string;
  gracefulDegradationNote: string;
  workflowTrace: string[];
  mismatchWarnings: string[];
};

type OwnerAIProofStatus = {
  id: 'local_app_brain_ready' | 'remote_api_verified' | 'blocked_by_auth' | 'dev_fallback' | 'remote_api_unverified';
  tone: 'pass' | 'blocked' | 'warn' | 'pending';
  title: string;
  detail: string;
  evidence: string;
  testID: string;
};

type DeliveryBranchStatus = {
  branch: 'remote_db_insert' | 'local_fallback' | 'auth_session_failure' | 'not_observed';
  title: string;
  detail: string;
  evidence: string;
};

type ReceiveBranchStatus = {
  branch: 'realtime_event' | 'local_listener' | 'not_observed';
  title: string;
  detail: string;
  evidence: string;
};

type ResolvedSendBranch = 'primary_realtime' | 'alternate_shared' | 'snapshot_fallback' | 'local_only';

type SendBranchProofRow = {
  branch: ResolvedSendBranch | null;
  label: string;
  context: string;
};

function resolveSendBranch(
  deliveryBranch: DeliveryBranchStatus['branch'],
  runtimeSource: RuntimeDebugSnapshot['source'],
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

function getRuntimeFallbackState(source: RuntimeDebugSnapshot['source']): string {
  if (source === 'remote_api' || source === 'local_app_brain') {
    return 'cleared';
  }
  if (source === 'provider_fallback') {
    return 'active';
  }
  return 'pending';
}

function getRuntimeDegradedState(status: IVXRoomRuntimeSnapshot['runtimeStatus']): string {
  if (status === 'live') {
    return 'cleared';
  }
  if (status === 'probing') {
    return 'pending';
  }
  return status;
}

function formatRuntimeTimestamp(value: string | null): string {
  if (!value) {
    return 'pending';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleTimeString();
}

function getRuntimeProofHeadline(runtime: RuntimeDebugSnapshot): { title: string; detail: string } {
  if (hasRuntimeFailure(runtime)) {
    return {
      title: 'Assistant path needs attention',
      detail: 'The last reply did not complete cleanly. Your message remains saved.',
    };
  }

  if (runtime.hasVisibleResponseText) {
    return {
      title: 'Assistant response captured',
      detail: 'Reply delivered cleanly.',
    };
  }

  if (isPendingRequestState(runtime)) {
    return {
      title: 'Message sent',
      detail: 'Reply will appear when ready.',
    };
  }

  return {
    title: 'Assistant ready',
    detail: 'Conversation is available.',
  };
}

type AuditInfoRowProps = {
  label: string;
  value: string;
  testID?: string;
};

const AuditInfoRow = React.memo(function AuditInfoRow({ label, value, testID }: AuditInfoRowProps) {
  const normalizedValue = safeTrim(value).length > 0 ? value : '—';

  return (
    <View style={styles.backendAuditRow} testID={testID}>
      <Text style={styles.backendAuditLabel}>{label}</Text>
      <Text style={styles.backendAuditValue}>{normalizedValue}</Text>
    </View>
  );
});

const IVX_OWNER_MESSAGES_QUERY_KEY = ['ivx-owner-ai', 'messages'] as const;
const IVX_OWNER_CONVERSATION_QUERY_KEY = ['ivx-owner-ai', 'conversation'] as const;
const IVX_ROOM_STATUS_QUERY_KEY = ['ivx-owner-ai', 'room-status'] as const;
const IVX_CONTROL_ROOM_STATUS_QUERY_KEY = ['ivx-owner-ai', 'control-room-status'] as const;
const CONTROL_ROOM_FALLBACK_ITEMS: IVXControlRoomItem[] = [
  { id: 'supabase-status', label: 'Supabase status', status: 'not_verified', detail: 'not verified' },
  { id: 'supabase-tables', label: 'Supabase tables', status: 'not_verified', detail: 'not verified' },
  { id: 'supabase-auth', label: 'Supabase auth', status: 'not_verified', detail: 'not verified' },
  { id: 'supabase-storage', label: 'Supabase storage', status: 'not_verified', detail: 'not verified' },
  { id: 'supabase-rls', label: 'Supabase RLS policies', status: 'not_verified', detail: 'not verified' },
  { id: 'message-persistence', label: 'Message persistence status', status: 'not_verified', detail: 'not verified' },
  { id: 'ai-response-persistence', label: 'AI response persistence status', status: 'not_verified', detail: 'not verified' },
  { id: 'backend-health', label: 'Backend API health', status: 'not_verified', detail: 'not verified' },
  { id: 'dns-tls', label: 'DNS/TLS status', status: 'not_verified', detail: 'not verified' },
  { id: 'github-repo', label: 'GitHub repo status', status: 'not_verified', detail: 'not verified' },
  { id: 'github-branch', label: 'Current branch', status: 'not_verified', detail: 'not verified' },
  { id: 'github-uncommitted', label: 'Uncommitted files', status: 'not_verified', detail: 'not verified' },
  { id: 'deployment-status', label: 'Deployment status', status: 'not_verified', detail: 'not verified' },
  { id: 'aws-iam', label: 'AWS/IAM status', status: 'not_verified', detail: 'not verified' },
  { id: 'env-checklist', label: 'Environment variable checklist', status: 'not_verified', detail: 'not verified' },
  { id: 'missing-secrets', label: 'Missing secrets checklist', status: 'not_verified', detail: 'not verified' },
  { id: 'logs-summary', label: 'Logs viewer/status summary', status: 'not_connected', detail: 'not connected' },
  { id: 'verification-tests', label: 'Run verification tests', status: 'not_verified', detail: 'not verified' },
  { id: 'fix-queue', label: 'Fix queue / pending blockers', status: 'not_verified', detail: 'not verified' },
  { id: 'export-setup', label: 'Export setup instructions', status: 'available', detail: 'README_IVX_DEPLOYMENT.md, ENVIRONMENT_VARIABLES.md, and IVX_AI_BRAIN_TOOLS.md' },
];
const IVX_OWNER_DRAFT_STORAGE_KEY = 'ivx-owner-ai:conversation-draft:v1';
const IVX_MAX_DRAFT_ATTACHMENTS = 20;
const IVX_OWNER_PINNED_MESSAGES_STORAGE_KEY = 'ivx-owner-ai:pinned-messages:v1';
const AI_PROBE_INTERVAL_MS = 30_000;
const AI_FAST_PROXY_TIMEOUT_MS = 5_000;
const AI_FAST_PROXY_INTERVAL_MS = 60_000;
const OWNER_COMMAND_PREFIX = '/';

/**
 * Frontend build stamp. Bump this string whenever the chat client changes so the
 * owner-only debug panel can prove — on the live device — exactly which client
 * bundle is running. If the panel shows an OLD stamp, the device is still on a
 * stale bundle and repo fixes have NOT reached production yet.
 */
const IVX_FRONTEND_BUILD_STAMP = 'ivx-chat-client-2026-06-10t-owner-debug-panel-v1';

/** A task surfaced inline in the chat so the owner can jump straight to the Live Work monitor. */
type ChatLiveWorkTask = { label: string; isSupabase: boolean; startedAt: string };

const LIVE_WORK_TASK_PATTERNS: readonly { re: RegExp; label: string; supabase?: boolean }[] = [
  { re: /\bcheck\s+supabase\b|\bsupabase\b.*\b(check|status|health|connection|query)\b/i, label: 'Checking Supabase', supabase: true },
  { re: /\bimprove\s+ivx\b|\bself[-\s]?improve\b|\bdaily improvement\b/i, label: 'Improving IVX' },
  { re: /\bdeploy\b|\bship it\b|\bpush to (prod|main|production)\b/i, label: 'Deploying to production' },
  { re: /\b(scan|find|discover)\b.*\b(opportunit|capital|investor|prospect|deal|buyer|partner)\b/i, label: 'Scanning for capital sources' },
  { re: /\b(fix|debug|repair)\b/i, label: 'Running a fix' },
  { re: /\b(audit|verify|run (the )?tests?)\b/i, label: 'Auditing & verifying' },
  { re: /\b(build|create)\b.*\b(feature|screen|module|api|endpoint)\b/i, label: 'Building' },
  { re: /\b(live work|show me.*work|what are you (doing|working))\b/i, label: 'Live work' },
];

/** Exact phrasings that route a chat message straight to the Senior Developer Worker. Shown as empty-state hints. */
const WORKER_TRIGGER_HINTS: readonly string[] = [
  '“Build feature …” / “Build module …”',
  '“Create screen …” / “Create endpoint …”',
  '“Fix bug …” / “Repair …” / “Patch …”',
  '“Refactor …” / “Rewrite …”',
  '“Deploy …” / “Ship to production”',
];

/** Detect whether a sent message kicks off real IVX work so we can surface the Live Work button. */
function detectChatLiveWorkTask(text: string): { label: string; isSupabase: boolean } | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const pattern of LIVE_WORK_TASK_PATTERNS) {
    if (pattern.re.test(trimmed)) {
      return { label: pattern.label, isSupabase: Boolean(pattern.supabase) };
    }
  }
  return null;
}
const DEFAULT_OWNER_AI_CONFIG_AUDIT: IVXOwnerAIConfigAudit = getIVXOwnerAIConfigAudit();

function createInitialAIProxyStatus(): AIProxyStatusSnapshot {
  return {
    status: 'idle',
    observedAt: null,
    url: null,
    model: null,
    gateway: null,
    configured: false,
    deploymentMarker: null,
    error: null,
  };
}

function buildOwnerAIProxyStatusUrl(audit: IVXOwnerAIConfigAudit): string | null {
  const baseUrl = safeTrim(audit.activeBaseUrl).replace(/\/+$/, '');
  return baseUrl ? `${baseUrl}/api/ivx/owner-ai/proxy-status` : null;
}

async function fetchOwnerAIProxyStatus(audit: IVXOwnerAIConfigAudit): Promise<AIProxyStatusSnapshot> {
  const url = buildOwnerAIProxyStatusUrl(audit);
  if (!url) {
    return {
      ...createInitialAIProxyStatus(),
      status: 'error',
      error: audit.configurationError ?? 'Owner AI proxy status URL is not configured.',
    };
  }

  const accessToken = await getIVXAccessToken();
  if (!accessToken) {
    return {
      ...createInitialAIProxyStatus(),
      status: 'blocked',
      observedAt: new Date().toISOString(),
      url,
      error: 'Owner session token is not hydrated yet.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, AI_FAST_PROXY_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
    const runtime = isRecord(payload?.runtime) ? payload.runtime : {};
    const runtimeConfigured = runtime.configured === true;
    const deploymentMarker = typeof payload?.deploymentMarker === 'string' ? payload.deploymentMarker : null;
    const model = typeof runtime.model === 'string' ? runtime.model : null;
    const gateway = typeof runtime.gateway === 'string' ? runtime.gateway : null;
    const error = typeof payload?.error === 'string' ? payload.error : typeof payload?.detail === 'string' ? payload.detail : null;

    if (!response.ok) {
      return {
        status: response.status === 401 || response.status === 403 ? 'blocked' : 'error',
        observedAt: new Date().toISOString(),
        url,
        model,
        gateway,
        configured: false,
        deploymentMarker,
        error: error ?? `Proxy status returned HTTP ${response.status}.`,
      };
    }

    return {
      status: runtimeConfigured ? 'connected' : 'error',
      observedAt: new Date().toISOString(),
      url,
      model,
      gateway,
      configured: runtimeConfigured,
      deploymentMarker,
      error: runtimeConfigured ? null : 'Proxy route is live, but AI gateway configuration is not ready.',
    };
  } catch (error) {
    return {
      ...createInitialAIProxyStatus(),
      status: 'error',
      observedAt: new Date().toISOString(),
      url,
      error: error instanceof Error ? error.message : 'Unable to reach Owner AI proxy status.',
    };
  } finally {
    clearTimeout(timer);
  }
}

function getControlRoomTone(status: IVXControlRoomItemStatus): 'pass' | 'warn' | 'error' | 'pending' {
  if (status === 'verified' || status === 'connected' || status === 'available') {
    return 'pass';
  }
  if (status === 'blocked' || status === 'missing_access' || status === 'not_connected') {
    return 'error';
  }
  return 'pending';
}

function getControlRoomStatusLabel(status: IVXControlRoomItemStatus): string {
  return status.replace(/_/g, ' ');
}

const OWNER_COMMANDS: Record<string, { description: string; handler: (args: string) => string }> = {
  help: {
    description: 'List available owner commands',
    handler: () => {
      const lines = Object.entries(OWNER_COMMANDS).map(([cmd, info]) => `/${cmd} — ${info.description}`);
      return `Available owner commands:\n${lines.join('\n')}`;
    },
  },
  status: {
    description: 'Show current room and AI backend status',
    handler: () => 'Room status: check the header card for live backend status, storage mode, delivery method, and AI health.',
  },
  clear: {
    description: 'Clear local message cache (does not delete server messages)',
    handler: () => 'Local cache cleared. Pull to refresh to reload from server.',
  },
  reconnect: {
    description: 'Force reconnect to the shared room backend',
    handler: () => 'Reconnect triggered. Room status will be re-detected.',
  },
  probe: {
    description: 'Run a health probe on the AI backend',
    handler: () => 'AI health probe triggered. Check the AI indicator for updated status.',
  },
  broadcast: {
    description: 'Send a broadcast notification to all participants',
    handler: (args: string) => {
      if (!safeTrim(args)) return 'Usage: /broadcast <message>';
      return `Broadcast queued: "${safeTrim(args)}". Participants will be notified on next sync.`;
    },
  },
  knowledge: {
    description: 'Ask a knowledge-base question',
    handler: () => 'Knowledge query routed to AI. Response will appear as an assistant reply.',
  },
  proof: {
    description: 'Show the latest live room proof summary',
    handler: () => 'Compiling the latest room proof summary.',
  },
  risk: {
    description: 'Show the highest live chat/runtime risks',
    handler: () => 'Compiling the current risk envelope for chat/runtime.',
  },
  incident: {
    description: 'Show the latest live incident summary',
    handler: () => 'Compiling the latest incident summary for the owner room.',
  },
  deps: {
    description: 'Inspect the active dependency chain for the owner room',
    handler: () => 'Compiling the current dependency chain for the owner room.',
  },
  heal: {
    description: 'Run an allowed intervention, e.g. /heal rerun-proof or /heal clear-stuck',
    handler: (args: string) => safeTrim(args) ? `Preparing allowed intervention: ${safeTrim(args)}` : 'Usage: /heal <rerun-proof|clear-stuck|provider-probe|shared-sync|inbox-sync|transcript>',
  },
  replay: {
    description: 'Replay the latest safe operator intervention',
    handler: () => 'Preparing the latest safe operator intervention for replay.',
  },
  brain: {
    description: 'List the Command Brain commands that run owner surfaces inline',
    handler: () => listCommandBrainCommands(),
  },
  ...Object.fromEntries(
    Object.values(IVX_COMMAND_BRAIN).map((entry) => [
      entry.command,
      {
        description: `${entry.description} (usage: ${entry.usage})`,
        handler: () => getCommandBrainPending(entry.command) ?? `Running /${entry.command}…`,
      },
    ]),
  ),
};

function parseOwnerCommand(text: string): OwnerCommandResult | null {
  const trimmed = safeTrim(text);
  if (!trimmed.startsWith(OWNER_COMMAND_PREFIX)) return null;
  const parts = trimmed.slice(OWNER_COMMAND_PREFIX.length).split(/\s+/);
  const command = (parts[0] ?? '').toLowerCase();
  const args = parts.slice(1).join(' ');
  if (!command) return null;
  const handler = OWNER_COMMANDS[command];
  if (!handler) return { command, args, response: `Unknown command: /${command}. Type /help for available commands.` };
  console.log('[IVXOwnerChatRoute] Owner command detected:', command, 'args:', args);
  return { command, args, response: handler.handler(args) };
}

function buildSensitiveActionConfirmationMessage(input: {
  normalizedText: string;
  requestClass: OwnerRequestClass;
  conversationAccessState: 'fallback_chat_only' | 'full_backend_execution';
  backendAdminVerified: boolean;
}): string {
  const confirmationTarget = input.normalizedText.startsWith('/')
    ? `/confirm ${input.normalizedText}`
    : `confirm ${input.normalizedText}`;
  const confirmationReason = input.requestClass.replace(/_/g, ' ');
  const backendState = input.backendAdminVerified ? 'backend_admin_verified' : 'backend_admin_unverified';

  return [
    'Result: confirmation required',
    `Explanation: Owner-room trust stays active for normal conversation, but ${confirmationReason} needs explicit confirmation before any admin execution is claimed.`,
    `Evidence: owner_room_authenticated · ${backendState} · ${input.conversationAccessState} · destructive_action_requires_confirmation`,
    'Affected dependencies: owner room trust → backend admin execution gate',
    'Operator action log: pending_confirmation',
    'Rollback: not required',
    `Linked proof cards: confirm with ${confirmationTarget}`,
  ].join('\n');
}

function buildFallbackChatOnlyExecutionMessage(input: {
  normalizedText: string;
  requestClass: OwnerRequestClass;
}): string {
  const requestedAction = input.normalizedText || 'the requested action';
  const actionReason = input.requestClass.replace(/_/g, ' ');

  return [
    'Result: blocked',
    `Explanation: Owner room trust is active, but ${actionReason} requires verified backend admin access. I can discuss or plan ${requestedAction}, but I will not claim backend/admin execution until verification is restored.`,
    'Evidence: owner_room_authenticated · backend_admin_unverified',
    'Affected dependencies: owner room trust → fallback runtime → backend admin execution gate',
    'Operator action log: chat_only_limit',
    'Rollback: not required',
    'Linked proof cards: wait for backend_admin_verified or continue with normal chat',
  ].join('\n');
}

function buildLocalSafeActionConfirmationMessage(input: {
  normalizedText: string;
  requestClass: OwnerRequestClass;
}): string {
  const requestedAction = safeTrim(input.normalizedText) || 'this action';
  const readableClass = input.requestClass.replace(/_/g, ' ');
  return [
    'Confirmation needed before I proceed.',
    `This looks like a ${readableClass} request: “${requestedAction}”.`,
    'Reply with “confirm” followed by the same request if you want me to continue. I can also help plan it safely first.',
  ].join('\n');
}

function getDeliveryBranchStatus(audit: IVXOwnerSendAudit | null): DeliveryBranchStatus {
  if (!audit) {
    return {
      branch: 'not_observed',
      title: 'send path pending proof',
      detail: 'No completed owner-room send has been captured in this session yet.',
      evidence: 'Send one message now to capture DB/local/auth branch evidence.',
    };
  }

  if (audit.transport === 'remote_db_insert') {
    return {
      branch: 'remote_db_insert',
      title: 'remote db insert',
      detail: 'The last owner-room write reached shared Supabase persistence.',
      evidence: `${audit.messageId} · ${audit.reason}`,
    };
  }

  if (audit.transport === 'auth_session_failure') {
    return {
      branch: 'auth_session_failure',
      title: 'auth/session failure',
      detail: 'The last owner-room write could not use shared persistence because owner auth/session was unavailable.',
      evidence: `${audit.messageId} · ${audit.reason}`,
    };
  }

  return {
    branch: 'local_fallback',
    title: 'local fallback',
    detail: 'The last owner-room write fell back to local-only persistence after the shared path failed.',
    evidence: `${audit.messageId} · ${audit.reason}`,
  };
}

function getReceiveBranchStatus(audit: IVXOwnerReceiveAudit | null): ReceiveBranchStatus {
  if (!audit) {
    return {
      branch: 'not_observed',
      title: 'receive path pending proof',
      detail: 'No owner-room receive event has been captured in this session yet.',
      evidence: 'Wait for a fresh inbound message or realtime echo to capture receive-branch proof.',
    };
  }

  if (audit.transport === 'realtime_event') {
    return {
      branch: 'realtime_event',
      title: 'realtime event',
      detail: 'The last inbound owner-room message was delivered through the realtime subscription.',
      evidence: `${audit.messageId} · ${audit.reason}`,
    };
  }

  return {
    branch: 'local_listener',
    title: 'local listener',
    detail: 'The last inbound owner-room message was delivered through the local fallback listener.',
    evidence: `${audit.messageId} · ${audit.reason}`,
  };
}

const DateSeparator = React.memo(function DateSeparator({ value }: { value: string }) {
  return (
    <View style={styles.dateSeparatorRow} testID={`ivx-owner-date-separator-${formatMessageDateKey(value)}`}>
      <View style={styles.dateSeparatorLine} />
      <Text style={styles.dateSeparatorText}>{formatMessageDateLabel(value)}</Text>
      <View style={styles.dateSeparatorLine} />
    </View>
  );
});

export default function IVXOwnerChatRoute() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const flatListRef = useRef<FlatList<IVXMessage> | null>(null);
  const composerInputRef = useRef<TextInput | null>(null);
  const composerValueRef = useRef<string>('');
  const highlightedMessageTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingJumpMessageIdRef = useRef<string | null>(null);
  const suppressAutoScrollUntilRef = useRef<number>(0);
  const lastNonKeyboardRootHeightRef = useRef<number>(0);
  const isAtBottomRef = useRef<boolean>(true);
  const prevMessageCountRef = useRef<number>(0);
  const prevSearchActiveRef = useRef<boolean>(false);
  const lastScrolledConversationIdRef = useRef<string | null>(null);
  // OPEN-ON-LATEST FIX: tracks whether the chat still needs to be anchored to
  // the newest message after first load / conversation switch. Kept as React
  // state (not a ref) so a dedicated retry effect can re-render and keep trying
  // until the FlatList actually reports it is at the bottom. Prevents the race
  // where scrollToEnd / scrollToIndex fail silently before dynamic message
  // bubbles have been measured.
  const [initialScrollPending, setInitialScrollPending] = useState<boolean>(true);
  const insets = useSafeAreaInsets();
  const { user, userId, isLoading, isAuthenticated, userRole, loginOwnerPasswordless } = useAuth();
  const [composerValue, setComposerValue] = useState<string>('');
  const [messageSearchQuery, setMessageSearchQuery] = useState<string>('');
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [pinnedMessageIds, setPinnedMessageIds] = useState<string[]>([]);
  const [selectedReplyContext, setSelectedReplyContext] = useState<ChatReplyContext | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [missingReplyMessageId, setMissingReplyMessageId] = useState<string | null>(null);
  const pinnedMessagesRestoreCompletedRef = useRef<boolean>(false);
  const [isPickingFile, setIsPickingFile] = useState<boolean>(false);
  const [draftAttachments, setDraftAttachments] = useState<{ upload: IVXUploadInput; isImage: boolean; isVideo: boolean }[]>([]);
  const [composerHeight, setComposerHeight] = useState<number>(0);
  const [composerInputHeight, setComposerInputHeight] = useState<number>(44);
  const [keyboardInset, setKeyboardInset] = useState<number>(0);
  const [rootLayoutHeight, setRootLayoutHeight] = useState<number>(0);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  // Build-information diagnostics banner: ALWAYS hidden by default. The owner
  // can reopen it from Owner Control → Diagnostics → Build Information. The
  // closed state is persisted across app restarts so production never shows
  // the overlay unless explicitly requested.
  // Diagnostics overlay removed — moved to protected /admin/diagnostics route.
  // The chat screen no longer renders a floating diagnostics panel.
  // Owner session gate removed: chat composer is always usable without requiring
  // a separate owner verification step. The preflight state is kept ready for
  // backwards compatibility with any diagnostics that still inspect it.
  const ownerSessionPreflight = { state: 'ready' as const };
  const [passwordlessLoading, setPasswordlessLoading] = useState<boolean>(false);
  const [showScrollToLatest, setShowScrollToLatest] = useState<boolean>(false);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const isOpenAccessBuild = isOpenAccessModeEnabled();
  const localFirstChatMode = useMemo<boolean>(() => isIVXLocalFirstChatEnabled(), []);
  const ownerId = useMemo<string>(() => user?.id ?? userId ?? (isOpenAccessBuild || localFirstChatMode ? 'ivx-local-owner' : ''), [isOpenAccessBuild, localFirstChatMode, user?.id, userId]);
  const ownerLabel = useMemo<string>(() => safeTrim(user?.email) || (localFirstChatMode ? 'IVX Owner' : isOpenAccessBuild ? 'IVX Owner Dev' : 'IVX Owner'), [isOpenAccessBuild, localFirstChatMode, user?.email]);
  const devTestMode = useMemo(() => resolveDevTestModeContext({ userId: ownerId, email: user?.email }), [ownerId, user?.email]);
  const ownerAIConfigAudit = useMemo<IVXOwnerAIConfigAudit>(() => {
    try {
      return getIVXOwnerAIConfigAudit();
    } catch (error) {
      console.log('[IVXOwnerChatRoute] Owner AI config audit fallback used:', error instanceof Error ? error.message : 'unknown');
      return DEFAULT_OWNER_AI_CONFIG_AUDIT;
    }
  }, []);
  const liveSnapshot = useLiveIntelligenceSnapshot();
  const ownerSessionIdRef = useRef<string>(`ivx-owner-room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  // Active IVX Owner AI watchdog traces, keyed by traceId. Threaded through
  // mutation inputs so each send has its own checkpoint report.
  const activeWatchdogTracesRef = useRef<Map<string, WatchdogTraceHandle>>(new Map());
  const [watchdogDrawerVisible, setWatchdogDrawerVisible] = useState<boolean>(false);
  // Staged timeout banner state — replaces the single 180s watchdog timeout
  // with progressive UX: 15s "Still working", 45s retry, 90s backend status
  // check, 180s fail with exact evidence. No infinite spinner.
  const [stagedTimeoutTraceId, setStagedTimeoutTraceId] = useState<string | null>(null);
  const [stagedTimeoutMessageId, setStagedTimeoutMessageId] = useState<string>('');
  const [stagedTimeoutRequestStarted, setStagedTimeoutRequestStarted] = useState<boolean>(false);
  const [stagedTimeoutLastCheckpoint, setStagedTimeoutLastCheckpoint] = useState<string | null>(null);
  const orchestratorRef = useRef<AIOrchestrator | null>(null);
  const stagedTimeoutStartRef = useRef<number>(Date.now());
  const [liveWorkVisible, setLiveWorkVisible] = useState<boolean>(false);
  // The task most recently kicked off from chat, surfaced as an inline Live Work
  // button so the owner can jump straight to the real-time execution monitor.
  const [activeLiveWorkTask, setActiveLiveWorkTask] = useState<ChatLiveWorkTask | null>(null);

  // One-tap owner sign-in is no longer required to use the chat composer.
  // The helper is kept as a no-op stub so any existing callers do not break.
  const handlePasswordlessOwnerSignIn = useCallback(async () => {
    console.log('[IVXOwnerChatRoute] Owner sign-in gate removed; no-op sign-in invoked.');
  }, []);

  // Owner-session gate removed: the chat composer is always available. Any
  // auth requirements are handled transparently by the underlying chat service.
  // This useEffect is intentionally left empty to preserve hook order stability.
  useEffect(() => {
    console.log('[IVXOwnerChatRoute] Owner session gate disabled; composer ready for all users.');
  }, [ownerId, user?.email]);

  // P0 durable-task restore (503-recovery mandate Phase 4): after an app
  // restart, re-poll any pending durable tasks so recovered answers are
  // restored instead of lost.
  useEffect(() => {
    let mounted = true;
    void resumePendingDurableTasks((task) => {
      if (!mounted || !task.answer) return;
      if (task.status !== 'VERIFIED' && task.status !== 'COMPLETED') return;
      const restoredId = createTransientMessageId('ivx-owner-ai-durable-restored');
      setTransientAssistantMessages((current) => [
        ...current.filter((message) => message.id !== restoredId),
        buildVisibleAssistantTransient({
          id: restoredId,
          conversationId: 'ivx-owner-room',
          body: `${task.answer}\n\n♻️ Restored from durable task ${task.taskId} after app restart.`,
        }),
      ]);
    }).catch((restoreErr) => {
      console.log('[IVXOwnerChatRoute] durable_restore_failed_safely:', restoreErr instanceof Error ? restoreErr.message : 'unknown');
    });
    return () => { mounted = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Diagnostics overlay removed — moved to protected /admin/diagnostics route.
  // The button in the control room now navigates to /admin/diagnostics instead.
  // Overlay lifecycle hardening: close the live-work overlay automatically
  // when the app backgrounds, when the screen unmounts, or when navigation
  // pulls the route off. Prevents ghost overlays + stale poller activity.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
      if (next !== 'active') {
        setLiveWorkVisible(false);
        setWatchdogDrawerVisible(false);
      }
    });
    return () => {
      sub.remove();
      setLiveWorkVisible(false);
      setWatchdogDrawerVisible(false);
    };
  }, []);
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const recorderState = useAudioRecorderState(audioRecorder);

  const roomStatusQuery = useQuery<ChatRoomStatus, Error>({
    queryKey: IVX_ROOM_STATUS_QUERY_KEY,
    queryFn: async () => {
      console.log('[IVXOwnerChatRoute] Detecting IVX room status via ivx_* tables');
      try {
        const status = await detectIVXRoomStatus();
        console.log('[IVXOwnerChatRoute] IVX room status result:', status.storageMode, status.deliveryMethod);
        setRoomProbeAt(new Date().toISOString());
        return status;
      } catch (error) {
        console.log('[IVXOwnerChatRoute] Room status detection failed:', error instanceof Error ? error.message : 'unknown');
        if (!isOpenAccessBuild) {
          throw error instanceof Error ? error : new Error('Unable to detect owner room status.');
        }

        setRoomProbeAt(new Date().toISOString());
        return {
          storageMode: 'local_device_only',
          visibility: 'local_only',
          deliveryMethod: 'local_only',
          warning: 'Open-access development mode is active. The owner room stays usable locally while live room detection recovers.',
        };
      }
    },
    staleTime: 25_000,
    refetchInterval: 60_000,
  });

  const ivxRoomStatus: ChatRoomStatus | null = roomStatusQuery.data ?? null;

  // DISAPPEAR-FIX (2026-07-05): ref mirror of the last non-empty messages data.
  // Used by the messagesQuery `select` to keep the prior thread visible when a
  // transient empty refetch lands (e.g. canonical conversation id briefly
  // diverged from the id messages were saved under). Prevents the chat from
  // blanking while the service-layer recovery repopulates the canonical id.
  const lastNonEmptyMessagesRef = useRef<IVXMessage[] | null>(null);

  const messagesQuery = useQuery<IVXMessage[], Error>({
    queryKey: IVX_OWNER_MESSAGES_QUERY_KEY,
    queryFn: async () => {
      console.log('[IVXOwnerChatRoute] Loading owner messages');
      try {
        const loaded = await ivxChatService.listOwnerMessages();
        // Proof-first hydration log: prove the thread re-hydrates on mount /
        // refresh / route change with a real message count, not an empty reset.
        console.log('[IVXChatStateProof] hydration_ok', {
          room: IVX_OWNER_AI_PROFILE.sharedRoom.id,
          sessionId: ownerSessionIdRef.current,
          hydratedMessageCount: loaded.length,
          localFirstChatMode,
          platform: Platform.OS,
        });
        return loaded;
      } catch (error) {
        console.log('[IVXChatStateProof] hydration_failed', {
          reason: error instanceof Error ? error.message : 'unknown',
          isOpenAccessBuild,
        });
        if (!isOpenAccessBuild) {
          throw error instanceof Error ? error : new Error('Unable to load owner messages.');
        }

        return [];
      }
    },
    // Keep the loaded conversation in cache long enough that a route change /
    // tab switch / quick reload never blanks the chat before the refetch lands.
    // The durable local mirror (ivxChatService) backs a full page reload.
    gcTime: 24 * 60 * 60 * 1000,
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    // DISAPPEAR-FIX (2026-07-05): a transient empty refetch (e.g. the canonical
    // conversation id briefly diverging from the id messages were saved under)
    // must NEVER blank the rendered thread. If a fresh fetch returns an empty
    // array while we already have non-empty cached data, keep the cached data
    // visible. The durable local mirror + cross-conversation recovery in the
    // service layer will repopulate the canonical id on the next successful load.
    select: (data: IVXMessage[]) => {
      if (data.length > 0) {
        lastNonEmptyMessagesRef.current = data;
        return data;
      }
      if (lastNonEmptyMessagesRef.current && lastNonEmptyMessagesRef.current.length > 0) {
        console.log('[IVXChatStateProof] preserving cached messages over empty refetch', {
          cachedCount: lastNonEmptyMessagesRef.current.length,
        });
        return lastNonEmptyMessagesRef.current;
      }
      return data;
    },
  });
  const conversationQuery = useQuery({
    queryKey: IVX_OWNER_CONVERSATION_QUERY_KEY,
    queryFn: async () => {
      console.log('[IVXOwnerChatRoute] Bootstrapping owner conversation');
      try {
        return await ivxChatService.bootstrapOwnerConversation();
      } catch (error) {
        console.log('[IVXOwnerChatRoute] Owner conversation bootstrap failed:', error instanceof Error ? error.message : 'unknown');
        if (!isOpenAccessBuild) {
          throw error instanceof Error ? error : new Error('Unable to open the owner room.');
        }

        return {
          id: 'ivx-owner-room',
          slug: 'ivx-owner-room',
          title: IVX_OWNER_AI_PROFILE.sharedRoom.title,
          subtitle: 'Open-access development room',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          lastMessageText: null,
          lastMessageAt: null,
        };
      }
    },
  });
  const messages = messagesQuery.data ?? [];
  // CONVERSATION-ID FIX (2026-06-10): the backend-returned conversation id,
  // adopted as canonical after every owner-ai response and persisted durably.
  // `canonicalConversationId` is the SINGLE id every save AND every restore keys
  // off, so the id used to save always equals the id used to restore. All
  // alternate fallbacks (slug literals, locally generated room ids,
  // IVX_OWNER_AI_PROFILE.sharedRoom.id) are removed in favour of this resolver.
  const [adoptedConversationId, setAdoptedConversationId] = useState<string | null>(null);
  const [conversationIdProof, setConversationIdProof] = useState<{
    clientBeforeSend: string | null;
    backendReturned: string | null;
    usedForSave: string | null;
    usedForRestore: string | null;
  }>({ clientBeforeSend: null, backendReturned: null, usedForSave: null, usedForRestore: null });
  const canonicalConversationId = useMemo<string>(() => {
    return safeTrim(adoptedConversationId)
      || safeTrim(conversationQuery.data?.id)
      || IVX_OWNER_AI_ROOM_ID;
  }, [adoptedConversationId, conversationQuery.data?.id]);
  const canonicalConversationIdRef = useRef<string>(canonicalConversationId);
  useEffect(() => {
    canonicalConversationIdRef.current = canonicalConversationId;
  }, [canonicalConversationId]);
  // On mount, restore the durably-adopted canonical id so the SAME conversation
  // (and its saved messages) is keyed identically after an app close/reopen.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await ivxChatService.getCanonicalConversationId();
        if (!cancelled && stored) {
          setAdoptedConversationId((current) => current ?? stored);
          setConversationIdProof((current) => ({
            ...current,
            usedForRestore: current.usedForRestore ?? stored,
          }));
          console.log('[IVXConversationId] Restored canonical conversation id on mount:', stored);
        }
      } catch (error) {
        console.log('[IVXConversationId] Canonical id restore failed:', error instanceof Error ? error.message : 'unknown');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  // Adopt the backend-returned conversation id as canonical after a response.
  const adoptCanonicalConversationId = useCallback((backendConversationId: string | null | undefined): string => {
    const clientBeforeSend = canonicalConversationIdRef.current;
    const trimmedBackend = safeTrim(backendConversationId);
    const nextCanonical = trimmedBackend || clientBeforeSend;
    if (trimmedBackend && trimmedBackend !== clientBeforeSend) {
      setAdoptedConversationId(trimmedBackend);
      void ivxChatService.setCanonicalConversationId(trimmedBackend);
      console.log('[IVXConversationId] Adopted backend conversation id as canonical:', {
        clientBeforeSend,
        backendReturned: trimmedBackend,
      });
    }
    setConversationIdProof({
      clientBeforeSend,
      backendReturned: trimmedBackend || null,
      usedForSave: nextCanonical,
      usedForRestore: nextCanonical,
    });
    return nextCanonical;
  }, []);
  const transcribeVoiceMutation = useMutation<string, Error, string>({
    mutationFn: async (uri) => {
      await recordIVXOwnerChatAuditEvent({
        action: 'voice_transcription',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        status: 'started',
        summary: 'Owner voice transcription started.',
        metadata: { platform: Platform.OS, sessionId: ownerSessionIdRef.current },
      });
      const result = await transcribeAudioRecording({
        uri,
        fileName: Platform.OS === 'web' ? 'ivx-owner-voice.webm' : 'ivx-owner-voice.m4a',
        mimeType: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a',
      });
      return result.text;
    },
    onSuccess: (transcript) => {
      const normalizedTranscript = normalizeComposerText(transcript).trim();
      if (!normalizedTranscript) {
        Alert.alert('Voice not transcribed', 'No speech was detected in that recording.');
        void recordIVXOwnerChatAuditEvent({
          action: 'voice_transcription',
          conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
          status: 'failed',
          summary: 'Voice transcription completed without usable speech.',
          metadata: { sessionId: ownerSessionIdRef.current },
        });
        return;
      }

      const currentText = normalizeComposerText(composerValueRef.current).trim();
      const nextText = currentText ? `${currentText}\n${normalizedTranscript}` : normalizedTranscript;
      composerValueRef.current = nextText;
      setComposerValue(nextText);
      setComposerInputHeight(Math.min(Math.max(Math.ceil(nextText.length / 28) * 22 + 22, 44), 112));
      composerInputRef.current?.focus();
      void recordIVXOwnerChatAuditEvent({
        action: 'voice_transcription',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        status: 'success',
        summary: 'Voice transcription inserted into the IVX Owner AI composer.',
        metadata: { transcriptLength: normalizedTranscript.length, sessionId: ownerSessionIdRef.current },
      });
    },
    onError: (error) => {
      console.log('[IVXOwnerChatRoute] Voice transcription error:', error.message);
      void recordIVXOwnerChatAuditEvent({
        action: 'voice_transcription',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        status: 'failed',
        summary: 'Voice transcription failed.',
        metadata: { error: error.message, sessionId: ownerSessionIdRef.current },
      });
      Alert.alert('Voice transcription unavailable', error.message || 'We could not transcribe that recording. Please try again.');
    },
  });
  type OwnerAIAuthState = 'AUTH_INITIALIZING' | 'SIGNED_OUT' | 'SESSION_REFRESHING' | 'SIGNED_IN_MEMBER' | 'SIGNED_IN_OWNER' | 'AUTH_ERROR';
  const ownerAIAuthState = useMemo<OwnerAIAuthState>(() => {
    if (isLoading) return 'AUTH_INITIALIZING';
    if (!isAuthenticated || !user) return 'SIGNED_OUT';
    if (isAdminRole(userRole)) return 'SIGNED_IN_OWNER';
    return 'SIGNED_IN_MEMBER';
  }, [isLoading, isAuthenticated, user, userRole]);
  const ownerAIAuthReady = ownerAIAuthState === 'SIGNED_IN_OWNER';
  const ownerRoomAuthenticated = useMemo<boolean>(() => {
    if (devTestMode.testModeActive) {
      return true;
    }
    const normalizedConversationId = safeTrim(conversationQuery.data?.id);
    const normalizedConversationSlug = safeTrim(conversationQuery.data?.slug);
    return localFirstChatMode
      || isOpenAccessBuild
      || ownerAIAuthReady
      || !!userId
      || normalizedConversationId === IVX_OWNER_AI_PROFILE.sharedRoom.id
      || normalizedConversationSlug === IVX_OWNER_AI_PROFILE.sharedRoom.slug;
  }, [conversationQuery.data?.id, conversationQuery.data?.slug, devTestMode.testModeActive, isOpenAccessBuild, localFirstChatMode, ownerAIAuthReady, userId]);
  const controlRoomQuery = useQuery<IVXControlRoomStatus, Error>({
    queryKey: IVX_CONTROL_ROOM_STATUS_QUERY_KEY,
    queryFn: getIVXControlRoomStatus,
    enabled: ownerRoomAuthenticated,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  const [transientAssistantMessages, setTransientAssistantMessages] = useState<IVXMessage[]>([]);
  // FINAL IVX IA CHAT EXECUTION MODE (owner mandate 2026-07-19): side-channel
  // map from transient assistant message id → the 9-field executionStatus payload
  // the backend attached to its 202 response. Kept outside IVXMessage (which is
  // the persisted Supabase row shape) so we don't widen the DB schema. The
  // renderMessage callback reads this map to decide whether to render a
  // live-polling ExecutionConsoleBubble instead of a plain MessageBubble.
  const [executionStatusByMessageId, setExecutionStatusByMessageId] = useState<Map<string, IVXExecutionStatusPayload>>(new Map());
  const [pendingOwnerMessages, setPendingOwnerMessages] = useState<PendingOwnerMessage[]>([]);
  const draftRestoreCompletedRef = useRef<boolean>(false);
  const uploadProgressTimersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});
  const normalizedComposerValue = useMemo<string>(() => normalizeComposerText(composerValue), [composerValue]);
  const composerHasText = safeTrim(normalizedComposerValue).length > 0;
  const allMessages = useMemo<IVXMessage[]>(() => {
    const visiblePersistentMessages = messages.filter((message) => !isInternalTranscriptMessage(message));
    const persistentAssistantBodies = new Set(
      visiblePersistentMessages
        .filter((message) => message.senderRole === 'assistant')
        .map((message) => safeTrim(message.body))
        .filter((body) => body.length > 0),
    );
    const visibleTransientAssistantMessages = transientAssistantMessages.filter((message) => {
      if (isInternalTranscriptMessage(message)) {
        return false;
      }

      if (message.senderRole !== 'assistant') {
        return true;
      }

      return safeTrim(message.body).length > 0;
    });
    const transientIds = new Set(visibleTransientAssistantMessages.map((message) => message.id));
    const transientAssistantBodies = new Set(
      visibleTransientAssistantMessages
        .filter((message) => message.senderRole === 'assistant')
        .map((message) => safeTrim(message.body))
        .filter((body) => body.length > 0),
    );
    // Content keys of owner turns ALREADY persisted remotely. A still-pending
    // (non-failed) optimistic owner message whose text matches one of these is
    // the SAME turn that just landed in the DB — suppress the optimistic copy so
    // a just-sent message is never shown twice during the success→refetch window.
    const remoteOwnerContentKeys = new Set(
      visiblePersistentMessages
        .filter((message) => message.senderRole === 'owner' && !message.attachmentUrl)
        .map((message) => safeTrim(message.body).toLowerCase())
        .filter((body) => body.length > 0),
    );
    const deduped = new Map<string, IVXMessage>();

    for (const pendingMessage of pendingOwnerMessages) {
      const normalizedPendingText = safeTrim(pendingMessage.text);
      const pendingUpload = pendingMessage.upload ?? null;
      if (!normalizedPendingText && !pendingUpload) {
        continue;
      }
      // A non-failed text turn already mirrored remotely → drop the optimistic
      // duplicate (the authoritative remote row renders instead). Failed turns
      // stay so the retry/dismiss card remains visible.
      if (
        pendingMessage.status !== 'failed'
        && pendingMessage.mode !== 'attachment'
        && !pendingUpload
        && normalizedPendingText.length > 0
        && remoteOwnerContentKeys.has(normalizedPendingText.toLowerCase())
      ) {
        continue;
      }

      const uploadProgress = typeof pendingMessage.uploadProgress === 'number'
        ? Math.max(0, Math.min(100, Math.round(pendingMessage.uploadProgress)))
        : null;
      const uploadStatusText = pendingMessage.mode === 'attachment' && pendingMessage.status !== 'failed'
        ? pendingMessage.status === 'uploaded'
          ? `Uploaded ${pendingUpload?.name ?? 'attachment'} successfully`
          : uploadProgress != null
            ? `Uploading ${pendingUpload?.name ?? 'attachment'} • ${uploadProgress}%`
            : `Preparing ${pendingUpload?.name ?? 'attachment'}...`
        : pendingMessage.errorMessage ?? normalizedPendingText;

      deduped.set(pendingMessage.clientId, {
        id: pendingMessage.clientId,
        conversationId: conversationQuery.data?.id ?? 'ivx-owner-room',
        senderUserId: ownerId || null,
        senderRole: 'owner',
        senderLabel: ownerLabel,
        body: pendingMessage.status === 'failed' ? (pendingMessage.errorMessage ?? pendingMessage.text) : (pendingMessage.mode === 'attachment' ? uploadStatusText : pendingMessage.text),
        attachmentUrl: pendingUpload?.uri ?? null,
        attachmentName: pendingUpload?.name ?? null,
        attachmentMime: pendingUpload?.type ?? null,
        attachmentSize: pendingUpload?.size ?? null,
        attachmentKind: pendingUpload ? getAttachmentKindFromUpload(pendingUpload) : 'text',
        createdAt: pendingMessage.createdAt,
        updatedAt: pendingMessage.createdAt,
        sendStatus: pendingMessage.status,
        replyTo: pendingMessage.replyTo ?? null,
      } as IVXMessage & { sendStatus: PendingOwnerMessage['status']; replyTo?: ChatReplyContext | null });
    }

    // GUARANTEE-BUBBLE DEDUP:
    // Prefer the transient assistant bubble over the persistent row when bodies
    // match. The transient was just produced locally for THIS reply, so it is
    // the most reliable source of truth that a bubble must render. The
    // persistent row may arrive late, be filtered by isInternalTranscriptMessage,
    // be role-mismatched by the backend, or have a body that subtly diverges
    // from the transient (badge / tool label). On cold reload the transient is
    // gone and the persistent row renders normally — no duplicates over time.
    let droppedDuplicatePersistents = 0;
    for (const message of visiblePersistentMessages) {
      const normalizedBody = safeTrim(message.body);
      const isDuplicateOfActiveTransient = message.senderRole === 'assistant'
        && !transientIds.has(message.id)
        && normalizedBody.length > 0
        && transientAssistantBodies.has(normalizedBody);

      if (isDuplicateOfActiveTransient) {
        droppedDuplicatePersistents += 1;
        continue;
      }

      deduped.set(message.id, message);
    }
    // Deduplicate execution-mode assistant messages by taskId. When the same
    // worker taskId is returned for multiple requests (per-owner single-flight
    // or retries), keep only the newest transient bubble so the chat shows
    // exactly one terminal response per task instead of repeated BLOCKED messages.
    const taskIdSeen = new Map<string, IVXMessage>();
    for (const message of visibleTransientAssistantMessages) {
      if (!message.taskId) {
        if (!deduped.has(message.id)) {
          deduped.set(message.id, message);
        }
        continue;
      }
      const existing = taskIdSeen.get(message.taskId);
      if (!existing || new Date(message.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
        taskIdSeen.set(message.taskId, message);
      }
    }
    for (const message of taskIdSeen.values()) {
      if (!deduped.has(message.id)) {
        deduped.set(message.id, message);
      }
    }
    const finalMessages = Array.from(deduped.values()).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    return finalMessages;
  }, [conversationQuery.data?.id, messages, ownerId, ownerLabel, pendingOwnerMessages, transientAssistantMessages]);

  // DURABLE ANTI-DISAPPEAR MIRROR:
  // Every committed/rendered owner + assistant turn is written into the durable
  // local shadow as soon as it is shown. This guarantees the conversation
  // survives a reload / route change even when the next remote read does not
  // return a message (conversation-id mismatch or a transient remote-read
  // failure) — the merge in listOwnerMessages always restores the shadow.
  // Pending/failed/in-flight turns are excluded so only real delivered content
  // is persisted; the helper dedupes so this is idempotent.
  const durableMirrorPayload = useMemo<IVXMessage[]>(() => {
    return allMessages.filter((message) => {
      if (isInternalTranscriptMessage(message)) {
        return false;
      }
      const sendStatus = (message as IVXMessage & { sendStatus?: PendingOwnerMessage['status'] }).sendStatus;
      if (sendStatus === 'failed' || sendStatus === 'sending' || sendStatus === 'uploading') {
        return false;
      }
      return safeTrim(message.body).length > 0 || !!message.attachmentUrl;
    });
  }, [allMessages]);
  const durableMirrorSignature = useMemo<string>(
    () => durableMirrorPayload.map((message) => `${message.id}:${safeTrim(message.body).length}`).join('|'),
    [durableMirrorPayload],
  );
  useEffect(() => {
    if (durableMirrorPayload.length === 0) {
      return;
    }
    void ivxChatService.appendOwnerMessagesToLocalMirror(durableMirrorPayload);
    // durableMirrorPayload is recomputed in lockstep with the signature; the
    // signature is the dependency so we only re-mirror when content changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durableMirrorSignature]);

  useEffect(() => {
    let mounted = true;

    void (async () => {
      try {
        const rawDraft = await AsyncStorage.getItem(IVX_OWNER_DRAFT_STORAGE_KEY);
        if (!mounted) {
          return;
        }

        if (!rawDraft) {
          draftRestoreCompletedRef.current = true;
          return;
        }

        const parsed = JSON.parse(rawDraft) as Partial<OwnerConversationDraft>;
        const restoredText = typeof parsed.text === 'string' ? parsed.text : '';
        const restoredAttachmentDrafts = Array.isArray(parsed.attachmentDrafts)
          ? parsed.attachmentDrafts.filter((message): message is PendingOwnerMessage => {
            const candidate = message as Partial<PendingOwnerMessage>;
            return candidate.mode === 'attachment'
              && candidate.status === 'failed'
              && typeof candidate.clientId === 'string'
              && typeof candidate.createdAt === 'string'
              && typeof candidate.text === 'string'
              && typeof candidate.upload?.uri === 'string'
              && typeof candidate.upload?.name === 'string';
          })
          : [];

        composerValueRef.current = restoredText;
        setComposerValue(restoredText);
        if (restoredText.length > 0) {
          setComposerInputHeight(Math.min(Math.max(Math.ceil(restoredText.length / 28) * 22 + 22, 44), 112));
        }
        if (restoredAttachmentDrafts.length > 0) {
          setPendingOwnerMessages((current) => {
            const existingIds = new Set(current.map((message) => message.clientId));
            return [...restoredAttachmentDrafts.filter((message) => !existingIds.has(message.clientId)), ...current];
          });
        }
        draftRestoreCompletedRef.current = true;
        console.log('[IVXOwnerChatRoute] Restored owner draft:', { textLength: restoredText.length, attachmentDraftCount: restoredAttachmentDrafts.length });
      } catch (error) {
        draftRestoreCompletedRef.current = true;
        console.log('[IVXOwnerChatRoute] Failed to restore owner draft:', error instanceof Error ? error.message : 'unknown');
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!draftRestoreCompletedRef.current) {
      return;
    }

    const draftText = composerValueRef.current;
    const attachmentDrafts = pendingOwnerMessages.filter((message) => message.mode === 'attachment' && message.status === 'failed' && message.upload);
    const hasDraft = safeTrim(draftText).length > 0 || attachmentDrafts.length > 0;
    const timeout = setTimeout(() => {
      void (async () => {
        try {
          if (!hasDraft) {
            await AsyncStorage.removeItem(IVX_OWNER_DRAFT_STORAGE_KEY);
            console.log('[IVXOwnerChatRoute] Cleared owner draft storage');
            return;
          }

          const draft: OwnerConversationDraft = {
            text: draftText,
            attachmentDrafts,
            updatedAt: new Date().toISOString(),
          };
          await AsyncStorage.setItem(IVX_OWNER_DRAFT_STORAGE_KEY, JSON.stringify(draft));
          console.log('[IVXOwnerChatRoute] Saved owner draft:', { textLength: draftText.length, attachmentDraftCount: attachmentDrafts.length });
        } catch (error) {
          console.log('[IVXOwnerChatRoute] Failed to persist owner draft:', error instanceof Error ? error.message : 'unknown');
        }
      })();
    }, 250);

    return () => clearTimeout(timeout);
  }, [composerValue, pendingOwnerMessages]);

  const normalizedMessageSearchQuery = useMemo<string>(() => safeTrim(messageSearchQuery).toLowerCase(), [messageSearchQuery]);
  const displayedMessages = useMemo<IVXMessage[]>(() => {
    return normalizedMessageSearchQuery
      ? allMessages.filter((message) => safeTrim(message.body).toLowerCase().includes(normalizedMessageSearchQuery))
      : allMessages;
  }, [allMessages, normalizedMessageSearchQuery]);
  const searchActive = normalizedMessageSearchQuery.length > 0;

  // Watchdog: report MESSAGE_ARRAY_MERGED / FILTER_VISIBLE_PASSED / DEDUP_PASSED
  // / SEARCH_PIN_FILTER_PASSED for every active trace as soon as its bound
  // assistant transient id surfaces in the relevant pipeline stage.
  useEffect(() => {
    if (activeWatchdogTracesRef.current.size === 0) return;
    const allIds = new Set(allMessages.map((m) => m.id));
    const visibleIds = new Set(displayedMessages.map((m) => m.id));
    const assistantCountAll = allMessages.filter((m) => m.senderRole === 'assistant').length;
    // Build lookup maps for dedup-recovery: when a newer transient with the same
    // taskId supersedes an older one (removed from displayedMessages by taskId
    // dedup at lines ~1396-1413), the trace bound to the old id can still
    // complete because the owner's response IS visible — just via the newer
    // bubble. Also, FlatList windowing means renderMessage is only called for
    // items in the viewport; an off-screen assistant bubble would never trigger
    // RENDER_MESSAGE_CALLED, causing a false 90s SILENT_FAILURE timeout.
    const allMessageById = new Map(allMessages.map((m) => [m.id, m]));
    const visibleTaskIds = new Set<string>();
    for (const message of displayedMessages) {
      if (message.senderRole === 'assistant' && message.taskId) {
        visibleTaskIds.add(message.taskId);
      }
    }
    for (const trace of activeWatchdogTracesRef.current.values()) {
      const report = trace.getReport();
      if (report.finalStatus !== 'PENDING') continue;
      const boundIds = report.assistantTransientIds;
      if (boundIds.length === 0) continue;
      const anyInAll = boundIds.some((id) => allIds.has(id));
      const anyInVisible = boundIds.some((id) => visibleIds.has(id));
      if (anyInAll) {
        trace.pass('MESSAGE_ARRAY_MERGED', `assistantsInAllMessages=${assistantCountAll}`);
        trace.pass('FILTER_VISIBLE_PASSED', 'not removed by isInternalTranscriptMessage');
        trace.pass('DEDUP_PASSED', 'transient retained through dedup');
      }
      if (anyInVisible) {
        trace.pass('SEARCH_PIN_FILTER_PASSED', `searchActive=${searchActive}`);
        // Pass RENDER_MESSAGE_CALLED directly when the bound id is in
        // displayedMessages. FlatList only calls renderMessage for viewport
        // items — an off-screen assistant bubble (e.g. scroll-to-latest
        // hasn't completed yet) would never trigger renderMessage, causing
        // a false 90s SILENT_FAILURE timeout. If the id is in
        // displayedMessages, FlatList WILL render it when it enters view.
        trace.pass('RENDER_MESSAGE_CALLED', 'id in displayedMessages (FlatList renders on view)');
      } else {
        // Dedup recovery: a newer transient with the same taskId may have
        // replaced the bound id in displayedMessages. The owner's response
        // IS visible — just via a newer bubble — so complete the trace.
        const boundTaskIds = new Set<string>();
        for (const boundId of boundIds) {
          const msg = allMessageById.get(boundId);
          if (msg?.taskId) {
            boundTaskIds.add(msg.taskId);
          }
        }
        const anyTaskIdVisible = Array.from(boundTaskIds).some((taskId) => visibleTaskIds.has(taskId));
        if (anyTaskIdVisible) {
          trace.pass('SEARCH_PIN_FILTER_PASSED', 'superseded by newer same-taskId bubble');
          trace.pass('RENDER_MESSAGE_CALLED', 'rendered via newer same-taskId bubble');
          trace.pass('ASSISTANT_BUBBLE_VISIBLE', 'newer same-taskId bubble visible on screen');
          trace.complete('SUCCESS');
        }
      }
    }
  }, [allMessages, displayedMessages, searchActive]);

  const handleViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: { item: IVXMessage }[] }) => {
    if (activeWatchdogTracesRef.current.size === 0) return;
    const visibleIds = new Set(viewableItems.map((v) => v.item.id));
    for (const trace of activeWatchdogTracesRef.current.values()) {
      const report = trace.getReport();
      if (report.finalStatus !== 'PENDING') continue;
      const anyVisible = report.assistantTransientIds.some((id) => visibleIds.has(id));
      if (anyVisible) {
        trace.pass('ASSISTANT_BUBBLE_VISIBLE', 'viewable on screen');
        trace.complete('SUCCESS');
      }
    }
  }).current;
  const pinnedMessageIdSet = useMemo<Set<string>>(() => new Set(pinnedMessageIds), [pinnedMessageIds]);
  const pinnedMessages = useMemo<IVXMessage[]>(() => {
    if (pinnedMessageIds.length === 0) {
      return [];
    }

    return allMessages
      .filter((message) => pinnedMessageIdSet.has(message.id) && !isInternalTranscriptMessage(message))
      .sort((a, b) => pinnedMessageIds.indexOf(a.id) - pinnedMessageIds.indexOf(b.id));
  }, [allMessages, pinnedMessageIdSet, pinnedMessageIds]);

  useEffect(() => {
    let mounted = true;

    void AsyncStorage.getItem(IVX_OWNER_PINNED_MESSAGES_STORAGE_KEY)
      .then((rawPinnedIds) => {
        if (!mounted) {
          return;
        }

        if (!rawPinnedIds) {
          pinnedMessagesRestoreCompletedRef.current = true;
          return;
        }

        const parsed = JSON.parse(rawPinnedIds) as unknown;
        if (Array.isArray(parsed)) {
          const restoredIds = parsed
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .filter((value, index, values) => values.indexOf(value) === index);
          setPinnedMessageIds(restoredIds);
          console.log('[IVXOwnerChatRoute] Restored pinned messages:', restoredIds.length);
        }
        pinnedMessagesRestoreCompletedRef.current = true;
      })
      .catch((error) => {
        pinnedMessagesRestoreCompletedRef.current = true;
        console.log('[IVXOwnerChatRoute] Failed to restore pinned messages:', error instanceof Error ? error.message : 'unknown');
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!pinnedMessagesRestoreCompletedRef.current) {
      return;
    }

    void AsyncStorage.setItem(IVX_OWNER_PINNED_MESSAGES_STORAGE_KEY, JSON.stringify(pinnedMessageIds)).catch((error) => {
      console.log('[IVXOwnerChatRoute] Failed to persist pinned messages:', error instanceof Error ? error.message : 'unknown');
    });
  }, [pinnedMessageIds]);

  useEffect(() => {
    if (pinnedMessageIds.length === 0 || allMessages.length === 0) {
      return;
    }

    const availableIds = new Set(allMessages.map((message) => message.id));
    setPinnedMessageIds((current) => current.filter((messageId) => availableIds.has(messageId)));
  }, [allMessages, pinnedMessageIds.length]);

  useEffect(() => {
    let mounted = true;
    let unsubscribe = () => {};

    void (async () => {
      try {
        const nextUnsubscribe = await ivxChatService.subscribeToOwnerMessages((incomingMessage) => {
          if (!mounted) {
            return;
          }

          queryClient.setQueryData<IVXMessage[]>(IVX_OWNER_MESSAGES_QUERY_KEY, (currentMessages) => {
            const nextMessages = currentMessages ?? [];
            if (nextMessages.some((message) => message.id === incomingMessage.id)) {
              return nextMessages;
            }
            setRealtimeEventsObserved((currentCount) => currentCount + 1);
            return [...nextMessages, incomingMessage];
          });
        }, (status) => {
          if (!mounted) {
            return;
          }
          console.log('[IVXOwnerChatRoute] Realtime subscription state:', status);
          setRealtimeSubscriptionState(status);
        });

        if (!mounted) {
          nextUnsubscribe();
          return;
        }

        unsubscribe = nextUnsubscribe;
      } catch (error) {
        console.log('[IVXOwnerChatRoute] Realtime subscription failed:', error instanceof Error ? error.message : 'unknown');
      }
    })();

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [queryClient]);

  useEffect(() => {
    if (displayedMessages.length === 0) {
      return;
    }

    // Always force a jump-to-end when the conversation FIRST loads / is switched.
    // The thread must open on the newest message so the owner sees the latest
    // conversation immediately, matching WhatsApp/iMessage behavior.
    const activeConversationId = conversationQuery.data?.id ?? 'ivx-owner-room';
    const isConversationSwitch = lastScrolledConversationIdRef.current !== activeConversationId;
    if (isConversationSwitch) {
      lastScrolledConversationIdRef.current = activeConversationId;
      ivxDiagnostics.recordAutoScroll('conversation-load');
      // OPEN-ON-LATEST FIX: anchor the thread to the newest message. We keep a
      // state flag so the retry effect can keep trying until the FlatList actually
      // reports it is at the bottom, covering dynamic bubble heights and Android's
      // delayed measurement. The user must never land on months-old messages.
      setInitialScrollPending(true);
      isAtBottomRef.current = true;
      setShowScrollToLatest(false);
      setUnreadCount(0);
    }

    if (!localFirstChatMode) {
      void ivxInboxService.markOwnerConversationAsRead(conversationQuery.data?.id).catch((error: unknown) => {
        console.log('[IVXOwnerChatRoute] Mark read failed:', error instanceof Error ? error.message : 'unknown');
      });
    }
  }, [conversationQuery.data?.id, localFirstChatMode, displayedMessages]);

  const persistSupportMessage = useCallback(async (text: string, role: 'system' | 'assistant' = 'system') => {
    const trimmedText = safeTrim(text);
    if (!trimmedText) {
      return;
    }

    await ivxChatService.sendOwnerSupportMessage({
      body: trimmedText,
      senderRole: role,
      senderLabel: role === 'assistant' ? IVX_OWNER_AI_PROFILE.name : 'System',
      attachmentKind: role === 'assistant' ? 'text' : 'system',
      requireRemote: false,
    });
    console.log('[IVXOwnerChatRoute] Support message persisted:', role, trimmedText.slice(0, 60));
  }, []);

  const [aiBackendReachable, setAiBackendReachable] = useState<boolean>(false);
  const [aiHealthDetail, setAiHealthDetail] = useState<ServiceRuntimeHealth>('inactive');
  const sendQueue = useChatSendQueue();
  const [aiReplyPending, setAiReplyPending] = useState<boolean>(false);
  const [ownerCommandsActive, setOwnerCommandsActive] = useState<boolean>(false);
  const [knowledgeActive, setKnowledgeActive] = useState<boolean>(false);
  const [codeAwareActive, setCodeAwareActive] = useState<boolean>(false);
  const [fileUploadActive, setFileUploadActive] = useState<boolean>(false);
  const [roomProbeAt, setRoomProbeAt] = useState<string | null>(null);
  const [aiProbeMetadata, setAiProbeMetadata] = useState<ProbeMetadata>({
    observedAt: null,
    source: 'unknown',
    endpoint: null,
    deploymentMarker: null,
    lastFailureReason: null,
  });
  const [aiProxyStatus, setAiProxyStatus] = useState<AIProxyStatusSnapshot>(() => createInitialAIProxyStatus());
  const [lastToolOutputs, setLastToolOutputs] = useState<IVXOwnerAIToolOutput[]>([]);
  const [runtimeDebugSnapshot, setRuntimeDebugSnapshot] = useState<RuntimeDebugSnapshot>({
    authMode: isOpenAccessBuild ? 'open_access_dev_bypass' : (user || userId ? 'owner_session' : 'missing_owner_session'),
    ownerBypassEnabled: isOpenAccessBuild,
    conversationId: null,
    requestId: null,
    source: 'unknown',
    endpoint: ownerAIConfigAudit.activeEndpoint ?? null,
    deploymentMarker: null,
    selectedIntent: null,
    selectedTool: null,
    requestStage: 'idle',
    failureClass: 'none',
    httpStatus: 'pending',
    responsePreview: 'pending',
    failureDetail: 'No live send attempted yet.',
    lastAttemptAt: null,
    lastVerifiedAt: null,
    hasVisibleResponseText: false,
  });
  const [lastSendAt, setLastSendAt] = useState<string | null>(null);
  const [lastReplyAt, setLastReplyAt] = useState<string | null>(null);
  const [replyFailures, setReplyFailures] = useState<number>(0);
  const [fallbackSuccessCount, setFallbackSuccessCount] = useState<number>(0);
  const [latencySamplesMs, setLatencySamplesMs] = useState<number[]>([]);
  const [lastReliabilityTrace, setLastReliabilityTrace] = useState<ReliabilityTrace | null>(null);
  // Exact owner-auth failure reason surfaced as an in-app banner so the owner
  // sees WHY the privileged owner route was rejected (issuer mismatch / expired /
  // session invalid / email not in IVX_OWNER_REGISTRATION_EMAILS) instead of a
  // silent fallback. Cleared automatically on the next clean owner request.
  const [ownerAuthFailureBanner, setOwnerAuthFailureBanner] = useState<{ reason: string; statusCode: number | null } | null>(null);
  const [isRefreshingOwnerSession, setIsRefreshingOwnerSession] = useState<boolean>(false);
  const [realtimeEventsObserved, setRealtimeEventsObserved] = useState<number>(0);
  const [realtimeSubscriptionState, setRealtimeSubscriptionState] = useState<string | null>(null);
  const [nerveSnapshot, setNerveSnapshot] = useState<CTDashboardSnapshot | null>(null);
  const probeRetryCount = useRef<number>(0);
  const nerveSnapshotRef = useRef<CTDashboardSnapshot | null>(null);
  const roomRuntimeRef = useRef<IVXRoomRuntimeSnapshot | null>(null);
  const auditReportRef = useRef<IVXChatAuditReport | null>(null);
  const MAX_PROBE_RETRIES = 2;
  const PROBE_RETRY_DELAY_MS = 3000;
  const aiReachableRef = useRef<boolean>(false);
  const aiHealthRef = useRef<ServiceRuntimeHealth>('inactive');
  const aiProxyConnectedRef = useRef<boolean>(false);
  const ownerAIRoutingBlocked = ownerAIConfigAudit.blocksRemoteRequests || !ownerAIConfigAudit.activeEndpoint;
  const effectiveAiBackendReachable = aiBackendReachable;
  const effectiveAiHealthDetail: ServiceRuntimeHealth = aiHealthDetail;
  const trustRuntimeState = useMemo(() => ({
    source: normalizeRuntimeSource(runtimeDebugSnapshot.source),
    requestStage: runtimeDebugSnapshot.requestStage,
    failureClass: runtimeDebugSnapshot.failureClass,
    isFallback: runtimeDebugSnapshot.source === 'provider_fallback',
    isStreaming: hasActiveStreamingState(runtimeDebugSnapshot),
    hasVisibleResponseText: runtimeDebugSnapshot.hasVisibleResponseText,
  }), [runtimeDebugSnapshot]);
  const fallbackChatOnlyActive = useMemo<boolean>(() => {
    if (devTestMode.testModeActive) {
      return false;
    }
    return shouldShowFallbackUI(trustRuntimeState);
  }, [devTestMode.testModeActive, trustRuntimeState]);
  const backendAdminVerified = useMemo<boolean>(() => {
    if (devTestMode.testModeActive) {
      return true;
    }
    if (!ownerRoomAuthenticated) {
      return false;
    }

    if (fallbackChatOnlyActive) {
      return false;
    }

    return trustRuntimeState.source === 'remote_api'
      || trustRuntimeState.source === 'local_app_brain'
      || aiProbeMetadata.source === 'remote_api'
      || aiProbeMetadata.source === 'local_app_brain'
      || (effectiveAiBackendReachable && effectiveAiHealthDetail === 'active');
  }, [aiProbeMetadata.source, devTestMode.testModeActive, effectiveAiBackendReachable, effectiveAiHealthDetail, fallbackChatOnlyActive, ownerRoomAuthenticated, trustRuntimeState.source]);
  const currentOwnerTrust = useMemo(() => resolveOwnerTrustContext({
    messageText: normalizedComposerValue,
    ownerRoomAuthenticated,
    backendAdminVerified,
    fallbackModeActive: fallbackChatOnlyActive,
    devTestModeActive: devTestMode.testModeActive,
  }), [backendAdminVerified, devTestMode.testModeActive, fallbackChatOnlyActive, normalizedComposerValue, ownerRoomAuthenticated]);

  useEffect(() => {
    aiReachableRef.current = effectiveAiBackendReachable;
  }, [effectiveAiBackendReachable]);

  useEffect(() => {
    aiHealthRef.current = effectiveAiHealthDetail;
  }, [effectiveAiHealthDetail]);

  useEffect(() => {
    aiProxyConnectedRef.current = aiProxyStatus.status === 'connected';
  }, [aiProxyStatus.status]);

  useEffect(() => {
    nerveSnapshotRef.current = nerveSnapshot;
  }, [nerveSnapshot]);

  useEffect(() => {
    if (localFirstChatMode) {
      setAiProxyStatus((current) => ({
        ...current,
        status: 'connected',
        observedAt: new Date().toISOString(),
        model: 'ivx-local-app-brain',
        gateway: 'local_app_brain',
        configured: true,
        error: null,
      }));
      return undefined;
    }

    if (ownerAIRoutingBlocked) {
      setAiProxyStatus({
        ...createInitialAIProxyStatus(),
        status: 'blocked',
        observedAt: new Date().toISOString(),
        url: buildOwnerAIProxyStatusUrl(ownerAIConfigAudit),
        error: ownerAIConfigAudit.configurationError ?? 'Owner AI routing is blocked by configuration.',
      });
      return undefined;
    }

    let cancelled = false;
    const runFastProxyStatusCheck = async () => {
      setAiProxyStatus((current) => ({
        ...current,
        status: current.status === 'connected' ? 'connected' : 'checking',
        url: buildOwnerAIProxyStatusUrl(ownerAIConfigAudit) ?? current.url,
        error: null,
      }));
      const result = await fetchOwnerAIProxyStatus(ownerAIConfigAudit);
      if (cancelled) {
        return;
      }

      setAiProxyStatus(result);
      console.log('[IVXOwnerChatRoute] Fast AI proxy status:', {
        status: result.status,
        configured: result.configured,
        model: result.model,
        gateway: result.gateway,
        deploymentMarker: result.deploymentMarker,
        url: result.url,
      });

      if (result.status === 'connected') {
        setAiBackendReachable(true);
        setAiHealthDetail('active');
        setAiProbeMetadata((current) => ({
          observedAt: result.observedAt,
          source: 'remote_api',
          endpoint: ownerAIConfigAudit.activeEndpoint ?? current.endpoint,
          deploymentMarker: result.deploymentMarker ?? current.deploymentMarker,
          lastFailureReason: null,
        }));
        setRuntimeDebugSnapshot((current) => ({
          ...current,
          source: shouldPreserveRequestScopedRuntime(current) ? current.source : 'remote_api',
          endpoint: ownerAIConfigAudit.activeEndpoint ?? current.endpoint,
          deploymentMarker: result.deploymentMarker ?? current.deploymentMarker,
          requestStage: current.requestStage === 'idle' ? 'proxy_status_ok' : current.requestStage,
          failureClass: current.failureClass === 'pending' ? 'none' : current.failureClass,
          failureDetail: current.failureDetail === 'No live send attempted yet.'
            ? 'Fast proxy status connected. Full capability probe continues in the background.'
            : current.failureDetail,
          lastVerifiedAt: result.observedAt ?? current.lastVerifiedAt,
        }));
      }
    };

    void runFastProxyStatusCheck();
    const interval = setInterval(() => {
      void runFastProxyStatusCheck();
    }, AI_FAST_PROXY_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [localFirstChatMode, ownerAIConfigAudit.activeBaseUrl, ownerAIConfigAudit.activeEndpoint, ownerAIConfigAudit.configurationError, ownerAIRoutingBlocked]);

  useEffect(() => {
    setRuntimeDebugSnapshot((current) => {
      const shouldPreserveActiveRequest = shouldPreserveRequestScopedRuntime(current);
      return {
        ...current,
        authMode: isOpenAccessBuild ? 'open_access_dev_bypass' : (user || userId ? 'owner_session' : 'missing_owner_session'),
        ownerBypassEnabled: isOpenAccessBuild,
        conversationId: conversationQuery.data?.id ?? null,
        endpoint: aiProbeMetadata.endpoint ?? ownerAIConfigAudit.activeEndpoint ?? current.endpoint,
        deploymentMarker: aiProbeMetadata.deploymentMarker ?? current.deploymentMarker,
        source: shouldPreserveActiveRequest ? current.source : 'unknown',
      };
    });
  }, [aiProbeMetadata.deploymentMarker, aiProbeMetadata.endpoint, aiProbeMetadata.source, conversationQuery.data?.id, isOpenAccessBuild, ownerAIConfigAudit.activeEndpoint, user, userId]);

  useEffect(() => {
    if (ownerAIRoutingBlocked) {
      console.error('[IVXOwnerChatRoute] Owner AI routing blocked by environment policy:', {
        environment: ownerAIConfigAudit.currentEnvironment,
        routingPolicy: ownerAIConfigAudit.routingPolicy,
        configuredBaseUrl: ownerAIConfigAudit.configuredBaseUrl,
        activeBaseUrl: ownerAIConfigAudit.activeBaseUrl,
        configurationError: ownerAIConfigAudit.configurationError,
        pointsToDevHost: ownerAIConfigAudit.pointsToDevHost,
      });
      return;
    }

    console.log('[IVXOwnerChatRoute] Owner AI routing audit pass:', {
      environment: ownerAIConfigAudit.currentEnvironment,
      routingPolicy: ownerAIConfigAudit.routingPolicy,
      activeBaseUrl: ownerAIConfigAudit.activeBaseUrl,
      fallbackUsed: ownerAIConfigAudit.fallbackUsed,
    });
  }, [
    ownerAIConfigAudit.activeBaseUrl,
    ownerAIConfigAudit.configuredBaseUrl,
    ownerAIConfigAudit.configurationError,
    ownerAIConfigAudit.currentEnvironment,
    ownerAIConfigAudit.fallbackUsed,
    ownerAIConfigAudit.pointsToDevHost,
    ownerAIConfigAudit.routingPolicy,
    ownerAIRoutingBlocked,
  ]);

  useEffect(() => {
    if (localFirstChatMode) {
      setNerveSnapshot(null);
      return undefined;
    }

    controlTowerAggregator.start();
    setNerveSnapshot(controlTowerAggregator.getSnapshot());
    const unsubscribe = controlTowerAggregator.subscribe((snapshot) => {
      setNerveSnapshot(snapshot);
    });

    return () => {
      unsubscribe();
    };
  }, [localFirstChatMode]);

  useEffect(() => {
    if (localFirstChatMode) {
      return undefined;
    }

    const sessionId = ownerSessionIdRef.current;
    const baseMetadata = {
      roomId: conversationQuery.data?.id ?? 'ivx-owner-room',
      route: '/ivx/chat',
      sender: ownerLabel,
    };

    liveIntelligenceService.captureEvent({
      eventName: 'session_start',
      screen: '/ivx/chat',
      module: 'chat',
      sessionId,
      userId: ownerId || null,
      anonId: ownerId || sessionId,
      metadata: baseMetadata,
    });
    liveIntelligenceService.captureEvent({
      eventName: 'page_view',
      screen: '/ivx/chat',
      module: 'chat',
      sessionId,
      userId: ownerId || null,
      anonId: ownerId || sessionId,
      metadata: baseMetadata,
    });
    liveIntelligenceService.captureEvent({
      eventName: 'chat_open',
      screen: '/ivx/chat',
      module: 'chat',
      sessionId,
      userId: ownerId || null,
      anonId: ownerId || sessionId,
      metadata: baseMetadata,
    });
    void recordIVXOwnerChatAuditEvent({
      action: 'room_open',
      conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
      status: 'success',
      summary: 'IVX Owner AI room opened locally with runtime and persistence checks active.',
      metadata: { sessionId, localFirstChatMode, ownerRoomAuthenticated },
    });

    return () => {
      liveIntelligenceService.captureEvent({
        eventName: 'session_end',
        screen: '/ivx/chat',
        module: 'chat',
        sessionId,
        userId: ownerId || null,
        anonId: ownerId || sessionId,
        metadata: {
          ...baseMetadata,
          reason: 'route_unmount',
        },
      });
    };
  }, [conversationQuery.data?.id, localFirstChatMode, ownerId, ownerLabel, ownerRoomAuthenticated]);

  const assistantReplyMutation = useMutation<void, Error, { text: string; nonBlocking: boolean; watchdogTraceId?: string | null }>({
    mutationFn: async ({ text, nonBlocking, watchdogTraceId }) => {
      const mutationRunId = createTransientMessageId('ivx-owner-ai-run');
      // Resolve the per-send watchdog trace threaded in from handleSend.
      const trace: WatchdogTraceHandle | null = watchdogTraceId
        ? activeWatchdogTracesRef.current.get(watchdogTraceId) ?? null
        : null;
      // Defensive: ensure AI_MUTATION_STARTED is always marked as soon as the
      // mutation function begins, even if the trace passed in was not found.
      trace?.pass('AI_MUTATION_STARTED', 'assistantReplyMutation.mutationFn entered', { mutationRunId, nonBlocking });
      console.log('[IVX_TRACE] 3_MUTATION_START', { mutationRunId, nonBlocking, textLength: text.length });
      console.log('[IVXOwnerChatRoute] assistant_mutation_start', { mutationRunId, nonBlocking });
      const startedAt = Date.now();
      const startedAtIso = new Date(startedAt).toISOString();
      const transientReplyId = createTransientMessageId('ivx-owner-ai-reply');
      // INVARIANT: every send must end with at least one visible assistant bubble.
      // We track every bubble id this mutation emits in a local Set. In `finally`
      // we use a FUNCTIONAL setState so we can authoritatively inspect the live
      // transient list (not a stale closure / flag) and only force-add a fallback
      // when NONE of this mutation's bubbles are present in the committed state.
      // This closes the class of bugs where a boolean flag said "emitted" but the
      // committed state had already lost the bubble (race, dedup, refetch wipe).
      const emittedBubbleIds = new Set<string>();
      let bubbleEmitted = false;

      setRuntimeDebugSnapshot((current) => ({
        ...current,
        conversationId: conversationQuery.data?.id ?? current.conversationId,
        requestStage: 'request_started',
        failureClass: 'pending',
        httpStatus: 'pending',
        source: 'pending',
        responsePreview: sanitizeUserFacingChatText(safeTrim(text)).slice(0, 160) || current.responsePreview,
        failureDetail: 'Awaiting AI response from live runtime.',
        lastAttemptAt: startedAtIso,
        hasVisibleResponseText: false,
      }));
      setAiReplyPending(true);
      // Watchdog: force-clear typing indicator after a hard ceiling so it can never get stuck.
      const watchdogTimer = setTimeout(() => {
        console.log('[IVXOwnerChatRoute] assistant_reply_watchdog_fired — force-clearing typing indicator after 190s.');
        setAiReplyPending(false);
      }, 190_000);
      try {
        // Send keys off the single canonical id (adopted from the prior backend
        // response when available). This is the "client conversationId before
        // send" proof value.
        const reliableConversationId = canonicalConversationIdRef.current;
        setConversationIdProof((current) => ({ ...current, clientBeforeSend: reliableConversationId }));
        trace?.pass('BACKEND_POST_STARTED', `POST owner-ai (conversation=${reliableConversationId})`);
        setStagedTimeoutRequestStarted(true);
        setStagedTimeoutLastCheckpoint('BACKEND_POST_STARTED');
        const { value: aiResult, trace: reliabilityTrace } = await executeReliably(
          reliableConversationId,
          async (executorSignal: AbortSignal) => ivxAIRequestService.requestOwnerAI(
            {
              conversationId: reliableConversationId,
              message: text,
              senderLabel: ownerLabel,
              mode: 'chat',
              persistUserMessage: false,
              persistAssistantMessage: true,
              devTestModeActive: devTestMode.testModeActive,
            },
            {
              // Forward the reliability wrapper's combined AbortSignal so a
              // total-timeout abort (45s budget) actually cancels the in-flight
              // fetch — closing the silent-hang window between
              // BACKEND_POST_STARTED and BACKEND_POST_FINISHED.
              signal: executorSignal,
              // Real SSE/heartbeat: each backend progress event (start/stage/
              // heartbeat/final) resets the watchdog timeout, so audit-class
              // prompts cannot be misclassified as BACKEND_POST_FINISHED silent
              // failures while the backend is still working.
              onProgress: (event) => {
                if (!trace) return;
                if (event.type === 'heartbeat') {
                  trace.heartbeat(`heartbeat:${event.elapsedMs}ms`);
                } else if (event.type === 'stage') {
                  trace.heartbeat(`stage:${event.stage}`);
                } else if (event.type === 'start') {
                  trace.heartbeat('sse_start');
                } else if (event.type === 'final') {
                  trace.heartbeat(`sse_final:${event.status}`);
                }
              },
            },
          ),
          // ROOT-CAUSE FIX (2026-06-10): heavy audit/fix prompts run the
          // tool-grounded server-side agent for 60–90s+, which exceeds the host's
          // ~60s request cap. requestOwnerAI now consumes the backend SSE stream
          // (180s heartbeat ceiling) when onProgress is plumbed. The reliability
          // budget must therefore cover a full streaming run — a 95s budget aborted
          // valid streams mid-flight and produced the BACKEND_POST_FINISHED
          // "Unable to reach IVX Owner AI" (no HTTP status) TRUE_FAILURE. 185s
          // covers one full SSE attempt plus margin; a retry only fires if the
          // first attempt failed fast (budget remains).
          { totalTimeoutMs: 185_000, maxAttempts: 2, baseDelayMs: 600, maxDelayMs: 4_000 },
        );
        const reliabilityTraceAttempts = reliabilityTrace.attempts.length;
        const reliabilityFinalOutcome = reliabilityTrace.finalOutcome;
        const reliabilityTotalMs = reliabilityTrace.totalElapsedMs;
        // CONVERSATION-ID FIX: adopt the backend-returned conversation id as the
        // canonical id for ALL subsequent save AND restore operations. Returns
        // the id every save below must use.
        const canonicalIdForThisTurn = adoptCanonicalConversationId(aiResult.conversationId);
        console.log('[IVXConversationId] turn_resolved', {
          clientBeforeSend: reliableConversationId,
          backendReturned: aiResult.conversationId ?? null,
          usedForSaveAndRestore: canonicalIdForThisTurn,
        });
        // The user still gets a live answer here, but if it came from the
        // /public/chat fallback, the privileged /api/ivx/owner-ai route FAILED
        // (auth/network/backend). Record that real failure on the watchdog so
        // the red "IVX AI BLOCKED" banner surfaces it (with status code +
        // backend response) instead of hiding it behind the recovery.
        const primaryRouteFailure = (aiResult.source === 'provider_fallback' || aiResult.fallbackUsed === true)
          ? getLastIVXOwnerAIPrimaryRouteFailure()
          : null;
        // ROUND-TRIP TRUTH: BACKEND_POST_FINISHED means "an HTTP response was
        // received" (CHECKPOINT_EXPECTED). When the privileged owner route
        // degraded but the request was RECOVERED via the /public/chat fallback,
        // a real HTTP response WITH answer text was received — the round trip
        // COMPLETED. In that case the checkpoint must PASS (it is not a failed
        // round trip); the privileged-route degradation is surfaced separately
        // via the owner-auth banner. This removes the "a full backend response
        // shape exists but BACKEND_POST_FINISHED is still marked failed" false
        // negative. Only a genuine round-trip failure with NO recovered answer
        // (synthetic OWNER_AUTH_FAILED / OWNER_AI_NETWORK_FAILED, recorded with
        // recoveredViaFallback:false) fails the checkpoint.
        const recoveredAnswerText = typeof aiResult.answer === 'string' ? aiResult.answer.trim() : '';
        const roundTripCompletedWithAnswer = Boolean(primaryRouteFailure?.recoveredViaFallback)
          && recoveredAnswerText.length > 0;
        if (primaryRouteFailure) {
          // Surface the EXACT owner-auth failure reason as an in-app banner when the
          // privileged route was rejected for an auth reason (401/403). The backend
          // auth-diagnostic snapshot names the precise branch: issuer mismatch /
          // expired / Supabase rejected / email not in IVX_OWNER_REGISTRATION_EMAILS.
          const isAuthFailure = primaryRouteFailure.statusCode === 401
            || primaryRouteFailure.statusCode === 403
            || primaryRouteFailure.classification.includes('auth');
          if (isAuthFailure) {
            const authDiag = getLastIVXOwnerAIAuthDiagnostic();
            const exactReason = authDiag?.rootCause
              ?? (authDiag?.ownerEmailAllowlisted === false
                ? `Signed in${authDiag.authenticatedEmailMasked ? ` as ${authDiag.authenticatedEmailMasked}` : ''}, but this email is not in the owner allowlist (IVX_OWNER_REGISTRATION_EMAILS).`
                : primaryRouteFailure.reason);
            setOwnerAuthFailureBanner({ reason: exactReason, statusCode: primaryRouteFailure.statusCode });
          } else {
            setOwnerAuthFailureBanner(null);
          }
          if (roundTripCompletedWithAnswer) {
            // HTTP response received + real answer text via the recovery path: the
            // round trip is NOT a failure. PASS the checkpoint (SUCCESS_VERIFIED for
            // the round trip) and record the privileged-route degradation as data —
            // honest, but never a false BACKEND_POST_FINISHED failure when a backend
            // response shape exists.
            trace?.pass('BACKEND_POST_FINISHED', `recovered_via_fallback attempts=${reliabilityTraceAttempts} outcome=${reliabilityFinalOutcome}`, {
              requestId: aiResult.requestId,
              assistantPersisted: aiResult.assistantPersisted,
              recoveredViaFallback: true,
              degradedRoute: primaryRouteFailure.endpoint,
              degradedReason: primaryRouteFailure.reason,
              statusCode: primaryRouteFailure.statusCode,
              classification: primaryRouteFailure.classification,
            });
            console.log('[IVX_TRACE] BACKEND_POST_FINISHED_PASS_RECOVERED_VIA_FALLBACK', {
              statusCode: primaryRouteFailure.statusCode,
              classification: primaryRouteFailure.classification,
              answerLength: recoveredAnswerText.length,
            });
          } else {
            // No recovered answer — a genuine round-trip failure (synthetic
            // OWNER_AUTH_FAILED / OWNER_AI_NETWORK_FAILED, recoveredViaFallback:false).
            // Fail the checkpoint with the classified reason (AUTH_FAILED /
            // NETWORK_FAILED) so the owner gets ONE truthful terminal state.
            trace?.fail('BACKEND_POST_FINISHED', primaryRouteFailure.reason, {
              statusCode: primaryRouteFailure.statusCode,
              backendResponse: primaryRouteFailure.backendResponse,
              classification: primaryRouteFailure.classification,
              stage: primaryRouteFailure.stage,
              endpoint: primaryRouteFailure.endpoint,
              recoveredViaFallback: primaryRouteFailure.recoveredViaFallback,
            });
            console.log('[IVX_TRACE] BACKEND_ROUTE_FAILED_NO_RECOVERED_ANSWER', {
              statusCode: primaryRouteFailure.statusCode,
              classification: primaryRouteFailure.classification,
            });
          }
        } else {
          // Privileged route succeeded — clear any stale auth-failure banner.
          setOwnerAuthFailureBanner(null);
          trace?.pass('BACKEND_POST_FINISHED', `attempts=${reliabilityTraceAttempts} outcome=${reliabilityFinalOutcome}`, {
            requestId: aiResult.requestId,
            assistantPersisted: aiResult.assistantPersisted,
          });
          setStagedTimeoutLastCheckpoint('BACKEND_POST_FINISHED');
        }
        setLastReliabilityTrace(reliabilityTrace);
        void recordIVXOwnerChatAuditEvent({
          action: 'assistant_reply',
          conversationId: reliableConversationId,
          status: 'started',
          summary: 'IVX Owner AI assistant request completed reliability wrapper and entered response validation.',
          metadata: { attempts: reliabilityTraceAttempts, finalOutcome: reliabilityFinalOutcome, elapsedMs: reliabilityTotalMs, sessionId: ownerSessionIdRef.current },
        });
        const runtimeProof = getLastIVXOwnerAIRuntimeProof();
        const normalizedSource = normalizeRuntimeSource(runtimeProof?.source ?? aiResult.source);
        const normalizedAnswer = assertCleanOwnerAIResponseText(aiResult.answer);
        const responseToolOutputs = aiResult.toolOutputs ?? [];
        const routerDebug: IVXOwnerAIRouterDebug | undefined = aiResult.routerDebug;
        setLastToolOutputs(responseToolOutputs);
        // Only surface a "Tool used" badge when a real tool actually executed.
        // Filtering empty/whitespace tool names prevents the misleading
        // "Tool used: ," badge that appeared on pure-narrative replies and
        // falsely implied work was performed when none was.
        const executedToolNames = responseToolOutputs
          .map((output) => (typeof output.tool === 'string' ? output.tool.trim() : ''))
          .filter((name) => name.length > 0);
        const toolUsedLabel = executedToolNames.length > 0
          ? `Tool used: ${executedToolNames.join(', ')}`
          : null;
        const visibleAnswer = toolUsedLabel ? `${normalizedAnswer}\n\n${toolUsedLabel}` : normalizedAnswer;

        // FINAL IVX IA CHAT EXECUTION MODE (owner mandate 2026-07-19): capture
        // the strict 9-field executionStatus payload the backend attached to its
        // 202 response. Stored in a side-channel map keyed by the transient
        // assistant message id so renderMessage can swap the plain MessageBubble
        // for a live-polling ExecutionConsoleBubble. When the job is still
        // running (HTTP 202), the console bubble polls the worker statusUrl and
        // streams live stage/progress until the terminal verified-evidence block
        // arrives. No narrative planning — execution console only.
        const executionStatusPayload = aiResult.executionStatus ?? null;
        if (executionStatusPayload) {
          const capturedTransientId = transientReplyId;
          setExecutionStatusByMessageId((current) => {
            const next = new Map(current);
            next.set(capturedTransientId, executionStatusPayload);
            return next;
          });
          console.log('[IVXOwnerChatRoute] execution-mode status captured:', {
            transientReplyId: capturedTransientId,
            taskId: executionStatusPayload.taskId,
            category: executionStatusPayload.category,
            status: executionStatusPayload.status,
            stage: executionStatusPayload.stage,
            liveProgress: executionStatusPayload.liveProgress,
            httpStatus: executionStatusPayload.httpStatus,
          });
        }

        console.log('[IVX_TRACE] 4_BACKEND_RESPONSE', { mutationRunId, source: normalizedSource, answerLength: normalizedAnswer.length, requestId: aiResult.requestId, assistantPersisted: aiResult.assistantPersisted });
        console.log('[IVXOwnerChatRoute] assistant_generation_success:', { source: normalizedSource, answerLength: normalizedAnswer.length, requestId: aiResult.requestId, toolUsed: toolUsedLabel });
        if (!normalizedAnswer) {
          trace?.fail('ASSISTANT_TEXT_PRESENT', 'Backend returned empty answer text.', { source: normalizedSource });
          throw new Error('IVX Owner AI completed without returning visible response text.');
        }
        trace?.pass('ASSISTANT_TEXT_PRESENT', `length=${normalizedAnswer.length} preview=${normalizedAnswer.slice(0, 60)}`, { source: normalizedSource });
        // Relaxed source gate: never silently discard a backend-stamped assistant reply.
        // Render the assistant bubble for every acceptable source; attach a warning badge
        // when the source is not one of the canonical/expected labels.
        const assistantSourceExpected = isExpectedAssistantSource(normalizedSource);
        const assistantSourceAcceptable = isAcceptableAssistantSource(normalizedSource);
        if (!assistantSourceExpected) {
          console.log('[IVXOwnerChatRoute] Non-primary assistant source rendered with warning badge:', {
            normalizedSource,
            rawSource: runtimeProof?.source ?? aiResult.source ?? null,
            requestId: aiResult.requestId,
            acceptable: assistantSourceAcceptable,
          });
        }
        const visibleAnswerWithBadge = assistantSourceExpected
          ? visibleAnswer
          : `${visibleAnswer}\n\n⚠️ Source: ${normalizedSource} (unverified)`;

        console.log('[IVXOwnerChatRoute] assistant_send_attempt (primary path)');
        // Flip bubbleEmitted=true BEFORE the setState call so a sync throw in
        // the updater (e.g. buildVisibleAssistantTransient on malformed data)
        // still classifies as success/VISIBLE_ERROR — never the phantom
        // ASSISTANT_TRANSIENT_CREATED failure the watchdog used to report.
        emittedBubbleIds.add(transientReplyId);
        bubbleEmitted = true;
        try { trace?.bindTransient(transientReplyId); } catch (bindErr) { console.log('[IVXOwnerChatRoute] success_bindTransient_threw_safely_continuing:', bindErr instanceof Error ? bindErr.message : 'unknown'); }
        try {
          setTransientAssistantMessages((current) => {
            const replyMessage = buildVisibleAssistantTransient({
              id: transientReplyId,
              conversationId: conversationQuery.data?.id ?? 'ivx-owner-room',
              body: visibleAnswerWithBadge,
              taskId: executionStatusPayload?.taskId ?? null,
            });
            return [...current.filter((message) => message.id !== transientReplyId), replyMessage];
          });
        } catch (setErr) {
          console.log('[IVXOwnerChatRoute] success_setState_threw_safely_continuing:', setErr instanceof Error ? setErr.message : 'unknown');
        }
        trace?.pass('ASSISTANT_TRANSIENT_CREATED', `id=${transientReplyId} role=assistant`, { transientReplyId, bodyPreview: visibleAnswerWithBadge.slice(0, 60) });
        console.log('[IVX_TRACE] 5_SUCCESS_BUBBLE_EMIT', { mutationRunId, transientReplyId, bodyPreview: visibleAnswerWithBadge.slice(0, 60) });
        console.log('[IVXOwnerChatRoute] assistant_success_bubble_set', { mutationRunId, transientReplyId });
        setRuntimeDebugSnapshot((current) => ({
          ...current,
          requestStage: 'response_ok',
          failureClass: 'none',
          source: normalizedSource,
          httpStatus: runtimeProof?.statusCode !== null && runtimeProof?.statusCode !== undefined
            ? String(runtimeProof.statusCode)
            : '200',
          responsePreview: visibleAnswer.slice(0, 160) || current.responsePreview,
          failureDetail: 'Reply delivered and saved.',
          lastVerifiedAt: new Date().toISOString(),
          hasVisibleResponseText: true,
        }));

        setAiBackendReachable(true);
        setAiHealthDetail('active');
        setAiProbeMetadata({
          observedAt: new Date().toISOString(),
          source: normalizedSource,
          endpoint: aiResult.endpoint ?? runtimeProof?.endpoint ?? null,
          deploymentMarker: aiResult.deploymentMarker ?? runtimeProof?.deploymentMarker ?? null,
          lastFailureReason: null,
        });
        setRuntimeDebugSnapshot((current) => {
          const nextRequestStage = (runtimeProof?.failureClass === 'none' && (runtimeProof?.source === 'remote_api' || runtimeProof?.source === 'local_app_brain') ? runtimeProof?.requestStage : null)
            ?? 'response_ok';
          return {
            ...current,
            conversationId: conversationQuery.data?.id ?? current.conversationId,
            requestId: runtimeProof?.requestId ?? aiResult.requestId ?? null,
            source: normalizedSource,
            endpoint: aiResult.endpoint ?? runtimeProof?.endpoint ?? current.endpoint,
            deploymentMarker: aiResult.deploymentMarker ?? runtimeProof?.deploymentMarker ?? current.deploymentMarker,
            selectedIntent: routerDebug?.selectedIntent ?? aiResult.selectedIntent ?? current.selectedIntent,
            selectedTool: routerDebug?.selectedTool ?? aiResult.selectedTool ?? (responseToolOutputs.length > 0 ? responseToolOutputs.map((output) => output.tool).join(', ') : current.selectedTool),
            requestStage: nextRequestStage,
            failureClass: 'none',
            httpStatus: (runtimeProof?.failureClass === 'none' && runtimeProof?.statusCode !== null && runtimeProof?.statusCode !== undefined)
              ? String(runtimeProof.statusCode)
              : '200',
            responsePreview: visibleAnswer.slice(0, 160) || current.responsePreview,
            failureDetail: 'Reply delivered and saved.',
            lastVerifiedAt: new Date().toISOString(),
            hasVisibleResponseText: true,
          };
        });
        setLastReplyAt(new Date().toISOString());
        setLatencySamplesMs((samples) => [...samples.slice(-9), Date.now() - startedAt]);
        console.log('[IVXOwnerChatRoute] assistant_send_success (primary path):', {
          requestId: aiResult.requestId,
          source: normalizedSource,
          endpoint: aiResult.endpoint ?? null,
          deploymentMarker: aiResult.deploymentMarker ?? null,
          model: aiResult.model,
        });

        // --- Report Continuation Auto-Continue ---
        let currentResult = aiResult;
        let currentPartNumber = 1;
        const MAX_CONTINUATION_PARTS = 20;
        while (currentResult.continuationToken && !currentResult.continuationComplete && currentPartNumber <= MAX_CONTINUATION_PARTS) {
          const partMessage = `Part ${currentPartNumber} of ${currentResult.continuationTotalParts ?? '?'} complete. Continuing automatically...`;
          const continuationTransientId = createTransientMessageId('ivx-owner-ai-continuation');
          setTransientAssistantMessages((current) => {
            const message = buildVisibleAssistantTransient({
              id: continuationTransientId,
              conversationId: conversationQuery.data?.id ?? 'ivx-owner-room',
              body: partMessage,
            });
            return [...current, message];
          });

          // Small delay for UX
          await new Promise((resolve) => setTimeout(resolve, 600));

          try {
            const nextResult = await ivxAIRequestService.requestOwnerAI({
              conversationId: reliableConversationId,
              message: 'CONTINUE',
              senderLabel: ownerLabel,
              mode: 'chat',
              persistUserMessage: false,
              persistAssistantMessage: true,
              devTestModeActive: devTestMode.testModeActive,
              continuationToken: currentResult.continuationToken,
            });
            const nextNormalizedAnswer = assertCleanOwnerAIResponseText(nextResult.answer);
            const nextReplyId = createTransientMessageId('ivx-owner-ai-reply');
            setTransientAssistantMessages((current) => {
              const replyMessage = buildVisibleAssistantTransient({
                id: nextReplyId,
                conversationId: conversationQuery.data?.id ?? 'ivx-owner-room',
                body: nextNormalizedAnswer,
              });
              return [...current.filter((message) => message.id !== nextReplyId), replyMessage];
            });
            currentResult = nextResult;
            currentPartNumber++;
          } catch (continueError) {
            console.log('[IVXOwnerChatRoute] Continuation auto-continue failed:', continueError instanceof Error ? continueError.message : 'unknown');
            const fallbackPrompt = currentResult.continuationPrompt ?? `Reply CONTINUE to resume from item ${currentResult.continuationNextItemNumber ?? '?'}.`;
            const fallbackTransientId = createTransientMessageId('ivx-owner-ai-continuation-fallback');
            setTransientAssistantMessages((current) => {
              const message = buildVisibleAssistantTransient({
                id: fallbackTransientId,
                conversationId: conversationQuery.data?.id ?? 'ivx-owner-room',
                body: fallbackPrompt,
              });
              return [...current.filter((m) => m.id !== continuationTransientId), message];
            });
            break;
          }
        }
        // --- End Report Continuation Auto-Continue ---

        try {
          if (aiResult.assistantPersisted !== true) {
            await persistSupportMessage(visibleAnswer, 'assistant');
          }
          console.log('[IVXOwnerChatRoute] assistant_commit_success (primary path)');
          void recordIVXOwnerChatAuditEvent({
            action: 'assistant_reply',
            conversationId: aiResult.conversationId,
            messageId: aiResult.assistantMessageId ?? transientReplyId,
            status: 'success',
            summary: 'Assistant reply delivered and persisted or confirmed by backend.',
            metadata: {
              requestId: aiResult.requestId,
              source: normalizedSource,
              endpoint: aiResult.endpoint ?? null,
              deploymentMarker: aiResult.deploymentMarker ?? null,
              model: aiResult.model,
              answerLength: visibleAnswer.length,
              reliabilityAttempts: reliabilityTraceAttempts,
              sessionId: ownerSessionIdRef.current,
            },
          });
          // Refetch (not just invalidate) so the persisted assistant message is in the
          // query cache BEFORE we remove the transient bubble. Using invalidateQueries
          // alone created a race where the transient was filtered before the refetch
          // landed, causing the assistant reply to briefly or permanently disappear from
          // the UI when the persisted body did not exactly match (e.g. backend trimmed,
          // sanitized, or differently-cased the text). We now keep the transient bubble
          // until allMessages' dedup logic naturally removes it when a persistent
          // assistant message with the same body arrives. If after a grace window the
          // persisted message still has not landed (offline, persistence rejected, etc.),
          // the transient stays visible so the owner never loses the reply.
          try {
            await queryClient.refetchQueries({ queryKey: IVX_OWNER_MESSAGES_QUERY_KEY });
          } catch (refetchErr) {
            console.log('[IVXOwnerChatRoute] assistant_commit_refetch_failed_but_visible_reply_kept:', refetchErr instanceof Error ? refetchErr.message : 'unknown');
          }
          // Keep the transient bubble. The dedup in `allMessages` removes it the moment
          // a persistent assistant message with the same body is present in cache.
          // Never force-filter the transient here — that was the disappearing-reply bug.
        } catch (persistErr) {
          console.log('[IVXOwnerChatRoute] assistant_commit_failed_but_visible_reply_kept:', persistErr instanceof Error ? persistErr.message : 'unknown');
          setRuntimeDebugSnapshot((current) => ({
            ...current,
            failureDetail: 'Reply delivered locally. Save will retry on refresh.',
            hasVisibleResponseText: true,
          }));
        }
        if (!localFirstChatMode) {
          try {
            liveIntelligenceService.captureEvent({
              eventName: 'chat_message',
              screen: '/ivx/chat',
              module: 'chat',
              sessionId: ownerSessionIdRef.current,
              userId: ownerId || null,
              anonId: ownerId || ownerSessionIdRef.current,
              metadata: {
                role: 'assistant',
                roomId: conversationQuery.data?.id ?? 'ivx-owner-room',
                source: normalizedSource,
                requestId: aiResult.requestId ?? null,
                message: sanitizeUserFacingChatText(visibleAnswer).slice(0, 240),
              },
            });
          } catch (eventErr) {
            console.log('[IVXOwnerChatRoute] Post-processing event capture failed (response still delivered):', eventErr instanceof Error ? eventErr.message : 'unknown');
          }
        }
      } catch (aiErr) {
        // HARDENED CATCH: each helper is independently guarded so a throw in a
        // diagnostics helper cannot abort the catch handler before we (a) emit
        // an error bubble and (b) mark BACKEND_POST_FINISHED failed. Without
        // this, the watchdog mis-reported the run as
        // `ASSISTANT_TRANSIENT_CREATED failed` even though the real root cause
        // was the backend / network failure caught here.
        let diagnostics: ReturnType<typeof getIVXOwnerAIErrorDiagnostics> | null = null;
        try { diagnostics = getIVXOwnerAIErrorDiagnostics(aiErr); } catch (diagErr) { console.log('[IVXOwnerChatRoute] diagnostics_helper_threw_safely_continuing:', diagErr instanceof Error ? diagErr.message : 'unknown'); }
        const failureMessage = aiErr instanceof Error ? aiErr.message : 'Owner AI request error.';
        let serviceUnavailable = false;
        try { serviceUnavailable = isIVXServiceUnavailableDiagnostics(diagnostics); } catch (unavailErr) { console.log('[IVXOwnerChatRoute] service_unavailable_helper_threw_safely_continuing:', unavailErr instanceof Error ? unavailErr.message : 'unknown'); }
        console.log('[IVXOwnerChatRoute] assistant_send_failure:', {
          failureMessage,
          diagnostics,
          serviceUnavailable,
          blockedByRoutingGuard: ownerAIRoutingBlocked,
          activeEndpoint: ownerAIConfigAudit.activeEndpoint,
          routingPolicy: ownerAIConfigAudit.routingPolicy,
        });

        // Flip bubbleEmitted=true and mark BACKEND_POST_FINISHED failed FIRST,
        // so even if the setState updater throws later the watchdog already
        // sees a real VISIBLE_ERROR (catch ran) instead of a phantom
        // ASSISTANT_TRANSIENT_CREATED failure.
        const errorTransientId = createTransientMessageId('ivx-owner-ai-error');
        emittedBubbleIds.add(errorTransientId);
        bubbleEmitted = true;
        try { trace?.bindTransient(errorTransientId); } catch (bindErr) { console.log('[IVXOwnerChatRoute] catch_bindTransient_threw_safely_continuing:', bindErr instanceof Error ? bindErr.message : 'unknown'); }
        try { trace?.fail('BACKEND_POST_FINISHED', failureMessage, { serviceUnavailable, errorTransientId, statusCode: diagnostics?.statusCode ?? null, backendResponse: diagnostics?.responsePreview ?? diagnostics?.detail ?? null }); } catch (failErr) { console.log('[IVXOwnerChatRoute] trace_fail_threw_safely_continuing:', failErr instanceof Error ? failErr.message : 'unknown'); }
        // Surface a SHORT owner-friendly reason instead of raw internal jargon
        // ("stage: auth · classification: provider_exhausted" leaked debug terms
        // into the chat and made every failure look broken). Map the diagnostic
        // to plain language; the full technical detail still lives in the
        // runtime-debug snapshot + audit event for engineers.
        const failureReasonSuffix = (() => {
          if (!diagnostics) return '';
          const status = diagnostics.statusCode ?? null;
          if (status === 401 || status === 403 || diagnostics.stage === 'auth') {
            return ' (your owner session needs to be refreshed — open Auth Diagnostics)';
          }
          if (diagnostics.stage === 'network') {
            return ' (connection to the server was interrupted)';
          }
          if (status && status >= 500) {
            return ' (the server is temporarily unavailable)';
          }
          return '';
        })();
        // Honest error card: surface the exact route + HTTP status + trace id +
        // an owner-readable next-fix so a failed send is never a dead-end blank
        // bubble. Status is the real HTTP code when present, otherwise the
        // failure stage (network/no-response) — never a fabricated 200.
        const routePath = (() => {
          const ep = diagnostics?.endpoint ?? ownerAIConfigAudit.activeEndpoint ?? null;
          if (!ep) return 'owner-ai';
          try { return new URL(ep).pathname; } catch { return ep; }
        })();
        const statusLabel = diagnostics?.statusCode != null
          ? String(diagnostics.statusCode)
          : (diagnostics?.stage === 'network' ? 'network' : 'no-response');
        const nextFix = (() => {
          const status = diagnostics?.statusCode ?? null;
          if (status === 401 || status === 403 || diagnostics?.stage === 'auth') {
            return 'Open Auth Diagnostics to refresh your owner session.';
          }
          if (diagnostics?.stage === 'network' || statusLabel === 'network' || statusLabel === 'no-response') {
            return 'Check your connection and tap send again to retry.';
          }
          if (status != null && status >= 500) {
            return 'The server is warming up — retry in a moment.';
          }
          return 'Tap send to retry; if it persists, open Auth Diagnostics.';
        })();
        const diagnosticsCardLine = `Route: ${routePath} · Status: ${statusLabel} · Trace: ${watchdogTraceId ?? 'n/a'}\nNext: ${nextFix}`;
        try {
          setTransientAssistantMessages((current) => [
            ...current.filter((message) => message.id !== transientReplyId),
            buildVisibleAssistantTransient({
              id: errorTransientId,
              conversationId: conversationQuery.data?.id ?? 'ivx-owner-room',
              body: serviceUnavailable
                ? `Service temporarily unavailable. Please try again in a moment.\n\n${diagnosticsCardLine}`
                : `I was unable to generate a reply right now.${failureReasonSuffix}\n\n${diagnosticsCardLine}`,
            }),
          ]);
        } catch (setErr) {
          console.log('[IVXOwnerChatRoute] error_bubble_setState_threw_safely_continuing:', setErr instanceof Error ? setErr.message : 'unknown');
        }
        console.log('[IVX_TRACE] 6_CATCH_BUBBLE_EMIT', { mutationRunId, errorTransientId, failureMessage });
        console.log('[IVXOwnerChatRoute] assistant_error_bubble_set', { mutationRunId, errorTransientId });
        const failedTrace = isRecord(aiErr) && isRecord((aiErr as { reliabilityTrace?: unknown }).reliabilityTrace)
          ? (aiErr as { reliabilityTrace: ReliabilityTrace }).reliabilityTrace
          : null;
        if (failedTrace) {
          setLastReliabilityTrace(failedTrace);
        }
        void recordIVXOwnerChatAuditEvent({
          action: 'assistant_reply',
          conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
          status: 'failed',
          summary: 'Assistant reply failed after reliability handling.',
          metadata: {
            failureMessage,
            diagnostics,
            serviceUnavailable,
            reliabilityAttempts: failedTrace?.attempts.length ?? null,
            finalOutcome: failedTrace?.finalOutcome ?? null,
            sessionId: ownerSessionIdRef.current,
          },
        });
        setRuntimeDebugSnapshot((current) => ({
          ...current,
          conversationId: conversationQuery.data?.id ?? current.conversationId,
          requestId: diagnostics?.requestId ?? current.requestId,
          endpoint: diagnostics?.endpoint ?? current.endpoint ?? ownerAIConfigAudit.activeEndpoint,
          requestStage: diagnostics?.stage ?? 'response',
          failureClass: diagnostics?.classification ?? 'provider_exhausted',
          httpStatus: diagnostics?.statusCode !== null && diagnostics?.statusCode !== undefined ? String(diagnostics.statusCode) : 'unavailable',
          responsePreview: '',
          failureDetail: 'The message was sent. Send another prompt when you are ready.',
          hasVisibleResponseText: false,
        }));
        setAiBackendReachable(false);
        setAiHealthDetail('inactive');
        setAiProbeMetadata((current) => ({
          ...current,
          observedAt: new Date().toISOString(),
          endpoint: diagnostics?.endpoint ?? current.endpoint ?? ownerAIConfigAudit.activeEndpoint,
          lastFailureReason: serviceUnavailable ? 'temporarily_unavailable' : 'provider_exhausted',
        }));
        console.log('[IVXOwnerChatRoute] assistant provider and local guard paths exhausted; no fake assistant text inserted:', {
          originalFailureMessage: failureMessage,
          diagnostics,
          serviceUnavailable,
        });
        // P0 DURABLE FALLBACK (503-recovery mandate): a transient 5xx/timeout/
        // network failure must never lose the owner request. Hand the message
        // to the persisted server-side task queue and poll it to completion —
        // the owner never retypes anything.
        if (shouldAttemptDurableFallback(diagnostics, failureMessage)) {
          const durableBubbleId = createTransientMessageId('ivx-owner-ai-durable');
          emittedBubbleIds.add(durableBubbleId);
          const updateDurableBubble = (body: string) => {
            try {
              setTransientAssistantMessages((current) => [
                ...current.filter((message) => message.id !== durableBubbleId),
                buildVisibleAssistantTransient({
                  id: durableBubbleId,
                  conversationId: conversationQuery.data?.id ?? 'ivx-owner-room',
                  body,
                }),
              ]);
            } catch (bubbleErr) {
              console.log('[IVXOwnerChatRoute] durable_bubble_set_threw_safely_continuing:', bubbleErr instanceof Error ? bubbleErr.message : 'unknown');
            }
          };
          updateDurableBubble(`♻️ Auto-recovery started — your message is saved server-side and will be answered without retyping.\nTrace: ${watchdogTraceId ?? 'n/a'}`);
          void (async () => {
            const durableResult = await runDurableOwnerAIFallback({
              message: text,
              conversationId: conversationQuery.data?.id ?? null,
              traceId: watchdogTraceId ?? null,
              onStatus: (task) => {
                if (task.terminal || task.status === 'COMPLETED') return;
                updateDurableBubble(`♻️ Auto-recovery in progress — Task ${task.taskId}\nStatus: ${task.status} · Checkpoint: ${task.checkpoint} · Retries: ${task.retryCount}\nYour message is safe; no need to retype it.`);
              },
            });
            if (durableResult.ok && durableResult.answer) {
              updateDurableBubble(durableResult.answer);
              setRuntimeDebugSnapshot((current) => ({
                ...current,
                requestStage: 'response_ok',
                failureClass: 'none',
                httpStatus: '200',
                responsePreview: (durableResult.answer ?? '').slice(0, 160),
                failureDetail: `Recovered automatically via durable task ${durableResult.taskId}.`,
                hasVisibleResponseText: true,
                lastVerifiedAt: new Date().toISOString(),
              }));
              setAiBackendReachable(true);
              setAiHealthDetail('active');
            } else if (durableResult.taskId) {
              updateDurableBubble(`Auto-recovery did not finish. Task ${durableResult.taskId} · Status: ${durableResult.status ?? 'UNKNOWN'}\nLast checkpoint: ${durableResult.checkpoint ?? 'n/a'}\nYour message is preserved server-side — you can retry or cancel it.`);
            } else {
              updateDurableBubble(`Auto-recovery could not start (${durableResult.error ?? 'unknown reason'}). Your message stays visible above — tap send to retry.`);
            }
          })();
        }
      } finally {
        clearTimeout(watchdogTimer);
        setAiReplyPending(false);
        // INVARIANT GUARANTEE (state-authoritative):
        // Use functional setState to inspect the LIVE committed transient list.
        // If none of this mutation's emitted bubble ids are present (race,
        // dedup wipe, swallowed throw, concurrent mutation overwrite, stale
        // closure flag), force-add a visible fallback synchronously inside
        // the same setState call so React can never drop or reorder it.
        const invariantFallbackId = createTransientMessageId('ivx-owner-ai-invariant-fallback');
        console.log('[IVX_TRACE] 7_FINALLY_ENTER', {
          mutationRunId,
          bubbleEmittedFlag: bubbleEmitted,
          emittedBubbleIds: Array.from(emittedBubbleIds),
        });
        console.log('[IVXOwnerChatRoute] assistant_mutation_finally_entry', {
          mutationRunId,
          bubbleEmittedFlag: bubbleEmitted,
          emittedBubbleIds: Array.from(emittedBubbleIds),
        });
        setTransientAssistantMessages((current) => {
          const currentIds = new Set(current.map((message) => message.id));
          const anyEmittedPresent = Array.from(emittedBubbleIds).some((id) => currentIds.has(id));
          console.log('[IVX_TRACE] 8_FINAL_BUBBLE_COUNT', {
            mutationRunId,
            currentTransientCount: current.length,
            currentTransientIds: Array.from(currentIds),
            emittedBubbleIds: Array.from(emittedBubbleIds),
            anyEmittedPresent,
          });
          if (anyEmittedPresent) {
            console.log('[IVXOwnerChatRoute] assistant_invariant_satisfied', {
              mutationRunId,
              presentIds: Array.from(emittedBubbleIds).filter((id) => currentIds.has(id)),
            });
            return current;
          }
          console.log('[IVXOwnerChatRoute] assistant_invariant_fallback_emitted — committed state has none of this mutation\'s bubbles. Forcing fallback.', {
            mutationRunId,
            transientReplyId,
            emittedBubbleIds: Array.from(emittedBubbleIds),
            currentTransientCount: current.length,
            bubbleEmittedFlag: bubbleEmitted,
          });
          trace?.bindTransient(invariantFallbackId);
          return [
            ...current.filter((message) => message.id !== transientReplyId && !emittedBubbleIds.has(message.id)),
            buildVisibleAssistantTransient({
              id: invariantFallbackId,
              conversationId: conversationQuery.data?.id ?? 'ivx-owner-room',
              body: 'No assistant reply was received for that message. Tap to try again.',
            }),
          ];
        });
        // Watchdog finalization: BLOCKED if the invariant fallback fired,
        // VISIBLE_ERROR if catch path ran, SUCCESS otherwise.
        if (trace) {
          const report = trace.getReport();
          if (report.finalStatus === 'PENDING') {
            const backendCheckpoint = report.checkpoints.find((cp) => cp.name === 'BACKEND_POST_FINISHED');
            const catchFailed = backendCheckpoint?.status === 'fail';
            // DEGRADED (yellow, not red): the round trip COMPLETED with a real
            // answer but via the /public/chat recovery path (privileged owner
            // route bypassed). The checkpoint PASSED with recoveredViaFallback:true,
            // so finalize as DEGRADED — a truthful "recovered" warning, never a
            // red BLOCKED failure when a valid answer exists.
            const recoveredViaFallback = backendCheckpoint?.status === 'pass'
              && backendCheckpoint.data?.recoveredViaFallback === true;
            if (catchFailed) {
              trace.complete('VISIBLE_ERROR');
            } else if (recoveredViaFallback) {
              trace.complete('DEGRADED');
            } else if (!bubbleEmitted) {
              // Invariant fallback fired and a visible "No assistant reply…"
              // bubble was committed by the functional setState above. The user
              // sees a message, so classify as VISIBLE_ERROR (not BLOCKED) and
              // do NOT call trace.fail('ASSISTANT_TRANSIENT_CREATED') — the
              // real root cause was already captured (or will be by the
              // incident ingest); the watchdog should not report a phantom
              // checkpoint failure when a bubble is actually on screen.
              trace.complete('VISIBLE_ERROR');
            } else {
              trace.complete('SUCCESS');
            }
          }
          if (watchdogTraceId) {
            activeWatchdogTracesRef.current.delete(watchdogTraceId);
          }
        }
      }
      // Clear staged timeout banner — the AI reply lifecycle is complete
      // (success, visible error, or invariant fallback). No infinite spinner.
      setStagedTimeoutTraceId(null);
    },
    onError: (error) => {
      console.log('[IVXOwnerChatRoute] Assistant reply mutation error suppressed from chat UI:', error.message);
      setStagedTimeoutTraceId(null);
    },
    onSettled: () => {
      setAiReplyPending(false);
    },
  });

  // Pending owner-approval build-job draft (set when a build request is detected,
  // executed when the owner replies /confirm). Routes to the self-hosted worker.
  const pendingBuildDraftRef = useRef<SeniorDeveloperJobDraft | null>(null);

  /**
   * Run an owner-approved build draft against the self-hosted Senior Developer
   * Worker: submit → poll → render the real proof. No narrative, no fake commit.
   */
  const runSeniorDeveloperWorkerFromChat = useCallback(async (draft: SeniorDeveloperJobDraft): Promise<void> => {
    await persistSupportMessage([
      'Result: SUBMITTING',
      `Explanation: Routing "${draft.title}" to the self-hosted Senior Developer Worker.`,
      'Evidence: POST /api/ivx/senior-developer/worker/jobs (owner-gated, no narrative).',
      'Operator action log: senior-developer-worker-submit',
      'Linked surface: POST /api/ivx/senior-developer/worker/jobs',
    ].join('\n'), 'system');

    const submit = await submitSeniorDeveloperWorkerJob(draft);
    if (submit.statusCode !== 'SUBMITTED' || !submit.jobId) {
      const code = submit.statusCode === 'SUBMITTED' ? 'WORKER_UNAVAILABLE' : submit.statusCode;
      await persistSupportMessage(buildSeniorDeveloperSubmitStatusCard(code, submit.reason), 'system');
      return;
    }

    const jobId = submit.jobId;
    const finished: WorkerJobView | null = await pollSeniorDeveloperWorkerJob(jobId, {
      intervalMs: 4000,
      timeoutMs: 180000,
    });
    const lastProof = await getSeniorDeveloperWorkerLastProof();
    const result = finished?.result ?? null;
    const complete = isWorkerJobComplete(result);
    const finalStatus = complete
      ? 'COMPLETE'
      : result?.finalStatus ?? (finished ? finished.status.toUpperCase() : 'RUNNING');

    await persistSupportMessage([
      `Result: ${finalStatus}`,
      `JOB_ID: ${jobId}`,
      `COMMIT_HASH: ${result?.commitSha ?? lastProof?.lastCommitHash ?? 'none'}`,
      `DEPLOY_ID: ${result?.deployId ?? lastProof?.lastDeployId ?? 'none'}`,
      `HEALTH_STATUS: ${result?.healthStatus ?? lastProof?.lastHealthStatus ?? 'none'}`,
      `VERSION_MATCH: ${(result?.commitMatch ?? lastProof?.lastVersionMatch) ? 'true' : 'false'}`,
      `TEST_STATUS: ${result ? (result.testsRun ? (result.testsPassed ? 'passed' : 'failed') : 'not run') : 'unknown'}`,
      `DEPLOY_STATUS: ${result?.deployStatus ?? (result?.finalStatus ?? 'unknown')}`,
      `Evidence: ${result?.error ?? (complete ? 'End-to-end production run verified by the worker ledger.' : 'Job did not reach a verified COMPLETE state. FINAL_STATUS=COMPLETE only with commit hash + deploy id + health 200 + version match.')}`,
      'Operator action log: senior-developer-worker-result',
      'Linked surface: GET /api/ivx/worker-last-proof',
    ].join('\n'), 'system');
  }, [persistSupportMessage]);

  /**
   * Owner taps the visible "Approve + Run" button on an approval card. Resolves
   * the pending build draft (or reconstructs it from the card goal) and routes
   * it straight to the self-hosted worker — no /confirm reply needed.
   */
  const handleApproveAndRunFromCard = useCallback(async (cardBody: string): Promise<void> => {
    let draft = pendingBuildDraftRef.current;
    if (!draft) {
      const rows = parseStructuredSystemMessage(cardBody) ?? [];
      const goalRow = rows.find((row) => row.label.toLowerCase() === 'goal');
      const marker = 'task end-to-end:';
      const raw = goalRow?.value ?? '';
      const markerIndex = raw.toLowerCase().indexOf(marker);
      const original = markerIndex >= 0 ? raw.slice(markerIndex + marker.length).trim() : raw;
      draft = buildSeniorDeveloperJobDraft(original.length > 0 ? original : 'Create IVX Worker Proof module');
    }
    pendingBuildDraftRef.current = null;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await runSeniorDeveloperWorkerFromChat(draft);
  }, [runSeniorDeveloperWorkerFromChat]);

  const buildCommandContractResponse = useCallback(async (command: string, args: string): Promise<string | null> => {
    const snapshot = nerveSnapshotRef.current;
    const runtime = roomRuntimeRef.current;

    if (command === 'proof') {
      const report = auditReportRef.current;
      const proofLines = runtime?.proofs.slice(0, 3).map((proof) => `${proof.title}: ${proof.status} (${Math.round(proof.confidence * 100)}%)`) ?? [];
      return [
        `Result: ${report?.liveReady ? 'pass' : runtime?.runtimeStatus ?? 'probing'}`,
        `Explanation: ${report?.summary ?? `Room ${runtime?.roomId ?? 'ivx-owner-room'} is ${runtime?.runtimeStatus ?? 'probing'} with stream ${runtime?.streamStatus ?? 'unavailable'}.`}`,
        `Evidence: ${proofLines.join(' | ') || 'No verified proof rows yet'}${report ? ` | audit ${report.passedCount}/${report.totalCount} passed` : ''}`,
        `Affected dependencies: ${(snapshot?.systemNodes.filter((node) => node.id.includes('chat') || node.id.includes('realtime') || node.id.includes('ai_runtime')).slice(0, 4).map((node) => node.name).join(' → ')) || 'Chat transport → Realtime → AI runtime'}`,
        'Operator action log: proof-inspect',
        'Rollback: not required',
        `Linked proof cards: ${runtime?.proofs.slice(0, 2).map((proof) => proof.id).join(', ') || 'none'}`,
      ].join('\n');
    }

    if (command === 'risk') {
      const risks = snapshot?.riskAssessments.filter((risk) => risk.subjectId.includes('chat') || risk.subjectId.includes('ai_ops') || risk.subjectId.includes('realtime_sync')).slice(0, 3) ?? [];
      return [
        `Result: ${risks.length > 0 ? 'available' : 'empty'}`,
        'Explanation: Returning the highest live room/runtime risks.',
        `Evidence: ${risks.map((risk) => `${risk.subjectId.replace('module:', '')} ${Math.round(risk.currentRiskScore * 100)}% / blast ${risk.blastRadius}`).join(' | ') || 'No elevated risks currently'}`,
        `Affected dependencies: ${risks.flatMap((risk) => risk.causeChain.slice(0, 3)).slice(0, 6).join(' → ') || 'none'}`,
        'Operator action log: risk-inspect',
        'Rollback: not required',
        `Linked proof cards: ${risks.map((risk) => risk.id).join(', ') || 'none'}`,
      ].join('\n');
    }

    if (command === 'incident') {
      const incident = snapshot?.incidents.find((item) => item.module === 'chat' || item.module === 'ai_ops' || item.module === 'realtime_sync') ?? null;
      return [
        `Result: ${incident ? 'available' : 'none'}`,
        `Explanation: ${incident ? incident.description : 'No active owner-room incident is currently open.'}`,
        `Evidence: ${incident?.evidenceIds?.join(', ') || 'No linked evidence IDs'}`,
        `Affected dependencies: ${incident?.rootCauseHypothesis ?? 'No dependency chain attached'}`,
        `Operator action log: ${incident?.executedActions?.join(' | ') || 'No interventions executed yet'}`,
        'Rollback: depends on chosen intervention',
        `Linked proof cards: ${incident?.evidenceIds?.slice(0, 3).join(', ') || 'none'}`,
      ].join('\n');
    }

    if (command === 'deps') {
      const nodes = snapshot?.systemNodes.filter((node) => node.id.includes('chat') || node.id.includes('realtime') || node.id.includes('ai_runtime') || node.id.includes('shared_room')).slice(0, 5) ?? [];
      return [
        `Result: ${nodes.length > 0 ? 'available' : 'empty'}`,
        'Explanation: Returning the current owner-room dependency spine.',
        `Evidence: ${nodes.map((node) => `${node.name}:${node.status}`).join(' | ') || 'No dependency nodes captured yet'}`,
        `Affected dependencies: ${nodes.flatMap((node) => node.dependencies).slice(0, 8).join(' → ') || 'none'}`,
        'Operator action log: dependency-inspect',
        'Rollback: not required',
        `Linked proof cards: ${nodes.flatMap((node) => node.proofIds).slice(0, 4).join(', ') || 'none'}`,
      ].join('\n');
    }

    if (command === 'heal') {
      const normalized = safeTrim(args).toLowerCase();
      const action = normalized === 'rerun-proof'
        ? 'rerun_health_probe'
        : normalized === 'clear-stuck'
          ? 'transition_stuck_sends'
          : normalized === 'provider-probe'
            ? 'force_provider_probe'
            : normalized === 'shared-sync'
              ? 'rerun_shared_room_sync'
              : normalized === 'inbox-sync'
                ? 'rerun_inbox_sync'
                : normalized === 'transcript'
                  ? 'force_transcript_reconciliation'
                  : null;
      if (!action) {
        return 'Result: blocked\nExplanation: Allowed interventions are rerun-proof, clear-stuck, provider-probe, shared-sync, inbox-sync, and transcript.\nEvidence: permission guard\nAffected dependencies: chat transport\nOperator action log: not-started\nRollback: not required\nLinked proof cards: none';
      }
      const result = await executeOperatorAction(action, 'chat');
      void recordIVXOwnerChatAuditEvent({
        action: 'control_action',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        status: result.success ? 'success' : 'failed',
        summary: `Owner control action ${getActionLabel(action)} completed.`,
        metadata: { action, resultMessage: result.message, sessionId: ownerSessionIdRef.current },
      });
      invalidateIVXRoomProbeCache();
      await queryClient.invalidateQueries({ queryKey: IVX_ROOM_STATUS_QUERY_KEY });
      setAiHealthDetail('inactive');
      return [
        `Result: ${result.success ? 'success' : 'failed'}`,
        `Explanation: ${result.message}`,
        `Evidence: ${(snapshot?.evidence.filter((proof) => proof.subjectId.includes('chat') || proof.subjectId.includes('realtime')).slice(0, 2).map((proof) => proof.claim).join(' | ')) || 'No linked proof rows yet'}`,
        `Affected dependencies: ${(snapshot?.systemNodes.filter((node) => node.id.includes('chat') || node.id.includes('realtime')).slice(0, 3).map((node) => node.name).join(' → ')) || 'Chat transport → Realtime'}`,
        `Operator action log: ${getActionLabel(action)}`,
        `Rollback: ${action === 'transition_stuck_sends' ? 'available' : 'not required'}`,
        `Linked proof cards: ${(snapshot?.evidence.filter((proof) => proof.subjectId.includes('chat') || proof.subjectId.includes('realtime')).slice(0, 3).map((proof) => proof.id).join(', ')) || 'none'}`,
      ].join('\n');
    }

    if (command === 'replay') {
      const latestReplayable = (snapshot?.actionRuns ?? [])
        .find((action) => action.rollbackAvailable && action.result !== 'failed');
      if (!latestReplayable) {
        return 'Result: blocked\nExplanation: No replayable safe action is currently available.\nEvidence: operator action history empty\nAffected dependencies: none\nOperator action log: not-started\nRollback: not required\nLinked proof cards: none';
      }
      const replayResult = await executeOperatorAction(latestReplayable.actionType, 'chat');
      invalidateIVXRoomProbeCache();
      await queryClient.invalidateQueries({ queryKey: IVX_ROOM_STATUS_QUERY_KEY });
      setAiHealthDetail('inactive');
      const replayProofs = snapshot?.evidence
        .filter((proof) => proof.subjectId.includes('chat') || proof.subjectId.includes('ai_') || proof.subjectId.includes('shared_room') || proof.subjectId.includes('realtime') || proof.subjectId.includes('inbox_sync'))
        .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())
        .slice(0, 3) ?? [];
      const replayNodes = snapshot?.systemNodes
        .filter((node) => node.id.includes('chat') || node.id.includes('realtime') || node.id.includes('ai_runtime') || node.id.includes('shared_room'))
        .sort((a, b) => a.name.localeCompare(b.name))
        .slice(0, 6) ?? [];
      return [
        `Result: ${replayResult.success ? 'success' : 'failed'}`,
        `Explanation: Replayed ${getActionLabel(latestReplayable.actionType)}. ${replayResult.message}`,
        `Evidence: ${replayProofs.slice(0, 2).map((proof) => proof.claim).join(' | ') || 'No linked proof rows yet'}`,
        `Affected dependencies: ${replayNodes.slice(0, 4).map((node) => node.name).join(' → ') || 'chat transport'}`,
        `Operator action log: replay:${latestReplayable.id}`,
        `Rollback: ${latestReplayable.rollbackAvailable ? 'available' : 'not available'}`,
        `Linked proof cards: ${replayProofs.slice(0, 3).map((proof) => proof.id).join(', ') || 'none'}`,
      ].join('\n');
    }

    if (isCommandBrainCommand(command)) {
      const brainResponse = await runCommandBrain(command, args);
      if (brainResponse) {
        return brainResponse;
      }
    }

    return null;
  }, [queryClient]);

  const sendMessageMutation = useMutation<void, Error, { text: string; mode: 'send_only' | 'send_and_ai' | 'ai_only'; clientId: string; capturedText: string; replyTo: ChatReplyContext | null; watchdogTraceId?: string | null }>({
    mutationFn: async ({ text, mode, clientId, capturedText, replyTo, watchdogTraceId }) => {
      console.log('[IVX_TRACE] 2.1_SEND_MUTATION_START', { clientId, mode, localFirstChatMode, textLength: text.length });
      const persistedOwnerText = encodeReplyBody(text, replyTo);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const hasConfirmationPrefix = isExplicitSensitiveActionConfirmation(text);
      const strippedConfirmedText = stripSensitiveActionConfirmationPrefix(text);
      const strippedTrustContext = resolveOwnerTrustContext({
        messageText: strippedConfirmedText,
        ownerRoomAuthenticated,
        backendAdminVerified,
        fallbackModeActive: fallbackChatOnlyActive,
        devTestModeActive: devTestMode.testModeActive,
      });
      const confirmedSensitiveAction = hasConfirmationPrefix && strippedTrustContext.requiresElevatedConfirmation;
      const effectiveText = confirmedSensitiveAction ? strippedConfirmedText : text;
      const trustContext = confirmedSensitiveAction
        ? strippedTrustContext
        : resolveOwnerTrustContext({
          messageText: effectiveText,
          ownerRoomAuthenticated,
          backendAdminVerified,
          fallbackModeActive: fallbackChatOnlyActive,
          devTestModeActive: devTestMode.testModeActive,
        });

      // BUILD-INTENT ROUTING (runs BEFORE any chat-mode branch) — build app,
      // build module, create feature, fix bug, and deploy requests must NOT
      // produce chat narrative and must NOT trigger database/schema inspection.
      // They route directly to the self-hosted Senior Developer Worker as an
      // owner-approved job. A pending draft is executed on /confirm. Database
      // inspection only happens when the owner explicitly asks for it.
      const isConfirmReply = isExplicitSensitiveActionConfirmation(text);
      const wdSenior = watchdogTraceId ? activeWatchdogTracesRef.current.get(watchdogTraceId) ?? null : null;
      if (isConfirmReply && pendingBuildDraftRef.current) {
        const approvedDraft = pendingBuildDraftRef.current;
        pendingBuildDraftRef.current = null;
        await sendQueue.mutateAsync({ text: persistedOwnerText, mode, clientId, replyTo, senderLabel: ownerLabel, capturedText });
        setLastSendAt(new Date().toISOString());
        wdSenior?.pass('AI_TRIGGER_DECISION', 'branch=senior_developer_confirm');
        await runSeniorDeveloperWorkerFromChat(approvedDraft);
        wdSenior?.complete('SUCCESS');
        return;
      }
      if (!isConfirmReply && isSeniorDeveloperBuildRequest(effectiveText)) {
        const draft = buildSeniorDeveloperJobDraft(effectiveText);
        await sendQueue.mutateAsync({ text: persistedOwnerText, mode, clientId, replyTo, senderLabel: ownerLabel, capturedText });
        setLastSendAt(new Date().toISOString());
        wdSenior?.pass('AI_TRIGGER_DECISION', 'branch=senior_developer_build');
        // Submit directly to the autonomous senior developer worker.
        // The worker will execute audits/diagnosis/code edits/tests autonomously
        // and pause at WAITING_APPROVAL before any production mutation.
        void runSeniorDeveloperWorkerFromChat(draft);
        wdSenior?.complete('SUCCESS');
        return;
      }

      if (localFirstChatMode) {
        const wdLF = watchdogTraceId ? activeWatchdogTracesRef.current.get(watchdogTraceId) ?? null : null;
        try {
          await sendQueue.mutateAsync({ text: persistedOwnerText, mode, clientId, replyTo, senderLabel: ownerLabel, capturedText });
          setLastSendAt(new Date().toISOString());
          if (trustContext.requiresElevatedConfirmation && !confirmedSensitiveAction) {
            wdLF?.pass('AI_TRIGGER_DECISION', 'branch=local_first_elevated_confirmation');
            await persistSupportMessage(buildLocalSafeActionConfirmationMessage({
              normalizedText: effectiveText,
              requestClass: trustContext.requestClass,
            }), 'assistant');
            wdLF?.complete('SUCCESS');
            return;
          }
        } catch (sendError) {
          wdLF?.fail('AI_TRIGGER_DECISION', `sendQueue failed in localFirst: ${sendError instanceof Error ? sendError.message : String(sendError)}`);
          throw sendError instanceof Error ? sendError : new Error(String(sendError));
        }

        if (mode === 'send_and_ai' || mode === 'ai_only') {
          console.log('[IVX_TRACE] 2.2_AI_TRIGGER_LOCAL_FIRST', { clientId, mode });
          wdLF?.pass('AI_TRIGGER_DECISION', `branch=local_first mode=${mode}`);
          // Synchronously mark the assistant mutation as started so the watchdog
          // never reports a phantom stall at AI_TRIGGER_DECISION if the async
          // call is delayed or queued behind an earlier mutation.
          wdLF?.pass('AI_MUTATION_STARTED', `local_first branch invoking assistantReplyMutation mode=${mode}`, { clientId });
          // Retry-once guard: catch the first rejection, log it, and retry once
          try {
            await assistantReplyMutation.mutateAsync({ text: effectiveText, nonBlocking: mode === 'send_and_ai', watchdogTraceId });
          } catch (aiErr) {
            console.log('[IVX_TRACE] 2.X_LOCAL_FIRST_AI_RETRY_1', { clientId, err: aiErr instanceof Error ? aiErr.message : String(aiErr) });
            await assistantReplyMutation.mutateAsync({ text: effectiveText, nonBlocking: mode === 'send_and_ai', watchdogTraceId });
          }
        } else {
          console.log('[IVX_TRACE] 2.X_LOCAL_FIRST_NO_AI_BRANCH', { clientId, mode });
          wdLF?.pass('AI_TRIGGER_DECISION', `branch=local_first_send_only mode=${mode}`);
          wdLF?.complete('SUCCESS');
        }
        return;
      }

      const commandResult = parseOwnerCommand(effectiveText);

      if (commandResult) {
        console.log('[IVXOwnerChatRoute] Processing owner command:', commandResult.command, 'trust:', trustContext.namedStates, 'confirmed:', confirmedSensitiveAction);
        liveIntelligenceService.captureEvent({
          eventName: 'routing_selected',
          screen: '/ivx/chat',
          module: 'chat',
          sessionId: ownerSessionIdRef.current,
          userId: ownerId || null,
          anonId: ownerId || ownerSessionIdRef.current,
          metadata: {
            roomId: conversationQuery.data?.id ?? 'ivx-owner-room',
            command: commandResult.command,
            args: commandResult.args,
            confirmedSensitiveAction,
            requestClass: trustContext.requestClass,
            trustStates: trustContext.namedStates,
          },
        });
        const wdCmd = watchdogTraceId ? activeWatchdogTracesRef.current.get(watchdogTraceId) ?? null : null;
        try {
          await sendQueue.mutateAsync({ text: persistedOwnerText, mode, clientId, replyTo, senderLabel: ownerLabel, capturedText });
          setLastSendAt(new Date().toISOString());
          if (trustContext.conversationAccessState === 'fallback_chat_only' && trustContext.requiresElevatedConfirmation) {
            await persistSupportMessage(buildFallbackChatOnlyExecutionMessage({
              normalizedText: effectiveText,
              requestClass: trustContext.requestClass,
            }), 'system');
            return;
          }
          if (trustContext.requiresElevatedConfirmation && !confirmedSensitiveAction) {
            wdCmd?.pass('AI_TRIGGER_DECISION', 'branch=owner_command_elevated_confirmation');
            await persistSupportMessage(buildSensitiveActionConfirmationMessage({
              normalizedText: effectiveText,
              requestClass: trustContext.requestClass,
              conversationAccessState: trustContext.conversationAccessState,
              backendAdminVerified: trustContext.backendAdminState === 'backend_admin_verified',
            }), 'system');
            wdCmd?.complete('SUCCESS');
            return;
          }
          wdCmd?.pass('AI_TRIGGER_DECISION', `branch=owner_command command=${commandResult.command}`);
          const structuredResponse = await buildCommandContractResponse(commandResult.command, commandResult.args);
          await persistSupportMessage(structuredResponse ?? commandResult.response, 'system');
          wdCmd?.complete('SUCCESS');
        } catch (sendError) {
          throw sendError instanceof Error ? sendError : new Error(String(sendError));
        }

        if (commandResult.command === 'reconnect') {
          invalidateIVXRoomProbeCache();
          await queryClient.invalidateQueries({ queryKey: IVX_ROOM_STATUS_QUERY_KEY });
        }
        if (commandResult.command === 'probe') {
          setAiHealthDetail('inactive');
        }
        if (commandResult.command === 'knowledge' && safeTrim(commandResult.args)) {
          console.log('[IVXOwnerChatRoute] Routing knowledge query to AI:', commandResult.args.slice(0, 40));
          // Synchronously mark the assistant mutation as started so the watchdog
          // never reports a phantom stall at AI_TRIGGER_DECISION if the async
          // call is delayed or queued behind an earlier mutation.
          wdCmd?.pass('AI_MUTATION_STARTED', `owner_command knowledge invoking assistantReplyMutation`, { command: commandResult.command });
          await assistantReplyMutation.mutateAsync({ text: `[Knowledge Query] ${commandResult.args}`, nonBlocking: false });
        }
        return;
      }

      liveIntelligenceService.captureEvent({
        eventName: 'chat_message',
        screen: '/ivx/chat',
        module: 'chat',
        sessionId: ownerSessionIdRef.current,
        userId: ownerId || null,
        anonId: ownerId || ownerSessionIdRef.current,
        metadata: {
          roomId: conversationQuery.data?.id ?? 'ivx-owner-room',
          role: 'owner',
          message: sanitizeUserFacingChatText(text),
          confirmedSensitiveAction,
          requestClass: trustContext.requestClass,
          trustStates: trustContext.namedStates,
        },
      });
      try {
        const queueResult = await sendQueue.mutateAsync({ text: persistedOwnerText, mode, clientId, replyTo, senderLabel: ownerLabel, capturedText });
        setLastSendAt(new Date().toISOString());
        void recordIVXOwnerChatAuditEvent({
          action: 'message_send',
          conversationId: 'ivx-owner-room',
          messageId: queueResult.messageId,
          status: 'success',
          summary: 'Owner message saved through the IVX chat send path.',
          metadata: { mode, requestClass: trustContext.requestClass, confirmedSensitiveAction, trustStates: trustContext.namedStates, sessionId: ownerSessionIdRef.current },
        });
        console.log('[IVXOwnerChatRoute] Owner message sent to Supabase. trust:', trustContext.namedStates, 'confirmed:', confirmedSensitiveAction);
      } catch (sendError) {
        console.log('[IVX_TRACE] 2.X_SEND_QUEUE_THREW_NO_AI_TRIGGER', { clientId, errorMessage: sendError instanceof Error ? sendError.message : String(sendError) });
        const wdSendFail = watchdogTraceId ? activeWatchdogTracesRef.current.get(watchdogTraceId) ?? null : null;
        wdSendFail?.fail('AI_TRIGGER_DECISION', `sendQueue threw: ${sendError instanceof Error ? sendError.message : String(sendError)}`);
        throw sendError instanceof Error ? sendError : new Error(String(sendError));
      }

      const watchdogTrace = watchdogTraceId ? activeWatchdogTracesRef.current.get(watchdogTraceId) ?? null : null;

      if (trustContext.requiresElevatedConfirmation && !confirmedSensitiveAction) {
        console.log('[IVX_TRACE] 2.X_ELEVATED_CONFIRMATION_EARLY_RETURN', { clientId, requestClass: trustContext.requestClass, namedStates: trustContext.namedStates });
        watchdogTrace?.pass('AI_TRIGGER_DECISION', `branch=elevated_confirmation class=${trustContext.requestClass}`);
        await persistSupportMessage(buildSensitiveActionConfirmationMessage({
          normalizedText: effectiveText,
          requestClass: trustContext.requestClass,
          conversationAccessState: trustContext.conversationAccessState,
          backendAdminVerified: trustContext.backendAdminState === 'backend_admin_verified',
        }), 'system');
        watchdogTrace?.complete('SUCCESS');
        return;
      }
      if (mode === 'ai_only') {
        console.log('[IVX_TRACE] 2.2_AI_TRIGGER_AI_ONLY', { clientId });
        watchdogTrace?.pass('AI_TRIGGER_DECISION', 'branch=ai_only');
        // Synchronously mark the assistant mutation as started so the watchdog
        // never reports a phantom stall at AI_TRIGGER_DECISION if the async
        // call is delayed or queued behind an earlier mutation.
        watchdogTrace?.pass('AI_MUTATION_STARTED', 'ai_only branch invoking assistantReplyMutation', { clientId });
        await assistantReplyMutation.mutateAsync({ text: effectiveText, nonBlocking: false, watchdogTraceId });
        return;
      }

      if (mode === 'send_and_ai') {
        console.log('[IVX_TRACE] 2.2_AI_TRIGGER_SEND_AND_AI', { clientId, aiReachable: aiReachableRef.current, trust: trustContext.namedStates });
        console.log('[IVXOwnerChatRoute] Auto-triggering AI reply after send, aiReachable:', aiReachableRef.current, 'trust:', trustContext.namedStates);
        watchdogTrace?.pass('AI_TRIGGER_DECISION', 'branch=send_and_ai');
        // Synchronously mark the assistant mutation as started so the watchdog
        // never reports a phantom stall at AI_TRIGGER_DECISION if the async
        // call is delayed or queued behind an earlier mutation.
        watchdogTrace?.pass('AI_MUTATION_STARTED', 'send_and_ai branch invoking assistantReplyMutation', { clientId });
        // Retry-once wrapper: if the first AI mutation attempt fails, retry once
        // before surfacing the error. The watchdog still records each attempt.
        // We now await the wrapper so the send mutation lifecycle stays coherent
        // with the AI call and the watchdog trace remains active until the full
        // round trip finishes or fails.
        const triggerAIWithRetry = async () => {
          try {
            await assistantReplyMutation.mutateAsync({ text: effectiveText, nonBlocking: true, watchdogTraceId });
          } catch (firstErr) {
            console.log('[IVX_TRACE] 2.X_AI_TRIGGER_RETRY_1', { clientId, err: firstErr instanceof Error ? firstErr.message : String(firstErr) });
            try {
              await assistantReplyMutation.mutateAsync({ text: effectiveText, nonBlocking: true, watchdogTraceId });
            } catch (secondErr) {
              console.log('[IVX_TRACE] 2.X_AI_TRIGGER_BOTH_FAILED', { clientId, err: secondErr instanceof Error ? secondErr.message : String(secondErr) });
              watchdogTrace?.fail('AI_MUTATION_STARTED', `assistantReplyMutation rejected twice: ${secondErr instanceof Error ? secondErr.message : String(secondErr)}`);
            }
          }
        };
        await triggerAIWithRetry();
      } else if (mode === 'send_only') {
        watchdogTrace?.pass('AI_TRIGGER_DECISION', 'branch=send_only_no_ai');
        watchdogTrace?.complete('SUCCESS');
      }
    },
    onSuccess: async (_data, variables) => {
      // Refetch the authoritative remote thread FIRST so the just-sent owner row
      // is present in `messages` BEFORE the optimistic pending copy is removed.
      // This guarantees continuity — the turn is always shown by either the
      // pending entry or the persisted remote row, never neither (no
      // "message disappears after send" gap). The owner content-dedup in
      // `allMessages` suppresses the optimistic copy the moment the remote row
      // arrives, so the brief overlap never renders a duplicate.
      commitComposerClear(variables.capturedText);
      try {
        await queryClient.invalidateQueries({ queryKey: IVX_OWNER_MESSAGES_QUERY_KEY });
      } catch (refetchError) {
        console.log('[IVXOwnerChatRoute] Post-send refetch failed (optimistic row retained until next load):', refetchError instanceof Error ? refetchError.message : 'unknown');
      } finally {
        setPendingOwnerMessages((current) => current.filter((message) => message.clientId !== variables.clientId));
      }
      requestAnimationFrame(() => {
        flatListRef.current?.scrollToEnd({ animated: true });
      });
    },
    onError: (error, variables) => {
      setPendingOwnerMessages((current) => current.map((message) => (
        message.clientId === variables.clientId
          ? { ...message, status: 'failed', errorMessage: error.message }
          : message
      )));
      console.log('[IVXOwnerChatRoute] Send mutation error:', error.message, 'clientId:', variables.clientId);
      void recordIVXOwnerChatAuditEvent({
        action: 'message_send',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        messageId: variables.clientId,
        status: 'failed',
        summary: 'Owner message send failed.',
        metadata: { error: error.message, mode: variables.mode, sessionId: ownerSessionIdRef.current },
      });
      Alert.alert('Message not sent', error.message);
    },

  });

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const applyCapabilityProbeResult = (result: Awaited<ReturnType<typeof ivxAIRequestService.probeOwnerAIHealth>>) => {
      const fullProbeAIAvailable = result.health === 'active' && result.capabilities?.ai_chat === true;
      const proxyConnected = aiProxyConnectedRef.current;
      const aiAvailable = fullProbeAIAvailable || proxyConnected;
      setAiBackendReachable(aiAvailable);
      setAiHealthDetail(aiAvailable ? 'active' : 'inactive');
      setKnowledgeActive(result.capabilities?.knowledge_answers === true);
      setOwnerCommandsActive(result.capabilities?.owner_commands === true);
      setCodeAwareActive(result.capabilities?.code_aware_support === true);
      setFileUploadActive(result.capabilities?.file_upload === true);
      if (aiAvailable) {
        probeRetryCount.current = 0;
      }
    };

    const singleProbeAttempt = async (): Promise<Awaited<ReturnType<typeof ivxAIRequestService.probeOwnerAIHealth>>> => {
      const result = await ivxAIRequestService.probeOwnerAIHealth();
      setAiProbeMetadata((current) => ({
        observedAt: new Date().toISOString(),
        source: result.source,
        endpoint: result.endpoint,
        deploymentMarker: result.deploymentMarker,
        lastFailureReason: result.health === 'inactive' ? current.lastFailureReason : null,
      }));
      setRuntimeDebugSnapshot((current) => ({
        ...current,
        conversationId: conversationQuery.data?.id ?? current.conversationId,
        source: shouldPreserveRequestScopedRuntime(current) ? current.source : 'unknown',
        endpoint: result.endpoint ?? current.endpoint,
        deploymentMarker: result.deploymentMarker ?? current.deploymentMarker,
      }));
      if (result.roomStatus) {
        setRoomProbeAt(new Date().toISOString());
        queryClient.setQueryData<ChatRoomStatus>(IVX_ROOM_STATUS_QUERY_KEY, result.roomStatus);
      }
      console.log('[IVXOwnerChatRoute] AI health probe result:', {
        health: result.health,
        source: result.source,
        endpoint: result.endpoint,
        deploymentMarker: result.deploymentMarker,
        storageMode: result.roomStatus?.storageMode ?? ivxRoomStatus?.storageMode ?? 'unknown',
      });
      return result;
    };

    const probe = async () => {
      const result = await singleProbeAttempt();
      void recordIVXOwnerChatAuditEvent({
        action: 'sync_probe',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        status: result.health === 'active' ? 'success' : 'failed',
        summary: 'IVX Owner AI backend capability probe completed.',
        metadata: { health: result.health, source: result.source, endpoint: result.endpoint, deploymentMarker: result.deploymentMarker, sessionId: ownerSessionIdRef.current },
      });
      if (cancelled) return;

      if (result.health === 'active') {
        applyCapabilityProbeResult(result);
        return;
      }

      if (probeRetryCount.current < MAX_PROBE_RETRIES) {
        probeRetryCount.current += 1;
        console.log('[IVXOwnerChatRoute] AI health probe: retry', probeRetryCount.current, 'of', MAX_PROBE_RETRIES, 'in', PROBE_RETRY_DELAY_MS, 'ms');
        await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_DELAY_MS));
        if (cancelled) return;
        const retryResult = await singleProbeAttempt();
        if (cancelled) return;
        if (retryResult.health === 'active') {
          applyCapabilityProbeResult(retryResult);
          return;
        }
      }

      console.log('[IVXOwnerChatRoute] AI health probe: inactive after retries');
      const proxyConnected = aiProxyConnectedRef.current;
      if (proxyConnected) {
        console.log('[IVXOwnerChatRoute] Keeping AI connected from fast proxy status while full capability probe recovers');
      }
      setAiBackendReachable(proxyConnected);
      setAiHealthDetail(proxyConnected ? 'active' : 'inactive');
      setKnowledgeActive(false);
      setOwnerCommandsActive(false);
      setCodeAwareActive(false);
      setFileUploadActive(false);
    };

    const initialDelay = setTimeout(() => {
      if (!cancelled) void probe();
    }, 1500);

    intervalId = setInterval(() => {
      void probe();
    }, AI_PROBE_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearTimeout(initialDelay);
      if (intervalId) clearInterval(intervalId);
    };
  }, [ivxRoomStatus?.storageMode, queryClient]);

  const runtimeSignals = useMemo<ChatRoomRuntimeSignals>(() => {
    if (localFirstChatMode) {
      return {
        aiBackendHealth: 'active',
        aiBackendSource: 'local_app_brain',
        aiResponseState: aiReplyPending ? 'responding' : 'idle',
        fileUploadAvailability: 'inactive',
        knowledgeBackendHealth: 'inactive',
        ownerCommandAvailability: 'inactive',
        codeAwareServiceAvailability: 'inactive',
      };
    }

    const normalizedRuntimeState = {
      source: normalizeRuntimeSource(runtimeDebugSnapshot.source),
      requestStage: runtimeDebugSnapshot.requestStage,
      failureClass: runtimeDebugSnapshot.failureClass,
      isFallback: runtimeDebugSnapshot.source === 'provider_fallback',
      isStreaming: hasActiveStreamingState(runtimeDebugSnapshot),
      hasVisibleResponseText: runtimeDebugSnapshot.hasVisibleResponseText,
    };
    const activeRuntimeSource = getActiveRuntimeSource(normalizedRuntimeState);
    const hasFailure = hasRuntimeFailure(normalizedRuntimeState);
    const proxyConnected = aiProxyStatus.status === 'connected';
    const effectiveAiHealth: ServiceRuntimeHealth = hasFailure
      ? 'inactive'
      : activeRuntimeSource === 'remote_api' || aiHealthDetail === 'active' || proxyConnected
        ? 'active'
        : 'inactive';
    const isAiLive = effectiveAiHealth === 'active';
    const resolvedAISource = activeRuntimeSource === 'unknown' && proxyConnected
      ? 'remote_api'
      : activeRuntimeSource;
    return {
      aiBackendHealth: effectiveAiHealth,
      aiBackendSource: resolvedAISource === 'pending' ? 'unknown' : resolvedAISource,
      aiResponseState: isAiLive ? 'idle' : 'inactive',
      fileUploadAvailability: fileUploadActive ? 'active' : 'inactive',
      knowledgeBackendHealth: knowledgeActive ? 'active' : 'inactive',
      ownerCommandAvailability: ownerCommandsActive ? 'active' : 'inactive',
      codeAwareServiceAvailability: codeAwareActive ? 'active' : 'inactive',
    };
  }, [aiHealthDetail, aiProxyStatus.status, aiReplyPending, codeAwareActive, devTestMode.testModeActive, fileUploadActive, knowledgeActive, localFirstChatMode, ownerCommandsActive, runtimeDebugSnapshot]);

  const resolution = useMemo<RoomCapabilityResolution>(() => {
    console.log('[IVXOwnerChatRoute] Resolving capabilities:', {
      storageMode: ivxRoomStatus?.storageMode ?? 'unknown',
      deliveryMethod: ivxRoomStatus?.deliveryMethod ?? 'unknown',
      aiHealth: effectiveAiHealthDetail,
      aiReachable: effectiveAiBackendReachable,
      knowledgeActive,
      ownerCommandsActive,
      codeAwareActive,
      fileUploadActive,
    });
    return resolveRoomCapabilityState(ivxRoomStatus, runtimeSignals);
  }, [effectiveAiBackendReachable, effectiveAiHealthDetail, ivxRoomStatus, runtimeSignals, knowledgeActive, ownerCommandsActive, codeAwareActive, fileUploadActive]);

  const clearUploadProgressTimer = useCallback((clientId: string) => {
    const timer = uploadProgressTimersRef.current[clientId];
    if (timer) {
      clearInterval(timer);
      delete uploadProgressTimersRef.current[clientId];
    }
  }, []);

  const startUploadProgressTimer = useCallback((clientId: string) => {
    clearUploadProgressTimer(clientId);
    uploadProgressTimersRef.current[clientId] = setInterval(() => {
      setPendingOwnerMessages((current) => current.map((message) => {
        if (message.clientId !== clientId || message.status !== 'uploading') {
          return message;
        }
        const currentProgress = typeof message.uploadProgress === 'number' ? message.uploadProgress : 8;
        const nextProgress = Math.min(92, currentProgress + Math.max(3, Math.round((96 - currentProgress) / 7)));
        return { ...message, uploadProgress: nextProgress };
      }));
    }, 420);
  }, [clearUploadProgressTimer]);

  useEffect(() => {
    return () => {
      Object.values(uploadProgressTimersRef.current).forEach((timer) => clearInterval(timer));
      uploadProgressTimersRef.current = {};
    };
  }, []);

  const attachmentMutation = useMutation<IVXMessage, Error, { upload: IVXUploadInput; clientId: string; capturedBody: string; replyTo: ChatReplyContext | null }>({
    mutationFn: async ({ upload, capturedBody, replyTo }) => {
      const persistedAttachmentBody = encodeReplyBody(capturedBody, replyTo);
      console.log('[IVXOwnerChatRoute] Attachment send body length:', capturedBody.length, 'replyTo:', replyTo?.messageId ?? null);
      return ivxChatService.sendOwnerAttachmentMessage({
        upload,
        body: persistedAttachmentBody,
        senderLabel: ownerLabel,
      });
    },
    onSuccess: async (_message, variables) => {
      clearUploadProgressTimer(variables.clientId);
      setPendingOwnerMessages((current) => current.map((message) => (
        message.clientId === variables.clientId
          ? { ...message, status: 'uploaded', uploadProgress: 100, errorMessage: null }
          : message
      )));
      commitComposerClear(variables.capturedBody);
      if (variables.replyTo) {
        setSelectedReplyContext(null);
      }
      void recordIVXOwnerChatAuditEvent({
        action: 'attachment_upload',
        conversationId: _message.conversationId,
        messageId: _message.id,
        status: 'success',
        summary: 'Owner attachment uploaded and persisted in the IVX room.',
        metadata: {
          fileName: variables.upload.name,
          fileType: variables.upload.type ?? null,
          size: variables.upload.size ?? null,
          attachmentKind: _message.attachmentKind,
          sessionId: ownerSessionIdRef.current,
        },
      });
      await queryClient.invalidateQueries({ queryKey: IVX_OWNER_MESSAGES_QUERY_KEY });
      setTimeout(() => {
        setPendingOwnerMessages((current) => current.filter((message) => message.clientId !== variables.clientId));
      }, 650);
    },
    onError: (error, variables) => {
      clearUploadProgressTimer(variables.clientId);
      setPendingOwnerMessages((current) => current.map((message) => (
        message.clientId === variables.clientId
          ? { ...message, status: 'failed', uploadProgress: null, errorMessage: `Upload failed: ${error.message}` }
          : message
      )));
      void recordIVXOwnerChatAuditEvent({
        action: 'attachment_upload',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        messageId: variables.clientId,
        status: 'failed',
        summary: 'Owner attachment upload failed.',
        metadata: { error: error.message, fileName: variables.upload.name, sessionId: ownerSessionIdRef.current },
      });
      Alert.alert('Upload failed', error.message);
    },
  });

  const handleComposerChange = useCallback((value: string) => {
    composerValueRef.current = value;
    setComposerValue(value);
  }, []);

  const commitComposerClear = useCallback((capturedText?: string) => {
    const latestValue = normalizeComposerText(composerValueRef.current);
    const preservedValue = normalizeComposerText(capturedText);
    if (preservedValue.length > 0 && latestValue !== preservedValue) {
      console.log('[IVXOwnerChatRoute] Composer changed after send started, preserving latest draft');
      return;
    }

    setSelectedReplyContext(null);
    composerValueRef.current = '';
    setComposerValue('');
    setComposerInputHeight(44);
    composerInputRef.current?.clear();
    void AsyncStorage.removeItem(IVX_OWNER_DRAFT_STORAGE_KEY).catch((error) => {
      console.log('[IVXOwnerChatRoute] Failed to clear owner draft after send:', error instanceof Error ? error.message : 'unknown');
    });
  }, []);

  const handleApplyPromptTemplate = useCallback((template: OwnerPromptTemplate) => {
    const currentText = normalizeComposerText(composerValueRef.current).trim();
    const nextText = currentText ? `${template.prompt}\n\n${currentText}` : template.prompt;
    composerValueRef.current = nextText;
    setComposerValue(nextText);
    setComposerInputHeight(Math.min(Math.max(Math.ceil(nextText.length / 28) * 22 + 22, 44), 112));
    composerInputRef.current?.focus();
    void Haptics.selectionAsync();
    void recordIVXOwnerChatAuditEvent({
      action: 'template_apply',
      conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
      status: 'success',
      summary: `Owner prompt template applied: ${template.label}.`,
      metadata: { templateId: template.id, sessionId: ownerSessionIdRef.current },
    });
  }, [conversationQuery.data?.id]);

  const stopVoiceRecording = useCallback(async () => {
    try {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      await audioRecorder.stop();
      await setAudioModeAsync({ allowsRecording: false });
      const uri = audioRecorder.uri;
      if (!uri) {
        Alert.alert('Voice not saved', 'No recording file was created. Please try again.');
        return;
      }
      await transcribeVoiceMutation.mutateAsync(uri);
    } catch (error) {
      console.log('[IVXOwnerChatRoute] Stop voice recording error:', error instanceof Error ? error.message : 'unknown');
      Alert.alert('Voice not transcribed', 'We could not stop or transcribe that recording. Please try again.');
    }
  }, [audioRecorder, transcribeVoiceMutation]);

  const startVoiceRecording = useCallback(async () => {
    if (sendMessageMutation.isPending || attachmentMutation.isPending || isPickingFile || transcribeVoiceMutation.isPending || recorderState.isRecording) {
      return;
    }

    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Microphone permission required', 'Please allow microphone access to use voice input.');
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record({ forDuration: 120 });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      void recordIVXOwnerChatAuditEvent({
        action: 'voice_transcription',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        status: 'started',
        summary: 'Owner voice recording started.',
        metadata: { sessionId: ownerSessionIdRef.current, platform: Platform.OS },
      });
    } catch (error) {
      console.log('[IVXOwnerChatRoute] Start voice recording error:', error instanceof Error ? error.message : 'unknown');
      Alert.alert('Voice recording unavailable', 'We could not start recording. Please try again.');
    }
  }, [attachmentMutation.isPending, audioRecorder, conversationQuery.data?.id, isPickingFile, sendMessageMutation.isPending, recorderState.isRecording, transcribeVoiceMutation.isPending]);

  const handleVoicePress = useCallback(async () => {
    if (recorderState.isRecording) {
      await stopVoiceRecording();
      return;
    }
    await startVoiceRecording();
  }, [recorderState.isRecording, startVoiceRecording, stopVoiceRecording]);

  const handleSearchQueryChange = useCallback((value: string) => {
    setMessageSearchQuery(value);
    const trimmed = safeTrim(value);
    if (trimmed.length >= 3) {
      void recordIVXOwnerChatAuditEvent({
        action: 'search',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        status: 'success',
        summary: 'Owner searched the IVX Owner AI conversation.',
        metadata: { queryLength: trimmed.length, resultCount: displayedMessages.length, sessionId: ownerSessionIdRef.current },
      });
    }
  }, [conversationQuery.data?.id, displayedMessages.length]);

  const handleAskAI = useCallback((submittedText?: unknown) => {
    if (sendMessageMutation.isPending || aiReplyPending || attachmentMutation.isPending || isPickingFile || !composerHasText) return;
    const normalizedText = normalizeComposerText(submittedText, composerValueRef.current);
    const text = safeTrim(normalizedText);
    if (!text) {
      console.log('[IVXOwnerChatRoute] Skipping empty AI ask after normalization');
      return;
    }
    const clientId = createTransientMessageId('ivx-owner-ai-only-send');
    const createdAt = new Date().toISOString();
    const replyTo = selectedReplyContext;
    setPendingOwnerMessages((current) => [...current, { clientId, text: normalizedText, createdAt, mode: 'ai_only', status: 'sending', errorMessage: null, replyTo }]);
    setSelectedReplyContext(null);
    console.log('[IVXOwnerChatRoute] handleAskAI explicit AI request length:', text.length, 'clientId:', clientId, 'replyTo:', replyTo?.messageId ?? null);
    // A new owner message always starts a NEW action: replace any prior task
    // banner with the newly detected task (or clear it when this message is not
    // a task) so a stale "Auditing & verifying" banner can never hijack a fresh
    // unrelated message.
    const detectedTask = detectChatLiveWorkTask(text);
    setActiveLiveWorkTask(detectedTask ? { ...detectedTask, startedAt: createdAt } : null);
    sendMessageMutation.mutate({ text, mode: 'ai_only', clientId, capturedText: normalizedText, replyTo });
  }, [aiReplyPending, attachmentMutation.isPending, composerHasText, isPickingFile, sendMessageMutation.isPending, selectedReplyContext, sendMessageMutation]);

  const handleOpenLiveWork = useCallback((runSupabase?: boolean) => {
    const wantsSupabase = runSupabase ?? activeLiveWorkTask?.isSupabase ?? false;
    router.push((wantsSupabase ? '/ivx/live-work?run=supabase' : '/ivx/live-work') as never);
    void Haptics.selectionAsync().catch(() => undefined);
  }, [activeLiveWorkTask?.isSupabase, router]);

  const handleCopyTaskLog = useCallback(async () => {
    const tail = displayedMessages.slice(-12).map((m) => `${safeTrim(m.senderLabel) || 'message'}: ${safeTrim(m.body)}`).join('\n');
    const header = activeLiveWorkTask ? `IVX Live Work task: ${activeLiveWorkTask.label} (started ${activeLiveWorkTask.startedAt})` : 'IVX chat log';
    const ok = await safeSetString(`${header}\n\n${tail}`);
    if (ok) {
      Alert.alert('Copied', 'Task log copied to clipboard.');
    }
  }, [activeLiveWorkTask, displayedMessages]);

  const handleRetryMessage = useCallback((message: ChatMessage) => {
    const pendingMessage = pendingOwnerMessages.find((candidate) => candidate.clientId === message.id);
    const normalizedText = normalizeComposerText(pendingMessage?.text ?? message.text ?? '');
    const text = safeTrim(normalizedText);
    const isAttachmentRetry = pendingMessage?.mode === 'attachment' && pendingMessage.upload;
    if (!pendingMessage || (!text && !isAttachmentRetry) || sendMessageMutation.isPending || attachmentMutation.isPending) {
      console.log('[IVXOwnerChatRoute] Retry skipped:', message.id, 'hasPending:', Boolean(pendingMessage), 'busy:', sendMessageMutation.isPending || attachmentMutation.isPending);
      return;
    }

    if (isAttachmentRetry && pendingMessage.upload) {
      setPendingOwnerMessages((current) => current.map((candidate) => (
        candidate.clientId === pendingMessage.clientId
          ? { ...candidate, status: 'uploading', errorMessage: null, uploadProgress: 8 }
          : candidate
      )));
      startUploadProgressTimer(pendingMessage.clientId);
      console.log('[IVXOwnerChatRoute] Retrying failed owner attachment:', pendingMessage.clientId, pendingMessage.upload.name);
      attachmentMutation.mutate({ upload: pendingMessage.upload, clientId: pendingMessage.clientId, capturedBody: normalizedText, replyTo: pendingMessage.replyTo ?? null });
      return;
    }

    setPendingOwnerMessages((current) => current.map((candidate) => (
      candidate.clientId === pendingMessage.clientId
        ? { ...candidate, status: 'sending', errorMessage: null }
        : candidate
    )));
    console.log('[IVXOwnerChatRoute] Retrying failed owner message:', pendingMessage.clientId, 'mode:', pendingMessage.mode);
    sendMessageMutation.mutate({
      text,
      mode: pendingMessage.mode as 'send_only' | 'send_and_ai' | 'ai_only',
      clientId: pendingMessage.clientId,
      capturedText: normalizedText,
      replyTo: pendingMessage.replyTo ?? null,
    });
  }, [attachmentMutation, sendMessageMutation.isPending, pendingOwnerMessages, sendMessageMutation, startUploadProgressTimer]);

  /**
   * One-tap owner-session recovery from the chat screen: forces a Supabase
   * session refresh (logs out for a fresh login if that fails), confirms
   * ownerDetected, and — on success — automatically retries the most recent
   * failed Owner AI message so the owner never has to re-type it.
   */
  const handleRefreshOwnerSession = useCallback(async () => {
    if (isRefreshingOwnerSession) {
      return;
    }
    setIsRefreshingOwnerSession(true);
    try {
      const result = await refreshOwnerSession();
      console.log('[IVXOwnerChatRoute] Refresh Owner Session result:', result.step, 'ownerDetected:', result.ownerDetected, 'http:', result.httpStatus);
      if (result.ownerDetected) {
        setOwnerAuthFailureBanner(null);
        const lastFailed = [...pendingOwnerMessages].reverse().find((message) => message.status === 'failed');
        if (lastFailed) {
          console.log('[IVXOwnerChatRoute] Auto-retrying failed Owner AI message after session refresh:', lastFailed.clientId);
          handleRetryMessage({
            id: lastFailed.clientId,
            text: lastFailed.text,
          } as ChatMessage);
          Alert.alert('Owner session refreshed', 'ownerDetected: YES. Retrying your last message…');
        } else {
          Alert.alert('Owner session refreshed', 'ownerDetected: YES. Your owner session is active again.');
        }
      } else if (result.needsSignIn) {
        Alert.alert('Sign in required', result.message, [
          { text: 'Open Auth Diagnostics', onPress: () => router.push('/ivx/auth-diagnostics' as never) },
          { text: 'OK', style: 'cancel' },
        ]);
      } else {
        Alert.alert('Owner session still rejected', result.message, [
          { text: 'Open Auth Diagnostics', onPress: () => router.push('/ivx/auth-diagnostics' as never) },
          { text: 'OK', style: 'cancel' },
        ]);
      }
    } catch (error) {
      console.log('[IVXOwnerChatRoute] Refresh Owner Session error:', error instanceof Error ? error.message : 'unknown');
      Alert.alert('Refresh failed', error instanceof Error ? error.message : 'Owner session refresh failed.');
    } finally {
      setIsRefreshingOwnerSession(false);
    }
  }, [handleRetryMessage, isRefreshingOwnerSession, pendingOwnerMessages, router]);

  const handleDismissFailedMessage = useCallback((messageId: string) => {
    console.log('[IVXOwnerChatRoute] Removing failed local message:', messageId);
    clearUploadProgressTimer(messageId);
    setPendingOwnerMessages((current) => current.filter((message) => message.clientId !== messageId));
  }, [clearUploadProgressTimer]);

  const handleOpenAttachment = useCallback(async (message: IVXMessage) => {
    if (!message.attachmentUrl) {
      return;
    }

    try {
      await Linking.openURL(message.attachmentUrl);
    } catch (error) {
      Alert.alert('Unable to open attachment', error instanceof Error ? error.message : 'Unknown attachment error.');
    }
  }, []);

  const handlePickFile = useCallback(async () => {
    if (attachmentMutation.isPending || isPickingFile) {
      return;
    }
    if (draftAttachments.length >= IVX_MAX_DRAFT_ATTACHMENTS) {
      Alert.alert('Attachment limit reached', `You can attach up to ${IVX_MAX_DRAFT_ATTACHMENTS} files per message. Send these first, then add more.`);
      return;
    }

    try {
      await Haptics.selectionAsync();
      setIsPickingFile(true);
      const pickerResult = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: true,
        type: '*/*',
      });

      if (pickerResult.canceled || !pickerResult.assets || pickerResult.assets.length === 0) {
        console.log('[IVXOwnerChatRoute] Attachment picker canceled');
        return;
      }

      const remainingSlots = IVX_MAX_DRAFT_ATTACHMENTS - draftAttachments.length;
      const assets = (pickerResult.assets as PickerAsset[]).slice(0, remainingSlots);
      const truncated = pickerResult.assets.length > assets.length;

      const nextDrafts = assets.map((asset) => {
        const upload: IVXUploadInput = {
          uri: asset.uri,
          file: asset.file ?? null,
          name: asset.name?.trim() || asset.file?.name?.trim() || `ivx-file-${Date.now()}`,
          type: asset.mimeType ?? asset.file?.type ?? null,
          size: typeof asset.size === 'number'
            ? asset.size
            : typeof asset.file?.size === 'number'
              ? asset.file.size
              : null,
        };
        const mime = (upload.type ?? '').toLowerCase();
        const nameLower = upload.name.toLowerCase();
        const isImage = mime.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic|heif|bmp)$/.test(nameLower);
        const isVideo = mime.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv)$/.test(nameLower);
        return { upload, isImage, isVideo };
      });

      console.log('[IVXOwnerChatRoute] Attachments selected as draft batch:', nextDrafts.length, 'truncated:', truncated);
      setDraftAttachments((current) => [...current, ...nextDrafts].slice(0, IVX_MAX_DRAFT_ATTACHMENTS));
      if (truncated) {
        Alert.alert('Some files skipped', `Only ${IVX_MAX_DRAFT_ATTACHMENTS} files can be attached at once. The extra files were not added.`);
      }
      composerInputRef.current?.focus();
    } catch (error) {
      console.log('[IVXOwnerChatRoute] Attachment picker failed:', error instanceof Error ? error.message : 'unknown');
      Alert.alert('File pick failed', error instanceof Error ? error.message : 'Unknown file picker error.');
    } finally {
      setIsPickingFile(false);
    }
  }, [attachmentMutation.isPending, draftAttachments.length, isPickingFile]);

  const handleClearDraftAttachment = useCallback(() => {
    console.log('[IVXOwnerChatRoute] Cleared all draft attachments');
    setDraftAttachments([]);
  }, []);

  const handleRemoveDraftAttachment = useCallback((index: number) => {
    setDraftAttachments((current) => current.filter((_, idx) => idx !== index));
  }, []);

  const sendDraftAttachment = useCallback(async () => {
    if (draftAttachments.length === 0) return;
    const batch = draftAttachments.slice(0, IVX_MAX_DRAFT_ATTACHMENTS);
    const totalCount = batch.length;
    const composerText = normalizeComposerText(composerValueRef.current);
    const trimmed = safeTrim(composerText);
    const imageCount = batch.filter((item) => item.isImage).length;
    const videoCount = batch.filter((item) => item.isVideo).length;
    const otherCount = totalCount - imageCount - videoCount;
    const breakdown = [
      imageCount > 0 ? `${imageCount} image${imageCount === 1 ? '' : 's'}` : null,
      videoCount > 0 ? `${videoCount} video${videoCount === 1 ? '' : 's'}` : null,
      otherCount > 0 ? `${otherCount} other file${otherCount === 1 ? '' : 's'}` : null,
    ].filter((line): line is string => typeof line === 'string').join(', ');
    const defaultCaption = totalCount === 1
      ? (batch[0].isImage ? 'Analyze this image.' : batch[0].isVideo ? 'Analyze this video.' : 'Analyze this attachment.')
      : `Analyze all ${totalCount} attachments (${breakdown}).`;
    const captionText = trimmed.length > 0 ? composerText : defaultCaption;
    const replyTo = selectedReplyContext;

    console.log('[IVXOwnerChatRoute] Sending multi-attachment batch:', { totalCount, imageCount, videoCount, otherCount });

    // Clear composer + drafts immediately for snappy UX
    composerValueRef.current = '';
    setComposerValue('');
    setDraftAttachments([]);
    composerInputRef.current?.clear();
    Keyboard.dismiss();
    if (replyTo) {
      setSelectedReplyContext(null);
    }

    const fileInsights: IVXOwnerFileInsight[] = [];
    let successCount = 0;
    let failureCount = 0;

    for (let i = 0; i < batch.length; i += 1) {
      const { upload } = batch[i];
      const clientId = createTransientMessageId('ivx-owner-attachment');
      const itemCaption = totalCount === 1
        ? captionText
        : `(${i + 1}/${totalCount}) ${upload.name}`;
      try {
        const fileInsight = await ivxOwnerMemoryService.summarizePickedFile({
          uri: upload.uri ?? null,
          name: upload.name,
          mimeType: upload.type ?? null,
          size: upload.size ?? null,
          file: upload.file ?? null,
        });
        await ivxOwnerMemoryService.recordFileUpload(fileInsight);
        fileInsights.push(fileInsight);

        setPendingOwnerMessages((current) => [...current, {
          clientId,
          text: itemCaption,
          createdAt: new Date().toISOString(),
          mode: 'attachment',
          status: 'uploading',
          errorMessage: null,
          upload,
          uploadProgress: 8,
          replyTo: i === 0 ? replyTo : null,
        }]);
        startUploadProgressTimer(clientId);

        await attachmentMutation.mutateAsync({ upload, clientId, capturedBody: itemCaption, replyTo: i === 0 ? replyTo : null });
        successCount += 1;
      } catch (error) {
        failureCount += 1;
        console.log('[IVXOwnerChatRoute] Attachment upload failed in batch:', upload.name, error instanceof Error ? error.message : 'unknown');
      }
    }

    console.log('[IVXOwnerChatRoute] Multi-attachment batch complete:', { totalCount, successCount, failureCount, insightsRecorded: fileInsights.length });

    if (fileInsights.length === 0) {
      Alert.alert('Attachment send failed', 'No files were uploaded successfully. Please try again.');
      return;
    }

    try {
      const analysisPrompt = fileInsights.length === 1
        ? (trimmed.length > 0
          ? `${captionText}\n\n${createIVXOwnerFileUnderstandingPrompt(fileInsights[0])}`
          : createIVXOwnerFileUnderstandingPrompt(fileInsights[0]))
        : createIVXOwnerMultiFileUnderstandingPrompt({ files: fileInsights, caption: trimmed.length > 0 ? captionText : null });
      // Attachment analysis is a secondary AI call; there is no active send-message
      // watchdog trace here, so we rely on the defensive mutationFn guard and the
      // retry wrapper below. A failure is logged but does not block the user.
      await assistantReplyMutation.mutateAsync({
        text: analysisPrompt,
        nonBlocking: true,
      });
    } catch (error) {
      console.log('[IVXOwnerChatRoute] Multi-attachment AI analysis failed:', error instanceof Error ? error.message : 'unknown');
    }
  }, [assistantReplyMutation, attachmentMutation, draftAttachments, selectedReplyContext, startUploadProgressTimer]);

  const handleSend = useCallback((submittedText?: unknown) => {
    const tapAt = new Date().toISOString();
    console.log('[IVX_TRACE] 0_TAP_ENTER', { tapAt, sendPending: sendMessageMutation.isPending, attachPending: attachmentMutation.isPending, isPickingFile, draftAttachments: draftAttachments.length, composerHasText });
    ivxAIWatchdog.recordTap({ tapAt });
    if (sendMessageMutation.isPending || attachmentMutation.isPending || isPickingFile) {
      console.log('[IVX_TRACE] 0_TAP_BLOCKED_BUSY', { sendPending: sendMessageMutation.isPending, attachPending: attachmentMutation.isPending, isPickingFile });
      ivxAIWatchdog.recordTapBlocked('busy', { sendPending: sendMessageMutation.isPending, attachPending: attachmentMutation.isPending, isPickingFile });
      return;
    }
    if (draftAttachments.length > 0) {
      void sendDraftAttachment();
      return;
    }
    if (!composerHasText) {
      console.log('[IVX_TRACE] 0_TAP_BLOCKED_NO_TEXT', {});
      ivxAIWatchdog.recordTapBlocked('no_text', {});
      return;
    }
    const normalizedText = normalizeComposerText(submittedText, composerValueRef.current);
    const text = safeTrim(normalizedText);
    if (!text) {
      console.log('[IVX_TRACE] 0_TAP_BLOCKED_EMPTY_NORMALIZED', {});
      ivxAIWatchdog.recordTapBlocked('empty_after_normalize', {});
      return;
    }
    const isCommand = !localFirstChatMode && text.startsWith(OWNER_COMMAND_PREFIX);
    const mode = isCommand ? 'send_only' : 'send_and_ai';
    const clientId = createTransientMessageId('ivx-owner-local-send');
    const createdAt = new Date().toISOString();
    const replyTo = selectedReplyContext;
    setPendingOwnerMessages((current) => [...current, { clientId, text: normalizedText, createdAt, mode, status: 'sending', errorMessage: null, replyTo }]);
    setSelectedReplyContext(null);
    // Create a watchdog trace for this send. Each checkpoint will be reported
    // as the lifecycle progresses; if any fails or the trace stalls past 10s,
    // a BLOCKED/SILENT_FAILURE report is published to the in-app drawer + banner.
    const watchdogTrace = ivxAIWatchdog.createTrace({
      userMessageId: clientId,
      userText: text,
      conversationId: conversationQuery.data?.id ?? null,
    });
    activeWatchdogTracesRef.current.set(watchdogTrace.traceId, watchdogTrace);
    // Activate staged timeout banner for AI-bearing modes
    if (mode !== 'send_only') {
      stagedTimeoutStartRef.current = Date.now();
      setStagedTimeoutTraceId(watchdogTrace.traceId);
      setStagedTimeoutMessageId(clientId);
      setStagedTimeoutRequestStarted(false);
      setStagedTimeoutLastCheckpoint('SEND_TAP');
    }
    watchdogTrace.pass('SEND_TAP', `mode=${mode} length=${text.length}`, { clientId, isCommand });
    watchdogTrace.pass('USER_ROW_INSERTED', `pending clientId=${clientId}`, { clientId });
    console.log('[IVX_TRACE] 1_SEND_TAP', { mode, isCommand, clientId, textLength: text.length, localFirstChatMode, traceId: watchdogTrace.traceId });
    console.log('[IVX_TRACE] 2_USER_ROW_INSERTED', { clientId, pendingCountAfter: 'see next render', traceId: watchdogTrace.traceId });
    console.log('[IVXOwnerChatRoute] handleSend mode:', mode, 'isCommand:', isCommand, 'aiReachable:', aiReachableRef.current, 'length:', text.length, 'clientId:', clientId, 'replyTo:', replyTo?.messageId ?? null);
    // A new owner message always starts a NEW action: replace any prior task
    // banner with the newly detected task (or clear it when this message is not
    // a task) so a stale "Auditing & verifying" banner can never hijack a fresh
    // unrelated message.
    const detectedTask = detectChatLiveWorkTask(text);
    setActiveLiveWorkTask(detectedTask ? { ...detectedTask, startedAt: createdAt } : null);
    sendMessageMutation.mutate({ text, mode: mode as 'send_only' | 'send_and_ai', clientId, capturedText: normalizedText, replyTo, watchdogTraceId: watchdogTrace.traceId });
  }, [attachmentMutation.isPending, composerHasText, draftAttachments.length, isPickingFile, localFirstChatMode, sendMessageMutation.isPending, selectedReplyContext, sendDraftAttachment, sendMessageMutation]);

  const handleStartReplyToMessage = useCallback((message: ChatMessage) => {
    const previewText = safeTrim(message.text) || safeTrim(message.fileName) || 'Attachment';
    const replyContext: ChatReplyContext = {
      messageId: message.id,
      senderLabel: safeTrim(message.senderLabel) || 'Message',
      previewText: previewText.length > 140 ? `${previewText.slice(0, 137)}...` : previewText,
    };
    setSelectedReplyContext(replyContext);
    composerInputRef.current?.focus();
    console.log('[IVXOwnerChatRoute] Reply context selected:', replyContext.messageId);
    void recordIVXOwnerChatAuditEvent({
      action: 'reply_context',
      conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
      messageId: replyContext.messageId,
      status: 'success',
      summary: 'Owner selected a reply context in IVX Owner AI.',
      metadata: { senderLabel: replyContext.senderLabel, sessionId: ownerSessionIdRef.current },
    });
  }, [conversationQuery.data?.id]);

  const handleJumpToMessage = useCallback((messageId: string) => {
    const targetIndex = displayedMessages.findIndex((message) => message.id === messageId);
    const targetExistsOutsideSearch = searchActive && allMessages.some((message) => message.id === messageId);
    if (targetIndex < 0 && !targetExistsOutsideSearch) {
      console.log('[IVXOwnerChatRoute] Reply context original message missing:', messageId);
      setMissingReplyMessageId(messageId);
      Alert.alert('Original message unavailable', 'That replied-to message is not in this room anymore. The reply preview remains visible.');
      return;
    }

    if (highlightedMessageTimeoutRef.current) {
      clearTimeout(highlightedMessageTimeoutRef.current);
    }

    setMissingReplyMessageId(null);
    suppressAutoScrollUntilRef.current = Date.now() + 2200;
    setHighlightedMessageId(messageId);
    highlightedMessageTimeoutRef.current = setTimeout(() => {
      setHighlightedMessageId((current) => current === messageId ? null : current);
      highlightedMessageTimeoutRef.current = null;
    }, 1600);

    const scrollToTarget = (messages: IVXMessage[]) => {
      const resolvedIndex = messages.findIndex((message) => message.id === messageId);
      if (resolvedIndex < 0) {
        pendingJumpMessageIdRef.current = messageId;
        console.log('[IVXOwnerChatRoute] Reply context jump pending until full thread renders:', messageId);
        return;
      }
      pendingJumpMessageIdRef.current = null;
      flatListRef.current?.scrollToIndex({ index: resolvedIndex, animated: true, viewPosition: 0.35 });
      console.log('[IVXOwnerChatRoute] Jumped to reply context:', messageId, 'index:', resolvedIndex);
    };

    if (searchActive) {
      pendingJumpMessageIdRef.current = messageId;
      setMessageSearchQuery('');
      setTimeout(() => scrollToTarget(allMessages), 160);
      return;
    }

    scrollToTarget(displayedMessages);
  }, [allMessages, displayedMessages, searchActive]);

  const handleTogglePinnedMessage = useCallback((message: ChatMessage) => {
    setPinnedMessageIds((current) => {
      if (current.includes(message.id)) {
        console.log('[IVXOwnerChatRoute] Unpinned owner-room message:', message.id);
        void recordIVXOwnerChatAuditEvent({
          action: 'pin_message',
          conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
          messageId: message.id,
          status: 'success',
          summary: 'Owner unpinned a message in IVX Owner AI.',
          metadata: { pinned: false, sessionId: ownerSessionIdRef.current },
        });
        return current.filter((messageId) => messageId !== message.id);
      }

      console.log('[IVXOwnerChatRoute] Pinned owner-room message:', message.id);
      void recordIVXOwnerChatAuditEvent({
        action: 'pin_message',
        conversationId: conversationQuery.data?.id ?? IVX_OWNER_AI_PROFILE.sharedRoom.id,
        messageId: message.id,
        status: 'success',
        summary: 'Owner pinned a message in IVX Owner AI.',
        metadata: { pinned: true, sessionId: ownerSessionIdRef.current },
      });
      return [...current, message.id].filter((messageId, index, messageIds) => messageIds.indexOf(messageId) === index);
    });
  }, [conversationQuery.data?.id]);

  const renderMessage = useCallback(({ item, index }: { item: IVXMessage; index: number }) => {
    const previousMessage = index > 0 ? displayedMessages[index - 1] : null;
    const currentDayKey = formatMessageDateKey(item.createdAt);
    const previousDayKey = previousMessage ? formatMessageDateKey(previousMessage.createdAt) : null;
    const shouldShowDateSeparator = currentDayKey !== previousDayKey;
    const ownMessage = isOwnMessage(item, ownerId);
    const isAssistant = item.senderRole === 'assistant';
    const isSystem = item.senderRole === 'system';
    if (isAssistant) {
      console.log('[IVX_TRACE] 9_RENDER_MESSAGE_ASSISTANT', { id: item.id, bodyLength: (item.body ?? '').length, bodyPreview: (item.body ?? '').slice(0, 60), senderRole: item.senderRole });
      // Report the RENDER_MESSAGE_CALLED checkpoint OUTSIDE the render phase.
      // trace.pass() notifies watchdog subscribers (setState in useWatchdogSnapshot),
      // and renderMessage runs inside React's render. Scheduling on a microtask
      // moves the watchdog update out of render so React never warns
      // "Cannot update a component (IVXWatchdog…) while rendering a different component."
      const renderTraceItemId = item.id;
      const renderTraceBodyLen = (item.body ?? '').length;
      const scheduleRenderCheckpoint = typeof queueMicrotask === 'function'
        ? queueMicrotask
        : (cb: () => void): void => { setTimeout(cb, 0); };
      scheduleRenderCheckpoint(() => {
        const renderTrace = ivxAIWatchdog.getTraceForTransient(renderTraceItemId);
        renderTrace?.pass('RENDER_MESSAGE_CALLED', `id=${renderTraceItemId} bodyLen=${renderTraceBodyLen}`);
      });
    }

    // Safe render fallback: if a visible assistant row has an invalid/null/non-string
    // body (and no attachment), render a visible error bubble instead of silently
    // dropping it. This prevents the disappearing-reply class of bugs from ever
    // recurring even if upstream payload parsing breaks.
    if (isAssistant && !item.attachmentUrl && (typeof item.body !== 'string' || item.body.length === 0)) {
      if (__DEV__) {
        // eslint-disable-next-line no-console
        console.error('[IVXOwnerChatRoute][dev] Invalid assistant message body — rendering safe fallback bubble.', { id: item.id, body: item.body });
      }
      const fallbackChatMessage = {
        id: item.id,
        conversationId: item.conversationId,
        senderId: item.senderUserId ?? item.senderRole,
        senderLabel: item.senderLabel ?? IVX_OWNER_AI_PROFILE.name,
        text: 'I was unable to display this reply. Please try resending.',
        replyTo: null,
        createdAt: item.createdAt,
        sendStatus: 'failed' as const,
        optimistic: false,
        localOnly: false,
      } satisfies ChatMessage;
      return (
        <>
          {shouldShowDateSeparator ? <DateSeparator value={item.createdAt} /> : null}
          <View
            style={[styles.messageRow, styles.messageRowOther]}
            testID={`ivx-owner-message-${item.id}`}
          >
            <MessageBubble message={fallbackChatMessage} isMine={false} />
          </View>
        </>
      );
    }

    if (isSystem) {
      const structuredRows = parseStructuredSystemMessage(item.body);
      const resultRow = structuredRows?.find((row) => row.label.toLowerCase() === 'result');
      const isApprovalCard = resultRow?.value === 'OWNER_APPROVAL_REQUIRED';
      const approvalBody = item.body ?? '';
      return (
        <>
          {shouldShowDateSeparator ? <DateSeparator value={item.createdAt} /> : null}
          <View style={styles.systemMessageRow} testID={`ivx-owner-message-${item.id}`}>
          <View style={styles.systemBubble}>
            <View style={styles.systemLabelRow}>
              <Terminal size={12} color={Colors.info} />
              <Text style={styles.systemLabel}>{structuredRows ? 'Command Result' : 'System'}</Text>
            </View>
            {structuredRows ? (
              <View style={styles.commandCard} testID={`ivx-owner-command-card-${item.id}`}>
                {structuredRows.map((row, index) => (
                  <View key={`${item.id}-${row.label}-${index}`} style={styles.commandRow}>
                    <Text style={styles.commandLabel}>{row.label}</Text>
                    <Text style={styles.commandValue}>{row.value}</Text>
                  </View>
                ))}
              </View>
            ) : item.body ? <Text style={styles.systemText}>{item.body}</Text> : null}
            {isApprovalCard ? (
              <Pressable
                style={styles.approveRunButton}
                onPress={() => { void handleApproveAndRunFromCard(approvalBody); }}
                accessibilityRole="button"
                accessibilityLabel="Approve and run this build job"
                testID={`ivx-owner-approve-run-${item.id}`}
              >
                <PlayCircle size={16} color={Colors.black} />
                <Text style={styles.approveRunButtonText}>Approve + Run</Text>
              </Pressable>
            ) : null}
            <Text style={styles.systemMeta}>{formatMessageTime(item.createdAt)}</Text>
          </View>
        </View>
        </>
      );
    }

    // FINAL IVX IA CHAT EXECUTION MODE (owner mandate 2026-07-19): when the
    // assistant message carries an executionStatus payload (attached by the
    // send path when the backend returned 202 for fix/build/deploy/audit/QA/
    // refactor/migration/create module/create app/senior developer prompts),
    // render a live-polling ExecutionConsoleBubble instead of the plain
    // MessageBubble. The console polls the worker statusUrl, streams live
    // stage/progress, and swaps to the verified-evidence block when the job
    // reaches a terminal state. No narrative planning — execution only.
    const executionStatusForMessage = isAssistant
      ? executionStatusByMessageId.get(item.id) ?? null
      : null;
    if (isAssistant && executionStatusForMessage) {
      const coerced = coerceExecutionStatusFromPayload(executionStatusForMessage);
      if (coerced) {
        return (
          <>
            {shouldShowDateSeparator ? <DateSeparator value={item.createdAt} /> : null}
            <View
              style={[styles.messageRow, styles.messageRowOther]}
              testID={`ivx-owner-message-${item.id}`}
            >
              <ExecutionConsoleBubble
                initialStatus={coerced}
                authToken={null}
                categoryLabel={coerced.category ?? undefined}
              />
            </View>
          </>
        );
      }
    }

    const pendingState = pendingOwnerMessages.find((pendingMessage) => pendingMessage.clientId === item.id);
    const parsedReplyBody = pendingState?.replyTo ? { replyTo: pendingState.replyTo, body: item.body ?? '' } : parseReplyBody(item.body);
    const chatMessage = {
      id: item.id,
      conversationId: item.conversationId,
      senderId: item.senderUserId ?? item.senderRole,
      senderLabel: isAssistant ? (item.senderLabel ?? IVX_OWNER_AI_PROFILE.name) : (item.senderLabel ?? 'IVX Owner'),
      text: parsedReplyBody.body,
      replyTo: parsedReplyBody.replyTo,
      createdAt: item.createdAt,
      sendStatus: pendingState?.status === 'uploading' || pendingState?.status === 'uploaded' ? 'sending' : (pendingState?.status ?? 'sent'),
      optimistic: pendingState?.status === 'sending' || pendingState?.status === 'uploading' || pendingState?.status === 'uploaded',
      localOnly: Boolean(pendingState),
      readBy: ownMessage && !pendingState ? ['owner', 'assistant'] : undefined,
      fileUrl: item.attachmentUrl ?? undefined,
      fileName: item.attachmentName ?? undefined,
      fileMime: item.attachmentMime ?? undefined,
      fileSize: item.attachmentSize ?? undefined,
      fileType: item.attachmentKind === 'image'
        ? 'image'
        : item.attachmentKind === 'video'
          ? 'video'
          : item.attachmentKind === 'pdf'
            ? 'pdf'
            : item.attachmentUrl
              ? 'file'
              : undefined,
    } satisfies ChatMessage;

    return (
      <>
        {shouldShowDateSeparator ? <DateSeparator value={item.createdAt} /> : null}
        <View
          style={[
            styles.messageRow,
            ownMessage ? styles.messageRowOwn : styles.messageRowOther,
            highlightedMessageId === item.id ? styles.messageRowHighlighted : null,
          ]}
          testID={`ivx-owner-message-${item.id}`}
        >
          <MessageBubble
            message={chatMessage}
            isMine={ownMessage}
            searchQuery={messageSearchQuery}
            onRetry={handleRetryMessage}
            onDismiss={handleDismissFailedMessage}
            onTogglePin={handleTogglePinnedMessage}
            onReply={handleStartReplyToMessage}
            onOpenReplyContext={handleJumpToMessage}
            isPinned={pinnedMessageIdSet.has(item.id)}
          />
        </View>
      </>
    );
  }, [displayedMessages, executionStatusByMessageId, handleApproveAndRunFromCard, handleDismissFailedMessage, handleJumpToMessage, handleRetryMessage, handleStartReplyToMessage, handleTogglePinnedMessage, highlightedMessageId, messageSearchQuery, ownerId, pendingOwnerMessages, pinnedMessageIdSet]);

  useEffect(() => {
    const pendingMessageId = pendingJumpMessageIdRef.current;
    if (!pendingMessageId) {
      return;
    }

    const targetIndex = displayedMessages.findIndex((message) => message.id === pendingMessageId);
    if (targetIndex < 0) {
      return;
    }

    suppressAutoScrollUntilRef.current = Date.now() + 2200;
    flatListRef.current?.scrollToIndex({ index: targetIndex, animated: true, viewPosition: 0.35 });
    pendingJumpMessageIdRef.current = null;
    console.log('[IVXOwnerChatRoute] Completed pending reply context jump:', pendingMessageId, 'index:', targetIndex);
  }, [displayedMessages]);

  const refreshing = messagesQuery.isRefetching || conversationQuery.isRefetching;
  const isRecordingVoice = recorderState.isRecording;
  const isTranscribingVoice = transcribeVoiceMutation.isPending;
  const isBusy = sendMessageMutation.isPending || attachmentMutation.isPending || isPickingFile || isRecordingVoice || isTranscribingVoice;
  const isAuthBlocked = !ownerAIAuthReady;
  const sendingDisabled = (!composerHasText && draftAttachments.length === 0) || isBusy || isAuthBlocked;
  const isAIWorking = aiReplyPending || sendMessageMutation.isPending || attachmentMutation.isPending;
  // Auto-expire the inline Live Work task banner once the underlying work
  // actually finishes. Without this, an "Auditing & verifying" banner set on a
  // prior send stays "active" forever (it was only ever cleared by the explicit
  // Dismiss button) and could be carried into an unrelated new conversation
  // state. We only clear AFTER observing a working→idle transition, so the
  // banner can't be wiped before the work it represents has begun.
  const liveWorkTaskWasWorkingRef = useRef<boolean>(false);
  useEffect(() => {
    if (isAIWorking) {
      if (activeLiveWorkTask) {
        liveWorkTaskWasWorkingRef.current = true;
      }
      return;
    }
    if (liveWorkTaskWasWorkingRef.current && activeLiveWorkTask) {
      liveWorkTaskWasWorkingRef.current = false;
      const timeout = setTimeout(() => {
        setActiveLiveWorkTask(null);
      }, 3000);
      return () => clearTimeout(timeout);
    }
    return undefined;
  }, [activeLiveWorkTask, isAIWorking]);
  const aiExecutionStage = useMemo<AIExecutionStage>(() => {
    return resolveAIExecutionStage({
      attachmentPending: attachmentMutation.isPending,
      sendPending: sendMessageMutation.isPending,
      aiReplyPending,
      requestStage: runtimeDebugSnapshot.requestStage,
      source: runtimeDebugSnapshot.source,
      failureClass: runtimeDebugSnapshot.failureClass,
      hasVisibleResponseText: runtimeDebugSnapshot.hasVisibleResponseText,
    });
  }, [aiReplyPending, attachmentMutation.isPending, sendMessageMutation.isPending, runtimeDebugSnapshot.requestStage, runtimeDebugSnapshot.source, runtimeDebugSnapshot.failureClass, runtimeDebugSnapshot.hasVisibleResponseText]);
  const aiWorkingMessage = useMemo<string>(() => {
    return formatAIExecutionStage(aiExecutionStage);
  }, [aiExecutionStage]);
  const attachmentDisabled = attachmentMutation.isPending || isPickingFile || isRecordingVoice || isTranscribingVoice;
  // Chat loading placeholders removed: the composer always shows the same
  // prompt regardless of in-flight uploads/sends so the UI never feels stuck.
  const composerPlaceholder = 'Message IVX Owner AI';
  const activeFallbackForCurrentMessage = shouldShowFallbackUI({
    source: normalizeRuntimeSource(runtimeDebugSnapshot.source),
    requestStage: runtimeDebugSnapshot.requestStage,
    failureClass: runtimeDebugSnapshot.failureClass,
    isFallback: runtimeDebugSnapshot.source === 'provider_fallback',
    isStreaming: hasActiveStreamingState(runtimeDebugSnapshot),
    hasVisibleResponseText: runtimeDebugSnapshot.hasVisibleResponseText,
  });
  // Loading state is fully removed: the room renders immediately as 'ready',
  // backed by the durable local mirror + cached query placeholder data so the
  // thread never blanks while the network refetch lands.
  const primaryState = useMemo<'room_error' | 'ready'>(() => {
    if ((messagesQuery.error || conversationQuery.error) && allMessages.length === 0) {
      return 'room_error';
    }

    return 'ready';
  }, [allMessages.length, conversationQuery.error, messagesQuery.error]);
  const messageAudit = useMemo(() => {
    const ownerMessages = allMessages.filter((message) => isOwnMessage(message, ownerId)).length;
    const assistantMessages = allMessages.filter((message) => message.senderRole === 'assistant').length;

    return {
      ownerMessages,
      assistantMessages,
    };
  }, [allMessages, ownerId]);
  const lastSendAudit = useMemo<IVXOwnerSendAudit | null>(() => {
    return ivxChatService.getLastOwnerSendAudit();
  }, [allMessages.length, aiReplyPending, sendMessageMutation.isPending, attachmentMutation.isPending, isPickingFile]);
  const lastReceiveAudit = useMemo<IVXOwnerReceiveAudit | null>(() => {
    return ivxChatService.getLastOwnerReceiveAudit();
  }, [allMessages.length, realtimeEventsObserved, realtimeSubscriptionState]);
  const realtimeSubscriptionAudit = useMemo<IVXOwnerRealtimeSubscriptionAudit>(() => {
    return ivxChatService.getOwnerRealtimeSubscriptionAudit();
  }, [allMessages.length, realtimeEventsObserved, realtimeSubscriptionState]);
  const deliveryBranchStatus = useMemo<DeliveryBranchStatus>(() => {
    return getDeliveryBranchStatus(lastSendAudit);
  }, [lastSendAudit]);
  const receiveBranchStatus = useMemo<ReceiveBranchStatus>(() => {
    return getReceiveBranchStatus(lastReceiveAudit);
  }, [lastReceiveAudit]);
  const runtimeSnapshot = useMemo(() => {
    return buildIVXRoomRuntimeSnapshot({
      roomId: conversationQuery.data?.id ?? 'ivx-owner-room',
      roomStatus: ivxRoomStatus,
      roomProbeObservedAt: roomProbeAt,
      aiHealth: effectiveAiHealthDetail,
      aiProbeObservedAt: aiProbeMetadata.observedAt,
      aiSource: runtimeSignals.aiBackendSource ?? 'unknown',
      aiEndpoint: runtimeDebugSnapshot.endpoint ?? aiProbeMetadata.endpoint,
      deploymentMarker: runtimeDebugSnapshot.deploymentMarker ?? aiProbeMetadata.deploymentMarker,
      model: runtimeSignals.aiBackendSource === 'local_app_brain' ? 'ivx-local-app-brain' : runtimeSignals.aiBackendSource === 'remote_api' ? 'ivx-owner-remote' : 'unverified',
      messages: allMessages,
      messageSendPending: sendMessageMutation.isPending,
      aiReplyPending,
      attachmentPending: attachmentMutation.isPending || isPickingFile,
      lastSendAt,
      lastReplyAt,
      sendFailures: sendMessageMutation.isError ? 1 : 0,
      replyFailures,
      fallbackSuccessCount,
      realtimeEventsObserved,
      latencySamplesMs,
      realtimeSubscriptionState,
      deliveryProof: {
        sendBranch: deliveryBranchStatus.branch,
        sendTitle: deliveryBranchStatus.title,
        sendDetail: deliveryBranchStatus.detail,
        sendEvidence: deliveryBranchStatus.evidence,
        sendObservedAt: lastSendAudit?.observedAt ?? null,
        receiveBranch: receiveBranchStatus.branch,
        receiveTitle: receiveBranchStatus.title,
        receiveDetail: receiveBranchStatus.detail,
        receiveEvidence: receiveBranchStatus.evidence,
        receiveObservedAt: lastReceiveAudit?.observedAt ?? null,
      },
    });
  }, [
    effectiveAiHealthDetail,
    aiProbeMetadata.deploymentMarker,
    aiProbeMetadata.endpoint,
    aiProbeMetadata.observedAt,
    aiReplyPending,
    allMessages,
    attachmentMutation.isPending,
    conversationQuery.data?.id,
    deliveryBranchStatus.branch,
    deliveryBranchStatus.detail,
    deliveryBranchStatus.evidence,
    deliveryBranchStatus.title,
    isPickingFile,
    ivxRoomStatus,
    lastReceiveAudit?.observedAt,
    lastReplyAt,
    lastSendAt,
    lastSendAudit?.observedAt,
    latencySamplesMs,
    sendMessageMutation.isPending,
    realtimeEventsObserved,
    realtimeSubscriptionState,
    receiveBranchStatus.branch,
    receiveBranchStatus.detail,
    receiveBranchStatus.evidence,
    receiveBranchStatus.title,
    replyFailures,
    fallbackSuccessCount,
    roomProbeAt,
    runtimeDebugSnapshot.deploymentMarker,
    runtimeDebugSnapshot.endpoint,
    runtimeSignals.aiBackendSource,
    sendMessageMutation.isError,
  ]);
  const backendAuditSummary = useMemo<BackendAuditSummary>(() => {
    const configuredBaseUrl = ownerAIConfigAudit.configuredBaseUrl;
    const activeBaseUrl = ownerAIConfigAudit.activeBaseUrl;
    const configSource = ownerAIConfigAudit.configuredFrom ?? (ownerAIConfigAudit.fallbackUsed ? 'EXPO_PUBLIC_PROJECT_ID derived dev fallback' : 'unconfigured');
    const activeEndpoint = aiProbeMetadata.endpoint ?? ownerAIConfigAudit.activeEndpoint ?? 'unconfigured';
    const lastFailureReason = aiProbeMetadata.lastFailureReason?.toLowerCase() ?? '';

    let failureMode = ownerAIConfigAudit.configurationError ?? 'No backend probe failure captured yet.';
    let recommendedResolution = ownerAIConfigAudit.currentEnvironment === 'production'
      ? 'Set EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL to the intended public Owner AI base URL for production.'
      : 'Set EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL to pin development to a specific backend, or keep the project-scoped fallback derived from EXPO_PUBLIC_PROJECT_ID.';

    if (ownerAIConfigAudit.mismatchWarnings.length > 0) {
      failureMode = ownerAIConfigAudit.mismatchWarnings[0] ?? failureMode;
      recommendedResolution = 'Align the owner-room host, the app-wide API host, and the DNS audit target before debugging the upstream runtime further.';
    }

    if (!ownerAIRoutingBlocked && ownerAIConfigAudit.fallbackUsed) {
      failureMode = 'Development routing is using the project-scoped fallback derived from EXPO_PUBLIC_PROJECT_ID because no explicit owner AI base URL is configured.';
      recommendedResolution = 'This is allowed in development. Set EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL if you want dev to target a fixed backend instead of the EXPO_PUBLIC_PROJECT_ID fallback.';
    }

    if (lastFailureReason.includes('could not resolve host') || lastFailureReason.includes('failed to fetch') || lastFailureReason.includes('network request failed') || lastFailureReason.includes('load failed')) {
      failureMode = `The active endpoint was unreachable from the client runtime. Last failure: ${aiProbeMetadata.lastFailureReason ?? 'network resolution failure'}.`;
      recommendedResolution = activeBaseUrl
        ? `Verify DNS and public reachability for ${activeBaseUrl}. If this backend is private or internal-only, point this build to the correct public Owner AI base URL via EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL.`
        : recommendedResolution;
    }

    if (ownerAIConfigAudit.currentEnvironment === 'production' && !ownerAIRoutingBlocked && lastFailureReason) {
      recommendedResolution = `${recommendedResolution} Production does not silently downgrade Owner AI routing to a dev host or provider-backed health state when the configured remote endpoint fails.`;
    }

    if (ownerAIRoutingBlocked && ownerAIConfigAudit.currentEnvironment === 'production') {
      recommendedResolution = ownerAIConfigAudit.pointsToDevHost
        ? 'Replace the development-like Owner AI host with the intended production public URL in EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL.'
        : 'Provide EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL in production. No implicit fallback to EXPO_PUBLIC_IVX_API_BASE_URL or project-scoped dev hosts is allowed.';
    }

    return {
      currentEnvironment: ownerAIConfigAudit.currentEnvironment,
      routingPolicy: ownerAIConfigAudit.routingPolicy,
      auditState: ownerAIRoutingBlocked
        ? 'guard_blocked'
        : ownerAIConfigAudit.mismatchWarnings.length > 0
          ? 'split_host_path'
          : effectiveAiHealthDetail === 'active'
            ? 'live'
            : effectiveAiHealthDetail === 'degraded'
              ? 'degraded'
              : 'probing_or_unverified',
      configSource,
      explicitProductionPin: ownerAIConfigAudit.explicitProductionPinApplied
        ? `yes — ${ownerAIConfigAudit.configuredBaseUrl ?? ownerAIConfigAudit.canonicalBaseUrl}`
        : 'no',
      configuredOwnerAIBaseUrl: configuredBaseUrl ?? 'unconfigured',
      activeBaseUrl: activeBaseUrl ?? 'blocked',
      activeHost: ownerAIConfigAudit.activeHost ?? 'unconfigured',
      activeEndpoint,
      directApiBaseUrl: ownerAIConfigAudit.directApiBaseUrl ?? 'unconfigured',
      directApiHost: ownerAIConfigAudit.directApiHost ?? 'unconfigured',
      ownerAiHealthUrl: ownerAIConfigAudit.healthCheckUrl ?? 'unconfigured',
      ownerRoute53AuditUrl: ownerAIConfigAudit.route53AuditUrl ?? 'unconfigured',
      ownerRoute53UpsertUrl: ownerAIConfigAudit.route53UpsertUrl ?? 'unconfigured',
      appApiHealthUrl: ownerAIConfigAudit.appApiHealthCheckUrl ?? 'unconfigured',
      appApiRoute53AuditUrl: ownerAIConfigAudit.appApiRoute53AuditUrl ?? 'unconfigured',
      devFallbackBaseUrl: ownerAIConfigAudit.devFallbackBaseUrl ?? 'unconfigured',
      activeFallbackBaseUrl: ownerAIConfigAudit.fallbackUsed ? (ownerAIConfigAudit.activeBaseUrl ?? 'unconfigured') : 'not-active',
      selectionReason: ownerAIConfigAudit.selectionReason,
      fallbackUsed: ownerAIConfigAudit.fallbackUsed ? `yes — ${ownerAIConfigAudit.fallbackReason ?? 'development fallback applied'}` : 'no',
      whyFallbackSelected: ownerAIConfigAudit.fallbackReason ?? (ownerAIConfigAudit.fallbackUsed ? ownerAIConfigAudit.selectionReason : 'Fallback not selected.'),
      wasFallbackUsed: ownerAIConfigAudit.fallbackUsed ? 'yes' : 'no',
      productionGuard: ownerAIRoutingBlocked
        ? `blocked — ${ownerAIConfigAudit.configurationError ?? 'Owner AI routing guard rejected this configuration.'}`
        : ownerAIConfigAudit.currentEnvironment === 'production'
          ? 'pass — production routing is explicitly set by EXPO_PUBLIC_IVX_OWNER_AI_BASE_URL'
          : 'pass — development routing policy allows explicit or project-scoped fallback',
      productionGuardBlocked: ownerAIRoutingBlocked,
      failureMode,
      recommendedResolution,
      gracefulDegradationNote: ownerAIRoutingBlocked
        ? 'The room stays mounted, message sending still works, and AI health is forced inactive so production cannot appear healthy while misrouted.'
        : ownerAIConfigAudit.currentEnvironment === 'production'
          ? 'When the configured production backend is unreachable, the UI remains interactive, the thread stays mounted, a safe audit fallback message is persisted in-chat, and health stays inactive instead of silently switching to a development-style runtime fallback.'
          : 'When the owner AI backend is unreachable, the UI remains interactive, the thread stays mounted, and a safe audit fallback response can keep development moving while routing is audited.',
      workflowTrace: ownerAIConfigAudit.workflowTrace,
      mismatchWarnings: ownerAIConfigAudit.mismatchWarnings,
    };
  }, [aiProbeMetadata.endpoint, aiProbeMetadata.lastFailureReason, effectiveAiHealthDetail, ownerAIConfigAudit, ownerAIRoutingBlocked]);

  const auditReport = useMemo(() => {
    return buildIVXChatAuditReport({
      openAccessEnabled: isOpenAccessBuild,
      ownerAuthenticated: !!user || !!userId,
      conversationReady: !!conversationQuery.data?.id && !conversationQuery.error,
      messageListReady: !messagesQuery.error,
      roomStatus: ivxRoomStatus,
      runtimeSnapshot,
      aiIndicatorState: resolution.aiIndicator.state,
      aiIndicatorLabel: resolution.aiIndicator.label,
      aiIndicatorDetail: resolution.aiIndicator.detail,
      ownerAIConfigAudit,
      activeEndpoint: backendAuditSummary.activeEndpoint,
      lastFailureReason: aiProbeMetadata.lastFailureReason,
      sendFailures: sendMessageMutation.isError ? 1 : 0,
      replyFailures,
      fallbackSuccessCount,
      realtimeEventsObserved,
      realtimeSubscriptionState,
      messageCount: allMessages.length,
      assistantMessageCount: messageAudit.assistantMessages,
    });
  }, [
    aiProbeMetadata.lastFailureReason,
    allMessages.length,
    backendAuditSummary.activeEndpoint,
    conversationQuery.data?.id,
    conversationQuery.error,
    isOpenAccessBuild,
    ivxRoomStatus,
    messageAudit.assistantMessages,
    messagesQuery.error,
    ownerAIConfigAudit,
    realtimeEventsObserved,
    realtimeSubscriptionState,
    replyFailures,
    fallbackSuccessCount,
    resolution.aiIndicator.detail,
    resolution.aiIndicator.label,
    resolution.aiIndicator.state,
    runtimeSnapshot,
    sendMessageMutation.isError,
    user,
    userId,
  ]);
  const topStatusNote = useMemo(() => {
    // Per-message error UI and the chat send queue technical errors now
    // surface failures contextually. The stale top banner sourced from
    // runtimeDebugSnapshot could persist after a successful send and
    // mislead the owner, so it is intentionally suppressed.
    return null;
  }, []);
  const ownerAIProofStatus = useMemo<OwnerAIProofStatus>(() => {
    if (localFirstChatMode) {
      return {
        id: 'local_app_brain_ready',
        tone: 'pass',
        title: 'local IVX brain ready',
        detail: 'The IVX chat room is running from the app first. Normal messages, assistant replies, attachments, and reloads stay available on this device.',
        evidence: 'local_device_only · local_app_brain · optional_backend_later',
        testID: 'ivx-owner-proof-local-app-brain-ready',
      };
    }

    if (devTestMode.testModeActive) {
      return {
        id: 'remote_api_verified',
        tone: 'pass',
        title: 'owner test mode active',
        detail: 'Verified owner session is active. Owner actions can use the live response path.',
        evidence: 'owner_room_authenticated · backend_admin_verified · full_backend_execution',
        testID: 'ivx-owner-proof-test-mode-active',
      };
    }

    const normalizedRuntimeState = {
      source: normalizeRuntimeSource(runtimeDebugSnapshot.source),
      requestStage: runtimeDebugSnapshot.requestStage,
      failureClass: runtimeDebugSnapshot.failureClass,
      isFallback: runtimeDebugSnapshot.source === 'provider_fallback',
      isStreaming: hasActiveStreamingState(runtimeDebugSnapshot),
      hasVisibleResponseText: runtimeDebugSnapshot.hasVisibleResponseText,
    };
    const requestIsPending = isPendingRequestState(normalizedRuntimeState);
    const activeFallback = shouldShowFallbackUI(normalizedRuntimeState);
    const missingOwnerAuth = !ownerRoomAuthenticated;
    const remoteApiVerified = runtimeSnapshot.provider.source === 'remote_api'
      && auditReport.remoteReplyVerified
      && safeTrim(runtimeSnapshot.provider.endpoint).length;

    if (remoteApiVerified) {
      return {
        id: 'remote_api_verified',
        tone: 'pass',
        title: 'remote_api verified',
        detail: 'The deployed IVX endpoint answered the room probe and remote reply proof is verified in this runtime snapshot.',
        evidence: `${runtimeSnapshot.provider.endpoint ?? backendAuditSummary.activeEndpoint} · deployment ${runtimeSnapshot.provider.deploymentMarker ?? 'missing'} · source ${runtimeSnapshot.provider.source}`,
        testID: 'ivx-owner-proof-remote-api-verified',
      };
    }

    if (missingOwnerAuth) {
      return {
        id: 'blocked_by_auth',
        tone: 'blocked',
        title: 'blocked by auth',
        detail: 'Remote admin proof is blocked because owner-room trust is not established in this runtime yet. Normal owner chat should only require room trust, not repeated backend re-verification.',
        evidence: `${backendAuditSummary.currentEnvironment} runtime · source ${runtimeSnapshot.provider.source} · endpoint ${runtimeSnapshot.provider.endpoint ?? backendAuditSummary.activeEndpoint}`,
        testID: 'ivx-owner-proof-blocked-by-auth',
      };
    }

    if (activeFallback && !requestIsPending) {
      const fallbackHasVisibleReply = normalizedRuntimeState.hasVisibleResponseText === true;
      return {
        id: 'dev_fallback',
        tone: fallbackHasVisibleReply ? 'pass' : 'pending',
        title: fallbackHasVisibleReply ? 'assistant ready' : 'assistant path pending',
        detail: fallbackHasVisibleReply
          ? 'Reply delivered cleanly.'
          : 'Normal conversation stays available while the reply path recovers.',
        evidence: runtimeSnapshot.provider.endpoint ?? backendAuditSummary.activeEndpoint,
        testID: fallbackHasVisibleReply ? 'ivx-owner-proof-assistant-ready' : 'ivx-owner-proof-assistant-pending',
      };
    }

    return {
      id: 'remote_api_unverified',
      tone: 'pending',
      title: 'remote_api pending proof',
      detail: 'Remote routing is configured, but a fresh verified remote reply proof has not landed yet in this room snapshot.',
      evidence: `${runtimeSnapshot.provider.endpoint ?? backendAuditSummary.activeEndpoint} · runtime ${runtimeSnapshot.runtimeStatus} · stream ${runtimeSnapshot.streamStatus}`,
      testID: 'ivx-owner-proof-remote-api-pending',
    };
  }, [auditReport.remoteReplyVerified, backendAuditSummary.activeEndpoint, backendAuditSummary.activeFallbackBaseUrl, backendAuditSummary.currentEnvironment, backendAuditSummary.fallbackUsed, devTestMode.testModeActive, localFirstChatMode, ownerRoomAuthenticated, runtimeDebugSnapshot, runtimeSnapshot.provider.deploymentMarker, runtimeSnapshot.provider.endpoint, runtimeSnapshot.provider.source, runtimeSnapshot.runtimeStatus, runtimeSnapshot.streamStatus]);
  const qaChecklist = useMemo<QAProofItem[]>(() => {
    const canUseComposer = primaryState === 'ready';
    const hasRoom = !!conversationQuery.data?.id && !conversationQuery.error;
    const sendReady = canUseComposer && !isBusy;
    const assistantReady = resolution.aiIndicator.state === 'available' || resolution.aiIndicator.state === 'degraded' || isOpenAccessBuild;
    const transcriptHealthy = runtimeSnapshot.transcriptIntegrity === 'verified';

    return [
      {
        id: 'dev-unblock',
        label: 'Room access',
        passed: ownerRoomAuthenticated,
        detail: ownerRoomAuthenticated
          ? `Room trust active as ${isOpenAccessBuild ? 'open_access_dev_bypass' : 'owner_room_authenticated'}.`
          : 'Owner room trust is not established yet.',
      },
      {
        id: 'room-bootstrap',
        label: 'Room bootstrap',
        passed: hasRoom,
        detail: hasRoom
          ? `Room ready: ${conversationQuery.data?.title ?? IVX_OWNER_AI_PROFILE.sharedRoom.title}.`
          : conversationQuery.error?.message ?? 'Owner room is still bootstrapping.',
      },
      {
        id: 'thread-load',
        label: 'Thread load',
        passed: !messagesQuery.error,
        detail: messagesQuery.error
          ? messagesQuery.error.message
          : allMessages.length > 0
            ? `${allMessages.length} message(s) loaded in the thread.`
            : 'Thread is open and ready for the first message.',
      },
      {
        id: 'composer-dock',
        label: 'Composer dock',
        passed: canUseComposer,
        detail: canUseComposer
          ? 'Input and send controls stay docked above the bottom inset.'
          : 'Composer is intentionally hidden while the room is recovering.',
      },
      {
        id: 'send-path',
        label: 'Send path',
        passed: sendReady,
        detail: sendReady
          ? sendingDisabled
            ? 'Send button is visible. Enter text to enable sending.'
            : 'Send button is visible and ready to deliver the next message.'
          : 'Send path is temporarily busy with an active send or upload.',
      },
      {
        id: 'assistant-path',
        label: 'Assistant path',
        passed: assistantReady,
        detail: ownerAIRoutingBlocked
          ? `Blocked by routing guard. ${ownerAIConfigAudit.configurationError ?? 'Owner AI production configuration is invalid.'}`
          : `${resolution.aiIndicator.label}. ${resolution.aiIndicator.detail} Source: ${runtimeSnapshot.provider.source}. Endpoint: ${backendAuditSummary.activeEndpoint}.`,
      },
      {
        id: 'provider-proof-mode',
        label: 'Provider proof mode',
        passed: ownerAIProofStatus.id === 'remote_api_verified',
        detail: `${ownerAIProofStatus.title}. ${ownerAIProofStatus.detail} Evidence: ${ownerAIProofStatus.evidence}.`,
      },
      {
        id: 'transcript-proof',
        label: 'Transcript proof',
        passed: transcriptHealthy,
        detail: runtimeSnapshot.duplicateWriteDetected
          ? 'Duplicate transcript write risk detected in the loaded thread.'
          : messageAudit.assistantMessages > 0
            ? `${messageAudit.ownerMessages} owner message(s) and ${messageAudit.assistantMessages} assistant reply/replies detected with ordered transcript audit.`
            : messageAudit.ownerMessages > 0
              ? `${messageAudit.ownerMessages} owner message(s) detected. Awaiting an assistant reply proof in this loaded thread.`
              : 'No persisted proof messages yet in this session.',
      },
    ];
  }, [
    allMessages.length,
    conversationQuery.data?.id,
    conversationQuery.data?.title,
    conversationQuery.error,
    backendAuditSummary.activeEndpoint,
    isBusy,
    isOpenAccessBuild,
    ownerAIConfigAudit.configurationError,
    ownerAIRoutingBlocked,
    messageAudit.assistantMessages,
    messageAudit.ownerMessages,
    messagesQuery.error,
    ownerAIProofStatus.detail,
    ownerAIProofStatus.evidence,
    ownerAIProofStatus.id,
    ownerAIProofStatus.title,
    ownerRoomAuthenticated,
    primaryState,
    resolution.aiIndicator.detail,
    resolution.aiIndicator.label,
    resolution.aiIndicator.state,
    runtimeSnapshot.duplicateWriteDetected,
    runtimeSnapshot.provider.source,
    runtimeSnapshot.transcriptIntegrity,
    sendingDisabled,
  ]);
  const qaOverallPassed = useMemo(() => qaChecklist.every((item) => item.passed), [qaChecklist]);
  const functionalityProofList = useMemo<IVXFunctionalityProofItem[]>(() => {
    return buildIVXFunctionalityProofList(auditReport, runtimeSnapshot);
  }, [auditReport, runtimeSnapshot]);
  const functionalityProofCounts = useMemo(() => {
    return functionalityProofList.reduce(
      (counts, item) => {
        if (item.status === 'live') {
          counts.live += 1;
        } else if (item.status === 'pass') {
          counts.pass += 1;
        } else {
          counts.fail += 1;
        }
        return counts;
      },
      { live: 0, pass: 0, fail: 0 },
    );
  }, [functionalityProofList]);
  useEffect(() => {
    auditReportRef.current = auditReport;
  }, [auditReport]);
  const ownerGraphNodes = useMemo<CTSystemNode[]>(() => {
    if (!nerveSnapshot) {
      return [];
    }

    const allowedNodeIds = new Set<string>([
      'module:chat',
      'module:ai_ops',
      'module:realtime_sync',
      'service:chat_transport',
      'service:ai_runtime',
      'service:shared_room',
      'service:inbox_sync',
      'service:realtime',
    ]);

    return nerveSnapshot.systemNodes
      .filter((node) => allowedNodeIds.has(node.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 6);
  }, [nerveSnapshot]);
  const ownerGraphProofs = useMemo<CTEvidenceRecord[]>(() => {
    if (!nerveSnapshot) {
      return [];
    }

    return nerveSnapshot.evidence
      .filter((proof) => proof.subjectId.includes('chat') || proof.subjectId.includes('ai_') || proof.subjectId.includes('shared_room') || proof.subjectId.includes('realtime') || proof.subjectId.includes('inbox_sync'))
      .sort((a, b) => new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())
      .slice(0, 3);
  }, [nerveSnapshot]);
  const ownerGraphRisks = useMemo<CTRiskAssessment[]>(() => {
    if (!nerveSnapshot) {
      return [];
    }

    return nerveSnapshot.riskAssessments
      .filter((risk) => risk.subjectId.includes('chat') || risk.subjectId.includes('ai_ops') || risk.subjectId.includes('realtime_sync'))
      .sort((a, b) => b.currentRiskScore - a.currentRiskScore)
      .slice(0, 3);
  }, [nerveSnapshot]);
  const ownerActionFeed = useMemo<CTOperatorActionRun[]>(() => {
    if (!nerveSnapshot) {
      return [];
    }

    return nerveSnapshot.actionRuns
      .filter((action) => action.targetId.includes('chat') || action.targetId.includes('ai_ops') || action.targetId.includes('realtime_sync'))
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
      .slice(0, 2);
  }, [nerveSnapshot]);
  const roomControlMutation = useMutation<{ success: boolean; message: string }, Error, 'rerun_health_probe' | 'transition_stuck_sends'>({
    mutationFn: async (action) => {
      console.log('[IVXOwnerChatRoute] Executing room control action:', action);
      return executeOperatorAction(action, 'chat');
    },
    onSuccess: async (result, action) => {
      invalidateIVXRoomProbeCache();
      await queryClient.invalidateQueries({ queryKey: IVX_ROOM_STATUS_QUERY_KEY });
      setAiHealthDetail('inactive');
      const affectedDependencies = ownerGraphNodes.slice(0, 3).map((node) => node.name).join(' → ') || 'chat transport';
      const linkedProofs = ownerGraphProofs.slice(0, 2).map((proof) => proof.claim).join(' | ') || 'No fresh linked proofs yet';
      await persistSupportMessage([
        `Result: ${result.success ? 'success' : 'failed'}`,
        `Explanation: ${result.message}`,
        `Evidence: ${linkedProofs}`,
        `Dependencies: ${affectedDependencies}`,
        `Action: ${getActionLabel(action)}`,
        `Rollback: ${action === 'transition_stuck_sends' ? 'available' : 'not required'}`,
      ].join('\n'), 'system');
    },
    onError: async (error, action) => {
      await persistSupportMessage([
        'Result: failed',
        `Explanation: ${error.message}`,
        `Evidence: ${ownerGraphProofs.slice(0, 1).map((proof) => proof.claim).join(' | ') || 'No fresh linked proofs yet'}`,
        `Dependencies: ${ownerGraphNodes.slice(0, 3).map((node) => node.name).join(' → ') || 'chat transport'}`,
        `Action: ${getActionLabel(action)}`,
        'Rollback: not executed',
      ].join('\n'), 'system');
    },
  });
  useEffect(() => {
    roomRuntimeRef.current = runtimeSnapshot;
  }, [runtimeSnapshot]);

  const proofBadgeTone = useMemo<'pass' | 'warn' | 'blocked' | 'pending'>(() => {
    if (runtimeSnapshot.runtimeStatus === 'live') return 'pass';
    if (runtimeSnapshot.runtimeStatus === 'blocked') return 'blocked';
    if (runtimeSnapshot.runtimeStatus === 'probing') return 'pending';
    return 'warn';
  }, [runtimeSnapshot.runtimeStatus]);
  const proofBadgeLabel = useMemo<string>(() => {
    if (runtimeSnapshot.runtimeStatus === 'live') return 'Live';
    if (runtimeSnapshot.runtimeStatus === 'blocked') return 'Blocked';
    if (runtimeSnapshot.runtimeStatus === 'probing') return 'Probing';
    return activeFallbackForCurrentMessage ? 'Recovering' : 'Review';
  }, [activeFallbackForCurrentMessage, runtimeSnapshot.runtimeStatus]);
  const proofRows = useMemo<IVXProofRecord[]>(() => runtimeSnapshot.proofs, [runtimeSnapshot.proofs]);
  const liveChatMetric = useMemo(() => {
    return liveSnapshot.moduleMetrics.find((metric) => metric.moduleId === 'chat') ?? null;
  }, [liveSnapshot.moduleMetrics]);
  const liveTopSource = useMemo(() => {
    return liveSnapshot.sourceMetrics[0] ?? null;
  }, [liveSnapshot.sourceMetrics]);
  const qaScopeNote = useMemo(() => {
    if (isOpenAccessBuild) {
      return 'Shared room/composer fixes are in shared code. Direct room-open bypass remains dev-only.';
    }

    return 'This route is running the shared room/composer fixes in the standard owner flow.';
  }, [isOpenAccessBuild]);
  const handleRoomControlActionPress = useCallback((action: 'rerun_health_probe' | 'transition_stuck_sends') => {
    if (devTestMode.testModeActive) {
      roomControlMutation.mutate(action);
      return;
    }

    const actionLabel = getActionLabel(action);

    if (fallbackChatOnlyActive || !backendAdminVerified) {
      void persistSupportMessage(buildFallbackChatOnlyExecutionMessage({
        normalizedText: `/${action === 'rerun_health_probe' ? 'heal rerun-proof' : 'heal clear-stuck'}`,
        requestClass: 'admin_execution',
      }), 'system');
      return;
    }

    Alert.alert(
      'Confirm owner action',
      `Continue with ${actionLabel}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Continue',
          onPress: () => {
            roomControlMutation.mutate(action);
          },
        },
      ],
    );
  }, [backendAdminVerified, devTestMode.testModeActive, fallbackChatOnlyActive, persistSupportMessage, roomControlMutation]);
  const androidKeyboardActive = Platform.OS === 'android' && keyboardInset > 0;
  const androidRootResizedByKeyboard = useMemo<boolean>(() => {
    if (!androidKeyboardActive || rootLayoutHeight <= 0 || lastNonKeyboardRootHeightRef.current <= 0) {
      return false;
    }
    const heightShrink = lastNonKeyboardRootHeightRef.current - rootLayoutHeight;
    return heightShrink >= Math.max(80, keyboardInset * 0.35);
  }, [androidKeyboardActive, keyboardInset, rootLayoutHeight]);
  const manualKeyboardLift = useMemo<number>(() => {
    if (!androidKeyboardActive || androidRootResizedByKeyboard) {
      return 0;
    }
    return Math.min(Math.max(keyboardInset - insets.bottom + 10, 180), 360);
  }, [androidKeyboardActive, androidRootResizedByKeyboard, insets.bottom, keyboardInset]);
  const composerDockInset = useMemo(() => {
    if (Platform.OS === 'android') {
      return Math.max(insets.bottom, 16) + 8;
    }
    return Math.max(insets.bottom, 8) + 8;
  }, [insets.bottom]);
  const isKeyboardOpen = keyboardInset > 0;
  const effectiveComposerBottom = useMemo(() => {
    if (Platform.OS === 'android') {
      if (isKeyboardOpen) {
        return Math.max(insets.bottom, 12);
      }
      return composerDockInset;
    }

    if (isKeyboardOpen) {
      return 4;
    }

    return composerDockInset;
  }, [composerDockInset, insets.bottom, isKeyboardOpen]);
  const listContentContainerStyle = useMemo(() => {
    const bottomPadding = Math.max(composerHeight + effectiveComposerBottom + manualKeyboardLift + 96, insets.bottom + 120);
    return displayedMessages.length === 0
      ? [styles.emptyListContent, { paddingBottom: bottomPadding }]
      : [styles.listContent, { paddingTop: 8, paddingBottom: bottomPadding }];
  }, [displayedMessages.length, composerHeight, effectiveComposerBottom, insets.bottom, manualKeyboardLift]);
  const developerToolsScrollPadding = useMemo<number>(() => {
    return Math.max(composerHeight + effectiveComposerBottom + manualKeyboardLift + 48, insets.bottom + 120);
  }, [composerHeight, effectiveComposerBottom, insets.bottom, manualKeyboardLift]);
  const keyboardAvoidingBehavior = Platform.select<'height' | 'padding' | undefined>({
    ios: 'padding',
    android: 'height',
    default: undefined,
  });
  const { keyboardHeight: webKeyboardHeight } = useWebKeyboard();
  const keyboardVerticalOffset = useMemo<number>(() => {
    if (Platform.OS !== 'ios') {
      return 0;
    }

    return Math.max(insets.top + 56, 88);
  }, [insets.top]);
  const handleRootLayout = useCallback((event: LayoutChangeEvent) => {
    const nextHeight = event.nativeEvent.layout.height;
    if (nextHeight <= 0) {
      return;
    }
    setRootLayoutHeight((current) => (Math.abs(current - nextHeight) > 1 ? nextHeight : current));
    if (Platform.OS !== 'android' || keyboardInset <= 0) {
      lastNonKeyboardRootHeightRef.current = nextHeight;
    }
  }, [keyboardInset]);
  const renderPinnedMessagePreview = useCallback((message: IVXMessage) => {
    const parsedPinnedBody = parseReplyBody(message.body);
    const previewText = safeTrim(parsedPinnedBody.body) || safeTrim(message.attachmentName) || 'Attachment';
    const senderLabel = message.senderRole === 'assistant' ? (message.senderLabel ?? IVX_OWNER_AI_PROFILE.name) : (message.senderLabel ?? 'IVX Owner');
    return (
      <View key={message.id} style={styles.pinnedMessageCard} testID={`ivx-owner-pinned-message-${message.id}`}>
        <View style={styles.pinnedMessageTextStack}>
          <Text style={styles.pinnedMessageSender} numberOfLines={1}>{senderLabel}</Text>
          <Text style={styles.pinnedMessageText} numberOfLines={2}>{previewText}</Text>
          {message.attachmentUrl ? <Text style={styles.pinnedMessageMeta} numberOfLines={1}>{`${message.attachmentName ?? 'Attachment'} · ${message.attachmentMime ?? message.attachmentKind}`}</Text> : null}
        </View>
        <Pressable
          style={({ pressed }) => [styles.pinnedUnpinButton, pressed ? { opacity: 0.72 } : null]}
          onPress={() => handleTogglePinnedMessage({ id: message.id } as ChatMessage)}
          accessibilityRole="button"
          accessibilityLabel="Unpin message"
          testID={`ivx-owner-pinned-unpin-${message.id}`}
        >
          <X size={13} color="#F6C85F" />
          <Text style={styles.pinnedUnpinText}>Unpin</Text>
        </Pressable>
      </View>
    );
  }, [handleTogglePinnedMessage]);

  const pinnedMessagesSection = useMemo(() => {
    if (pinnedMessages.length === 0) {
      return null;
    }

    return (
      <View style={styles.pinnedSection} testID="ivx-owner-pinned-section">
        <View style={styles.pinnedSectionHeader}>
          <Pin size={14} color="#F6C85F" />
          <Text style={styles.pinnedSectionTitle}>Pinned messages</Text>
          <Text style={styles.pinnedSectionCount}>{pinnedMessages.length}</Text>
        </View>
        <View style={styles.pinnedMessageList}>
          {pinnedMessages.map(renderPinnedMessagePreview)}
        </View>
      </View>
    );
  }, [pinnedMessages, renderPinnedMessagePreview]);

  const listFooter = useMemo(() => <View style={styles.listFooterSpacer} />, []);
  const androidTopSpacerHeight = Platform.OS === 'android' ? Math.max(insets.top + 2, 24) : Math.max(insets.top, 0);
  const runtimeProofHeadline = useMemo(() => getRuntimeProofHeadline(runtimeDebugSnapshot), [runtimeDebugSnapshot]);
  // Owner-only live debug proof. Every value here is read live from the running
  // client so the owner can confirm — on the device — which bundle/backend is
  // active and that messages are actually saved and restored.
  const ownerLiveDebug = useMemo(() => {
    const wd = ivxAIWatchdog.getSnapshot();
    const lastFinal = wd.finalized.length > 0 ? wd.finalized[wd.finalized.length - 1] : null;
    const watchdogStatus = wd.active.length > 0
      ? `running (${wd.active.length} active trace${wd.active.length === 1 ? '' : 's'})`
      : lastFinal
        ? `${lastFinal.finalStatus ?? 'idle'} · ${wd.finalized.length} trace${wd.finalized.length === 1 ? '' : 's'}`
        : 'clean (no traces yet)';
    const parserResult = runtimeDebugSnapshot.failureClass === 'response_invalid'
      ? 'parse_failed (response_invalid)'
      : runtimeDebugSnapshot.hasVisibleResponseText
        ? 'clean (response parsed)'
        : 'idle (no response yet)';
    const storageSource = localFirstChatMode
      ? 'AsyncStorage (local-first mirror)'
      : isOpenAccessBuild
        ? 'local fallback (open-access build)'
        : 'Supabase (durable)';
    const lastAIStatus = `${runtimeDebugSnapshot.requestStage} · ${runtimeDebugSnapshot.failureClass} · src=${normalizeRuntimeSource(runtimeDebugSnapshot.source)}`;
    return {
      frontendBuild: IVX_FRONTEND_BUILD_STAMP,
      backendCommit: runtimeDebugSnapshot.deploymentMarker ?? aiProbeMetadata.deploymentMarker ?? 'pending',
      backendEndpoint: runtimeDebugSnapshot.endpoint ?? backendAuditSummary.activeEndpoint,
      conversationId: conversationQuery.data?.id ?? 'pending',
      loadedMessageCount: `${messages.length} saved · ${allMessages.length} rendered`,
      lastSavedMessageId: lastSendAudit?.messageId ?? 'pending',
      lastAIStatus,
      parserResult,
      storageSource,
      watchdogStatus,
    };
  }, [aiProbeMetadata.deploymentMarker, allMessages.length, backendAuditSummary.activeEndpoint, conversationQuery.data?.id, isOpenAccessBuild, localFirstChatMode, lastSendAudit?.messageId, messages.length, runtimeDebugSnapshot]);
  const runtimeStatusCopy = useMemo(() => getRuntimeStatusCopy({
    source: normalizeRuntimeSource(runtimeDebugSnapshot.source),
    requestStage: runtimeDebugSnapshot.requestStage,
    failureClass: runtimeDebugSnapshot.failureClass,
    isFallback: runtimeDebugSnapshot.source === 'provider_fallback',
    isStreaming: hasActiveStreamingState(runtimeDebugSnapshot),
    hasVisibleResponseText: runtimeDebugSnapshot.hasVisibleResponseText,
  }), [runtimeDebugSnapshot]);
  const runtimeProofPrimaryRows = useMemo<Array<{ label: string; value: string }>>(() => {
    return [
      { label: 'Request stage', value: runtimeDebugSnapshot.requestStage },
      { label: 'Failure class', value: runtimeDebugSnapshot.failureClass },
      { label: 'HTTP status', value: runtimeDebugSnapshot.httpStatus },
      { label: 'Base URL', value: backendAuditSummary.activeBaseUrl },
      { label: 'Endpoint', value: runtimeDebugSnapshot.endpoint ?? backendAuditSummary.activeEndpoint },
      { label: 'Request ID', value: runtimeDebugSnapshot.requestId ?? 'pending' },
      { label: 'Reliability attempts', value: lastReliabilityTrace ? `${lastReliabilityTrace.attempts.length} · ${lastReliabilityTrace.finalOutcome} · ${lastReliabilityTrace.totalElapsedMs}ms` : 'pending' },
      { label: 'Response preview', value: runtimeDebugSnapshot.responsePreview },
    ];
  }, [backendAuditSummary.activeBaseUrl, backendAuditSummary.activeEndpoint, lastReliabilityTrace, runtimeDebugSnapshot]);
  const developerToolsAllowed = useMemo<boolean>(() => {
    return ownerRoomAuthenticated;
  }, [ownerRoomAuthenticated]);
  const developerStatusRows = useMemo<Array<{ id: string; label: string; value: string; tone: 'pass' | 'warn' | 'error' | 'pending' }>>(() => {
    const supabasePending = conversationQuery.isLoading || messagesQuery.isLoading || roomStatusQuery.isLoading;
    const supabaseReady = !conversationQuery.error && !messagesQuery.error && !roomStatusQuery.error;
    const roomReady = !!conversationQuery.data?.id && !!ivxRoomStatus && !roomStatusQuery.isLoading;
    const activeSource = getActiveRuntimeSource({
      source: normalizeRuntimeSource(runtimeDebugSnapshot.source),
      requestStage: runtimeDebugSnapshot.requestStage,
      failureClass: runtimeDebugSnapshot.failureClass,
      isFallback: runtimeDebugSnapshot.source === 'provider_fallback',
      isStreaming: hasActiveStreamingState(runtimeDebugSnapshot),
      hasVisibleResponseText: runtimeDebugSnapshot.hasVisibleResponseText,
    });
    const proxyConnected = aiProxyStatus.status === 'connected';
    const aiReady = activeSource === 'remote_api' || activeSource === 'local_app_brain' || effectiveAiHealthDetail === 'active' || proxyConnected;
    const aiStatusValue = aiReady
      ? activeSource === 'remote_api'
        ? 'remote connected'
        : activeSource === 'local_app_brain'
          ? 'local brain ready'
          : proxyConnected
            ? `proxy connected · ${aiProxyStatus.model ?? 'model ready'}`
            : 'ready'
      : aiProxyStatus.status === 'checking'
        ? 'checking proxy'
        : aiProxyStatus.error
          ? 'proxy needs attention'
          : 'checking';

    return [
      { id: 'supabase', label: 'Supabase', value: supabaseReady ? 'connected' : supabasePending ? 'checking' : 'needs attention', tone: supabaseReady ? 'pass' : supabasePending ? 'pending' : 'error' },
      { id: 'room', label: 'Room', value: roomReady ? `${ivxRoomStatus.storageMode} · ${ivxRoomStatus.deliveryMethod}` : roomStatusQuery.error ? 'probe failed' : 'opening', tone: roomReady ? 'pass' : roomStatusQuery.error ? 'error' : 'pending' },
      { id: 'ai', label: 'AI', value: aiStatusValue, tone: aiReady ? 'pass' : aiReplyPending || aiProxyStatus.status === 'checking' ? 'pending' : 'warn' },
      { id: 'audit', label: 'Audit', value: 'local + audit_events mirror', tone: 'pass' },
      { id: 'files', label: 'Files', value: fileUploadActive ? 'upload + analysis active' : 'upload path ready', tone: fileUploadActive ? 'pass' : 'warn' },
      { id: 'voice', label: 'Voice', value: isRecordingVoice ? 'recording' : isTranscribingVoice ? 'transcribing' : 'transcription ready', tone: isRecordingVoice || isTranscribingVoice ? 'pending' : 'pass' },
      { id: 'templates', label: 'Templates', value: `${OWNER_PROMPT_TEMPLATES.length} business prompts`, tone: 'pass' },
    ];
  }, [aiProxyStatus.error, aiProxyStatus.model, aiProxyStatus.status, aiReplyPending, conversationQuery.data?.id, conversationQuery.error, conversationQuery.isLoading, effectiveAiHealthDetail, fileUploadActive, isRecordingVoice, isTranscribingVoice, ivxRoomStatus, messagesQuery.error, messagesQuery.isLoading, roomStatusQuery.error, roomStatusQuery.isLoading, runtimeDebugSnapshot]);
  const sendBranchProof = useMemo<SendBranchProofRow>(() => {
    return resolveSendBranch(
      deliveryBranchStatus.branch,
      runtimeDebugSnapshot.source,
      runtimeDebugSnapshot.httpStatus,
    );
  }, [deliveryBranchStatus.branch, runtimeDebugSnapshot.source, runtimeDebugSnapshot.httpStatus]);

  const composerStatusMessage = useMemo(() => {
    if (devTestMode.testModeActive) {
      return 'Assistant ready.';
    }
    if (ownerAIAuthState === 'AUTH_INITIALIZING') {
      return 'Initializing IVX owner session…';
    }
    if (ownerAIAuthState === 'SIGNED_OUT') {
      return 'Sign in as the IVX owner to use Owner AI.';
    }
    if (ownerAIAuthState === 'SESSION_REFRESHING') {
      return 'Refreshing owner session…';
    }
    if (ownerAIAuthState === 'SIGNED_IN_MEMBER') {
      return 'This account is not the IVX owner.';
    }
    if (ownerAIAuthState === 'AUTH_ERROR') {
      return 'Authentication error. Tap to sign in again.';
    }
    if (isRecordingVoice) {
      return 'Recording voice prompt. Tap stop when finished.';
    }
    if (isTranscribingVoice) {
      return 'Transcribing voice prompt...';
    }
    if (aiReplyPending) {
      return 'Message sent. Reply will appear when ready.';
    }
    if (currentOwnerTrust.requiresElevatedConfirmation) {
      return 'Sensitive action detected. Please confirm before I proceed.';
    }
    if (ownerAIRoutingBlocked || ownerAIProofStatus.id === 'blocked_by_auth') {
      return 'Assistant is temporarily unavailable.';
    }
    return 'Assistant ready.';
  }, [aiReplyPending, currentOwnerTrust.requiresElevatedConfirmation, devTestMode.testModeActive, isRecordingVoice, isTranscribingVoice, ownerAIAuthState, ownerAIProofStatus.id, ownerAIRoutingBlocked, runtimeDebugSnapshot.hasVisibleResponseText]);

  const controlRoomItems = useMemo<IVXControlRoomItem[]>(() => {
    if (controlRoomQuery.data?.statusItems && controlRoomQuery.data.statusItems.length > 0) {
      return controlRoomQuery.data.statusItems;
    }
    if (controlRoomQuery.error) {
      return [{ id: 'control-room', label: 'Owner/developer control room', status: 'not_connected', detail: controlRoomQuery.error.message }];
    }
    return CONTROL_ROOM_FALLBACK_ITEMS;
  }, [controlRoomQuery.data?.statusItems, controlRoomQuery.error]);
  const controlRoomSummary = useMemo(() => {
    const verified = controlRoomItems.filter((item) => item.status === 'verified' || item.status === 'connected' || item.status === 'available').length;
    const blocked = controlRoomItems.filter((item) => item.status === 'blocked' || item.status === 'missing_access' || item.status === 'not_connected' || item.status === 'not_verified').length;
    return { verified, blocked, total: controlRoomItems.length };
  }, [controlRoomItems]);
  const shouldShowDiagnosticsToggle = developerToolsAllowed;

  const scrollOwnerThreadToEnd = useCallback((animated: boolean = true) => {
    const scrollIfAllowed = () => {
      if (Date.now() >= suppressAutoScrollUntilRef.current) {
        flatListRef.current?.scrollToEnd({ animated });
      }
    };

    requestAnimationFrame(scrollIfAllowed);
    setTimeout(scrollIfAllowed, Platform.OS === 'android' ? 220 : 80);
    setTimeout(scrollIfAllowed, Platform.OS === 'android' ? 520 : 180);
  }, []);

  // OPEN-ON-LATEST FIX: robust scroll-to-newest that handles both dynamic
  // content and the case where scrollToEnd silently fails. It tries scrollToEnd
  // first, then falls back to scrollToIndex with the last message index. This
  // is the single function used for initial open, new-message arrival, and
  // composer growth when the user is already at the bottom.
  const scrollToBottomRobust = useCallback((animated: boolean = false) => {
    const lastIndex = displayedMessages.length - 1;
    if (lastIndex < 0) {
      return;
    }

    const scrollIfAllowed = () => {
      if (Date.now() < suppressAutoScrollUntilRef.current) {
        return;
      }

      if (!flatListRef.current) {
        return;
      }

      try {
        flatListRef.current.scrollToEnd({ animated });
      } catch (error) {
        console.log('[IVXOwnerChatRoute] scrollToEnd failed, will retry:', error instanceof Error ? error.message : 'unknown');
      }

      // Fallback for React Native when scrollToEnd doesn't move because the
      // list hasn't computed final content offsets yet. scrollToIndex forces a
      // layout-aware jump to the last item.
      try {
        flatListRef.current.scrollToIndex({ index: lastIndex, animated, viewPosition: 1 });
      } catch (indexError) {
        console.log('[IVXOwnerChatRoute] scrollToIndex fallback pending:', indexError instanceof Error ? indexError.message : 'unknown');
      }
    };

    requestAnimationFrame(scrollIfAllowed);
    setTimeout(scrollIfAllowed, Platform.OS === 'android' ? 260 : 80);
    setTimeout(scrollIfAllowed, Platform.OS === 'android' ? 620 : 220);
    setTimeout(scrollIfAllowed, Platform.OS === 'android' ? 1200 : 500);
  }, [displayedMessages.length]);

  // OPEN-ON-LATEST FIX: retry the initial scroll until the FlatList actually
  // reports it is at the bottom. scrollToEnd / scrollToIndex can fail silently
  // when the FlatList has not yet measured dynamic bubbles, so we keep polling
  // for up to ~1.5s after the conversation first loads or switches. This is the
  // fix for the bug where the chat opens showing months-old messages instead of
  // the latest turn.
  useEffect(() => {
    if (!initialScrollPending || displayedMessages.length === 0) {
      return;
    }

    let attempts = 0;
    const maxAttempts = 8;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const tryScroll = () => {
      if (cancelled) {
        return;
      }
      attempts += 1;
      scrollToBottomRobust(false);
      if (isAtBottomRef.current) {
        setInitialScrollPending(false);
        return;
      }
      if (attempts >= maxAttempts) {
        setInitialScrollPending(false);
        return;
      }
      timeoutId = setTimeout(tryScroll, Platform.OS === 'android' ? 180 : 80);
    };

    tryScroll();

    return () => {
      cancelled = true;
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, [initialScrollPending, displayedMessages.length, scrollToBottomRobust]);

  const handleMessageListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    ivxDiagnostics.recordScroll('message-list');
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const atBottom = distanceFromBottom < 96;
    if (atBottom !== isAtBottomRef.current) {
      isAtBottomRef.current = atBottom;
      if (atBottom && initialScrollPending) {
        setInitialScrollPending(false);
      }
      setShowScrollToLatest(!atBottom);
      if (atBottom) {
        setUnreadCount(0);
      }
    }
  }, [initialScrollPending]);

  const handleScrollToLatest = useCallback(() => {
    ivxDiagnostics.recordAutoScroll('jump-to-latest');
    suppressAutoScrollUntilRef.current = 0;
    isAtBottomRef.current = true;
    setUnreadCount(0);
    setShowScrollToLatest(false);
    requestAnimationFrame(() => flatListRef.current?.scrollToEnd({ animated: true }));
    setTimeout(() => flatListRef.current?.scrollToEnd({ animated: true }), Platform.OS === 'android' ? 260 : 120);
  }, []);

  // Floating chat navigation: when a message is sent or received, auto-scroll to the
  // newest message UNLESS the owner is intentionally reading older messages — in which
  // case surface the "jump to latest" button with an unread count instead.
  useEffect(() => {
    const previousCount = prevMessageCountRef.current;
    const nextCount = displayedMessages.length;
    const searchStateChanged = prevSearchActiveRef.current !== searchActive;
    prevMessageCountRef.current = nextCount;
    prevSearchActiveRef.current = searchActive;

    // A search toggle swaps the visible data set; treat it as a re-sync, not new chat activity.
    if (searchStateChanged || searchActive) {
      return;
    }
    if (nextCount <= previousCount) {
      return;
    }
    const added = nextCount - previousCount;
    const readingOlder = !isAtBottomRef.current || Date.now() < suppressAutoScrollUntilRef.current;
    if (readingOlder) {
      setUnreadCount((current) => Math.min(current + added, 999));
      setShowScrollToLatest(true);
    } else {
      ivxDiagnostics.recordAutoScroll('new-message');
      scrollOwnerThreadToEnd(true);
    }
  }, [displayedMessages.length, searchActive, scrollOwnerThreadToEnd]);

  useEffect(() => {
    ivxDiagnostics.installConsoleInterceptor();
  }, []);

  useEffect(() => {
    return () => {
      if (highlightedMessageTimeoutRef.current) {
        clearTimeout(highlightedMessageTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    composerValueRef.current = composerValue;
  }, [composerValue]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const handleKeyboardShow = (event: { endCoordinates?: { height?: number } }) => {
      const nextInset = event.endCoordinates?.height ?? 0;
      const normalizedInset = Platform.OS === 'android'
        ? Math.max(nextInset - insets.bottom, 0)
        : nextInset;
      console.log('[IVXOwnerChatRoute] Keyboard shown inset:', normalizedInset, 'rawHeight:', nextInset, 'bottomInset:', insets.bottom);
      setKeyboardInset(normalizedInset);
      scrollOwnerThreadToEnd(true);
      setTimeout(() => scrollOwnerThreadToEnd(true), Platform.OS === 'android' ? 520 : 160);
    };

    const handleKeyboardHide = () => {
      console.log('[IVXOwnerChatRoute] Keyboard hidden');
      setKeyboardInset(0);
    };

    const showSubscription = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSubscription = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [insets.bottom, scrollOwnerThreadToEnd]);

  return (
    <ErrorBoundary fallbackTitle="IVX Owner AI unavailable">
      <KeyboardAvoidingView
        style={styles.container}
        behavior={keyboardAvoidingBehavior}
        keyboardVerticalOffset={keyboardVerticalOffset}
        onLayout={handleRootLayout}
      >
        <View style={[styles.androidStatusSpacer, { height: androidTopSpacerHeight }]} testID="ivx-owner-chat-android-status-spacer" />

        <View style={styles.content}>
          {primaryState !== 'room_error' ? (
            <View style={styles.topSearchRail} testID="ivx-owner-chat-top-search-rail">
              {searchOpen || searchActive ? (
                <View style={styles.searchBarWrap} testID="ivx-owner-chat-search-wrap">
                  <Search size={16} color={Colors.textTertiary} />
                  <TextInput
                    style={styles.searchInput}
                    value={messageSearchQuery}
                    onChangeText={handleSearchQueryChange}
                    placeholder="Search this conversation"
                    placeholderTextColor="#7C8797"
                    returnKeyType="search"
                    autoCorrect={false}
                    autoFocus
                    testID="ivx-owner-chat-search-input"
                  />
                  <Pressable
                    style={styles.searchClearButton}
                    onPress={() => {
                      setMessageSearchQuery('');
                      setSearchOpen(false);
                      Keyboard.dismiss();
                    }}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Close message search"
                    testID="ivx-owner-chat-search-clear"
                  >
                    <X size={14} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              ) : (
                <View style={styles.brandRow} testID="ivx-owner-chat-brand-row">
                  <View style={styles.brandLeftCompact}>
                    <View style={styles.brandMark}>
                      <Crown size={15} color={Colors.black} />
                    </View>
                    <Text style={styles.brandTitleCompact} numberOfLines={1}>IVX</Text>
                  </View>
                  <Pressable
                    style={styles.brandInlineSearch}
                    onPress={() => setSearchOpen(true)}
                    accessibilityRole="button"
                    accessibilityLabel="Search this conversation"
                    testID="ivx-owner-chat-search-open"
                  >
                    <Search size={16} color={Colors.textTertiary} />
                    <Text style={styles.brandInlineSearchPlaceholder} numberOfLines={1}>Search this conversation</Text>
                  </Pressable>
                  <View style={styles.brandActions}>
                    {shouldShowDiagnosticsToggle ? (
                      <Pressable
                        style={styles.controlRoomToggle}
                        onPress={() => setShowDiagnostics((current) => !current)}
                        hitSlop={8}
                        accessibilityRole="button"
                        accessibilityLabel="Toggle owner developer control room"
                        testID="ivx-owner-control-room-toggle"
                      >
                        <Terminal size={12} color={showDiagnostics ? Colors.black : Colors.primary} />
                        <Text style={[styles.controlRoomToggleText, showDiagnostics ? styles.controlRoomToggleTextActive : null]}>{showDiagnostics ? 'Chat' : 'Control'}</Text>
                      </Pressable>
                    ) : null}
                  </View>
                </View>
              )}
            </View>
          ) : null}
          {topStatusNote ? (
            <View
              style={ownerAIRoutingBlocked ? styles.blockedBanner : activeFallbackForCurrentMessage ? styles.degradedBanner : styles.devBanner}
              testID="ivx-owner-chat-top-status"
            >
              <Text numberOfLines={3} style={ownerAIRoutingBlocked ? styles.blockedBannerText : activeFallbackForCurrentMessage ? styles.degradedBannerText : styles.devBannerText}>{topStatusNote}</Text>
            </View>
          ) : null}
          {/* Owner-auth failure banner: surfaces the EXACT reason the privileged
              owner route was rejected (issuer mismatch / expired / Supabase
              rejected / email not in IVX_OWNER_REGISTRATION_EMAILS) instead of a
              silent fallback. Tap opens Auth Diagnostics to recover. */}
          {ownerAuthFailureBanner ? (
            <Pressable
              style={styles.ownerAuthFailureBanner}
              onPress={() => router.push('/ivx/auth-diagnostics' as never)}
              testID="ivx-owner-auth-failure-banner"
            >
              <View style={styles.ownerAuthFailureBannerHeader}>
                <Lock size={13} color={Colors.error} />
                <Text style={styles.ownerAuthFailureBannerTitle}>
                  {`Owner route rejected${ownerAuthFailureBanner.statusCode ? ` (HTTP ${ownerAuthFailureBanner.statusCode})` : ''}`}
                </Text>
              </View>
              <Text numberOfLines={4} style={styles.ownerAuthFailureBannerText}>{ownerAuthFailureBanner.reason}</Text>
              <Pressable
                style={[styles.refreshOwnerSessionButton, isRefreshingOwnerSession ? styles.actionButtonDisabled : null]}
                onPress={(event) => {
                  event.stopPropagation?.();
                  void handleRefreshOwnerSession();
                }}
                disabled={isRefreshingOwnerSession}
                testID="ivx-owner-refresh-session-banner"
              >
                <KeyRound size={13} color={Colors.black} />
                <Text style={styles.refreshOwnerSessionButtonText}>Refresh Owner Session</Text>
              </Pressable>
              <Text style={styles.ownerAuthFailureBannerAction}>Tap card to open Auth Diagnostics →</Text>
            </Pressable>
          ) : null}

          {/* Red "IVX AI BLOCKED" watchdog banner. Self-hidden during normal
              successful chat and while a request is in flight; appears ONLY when
              /api/ivx/owner-ai fails, times out, or returns an auth/tooling/
              backend error. Tap opens the full watchdog drawer. */}
          <IVXWatchdogBanner onPress={() => setWatchdogDrawerVisible(true)} />

          {/* Staged timeout banner: 15s "Still working", 45s retry, 90s backend
              status check, 180s fail with exact evidence. No infinite spinner. */}
          {stagedTimeoutTraceId ? (
            <IVXStagedTimeoutBanner
              traceId={stagedTimeoutTraceId}
              messageId={stagedTimeoutMessageId}
              conversationId={conversationQuery.data?.id ?? null}
              requestStarted={stagedTimeoutRequestStarted}
              lastSuccessfulCheckpoint={stagedTimeoutLastCheckpoint}
              onRetry={() => {
                console.log('[IVXStagedTimeout] Retry triggered for trace:', stagedTimeoutTraceId);
                // Re-invoke the last message via handleAskAI or handleSend
                const lastPending = pendingOwnerMessages[pendingOwnerMessages.length - 1];
                if (lastPending) {
                  sendMessageMutation.mutate({
                    text: lastPending.text,
                    mode: lastPending.mode === 'ai_only' ? 'ai_only' : 'send_and_ai',
                    clientId: createTransientMessageId('ivx-owner-staged-retry'),
                    capturedText: lastPending.text,
                    replyTo: lastPending.replyTo ?? null,
                  });
                }
              }}
              onCancel={() => {
                console.log('[IVXStagedTimeout] Cancel triggered for trace:', stagedTimeoutTraceId);
                setStagedTimeoutTraceId(null);
                setAiReplyPending(false);
              }}
              onQueryBackendStatus={async (traceId: string): Promise<TimeoutEvidence | null> => {
                try {
                  const baseUrl = 'https://api.ivxholding.com';
                  const token = await getIVXAccessToken();
                  const res = await fetch(`${baseUrl}/api/ivx/owner-ai/request/${traceId}/status`, {
                    headers: { Authorization: `Bearer ${token}` },
                  });
                  if (!res.ok) return null;
                  const data = await res.json() as Record<string, unknown>;
                  return {
                    traceId,
                    requestId: (data.requestId as string) ?? null,
                    conversationId: (data.conversationId as string) ?? null,
                    messageId: stagedTimeoutMessageId,
                    lastSuccessfulCheckpoint: stagedTimeoutLastCheckpoint,
                    failedCheckpoint: (data.structuredError as { checkpoint?: string } | null)?.checkpoint ?? null,
                    requestStarted: stagedTimeoutRequestStarted,
                    httpStatus: (data.terminalResult as { httpStatus?: number } | null)?.httpStatus ?? null,
                    retryCount: (data.retryCount as number) ?? 0,
                    networkStatus: 'online',
                    appVersion: getIVXBuildInfo().appVersion,
                    buildNumber: String(Constants.expoConfig?.android?.versionCode ?? 'unknown'),
                    commitSha: getIVXBuildInfo().commitShort,
                    elapsedMs: Date.now() - (stagedTimeoutStartRef.current ?? Date.now()),
                  };
                } catch (err) {
                  console.log('[IVXStagedTimeout] Backend status query failed:', err instanceof Error ? err.message : 'unknown');
                  return null;
                }
              }}
            />
          ) : null}

          {showDiagnostics && developerToolsAllowed ? (
            <ScrollView
              style={styles.developerToolsScroll}
              contentContainerStyle={[styles.developerToolsScrollContent, { paddingBottom: developerToolsScrollPadding }]}
              showsVerticalScrollIndicator
              nestedScrollEnabled
              bounces
              alwaysBounceVertical
              overScrollMode="always"
              scrollEventThrottle={16}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              testID="ivx-owner-developer-tools-scroll"
            >
              <View style={styles.developerToolsCard} testID="ivx-owner-developer-tools-panel">
                <View style={styles.developerToolsHeader}>
                  <View style={styles.developerToolsIconWrap}>
                    <Terminal size={15} color={Colors.black} />
                  </View>
                  <View style={styles.developerToolsCopy}>
                    <Text style={styles.developerToolsEyebrow}>Developer tools</Text>
                    <Text style={styles.developerToolsTitle}>Private runtime checks</Text>
                  </View>
                </View>
                <View style={styles.developerStatusGrid}>
                  {developerStatusRows.map((row) => (
                    <View
                      key={row.id}
                      style={[
                        styles.developerStatusTile,
                        row.tone === 'pass'
                          ? styles.developerStatusTilePass
                          : row.tone === 'error'
                            ? styles.developerStatusTileError
                            : row.tone === 'pending'
                              ? styles.developerStatusTilePending
                              : styles.developerStatusTileWarn,
                      ]}
                      testID={`ivx-owner-devtools-${row.id}`}
                    >
                      <View style={[
                        styles.developerStatusDot,
                        row.tone === 'pass'
                          ? styles.developerStatusDotPass
                          : row.tone === 'error'
                            ? styles.developerStatusDotError
                            : row.tone === 'pending'
                              ? styles.developerStatusDotPending
                              : styles.developerStatusDotWarn,
                      ]} />
                      <Text style={styles.developerStatusLabel}>{row.label}</Text>
                      <Text style={styles.developerStatusValue} numberOfLines={2}>{row.value}</Text>
                    </View>
                  ))}
                </View>
                <Text style={styles.developerToolsFootnote}>Visible only for authenticated owner developer sessions; normal users never see runtime metadata.</Text>
              </View>

              <View style={styles.controlRoomCard} testID="ivx-owner-developer-control-room">
                <View style={styles.controlRoomHeaderRow}>
                  <View style={styles.controlRoomHeaderCopy}>
                    <Text style={styles.backendAuditEyebrow}>Owner/developer control room</Text>
                    <Text style={styles.controlRoomTitle}>IVX system status</Text>
                    <Text style={styles.controlRoomSubtitle}>{`${controlRoomSummary.verified}/${controlRoomSummary.total} verified or available · ${controlRoomSummary.blocked} pending/blocking`}</Text>
                  </View>
                  <View style={styles.controlRoomActions}>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/business-impact' as never)}
                      testID="ivx-owner-open-business-impact"
                    >
                      <Crown size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Command</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/admin/diagnostics' as never)}
                      testID="ivx-owner-open-diagnostics-admin"
                    >
                      <Cpu size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Diagnostics</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/executive-layer' as never)}
                      testID="ivx-owner-open-executive-layer"
                    >
                      <LineChart size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Executive</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/developer-monitor' as never)}
                      testID="ivx-owner-open-developer-monitor"
                    >
                      <Activity size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Monitor</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/live-coding-stream' as never)}
                      testID="ivx-owner-open-live-coding-stream"
                    >
                      <Radio size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Stream</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/live-work' as never)}
                      testID="ivx-owner-open-live-work"
                    >
                      <Terminal size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Live Work</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/independence' as never)}
                      testID="ivx-owner-open-independence-tracker"
                    >
                      <ShieldCheck size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Independence</Text>
                    </Pressable>

                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/variables' as never)}
                      testID="ivx-owner-open-variables-tool"
                    >
                      <KeyRound size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Variables</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/innovation-dashboard' as never)}
                      testID="ivx-owner-open-innovation-dashboard"
                    >
                      <Sparkles size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Innovation</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/opportunity-engine' as never)}
                      testID="ivx-owner-open-opportunity-engine"
                    >
                      <Radar size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Opportunity</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/capital-network' as never)}
                      testID="ivx-owner-open-capital-network"
                    >
                      <Users size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Capital</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/investors' as never)}
                      testID="ivx-owner-open-investors"
                    >
                      <UserPlus size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Investors</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/crm-import' as never)}
                      testID="ivx-owner-open-crm-import"
                    >
                      <Upload size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Import</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/runtime-variables' as never)}
                      testID="ivx-owner-open-runtime-variables"
                    >
                      <KeyRound size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Variables</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/investor-discovery' as never)}
                      testID="ivx-owner-open-investor-discovery"
                    >
                      <Search size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Discovery</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/capital-pipeline' as never)}
                      testID="ivx-owner-open-capital-pipeline"
                    >
                      <GitBranch size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Pipeline</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/outreach' as never)}
                      testID="ivx-owner-open-outreach"
                    >
                      <Megaphone size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Campaigns</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/capital-outreach' as never)}
                      testID="ivx-owner-open-capital-outreach"
                    >
                      <Send size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Outreach</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/gmail-provider' as never)}
                      testID="ivx-owner-open-gmail-provider"
                    >
                      <SafeIcon icon={Mail} name="Mail" size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Gmail</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/lead-scoring' as never)}
                      testID="ivx-owner-open-lead-scoring"
                    >
                      <Gauge size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Lead Scores</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/deal-matching' as never)}
                      testID="ivx-owner-open-deal-matching"
                    >
                      <Crosshair size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Matching</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/deal-tracking' as never)}
                      testID="ivx-owner-open-deal-tracking"
                    >
                      <ClipboardList size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Deal Tracking</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/power-tools' as never)}
                      testID="ivx-owner-open-power-tools"
                    >
                      <Rocket size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Power Tools</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/capital-command-center' as never)}
                      testID="ivx-owner-open-capital-command-center"
                    >
                      <LayoutDashboard size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Command Center</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/ivx/auth-diagnostics' as never)}
                      testID="ivx-owner-open-auth-diagnostics"
                    >
                      <Lock size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Auth</Text>
                    </Pressable>
                    <Pressable
                      style={styles.graphActionButton}
                      onPress={() => router.push('/admin/diagnostics' as never)}
                      testID="ivx-owner-open-diagnostics-admin"
                    >
                      <Cpu size={13} color={Colors.black} />
                      <Text style={styles.graphActionButtonText}>Diagnostics</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.graphActionButton, controlRoomQuery.isFetching ? styles.actionButtonDisabled : null]}
                      onPress={() => { void controlRoomQuery.refetch(); }}
                      disabled={controlRoomQuery.isFetching}
                      testID="ivx-owner-control-room-refresh"
                    >
                      <Text style={styles.graphActionButtonText}>{controlRoomQuery.isFetching ? 'Checking' : 'Run tests'}</Text>
                    </Pressable>
                  </View>
                </View>
                {controlRoomQuery.error ? <Text style={styles.controlRoomError}>{controlRoomQuery.error.message}</Text> : null}
                <View style={styles.controlRoomList}>
                  {controlRoomItems.map((item, index) => {
                    const tone = getControlRoomTone(item.status);
                    return (
                      <View key={item.id} style={styles.controlRoomRow} testID={`ivx-owner-control-room-${item.id}`}>
                        <Text style={styles.controlRoomIndex}>{String(index + 1).padStart(2, '0')}</Text>
                        <View style={styles.controlRoomRowCopy}>
                          <View style={styles.controlRoomRowTop}>
                            <Text style={styles.controlRoomLabel}>{item.label}</Text>
                            <View style={[
                              styles.controlRoomStatusBadge,
                              tone === 'pass'
                                ? styles.controlRoomStatusBadgePass
                                : tone === 'error'
                                  ? styles.controlRoomStatusBadgeError
                                  : tone === 'pending'
                                    ? styles.controlRoomStatusBadgePending
                                    : styles.controlRoomStatusBadgeWarn,
                            ]}>
                              <Text style={[
                                styles.controlRoomStatusText,
                                tone === 'pass'
                                  ? styles.controlRoomStatusTextPass
                                  : tone === 'error'
                                    ? styles.controlRoomStatusTextError
                                    : tone === 'pending'
                                      ? styles.controlRoomStatusTextPending
                                      : styles.controlRoomStatusTextWarn,
                              ]}>{getControlRoomStatusLabel(item.status)}</Text>
                            </View>
                          </View>
                          <Text style={styles.controlRoomDetail}>{item.detail}</Text>
                          {item.missingCredentialNames && item.missingCredentialNames.length > 0 ? (
                            <Text style={styles.controlRoomMissing}>{`Missing: ${item.missingCredentialNames.join(', ')}`}</Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}
                </View>
                <Text style={styles.developerToolsFootnote}>No status is guessed here. Unconnected tools show not connected; unverified checks show not verified; missing secrets are listed by name only.</Text>
              </View>

              <View style={styles.sendBranchProofRow} testID="ivx-owner-send-branch-proof">
                <Text style={styles.sendBranchProofLabel}>send branch</Text>
                <Text
                  style={[
                    styles.sendBranchProofValue,
                    sendBranchProof.branch === 'primary_realtime'
                      ? styles.sendBranchProofValuePass
                      : sendBranchProof.branch === 'alternate_shared'
                        ? styles.sendBranchProofValueWarn
                        : sendBranchProof.branch === 'snapshot_fallback' || sendBranchProof.branch === 'local_only'
                          ? styles.sendBranchProofValueDegraded
                          : styles.sendBranchProofValuePending,
                  ]}
                  numberOfLines={1}
                >
                  {sendBranchProof.label}
                </Text>
                <Text style={styles.sendBranchProofContext} numberOfLines={1}>{sendBranchProof.context}</Text>
              </View>

              <View style={styles.qaCard} testID="ivx-owner-chat-qa-card">
                <View style={styles.qaHeaderRow}>
                  <View>
                    <Text style={styles.qaEyebrow}>{`${auditReport.passedCount}/${auditReport.totalCount} audit checks passed`}</Text>
                    <Text style={styles.qaTitle}>IVX Owner AI runtime audit</Text>
                  </View>
                  <View style={[
                    styles.qaBadge,
                    proofBadgeTone === 'pass'
                      ? styles.qaBadgePass
                      : proofBadgeTone === 'blocked'
                        ? styles.qaBadgeBlocked
                        : proofBadgeTone === 'pending'
                          ? styles.qaBadgePending
                          : styles.qaBadgeWarn,
                  ]}>
                    <Text style={[
                      styles.qaBadgeText,
                      proofBadgeTone === 'pass'
                        ? styles.qaBadgeTextPass
                        : proofBadgeTone === 'blocked'
                          ? styles.qaBadgeTextBlocked
                          : proofBadgeTone === 'pending'
                            ? styles.qaBadgeTextPending
                            : styles.qaBadgeTextWarn,
                    ]}>
                      {proofBadgeLabel}
                    </Text>
                  </View>
                </View>

                <View style={styles.qaChecklist}>
                  {qaChecklist.map((item) => (
                    <View key={item.id} style={styles.qaItemRow} testID={`ivx-owner-chat-qa-${item.id}`}>
                      <View style={[styles.qaDot, item.passed ? styles.qaDotPass : styles.qaDotWarn]} />
                      <View style={styles.qaCopy}>
                        <Text style={styles.qaItemLabel}>{item.label}</Text>
                        <Text style={styles.qaItemDetail}>{item.detail}</Text>
                      </View>
                    </View>
                  ))}
                </View>

                <View style={styles.proofRail}>
                  {proofRows.map((proof) => (
                    <View key={proof.id} style={styles.proofRow} testID={`ivx-owner-proof-${proof.sourceType}`}>
                      <View style={[
                        styles.proofDot,
                        proof.status === 'verified'
                          ? styles.proofDotPass
                          : proof.status === 'blocked'
                            ? styles.proofDotBlocked
                            : proof.status === 'pending'
                              ? styles.proofDotPending
                              : styles.proofDotWarn,
                      ]} />
                      <View style={styles.proofCopy}>
                        <Text style={styles.proofTitle}>{proof.title}</Text>
                        <Text style={styles.proofDetail}>{proof.summary}</Text>
                        <Text style={styles.proofMeta}>
                          {`${proof.sourceSignal} • confidence ${Math.round(proof.confidence * 100)}% • ${proof.observedAt}`}
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
                <Text style={styles.qaScopeText}>{`${auditReport.summary} ${qaScopeNote}`}</Text>
              </View>

              <View style={styles.backendAuditCard} testID="ivx-owner-chat-live-proof">
                <Text style={styles.backendAuditEyebrow}>Operational proof</Text>
                <Text style={styles.backendAuditTitle}>Live chat telemetry</Text>
                <AuditInfoRow label="Live users observed" value={String(liveSnapshot.totalLiveUsers)} />
                <AuditInfoRow label="Chat active users" value={String(liveChatMetric?.activeUsers ?? 0)} />
                <AuditInfoRow label="Chat sessions in progress" value={String(liveChatMetric?.sessionsInProgress ?? 0)} />
                <AuditInfoRow label="Chat messages tracked" value={String(messageAudit.ownerMessages + messageAudit.assistantMessages)} />
                <AuditInfoRow label="Fallback transport state" value={liveSnapshot.operator.fallbackTransportState} />
                <AuditInfoRow label="Stuck users" value={String(liveSnapshot.operator.stuckUsers)} />
                <Text style={styles.backendAuditBody}>
                  {liveTopSource
                    ? `Top source right now: ${liveTopSource.source} · quality ${liveTopSource.qualityScore} · conversions ${liveTopSource.conversions}.`
                    : 'No remote source proof has been observed yet in the active intelligence window.'}
                </Text>
                <Text style={styles.backendAuditFootnote}>{'Session proof is emitted on room open, page view, chat open, chat message, fallback, routing events, and room close for /ivx/chat.'}</Text>
              </View>

              <View style={styles.backendAuditCard} testID="ivx-owner-chat-live-debug-panel">
                <Text style={styles.backendAuditEyebrow}>Owner debug · live device proof</Text>
                <Text style={styles.backendAuditTitle}>Is the running app the latest build?</Text>
                <AuditInfoRow label="Frontend build version" value={ownerLiveDebug.frontendBuild} testID="ivx-owner-debug-frontend-build" />
                <AuditInfoRow label="Backend commit / marker" value={ownerLiveDebug.backendCommit} testID="ivx-owner-debug-backend-commit" />
                <AuditInfoRow label="Backend endpoint" value={ownerLiveDebug.backendEndpoint} testID="ivx-owner-debug-backend-endpoint" />
                <AuditInfoRow label="Current conversation ID" value={ownerLiveDebug.conversationId} testID="ivx-owner-debug-conversation-id" />
                <AuditInfoRow label="Loaded message count" value={ownerLiveDebug.loadedMessageCount} testID="ivx-owner-debug-message-count" />
                <AuditInfoRow label="Last saved message ID" value={ownerLiveDebug.lastSavedMessageId} testID="ivx-owner-debug-last-saved-id" />
                <AuditInfoRow label="Last AI response status" value={ownerLiveDebug.lastAIStatus} testID="ivx-owner-debug-last-ai-status" />
                <AuditInfoRow label="Parser result" value={ownerLiveDebug.parserResult} testID="ivx-owner-debug-parser-result" />
                <AuditInfoRow label="Storage source" value={ownerLiveDebug.storageSource} testID="ivx-owner-debug-storage-source" />
                <AuditInfoRow label="Watchdog status" value={ownerLiveDebug.watchdogStatus} testID="ivx-owner-debug-watchdog-status" />
                <Text style={styles.backendAuditFootnote}>{`If "Frontend build version" is not ${IVX_FRONTEND_BUILD_STAMP}, the device is still running a stale bundle and the latest repo fixes have NOT reached this app yet.`}</Text>
              </View>

              <View style={styles.backendAuditCard} testID="ivx-owner-chat-runtime-debug">
                <Text style={styles.backendAuditEyebrow}>Runtime proof</Text>
                <Text style={styles.backendAuditTitle}>Live remote proof card</Text>
                <View style={styles.runtimeProofBanner} testID="ivx-owner-chat-proof-banner">
                  <Text style={styles.runtimeProofBannerTitle}>{runtimeProofHeadline.title}</Text>
                  <Text style={styles.runtimeProofBannerDetail}>{runtimeProofHeadline.detail}</Text>
                </View>
                {runtimeProofPrimaryRows.map((row) => (
                  <AuditInfoRow
                    key={row.label}
                    label={row.label}
                    value={row.value}
                    testID={`ivx-owner-runtime-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  />
                ))}
                <AuditInfoRow label="Request source" value={getRuntimeSourceLabel(runtimeDebugSnapshot)} />
                <AuditInfoRow label="Send branch" value={deliveryBranchStatus.branch} testID="ivx-owner-runtime-send-branch" />
                <AuditInfoRow label="Send branch title" value={deliveryBranchStatus.title} testID="ivx-owner-runtime-send-title" />
                <AuditInfoRow label="Latest send message ID" value={lastSendAudit?.messageId ?? 'pending'} testID="ivx-owner-runtime-send-message-id" />
                <AuditInfoRow label="Latest send conversation ID" value={lastSendAudit?.conversationId ?? 'pending'} testID="ivx-owner-runtime-send-conversation-id" />
                <AuditInfoRow label="Latest send observed" value={lastSendAudit?.observedAt ?? 'pending'} testID="ivx-owner-runtime-send-observed" />
                <AuditInfoRow label="Receive branch" value={receiveBranchStatus.branch} testID="ivx-owner-runtime-receive-branch" />
                <AuditInfoRow label="Receive branch title" value={receiveBranchStatus.title} testID="ivx-owner-runtime-receive-title" />
                <AuditInfoRow label="Latest receive message ID" value={lastReceiveAudit?.messageId ?? 'pending'} testID="ivx-owner-runtime-receive-message-id" />
                <AuditInfoRow label="Latest receive conversation ID" value={lastReceiveAudit?.conversationId ?? 'pending'} testID="ivx-owner-runtime-receive-conversation-id" />
                <AuditInfoRow label="Latest receive observed" value={lastReceiveAudit?.observedAt ?? 'pending'} testID="ivx-owner-runtime-receive-observed" />
                <AuditInfoRow label="Subscription owner" value={ownerSessionIdRef.current} testID="ivx-owner-runtime-subscription-owner" />
                <AuditInfoRow label="Active realtime channel count" value={String(realtimeSubscriptionAudit.activeChannelCount)} testID="ivx-owner-runtime-active-channel-count" />
                <AuditInfoRow label="Active realtime channels" value={realtimeSubscriptionAudit.activeChannels.join(', ') || 'none'} testID="ivx-owner-runtime-active-channels" />
                <AuditInfoRow label="Realtime teardown count" value={String(realtimeSubscriptionAudit.teardownCount)} testID="ivx-owner-runtime-teardown-count" />
                <AuditInfoRow label="Local listener count" value={String(realtimeSubscriptionAudit.localListenerCount)} testID="ivx-owner-runtime-local-listener-count" />
                <AuditInfoRow label="Deployment marker" value={runtimeDebugSnapshot.deploymentMarker ?? 'pending'} />
                <AuditInfoRow label="Auth mode" value={runtimeDebugSnapshot.authMode} />
                <AuditInfoRow label="Owner room trust" value={ownerRoomAuthenticated ? 'owner_room_authenticated' : 'owner_room_unverified'} testID="ivx-owner-runtime-owner-room-trust" />
                <AuditInfoRow label="Backend admin trust" value={backendAdminVerified ? 'backend_admin_verified' : 'backend_admin_unverified'} testID="ivx-owner-runtime-backend-admin-trust" />
                <AuditInfoRow label="Conversation access" value={fallbackChatOnlyActive ? 'fallback_chat_only' : 'full_backend_execution'} testID="ivx-owner-runtime-conversation-access" />
                <AuditInfoRow label="Action gate" value={currentOwnerTrust.requiresElevatedConfirmation ? 'destructive_action_requires_confirmation' : 'normal_owner_chat'} testID="ivx-owner-runtime-action-gate" />
                <AuditInfoRow label="Request class" value={currentOwnerTrust.requestClass} testID="ivx-owner-runtime-request-class" />
                <AuditInfoRow label="Owner/dev bypass enabled" value={runtimeDebugSnapshot.ownerBypassEnabled ? 'yes' : 'no'} />
                <AuditInfoRow label="Conversation ID" value={runtimeDebugSnapshot.conversationId ?? 'pending'} />
                <AuditInfoRow label="Selected intent" value={runtimeDebugSnapshot.selectedIntent ?? 'pending'} testID="ivx-owner-runtime-selected-intent" />
                <AuditInfoRow label="Selected tool" value={runtimeDebugSnapshot.selectedTool ?? (lastToolOutputs.length > 0 ? lastToolOutputs.map((output) => output.tool).join(', ') : 'none')} testID="ivx-owner-runtime-selected-tool" />
                <AuditInfoRow label="Tool used" value={lastToolOutputs.length > 0 ? lastToolOutputs.map((output) => output.tool).join(', ') : 'none'} testID="ivx-owner-runtime-tool-used" />
                <AuditInfoRow label="Tool output" value={lastToolOutputs.length > 0 ? JSON.stringify(lastToolOutputs[0]?.output ?? lastToolOutputs[0]?.error ?? null).slice(0, 220) : 'none'} testID="ivx-owner-runtime-tool-output" />
                <AuditInfoRow
                  label="Fallback state"
                  value={getRuntimeFallbackState(getActiveRuntimeSource({
                    source: normalizeRuntimeSource(runtimeDebugSnapshot.source),
                    requestStage: runtimeDebugSnapshot.requestStage,
                    failureClass: runtimeDebugSnapshot.failureClass,
                    isFallback: runtimeDebugSnapshot.source === 'provider_fallback',
                    isStreaming: hasActiveStreamingState(runtimeDebugSnapshot),
                    hasVisibleResponseText: runtimeDebugSnapshot.hasVisibleResponseText,
                  }))}
                />
                <AuditInfoRow label="Degraded state" value={getRuntimeDegradedState(runtimeSnapshot.runtimeStatus)} />
                <AuditInfoRow label="Last attempt" value={formatRuntimeTimestamp(runtimeDebugSnapshot.lastAttemptAt)} />
                <AuditInfoRow label="Last verified" value={formatRuntimeTimestamp(runtimeDebugSnapshot.lastVerifiedAt)} />
                <Text style={styles.backendAuditBody}>{currentOwnerTrust.explanation}</Text>
                <Text style={styles.backendAuditBody}>{runtimeDebugSnapshot.failureDetail}</Text>
                <Text style={styles.backendAuditBody}>{`Send proof: ${deliveryBranchStatus.detail}`}</Text>
                <Text style={styles.backendAuditFootnote}>{deliveryBranchStatus.evidence}</Text>
                <Text style={styles.backendAuditBody}>{`Receive proof: ${receiveBranchStatus.detail}`}</Text>
                <Text style={styles.backendAuditFootnote}>{receiveBranchStatus.evidence}</Text>
              </View>

              <View style={styles.qaCard} testID="ivx-owner-chat-functionality-proof-ledger">
                <View style={styles.qaHeaderRow}>
                  <View>
                    <Text style={styles.qaEyebrow}>1–200 numbered proof ledger</Text>
                    <Text style={styles.qaTitle}>IVX functionality truth table</Text>
                  </View>
                  <View style={styles.functionalitySummary}>
                    <Text style={styles.functionalitySummaryText}>{`${functionalityProofCounts.live} live`}</Text>
                    <Text style={styles.functionalitySummaryText}>{`${functionalityProofCounts.pass} pass`}</Text>
                    <Text style={styles.functionalitySummaryText}>{`${functionalityProofCounts.fail} fail`}</Text>
                  </View>
                </View>
                <View style={styles.functionalityLedgerList}>
                  {functionalityProofList.map((item) => (
                    <View key={item.key} style={styles.functionalityLedgerRow} testID={`ivx-owner-chat-proof-slot-${item.index}`}>
                      <Text style={styles.functionalityLedgerIndex}>{item.index}</Text>
                      <View style={styles.functionalityLedgerCopy}>
                        <View style={styles.functionalityLedgerTitleRow}>
                          <Text style={styles.functionalityLedgerTitle}>{item.title}</Text>
                          <View
                            style={[
                              styles.functionalityLedgerBadge,
                              item.status === 'live'
                                ? styles.functionalityLedgerBadgeLive
                                : item.status === 'pass'
                                  ? styles.functionalityLedgerBadgePass
                                  : styles.functionalityLedgerBadgeFail,
                            ]}
                          >
                            <Text
                              style={[
                                styles.functionalityLedgerBadgeText,
                                item.status === 'live'
                                  ? styles.functionalityLedgerBadgeTextLive
                                  : item.status === 'pass'
                                    ? styles.functionalityLedgerBadgeTextPass
                                    : styles.functionalityLedgerBadgeTextFail,
                              ]}
                            >
                              {item.status.toUpperCase()}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.functionalityLedgerDetail}>{item.detail}</Text>
                        <Text style={styles.functionalityLedgerEvidence}>{item.evidence}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.backendAuditCard} testID="ivx-owner-chat-backend-audit">
                <Text style={styles.backendAuditEyebrow}>Environment audit</Text>
                <Text style={styles.backendAuditTitle}>Owner AI routing audit</Text>
                <View style={[styles.backendAuditBadge, ownerAIRoutingBlocked ? styles.backendAuditBadgeBlocked : styles.backendAuditBadgePass]}>
                  <Text style={[styles.backendAuditBadgeText, ownerAIRoutingBlocked ? styles.backendAuditBadgeTextBlocked : styles.backendAuditBadgeTextPass]}>
                    {ownerAIRoutingBlocked ? 'GUARD BLOCKED' : `${backendAuditSummary.currentEnvironment.toUpperCase()} ROUTING`}
                  </Text>
                </View>
                <AuditInfoRow label="Current environment" value={backendAuditSummary.currentEnvironment} testID="ivx-owner-chat-audit-environment" />
                <AuditInfoRow label="Routing policy" value={backendAuditSummary.routingPolicy} testID="ivx-owner-chat-audit-routing-policy" />
                <AuditInfoRow label="Configured URL" value={backendAuditSummary.configuredOwnerAIBaseUrl} testID="ivx-owner-chat-audit-configured-url" />
                <AuditInfoRow label="Active base URL" value={backendAuditSummary.activeBaseUrl} testID="ivx-owner-chat-audit-active-base-url" />
                <AuditInfoRow label="Active host" value={backendAuditSummary.activeHost} testID="ivx-owner-chat-audit-active-host" />
                <AuditInfoRow label="Active endpoint chosen" value={backendAuditSummary.activeEndpoint} testID="ivx-owner-chat-audit-active-endpoint" />
                <AuditInfoRow label="App API base URL" value={backendAuditSummary.directApiBaseUrl} testID="ivx-owner-chat-audit-direct-api-url" />
                <AuditInfoRow label="App API host" value={backendAuditSummary.directApiHost} testID="ivx-owner-chat-audit-direct-api-host" />
                <AuditInfoRow label="Owner health URL" value={backendAuditSummary.ownerAiHealthUrl} testID="ivx-owner-chat-audit-owner-health" />
                <AuditInfoRow label="Owner Route53 audit URL" value={backendAuditSummary.ownerRoute53AuditUrl} testID="ivx-owner-chat-audit-owner-route53" />
                <AuditInfoRow label="App API health URL" value={backendAuditSummary.appApiHealthUrl} testID="ivx-owner-chat-audit-app-health" />
                <AuditInfoRow label="App API Route53 audit URL" value={backendAuditSummary.appApiRoute53AuditUrl} testID="ivx-owner-chat-audit-app-route53" />
                <AuditInfoRow label="Deployment marker" value={runtimeSnapshot.provider.deploymentMarker ?? 'pending'} testID="ivx-owner-chat-audit-deployment-marker" />
                <AuditInfoRow label="Fallback used" value={backendAuditSummary.fallbackUsed} testID="ivx-owner-chat-audit-fallback-used" />
                <Text style={styles.backendAuditBody}>{backendAuditSummary.failureMode}</Text>
                <Text style={styles.backendAuditFootnote}>{backendAuditSummary.selectionReason}</Text>
                <Text style={styles.backendAuditFootnote}>{backendAuditSummary.recommendedResolution}</Text>
                <Text style={styles.backendAuditFootnote}>{backendAuditSummary.gracefulDegradationNote}</Text>
                {backendAuditSummary.mismatchWarnings.length > 0 ? (
                  <View style={styles.backendAuditList} testID="ivx-owner-chat-audit-mismatch-warnings">
                    {backendAuditSummary.mismatchWarnings.map((warning, index) => (
                      <Text key={`${warning}-${index}`} style={styles.backendAuditListItem}>{`• ${warning}`}</Text>
                    ))}
                  </View>
                ) : null}
                <View style={styles.backendAuditList} testID="ivx-owner-chat-audit-workflow-trace">
                  {backendAuditSummary.workflowTrace.map((step, index) => (
                    <Text key={`${step}-${index}`} style={styles.backendAuditListItem}>{`${index + 1}. ${step}`}</Text>
                  ))}
                </View>
              </View>

              {(ownerGraphNodes.length > 0 || ownerGraphProofs.length > 0 || ownerGraphRisks.length > 0) ? (
                <View style={styles.graphCard} testID="ivx-owner-chat-graph-card">
                  <View style={styles.graphHeaderRow}>
                    <View>
                      <Text style={styles.graphEyebrow}>Live graph</Text>
                      <Text style={styles.graphTitle}>Owner room dependency spine</Text>
                    </View>
                    <View style={styles.graphActionRow}>
                      <Pressable
                        style={[styles.graphActionButton, roomControlMutation.isPending ? styles.actionButtonDisabled : null]}
                        onPress={() => handleRoomControlActionPress('rerun_health_probe')}
                        disabled={roomControlMutation.isPending}
                        testID="ivx-owner-chat-rerun-proof"
                      >
                        <Text style={styles.graphActionButtonText}>Rerun proof</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.graphActionButton, roomControlMutation.isPending ? styles.actionButtonDisabled : null]}
                        onPress={() => handleRoomControlActionPress('transition_stuck_sends')}
                        disabled={roomControlMutation.isPending}
                        testID="ivx-owner-chat-clear-stuck"
                      >
                        <Text style={styles.graphActionButtonText}>Clear stuck</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.graphActionButton, sendMessageMutation.isPending ? styles.actionButtonDisabled : null]}
                        onPress={() => handleSend('/replay')}
                        disabled={sendMessageMutation.isPending}
                        testID="ivx-owner-chat-replay-last"
                      >
                        <Text style={styles.graphActionButtonText}>Replay last</Text>
                      </Pressable>
                    </View>
                  </View>

                  {ownerGraphNodes.length > 0 ? (
                    <View style={styles.graphNodeList}>
                      {ownerGraphNodes.map((node) => (
                        <View key={node.id} style={styles.graphNodeRow}>
                          <View style={[
                            styles.graphNodeDot,
                            node.status === 'healthy'
                              ? styles.graphNodeDotPass
                              : node.status === 'critical'
                                ? styles.graphNodeDotBlocked
                                : node.status === 'degraded'
                                  ? styles.graphNodeDotWarn
                                  : styles.graphNodeDotPending,
                          ]} />
                          <View style={styles.graphNodeCopy}>
                            <Text style={styles.graphNodeTitle}>{node.name}</Text>
                            <Text style={styles.graphNodeMeta}>{`${node.dependencies.length} deps · ${node.status} · proof ${node.proofStatus}`}</Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {ownerGraphRisks.length > 0 ? (
                    <View style={styles.graphRiskList}>
                      {ownerGraphRisks.map((risk) => (
                        <View key={risk.id} style={styles.graphRiskRow}>
                          <View style={styles.graphRiskCopy}>
                            <Text style={styles.graphRiskTitle}>{risk.subjectId.replace('module:', '').replace(/_/g, ' ')}</Text>
                            <Text style={styles.graphRiskMeta}>{`Blast radius ${risk.blastRadius} · ${risk.trendDirection} · ${risk.recommendedAction.replace(/_/g, ' ')}`}</Text>
                          </View>
                          <Text style={styles.graphRiskValue}>{`${Math.round(risk.currentRiskScore * 100)}%`}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {ownerGraphProofs.length > 0 ? (
                    <View style={styles.graphProofList}>
                      {ownerGraphProofs.map((proof) => (
                        <View key={proof.id} style={styles.graphProofRow}>
                          <Text style={styles.graphProofClaim}>{proof.claim}</Text>
                          <Text style={styles.graphProofMeta}>{`${proof.sourceType} · ${Math.round(proof.confidence * 100)}% · ${proof.userImpactLevel} impact`}</Text>
                        </View>
                      ))}
                    </View>
                  ) : null}

                  {ownerActionFeed.length > 0 ? (
                    <View style={styles.graphProofList}>
                      {ownerActionFeed.map((action) => (
                        <View key={action.id} style={styles.graphProofRow}>
                          <Text style={styles.graphProofClaim}>{getActionLabel(action.actionType)}</Text>
                          <Text style={styles.graphProofMeta}>{`${action.result} · ${action.approvalMode} · ${action.targetId.replace('module:', '').replace(/_/g, ' ')}`}</Text>
                          {action.policyReason ? <Text style={styles.graphProofMeta}>{action.policyReason}</Text> : null}
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </ScrollView>
          ) : null}

          {showDiagnostics && developerToolsAllowed ? null : primaryState === 'room_error' ? (
            <View style={styles.errorState} testID="ivx-owner-chat-error">
              <Text style={styles.errorTitle}>Unable to load the owner room.</Text>
              <Text style={styles.errorText}>{messagesQuery.error?.message ?? conversationQuery.error?.message ?? 'Please try again.'}</Text>
              <Pressable
                style={styles.retryButton}
                onPress={() => {
                  void messagesQuery.refetch();
                  void conversationQuery.refetch();
                  void roomStatusQuery.refetch();
                }}
                testID="ivx-owner-chat-retry"
              >
                <Text style={styles.retryButtonText}>Retry</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {searchActive ? (
                <Text style={styles.searchResultText} testID="ivx-owner-chat-search-count">
                  {displayedMessages.length === 1 ? '1 matching message' : `${displayedMessages.length} matching messages`}
                </Text>
              ) : null}
              <View style={styles.threadViewport} testID="ivx-owner-chat-thread-viewport">
                {pinnedMessagesSection}
                {missingReplyMessageId ? (
                <Pressable
                  style={styles.missingReplyBanner}
                  onPress={() => setMissingReplyMessageId(null)}
                  accessibilityRole="button"
                  accessibilityLabel="Dismiss missing original message notice"
                  testID="ivx-owner-missing-reply-context"
                >
                  <MessageCircle size={14} color={Colors.warning} />
                  <Text style={styles.missingReplyText}>Original replied-to message is unavailable. The reply preview is still preserved.</Text>
                </Pressable>
              ) : null}
                <FlatList
                  ref={flatListRef}
                  data={displayedMessages}
                  keyExtractor={(item) => item.id}
                  renderItem={renderMessage}
                  style={styles.messageList}
                  contentContainerStyle={listContentContainerStyle}
                  scrollEnabled
                  nestedScrollEnabled
                  bounces
                  alwaysBounceVertical
                  overScrollMode="always"
                  showsVerticalScrollIndicator
                  scrollEventThrottle={16}
                  removeClippedSubviews={false}
                  automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
              refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={refreshing || controlRoomQuery.isFetching} onRefresh={() => {
                void messagesQuery.refetch();
                void conversationQuery.refetch();
                void roomStatusQuery.refetch();
                void controlRoomQuery.refetch();
              }} />}
              ListEmptyComponent={
                <View style={styles.emptyState} testID={searchActive ? 'ivx-owner-chat-search-empty' : 'ivx-owner-chat-empty'}>
                  <Sparkles size={28} color={Colors.primary} />
                  <Text style={styles.emptyTitle}>{searchActive ? 'No matching messages' : IVX_OWNER_AI_PROFILE.sharedRoom.emptyTitle}</Text>
                  <Text style={styles.emptyText}>{searchActive ? 'Try a different word or clear search to return to the full owner-room thread.' : resolution.emptyStateText}</Text>
                  {!searchActive ? (
                    <View style={styles.emptyTriggerHints} testID="ivx-owner-chat-worker-triggers">
                      <Text style={styles.emptyTriggerTitle}>Senior Developer Worker triggers</Text>
                      {WORKER_TRIGGER_HINTS.map((hint: string) => (
                        <Text key={hint} style={styles.emptyTriggerPhrase}>{hint}</Text>
                      ))}
                      <Text style={styles.emptyTriggerNote}>These route straight to the worker (owner approval via /confirm) — no chat narrative, no database inspection.</Text>
                    </View>
                  ) : null}
                </View>
              }
              ListFooterComponent={listFooter}
              ListFooterComponentStyle={styles.listFooterContainer}
              onContentSizeChange={(width, height) => {
                ivxDiagnostics.recordContentHeight(`h=${Math.round(height)} count=${displayedMessages.length} atBottom=${isAtBottomRef.current}`);
                // OPEN-ON-LATEST FIX: on first load or conversation switch, force
                // a scroll to the newest message once the content size is known.
                // The retry effect clears the pending state when the list actually
                // reports it is at the bottom, so we keep trying even if the first
                // scrollToEnd silently fails.
                if (initialScrollPending && displayedMessages.length > 0) {
                  scrollToBottomRobust(false);
                  return;
                }
                if (Date.now() < suppressAutoScrollUntilRef.current) {
                  return;
                }
                // Keep pinned to the bottom as new messages/streaming content
                // arrives, unless the user is intentionally reading older messages.
                if (isAtBottomRef.current) {
                  flatListRef.current?.scrollToEnd({ animated: false });
                }
              }}
              onLayout={() => {
                // OPEN-ON-LATEST FIX: re-anchor to the newest message once the
                // FlatList itself has mounted and measured. This covers the race
                // where messagesQuery data arrives before the list has laid out.
                if (initialScrollPending && displayedMessages.length > 0) {
                  scrollToBottomRobust(false);
                } else if (isAtBottomRef.current) {
                  flatListRef.current?.scrollToEnd({ animated: false });
                }
              }}
              onScrollToIndexFailed={(info) => {
                suppressAutoScrollUntilRef.current = Date.now() + 1800;
                flatListRef.current?.scrollToOffset({ offset: Math.max(0, info.averageItemLength * info.index), animated: true });
                setTimeout(() => flatListRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.35 }), 220);
              }}
              onScrollBeginDrag={() => {
                suppressAutoScrollUntilRef.current = Date.now() + 2800;
              }}
              onViewableItemsChanged={handleViewableItemsChanged}
              onScroll={handleMessageListScroll}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
                  testID="ivx-owner-chat-list"
                />
                {showScrollToLatest && displayedMessages.length > 0 ? (
                  <Pressable
                    style={styles.scrollToLatestButton}
                    onPress={handleScrollToLatest}
                    accessibilityRole="button"
                    accessibilityLabel={unreadCount > 0 ? `Scroll to latest message, ${unreadCount} unread` : 'Scroll to latest message'}
                    testID="ivx-owner-chat-scroll-to-latest"
                    hitSlop={8}
                  >
                    <ChevronDown size={22} color={Colors.black} />
                    {unreadCount > 0 ? (
                      <View style={styles.scrollToLatestBadge} testID="ivx-owner-chat-scroll-unread-badge">
                        <Text style={styles.scrollToLatestBadgeText} numberOfLines={1}>
                          {unreadCount > 99 ? '99+' : String(unreadCount)}
                        </Text>
                      </View>
                    ) : null}
                  </Pressable>
                ) : null}
              </View>
            </>
          )}
        </View>

        {primaryState !== 'room_error' ? (
          <View
            style={[
              styles.composerDock,
              {
                paddingBottom: effectiveComposerBottom,
                transform: [{ translateY: -manualKeyboardLift }],
              },
            ]}
            testID="ivx-owner-chat-composer-dock"
          >

            <View
              style={styles.composerCard}
              testID="ivx-owner-chat-composer"
              onLayout={(event) => {
                const nextHeight = event.nativeEvent.layout.height;
                if (Math.abs(nextHeight - composerHeight) > 1) {
                  setComposerHeight(nextHeight);
                  // Only re-pin to the bottom when the owner is already there.
                  // Composer growth (multi-line typing, attachment chips) must NOT
                  // yank the viewport while older messages are being read.
                  if (isAtBottomRef.current) {
                    scrollOwnerThreadToEnd(false);
                  }
                }
              }}
            >
              {/* Typing / loading indicator removed per owner request: the chat
                  UI no longer displays animated dots or "Delivering your message…"
                  banners. The underlying send/mutation state still works. */}
              {draftAttachments.length > 0 ? (
                <View style={styles.draftAttachmentRow} testID="ivx-owner-draft-attachment">
                  <View style={styles.draftAttachmentMeta}>
                    <Text style={styles.draftAttachmentName} numberOfLines={1}>
                      {`${draftAttachments.length} of ${IVX_MAX_DRAFT_ATTACHMENTS} attached`}
                    </Text>
                    <Text style={styles.draftAttachmentHint} numberOfLines={1}>
                      {draftAttachments.length === 1
                        ? (draftAttachments[0].isImage
                          ? 'Add a question or tap send to analyze.'
                          : draftAttachments[0].isVideo
                            ? 'Tap send to analyze this video.'
                            : 'Add instructions or tap send to analyze.')
                        : 'Tap send and IVX will analyze every file in this batch.'}
                    </Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.draftAttachmentClose, pressed ? { opacity: 0.6 } : null]}
                    onPress={handleClearDraftAttachment}
                    accessibilityRole="button"
                    accessibilityLabel="Remove all attached files"
                    testID="ivx-owner-draft-attachment-clear"
                    hitSlop={8}
                  >
                    <X size={14} color={Colors.text} />
                  </Pressable>
                </View>
              ) : null}
              {draftAttachments.length > 0 ? (
                <FlatList
                  data={draftAttachments}
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyExtractor={(item, index) => `${item.upload.name}-${index}`}
                  contentContainerStyle={styles.draftAttachmentList}
                  testID="ivx-owner-draft-attachment-list"
                  renderItem={({ item, index }) => (
                    <View style={styles.draftAttachmentTile} testID={`ivx-owner-draft-attachment-tile-${index}`}>
                      {item.isImage && item.upload.uri ? (
                        <Image
                          source={{ uri: item.upload.uri }}
                          style={styles.draftAttachmentThumb}
                          resizeMode="cover"
                          accessibilityLabel={`Attached image ${index + 1}`}
                        />
                      ) : (
                        <View style={[styles.draftAttachmentThumb, styles.draftAttachmentFileIcon]}>
                          <Paperclip size={18} color={Colors.primary} />
                        </View>
                      )}
                      <Pressable
                        style={({ pressed }) => [styles.draftAttachmentTileRemove, pressed ? { opacity: 0.6 } : null]}
                        onPress={() => handleRemoveDraftAttachment(index)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove file ${index + 1}`}
                        testID={`ivx-owner-draft-attachment-remove-${index}`}
                        hitSlop={6}
                      >
                        <X size={10} color={Colors.text} />
                      </Pressable>
                    </View>
                  )}
                />
              ) : null}
              {selectedReplyContext ? (
                <View style={styles.replyComposerPreview} testID="ivx-owner-reply-preview">
                  <View style={styles.replyComposerAccent} />
                  <View style={styles.replyComposerCopy}>
                    <Text style={styles.replyComposerLabel} numberOfLines={1}>{`Replying to ${selectedReplyContext.senderLabel}`}</Text>
                    <Text style={styles.replyComposerText} numberOfLines={2}>{selectedReplyContext.previewText}</Text>
                  </View>
                  <Pressable
                    style={({ pressed }) => [styles.replyComposerClose, pressed ? { opacity: 0.72 } : null]}
                    onPress={() => setSelectedReplyContext(null)}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel reply"
                    testID="ivx-owner-reply-cancel"
                  >
                    <X size={14} color={Colors.textTertiary} />
                  </Pressable>
                </View>
              ) : null}
              <View
                style={[styles.chatLiveWorkBar, activeLiveWorkTask ? styles.chatLiveWorkBarActive : null]}
                testID="ivx-chat-live-work-bar"
              >
                <Pressable
                  style={styles.chatLiveWorkMain}
                  onPress={() => handleOpenLiveWork()}
                  accessibilityRole="button"
                  accessibilityLabel="Open Live Work monitor"
                  testID="ivx-chat-open-live-work"
                  hitSlop={6}
                >
                  <View style={[styles.chatLiveWorkDot, activeLiveWorkTask ? styles.chatLiveWorkDotActive : null]} />
                  <View style={styles.chatLiveWorkCopy}>
                    <Text style={styles.chatLiveWorkTitle} numberOfLines={1}>
                      {'Live Work'}
                    </Text>
                    <Text style={styles.chatLiveWorkSub} numberOfLines={1}>
                      {'Watch IVX execute tasks in real time'}
                    </Text>
                  </View>
                  <Terminal size={16} color={Colors.primary} />
                </Pressable>
                {/* Live-work actions hidden when idle to keep the composer clean. */}
              {activeLiveWorkTask ? (
                <View style={styles.chatLiveWorkActions}>
                  <Pressable style={styles.chatLiveWorkAction} onPress={() => handleOpenLiveWork()} testID="ivx-chat-live-work-view" hitSlop={6}>
                    <Activity size={13} color={Colors.text} />
                    <Text style={styles.chatLiveWorkActionText}>View</Text>
                  </Pressable>
                  <Pressable style={styles.chatLiveWorkAction} onPress={() => setWatchdogDrawerVisible(true)} testID="ivx-chat-live-work-watchdog" hitSlop={6}>
                    <ShieldCheck size={13} color={Colors.text} />
                    <Text style={styles.chatLiveWorkActionText}>Watchdog</Text>
                  </Pressable>
                  <Pressable style={styles.chatLiveWorkAction} onPress={() => { void handleCopyTaskLog(); }} testID="ivx-chat-live-work-copy" hitSlop={6}>
                    <Text style={styles.chatLiveWorkActionText}>Copy log</Text>
                  </Pressable>
                  <Pressable style={styles.chatLiveWorkAction} onPress={() => setActiveLiveWorkTask(null)} testID="ivx-chat-live-work-dismiss" hitSlop={6}>
                    <X size={13} color={Colors.textTertiary} />
                    <Text style={styles.chatLiveWorkActionText}>Dismiss</Text>
                  </Pressable>
                </View>
              ) : null}
              </View>
              {ownerAIAuthState !== 'SIGNED_IN_OWNER' && ownerAIAuthState !== 'AUTH_INITIALIZING' ? (
                <Pressable
                  style={styles.ownerSignInBanner}
                  onPress={() => router.push('/owner-login' as never)}
                  testID="ivx-owner-sign-in-prompt"
                >
                  <Lock size={14} color={Colors.error} />
                  <Text style={styles.ownerSignInBannerText}>
                    {ownerAIAuthState === 'SIGNED_IN_MEMBER'
                      ? 'This account is not the IVX owner. Sign in with the owner account.'
                      : 'Sign in as the IVX owner to use Owner AI.'}
                  </Text>
                </Pressable>
              ) : null}
              <View style={styles.templateRow} testID="ivx-owner-chat-template-row">
                {OWNER_PROMPT_TEMPLATES.map((template) => (
                  <Pressable
                    key={template.id}
                    style={({ pressed }) => [styles.templateChip, pressed ? { opacity: 0.72 } : null]}
                    onPress={() => handleApplyPromptTemplate(template)}
                    accessibilityRole="button"
                    accessibilityLabel={`Apply ${template.label} prompt template`}
                    testID={template.testID}
                  >
                    <Text style={styles.templateChipText}>{template.label}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.composerPrimaryRow}>
                <Pressable
                  style={[styles.iconButton, attachmentDisabled ? styles.actionButtonDisabled : null]}
                  onPress={() => void handlePickFile()}
                  disabled={attachmentDisabled}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Attach a file"
                  testID="ivx-owner-chat-attach"
                >
                  <Paperclip size={18} color={attachmentDisabled ? '#7C8797' : Colors.primary} />
                </Pressable>
                <Pressable
                  style={[
                    styles.iconButton,
                    isRecordingVoice ? styles.voiceButtonActive : null,
                    (isTranscribingVoice || sendMessageMutation.isPending || attachmentMutation.isPending || isPickingFile) ? styles.actionButtonDisabled : null,
                  ]}
                  onPress={() => { void handleVoicePress(); }}
                  disabled={isTranscribingVoice || sendMessageMutation.isPending || attachmentMutation.isPending || isPickingFile}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={isRecordingVoice ? 'Stop voice recording' : 'Start voice recording'}
                  testID="ivx-owner-chat-voice"
                >
                  {isRecordingVoice ? <Square size={17} color={Colors.error} /> : <Mic size={18} color={isTranscribingVoice ? '#7C8797' : Colors.primary} />}
                </Pressable>
                <TextInput
                  ref={composerInputRef}
                  style={[styles.composerInput, { height: composerInputHeight }]}
                  value={composerValue}
                  onChangeText={handleComposerChange}
                  editable={!attachmentMutation.isPending && !isPickingFile && !isRecordingVoice && !isTranscribingVoice}
                  placeholder={composerPlaceholder}
                  placeholderTextColor="#B8C0CC"
                  multiline
                  textAlignVertical="top"
                  returnKeyType="send"
                  blurOnSubmit={false}
                  scrollEnabled={composerInputHeight >= 112}
                  onContentSizeChange={(event) => {
                    const nextHeight = Math.min(Math.max(event.nativeEvent.contentSize.height + 4, 44), 112);
                    if (Math.abs(nextHeight - composerInputHeight) > 1) {
                      setComposerInputHeight(nextHeight);
                    }
                    scrollOwnerThreadToEnd(false);
                  }}
                  onFocus={() => {
                    scrollOwnerThreadToEnd(true);
                    setTimeout(() => scrollOwnerThreadToEnd(true), Platform.OS === 'android' ? 420 : 220);
                    if (Platform.OS === 'web') {
                      const el = (composerInputRef.current as unknown as { _inputRef?: { current?: HTMLElement } } | null)?._inputRef?.current ?? null;
                      scrollInputIntoView(el);
                    }
                  }}
                  onSubmitEditing={(event) => {
                    const submittedText = normalizeComposerText(event?.nativeEvent?.text, composerValueRef.current);
                    handleSend(submittedText);
                  }}
                  testID="ivx-owner-chat-input"
                />
                <Pressable
                  style={[styles.sendIconButton, (sendingDisabled || isBusy) ? styles.actionButtonDisabled : null]}
                  onPress={() => {
                    handleSend();
                  }}
                  disabled={sendingDisabled || isBusy}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Send message"
                  testID="ivx-owner-chat-send"
                >
                  <Send size={18} color={sendingDisabled ? '#7C8797' : Colors.black} />
                </Pressable>
              </View>
              <View style={styles.composerSecondaryRow}>
                <Text numberOfLines={1} style={styles.composerHintText}>
                  {composerStatusMessage}
                </Text>
                <Pressable
                  style={[styles.aiButton, (sendingDisabled || isBusy) ? styles.actionButtonDisabled : null]}
                  onPress={() => {
                    handleAskAI();
                  }}
                  disabled={sendingDisabled || isBusy}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Ask IVX Owner AI"
                  testID="ivx-owner-chat-ai"
                >
                  <Sparkles size={14} color={Colors.text} />
                  <Text style={styles.aiButtonText}>AI</Text>
                </Pressable>
              </View>
              {/* Owner session gate removed — composer is always available. */}
            </View>
          </View>
        ) : null}
      </KeyboardAvoidingView>
      <IVXWatchdogDrawer visible={watchdogDrawerVisible} onClose={() => setWatchdogDrawerVisible(false)} />
      {liveWorkVisible ? (
        <View style={styles.liveWorkOverlay} testID="ivx-live-work-overlay" pointerEvents="box-none">
          <View style={styles.liveWorkSheet} pointerEvents="auto">
            <View style={styles.liveWorkHeader}>
              <Text style={styles.liveWorkTitle}>Senior Developer — Advanced Execution</Text>
              <Pressable
                onPress={() => setLiveWorkVisible(false)}
                accessibilityRole="button"
                accessibilityLabel="Close live work panel"
                testID="ivx-live-work-close"
                hitSlop={10}
              >
                <X size={18} color={Colors.text} />
              </Pressable>
            </View>
            <IVXAdvancedExecutionMode />
          </View>
        </View>
      ) : null}
      <Pressable
        onPress={() => setLiveWorkVisible((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel="Toggle live work visibility"
        testID="ivx-live-work-toggle"
        style={styles.liveWorkFab}
        hitSlop={6}
      >
        <Terminal size={16} color={Colors.text} />
      </Pressable>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    flex: 1,
    minHeight: 0,
    paddingTop: 0,
  },
  developerToolsScroll: {
    flex: 1,
    minHeight: 0,
  },
  developerToolsScrollContent: {
    paddingTop: 4,
  },
  androidStatusSpacer: {
    backgroundColor: Colors.background,
  },
  devBanner: {
    marginHorizontal: 8,
    marginBottom: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.28)',
    backgroundColor: 'rgba(59,130,246,0.10)',
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 84,
    justifyContent: 'center' as const,
  },
  devBannerText: {
    color: Colors.info,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700' as const,
  },
  degradedBanner: {
    marginHorizontal: 8,
    marginBottom: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.32)',
    backgroundColor: 'rgba(245,158,11,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 84,
    justifyContent: 'center' as const,
  },
  degradedBannerText: {
    color: Colors.warning,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800' as const,
  },
  blockedBanner: {
    marginHorizontal: 8,
    marginBottom: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.32)',
    backgroundColor: 'rgba(239,68,68,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 84,
    justifyContent: 'center' as const,
  },
  blockedBannerText: {
    color: Colors.error,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '800' as const,
  },
  ownerAuthFailureBanner: {
    marginHorizontal: 8,
    marginBottom: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.32)',
    backgroundColor: 'rgba(239,68,68,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 6,
  },
  ownerAuthFailureBannerHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6,
  },
  refreshOwnerSessionButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 7,
    alignSelf: 'flex-start' as const,
    backgroundColor: Colors.primary,
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginTop: 2,
  },
  refreshOwnerSessionButtonText: {
    color: Colors.black,
    fontSize: 12.5,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  ownerAuthFailureBannerTitle: {
    color: Colors.error,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  ownerAuthFailureBannerText: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  ownerAuthFailureBannerAction: {
    color: Colors.error,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  ownerSignInBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.32)',
    backgroundColor: 'rgba(239,68,68,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  ownerSignInBannerText: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
    flex: 1,
  },
  topSearchRail: {
    paddingHorizontal: 8,
    paddingTop: 2,
    paddingBottom: 8,
    backgroundColor: Colors.background,
  },
  brandRow: {
    minHeight: 46,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingLeft: 6,
  },
  brandLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    flexShrink: 1,
  },
  brandLeftCompact: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  brandTitleCompact: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
    letterSpacing: 0.5,
  },
  brandInlineSearch: {
    flex: 1,
    minHeight: 40,
    marginHorizontal: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0F1521',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    paddingHorizontal: 12,
  },
  brandInlineSearchPlaceholder: {
    flex: 1,
    color: '#7C8797',
    fontSize: 14,
    fontWeight: '500' as const,
  },
  brandMark: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  brandTextWrap: {
    flexShrink: 1,
  },
  brandTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  brandSubtitle: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const,
    marginTop: 1,
  },
  brandActions: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
  },
  brandIconButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0F1521',
  },
  searchBarWrap: {
    minHeight: 46,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0F1521',
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14,
    gap: 10,
  },
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    minHeight: 40,
    paddingVertical: 7,
  },
  searchClearButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  searchResultText: {
    marginHorizontal: 20,
    marginBottom: 4,
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  threadViewport: {
    flex: 1,
    minHeight: 0,
    overflow: 'hidden',
  },
  scrollToLatestButton: {
    position: 'absolute' as const,
    right: 16,
    bottom: 16,
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.32,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 50,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  scrollToLatestBadge: {
    position: 'absolute' as const,
    top: -4,
    right: -4,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    paddingHorizontal: 5,
    backgroundColor: Colors.error,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    borderWidth: 2,
    borderColor: Colors.background,
  },
  scrollToLatestBadgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800' as const,
  },
  pinnedSection: {
    marginHorizontal: 14,
    marginBottom: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.24)',
    backgroundColor: 'rgba(246,200,95,0.08)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 9,
  },
  pinnedSectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 7,
  },
  pinnedSectionTitle: {
    flex: 1,
    color: '#F6C85F',
    fontSize: 12,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
    textTransform: 'uppercase',
  },
  pinnedSectionCount: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '800' as const,
  },
  pinnedMessageList: {
    gap: 8,
  },
  pinnedMessageCard: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    borderRadius: 14,
    backgroundColor: 'rgba(17,23,34,0.92)',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  pinnedMessageTextStack: {
    flex: 1,
    gap: 2,
  },
  pinnedMessageSender: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  pinnedMessageText: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  pinnedMessageMeta: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  pinnedUnpinButton: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 5,
    backgroundColor: 'rgba(246,200,95,0.12)',
  },
  pinnedUnpinText: {
    color: '#F6C85F',
    fontSize: 11,
    fontWeight: '800' as const,
  },
  productionGuardCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.24)',
    backgroundColor: 'rgba(239,68,68,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 12,
  },
  productionGuardEyebrow: {
    color: Colors.error,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  productionGuardTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
  },
  productionGuardBody: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  productionGuardList: {
    gap: 10,
  },
  productionGuardItem: {
    gap: 4,
    padding: 12,
    borderRadius: 14,
    backgroundColor: 'rgba(9,11,15,0.24)',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.16)',
  },
  productionGuardLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  productionGuardValue: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '700' as const,
  },
  developerToolsCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: '#08111f',
    borderWidth: 1,
    borderColor: 'rgba(56,189,248,0.28)',
    gap: 14,
  },
  developerToolsHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  developerToolsIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.info,
  },
  developerToolsCopy: {
    flex: 1,
    gap: 3,
  },
  developerToolsEyebrow: {
    color: Colors.info,
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  developerToolsTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  controlRoomToggle: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 10,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 5,
    backgroundColor: Colors.primary,
  },
  controlRoomToggleText: {
    color: Colors.black,
    fontSize: 11,
    fontWeight: '800' as const,
  },
  controlRoomToggleTextActive: {
    color: Colors.black,
  },
  controlRoomCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: '#071017',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.22)',
    gap: 14,
  },
  controlRoomHeaderRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    justifyContent: 'space-between' as const,
    gap: 12,
  },
  controlRoomHeaderCopy: {
    flex: 1,
    gap: 4,
  },
  controlRoomActions: {
    alignItems: 'flex-end' as const,
    gap: 8,
  },
  controlRoomTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '900' as const,
  },
  controlRoomSubtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  controlRoomError: {
    color: Colors.error,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '700' as const,
  },
  controlRoomList: {
    gap: 10,
  },
  controlRoomRow: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: 10,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: 'rgba(255,255,255,0.035)',
  },
  controlRoomIndex: {
    width: 24,
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '900' as const,
    lineHeight: 18,
  },
  controlRoomRowCopy: {
    flex: 1,
    gap: 6,
  },
  controlRoomRowTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    gap: 10,
  },
  controlRoomLabel: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  controlRoomStatusBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  controlRoomStatusBadgePass: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.24)',
  },
  controlRoomStatusBadgeWarn: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: 'rgba(245,158,11,0.24)',
  },
  controlRoomStatusBadgeError: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.24)',
  },
  controlRoomStatusBadgePending: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderColor: 'rgba(59,130,246,0.24)',
  },
  controlRoomStatusText: {
    fontSize: 10,
    fontWeight: '900' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
  },
  controlRoomStatusTextPass: {
    color: Colors.success,
  },
  controlRoomStatusTextWarn: {
    color: Colors.warning,
  },
  controlRoomStatusTextError: {
    color: Colors.error,
  },
  controlRoomStatusTextPending: {
    color: Colors.info,
  },
  controlRoomDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  controlRoomMissing: {
    color: Colors.warning,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700' as const,
  },
  developerStatusGrid: {
    gap: 10,
  },
  developerStatusTile: {
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    gap: 5,
  },
  developerStatusTilePass: {
    backgroundColor: 'rgba(34,197,94,0.10)',
    borderColor: 'rgba(34,197,94,0.24)',
  },
  developerStatusTileWarn: {
    backgroundColor: 'rgba(245,158,11,0.10)',
    borderColor: 'rgba(245,158,11,0.24)',
  },
  developerStatusTileError: {
    backgroundColor: 'rgba(239,68,68,0.10)',
    borderColor: 'rgba(239,68,68,0.24)',
  },
  developerStatusTilePending: {
    backgroundColor: 'rgba(59,130,246,0.10)',
    borderColor: 'rgba(59,130,246,0.24)',
  },
  developerStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 99,
  },
  developerStatusDotPass: {
    backgroundColor: Colors.success,
  },
  developerStatusDotWarn: {
    backgroundColor: Colors.warning,
  },
  developerStatusDotError: {
    backgroundColor: Colors.error,
  },
  developerStatusDotPending: {
    backgroundColor: Colors.info,
  },
  developerStatusLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  developerStatusValue: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  developerToolsFootnote: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  sendBranchProofRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    marginHorizontal: 12,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    backgroundColor: 'rgba(255,255,255,0.03)',
    gap: 6,
  },
  sendBranchProofLabel: {
    color: 'rgba(255,255,255,0.36)',
    fontSize: 9,
    fontWeight: '700' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.4,
  },
  sendBranchProofValue: {
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.3,
  },
  sendBranchProofValuePass: {
    color: '#34D399',
  },
  sendBranchProofValueWarn: {
    color: '#FBBF24',
  },
  sendBranchProofValueDegraded: {
    color: '#F87171',
  },
  sendBranchProofValuePending: {
    color: 'rgba(255,255,255,0.40)',
  },
  sendBranchProofContext: {
    flex: 1,
    color: 'rgba(255,255,255,0.30)',
    fontSize: 9,
    fontWeight: '600' as const,
    textAlign: 'right' as const,
  },
  providerProofCard: {
    marginHorizontal: 8,
    marginBottom: 3,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minHeight: 0,
    gap: 2,
  },
  providerProofCardPass: {
    borderColor: 'rgba(34,197,94,0.24)',
    backgroundColor: 'rgba(34,197,94,0.08)',
  },
  providerProofCardBlocked: {
    borderColor: 'rgba(239,68,68,0.24)',
    backgroundColor: 'rgba(239,68,68,0.08)',
  },
  providerProofCardPending: {
    borderColor: 'rgba(59,130,246,0.24)',
    backgroundColor: 'rgba(59,130,246,0.08)',
  },
  providerProofCardWarn: {
    borderColor: 'rgba(245,158,11,0.24)',
    backgroundColor: 'rgba(245,158,11,0.08)',
  },
  providerProofHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  providerProofCopy: {
    flex: 1,
    gap: 3,
  },
  providerProofTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  detailsToggle: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.backgroundSecondary,
  },
  detailsToggleText: {
    color: '#D0D0D0',
    fontSize: 8,
    fontWeight: '700' as const,
  },
  providerProofDetail: {
    color: '#E8EDF5',
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '600' as const,
  },
  qaCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  qaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  qaEyebrow: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  qaTitle: {
    marginTop: 6,
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800' as const,
  },
  qaBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  qaBadgePass: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.24)',
  },
  qaBadgeWarn: {
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderColor: 'rgba(245,158,11,0.24)',
  },
  qaBadgeBlocked: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.24)',
  },
  qaBadgePending: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderColor: 'rgba(59,130,246,0.24)',
  },
  qaBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  qaBadgeTextPass: {
    color: Colors.success,
  },
  qaBadgeTextWarn: {
    color: Colors.warning,
  },
  qaBadgeTextBlocked: {
    color: Colors.error,
  },
  qaBadgeTextPending: {
    color: Colors.info,
  },
  qaChecklist: {
    gap: 12,
  },
  qaItemRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  qaDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 5,
  },
  qaDotPass: {
    backgroundColor: Colors.success,
  },
  qaDotWarn: {
    backgroundColor: Colors.warning,
  },
  qaCopy: {
    flex: 1,
    gap: 4,
  },
  qaItemLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  qaItemDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  proofRail: {
    gap: 10,
  },
  proofRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  proofDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    marginTop: 5,
  },
  proofDotPass: {
    backgroundColor: Colors.success,
  },
  proofDotWarn: {
    backgroundColor: Colors.warning,
  },
  proofDotBlocked: {
    backgroundColor: Colors.error,
  },
  proofDotPending: {
    backgroundColor: Colors.info,
  },
  proofCopy: {
    flex: 1,
    gap: 4,
  },
  proofTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  proofDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  proofMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  qaScopeText: {
    color: Colors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
  },
  functionalitySummary: {
    alignItems: 'flex-end',
    gap: 4,
  },
  functionalitySummaryText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  functionalityLedgerList: {
    gap: 10,
  },
  functionalityLedgerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  functionalityLedgerIndex: {
    width: 28,
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '800' as const,
    lineHeight: 18,
  },
  functionalityLedgerCopy: {
    flex: 1,
    gap: 4,
  },
  functionalityLedgerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  functionalityLedgerTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  functionalityLedgerBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  functionalityLedgerBadgeLive: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.24)',
  },
  functionalityLedgerBadgePass: {
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderColor: 'rgba(59,130,246,0.24)',
  },
  functionalityLedgerBadgeFail: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.24)',
  },
  functionalityLedgerBadgeText: {
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  functionalityLedgerBadgeTextLive: {
    color: Colors.success,
  },
  functionalityLedgerBadgeTextPass: {
    color: Colors.info,
  },
  functionalityLedgerBadgeTextFail: {
    color: Colors.error,
  },
  functionalityLedgerDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  functionalityLedgerEvidence: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  backendAuditCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.24)',
    backgroundColor: 'rgba(59,130,246,0.08)',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 10,
  },
  backendAuditEyebrow: {
    color: Colors.info,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  backendAuditTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  backendAuditBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  backendAuditBadgePass: {
    backgroundColor: 'rgba(34,197,94,0.12)',
    borderColor: 'rgba(34,197,94,0.24)',
  },
  backendAuditBadgeBlocked: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.24)',
  },
  backendAuditBadgeText: {
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  backendAuditBadgeTextPass: {
    color: Colors.success,
  },
  backendAuditBadgeTextBlocked: {
    color: Colors.error,
  },
  backendAuditRow: {
    gap: 2,
  },
  backendAuditLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  backendAuditValue: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  backendAuditBody: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  backendAuditFootnote: {
    color: Colors.info,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  backendAuditList: {
    gap: 6,
    marginTop: 2,
  },
  backendAuditListItem: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  runtimeProofBanner: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.24)',
    backgroundColor: 'rgba(9,11,15,0.26)',
    paddingHorizontal: 12,
    paddingVertical: 12,
    gap: 4,
  },
  runtimeProofBannerTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  runtimeProofBannerDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  graphCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  graphHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  graphEyebrow: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  graphTitle: {
    marginTop: 6,
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const,
  },
  graphActionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  graphActionButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.backgroundTertiary,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  graphActionButtonText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  graphNodeList: {
    gap: 10,
  },
  graphNodeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  graphNodeDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
  },
  graphNodeDotPass: {
    backgroundColor: Colors.success,
  },
  graphNodeDotWarn: {
    backgroundColor: Colors.warning,
  },
  graphNodeDotBlocked: {
    backgroundColor: Colors.error,
  },
  graphNodeDotPending: {
    backgroundColor: Colors.info,
  },
  graphNodeCopy: {
    flex: 1,
    gap: 3,
  },
  graphNodeTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  graphNodeMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  graphRiskList: {
    gap: 10,
  },
  graphRiskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  graphRiskCopy: {
    flex: 1,
    gap: 4,
  },
  graphRiskTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    textTransform: 'capitalize',
  },
  graphRiskMeta: {
    color: Colors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  graphRiskValue: {
    color: Colors.warning,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  graphProofList: {
    gap: 10,
  },
  graphProofRow: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.backgroundTertiary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 4,
  },
  graphProofClaim: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  graphProofMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  errorState: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 24,
    padding: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10,
  },
  errorTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
  },
  errorText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
  },
  retryButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  retryButtonText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '700' as const,
  },
  messageList: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    flexGrow: 1,
    paddingHorizontal: 10,
    paddingTop: 0,
    gap: 3,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  emptyState: {
    alignItems: 'center',
    gap: 10,
    padding: 20,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center',
  },
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  emptyTriggerHints: {
    alignSelf: 'stretch',
    marginTop: 8,
    padding: 14,
    borderRadius: 14,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 6,
  },
  emptyTriggerTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
    marginBottom: 2,
  },
  emptyTriggerPhrase: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600' as const,
  },
  emptyTriggerNote: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 4,
  },
  dateSeparatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    marginTop: 12,
    marginBottom: 10,
  },
  dateSeparatorLine: {
    flex: 1,
    height: 1,
    backgroundColor: Colors.surfaceBorder,
  },
  dateSeparatorText: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  messageRow: {
    flexDirection: 'row',
    marginBottom: 2,
  },
  messageRowOwn: {
    justifyContent: 'flex-end',
  },
  messageRowOther: {
    justifyContent: 'flex-start',
  },
  messageRowHighlighted: {
    borderRadius: 24,
    backgroundColor: 'rgba(246,200,95,0.24)',
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.62)',
    shadowColor: '#F6C85F',
    shadowOpacity: 0.34,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  missingReplyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    backgroundColor: 'rgba(246,200,95,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.28)',
  },
  missingReplyText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '700' as const,
    lineHeight: 16,
  },
  messageBubble: {
    maxWidth: '86%',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
  },
  messageBubbleOwn: {
    backgroundColor: Colors.primary,
  },
  messageBubbleOther: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  messageLabel: {
    color: Colors.background,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  messageLabelOther: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const,
  },
  assistantLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  messageText: {
    color: Colors.background,
    fontSize: 15,
    lineHeight: 22,
  },
  messageTextOther: {
    color: Colors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  messageMeta: {
    color: 'rgba(0,0,0,0.65)',
    fontSize: 11,
    fontWeight: '600' as const,
  },
  messageMetaOther: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  systemMessageRow: {
    alignItems: 'center',
    marginBottom: 12,
  },
  systemBubble: {
    maxWidth: '90%',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
    backgroundColor: 'rgba(59,130,246,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.18)',
  },
  systemLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  systemLabel: {
    color: Colors.info,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  systemText: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  commandCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.backgroundTertiary,
    overflow: 'hidden',
  },
  commandRow: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  commandLabel: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  commandValue: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 18,
  },
  systemMeta: {
    color: Colors.textTertiary,
    fontSize: 10,
    fontWeight: '600' as const,
  },
  approveRunButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.primary,
  },
  approveRunButtonText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '800' as const,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.12)',
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  attachmentText: {
    color: Colors.background,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  attachmentTextOther: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const,
  },
  liveWorkOverlay: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end' as const,
  },
  liveWorkSheet: {
    maxHeight: '85%' as const,
    backgroundColor: Colors.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: 24,
  },
  liveWorkHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  liveWorkTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700' as const,
  },
  chatLiveWorkBar: {
    marginHorizontal: 8,
    marginBottom: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: 'rgba(255,255,255,0.04)',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  chatLiveWorkBarActive: {
    borderColor: 'rgba(34,197,94,0.45)',
    backgroundColor: 'rgba(34,197,94,0.10)',
  },
  chatLiveWorkMain: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
  },
  chatLiveWorkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.textTertiary,
  },
  chatLiveWorkDotActive: {
    backgroundColor: '#00C48C',
  },
  chatLiveWorkCopy: {
    flex: 1,
    minWidth: 0,
  },
  chatLiveWorkTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  chatLiveWorkSub: {
    color: Colors.textSecondary,
    fontSize: 11,
    marginTop: 1,
  },
  chatLiveWorkActions: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 6,
  },
  chatLiveWorkAction: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chatLiveWorkActionText: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '600' as const,
  },
  liveWorkFab: {
    position: 'absolute' as const,
    right: 12,
    bottom: 96,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(34,197,94,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.45)',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 100,
  },
  typingIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: 'rgba(246,200,95,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.28)',
    marginBottom: 4,
  },
  typingDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#F6C85F',
    opacity: 0.55,
  },
  typingDotMid: {
    opacity: 0.85,
  },
  typingText: {
    flex: 1,
    color: '#F6C85F',
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
    marginLeft: 4,
  },
  draftAttachmentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.30)',
    backgroundColor: 'rgba(246,200,95,0.06)',
    marginBottom: 4,
  },
  draftAttachmentThumb: {
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#12161C',
    overflow: 'hidden',
  },
  draftAttachmentFileIcon: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.28)',
  },
  draftAttachmentMeta: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  draftAttachmentName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  draftAttachmentHint: {
    color: '#B8C0CC',
    fontSize: 10,
    fontWeight: '600' as const,
  },
  draftAttachmentClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  draftAttachmentList: {
    gap: 8,
    paddingHorizontal: 2,
    paddingVertical: 4,
  },
  draftAttachmentTile: {
    width: 56,
    height: 56,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#12161C',
    position: 'relative' as const,
  },
  draftAttachmentTileRemove: {
    position: 'absolute' as const,
    top: 2,
    right: 2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerDock: {
    paddingHorizontal: 10,
    paddingTop: 6,
    backgroundColor: Colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
    zIndex: 20,
    elevation: 20,
  },
  composerCard: {
    paddingTop: 8,
    paddingHorizontal: 10,
    paddingBottom: 8,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 4,
    shadowColor: '#000000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: -3 },
    elevation: 6,
  },
  replyComposerPreview: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.24)',
    backgroundColor: 'rgba(246,200,95,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  replyComposerAccent: {
    width: 3,
    alignSelf: 'stretch',
    borderRadius: 999,
    backgroundColor: '#F6C85F',
  },
  replyComposerCopy: {
    flex: 1,
    gap: 2,
  },
  replyComposerLabel: {
    color: '#F6C85F',
    fontSize: 11,
    fontWeight: '900' as const,
    letterSpacing: 0.2,
  },
  replyComposerText: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  replyComposerClose: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  templateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 4,
  },
  templateChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(246,200,95,0.26)',
    backgroundColor: 'rgba(246,200,95,0.08)',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  templateChipText: {
    color: '#F6C85F',
    fontSize: 10,
    fontWeight: '800' as const,
    letterSpacing: 0.2,
  },
  composerPrimaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  composerInput: {
    flex: 1,
    minHeight: 46,
    maxHeight: 112,
    color: '#F8FAFC',
    fontSize: 14,
    lineHeight: 19,
    textAlignVertical: 'top',
    backgroundColor: '#12161C',
    borderRadius: 13,
    paddingHorizontal: 11,
    paddingTop: 10,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: '#46505E',
    minWidth: 0,
    ...(Platform.OS === 'web'
      ? ({
          // @ts-ignore: web-only CSS properties for Samsung keyboard fix
          touchAction: 'manipulation',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          outlineStyle: 'none',
        } as any)
      : {}),
  },
  composerSecondaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 26,
  },
  composerHintText: {
    flex: 1,
    color: '#D2DAE6',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600' as const,
  },
  iconButton: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    flexShrink: 0,
  },
  voiceButtonActive: {
    borderColor: 'rgba(239,68,68,0.42)',
    backgroundColor: 'rgba(239,68,68,0.14)',
  },
  sendIconButton: {
    width: 48,
    height: 48,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primary,
    borderWidth: 1,
    borderColor: Colors.primary,
    flexShrink: 0,
    alignSelf: 'flex-end',
  },
  aiButton: {
    minWidth: 58,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 4,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 10,
    flexShrink: 0,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  aiButtonText: {
    color: Colors.text,
    fontSize: 9,
    fontWeight: '700' as const,
  },
  ownerSessionGate: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: 'rgba(255, 215, 0, 0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.32)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginTop: 8,
  },
  ownerSessionGateText: {
    flex: 1,
    color: Colors.text,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  ownerSessionGateButton: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexShrink: 0,
  },
  ownerSessionGateButtonText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '800' as const,
  },
  listFooterSpacer: {
    height: 2,
  },
  listFooterContainer: {
    paddingTop: 4,
  },
});
