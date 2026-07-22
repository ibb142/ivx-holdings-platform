import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  KeyboardEvent,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronUp, Radio, RefreshCw } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Colors from '@/constants/colors';
import { IVX_OWNER_AI_PROFILE } from '@/constants/ivx-owner-ai';
import { getIVXOwnerAIConfigAudit, getIVXOwnerAuthContext } from '@/lib/ivx-supabase-client';
import { isOpenAccessModeEnabled } from '@/lib/open-access';
import {
  assertCleanOwnerAIResponseText,
  getIVXOwnerAIErrorDiagnostics,
  getLastIVXOwnerAIRuntimeProof,
} from '@/src/modules/ivx-owner-ai/services/ivxAIRequestService';
import {
  getActiveRuntimeSource,
  getRuntimeModeSummary,
  getRuntimeProofTone,
  getRuntimeSourceLabel,
  getRuntimeStatusCopy,
  hasActiveStreamingState,
  hasRuntimeFailure,
  isAcceptableAssistantSource,
  isExpectedAssistantSource,
  isPendingRequestState,
  normalizeRuntimeSource,
  shouldPreserveRequestScopedRuntime,
  shouldShowFallbackUI,
  shouldShowRuntimeDebugDetails,
  type ChatRuntimeProofTone,
} from '@/src/modules/chat/chatRuntimeState';
import { Composer } from '../components/Composer';
import { MessageBubble } from '../components/MessageBubble';
import { useMessageReactions } from '../hooks/useMessageReactions';
import { PresenceBar } from '../components/PresenceBar';
import { RoomConnectionBanner } from '../components/RoomConnectionBanner';
import { TypingIndicator } from '../components/TypingIndicator';
import { getChatMessagesQueryKey, useChatMessages } from '../hooks/useChatMessages';
import { useRoomPresence } from '../hooks/useRoomPresence';
import { useTypingIndicator } from '../hooks/useTypingIndicator';
import {
  createCommandResponseMessage,
  parseOwnerCommand,
  requestAIReply,
} from '../services/aiReplyService';
import { chatService } from '../services/chatService';
import { resolveChatActorId, resolveChatConversationId } from '../services/chatRooms';
import { redactUserFacingChatSecrets, sanitizeUserFacingChatText } from '../services/visibleTextSanitizer';
import { analyzeFile } from '@/src/modules/ivx-owner-ai/services/ivxMultimodalService';
import { ivxOwnerMemoryService } from '@/src/modules/ivx-owner-ai/services/ivxOwnerMemoryService';
import { shouldSuppressOwnerAIBackendNotice } from '@/src/modules/ivx-owner-ai/services/ownerAIBackendNotice';
import { bootstrapRoomByFriendlySlug, ensureParticipant, markConversationAsRead } from '../services/ivxChat';
import { resolveRoomCapabilityState } from '../services/roomCapabilityResolver';
import {
  getChatStorageStatus,
  getCurrentChatRoomStatus,
  subscribeToChatRoomStatus,
  subscribeToChatStorageMode,
  type ChatStorageStatus,
} from '../services/supabaseChatProvider';
import {
  type RoomSyncPhase,
  generateSendCorrelationId,
  getRoomStateSnapshot,
  initRoomStateManager,
  requestRoomRedetection,
  subscribeToRoomState,
} from '../services/roomStateManager';
import type {
  CapabilityState,
  ChatFileType,
  ChatMessage,
  ChatRoomRuntimeSignals,
  ChatRoomStatus,
  SendMessageInput,
  UploadableFile,
} from '../types/chat';

type ChatAuditCard = {
  id: string;
  eyebrow?: string;
  title: string;
  description: string;
  bullets: string[];
};

type ChatRoomMeta = {
  badgeText?: string;
  title?: string;
  subtitle?: string;
  capabilityPills?: string[];
  runtimeSignals?: ChatRoomRuntimeSignals;
  emptyTitle?: string;
  emptyText?: string;
  auditCards?: ChatAuditCard[];
};

type ChatScreenProps = {
  conversationId: string;
  currentUserId: string;
  roomMeta?: ChatRoomMeta;
  showHero?: boolean;
  onSendSuccess?: (payload: ComposerPayload) => Promise<void> | void;
};

type ComposerPayload = {
  text?: string;
  fileUrl?: string;
  fileType?: ChatFileType;
  upload?: UploadableFile;
};

type FileAnalysisInput = {
  sentMessage: ChatMessage;
  originalPrompt: string;
};

type RuntimeDashboardState = {
  environment: string;
  activeBaseUrl: string | null;
  resolvedEndpointUrl: string | null;
  source: 'remote_api' | 'local_app_brain' | 'provider_fallback' | 'pending' | 'unknown';
  deploymentMarker: string | null;
  authMode: string;
  conversationId: string;
  requestId: string | null;
  isFallback: boolean;
  isStreaming: boolean;
  hasVisibleResponseText: boolean;
  fallbackState: string;
  degradedState: string;
  routingPolicy: string;
  selectionReason: string;
  requestStage: string;
  failureClass: string;
  lastStatusCode: string;
  failureDetail: string;
  responsePreview: string;
  lastAttemptAt: string;
  lastVerifiedAt: string;
};

function safeTrimCS(value: unknown): string {
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

function normalizeOutboundText(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value == null) {
    return '';
  }

  try {
    return String(value);
  } catch (error) {
    console.log('[ChatScreen] Failed to normalize outbound text:', (error as Error)?.message ?? 'Unknown error');
    return '';
  }
}

function hasStructuredInternalRows(text: string): boolean {
  const rows = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex <= 0) {
        return null;
      }
      return line.slice(0, separatorIndex).trim().toLowerCase();
    })
    .filter((label): label is string => label !== null);

  return rows.length >= 3 && rows.includes('result') && (rows.includes('evidence') || rows.includes('operator action log'));
}

function isInternalChatTranscriptMessage(message: ChatMessage): boolean {
  const text = safeTrimCS(message.text);
  const senderId = safeTrimCS(message.senderId).toLowerCase();
  const senderLabel = safeTrimCS(message.senderLabel).toLowerCase();

  if (senderId === 'system' || senderId === '__ivx_system__' || senderLabel === 'system') {
    return true;
  }

  if (!text) {
    return false;
  }

  if (hasStructuredInternalRows(text)) {
    return true;
  }

  const normalizedText = text.toLowerCase();
  return normalizedText.includes('shared fallback')
    || normalizedText.includes('fallback path answered')
    || normalizedText.includes('fallback reply delivered')
    || normalizedText.includes('provider fallback')
    || normalizedText.includes('degraded fallback mode')
    || normalizedText.includes('dev_test_mode');
}

function resolveFallbackStateLabel(isFallback: boolean): string {
  return isFallback ? 'active' : 'off';
}

function resolveStreamingState(input: {
  requestStage: string;
  failureClass: string;
  explicitStreaming?: boolean;
}): boolean {
  return hasActiveStreamingState({
    requestStage: input.requestStage,
    failureClass: input.failureClass,
    isStreaming: input.explicitStreaming,
  });
}

type RuntimeRow = {
  label: string;
  value: string;
};

function formatRuntimeTimestamp(value: number | null): string {
  if (!value || Number.isNaN(value)) {
    return 'pending';
  }

  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return 'pending';
  }
}

function getRoomLabel(conversationId: string): string {
  return conversationId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join(' ');
}

function getRuntimeProofToneColors(tone: ChatRuntimeProofTone): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
  mutedTextColor: string;
} {
  switch (tone) {
    case 'success':
      return {
        backgroundColor: 'rgba(16,185,129,0.12)',
        borderColor: 'rgba(16,185,129,0.32)',
        textColor: '#34D399',
        mutedTextColor: 'rgba(52,211,153,0.84)',
      };
    case 'warning':
      return {
        backgroundColor: 'rgba(245,158,11,0.14)',
        borderColor: 'rgba(245,158,11,0.32)',
        textColor: Colors.warning,
        mutedTextColor: 'rgba(245,158,11,0.84)',
      };
    case 'error':
      return {
        backgroundColor: 'rgba(239,68,68,0.14)',
        borderColor: 'rgba(239,68,68,0.32)',
        textColor: '#F87171',
        mutedTextColor: 'rgba(248,113,113,0.84)',
      };
    case 'neutral':
    default:
      return {
        backgroundColor: Colors.backgroundSecondary,
        borderColor: Colors.surfaceBorder,
        textColor: Colors.text,
        mutedTextColor: Colors.textSecondary,
      };
  }
}

function getRuntimeProofHeadline(runtime: RuntimeDashboardState): { title: string; detail: string } {
  if (hasRuntimeFailure(runtime)) {
    return {
      title: 'Assistant path needs attention',
      detail: 'The last reply did not complete cleanly. Your message remains saved.',
    };
  }

  if (runtime.hasVisibleResponseText) {
    return {
      title: 'Assistant ready',
      detail: 'Reply delivered.',
    };
  }

  if (runtime.isStreaming || isPendingRequestState(runtime)) {
    return {
      title: 'Message sent',
      detail: 'Reply will appear when ready.',
    };
  }

  if (runtime.source === 'remote_api' && runtime.requestStage === 'response_ok') {
    return {
      title: 'Assistant ready',
      detail: 'Live reply delivered.',
    };
  }

  return {
    title: 'Assistant ready',
    detail: 'Conversation is available.',
  };
}

