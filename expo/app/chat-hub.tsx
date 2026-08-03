import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { LinearGradient } from 'expo-linear-gradient';
import {
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { Archive, MessageCirclePlus, RefreshCw, Send, ShieldCheck, Sparkles, Wifi, WifiOff } from 'lucide-react-native';
import ChatBubble from '@/components/ChatBubble';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import {
  fetchPublicChatHealth,
  fetchPublicChatHistory,
  fetchPublicChatSessions,
  sendPublicChatMessage,
  type PublicChatApiResponse,
  type PublicChatHistoryItem,
  type PublicChatHistoryResponse,
  type PublicChatSessionMessage,
  type PublicChatSessionSummary,
  type PublicHealthResponse} from '@/lib/public-chat';
import { usePublicChatSession } from '@/lib/public-chat-session-context';
import { useWebKeyboard, scrollInputIntoView } from '@/hooks/useWebKeyboard';
import type { ChatMessage } from '@/types';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type ConnectionTone = 'live' | 'warn' | 'error';

type StatusChipProps = {
  label: string;
  tone: ConnectionTone;
  icon: 'wifi' | 'shield' | 'archive' | 'sparkles';
};

type SendMutationInput = {
  text: string;
  requestId: string;
  history: PublicChatHistoryItem[];
};

const WELCOME_COPY = 'Ask IVX AI about onboarding, investment basics, product navigation, or production status. Your current session is saved and restores when you return.';
const MAX_RENDERED_MESSAGES = 120;
const HISTORY_LIMIT = 80;
const SESSION_LIMIT = 20;

function createId(prefix: string): string {
  const cryptoRef = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoRef?.randomUUID) {
    return `${prefix}-${cryptoRef.randomUUID()}`;
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readTrimmed(value: string): string {
  return value.trim();
}

function sortMessages(messages: ChatMessage[]): ChatMessage[] {
  return [...messages].sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime());
}

function trimMessages(messages: ChatMessage[]): ChatMessage[] {
  const sorted = sortMessages(messages);
  return sorted.length <= MAX_RENDERED_MESSAGES ? sorted : sorted.slice(sorted.length - MAX_RENDERED_MESSAGES);
}

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const map = new Map<string, ChatMessage>();
  current.forEach((message) => map.set(message.id, message));
  incoming.forEach((message) => map.set(message.id, message));
  return trimMessages(Array.from(map.values()));
}

function createWelcomeMessage(): ChatMessage {
  return {
    id: 'public-chat-welcome',
    senderId: 'public-chat-system',
    senderName: 'IVX AI',
    senderAvatar: '',
    message: WELCOME_COPY,
    timestamp: new Date().toISOString(),
    isSupport: true,
    status: 'read'};
}

function mapPublicMessageToChatMessage(message: PublicChatSessionMessage): ChatMessage {
  const role = message.role === 'assistant' ? 'assistant' : message.role === 'system' ? 'system' : 'user';
  return {
    id: message.id,
    senderId: `public-chat-${role}`,
    senderName: role === 'user' ? 'You' : 'IVX AI',
    senderAvatar: '',
    message: message.content ?? message.text,
    timestamp: message.createdAt,
    isSupport: role !== 'user',
    status: 'read'};
}

function buildHistoryPayload(messages: ChatMessage[]): PublicChatHistoryItem[] {
  return messages
    .filter((message) => message.id !== 'public-chat-welcome' && readTrimmed(message.message).length > 0)
    .map((message) => ({
      role: message.isSupport ? 'assistant' as const : 'user' as const,
      content: message.message}))
    .slice(-8);
}

function formatSessionLabel(session: PublicChatSessionSummary): string {
  const preview = readTrimmed(session.lastMessagePreview);
  if (preview) {
    return preview.length > 42 ? `${preview.slice(0, 42)}…` : preview;
  }
  return `${session.messageCount} saved messages`;
}

