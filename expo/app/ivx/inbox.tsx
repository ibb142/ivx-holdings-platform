import React, { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View} from "react-native";
import { ChevronRight, ClipboardCheck, FlaskConical, Github, Inbox, LayoutDashboard, MessageSquare, Radio, Search, Server, ShieldCheck, Sparkles } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { IVX_OWNER_AI_PROFILE } from '@/constants/ivx-owner-ai';
import { useAuth } from '@/lib/auth-context';
import type { IVXInboxItem, IVXMessage } from '@/shared/ivx';
import { detectIVXRoomStatus, ivxChatService, ivxInboxService } from '@/src/modules/ivx-owner-ai/services';
import { sanitizeUserFacingChatText } from '@/src/modules/chat/services/visibleTextSanitizer';
import type { ChatRoomStatus } from '@/src/modules/chat/types/chat';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const IVX_OWNER_INBOX_QUERY_KEY = ['ivx-owner-ai', 'inbox'] as const;
const IVX_OWNER_INBOX_PROOF_QUERY_KEY = ['ivx-owner-ai', 'inbox-proof'] as const;
const IVX_OWNER_INBOX_THREAD_QUERY_KEY = ['ivx-owner-ai', 'inbox-thread'] as const;
const INBOX_THREAD_PREVIEW_LIMIT = 3;

type InboxRuntimeProof = {
  ownerSessionReady: boolean;
  ownerLabel: string;
  roomStatus: ChatRoomStatus;
  activeRealtimeChannels: number;
  localListenerCount: number;
  observedAt: string;
};

function formatInboxTime(value: string | null): string {
  if (!value) {
    return 'Now';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Now';
  }

  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'});
}

function formatRoomMode(status: ChatRoomStatus): string {
  if (status.storageMode === 'primary_supabase_tables') {
    return 'Primary Supabase room';
  }

  if (status.storageMode === 'alternate_room_schema') {
    return 'Shared room schema';
  }

  if (status.storageMode === 'snapshot_storage') {
    return 'Snapshot storage';
  }

  return 'Device-first room';
}

function formatDeliveryMode(status: ChatRoomStatus): string {
  if (status.deliveryMethod === 'primary_realtime') {
    return 'Realtime delivery';
  }

  if (status.deliveryMethod === 'primary_polling') {
    return 'Polling delivery';
  }

  if (status.deliveryMethod === 'alternate_shared') {
    return 'Shared delivery';
  }

  if (status.deliveryMethod === 'snapshot_fallback') {
    return 'Snapshot delivery';
  }

  return 'Local delivery';
}

async function loadInboxRuntimeProof(ownerLabel: string, ownerSessionReady: boolean): Promise<InboxRuntimeProof> {
  console.log('[IVXOwnerInboxRoute] Loading owner inbox proof');
  const roomStatus = await detectIVXRoomStatus();
  const realtimeAudit = ivxChatService.getOwnerRealtimeSubscriptionAudit();

  return {
    ownerSessionReady,
    ownerLabel,
    roomStatus,
    activeRealtimeChannels: realtimeAudit.activeChannelCount,
    localListenerCount: realtimeAudit.localListenerCount,
    observedAt: new Date().toISOString()};
}