function getCapabilityStateColors(state: CapabilityState): {
  backgroundColor: string;
  borderColor: string;
  textColor: string;
} {
  switch (state) {
    case 'available':
      return {
        backgroundColor: 'rgba(255,215,0,0.12)',
        borderColor: 'rgba(255,215,0,0.34)',
        textColor: Colors.primary,
      };
    case 'degraded':
      return {
        backgroundColor: 'rgba(245,158,11,0.14)',
        borderColor: 'rgba(245,158,11,0.32)',
        textColor: Colors.warning,
      };
    case 'unavailable':
    default:
      return {
        backgroundColor: Colors.backgroundSecondary,
        borderColor: Colors.surfaceBorder,
        textColor: Colors.textTertiary,
      };
  }
}

function getCapabilityStateLabel(state: CapabilityState): string {
  switch (state) {
    case 'available':
      return 'Live';
    case 'degraded':
      return 'Limited';
    case 'unavailable':
    default:
      return 'Off';
  }
}

function shouldAnalyzeAttachment(message: ChatMessage): boolean {
  const storagePath = safeTrimCS(message.fileStoragePath);
  if (!storagePath) {
    return false;
  }

  const fileType = message.fileType ?? 'file';
  const mime = safeTrimCS(message.fileMime).toLowerCase();
  return fileType === 'image'
    || fileType === 'pdf'
    || mime.startsWith('text/')
    || mime === 'application/json';
}

function buildFileAnalysisPrompt(input: FileAnalysisInput): string {
  const fileName = safeTrimCS(input.sentMessage.fileName) || 'uploaded file';
  const mime = safeTrimCS(input.sentMessage.fileMime) || safeTrimCS(input.sentMessage.fileType) || 'unknown file type';
  const ownerPrompt = safeTrimCS(input.originalPrompt);
  const base = `Analyze ${fileName} (${mime}) for IVX business use. Extract key facts, risks, numbers, dates, counterparties, action items, and a concise owner recommendation.`;
  return ownerPrompt ? `${base}\nOwner request/context: ${ownerPrompt}` : base;
}

function formatFileAnalysisReply(input: {
  message: ChatMessage;
  answer: string;
  model: string | null;
}): string {
  const fileName = safeTrimCS(input.message.fileName) || 'Uploaded file';
  const redactedAnswer = redactUserFacingChatSecrets(input.answer).trim();
  const safeAnswer = redactedAnswer.length > 0 ? redactedAnswer : 'Analysis completed, but no readable findings were returned.';
  const modelLine = input.model ? `Model: ${input.model}` : 'Model: IVX file analysis';
  return [`File analysis: ${fileName}`, modelLine, '', safeAnswer].join('\n');
}