const StatusChip = React.memo(function StatusChip({ label, tone, icon }: StatusChipProps) {
  const color = tone === 'live' ? Colors.success : tone === 'warn' ? Colors.warning : Colors.error;
  const backgroundColor = tone === 'live' ? 'rgba(34, 197, 94, 0.12)' : tone === 'warn' ? 'rgba(245, 158, 11, 0.14)' : 'rgba(239, 68, 68, 0.14)';
  const borderColor = tone === 'live' ? 'rgba(34, 197, 94, 0.24)' : tone === 'warn' ? 'rgba(245, 158, 11, 0.24)' : 'rgba(239, 68, 68, 0.24)';
  const chipIcon = icon === 'shield'
    ? <ShieldCheck size={14} color={color} />
    : icon === 'archive'
      ? <Archive size={14} color={color} />
      : icon === 'sparkles'
        ? <Sparkles size={14} color={color} />
        : tone === 'error'
          ? <WifiOff size={14} color={color} />
          : <Wifi size={14} color={color} />;

  return (
    <View style={[styles.statusChip, { backgroundColor, borderColor }]} testID={`public-chat-status-${label.replace(/\s+/g, '-').toLowerCase()}`}>
      {chipIcon}
      <Text style={[styles.statusChipText, { color }]}>{label}</Text>
    </View>
  );
});