export default function IVXOwnerInboxRoute() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const ownerEmail = useMemo<string>(() => user?.email?.trim() || 'IVX Owner', [user?.email]);
  const inboxQuery = useQuery<IVXInboxItem[], Error>({
    queryKey: IVX_OWNER_INBOX_QUERY_KEY,
    queryFn: async () => {
      console.log('[IVXOwnerInboxRoute] Loading owner inbox');
      return ivxInboxService.loadOwnerInbox();
    }});
  const inboxProofQuery = useQuery<InboxRuntimeProof, Error>({
    queryKey: IVX_OWNER_INBOX_PROOF_QUERY_KEY,
    queryFn: () => loadInboxRuntimeProof(ownerEmail, !!user)});
  const inboxItems = inboxQuery.data ?? [];
  const inboxProof = inboxProofQuery.data ?? null;
  const unreadTotal = useMemo<number>(() => inboxItems.reduce((total, item) => total + item.unreadCount, 0), [inboxItems]);
  const lastActivityText = useMemo<string>(() => {
    const timestamps = inboxItems
      .map((item) => item.lastMessageAt)
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => new Date(value).getTime())
      .filter((value) => Number.isFinite(value));

    if (timestamps.length === 0) {
      return 'No messages yet';
    }

    return formatInboxTime(new Date(Math.max(...timestamps)).toISOString());
  }, [inboxItems]);

  useEffect(() => {
    let unsubscribe = () => {};

    void (async () => {
      try {
        unsubscribe = await ivxInboxService.subscribeToOwnerInbox((items) => {
          queryClient.setQueryData<IVXInboxItem[]>(IVX_OWNER_INBOX_QUERY_KEY, items);
        });
      } catch (error) {
        console.log('[IVXOwnerInboxRoute] Inbox subscription failed:', error instanceof Error ? error.message : 'unknown');
      }
    })();

    return () => {
      unsubscribe();
    };
  }, [queryClient]);

  const handleRefresh = useCallback(() => {
    console.log('[IVXOwnerInboxRoute] Manual refresh requested');
    void queryClient.invalidateQueries({ queryKey: IVX_OWNER_INBOX_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: IVX_OWNER_INBOX_PROOF_QUERY_KEY });
    void queryClient.invalidateQueries({ queryKey: IVX_OWNER_INBOX_THREAD_QUERY_KEY });
  }, [queryClient]);

  const handleOpenDiagnostics = useCallback(() => {
    router.push('/admin/diagnostics' as never);
  }, [router]);

  const handleOpenSearch = useCallback(() => {
    router.push('/ivx/search');
  }, [router]);

  const handleOpenProjectDashboard = useCallback(() => {
    router.push('/ivx/project-dashboard');
  }, [router]);

  const handleOpenProofTest = useCallback(() => {
    router.push('/ivx/proof-test');
  }, [router]);

  const handleOpenDurabilityProof = useCallback(() => {
    router.push('/ivx/durability-proof');
  }, [router]);

  const handleOpenProofLedger = useCallback(() => {
    router.push('/ivx/proof-ledger');
  }, [router]);

  const handleOpenGithubSync = useCallback(() => {
    router.push('/ivx/github-sync');
  }, [router]);

  const handleOpenWorkerProof = useCallback(() => {
    router.push('/ivx/worker-proof');
  }, [router]);

  const threadQuery = useQuery<IVXMessage[], Error>({
    queryKey: IVX_OWNER_INBOX_THREAD_QUERY_KEY,
    queryFn: async () => {
      console.log('[IVXOwnerInboxRoute] Loading owner inbox thread preview');
      const messages = await ivxChatService.listOwnerMessages();
      return messages.slice(-INBOX_THREAD_PREVIEW_LIMIT);
    }});

  const handleOpenRoom = useCallback(async (item: IVXInboxItem) => {
    try {
      console.log('[IVXOwnerInboxRoute] Opening owner room thread:', item.conversationId);
      await ivxInboxService.markOwnerConversationAsRead(item.conversationId);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: IVX_OWNER_INBOX_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: IVX_OWNER_INBOX_THREAD_QUERY_KEY }),
      ]);
      router.push({ pathname: '/ivx/chat', params: { conversationId: item.conversationId } });
    } catch (error) {
      Alert.alert('Unable to open room', error instanceof Error ? error.message : 'Unknown owner room error.');
    }
  }, [queryClient, router]);

  const renderInboxItem = useCallback(({ item }: { item: IVXInboxItem }) => {
    const hasUnread = item.unreadCount > 0;
    const unreadDisplay = item.unreadCount > 99 ? '99+' : String(item.unreadCount);

    return (
      <Pressable
        style={[styles.inboxCard, hasUnread ? styles.inboxCardUnread : null]}
        onPress={() => void handleOpenRoom(item)}
        testID={`ivx-owner-inbox-item-${item.conversationId}`}
        accessibilityRole="button"
        accessibilityLabel={hasUnread ? `${item.title}, ${item.unreadCount} unread` : item.title}
      >
        {hasUnread ? <View style={styles.unreadAccent} /> : null}
        <View style={styles.inboxCardHeader}>
          <View style={styles.inboxTitleBlock}>
            <View style={styles.inboxTitleRow}>
              {hasUnread ? <View style={styles.unreadDot} testID={`ivx-owner-inbox-unread-dot-${item.conversationId}`} /> : null}
              <Text style={[styles.inboxTitle, hasUnread ? styles.inboxTitleUnread : null]} numberOfLines={1}>
                {item.title}
              </Text>
            </View>
            <Text style={styles.inboxSubtitle} numberOfLines={1}>{item.subtitle ?? 'Owner-only room'}</Text>
          </View>
          <ChevronRight size={20} color={Colors.textTertiary} />
        </View>
        <Text
          style={[styles.inboxPreview, hasUnread ? styles.inboxPreviewUnread : null]}
          numberOfLines={2}
        >
          {item.lastMessageText ?? 'No activity yet. Open the room to send the first owner note.'}
        </Text>
        <ThreadPreview
          isLoading={threadQuery.isLoading}
          error={threadQuery.error ?? null}
          messages={threadQuery.data ?? []}
          onRetry={handleRefresh}
          conversationId={item.conversationId}
        />
        <View style={styles.inboxMetaRow}>
          <Text style={styles.inboxMetaText}>{formatInboxTime(item.lastMessageAt)}</Text>
          {hasUnread ? (
            <View style={styles.unreadBadge} testID={`ivx-owner-inbox-unread-badge-${item.conversationId}`}>
              <Text style={styles.unreadBadgeText}>{unreadDisplay}</Text>
              <Text style={styles.unreadBadgeLabel}>{item.unreadCount === 1 ? 'new' : 'new'}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  }, [handleOpenRoom, threadQuery.isLoading, threadQuery.error, threadQuery.data, handleRefresh]);

  return (
    <ErrorBoundary fallbackTitle="IVX inbox unavailable">
      <View style={styles.container} testID="ivx-owner-inbox-screen">
        <View style={styles.heroCard} testID="ivx-owner-inbox-hero">
          <View style={styles.heroBadge}>
            <Inbox size={16} color={Colors.black} />
            <Text style={styles.heroBadgeText}>Owner Inbox</Text>
          </View>
          <Text style={styles.heroTitle}>IVX Owner AI Inbox</Text>
          <Text style={styles.heroSubtitle}>{ownerEmail}</Text>
          <Text style={styles.heroDescription}>Review the owner-only shared room, unread updates, and the latest IVX Owner AI activity from one place.</Text>
          <Pressable
            style={styles.heroSearchButton}
            onPress={handleOpenSearch}
            accessibilityRole="button"
            accessibilityLabel="Search owner room"
            testID="ivx-owner-inbox-open-search"
          >
            <Search size={16} color={Colors.primary} />
            <Text style={styles.heroSearchButtonText}>Search full owner room history</Text>
            <ChevronRight size={16} color={Colors.primary} />
          </Pressable>
        </View>

        <View style={styles.launcherCard} testID="ivx-owner-inbox-launcher">
          <Text style={styles.launcherHeading}>New Owner AI features</Text>
          <View style={styles.launcherRow}>
            <Pressable
              style={styles.launcherButton}
              onPress={handleOpenProjectDashboard}
              accessibilityRole="button"
              accessibilityLabel="Open AI Project Dashboard"
              testID="ivx-owner-inbox-open-project-dashboard"
            >
              <LayoutDashboard size={18} color={Colors.primary} />
              <Text style={styles.launcherButtonText}>AI Project Dashboard</Text>
              <ChevronRight size={16} color={Colors.textTertiary} />
            </Pressable>
            <Pressable
              style={styles.launcherButton}
              onPress={handleOpenProofTest}
              accessibilityRole="button"
              accessibilityLabel="Open Proof Test"
              testID="ivx-owner-inbox-open-proof-test"
            >
              <FlaskConical size={18} color={Colors.primary} />
              <Text style={styles.launcherButtonText}>Proof Test</Text>
              <ChevronRight size={16} color={Colors.textTertiary} />
            </Pressable>
          </View>
          <Pressable
            style={styles.launcherButtonFull}
            onPress={handleOpenDurabilityProof}
            accessibilityRole="button"
            accessibilityLabel="Open Owner AI Durability Proof"
            testID="ivx-owner-inbox-open-durability-proof"
          >
            <ShieldCheck size={18} color={Colors.primary} />
            <Text style={styles.launcherButtonText}>Run Owner AI Durability Proof</Text>
            <ChevronRight size={16} color={Colors.textTertiary} />
          </Pressable>
          <Pressable
            style={styles.launcherButtonFull}
            onPress={handleOpenProofLedger}
            accessibilityRole="button"
            accessibilityLabel="Open Senior Developer Proof Ledger"
            testID="ivx-owner-inbox-open-proof-ledger"
          >
            <ClipboardCheck size={18} color={Colors.primary} />
            <Text style={styles.launcherButtonText}>Senior Developer Proof Ledger</Text>
            <ChevronRight size={16} color={Colors.textTertiary} />
          </Pressable>
          <Pressable
            style={styles.launcherButtonFull}
            onPress={handleOpenWorkerProof}
            accessibilityRole="button"
            accessibilityLabel="Open Senior Developer Worker Proof"
            testID="ivx-owner-inbox-open-worker-proof"
          >
            <Server size={18} color={Colors.primary} />
            <Text style={styles.launcherButtonText}>Senior Developer Worker Proof</Text>
            <ChevronRight size={16} color={Colors.textTertiary} />
          </Pressable>
        </View>

        <View style={styles.proofCard} testID="ivx-owner-inbox-proof-card">
          <View style={styles.proofHeader}>
            <View style={styles.proofTitleRow}>
              <ShieldCheck size={18} color={Colors.primary} />
              <Text style={styles.proofTitle}>Owner room proof</Text>
            </View>
            <Pressable
              style={styles.proofRefreshButton}
              onPress={handleRefresh}
              accessibilityRole="button"
              accessibilityLabel="Refresh owner inbox proof"
              testID="ivx-owner-inbox-proof-refresh"
            >
              <Text style={styles.proofRefreshText}>Refresh</Text>
            </Pressable>
          </View>
          {inboxProofQuery.isLoading ? (
            <View style={styles.proofLoadingRow} testID="ivx-owner-inbox-proof-loading">
              <View style={styles.statusDotPending} />
              <Text style={styles.proofMutedText}>Checking owner session, room storage, and delivery path…</Text>
            </View>
          ) : inboxProofQuery.error ? (
            <View style={styles.proofErrorBlock} testID="ivx-owner-inbox-proof-error">
              <Text style={styles.proofErrorTitle}>Proof refresh needs attention</Text>
              <Text style={styles.proofMutedText}>{inboxProofQuery.error.message}</Text>
            </View>
          ) : inboxProof ? (
            <View style={styles.proofGrid} testID="ivx-owner-inbox-proof-ready">
              <View style={styles.proofMetric} testID="ivx-owner-inbox-proof-owner-session">
                <Text style={styles.proofMetricLabel}>Owner session</Text>
                <Text style={styles.proofMetricValue}>{inboxProof.ownerSessionReady ? 'Ready' : 'Needs sign-in'}</Text>
                <Text style={styles.proofMetricHint}>{inboxProof.ownerLabel}</Text>
              </View>
              <View style={styles.proofMetric} testID="ivx-owner-inbox-proof-room-mode">
                <Text style={styles.proofMetricLabel}>Room storage</Text>
                <Text style={styles.proofMetricValue}>{formatRoomMode(inboxProof.roomStatus)}</Text>
                <Text style={styles.proofMetricHint}>{formatDeliveryMode(inboxProof.roomStatus)}</Text>
              </View>
              <View style={styles.proofMetric} testID="ivx-owner-inbox-proof-unread">
                <Text style={styles.proofMetricLabel}>Unread</Text>
                <Text style={styles.proofMetricValue}>{unreadTotal}</Text>
                <Text style={styles.proofMetricHint}>Last activity {lastActivityText}</Text>
              </View>
              <View style={styles.proofMetric} testID="ivx-owner-inbox-proof-realtime">
                <Text style={styles.proofMetricLabel}>Live listeners</Text>
                <Text style={styles.proofMetricValue}>{inboxProof.activeRealtimeChannels + inboxProof.localListenerCount}</Text>
                <Text style={styles.proofMetricHint}>{formatInboxTime(inboxProof.observedAt)}</Text>
              </View>
            </View>
          ) : null}
          <Pressable
            style={styles.diagnosticsLink}
            onPress={handleOpenDiagnostics}
            accessibilityRole="button"
            accessibilityLabel="Open IVX diagnostics"
            testID="ivx-owner-inbox-open-diagnostics"
          >
            <Radio size={16} color={Colors.primary} />
            <Text style={styles.diagnosticsLinkText}>Open live diagnostics</Text>
            <ChevronRight size={16} color={Colors.primary} />
          </Pressable>
          <Pressable
            style={styles.diagnosticsLink}
            onPress={handleOpenGithubSync}
            accessibilityRole="button"
            accessibilityLabel="Open Sync to GitHub"
            testID="ivx-owner-inbox-open-github-sync"
          >
            <Github size={16} color={Colors.primary} />
            <Text style={styles.diagnosticsLinkText}>Sync code to GitHub</Text>
            <ChevronRight size={16} color={Colors.primary} />
          </Pressable>
        </View>

        {inboxQuery.isLoading ? (
          <View style={styles.loadingState} testID="ivx-owner-inbox-loading">
            <ShimmerIndicator color={Colors.primary} />
            <Text style={styles.loadingText}>Loading IVX inbox…</Text>
          </View>
        ) : inboxQuery.error ? (
          <View style={styles.errorState} testID="ivx-owner-inbox-error">
            <Text style={styles.errorTitle}>Unable to load the inbox.</Text>
            <Text style={styles.errorText}>{inboxQuery.error.message}</Text>
            <Pressable style={styles.retryButton} onPress={handleRefresh} testID="ivx-owner-inbox-retry">
              <Text style={styles.retryButtonText}>Retry</Text>
            </Pressable>
          </View>
        ) : (
          <FlatList
            data={inboxItems}
            keyExtractor={(item) => item.conversationId}
            renderItem={renderInboxItem}
            contentContainerStyle={inboxItems.length === 0 ? styles.emptyContent : styles.listContent}
            refreshControl={<RefreshControl tintColor={Colors.primary} refreshing={inboxQuery.isRefetching || inboxProofQuery.isRefetching} onRefresh={handleRefresh} />}
            ListEmptyComponent={
              <View style={styles.emptyState} testID="ivx-owner-inbox-empty">
                <Sparkles size={28} color={Colors.primary} />
                <Text style={styles.emptyTitle}>No owner conversations yet</Text>
                <Text style={styles.emptyText}>Open the room to start the first IVX Owner AI message.</Text>
                <Pressable style={styles.openRoomButton} onPress={() => router.push('/ivx/chat')} testID="ivx-owner-inbox-open-room">
                  <Text style={styles.openRoomButtonText}>Open owner room</Text>
                </Pressable>
              </View>
            }
            testID="ivx-owner-inbox-list"
          />
        )}
      </View>
    </ErrorBoundary>
  );
}

type ThreadPreviewProps = {
  isLoading: boolean;
  error: Error | null;
  messages: IVXMessage[];
  onRetry: () => void;
  conversationId: string;
};

function formatThreadPreviewBody(message: IVXMessage): string {
  const sanitized = sanitizeUserFacingChatText(message.body ?? '');
  if (sanitized.length > 0) {
    return sanitized.length > 140 ? `${sanitized.slice(0, 137)}…` : sanitized;
  }
  if (message.attachmentName) {
    return `Attachment: ${message.attachmentName}`;
  }
  return 'Empty message';
}

function formatSenderLabel(message: IVXMessage): string {
  if (message.senderRole === 'assistant') {
    return 'IVX Owner AI';
  }
  if (message.senderRole === 'system') {
    return 'System';
  }
  return message.senderLabel?.trim() || 'Owner';
}

function ThreadPreview({ isLoading, error, messages, onRetry, conversationId }: ThreadPreviewProps) {
  if (isLoading) {
    return (
      <View style={styles.threadBlock} testID={`ivx-owner-inbox-thread-loading-${conversationId}`}>
        <View style={styles.threadHeader}>
          <MessageSquare size={14} color={Colors.primary} />
          <Text style={styles.threadHeaderText}>Latest in thread</Text>
        </View>
        <View style={styles.threadLoadingRow}>
          <ShimmerIndicator color={Colors.primary} size="small" />
          <Text style={styles.threadMutedText}>Loading latest messages…</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.threadBlock} testID={`ivx-owner-inbox-thread-error-${conversationId}`}>
        <View style={styles.threadHeader}>
          <MessageSquare size={14} color={Colors.error} />
          <Text style={styles.threadHeaderText}>Latest in thread</Text>
        </View>
        <Text style={styles.threadErrorText}>{error.message}</Text>
        <Pressable
          style={styles.threadRetryButton}
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel="Retry loading latest owner messages"
          testID={`ivx-owner-inbox-thread-retry-${conversationId}`}
        >
          <Text style={styles.threadRetryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  if (messages.length === 0) {
    return (
      <View style={styles.threadBlock} testID={`ivx-owner-inbox-thread-empty-${conversationId}`}>
        <View style={styles.threadHeader}>
          <MessageSquare size={14} color={Colors.textTertiary} />
          <Text style={styles.threadHeaderText}>Latest in thread</Text>
        </View>
        <Text style={styles.threadMutedText}>No messages yet. Open the room to start the first owner note.</Text>
      </View>
    );
  }

  return (
    <View style={styles.threadBlock} testID={`ivx-owner-inbox-thread-ready-${conversationId}`}>
      <View style={styles.threadHeader}>
        <MessageSquare size={14} color={Colors.primary} />
        <Text style={styles.threadHeaderText}>Latest in thread</Text>
      </View>
      {messages.map((message) => (
        <View key={message.id} style={styles.threadMessageRow} testID={`ivx-owner-inbox-thread-message-${message.id}`}>
          <Text style={styles.threadMessageSender}>{formatSenderLabel(message)}</Text>
          <Text style={styles.threadMessageBody} numberOfLines={2}>{formatThreadPreviewBody(message)}</Text>
          <Text style={styles.threadMessageTime}>{formatInboxTime(message.createdAt)}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  heroCard: {
    marginHorizontal: 16,
    marginTop: 16,
    marginBottom: 12,
    padding: 18,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 8},
  heroBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    paddingVertical: 8},
  heroBadgeText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '700' as const},
  heroTitle: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '800' as const},
  heroSubtitle: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '700' as const},
  heroDescription: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20},
  heroSearchButton: {
    marginTop: 4,
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 18,
    backgroundColor: '#1F1A05',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.24)',
    paddingHorizontal: 12},
  heroSearchButtonText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const},
  launcherCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 12},
  launcherHeading: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  launcherRow: {
    gap: 10},
  launcherButton: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    backgroundColor: '#1F1A05',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.24)',
    paddingHorizontal: 14},
  launcherButtonFull: {
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    backgroundColor: '#1F1A05',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.24)',
    paddingHorizontal: 14,
    marginTop: 10},
  launcherButtonText: {
    flex: 1,
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const},
  proofCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 24,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 14},
  proofHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12},
  proofTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  proofTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const},
  proofRefreshButton: {
    minHeight: 36,
    justifyContent: 'center',
    borderRadius: 999,
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 12},
  proofRefreshText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800' as const},
  proofLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    padding: 12},
  statusDotPending: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: Colors.warning},
  proofMutedText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  proofErrorBlock: {
    borderRadius: 18,
    backgroundColor: '#231111',
    borderWidth: 1,
    borderColor: '#4A1E1E',
    padding: 12,
    gap: 4},
  proofErrorTitle: {
    color: Colors.error,
    fontSize: 14,
    fontWeight: '800' as const},
  proofGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  proofMetric: {
    width: '48%',
    minHeight: 92,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 12,
    gap: 5},
  proofMetricLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  proofMetricValue: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  proofMetricHint: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 16},
  diagnosticsLink: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 18,
    backgroundColor: '#1F1A05',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.24)',
    gap: 8},
  diagnosticsLinkText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '800' as const},
  loadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12},
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14},
  errorState: {
    flex: 1,
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 24,
    padding: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 10},
  errorTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const},
  errorText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20},
  retryButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
    paddingVertical: 10},
  retryButtonText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '700' as const},
  listContent: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    gap: 12},
  emptyContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingBottom: 24},
  emptyState: {
    alignItems: 'center',
    gap: 10,
    padding: 24,
    borderRadius: 24,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    textAlign: 'center'},
  emptyText: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center'},
  openRoomButton: {
    marginTop: 6,
    borderRadius: 999,
    backgroundColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 12},
  openRoomButtonText: {
    color: Colors.black,
    fontSize: 14,
    fontWeight: '700' as const},
  inboxCard: {
    borderRadius: 24,
    padding: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 12,
    overflow: 'hidden'},
  inboxCardUnread: {
    borderColor: 'rgba(255,215,0,0.45)',
    backgroundColor: '#161203'},
  unreadAccent: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 4,
    backgroundColor: Colors.primary},
  inboxTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary},
  inboxTitleUnread: {
    fontWeight: '900' as const},
  inboxPreviewUnread: {
    color: Colors.text,
    fontWeight: '700' as const},
  inboxCardHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12},
  inboxTitleBlock: {
    flex: 1,
    gap: 4},
  inboxTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const},
  inboxSubtitle: {
    color: Colors.textSecondary,
    fontSize: 13},
  inboxPreview: {
    color: Colors.text,
    fontSize: 14,
    lineHeight: 20},
  inboxMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12},
  inboxMetaText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '600' as const},
  unreadBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 28,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    paddingHorizontal: 10,
    paddingVertical: 4},
  unreadBadgeText: {
    color: Colors.black,
    fontSize: 13,
    fontWeight: '900' as const},
  unreadBadgeLabel: {
    color: 'rgba(0,0,0,0.65)',
    fontSize: 10,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  threadBlock: {
    borderRadius: 16,
    backgroundColor: '#0D0D0D',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 12,
    gap: 8},
  threadHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  threadHeaderText: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  threadLoadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  threadMutedText: {
    flex: 1,
    color: Colors.textSecondary,
    fontSize: 13,
    lineHeight: 18},
  threadErrorText: {
    color: Colors.error,
    fontSize: 13,
    lineHeight: 18},
  threadRetryButton: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    backgroundColor: Colors.surfaceLight,
    paddingHorizontal: 12,
    paddingVertical: 6},
  threadRetryText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800' as const},
  threadMessageRow: {
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2},
  threadMessageSender: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '800' as const,
    textTransform: 'uppercase',
    letterSpacing: 0.5},
  threadMessageBody: {
    color: Colors.text,
    fontSize: 13,
    lineHeight: 18},
  threadMessageTime: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const}});