export function ChatScreen({
  conversationId,
  currentUserId,
  roomMeta,
  showHero = true,
  onSendSuccess,
}: ChatScreenProps) {
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const screenRef = useRef<View | null>(null);
  const screenFrameRef = useRef<{ y: number; height: number }>({ y: 0, height: 0 });
  const queryClient = useQueryClient();
  const insets = useSafeAreaInsets();
  const [keyboardInset, setKeyboardInset] = useState<number>(0);
  const [storageStatus, setStorageStatus] = useState<ChatStorageStatus>(() => getChatStorageStatus());
  const [roomStatus, setRoomStatus] = useState<ChatRoomStatus | null>(() => getCurrentChatRoomStatus());
  const [selectedCapabilityId, setSelectedCapabilityId] = useState<string | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const stableConversationId = useMemo(() => (typeof conversationId === 'string' ? conversationId.trim() : ''), [conversationId]);
  const [runtimeDashboard, setRuntimeDashboard] = useState<RuntimeDashboardState>(() => {
    const audit = getIVXOwnerAIConfigAudit();
    return {
      environment: audit.currentEnvironment,
      activeBaseUrl: audit.activeBaseUrl,
      resolvedEndpointUrl: audit.activeEndpoint,
      source: 'pending',
      deploymentMarker: null,
      authMode: isOpenAccessModeEnabled() ? 'open_access_pending_session' : 'session_pending',
      conversationId: stableConversationId,
      requestId: null,
      isFallback: false,
      isStreaming: resolveStreamingState({
        requestStage: 'idle',
        failureClass: 'none',
      }),
      hasVisibleResponseText: false,
      fallbackState: resolveFallbackStateLabel(false),
      degradedState: 'checking',
      routingPolicy: audit.routingPolicy,
      selectionReason: audit.selectionReason,
      requestStage: 'idle',
      failureClass: 'none',
      lastStatusCode: 'pending',
      failureDetail: 'No live send attempted yet.',
      responsePreview: 'pending',
      lastAttemptAt: 'pending',
      lastVerifiedAt: 'pending',
    };
  });
  const stableCurrentUserId = useMemo(() => {
    return resolveChatActorId(currentUserId, 'preview');
  }, [currentUserId]);
  const isOwnerRoomConversation = useMemo(() => {
    return resolveChatConversationId(conversationId) === IVX_OWNER_AI_PROFILE.sharedRoom.id;
  }, [conversationId]);
  const heroTitle = useMemo(() => roomMeta?.title?.trim() || getRoomLabel(stableConversationId), [roomMeta?.title, stableConversationId]);
  const capabilityResolution = useMemo(() => {
    return resolveRoomCapabilityState(roomStatus, roomMeta?.runtimeSignals);
  }, [roomMeta?.runtimeSignals, roomStatus]);
  const heroSubtitle = useMemo(() => capabilityResolution.subtitle, [capabilityResolution.subtitle]);
  const heroBadgeText = useMemo(() => capabilityResolution.badgeText, [capabilityResolution.badgeText]);
  const roomCapabilities = useMemo(() => capabilityResolution.capabilities, [capabilityResolution.capabilities]);
  const selectedCapability = useMemo(() => {
    if (!selectedCapabilityId) {
      return null;
    }

    return roomCapabilities.find((capability) => capability.id === selectedCapabilityId) ?? null;
  }, [roomCapabilities, selectedCapabilityId]);
  const emptyStateTitle = useMemo(() => roomMeta?.emptyTitle?.trim() || 'No messages yet', [roomMeta?.emptyTitle]);
  const emptyStateText = useMemo(() => {
    return roomMeta?.emptyText?.trim() || capabilityResolution.emptyStateText;
  }, [capabilityResolution.emptyStateText, roomMeta?.emptyText]);
  const auditCards = useMemo<ChatAuditCard[]>(() => {
    const normalizedCards: ChatAuditCard[] = [];

    for (const card of roomMeta?.auditCards ?? []) {
      const title = card.title.trim();
      const description = card.description.trim();
      const bullets = card.bullets
        .map((bullet) => bullet.trim())
        .filter((bullet) => bullet.length > 0);

      if (!title || !description || bullets.length === 0) {
        continue;
      }

      normalizedCards.push({
        id: card.id,
        eyebrow: card.eyebrow?.trim(),
        title,
        description,
        bullets,
      });
    }

    return normalizedCards;
  }, [roomMeta?.auditCards]);
  const statusAccentColor = useMemo(() => {
    switch (storageStatus.mode) {
      case 'primary':
        return Colors.primary;
      case 'room':
      case 'fallback':
        return Colors.info;
      case 'local':
        return Colors.warning;
      case 'unknown':
      default:
        return Colors.textTertiary;
    }
  }, [storageStatus.mode]);
  const aiIndicatorColors = useMemo(() => {
    return getCapabilityStateColors(capabilityResolution.aiIndicator.state);
  }, [capabilityResolution.aiIndicator.state]);
  const [roomPhase, setRoomPhase] = useState<RoomSyncPhase>(() => getRoomStateSnapshot().phase);
  const { messages, loading, error, refetch, isRefreshing, loadOlderMessages, isLoadingOlder, hasMoreOlder } = useChatMessages(stableConversationId);
  const primaryRoomState = useMemo<{
    state: 'loading' | 'error' | 'degraded' | 'ready';
    title: string;
    detail: string;
    tone: CapabilityState;
    testID: string;
    showSpinner: boolean;
  }>(() => {
    if (loading && messages.length === 0) {
      return {
        state: 'loading',
        title: 'Opening room…',
        detail: 'Checking room status, sync state, and live capabilities.',
        tone: 'available',
        testID: 'chat-room-primary-state-loading',
        showSpinner: true,
      };
    }

    if (error) {
      return {
        state: 'error',
        title: 'Could not load this room',
        detail: error.message || 'Please try again.',
        tone: 'unavailable',
        testID: 'chat-room-primary-state-error',
        showSpinner: false,
      };
    }

    if (capabilityResolution.aiIndicator.state === 'degraded') {
      return {
        state: 'degraded',
        title: capabilityResolution.aiIndicator.label,
        detail: 'Room stays usable. You can still type and send while assistant replies recover.',
        tone: 'degraded',
        testID: 'chat-room-primary-state-degraded',
        showSpinner: false,
      };
    }

    return {
      state: 'ready',
      title: 'Room ready',
      detail: 'Messages, composer, and room sync are available.',
      tone: 'available',
      testID: 'chat-room-primary-state-ready',
      showSpinner: false,
    };
  }, [capabilityResolution.aiIndicator.label, capabilityResolution.aiIndicator.state, error, loading, messages.length]);
  const primaryRoomStateColors = useMemo(() => {
    return getCapabilityStateColors(primaryRoomState.tone);
  }, [primaryRoomState.tone]);
  const selectedCapabilityColors = useMemo(() => {
    return selectedCapability ? getCapabilityStateColors(selectedCapability.state) : null;
  }, [selectedCapability]);
  const { members: presenceMembers, presenceLabel } = useRoomPresence({
    conversationId: stableConversationId,
    currentUserId: stableCurrentUserId,
  });
  const { toggleReaction, getReactionsFor } = useMessageReactions(stableConversationId, stableCurrentUserId);
  const { isAnyoneTyping, typingLabel, broadcastTyping, stopTyping } = useTypingIndicator({
    conversationId: stableConversationId,
    currentUserId: stableCurrentUserId,
    enabled: stableConversationId.length > 0 && stableCurrentUserId.length > 0,
  });
  const keyboardBehavior = Platform.select<'padding' | undefined>({
    ios: 'padding',
    android: undefined,
    default: undefined,
  });
  const androidKeyboardInset = useMemo(() => {
    if (Platform.OS !== 'android') {
      return 0;
    }

    return Math.max(keyboardInset, 0);
  }, [keyboardInset]);
  const composerBottomInset = useMemo(() => {
    const baseInset = Math.max(insets.bottom, Platform.OS === 'android' ? 16 : 12);
    if (Platform.OS === 'android' && androidKeyboardInset > 0) {
      return baseInset;
    }

    return baseInset;
  }, [androidKeyboardInset, insets.bottom]);
  const [bottomDockHeight, setBottomDockHeight] = useState<number>(0);
  const listContentStyle = useMemo(() => {
    return [styles.listContent, { paddingBottom: Math.max(bottomDockHeight + 12, 12) }];
  }, [bottomDockHeight]);
  const threadFooterSpacerHeight = useMemo(() => {
    return Math.max(composerBottomInset, 12);
  }, [composerBottomInset]);
  const shouldRequestAssistantReply = useMemo(() => {
    const aiHealth = roomMeta?.runtimeSignals?.aiBackendHealth;
    return aiHealth === 'active' || aiHealth === 'degraded' || isOpenAccessModeEnabled();
  }, [roomMeta?.runtimeSignals?.aiBackendHealth]);
  const runtimeProofTone = useMemo<ChatRuntimeProofTone>(() => {
    return getRuntimeProofTone(runtimeDashboard);
  }, [runtimeDashboard]);
  const runtimeProofColors = useMemo(() => {
    return getRuntimeProofToneColors(runtimeProofTone);
  }, [runtimeProofTone]);
  const runtimeProofHeadline = useMemo(() => {
    return getRuntimeProofHeadline(runtimeDashboard);
  }, [runtimeDashboard]);
  const runtimeStatusCopy = useMemo(() => {
    return getRuntimeStatusCopy(runtimeDashboard);
  }, [runtimeDashboard]);
  const runtimeModeSummary = useMemo(() => {
    return getRuntimeModeSummary(runtimeDashboard);
  }, [runtimeDashboard]);
  const runtimePrimaryRows = useMemo<RuntimeRow[]>(() => {
    return [
      { label: 'Request stage', value: runtimeDashboard.requestStage },
      { label: 'Failure class', value: runtimeDashboard.failureClass },
      { label: 'HTTP status', value: runtimeDashboard.lastStatusCode },
      { label: 'Base URL', value: runtimeDashboard.activeBaseUrl ?? 'unset' },
      { label: 'Endpoint', value: runtimeDashboard.resolvedEndpointUrl ?? 'unset' },
      { label: 'Request ID', value: runtimeDashboard.requestId ?? 'pending' },
      { label: 'Response preview', value: runtimeDashboard.responsePreview },
    ];
  }, [runtimeDashboard]);
  const runtimeRows = useMemo<RuntimeRow[]>(() => {
    return [
      { label: 'Environment', value: runtimeDashboard.environment },
      { label: 'UI mode', value: runtimeModeSummary.label },
      { label: 'Source', value: getRuntimeSourceLabel(runtimeDashboard) },
      { label: 'Deployment marker', value: runtimeDashboard.deploymentMarker ?? 'pending' },
      { label: 'Auth mode', value: runtimeDashboard.authMode },
      { label: 'Conversation ID', value: runtimeDashboard.conversationId },
      { label: 'Reply path', value: runtimeDashboard.isFallback ? 'recovering' : 'primary' },
      { label: 'Streaming', value: String(runtimeDashboard.isStreaming) },
      { label: 'Runtime state', value: runtimeDashboard.degradedState === 'cleared' ? 'ready' : runtimeDashboard.degradedState },
      { label: 'Last attempt', value: runtimeDashboard.lastAttemptAt },
      { label: 'Last verified', value: runtimeDashboard.lastVerifiedAt },
      { label: 'Failure detail', value: runtimeDashboard.failureDetail },
      { label: 'Routing policy', value: runtimeDashboard.routingPolicy },
      { label: 'Selection reason', value: runtimeDashboard.selectionReason },
    ];
  }, [runtimeDashboard, runtimeModeSummary.label]);

  const shouldShowDiagnosticsToggle = useMemo(() => {
    return shouldShowRuntimeDebugDetails(runtimeDashboard) || auditCards.length > 0 || primaryRoomState.state === 'degraded';
  }, [auditCards.length, primaryRoomState.state, runtimeDashboard]);

  const isNearBottomRef = useRef<boolean>(true);
  const [showScrollToLatest, setShowScrollToLatest] = useState<boolean>(false);
  const hasScrolledToLatestRef = useRef<boolean>(false);

  const scrollToBottom = useCallback((animated: boolean) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
      isNearBottomRef.current = true;
      setShowScrollToLatest(false);
    });
  }, []);

  const handleScroll = useCallback((event: { nativeEvent: { contentOffset: { y: number }; contentSize: { height: number }; layoutMeasurement: { height: number } } }) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - contentOffset.y - layoutMeasurement.height;
    const nearBottom = distanceFromBottom < 100;
    isNearBottomRef.current = nearBottom;
    setShowScrollToLatest(!nearBottom && messages.length > 0);
  }, [messages.length]);

  const updateScreenFrame = useCallback(() => {
    if (Platform.OS === 'web') {
      return;
    }

    screenRef.current?.measureInWindow((_x, y, _width, height) => {
      screenFrameRef.current = { y, height };
      console.log('[ChatScreen] Screen frame updated:', screenFrameRef.current);
    });
  }, []);

  const handleRefresh = useCallback(async () => {
    console.log('[ChatScreen] Refresh requested');
    await refetch();
    scrollToBottom(false);
  }, [refetch, scrollToBottom]);

  const handleRetry = useCallback(() => {
    void handleRefresh();
  }, [handleRefresh]);

  const generateOptimisticId = useCallback(() => {
    const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (cryptoRef?.randomUUID) {
      return `optimistic-${cryptoRef.randomUUID()}`;
    }
    return `optimistic-${'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    })}`;
  }, []);

  const generateClientMessageId = useCallback(() => {
    const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
    if (cryptoRef?.randomUUID) {
      return cryptoRef.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.floor(Math.random() * 16);
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }, []);

  const addTransientAssistantReply = useCallback((messageId: string, answer: string, toolUsed?: string | null) => {
    const normalizedAnswer = safeTrimCS(answer);
    if (!normalizedAnswer) {
      return;
    }

    const queryKey = getChatMessagesQueryKey(stableConversationId);
    queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => {
      const currentMessages = prev ?? [];
      if (currentMessages.some((message) => message.id === messageId)) {
        return currentMessages;
      }
      const nowIso = new Date().toISOString();
      const nextMessage: ChatMessage = {
        id: messageId,
        conversationId: stableConversationId,
        senderId: 'ivx-owner-ai-assistant',
        senderLabel: IVX_OWNER_AI_PROFILE.support.assistantDisplayName,
        text: normalizedAnswer,
        createdAt: nowIso,
        updatedAt: nowIso,
        sendStatus: 'sent',
        optimistic: false,
        localOnly: false,
        toolUsed: toolUsed ?? null,
      };
      return [...currentMessages, nextMessage];
    });
  }, [queryClient, stableConversationId]);

  const removeTransientAssistantReply = useCallback((messageId: string) => {
    const queryKey = getChatMessagesQueryKey(stableConversationId);
    queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => {
      return (prev ?? []).filter((message) => message.id !== messageId);
    });
  }, [queryClient, stableConversationId]);

  const handleRetryMessage = useCallback((message: ChatMessage) => {
    if (!message.retryPayload) {
      console.log('[ChatScreen] No retry payload for message:', message.id);
      return;
    }

    const queryKey = getChatMessagesQueryKey(stableConversationId);
    queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => {
      return (prev ?? []).map((m) =>
        m.id === message.id ? { ...m, sendStatus: 'sent' as const, optimistic: true } : m
      );
    });

    const retryInput = message.retryPayload;
    void (async () => {
      try {
        console.log('[ChatScreen] Retrying message:', message.id);
        await chatService.sendMessage(retryInput);

        queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => {
          return (prev ?? []).filter((m) => m.id !== message.id);
        });

        await queryClient.invalidateQueries({ queryKey });
        scrollToBottom(true);
      } catch (retryError) {
        console.log('[ChatScreen] Retry failed:', (retryError as Error)?.message ?? 'Unknown');
        queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => {
          return (prev ?? []).map((m) =>
            m.id === message.id ? { ...m, sendStatus: 'failed' as const } : m
          );
        });
      }
    })();
  }, [stableConversationId, queryClient, scrollToBottom]);

  const handleDismissFailedMessage = useCallback((messageId: string) => {
    const queryKey = getChatMessagesQueryKey(stableConversationId);
    queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => {
      return (prev ?? []).filter((m) => m.id !== messageId);
    });
  }, [stableConversationId, queryClient]);

  const stuckSendingCleanupRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    initRoomStateManager();
    const unsubscribe = subscribeToRoomState((snapshot) => {
      setRoomPhase(snapshot.phase);
    });
    return unsubscribe;
  }, []);

  const cleanupStuckSending = useCallback((optimisticId: string, sendCid: string) => {
    if (stuckSendingCleanupRef.current) {
      clearTimeout(stuckSendingCleanupRef.current);
    }
    stuckSendingCleanupRef.current = setTimeout(() => {
      const queryKey = getChatMessagesQueryKey(stableConversationId);
      const current = queryClient.getQueryData<ChatMessage[]>(queryKey) ?? [];
      const stuckMessage = current.find((m) => m.id === optimisticId && m.optimistic === true);
      if (stuckMessage) {
        console.log('[ChatScreen] Stuck optimistic send safety net triggered cid:', sendCid, 'forcing failed:', optimisticId);
        queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) =>
          (prev ?? []).map((m) =>
            m.id === optimisticId && m.optimistic === true
              ? { ...m, sendStatus: 'failed' as const, optimistic: true }
              : m
          ),
        );
      }
      stuckSendingCleanupRef.current = null;
    }, 15000);
  }, [stableConversationId, queryClient]);

  const sendMessageMutation = useMutation<
    ChatMessage,
    Error,
    ComposerPayload & { optimisticId: string; sendCid: string; clientMessageId: string },
    { previousMessages: ChatMessage[]; optimisticId: string; sendCid: string; clientMessageId: string }
  >({
    mutationFn: async (payload) => {
      const snapshot = getRoomStateSnapshot();
      const normalizedText = normalizeOutboundText(payload.text);
      const trimmedText = safeTrimCS(normalizedText);
      const normalizedPayload = {
        ...payload,
        text: trimmedText.length > 0 ? normalizedText : undefined,
      };
      console.log('[ChatScreen] Send start cid:', payload.sendCid, '|', {
        conversationId: stableConversationId,
        currentUserId: stableCurrentUserId,
        hasText: trimmedText.length > 0,
        textLength: normalizedText.length,
        hasFile: !!payload.fileUrl,
        hasUpload: !!payload.upload,
        fileType: payload.fileType ?? null,
        roomPhase: snapshot.phase,
        roomMode: snapshot.status?.storageMode ?? 'unknown',
        roomDelivery: snapshot.status?.deliveryMethod ?? 'unknown',
      });

      if (trimmedText.length === 0 && !payload.fileUrl && !payload.upload) {
        throw new Error('Type a message before sending.');
      }

      const sentMessage = await chatService.sendMessage({
        conversationId: stableConversationId,
        senderId: stableCurrentUserId,
        text: normalizedPayload.text,
        fileUrl: payload.fileUrl,
        fileType: payload.fileType,
        upload: payload.upload,
        clientMessageId: payload.clientMessageId,
      });

      console.log('[ChatScreen] Send success cid:', payload.sendCid);
      return sentMessage;
    },
    onMutate: async (payload) => {
      const queryKey = getChatMessagesQueryKey(stableConversationId);
      await queryClient.cancelQueries({ queryKey });

      const previousMessages = queryClient.getQueryData<ChatMessage[]>(queryKey) ?? [];

      const normalizedText = normalizeOutboundText(payload.text);
      const trimmedText = safeTrimCS(normalizedText);
      const normalizedSendText = trimmedText.length > 0 ? normalizedText : undefined;

      const retryPayload: SendMessageInput = {
        conversationId: stableConversationId,
        senderId: stableCurrentUserId,
        text: normalizedSendText,
        fileUrl: payload.fileUrl,
        fileType: payload.fileType,
        upload: payload.upload,
        clientMessageId: payload.clientMessageId,
      };

      const optimisticMessage: ChatMessage = {
        id: payload.optimisticId,
        conversationId: stableConversationId,
        senderId: stableCurrentUserId,
        text: normalizedSendText ?? null,
        fileUrl: payload.fileUrl ?? null,
        fileType: payload.fileType ?? null,
        createdAt: new Date().toISOString(),
        sendStatus: 'sent',
        optimistic: true,
        retryPayload,
      };

      queryClient.setQueryData<ChatMessage[]>(queryKey, [...previousMessages, optimisticMessage]);
      scrollToBottom(true);
      cleanupStuckSending(payload.optimisticId, payload.sendCid);

      return {
        previousMessages,
        optimisticId: payload.optimisticId,
        sendCid: payload.sendCid,
        clientMessageId: payload.clientMessageId,
      };
    },
    onSuccess: async (sentMessage, payload, context) => {
      if (stuckSendingCleanupRef.current) {
        clearTimeout(stuckSendingCleanupRef.current);
        stuckSendingCleanupRef.current = null;
      }

      console.log('[ChatScreen] Send resolved to SENT cid:', context?.sendCid);

      const queryKey = getChatMessagesQueryKey(stableConversationId);

      queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => {
        return (prev ?? []).filter((m) => m.id !== context?.optimisticId);
      });

      await queryClient.invalidateQueries({ queryKey });

      if (onSendSuccess) {
        try {
          await onSendSuccess(payload);
        } catch (callbackError) {
          console.log('[ChatScreen] Send success callback error:', (callbackError as Error)?.message ?? 'Unknown error');
        }
      }

      scrollToBottom(true);

      const rawMessageText = normalizeOutboundText(payload.text);
      if (payload.upload && shouldAnalyzeAttachment(sentMessage)) {
        void (async () => {
          const assistantReplyId = `file-analysis-${generateClientMessageId()}`;
          try {
            console.log('[ChatScreen] Running IVX file analysis:', {
              messageId: sentMessage.id,
              bucket: sentMessage.fileStorageBucket ?? null,
              path: sentMessage.fileStoragePath ?? null,
              fileType: sentMessage.fileType ?? null,
              mime: sentMessage.fileMime ?? null,
            });
            const analysis = await analyzeFile({
              storagePath: sentMessage.fileStoragePath ?? '',
              bucket: sentMessage.fileStorageBucket ?? undefined,
              prompt: buildFileAnalysisPrompt({ sentMessage, originalPrompt: rawMessageText }),
            });
            const replyText = formatFileAnalysisReply({
              message: sentMessage,
              answer: analysis.analysis.answer,
              model: analysis.analysis.model,
            });
            addTransientAssistantReply(assistantReplyId, replyText, 'file_analysis');
            await ivxOwnerMemoryService.recordFileUpload({
              id: `chat-file-${sentMessage.id}`,
              conversationId: stableConversationId,
              name: sentMessage.fileName ?? analysis.file.path.split('/').pop() ?? 'uploaded-file',
              mimeType: sentMessage.fileMime ?? analysis.file.mimeType,
              size: sentMessage.fileSize ?? analysis.file.sizeBytes,
              summary: analysis.analysis.answer.slice(0, 1200),
              excerpt: null,
              uploadedAt: sentMessage.createdAt,
            });
            await chatService.sendMessage({
              conversationId: stableConversationId,
              senderId: 'ivx-owner-ai-assistant',
              senderLabel: IVX_OWNER_AI_PROFILE.support.assistantDisplayName,
              text: replyText,
              clientMessageId: `analysis-${generateClientMessageId()}`,
            });
            removeTransientAssistantReply(assistantReplyId);
            await queryClient.invalidateQueries({ queryKey });
            scrollToBottom(true);
          } catch (analysisError) {
            removeTransientAssistantReply(assistantReplyId);
            console.log('[ChatScreen] IVX file analysis failed:', (analysisError as Error)?.message ?? 'Unknown error');
          }
        })();
      }

      const messageText = safeTrimCS(rawMessageText);
      if (messageText && !payload.upload) {
        const commandResult = parseOwnerCommand(messageText);
        if (commandResult) {
          console.log('[ChatScreen] Owner command handled:', commandResult.command);
          const cmdMsg = createCommandResponseMessage(stableConversationId, commandResult.response);
          queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => [
            ...(prev ?? []),
            cmdMsg,
          ]);
          scrollToBottom(true);
          if (commandResult.command === 'reconnect') {
            requestRoomRedetection();
          }
        } else if (shouldRequestAssistantReply) {
          console.log('[ChatScreen] Triggering AI reply for:', sanitizeUserFacingChatText(rawMessageText).slice(0, 40));
          const sendAudit = getIVXOwnerAIConfigAudit();
          const startedAt = Date.now();
          setRuntimeDashboard((current) => ({
            ...current,
            environment: sendAudit.currentEnvironment,
            activeBaseUrl: sendAudit.activeBaseUrl,
            resolvedEndpointUrl: sendAudit.activeEndpoint,
            conversationId: stableConversationId,
            requestStage: 'request_started',
            failureClass: 'pending',
            lastStatusCode: 'pending',
            source: 'pending',
            isFallback: false,
            isStreaming: false,
            hasVisibleResponseText: false,
            fallbackState: resolveFallbackStateLabel(false),
            routingPolicy: sendAudit.routingPolicy,
            selectionReason: sendAudit.selectionReason,
            responsePreview: sanitizeUserFacingChatText(rawMessageText).slice(0, 120),
            lastAttemptAt: formatRuntimeTimestamp(startedAt),
            failureDetail: 'Awaiting AI response from live runtime.',
          }));
          void (async () => {
            const assistantReplyId = `assistant-reply-${generateClientMessageId()}`;
            try {
              const aiResult = await requestAIReply(rawMessageText, stableConversationId);
              const runtimeProof = getLastIVXOwnerAIRuntimeProof();
              const normalizedSource = normalizeRuntimeSource(runtimeProof?.source ?? aiResult.source);
              const normalizedAnswer = assertCleanOwnerAIResponseText(aiResult.answer);

              if (!normalizedAnswer) {
                throw new Error('IVX Owner AI completed without returning visible response text.');
              }

              // Relaxed source gate: never silently discard a backend-stamped assistant reply.
              // Acceptable sources include remote_api, local_app_brain, provider_fallback, unknown, and any backend-stamped source.
              // Only 'pending' is treated as not-yet-renderable. Unexpected sources still render the bubble with a warning badge.
              const assistantSourceExpected = isExpectedAssistantSource(normalizedSource);
              const assistantSourceAcceptable = isAcceptableAssistantSource(normalizedSource);
              if (!assistantSourceExpected) {
                console.log('[ChatScreen] Non-primary assistant source rendered with warning badge:', {
                  normalizedSource,
                  rawSource: runtimeProof?.source ?? aiResult.source ?? null,
                  requestId: aiResult.requestId,
                  acceptable: assistantSourceAcceptable,
                });
              }
              const visibleReplyText = assistantSourceExpected
                ? normalizedAnswer
                : `${normalizedAnswer}\n\n⚠️ Source: ${normalizedSource} (unverified)`;

              // Suppress the recoverable "couldn't read its response" / rate-limit /
              // 5xx notice when a real assistant reply for this turn already exists
              // (e.g. the backend persisted the answer while the client's streaming
              // path synthesized an empty body). This prevents a success reply being
              // followed by a contradicting error bubble.
              const existingMessages = queryClient.getQueryData<ChatMessage[]>(
                getChatMessagesQueryKey(stableConversationId),
              ) ?? [];
              // Check for ANY recent assistant reply with visible text — not just
              // 'ivx-owner-ai-assistant'. The backend may tag replies differently
              // (e.g. 'assistant', 'ivx_daily_improvement'), but any non-empty
              // assistant reply from the last 30 seconds is proof the answer
              // already rendered. This prevents a success reply being followed by
              // a contradicting error bubble when senderId labels drift.
              const now = Date.now();
              const assistantReplyIds = new Set(['ivx-owner-ai-assistant', 'assistant', 'ai']);
              const sixtySecondsAgo = new Date(now - 60_000).toISOString();
              const hasExistingAssistantReply = existingMessages.some((message) => {
                const hasVisibleText = safeTrimCS(message.text).length > 0;
                if (!hasVisibleText) return false;
                const isAssistantSender = assistantReplyIds.has(message.senderId)
                  || (message.senderId?.toLowerCase().includes('assistant') ?? false)
                  || (message.senderId?.toLowerCase().includes('ivx') ?? false);
                if (!isAssistantSender) return false;
                const isRecent = message.createdAt >= sixtySecondsAgo;
                return isRecent;
              });
              if (shouldSuppressOwnerAIBackendNotice({ answer: normalizedAnswer, hasExistingAssistantReply })) {
                console.log('[ChatScreen] Suppressed transient backend notice; a real assistant reply already exists for this turn:', {
                  requestId: aiResult.requestId,
                });
                removeTransientAssistantReply(assistantReplyId);
                return;
              }

              addTransientAssistantReply(assistantReplyId, visibleReplyText, aiResult.selectedTool ?? null);
              scrollToBottom(true);
              setRuntimeDashboard((current) => {
                const nextRequestStage = runtimeProof?.requestStage ?? (normalizedSource === 'remote_api' ? 'response_ok' : 'fallback_reply');
                const nextFailureClass = runtimeProof?.failureClass ?? 'none';
                const nextRuntimeState = {
                  source: normalizedSource,
                  requestStage: nextRequestStage,
                  failureClass: nextFailureClass,
                  isFallback: false,
                  isStreaming: false,
                  hasVisibleResponseText: true,
                };
                const nextIsFallback = shouldShowFallbackUI(nextRuntimeState);

                return {
                  ...current,
                  activeBaseUrl: runtimeProof?.baseUrl ?? current.activeBaseUrl,
                  resolvedEndpointUrl: runtimeProof?.endpoint ?? aiResult.endpoint ?? current.resolvedEndpointUrl,
                  source: normalizedSource,
                  deploymentMarker: runtimeProof?.deploymentMarker ?? aiResult.deploymentMarker ?? current.deploymentMarker,
                  conversationId: aiResult.conversationId,
                  requestId: runtimeProof?.requestId ?? aiResult.requestId,
                  isFallback: nextIsFallback,
                  isStreaming: false,
                  hasVisibleResponseText: true,
                  fallbackState: resolveFallbackStateLabel(nextIsFallback),
                  degradedState: normalizedSource === 'remote_api' || normalizedSource === 'local_app_brain' ? 'cleared' : 'active',
                  requestStage: nextRequestStage,
                  failureClass: nextFailureClass,
                  lastStatusCode: runtimeProof?.statusCode !== null && runtimeProof?.statusCode !== undefined
                    ? String(runtimeProof.statusCode)
                    : normalizedSource === 'remote_api' || normalizedSource === 'local_app_brain'
                      ? '200'
                      : 'unavailable',
                  responsePreview: aiResult.selectedTool ? `Tool used: ${aiResult.selectedTool}` : sanitizeUserFacingChatText(runtimeProof?.responsePreview ?? normalizedAnswer).slice(0, 160),
                  lastVerifiedAt: formatRuntimeTimestamp(runtimeProof?.lastUpdatedAt ?? Date.now()),
                  failureDetail: runtimeProof?.detail ?? 'Reply delivered.',
                };
              });
              const currentMessages = queryClient.getQueryData<ChatMessage[]>(queryKey) ?? [];
              const duplicateAssistantReply = currentMessages.some((message) => {
                return message.id !== assistantReplyId
                  && message.senderId === 'ivx-owner-ai-assistant'
                  && safeTrimCS(message.text) === normalizedAnswer;
              });

              if (duplicateAssistantReply) {
                console.log('[ChatScreen] Assistant reply already present, keeping visible transcript and skipping duplicate persistence:', aiResult.requestId);
                removeTransientAssistantReply(assistantReplyId);
                return;
              }

              if (normalizedSource === 'remote_api' || normalizedSource === 'local_app_brain') {
                await queryClient.invalidateQueries({ queryKey });
                scrollToBottom(true);
                console.log('[ChatScreen] AI reply confirmed from remote API and visible in thread:', {
                  requestId: aiResult.requestId,
                  source: normalizedSource,
                  endpoint: aiResult.endpoint,
                  deploymentMarker: aiResult.deploymentMarker,
                  selectedTool: aiResult.selectedTool ?? null,
                  toolOutputCount: aiResult.toolOutputs?.length ?? 0,
                  length: normalizedAnswer.length,
                  model: aiResult.model,
                });
                return;
              }

            } catch (aiError) {
              const diagnostics = getIVXOwnerAIErrorDiagnostics(aiError);
              const failureMessage = (aiError as Error)?.message ?? 'Unknown error';
              removeTransientAssistantReply(assistantReplyId);
              setRuntimeDashboard((current) => ({
                ...current,
                activeBaseUrl: diagnostics?.baseUrl ?? current.activeBaseUrl,
                resolvedEndpointUrl: diagnostics?.endpoint ?? current.resolvedEndpointUrl,
                requestId: diagnostics?.requestId ?? current.requestId,
                requestStage: diagnostics?.stage ?? 'response',
                failureClass: diagnostics?.classification ?? 'provider_exhausted',
                lastStatusCode: diagnostics?.statusCode !== null && diagnostics?.statusCode !== undefined ? String(diagnostics.statusCode) : 'unavailable',
                failureDetail: 'The message was sent. Send another prompt when you are ready.',
                responsePreview: '',
                isFallback: false,
                isStreaming: false,
                hasVisibleResponseText: false,
                degradedState: 'cleared',
                fallbackState: resolveFallbackStateLabel(false),
              }));
              console.log('[ChatScreen] AI provider and local guard paths exhausted; no fake assistant text inserted:', {
                originalFailureMessage: failureMessage,
                diagnostics,
              });
            }
          })();
        }
      }
    },
    onError: (mutationError, _payload, context) => {
      if (stuckSendingCleanupRef.current) {
        clearTimeout(stuckSendingCleanupRef.current);
        stuckSendingCleanupRef.current = null;
      }

      console.log('[ChatScreen] Send resolved to FAILED cid:', context?.sendCid, 'error:', mutationError.message);

      const queryKey = getChatMessagesQueryKey(stableConversationId);
      queryClient.setQueryData<ChatMessage[]>(queryKey, (prev) => {
        return (prev ?? []).map((m) =>
          m.id === context?.optimisticId
            ? { ...m, sendStatus: 'failed' as const }
            : m
        );
      });
    },
  });

  const loadOlderBlock = useMemo(() => {
    if (!hasMoreOlder || messages.length === 0) return null;
    return (
      <Pressable
        style={({ pressed }) => [styles.loadOlderButton, pressed ? styles.pressed : null]}
        onPress={() => { void loadOlderMessages(); }}
        disabled={isLoadingOlder}
        testID="chat-room-load-older"
      >
        {isLoadingOlder ? (
          <ActivityIndicator size="small" color={Colors.primary} />
        ) : (
          <ChevronUp size={14} color={Colors.primary} />
        )}
        <Text style={styles.loadOlderText}>
          {isLoadingOlder ? 'Loading\u2026' : 'Load older messages'}
        </Text>
      </Pressable>
    );
  }, [hasMoreOlder, messages.length, isLoadingOlder, loadOlderMessages]);

  const listHeader = useMemo(() => {
    return (
      <>
        <RoomConnectionBanner
          phase={roomPhase}
          onReconnect={() => {
            console.log('[ChatScreen] Manual reconnect requested');
            requestRoomRedetection();
          }}
        />
        <PresenceBar
          members={presenceMembers}
          currentUserId={stableCurrentUserId}
          presenceLabel={presenceLabel}
        />

        {showHero ? (
          <View style={styles.heroCard} testID="chat-room-hero">
            <View style={styles.heroLeft}>
              <View style={[styles.statusPill, { borderColor: statusAccentColor }]}>
                <Radio size={14} color={statusAccentColor} />
                <Text style={[styles.statusPillText, { color: statusAccentColor }]}>{heroBadgeText}</Text>
              </View>
              <Text style={styles.heroTitle} numberOfLines={1}>{heroTitle || 'Message Room'}</Text>
              <Text style={styles.heroSubtitle} numberOfLines={2} ellipsizeMode="tail">{heroSubtitle}</Text>

              <View style={styles.heroSignalRow}>
                <View
                  style={[
                    styles.aiIndicatorBadge,
                    {
                      backgroundColor: aiIndicatorColors.backgroundColor,
                      borderColor: aiIndicatorColors.borderColor,
                    },
                  ]}
                  testID={capabilityResolution.aiIndicator.testID}
                >
                  {capabilityResolution.aiIndicator.isLoading ? (
                    <ActivityIndicator size="small" color={aiIndicatorColors.textColor} />
                  ) : (
                    <View style={[styles.aiIndicatorDot, { backgroundColor: aiIndicatorColors.textColor }]} />
                  )}
                  <Text style={[styles.aiIndicatorText, { color: aiIndicatorColors.textColor }]}>
                    {capabilityResolution.aiIndicator.label}
                  </Text>
                </View>
                <Text style={styles.heroSummary} numberOfLines={1}>{capabilityResolution.summary}</Text>
              </View>

              <View style={styles.capabilityRow}>
                {roomCapabilities.map((capability) => {
                  const colors = getCapabilityStateColors(capability.state);
                  const isSelected = selectedCapabilityId === capability.id;

                  return (
                    <Pressable
                      key={capability.id}
                      style={({ pressed }) => [
                        styles.capabilityPill,
                        {
                          backgroundColor: colors.backgroundColor,
                          borderColor: colors.borderColor,
                        },
                        isSelected ? styles.capabilityPillSelected : null,
                        pressed ? styles.pressed : null,
                      ]}
                      onPress={() => {
                        setSelectedCapabilityId((current) => current === capability.id ? null : capability.id);
                      }}
                      testID={capability.testID}
                    >
                      <Text style={[styles.capabilityText, { color: colors.textColor }]}>{capability.label}</Text>
                      <Text style={[styles.capabilityStateText, { color: colors.textColor }]}>
                        {getCapabilityStateLabel(capability.state)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {selectedCapability && selectedCapabilityColors ? (
                <View
                  style={[
                    styles.capabilityDetailCard,
                    {
                      backgroundColor: selectedCapabilityColors.backgroundColor,
                      borderColor: selectedCapabilityColors.borderColor,
                    },
                  ]}
                  testID={`chat-room-capability-detail-${selectedCapability.id}`}
                >
                  <Text style={[styles.capabilityDetailTitle, { color: selectedCapabilityColors.textColor }]}> 
                    {selectedCapability.label} • {getCapabilityStateLabel(selectedCapability.state)}
                  </Text>
                  <Text style={[styles.capabilityDetailText, { color: selectedCapabilityColors.textColor }]}>
                    {selectedCapability.detail}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        ) : null}

        <View
          style={[
            styles.primaryStateCard,
            {
              backgroundColor: primaryRoomStateColors.backgroundColor,
              borderColor: primaryRoomStateColors.borderColor,
            },
          ]}
          testID={primaryRoomState.testID}
        >
          <View style={styles.primaryStateHeader}>
            <View style={styles.primaryStateCopy}>
              <View style={styles.primaryStateHeaderRow}>
                {primaryRoomState.showSpinner ? (
                  <ActivityIndicator size="small" color={primaryRoomStateColors.textColor} />
                ) : (
                  <View style={[styles.primaryStateDot, { backgroundColor: primaryRoomStateColors.textColor }]} />
                )}
                <Text style={[styles.primaryStateTitle, { color: primaryRoomStateColors.textColor }]}>{runtimeStatusCopy.title}</Text>
              </View>
              <Text style={[styles.primaryStateDetail, { color: primaryRoomStateColors.textColor }]} numberOfLines={1}>{runtimeStatusCopy.detail}</Text>
            </View>
            {shouldShowDiagnosticsToggle ? (
              <Pressable
                style={({ pressed }) => [styles.detailsToggle, pressed ? styles.pressed : null]}
                onPress={() => {
                  setShowDiagnostics((current) => !current);
                }}
                testID="chat-room-toggle-details"
              >
                <Text style={styles.detailsToggleText}>{showDiagnostics ? 'Hide' : 'Details'}</Text>
              </Pressable>
            ) : null}
          </View>
          {primaryRoomState.state === 'error' ? (
            <Pressable
              style={({ pressed }) => [styles.retryButton, pressed ? styles.pressed : null]}
              onPress={handleRetry}
              testID="chat-room-retry"
            >
              <RefreshCw size={16} color={Colors.black} />
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          ) : null}
        </View>

        {showDiagnostics && primaryRoomState.state !== 'error' ? (
          <View style={styles.runtimeCard} testID="chat-room-runtime-dashboard">
            <View style={styles.statusCardHeader}>
              <Text style={styles.statusCardEyebrow}>Runtime proof</Text>
              <View style={[styles.statusBadge, { borderColor: runtimeProofColors.borderColor }]}> 
                <View style={[styles.statusDot, { backgroundColor: runtimeProofColors.textColor }]} />
                <Text style={[styles.statusBadgeText, { color: runtimeProofColors.textColor }]}>{getRuntimeSourceLabel(runtimeDashboard)}</Text>
              </View>
            </View>

            <View
              style={[
                styles.runtimeProofBanner,
                {
                  backgroundColor: runtimeProofColors.backgroundColor,
                  borderColor: runtimeProofColors.borderColor,
                },
              ]}
              testID="chat-room-runtime-proof-banner"
            >
              <Text style={[styles.runtimeProofTitle, { color: runtimeProofColors.textColor }]}>{runtimeProofHeadline.title}</Text>
              <Text style={[styles.runtimeProofDetail, { color: runtimeProofColors.mutedTextColor }]}>{runtimeProofHeadline.detail}</Text>
            </View>

            <View style={styles.runtimeModeCard} testID={runtimeModeSummary.testID}>
              <Text style={styles.runtimeModeLabel}>{runtimeModeSummary.label}</Text>
              <Text style={styles.runtimeModeDetail}>{runtimeModeSummary.detail}</Text>
            </View>

            <View style={styles.runtimePrimaryGrid}>
              {runtimePrimaryRows.map((row) => {
                const isResponsePreview = row.label === 'Response preview';
                return (
                  <View
                    key={row.label}
                    style={[
                      styles.runtimeMetricCard,
                      isResponsePreview ? styles.runtimeMetricCardWide : null,
                    ]}
                    testID={`chat-room-runtime-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
                  >
                    <Text style={styles.runtimeMetricLabel}>{row.label}</Text>
                    <Text style={styles.runtimeMetricValue}>{row.value}</Text>
                  </View>
                );
              })}
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.runtimeScrollContent}>
              <View style={styles.runtimeGrid}>
                {runtimeRows.map((row) => {
                  return (
                    <View key={row.label} style={styles.runtimeMetricCard} testID={`chat-room-runtime-${row.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
                      <Text style={styles.runtimeMetricLabel}>{row.label}</Text>
                      <Text style={styles.runtimeMetricValue}>{row.value}</Text>
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        ) : null}

        {showDiagnostics && primaryRoomState.state !== 'error' ? (
          <View style={styles.statusCard} testID="chat-room-storage-status">
            <View style={styles.statusCardHeader}>
              <Text style={styles.statusCardEyebrow}>Room status</Text>
              <View style={[styles.statusBadge, { borderColor: statusAccentColor }]}>
                <View style={[styles.statusDot, { backgroundColor: statusAccentColor }]} />
                <Text style={[styles.statusBadgeText, { color: statusAccentColor }]}>{storageStatus.label}</Text>
              </View>
            </View>
            <Text style={styles.statusDetail}>{storageStatus.detail}</Text>
            <Text style={styles.statusSummary}>{capabilityResolution.summary}</Text>
            {storageStatus.warning ? <Text style={styles.statusWarning}>{storageStatus.warning}</Text> : null}
            <View style={styles.statusMetricRow}>
              <View style={styles.statusMetricCard} testID="chat-room-status-storage">
                <Text style={styles.statusMetricLabel}>Storage</Text>
                <Text style={styles.statusMetricValue}>{storageStatus.persistenceLabel}</Text>
              </View>
              <View style={styles.statusMetricCard} testID="chat-room-status-visibility">
                <Text style={styles.statusMetricLabel}>Visibility</Text>
                <Text style={styles.statusMetricValue}>{storageStatus.visibilityLabel}</Text>
              </View>
              <View style={styles.statusMetricCard} testID="chat-room-status-delivery">
                <Text style={styles.statusMetricLabel}>Delivery</Text>
                <Text style={styles.statusMetricValue}>{storageStatus.deliveryLabel}</Text>
              </View>
            </View>
          </View>
        ) : null}

        {showDiagnostics && auditCards.length > 0 && primaryRoomState.state !== 'error' ? (
          <View style={styles.auditSection} testID="chat-room-audit">
            <Text style={styles.auditSectionTitle}>End-to-end audit</Text>
            <View style={styles.auditCardList}>
              {auditCards.map((card) => {
                return (
                  <View key={card.id} style={styles.auditCard} testID={`chat-room-audit-card-${card.id}`}>
                    {card.eyebrow ? <Text style={styles.auditEyebrow}>{card.eyebrow}</Text> : null}
                    <Text style={styles.auditTitle}>{card.title}</Text>
                    <Text style={styles.auditDescription}>{card.description}</Text>
                    <View style={styles.auditBulletList}>
                      {card.bullets.map((bullet, bulletIndex) => {
                        return (
                          <View key={`${card.id}-${bulletIndex}`} style={styles.auditBulletRow}>
                            <View style={styles.auditBulletDot} />
                            <Text style={styles.auditBulletText}>{bullet}</Text>
                          </View>
                        );
                      })}
                    </View>
                  </View>
                );
              })}
            </View>
          </View>
        ) : null}

        {primaryRoomState.state === 'ready' || primaryRoomState.state === 'degraded' ? loadOlderBlock : null}
      </>
    );
  }, [
    aiIndicatorColors.backgroundColor,
    aiIndicatorColors.borderColor,
    aiIndicatorColors.textColor,
    auditCards,
    primaryRoomState.detail,
    primaryRoomState.showSpinner,
    primaryRoomState.state,
    primaryRoomState.testID,
    primaryRoomState.title,
    primaryRoomStateColors.backgroundColor,
    primaryRoomStateColors.borderColor,
    primaryRoomStateColors.textColor,
    capabilityResolution.summary,
    handleRetry,
    runtimeDashboard.source,
    runtimePrimaryRows,
    runtimeProofColors.backgroundColor,
    runtimeProofColors.borderColor,
    runtimeProofColors.mutedTextColor,
    runtimeProofColors.textColor,
    runtimeProofHeadline.detail,
    runtimeProofHeadline.title,
    runtimeModeSummary.detail,
    runtimeModeSummary.label,
    runtimeModeSummary.testID,
    runtimeRows,
    runtimeStatusCopy.detail,
    runtimeStatusCopy.title,
    loadOlderBlock,
    heroBadgeText,
    heroSubtitle,
    heroTitle,
    presenceLabel,
    presenceMembers,
    roomCapabilities,
    roomPhase,
    selectedCapability,
    selectedCapabilityColors,
    selectedCapabilityId,
    showDiagnostics,
    showHero,
    shouldShowDiagnosticsToggle,
    stableCurrentUserId,
    statusAccentColor,
    storageStatus.detail,
    storageStatus.label,
    storageStatus.persistenceLabel,
    storageStatus.visibilityLabel,
    storageStatus.deliveryLabel,
    storageStatus.warning,
  ]);

  useEffect(() => {
    setStorageStatus(getChatStorageStatus());
    setRoomStatus(getCurrentChatRoomStatus());
    const unsubscribeStorage = subscribeToChatStorageMode((nextMode) => {
      setStorageStatus(getChatStorageStatus(nextMode));
    });
    const unsubscribeRoom = subscribeToChatRoomStatus((nextStatus) => {
      setRoomStatus(nextStatus);
    });

    return () => {
      unsubscribeStorage();
      unsubscribeRoom();
    };
  }, [stableConversationId]);

  useEffect(() => {
    setSelectedCapabilityId(null);
  }, [stableConversationId]);

  useEffect(() => {
    const audit = getIVXOwnerAIConfigAudit();
    const runtimeProof = getLastIVXOwnerAIRuntimeProof();
    setRuntimeDashboard((current) => ({
      ...current,
      environment: audit.currentEnvironment,
      activeBaseUrl: runtimeProof?.baseUrl ?? audit.activeBaseUrl,
      resolvedEndpointUrl: runtimeProof?.endpoint ?? audit.activeEndpoint,
      source: shouldPreserveRequestScopedRuntime(current)
        ? current.source
        : getActiveRuntimeSource({
          source: normalizeRuntimeSource(runtimeProof?.source ?? current.source),
          requestStage: runtimeProof?.requestStage ?? current.requestStage,
          failureClass: runtimeProof?.failureClass ?? current.failureClass,
          isFallback: runtimeProof?.source === 'provider_fallback',
          isStreaming: current.isStreaming,
          hasVisibleResponseText: current.hasVisibleResponseText,
        }),
      deploymentMarker: runtimeProof?.deploymentMarker ?? current.deploymentMarker,
      conversationId: stableConversationId,
      requestId: runtimeProof?.requestId ?? current.requestId,
      isFallback: shouldShowFallbackUI({
        source: normalizeRuntimeSource(runtimeProof?.source ?? current.source),
        requestStage: runtimeProof?.requestStage ?? current.requestStage,
        failureClass: runtimeProof?.failureClass ?? current.failureClass,
        isFallback: runtimeProof?.source === 'provider_fallback',
        isStreaming: current.isStreaming,
        hasVisibleResponseText: current.hasVisibleResponseText,
      }),
      isStreaming: resolveStreamingState({
        requestStage: runtimeProof?.requestStage ?? current.requestStage,
        failureClass: runtimeProof?.failureClass ?? current.failureClass,
        explicitStreaming: current.isStreaming,
      }),
      hasVisibleResponseText: current.hasVisibleResponseText,
      fallbackState: resolveFallbackStateLabel(runtimeProof?.source === 'provider_fallback' && !isPendingRequestState({
        requestStage: runtimeProof?.requestStage ?? current.requestStage,
        failureClass: runtimeProof?.failureClass ?? current.failureClass,
      })),
      routingPolicy: audit.routingPolicy,
      selectionReason: audit.selectionReason,
      requestStage: runtimeProof?.requestStage ?? (current.requestStage === 'idle' ? 'idle' : current.requestStage),
      failureClass: runtimeProof?.failureClass ?? current.failureClass,
      lastStatusCode: runtimeProof?.statusCode !== null && runtimeProof?.statusCode !== undefined
        ? String(runtimeProof.statusCode)
        : current.lastStatusCode,
      failureDetail: runtimeProof?.detail ?? current.failureDetail,
      responsePreview: runtimeProof?.responsePreview ?? current.responsePreview,
      lastAttemptAt: current.lastAttemptAt,
      lastVerifiedAt: runtimeProof?.lastUpdatedAt ? formatRuntimeTimestamp(runtimeProof.lastUpdatedAt) : current.lastVerifiedAt,
    }));
  }, [stableConversationId]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const ownerContext = await getIVXOwnerAuthContext();
        if (cancelled) {
          return;
        }

        setRuntimeDashboard((current) => ({
          ...current,
          authMode: ownerContext.accessToken === 'dev-open-access-token' ? 'dev_bypass' : 'authenticated_owner',
        }));
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRuntimeDashboard((current) => ({
          ...current,
          authMode: isOpenAccessModeEnabled() ? 'open_access_blocked' : 'auth_required',
        }));
        console.log('[ChatScreen] Runtime auth mode resolution failed:', (error as Error)?.message ?? 'Unknown error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [stableConversationId]);

  useEffect(() => {
    if (isOwnerRoomConversation) {
      console.log('[ChatScreen] Skipping generic room bootstrap for owner-room conversation:', stableConversationId);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const boot = await bootstrapRoomByFriendlySlug(stableConversationId);
        if (cancelled) {
          return;
        }

        await ensureParticipant(boot.conversation.id, {
          actorId: stableCurrentUserId,
        });
        await markConversationAsRead(boot.conversation.slug ?? boot.conversation.id, stableCurrentUserId);
      } catch (roomError) {
        console.log('[ChatScreen] Room bootstrap note:', (roomError as Error)?.message ?? 'Unknown error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [isOwnerRoomConversation, stableConversationId, stableCurrentUserId]);

  // Auto-scroll to latest only on initial load or when near the bottom.
  // Do NOT force-scroll when the user is reading older messages.
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }

    // First load: scroll to bottom without animation to avoid visible jump
    if (!hasScrolledToLatestRef.current) {
      const timeout = setTimeout(() => {
        listRef.current?.scrollToEnd({ animated: false });
        hasScrolledToLatestRef.current = true;
        isNearBottomRef.current = true;
      }, 50);
      return () => clearTimeout(timeout);
    }

    // Subsequent messages: only auto-scroll if user is near the bottom
    if (isNearBottomRef.current) {
      const timeout = setTimeout(() => {
        scrollToBottom(true);
      }, 80);
      return () => clearTimeout(timeout);
    }
  }, [messages.length, scrollToBottom]);

  useEffect(() => {
    const queryKey = getChatMessagesQueryKey(stableConversationId);
    let lastBackground = 0;

    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'background' || nextState === 'inactive') {
        lastBackground = Date.now();
        return;
      }

      if (nextState === 'active' && lastBackground > 0) {
        const elapsed = Date.now() - lastBackground;
        lastBackground = 0;
        console.log('[ChatScreen] App resumed after', elapsed, 'ms, refetching messages');

        void queryClient.invalidateQueries({ queryKey });

        setTimeout(() => {
          scrollToBottom(true);
        }, 300);
      }
    });

    return () => {
      subscription.remove();
    };
  }, [stableConversationId, queryClient, scrollToBottom]);

  const handleKeyboardShow = useCallback((event: KeyboardEvent) => {
    console.log('[ChatScreen] Keyboard shown');

    if (Platform.OS === 'android') {
      const keyboardTop = event.endCoordinates.screenY;
      requestAnimationFrame(() => {
        updateScreenFrame();
        requestAnimationFrame(() => {
          const overlap = Math.max(
            screenFrameRef.current.y + screenFrameRef.current.height - keyboardTop,
            0,
          );
          console.log('[ChatScreen] Android keyboard overlap:', {
            keyboardTop,
            overlap,
            frame: screenFrameRef.current,
          });
          setKeyboardInset(overlap);
          setTimeout(() => {
            scrollToBottom(true);
          }, 60);
        });
      });
      return;
    }

    setTimeout(() => {
      scrollToBottom(true);
    }, 60);
  }, [scrollToBottom, updateScreenFrame]);

  const handleKeyboardHide = useCallback(() => {
    console.log('[ChatScreen] Keyboard hidden');
    setKeyboardInset(0);
    setTimeout(() => {
      scrollToBottom(false);
    }, 20);
  }, [scrollToBottom]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, handleKeyboardShow);
    const hideSub = Keyboard.addListener(hideEvent, handleKeyboardHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [handleKeyboardHide, handleKeyboardShow]);

  const visibleMessages = useMemo<ChatMessage[]>(() => {
    return messages.filter((message) => !isInternalChatTranscriptMessage(message));
  }, [messages]);

  const renderMessage = useCallback(
    ({ item }: { item: ChatMessage }) => {
      return (
        <View style={styles.messageRow}>
          <MessageBubble
            message={item}
            isMine={item.senderId === stableCurrentUserId}
            onRetry={item.sendStatus === 'failed' ? handleRetryMessage : undefined}
            onDismiss={item.sendStatus === 'failed' ? handleDismissFailedMessage : undefined}
            reactions={getReactionsFor(item.id)}
            onToggleReaction={item.optimistic ? undefined : toggleReaction}
          />
        </View>
      );
    },
    [stableCurrentUserId, handleRetryMessage, handleDismissFailedMessage, getReactionsFor, toggleReaction],
  );

  const listFooter = useMemo(() => {
    return (
      <View style={styles.threadFooterStack} testID="chat-room-thread-footer">
        <View style={[styles.threadEndSpacer, { height: threadFooterSpacerHeight }]} />
      </View>
    );
  }, [threadFooterSpacerHeight]);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={keyboardBehavior}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 10 : 0}
    >
      <View
        ref={screenRef}
        style={styles.screen}
        onLayout={() => {
          updateScreenFrame();
        }}
      >
        <View style={styles.body}>
          <FlatList
            ref={listRef}
            data={visibleMessages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            style={styles.list}
            contentContainerStyle={listContentStyle}
            ListHeaderComponent={listHeader}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            showsVerticalScrollIndicator={false}
            onEndReachedThreshold={0.1}
            onScroll={handleScroll}
            scrollEventThrottle={16}
            maxToRenderPerBatch={10}
            initialNumToRender={15}
            windowSize={10}

            refreshControl={
              <RefreshControl
                refreshing={isRefreshing && !loading}
                onRefresh={() => {
                  void handleRefresh();
                }}
                tintColor={Colors.primary}
              />
            }
            onContentSizeChange={() => {
              if (!isLoadingOlder && isNearBottomRef.current) {
                scrollToBottom(visibleMessages.length > 1);
              }
            }}
            onLayout={() => {
              if (!isLoadingOlder && !hasScrolledToLatestRef.current) {
                listRef.current?.scrollToEnd({ animated: false });
                hasScrolledToLatestRef.current = true;
              }
            }}
            ListEmptyComponent={
              loading ? (
                <View style={styles.centerState} testID="chat-room-loading">
                  <ActivityIndicator color={Colors.primary} />
                  <Text style={styles.centerTitle}>Loading messages…</Text>
                  <Text style={styles.centerText}>Checking room status, sync state, and live capabilities.</Text>
                </View>
              ) : (
                <View style={styles.centerState} testID="chat-room-empty">
                  <Text style={styles.centerTitle}>{emptyStateTitle}</Text>
                  <Text style={styles.centerText}>{emptyStateText}</Text>
                </View>
              )
            }
            ListFooterComponent={listFooter}
            testID="chat-room-list"
          />

          <View
            style={styles.bottomDock}
            onLayout={(event) => {
              const nextHeight = event.nativeEvent.layout.height;
              if (Math.abs(nextHeight - bottomDockHeight) > 1) {
                setBottomDockHeight(nextHeight);
              }
            }}
          >
            <TypingIndicator isVisible={isAnyoneTyping} label={typingLabel} />
            <Composer
              onSend={async (payload) => {
                const optimisticId = generateOptimisticId();
                const sendCid = generateSendCorrelationId();
                try {
                  await sendMessageMutation.mutateAsync({ ...payload, optimisticId, sendCid, clientMessageId: sendCid });
                } finally {
                  stopTyping();
                }
              }}
              sending={sendMessageMutation.isPending}
              onFocus={() => {
                updateScreenFrame();
                scrollToBottom(true);
              }}
              onTyping={broadcastTyping}
              bottomInset={composerBottomInset}
            />
          </View>

          {showScrollToLatest ? (
            <Pressable
              style={styles.scrollToLatestButton}
              onPress={() => scrollToBottom(true)}
              testID="chat-scroll-to-latest"
            >
              <ChevronUp size={16} color={Colors.black} />
              <Text style={styles.scrollToLatestText}>Latest</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  screen: {
    flex: 1,
  },
  heroCard: {
    marginHorizontal: 12,
    marginTop: 2,
    marginBottom: 4,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  heroLeft: {
    gap: 3,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
  },
  statusPillText: {
    fontSize: 8,
    fontWeight: '700' as const,
  },
  heroTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  heroSubtitle: {
    color: '#E0E6EE',
    fontSize: 11,
    lineHeight: 14,
  },
  heroSignalRow: {
    gap: 3,
    marginTop: 0,
  },
  heroSummary: {
    color: '#B6BDC8',
    fontSize: 9,
    lineHeight: 12,
    fontWeight: '600' as const,
  },
  capabilityRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 1,
  },
  capabilityPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 999,
    borderWidth: 1,
  },
  capabilityPillSelected: {
    transform: [{ scale: 0.98 }],
  },
  capabilityText: {
    fontSize: 7,
    fontWeight: '700' as const,
  },
  capabilityStateText: {
    fontSize: 7,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  capabilityDetailCard: {
    marginTop: 3,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  capabilityDetailTitle: {
    fontSize: 12,
    fontWeight: '800' as const,
  },
  capabilityDetailText: {
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  primaryStateCard: {
    marginHorizontal: 12,
    marginBottom: 3,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 12,
    borderWidth: 1,
    gap: 2,
  },
  primaryStateHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  primaryStateCopy: {
    flex: 1,
    gap: 3,
  },
  primaryStateHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  primaryStateDot: {
    width: 6,
    height: 6,
    borderRadius: 999,
  },
  primaryStateTitle: {
    fontSize: 10,
    fontWeight: '800' as const,
  },
  primaryStateDetail: {
    fontSize: 8,
    lineHeight: 11,
    fontWeight: '600' as const,
  },
  statusCard: {
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    gap: 7,
  },
  runtimeCard: {
    marginHorizontal: 12,
    marginBottom: 6,
    padding: 10,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    gap: 8,
  },
  statusCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  statusCardEyebrow: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  statusDetail: {
    color: '#C8C8C8',
    fontSize: 12,
    lineHeight: 17,
  },
  statusSummary: {
    color: '#8E8E93',
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  aiIndicatorBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  aiIndicatorDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  aiIndicatorText: {
    fontSize: 11,
    fontWeight: '700' as const,
  },
  statusWarning: {
    color: Colors.warning,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  statusMetricRow: {
    flexDirection: 'row',
    gap: 10,
  },
  runtimeProofBanner: {
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
  },
  runtimeProofTitle: {
    fontSize: 13,
    fontWeight: '800' as const,
  },
  runtimeProofDetail: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  runtimeModeCard: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  runtimeModeLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '800' as const,
  },
  runtimeModeDetail: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  runtimePrimaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  runtimeScrollContent: {
    paddingRight: 8,
  },
  runtimeGrid: {
    flexDirection: 'row',
    gap: 10,
  },
  runtimeMetricCard: {
    width: 164,
    minHeight: 76,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 5,
  },
  runtimeMetricCardWide: {
    width: '100%',
    minHeight: 84,
  },
  runtimeMetricLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
  },
  runtimeMetricValue: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  statusMetricCard: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 5,
  },
  statusMetricLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'uppercase',
  },
  statusMetricValue: {
    color: Colors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
  auditSection: {
    marginHorizontal: 12,
    marginBottom: 8,
    gap: 8,
  },
  auditSectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const,
  },
  auditCardList: {
    gap: 10,
  },
  auditCard: {
    padding: 12,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8,
  },
  auditEyebrow: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  auditTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700' as const,
  },
  auditDescription: {
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  auditBulletList: {
    gap: 8,
  },
  auditBulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  auditBulletDot: {
    width: 7,
    height: 7,
    borderRadius: 999,
    backgroundColor: Colors.primary,
    marginTop: 6,
  },
  auditBulletText: {
    flex: 1,
    color: Colors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const,
  },
  retryButton: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: Colors.primary,
  },
  retryText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '700' as const,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    paddingTop: 0,
    flexGrow: 1,
  },
  messageRow: {
    paddingHorizontal: 12,
    marginBottom: 0,
  },
  centerState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    backgroundColor: Colors.surface,
    gap: 10,
  },
  centerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center',
  },
  centerText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  bottomDock: {
    backgroundColor: Colors.background,
    marginTop: 0,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder,
  },
  detailsToggle: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: Colors.backgroundSecondary,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  detailsToggleText: {
    color: Colors.textSecondary,
    fontSize: 8,
    fontWeight: '700' as const,
  },
  threadFooterStack: {
    paddingHorizontal: 12,
    paddingTop: 1,
    gap: 2,
  },
  threadEndSpacer: {
    height: 4,
  },
  loadOlderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 3,
    marginBottom: 3,
    paddingVertical: 5,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  loadOlderText: {
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  pressed: {
    opacity: 0.84,
  },
  scrollToLatestButton: {
    position: 'absolute' as const,
    bottom: 80,
    right: 16,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    backgroundColor: Colors.primary,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  scrollToLatestText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '700' as const,
  },
});