export default function ChatHubScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 430;
  const listRef = useRef<FlatList<ChatMessage> | null>(null);
  const composerInputRef = useRef<TextInput | null>(null);
  const pulse = useRef(new Animated.Value(0.96)).current;
  const { sessionId, clientId, isHydrated, setActiveSession, startNewSession } = usePublicChatSession();
  const { keyboardHeight: webKeyboardHeight } = useWebKeyboard();
  const [composerValue, setComposerValue] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>(() => [createWelcomeMessage()]);
  const [latestResponse, setLatestResponse] = useState<PublicChatApiResponse | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const healthQuery = useQuery<PublicHealthResponse, Error>({
    queryKey: ['public-chat', 'health'],
    queryFn: fetchPublicChatHealth,
    staleTime: 20_000,
    refetchInterval: 30_000,
    retry: 1});

  const historyQuery = useQuery<PublicChatHistoryResponse, Error>({
    queryKey: ['public-chat', 'history', sessionId],
    queryFn: async () => fetchPublicChatHistory(sessionId, HISTORY_LIMIT, clientId),
    enabled: isHydrated && Boolean(sessionId),
    staleTime: 5_000,
    retry: 1});

  const sessionsQuery = useQuery({
    queryKey: ['public-chat', 'sessions', clientId],
    queryFn: async () => fetchPublicChatSessions(SESSION_LIMIT, clientId),
    enabled: isHydrated,
    staleTime: 10_000,
    retry: 1});

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.96, duration: 1400, useNativeDriver: true }),
      ]),
    ).start();
  }, [pulse]);

  useEffect(() => {
    listRef.current?.scrollToEnd({ animated: true });
  }, [messages]);

  // Track whether a send is in-flight so the history-restoration effect does
  // NOT clobber the optimistic user + assistant bubbles we just placed. Without
  // this guard, the `historyQuery.refetch()` call inside `sendMutation.onSuccess`
  // resolves with a history snapshot that may not yet include the just-persisted
  // assistant reply, causing the assistant message to vanish from the UI (the
  // "disappearing chat" bug). We only let history fully replace the local list
  // when no send is pending; otherwise we merge so the optimistic bubbles win.
  const sendInFlightRef = useRef(false);

  const sendMutation = useMutation<PublicChatApiResponse, Error, SendMutationInput>({
    mutationKey: ['public-chat', 'send', sessionId],
    mutationFn: async ({ text, requestId, history }) => sendPublicChatMessage({
      message: text,
      history,
      sessionId,
      requestId,
      clientId}),
    onMutate: async ({ text, requestId }) => {
      const pendingMessage: ChatMessage = {
        id: `${requestId}-user-pending`,
        senderId: 'public-chat-user',
        senderName: 'You',
        senderAvatar: '',
        message: text,
        timestamp: new Date().toISOString(),
        isSupport: false,
        status: 'sent'};
      setMessages((current) => mergeMessages(current.filter((message) => message.id !== 'public-chat-welcome'), [pendingMessage]));
      setComposerValue('');
    },
    onSuccess: async (response, variables) => {
      setLatestResponse(response);
      setLocalError(null);
      const assistantMessage: ChatMessage = {
        id: `${response.requestId}-assistant`,
        senderId: 'public-chat-assistant',
        senderName: 'IVX AI',
        senderAvatar: '',
        message: response.answer,
        timestamp: response.timestamp,
        isSupport: true,
        status: 'read'};
      setMessages((current) => mergeMessages(current.filter((message) => message.id !== `${variables.requestId}-user-pending`), [
        {
          id: `${response.requestId}-user`,
          senderId: 'public-chat-user',
          senderName: 'You',
          senderAvatar: '',
          message: variables.text,
          timestamp: response.timestamp,
          isSupport: false,
          status: 'read'},
        assistantMessage,
      ]));
      void historyQuery.refetch();
      void sessionsQuery.refetch();
      await Haptics.selectionAsync();
    },
    onError: async (error) => {
      setLocalError(error.message);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }});

  const canSend = useMemo<boolean>(() => {
    return readTrimmed(composerValue).length > 0 && !sendMutation.isPending && isHydrated;
  }, [composerValue, isHydrated, sendMutation.isPending]);

  // Sync the in-flight ref now that sendMutation exists.
  useEffect(() => {
    sendInFlightRef.current = sendMutation.isPending;
  }, [sendMutation.isPending]);

  // History restoration — preserve optimistic bubbles while a send is pending.
  useEffect(() => {
    if (!historyQuery.data) return;
    const restoredMessages = historyQuery.data.messages.map(mapPublicMessageToChatMessage);
    if (restoredMessages.length === 0) {
      // Only fall back to the welcome message when we are not mid-send;
      // otherwise keep the optimistic bubbles visible until the send settles.
      if (!sendInFlightRef.current) {
        setMessages([createWelcomeMessage()]);
      }
      setLocalError(null);
      return;
    }
    const incoming = trimMessages(restoredMessages);
    setMessages((current) => {
      // If a send is in-flight, preserve optimistic assistant + user bubbles
      // that history may not have persisted yet. Merge by id so persisted
      // duplicates replace their optimistic counterparts, but never drop a
      // local-only optimistic bubble.
      if (sendInFlightRef.current) {
        return mergeMessages(current, incoming);
      }
      return incoming;
    });
    setLocalError(null);
  }, [historyQuery.data]);

  const aiProvider = healthQuery.data?.aiProvider ?? (healthQuery.data?.aiEnabled ? 'chatgpt' : 'fallback');
  const source = latestResponse?.source ?? aiProvider;
  const model = latestResponse?.model ?? healthQuery.data?.openAIModel ?? 'openai/gpt-4o';
  const persistence = latestResponse?.persistence ?? historyQuery.data?.persistence ?? sessionsQuery.data?.persistence ?? 'pending';
  const deploymentMarker = latestResponse?.deploymentMarker ?? historyQuery.data?.deploymentMarker ?? healthQuery.data?.deploymentMarker ?? null;
  const messageCount = historyQuery.data?.messageCount ?? messages.filter((message) => message.id !== 'public-chat-welcome').length;
  const isRefreshing = healthQuery.isRefetching || historyQuery.isRefetching || sessionsQuery.isRefetching;
  const statusError = localError ?? historyQuery.error?.message ?? sessionsQuery.error?.message ?? healthQuery.error?.message ?? null;

  const heroSubtitle = useMemo<string>(() => {
    if (statusError) return statusError;
    if (!isHydrated) return 'Restoring your saved public-chat session on this device.';
    if (source === 'chatgpt') return 'Live ChatGPT is connected. Your current session is persisted and can be restored after reload.';
    return 'Public chat is online; emergency fallback will be clearly labeled if the provider is unavailable.';
  }, [isHydrated, source, statusError]);

  const handleRefresh = useCallback(() => {
    void Promise.all([
      healthQuery.refetch(),
      historyQuery.refetch(),
      sessionsQuery.refetch(),
    ]);
  }, [healthQuery, historyQuery, sessionsQuery]);

  const handleNewChat = useCallback(async () => {
    const nextSessionId = await startNewSession();
    console.log('[ChatHub] Started new public chat session', { sessionId: nextSessionId });
    setMessages([createWelcomeMessage()]);
    setLatestResponse(null);
    setLocalError(null);
    await Haptics.selectionAsync();
    void sessionsQuery.refetch();
  }, [sessionsQuery, startNewSession]);

  const handleSelectSession = useCallback(async (nextSessionId: string) => {
    if (nextSessionId === sessionId) return;
    await setActiveSession(nextSessionId);
    setMessages([createWelcomeMessage()]);
    setLatestResponse(null);
    setLocalError(null);
    await Haptics.selectionAsync();
  }, [sessionId, setActiveSession]);

  const handleSend = useCallback(async () => {
    const text = readTrimmed(composerValue);
    if (!text || sendMutation.isPending) return;
    const requestId = createId('public-chat-request');
    await sendMutation.mutateAsync({
      text,
      requestId,
      history: buildHistoryPayload(messages)});
  }, [composerValue, messages, sendMutation]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    return <ChatBubble message={item} />;
  }, []);

  const renderSession = useCallback(({ item }: { item: PublicChatSessionSummary }) => {
    const isActive = item.sessionId === sessionId;
    return (
      <Pressable
        onPress={() => {
          void handleSelectSession(item.sessionId);
        }}
        style={({ pressed }) => [styles.sessionPill, isActive && styles.sessionPillActive, pressed && styles.sessionPillPressed]}
        testID={`public-chat-session-${item.sessionId}`}
      >
        <Text style={[styles.sessionPillTitle, isActive && styles.sessionPillTitleActive]} numberOfLines={1}>{formatSessionLabel(item)}</Text>
        <Text style={[styles.sessionPillMeta, isActive && styles.sessionPillMetaActive]}>{item.messageCount} messages</Text>
      </Pressable>
    );
  }, [handleSelectSession, sessionId]);

  return (
    <ErrorBoundary fallbackTitle="IVX public chat unavailable">
      <View style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <LinearGradient
          colors={['#040404', '#0C1116', '#040404']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <KeyboardAvoidingView
            style={[styles.keyboardView, Platform.OS === 'web' && { paddingBottom: webKeyboardHeight }]}
            behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          >
            <View style={styles.headerShell}>
              <Animated.View style={[styles.heroCard, { transform: [{ scale: pulse }] }]} testID="public-chat-hero-card">
                <LinearGradient
                  colors={['rgba(255, 215, 0, 0.18)', 'rgba(255, 215, 0, 0.04)', 'rgba(17, 17, 17, 0.96)']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.heroGradient}
                />
                <View style={styles.heroContent}>
                  <View style={styles.heroTopRow}>
                    <View style={styles.heroTextWrap}>
                      <Text style={styles.eyebrow}>CHAT.IVXHOLDING.COM</Text>
                      <Text style={styles.heroTitle}>IVX AI chat</Text>
                      <Text style={styles.heroSubtitle}>{heroSubtitle}</Text>
                    </View>
                    <View style={styles.heroActions}>
                      <Pressable
                        onPress={handleRefresh}
                        style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
                        testID="public-chat-refresh-button"
                      >
                        <RefreshCw size={16} color={Colors.text} />
                      </Pressable>
                      <Pressable
                        onPress={() => {
                          void handleNewChat();
                        }}
                        style={({ pressed }) => [styles.newChatButton, pressed && styles.newChatButtonPressed]}
                        testID="public-chat-new-session-button"
                      >
                        <MessageCirclePlus size={16} color={Colors.black} />
                        {!isCompact ? <Text style={styles.newChatText}>New chat</Text> : null}
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.chipRow}>
                    <StatusChip label={healthQuery.data?.ok ? 'API healthy' : healthQuery.error ? 'API issue' : 'Checking API'} tone={healthQuery.data?.ok ? 'live' : healthQuery.error ? 'error' : 'warn'} icon="wifi" />
                    <StatusChip label={source === 'chatgpt' ? 'ChatGPT live' : 'Fallback visible'} tone={source === 'chatgpt' ? 'live' : 'warn'} icon="shield" />
                  </View>
                  <View style={styles.chipRow}>
                    <StatusChip label={`${messageCount} saved`} tone="live" icon="archive" />
                    <StatusChip label={String(persistence)} tone={persistence === 'supabase' || persistence === 'json' ? 'live' : 'warn'} icon="sparkles" />
                  </View>
                </View>
              </Animated.View>

              <View style={styles.sessionCard} testID="public-chat-session-card">
                <View style={styles.sessionHeaderRow}>
                  <View>
                    <Text style={styles.sessionTitle}>Current session</Text>
                    <Text style={styles.sessionIdText} numberOfLines={1}>{sessionId}</Text>
                  </View>
                  <Text style={styles.sessionCountText}>{sessionsQuery.data?.sessionCount ?? 0} sessions</Text>
                </View>
                <FlatList
                  horizontal
                  data={sessionsQuery.data?.sessions ?? []}
                  renderItem={renderSession}
                  keyExtractor={(item) => item.sessionId}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.sessionListContent}
                  ListEmptyComponent={(
                    <Text style={styles.emptySessionText}>Saved sessions appear here after your first message.</Text>
                  )}
                  testID="public-chat-session-list"
                />
              </View>
            </View>

            <View style={styles.feedCard} testID="public-chat-feed-card">
              <View style={styles.feedHeaderRow}>
                <Text style={styles.feedTitle}>Chat history</Text>
                <Text style={styles.feedMetaText}>{model}</Text>
              </View>

              {statusError ? (
                <View style={styles.errorBanner} testID="public-chat-error-banner">
                  <WifiOff size={14} color={Colors.warning} />
                  <Text style={styles.errorBannerText}>{statusError}</Text>
                </View>
              ) : null}

              <FlatList
                ref={listRef}
                data={messages}
                renderItem={renderMessage}
                keyExtractor={(item) => item.id}
                contentContainerStyle={styles.listContent}
                showsVerticalScrollIndicator={false}
                refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={handleRefresh} tintColor={Colors.primary} />}
                ListFooterComponent={sendMutation.isPending || historyQuery.isLoading ? (
                  <View style={styles.typingRow} testID="public-chat-loading-state">
                    <ShimmerIndicator size="small" color={Colors.primary} />
                    <Text style={styles.typingText}>{sendMutation.isPending ? 'ChatGPT is replying…' : 'Restoring history…'}</Text>
                  </View>
                ) : <View style={styles.listFooterSpacing} />}
                testID="public-chat-message-list"
              />
            </View>

            <View style={styles.composerShell}>
              <View style={styles.composerCard} testID="public-chat-composer-card">
                <View style={styles.composerInputWrap}>
                  <Text style={styles.fieldLabel}>Message</Text>
                  <TextInput
                    ref={composerInputRef}
                    value={composerValue}
                    onChangeText={setComposerValue}
                    placeholder="Ask IVX AI a question"
                    placeholderTextColor={Colors.textTertiary}
                    multiline
                    maxLength={2000}
                    editable={!sendMutation.isPending && isHydrated}
                    style={styles.composerInput}
                    testID="public-chat-message-input"
                    onFocus={() => {
                      if (Platform.OS === 'web') {
                        const el = (composerInputRef.current as unknown as { _inputRef?: { current?: HTMLElement } } | null)?._inputRef?.current ?? null;
                        scrollInputIntoView(el);
                      }
                    }}
                  />
                </View>
                <Pressable
                  onPress={() => {
                    void handleSend();
                  }}
                  disabled={!canSend}
                  style={({ pressed }) => [styles.sendButton, !canSend && styles.sendButtonDisabled, pressed && canSend && styles.sendButtonPressed]}
                  testID="public-chat-send-button"
                >
                  <Send size={18} color={canSend ? Colors.black : Colors.textTertiary} />
                </Pressable>
              </View>
              <View style={styles.bottomMetaRow}>
                <Text style={styles.bottomMetaText}>{deploymentMarker ? `Deploy ${deploymentMarker}` : 'Deployment marker pending'}</Text>
                <Text style={styles.bottomMetaText}>{`${source} • ${latestResponse?.persistence ?? persistence}`}</Text>
              </View>
            </View>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#040404'},
  safeArea: {
    flex: 1},
  keyboardView: {
    flex: 1},
  headerShell: {
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12},
  heroCard: {
    position: 'relative',
    borderRadius: 28,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(255, 215, 0, 0.14)',
    backgroundColor: '#101010'},
  heroGradient: {
    ...StyleSheet.absoluteFillObject},
  heroContent: {
    padding: 20,
    gap: 14},
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12},
  heroTextWrap: {
    flex: 1},
  eyebrow: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.2},
  heroTitle: {
    color: Colors.text,
    fontSize: 30,
    fontWeight: '800' as const,
    marginTop: 4},
  heroSubtitle: {
    color: Colors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 10},
  heroActions: {
    flexDirection: 'row',
    gap: 8},
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: 'rgba(17, 17, 17, 0.92)',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center',
    justifyContent: 'center'},
  iconButtonPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.98 }]},
  newChatButton: {
    height: 40,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6},
  newChatButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }]},
  newChatText: {
    color: Colors.black,
    fontSize: 12,
    fontWeight: '800' as const},
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10},
  statusChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8},
  statusChipText: {
    fontSize: 12,
    fontWeight: '700' as const},
  sessionCard: {
    backgroundColor: 'rgba(14, 14, 14, 0.94)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    padding: 14,
    gap: 12},
  sessionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12},
  sessionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '800' as const},
  sessionIdText: {
    color: Colors.textTertiary,
    fontSize: 11,
    marginTop: 3,
    maxWidth: 260},
  sessionCountText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '800' as const},
  sessionListContent: {
    gap: 10,
    paddingRight: 4},
  sessionPill: {
    width: 178,
    borderRadius: 16,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 5},
  sessionPillActive: {
    backgroundColor: 'rgba(255, 215, 0, 0.12)',
    borderColor: 'rgba(255, 215, 0, 0.35)'},
  sessionPillPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.99 }]},
  sessionPillTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '700' as const},
  sessionPillTitleActive: {
    color: Colors.primary},
  sessionPillMeta: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const},
  sessionPillMetaActive: {
    color: Colors.textSecondary},
  emptySessionText: {
    color: Colors.textTertiary,
    fontSize: 12,
    lineHeight: 18,
    paddingVertical: 8},
  feedCard: {
    flex: 1,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 12,
    borderRadius: 28,
    backgroundColor: 'rgba(10, 10, 10, 0.96)',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  feedHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
    gap: 12},
  feedTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '800' as const},
  feedMetaText: {
    flex: 1,
    textAlign: 'right',
    color: Colors.textTertiary,
    fontSize: 12,
    fontWeight: '700' as const},
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 18,
    marginBottom: 8,
    borderRadius: 14,
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.24)',
    paddingHorizontal: 12,
    paddingVertical: 10},
  errorBannerText: {
    flex: 1,
    color: Colors.warning,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: '600' as const},
  listContent: {
    paddingTop: 6,
    paddingBottom: 14},
  typingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 18,
    marginTop: 4,
    marginBottom: 6,
    borderRadius: 16,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 14,
    paddingVertical: 12},
  typingText: {
    color: Colors.textSecondary,
    fontSize: 13,
    fontWeight: '600' as const},
  listFooterSpacing: {
    height: 8},
  composerShell: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 10},
  composerCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 12,
    borderRadius: 24,
    backgroundColor: 'rgba(12, 12, 12, 0.98)',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingHorizontal: 16,
    paddingVertical: 14},
  composerInputWrap: {
    flex: 1,
    gap: 8},
  fieldLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.8,
    textTransform: 'uppercase'},
  composerInput: {
    minHeight: 30,
    maxHeight: 120,
    color: Colors.text,
    fontSize: 15,
    lineHeight: 21,
    paddingTop: 0,
    paddingBottom: 0,
    ...(Platform.OS === 'web'
      ? ({
          // @ts-ignore: web-only CSS properties for Samsung keyboard fix
          touchAction: 'manipulation',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          outlineStyle: 'none'} as any)
      : {})},
  sendButton: {
    width: 48,
    height: 48,
    borderRadius: 18,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center'},
  sendButtonPressed: {
    opacity: 0.9,
    transform: [{ scale: 0.98 }]},
  sendButtonDisabled: {
    backgroundColor: Colors.backgroundSecondary},
  bottomMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    paddingHorizontal: 4},
  bottomMetaText: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const}});
