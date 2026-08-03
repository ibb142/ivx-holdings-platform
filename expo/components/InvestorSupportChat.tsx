import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  Animated,
  useWindowDimensions,
  Alert,
  Keyboard,
  Image,
  type StyleProp,
  type ViewStyle,
  type NativeSyntheticEvent,
  type NativeScrollEvent} from "react-native";
import * as Haptics from 'expo-haptics';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowRight, Bot, CheckCircle, ChevronDown, FileText, Headphones, Paperclip, Send, Sparkles, X } from 'lucide-react-native';
import Colors from '@/constants/colors';
import { IVX_OWNER_AI_PROFILE } from '@/constants/ivx-owner-ai';
import { useTranslation } from '@/lib/i18n-context';
import { getResponsiveSize, isExtraSmallScreen } from '@/lib/responsive';
import { aiInvestorService } from '@/lib/ai-investor-service';
import { awsAnalyticsBackup } from '@/lib/aws-analytics-backup';
import type { AWSAnalyticsEvent } from '@/lib/aws-analytics-backup';
import type { ChatAttachment, ChatMessage } from '@/types';
import ChatBubble from '@/components/ChatBubble';
import {
  createPendingAttachment,
  pickChatDocument,
  pickChatImage,
  toPublicChatPayload,
  uploadChatAttachment} from '@/lib/chat-attachments';
import { loadChatHistory, saveChatHistory } from '@/lib/chat-persistence';
import { useWebKeyboard, scrollInputIntoView } from '@/hooks/useWebKeyboard';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import {
  isAtBottom as isAtBottomEngine,
  shouldShowJumpButton,
  createScrollRetrySchedule,
  shouldRetryScroll,
  getScrollToIndexTarget,
  shouldUseScrollToIndexFallback,
  getWebScrollDelay,
  MAX_SCROLL_RETRIES} from '@/src/modules/chat/chatScrollEngine';

type ConnectionStatus = 'connecting' | 'connected' | 'waiting';

type ChatVariant = 'screen' | 'card';

const DEFAULT_QUICK_REPLIES = IVX_OWNER_AI_PROFILE.support.quickReplies;

const DEFAULT_WELCOME_MESSAGE = IVX_OWNER_AI_PROFILE.support.welcomeMessage;

const MAX_RENDERED_MESSAGES = 120;

function trimMessages(nextMessages: ChatMessage[]): ChatMessage[] {
  if (nextMessages.length <= MAX_RENDERED_MESSAGES) {
    return nextMessages;
  }

  return nextMessages.slice(nextMessages.length - MAX_RENDERED_MESSAGES);
}

export interface HumanSupportRequestResult {
  ok: boolean;
  message: string;
}

interface InvestorSupportChatProps {
  variant?: ChatVariant;
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  source: AWSAnalyticsEvent['source'];
  testIdPrefix: string;
  keyboardVerticalOffset?: number;
  extraBottomInset?: number;
  requestHumanLabel?: string;
  welcomeMessage?: string;
  onRequestHumanSupport: (messages: ChatMessage[]) => Promise<HumanSupportRequestResult>;
  quickReplies?: readonly string[];
}

export default function InvestorSupportChat({
  variant = 'screen',
  style,
  contentStyle,
  source,
  testIdPrefix,
  keyboardVerticalOffset = 0,
  extraBottomInset = 0,
  requestHumanLabel,
  welcomeMessage = DEFAULT_WELCOME_MESSAGE,
  onRequestHumanSupport,
  quickReplies = DEFAULT_QUICK_REPLIES}: InvestorSupportChatProps) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'msg-welcome',
      senderId: 'support-1',
      senderName: IVX_OWNER_AI_PROFILE.support.assistantDisplayName,
      senderAvatar: '',
      message: welcomeMessage,
      timestamp: new Date().toISOString(),
      isSupport: true,
      status: 'read'},
  ]);
  const [inputText, setInputText] = useState<string>('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connected');
  const [isAiTyping, setIsAiTyping] = useState<boolean>(false);
  const [isEscalating, setIsEscalating] = useState<boolean>(false);
  const [isKeyboardVisible, setIsKeyboardVisible] = useState<boolean>(false);
  const inputRef = useRef<TextInput | null>(null);
  const { keyboardHeight: webKeyboardHeight } = useWebKeyboard();
  const [_aiProvider, setAiProvider] = useState<string>('');
  const [showJumpToLatest, setShowJumpToLatest] = useState<boolean>(false);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const hydratedRef = useRef<boolean>(false);
  const messagesListRef = useRef<FlatList<ChatMessage>>(null);
  const isAtBottomRef = useRef<boolean>(true);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const jumpButtonAnim = useRef(new Animated.Value(0)).current;

  const screenSize = getResponsiveSize(width);
  const isXs = isExtraSmallScreen(screenSize);
  const isCard = variant === 'card';
  const composerBottomPadding = useMemo(() => {
    if (isCard) {
      return 10;
    }

    const accessoryInset = isKeyboardVisible ? 0 : extraBottomInset;
    return Math.max(insets.bottom + accessoryInset, 8 + accessoryInset);
  }, [extraBottomInset, insets.bottom, isCard, isKeyboardVisible]);

  // DEF-SCROLL-1/2/3/4 FIX: Retry-based scroll with scrollToIndex fallback.
  // The old single-attempt scrollToEnd silently failed when the FlatList
  // hadn't finished measuring dynamic message bubbles, leaving the viewport
  // at the top (months-old messages). The retry loop gives the layout engine
  // multiple frames to measure content, and the scrollToIndex fallback
  // forces a measurement on the last item.
  const scrollToLatest = useCallback((animated: boolean = true) => {
    const schedule = createScrollRetrySchedule(MAX_SCROLL_RETRIES);
    const useIndexFallback = shouldUseScrollToIndexFallback(Platform.OS);

    const attemptScroll = (attempt: number) => {
      const list = messagesListRef.current;
      if (!list) return;

      const doScroll = () => {
        const currentList = messagesListRef.current;
        if (!currentList) return;

        try {
          currentList.scrollToEnd({ animated: attempt === 0 ? animated : false });
        } catch {
          // scrollToEnd can throw on empty lists — ignore
        }

        // DEF-SCROLL-2 FIX: On native, scrollToEnd can silently fail when
        // the FlatList hasn't finished laying out. scrollToIndex forces a
        // measurement on the target item, making the scroll reliable.
        if (useIndexFallback) {
          const targetIndex = getScrollToIndexTarget(messages.length);
          if (targetIndex >= 0) {
            try {
              currentList.scrollToIndex({
                index: targetIndex,
                animated: false,
                viewPosition: 1});
            } catch {
              // scrollToIndex can throw if the index is out of range
              // during rapid updates — the retry loop handles this.
            }
          }
        }
      };

      if (Platform.OS === 'web') {
        const delay = getWebScrollDelay(attempt);
        setTimeout(doScroll, delay);
      } else {
        requestAnimationFrame(doScroll);
      }

      // Schedule next retry if attempts remain
      if (shouldRetryScroll(attempt, MAX_SCROLL_RETRIES)) {
        setTimeout(() => attemptScroll(attempt + 1), schedule[attempt + 1] ?? 400);
      }
    };

    attemptScroll(0);
    isAtBottomRef.current = true;
    setShowJumpToLatest(false);
  }, [messages.length]);

  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToLatest(true);
    }
  }, [isAiTyping, isKeyboardVisible, messages, scrollToLatest]);

  useEffect(() => {
    Animated.timing(jumpButtonAnim, {
      toValue: showJumpToLatest ? 1 : 0,
      duration: 180,
      useNativeDriver: true}).start();
  }, [showJumpToLatest, jumpButtonAnim]);

  // DEF-SCROLL-5 FIX: Use the engine's dynamic threshold which accounts for
  // large message bubbles (image attachments are 180px+). The old fixed 80px
  // threshold caused isAtBottomRef to flip to false after a layout pass when
  // the last message was an image, stopping auto-scroll prematurely.
  const handleListScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const isScrollable = contentSize.height > layoutMeasurement.height + 40;
    const atBottom = isAtBottomEngine(
      contentOffset.y,
      contentSize.height,
      layoutMeasurement.height,
      messages.length,
    );
    isAtBottomRef.current = atBottom;
    setShowJumpToLatest(shouldShowJumpButton(isScrollable, atBottom));
  }, [messages.length]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await loadChatHistory(source);
      if (!cancelled && stored && stored.length > 0) {
        console.log('[InvestorSupportChat] Restored', stored.length, 'persisted messages for source:', source);
        setMessages(trimMessages(stored));
      }
      hydratedRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [source]);

  useEffect(() => {
    if (!hydratedRef.current) {
      return;
    }
    void saveChatHistory(source, messages);
  }, [messages, source]);

  // Instant connected state — no artificial delays. The previous
  // 2-second connecting→waiting→connected sequence caused unnecessary
  // loading spinners that blocked the chat UI on every open.
  useEffect(() => {
    setConnectionStatus('connected');
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return;
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSubscription = Keyboard.addListener(showEvent, () => {
      console.log('[InvestorSupportChat] Keyboard shown');
      setIsKeyboardVisible(true);
      scrollToLatest(true);
    });

    const hideSubscription = Keyboard.addListener(hideEvent, () => {
      console.log('[InvestorSupportChat] Keyboard hidden');
      setIsKeyboardVisible(false);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, [scrollToLatest]);

  useEffect(() => {
    if (connectionStatus === 'connecting' || connectionStatus === 'waiting') {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.4,
            duration: 800,
            useNativeDriver: true}),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true}),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
  }, [connectionStatus, pulseAnim]);

  const appendSupportMessage = useCallback((message: string) => {
    const supportReply: ChatMessage = {
      id: `msg-support-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderId: 'ai-support',
      senderName: IVX_OWNER_AI_PROFILE.support.assistantDisplayName,
      senderAvatar: '',
      message,
      timestamp: new Date().toISOString(),
      isSupport: true,
      status: 'delivered'};

    setMessages((prev) => trimMessages([...prev, supportReply]));
  }, []);

  const handleSend = useCallback(async () => {
    if (isAiTyping) {
      return;
    }

    const userText = inputText.trim();
    const readyAttachments = attachments.filter((item) => item.status === 'ready');
    const hasUploading = attachments.some((item) => item.status === 'uploading');

    if (hasUploading) {
      Alert.alert('Please wait', 'Your attachment is still uploading. Try again in a moment.');
      return;
    }

    if (!userText && readyAttachments.length === 0) {
      return;
    }

    const attachmentSummary =
      readyAttachments.length > 0
        ? `📎 ${readyAttachments.length} attachment${readyAttachments.length > 1 ? 's' : ''}`
        : '';
    const displayText = userText || attachmentSummary;
    const promptText = userText || 'Please analyze the attached file(s) and extract the key figures.';

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      senderId: 'user-1',
      senderName: 'You',
      senderAvatar: '',
      message: displayText,
      timestamp: new Date().toISOString(),
      isSupport: false,
      status: 'sent',
      attachments: readyAttachments.length > 0 ? readyAttachments : undefined};

    // Pass the PRIOR conversation as history. The provider chain sends the prompt
    // separately as the current message, so including it here too would duplicate
    // the current turn in the model context (duplicate-message insertion).
    const priorMessages = messages;
    setMessages((prev) => trimMessages([...prev, userMessage]));
    setInputText('');
    setAttachments([]);
    setIsAiTyping(true);

    try {
      const { images, documents } = toPublicChatPayload(readyAttachments);
      const result = await aiInvestorService.generateResponse(
        promptText,
        undefined,
        undefined,
        priorMessages,
        images.length > 0 || documents.length > 0 ? { images, documents } : undefined
      );
      setAiProvider(result.provider);
      console.log('[InvestorSupportChat] AI response via', result.provider, '| lang:', result.language, '| failovers:', result.failovers, '| source:', source);

      const aiReply: ChatMessage = {
        id: `msg-ai-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        senderId: 'ai-support',
        senderName: IVX_OWNER_AI_PROFILE.support.assistantDisplayName,
        senderAvatar: '',
        message: result.text,
        timestamp: new Date().toISOString(),
        isSupport: true,
        status: 'delivered',
        meta: {
          provider: result.provider,
          route: result.meta?.route,
          source: result.meta?.source,
          model: result.meta?.model,
          deploymentMarker: result.meta?.deploymentMarker}};

      setMessages((prev) => trimMessages([...prev, aiReply]));
      setIsAiTyping(false);

      try {
        awsAnalyticsBackup.enqueue({
          id: `chat_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
          event: 'ai_chat_interaction',
          session_id: `${source}_${Date.now()}`,
          properties: {
            user_message_length: userText.length,
            attachment_count: readyAttachments.length,
            ai_provider: result.provider,
            language: result.language,
            failovers: result.failovers},
          platform: Platform.OS,
          source,
          timestamp: new Date().toISOString(),
          created_at: new Date().toISOString()});
      } catch (analyticsError) {
        console.log('[InvestorSupportChat] Analytics enqueue failed:', (analyticsError as Error)?.message);
      }
    } catch (error) {
      console.error('[InvestorSupportChat] AI error:', error);
      setIsAiTyping(false);
      appendSupportMessage("I'm having trouble right now. Please try again in a moment or request human support below.");
    }
  }, [appendSupportMessage, attachments, inputText, isAiTyping, messages, source]);

  const handleQuickReply = useCallback((reply: string) => {
    setInputText(reply);
  }, []);

  const handleAddAttachment = useCallback(async (kind: 'image' | 'document') => {
    try {
      const file = kind === 'image' ? await pickChatImage() : await pickChatDocument();
      if (!file) {
        return;
      }

      const pending = createPendingAttachment(file);
      setAttachments((prev) => [...prev, pending]);
      void Haptics.selectionAsync();

      try {
        const url = await uploadChatAttachment(file);
        setAttachments((prev) =>
          prev.map((item) => (item.id === pending.id ? { ...item, url, status: 'ready' as const } : item))
        );
      } catch (uploadError) {
        const message = (uploadError as Error)?.message ?? 'Upload failed';
        console.error('[InvestorSupportChat] Attachment upload failed:', message);
        setAttachments((prev) =>
          prev.map((item) => (item.id === pending.id ? { ...item, status: 'failed' as const, error: message } : item))
        );
        Alert.alert('Attachment upload failed', message);
      }
    } catch (pickError) {
      const message = (pickError as Error)?.message ?? 'Could not attach file';
      console.error('[InvestorSupportChat] Attachment pick failed:', message);
      Alert.alert('Could not attach file', message);
    }
  }, []);

  const handleAttachPress = useCallback(() => {
    Keyboard.dismiss();
    Alert.alert('Attach a file', 'Add a screenshot or a deal-room document for the AI to analyze.', [
      {
        text: 'Photo / Image',
        onPress: () => {
          void handleAddAttachment('image');
        }},
      {
        text: 'Document (PDF / CSV)',
        onPress: () => {
          void handleAddAttachment('document');
        }},
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [handleAddAttachment]);

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleRequestHuman = useCallback(async () => {
    if (isEscalating) {
      return;
    }

    setIsEscalating(true);

    try {
      const result = await onRequestHumanSupport(messages);
      appendSupportMessage(result.message);

      if (result.ok) {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (error) {
      console.error('[InvestorSupportChat] Human support request failed:', error);
      appendSupportMessage('We could not connect human support right now. Please try again shortly or contact investors@ivxholding.com.');
      Alert.alert('Support unavailable', 'Please try again in a moment.');
    } finally {
      setIsEscalating(false);
    }
  }, [appendSupportMessage, isEscalating, messages, onRequestHumanSupport]);

  const renderMessage = useCallback(({ item }: { item: ChatMessage }) => {
    return <ChatBubble message={item} />;
  }, []);

  const keyExtractor = useCallback((item: ChatMessage) => item.id, []);

  const welcomeHeader = useMemo(() => {
    return (
      <View style={[styles.welcomeCard, isCard && styles.welcomeCardCompact, { marginHorizontal: isXs ? 12 : 16, padding: isXs ? 16 : 20 }]}>
        <View style={[styles.welcomeIconContainer, { width: isXs ? 48 : 56, height: isXs ? 48 : 56 }]}>
          <Headphones size={isXs ? 24 : 28} color={Colors.primary} />
        </View>
        <Text style={[styles.welcomeTitle, { fontSize: isXs ? 16 : 18 }]}>{t('welcomeSupport')}</Text>
        <Text style={[styles.welcomeText, { fontSize: isXs ? 12 : 14 }]}>
          {t('welcomeSupportDesc')}
        </Text>
        <View style={[styles.welcomeFeatures, { flexDirection: isXs ? 'column' : 'row', gap: isXs ? 8 : 16 }]}>
          <View style={styles.welcomeFeature}>
            <CheckCircle size={isXs ? 12 : 14} color={Colors.success} />
            <Text style={[styles.welcomeFeatureText, { fontSize: isXs ? 11 : 12 }]}>{t('avgResponse')}</Text>
          </View>
          <View style={styles.welcomeFeature}>
            <CheckCircle size={isXs ? 12 : 14} color={Colors.success} />
            <Text style={[styles.welcomeFeatureText, { fontSize: isXs ? 11 : 12 }]}>{t('expertAgents')}</Text>
          </View>
        </View>
        <TouchableOpacity
          style={[styles.startChatButton, { paddingVertical: isXs ? 12 : 14, paddingHorizontal: isXs ? 16 : 20 }, isEscalating && styles.startChatButtonDisabled]}
          disabled={isEscalating}
          onPress={() => {
            void handleRequestHuman();
          }}
          activeOpacity={0.85}
          testID={`${testIdPrefix}-request-human`}
        >
          <Headphones size={isXs ? 16 : 18} color={Colors.black} />
          <Text style={[styles.startChatText, { fontSize: isXs ? 13 : 15 }]}>{requestHumanLabel ?? t('startLiveHuman')}</Text>
          <ArrowRight size={isXs ? 16 : 18} color={Colors.black} />
        </TouchableOpacity>
      </View>
    );
  }, [handleRequestHuman, isCard, isEscalating, isXs, requestHumanLabel, t, testIdPrefix]);

  const hasUploadingAttachment = attachments.some((item) => item.status === 'uploading');
  const hasReadyAttachment = attachments.some((item) => item.status === 'ready');
  const canSendMessage = (inputText.trim().length > 0 || hasReadyAttachment) && !isAiTyping && !hasUploadingAttachment;

  const renderAttachmentPreview = useCallback(() => {
    if (attachments.length === 0) {
      return null;
    }

    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.attachmentBar}
        contentContainerStyle={styles.attachmentBarContent}
        keyboardShouldPersistTaps="handled"
        testID={`${testIdPrefix}-attachment-bar`}
      >
        {attachments.map((attachment) => (
          <View key={attachment.id} style={styles.attachmentChip}>
            {attachment.kind === 'image' && attachment.localUri ? (
              <Image source={{ uri: attachment.localUri }} style={styles.attachmentThumb} />
            ) : (
              <View style={styles.attachmentDocIcon}>
                <FileText size={16} color={Colors.primary} />
              </View>
            )}
            <View style={styles.attachmentInfo}>
              <Text style={styles.attachmentName} numberOfLines={1}>{attachment.name}</Text>
              <View style={styles.attachmentStatusRow}>
                {attachment.status === 'uploading' ? (
                  <ShimmerIndicator size="small" color={Colors.textTertiary} />
                ) : null}
                <Text
                  style={[
                    styles.attachmentStatus,
                    attachment.status === 'ready' && styles.attachmentStatusReady,
                    attachment.status === 'failed' && styles.attachmentStatusFailed,
                  ]}
                  numberOfLines={1}
                >
                  {attachment.status === 'uploading' ? 'Uploading…' : attachment.status === 'ready' ? 'Ready' : 'Failed'}
                </Text>
              </View>
            </View>
            <TouchableOpacity
              style={styles.attachmentRemove}
              onPress={() => handleRemoveAttachment(attachment.id)}
              accessibilityRole="button"
              accessibilityLabel={`Remove ${attachment.name}`}
              testID={`${testIdPrefix}-remove-attachment`}
            >
              <X size={14} color={Colors.textTertiary} />
            </TouchableOpacity>
          </View>
        ))}
      </ScrollView>
    );
  }, [attachments, handleRemoveAttachment, testIdPrefix]);

  const renderConnectionStatus = useCallback(() => {
    return (
      <View style={[styles.connectionStatusContainer, isCard && styles.connectionStatusContainerCard]}>
        <View style={styles.connectionStatusInner}>
          {connectionStatus === 'connecting' ? (
            <>
              <Animated.View style={[styles.statusDot, styles.statusDotConnecting, { opacity: pulseAnim }]} />
              <View style={styles.connectionTextContainer}>
                <Text style={styles.connectionStatusText}>{t('connectingAi')}</Text>
                <Text style={styles.connectionSubText}>{t('pleaseWaitMoment')}</Text>
              </View>
            </>
          ) : null}

          {connectionStatus === 'waiting' ? (
            <>
              <Animated.View style={[styles.statusDot, styles.statusDotWaiting, { opacity: pulseAnim }]} />
              <View style={styles.connectionTextContainer}>
                <Text style={styles.connectionStatusText}>{t('initializingAi')}</Text>
                <Text style={styles.connectionSubText}>{t('almostReady')}</Text>
              </View>
            </>
          ) : null}

          {connectionStatus === 'connected' ? (
            <>
              <View style={[styles.statusDot, styles.statusDotConnected]} />
              <View style={styles.connectionTextContainer}>
                <View style={styles.aiConnectedRow}>
                  <Text style={styles.connectionStatusText}>{t('aiReady')}</Text>
                  <View style={styles.aiBadgeSmall}>
                    <Sparkles size={10} color={Colors.primary} />
                  </View>
                </View>
                <Text style={styles.connectionSubTextOnline}>{t('aiInstantResponses')}</Text>
              </View>
              <View style={styles.agentAvatarContainer}>
                <Bot size={18} color={Colors.primary} />
              </View>
            </>
          ) : null}
        </View>

        {isAiTyping ? (
          <View style={styles.typingIndicator}>
            <Text style={styles.typingText}>{t('aiTyping')}</Text>
          </View>
        ) : null}
      </View>
    );
  }, [connectionStatus, isAiTyping, isCard, pulseAnim, t]);

  return (
    <View style={[styles.container, isCard && styles.containerCard, style]} testID={`${testIdPrefix}-container`}>
      {/*
        On web, KeyboardAvoidingView with behavior="height" causes layout
        shifts that make the TextInput lose focus mid-typing, which is why
        text disappears while typing. We skip it entirely on web where the
        browser handles keyboard/viewport natively via the VisualViewport API.
        The useWebKeyboard hook tracks keyboard height for proper composer
        positioning on Samsung Internet / Android Chrome.
      */}
      {Platform.OS === 'web' ? (
        <View style={[styles.keyboardContainer, { paddingBottom: webKeyboardHeight }]}>
          {renderConnectionStatus()}

          {isCard ? (
            <View
              style={[styles.messagesContainer, styles.messagesContainerCard, { paddingHorizontal: 0 }]}
              testID={`${testIdPrefix}-messages`}
            >
              {welcomeHeader}
              {messages.map((item) => (
                <View key={item.id}>
                  {renderMessage({ item })}
                </View>
              ))}
            </View>
          ) : (
            <View style={styles.listWrapper}>
              <FlatList
                ref={messagesListRef}
                data={messages}
                renderItem={renderMessage}
                keyExtractor={keyExtractor}
                style={[styles.messagesContainer, isCard && styles.messagesContainerCard]}
                contentContainerStyle={[styles.messagesContent, contentStyle]}
                ListHeaderComponent={welcomeHeader}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                initialNumToRender={12}
                maxToRenderPerBatch={12}
                windowSize={7}
                onScroll={handleListScroll}
                scrollEventThrottle={16}
                onContentSizeChange={() => {
                  if (isAtBottomRef.current) {
                    scrollToLatest(false);
                  }
                }}
                testID={`${testIdPrefix}-messages`}
              />
              <Animated.View
                pointerEvents={showJumpToLatest ? 'auto' : 'none'}
                style={[
                  styles.jumpToLatestWrapper,
                  {
                    opacity: jumpButtonAnim,
                    transform: [
                      { scale: jumpButtonAnim.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) },
                      { translateY: jumpButtonAnim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) },
                    ]},
                ]}
              >
                <TouchableOpacity
                  style={styles.jumpToLatestButton}
                  onPress={() => {
                    void Haptics.selectionAsync();
                    scrollToLatest(true);
                  }}
                  activeOpacity={0.85}
                  accessibilityRole="button"
                  accessibilityLabel="Jump to latest message"
                  testID={`${testIdPrefix}-jump-to-latest`}
                >
                  <ChevronDown size={22} color={Colors.black} />
                </TouchableOpacity>
              </Animated.View>
            </View>
          )}

          <View style={styles.quickRepliesContainer}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={[styles.quickRepliesContent, { paddingHorizontal: isXs ? 12 : 16 }]}
              keyboardShouldPersistTaps="handled"
              testID={`${testIdPrefix}-quick-replies`}
            >
              {quickReplies.map((reply, index) => (
                <TouchableOpacity
                  key={`${reply}-${index}`}
                  style={[styles.quickReplyButton, { paddingHorizontal: isXs ? 10 : 14, paddingVertical: isXs ? 6 : 8 }]}
                  onPress={() => handleQuickReply(reply)}
                  testID={`${testIdPrefix}-quick-reply-${index}`}
                >
                  <Text style={[styles.quickReplyText, { fontSize: isXs ? 11 : 13 }]}>{reply}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>

          <View style={[styles.inputContainer, { paddingHorizontal: isXs ? 12 : 16, paddingBottom: composerBottomPadding }]}>
            {renderAttachmentPreview()}
            <View style={styles.inputWrapper}>
              <TouchableOpacity
                style={[styles.attachButton, { width: isXs ? 44 : 50, height: isXs ? 44 : 50 }]}
                onPress={handleAttachPress}
                disabled={isAiTyping}
                accessibilityRole="button"
                accessibilityLabel="Attach a file"
                testID={`${testIdPrefix}-attach`}
              >
                <Paperclip size={isXs ? 18 : 20} color={isAiTyping ? Colors.textTertiary : Colors.textSecondary} />
              </TouchableOpacity>
              <TextInput
                ref={inputRef}
                style={[styles.input, { fontSize: isXs ? 14 : 16, minHeight: isXs ? 44 : 50, paddingHorizontal: isXs ? 14 : 18 }]}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('typeMessage')}
                placeholderTextColor={Colors.inputPlaceholder}
                multiline
                maxLength={500}
                testID={`${testIdPrefix}-input`}
                onFocus={() => {
                  if (Platform.OS === 'web') {
                    const el = (inputRef.current as unknown as { _inputRef?: { current?: HTMLElement } } | null)?._inputRef?.current ?? null;
                    scrollInputIntoView(el);
                  }
                }}
              />
              <TouchableOpacity
                style={[styles.sendButton, { width: isXs ? 44 : 50, height: isXs ? 44 : 50 }, !canSendMessage && styles.sendButtonDisabled]}
                onPress={() => {
                  void handleSend();
                }}
                disabled={!canSendMessage}
                testID={`${testIdPrefix}-send`}
              >
                <Send size={isXs ? 18 : 20} color={canSendMessage ? Colors.black : Colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      ) : (
      <KeyboardAvoidingView
        style={styles.keyboardContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? Math.max(keyboardVerticalOffset, 80) : keyboardVerticalOffset}
      >
        {renderConnectionStatus()}

        {isCard ? (
          <View
            style={[styles.messagesContainer, styles.messagesContainerCard, { paddingHorizontal: 0 }]}
            testID={`${testIdPrefix}-messages`}
          >
            {welcomeHeader}
            {messages.map((item) => (
              <View key={item.id}>
                {renderMessage({ item })}
              </View>
            ))}
          </View>
        ) : (
          <View style={styles.listWrapper}>
            <FlatList
              ref={messagesListRef}
              data={messages}
              renderItem={renderMessage}
              keyExtractor={keyExtractor}
              style={[styles.messagesContainer, isCard && styles.messagesContainerCard]}
              contentContainerStyle={[styles.messagesContent, contentStyle]}
              ListHeaderComponent={welcomeHeader}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
              initialNumToRender={12}
              maxToRenderPerBatch={12}
              windowSize={7}
              removeClippedSubviews
              onScroll={handleListScroll}
              scrollEventThrottle={16}
              onContentSizeChange={() => {
                if (isAtBottomRef.current) {
                  scrollToLatest(false);
                }
              }}
              testID={`${testIdPrefix}-messages`}
            />
            <Animated.View
              pointerEvents={showJumpToLatest ? 'auto' : 'none'}
              style={[
                styles.jumpToLatestWrapper,
                {
                  opacity: jumpButtonAnim,
                  transform: [
                    {
                      scale: jumpButtonAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [0.6, 1]})},
                    {
                      translateY: jumpButtonAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [12, 0]})},
                  ]},
              ]}
            >
              <TouchableOpacity
                style={styles.jumpToLatestButton}
                onPress={() => {
                  void Haptics.selectionAsync();
                  scrollToLatest(true);
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel="Jump to latest message"
                testID={`${testIdPrefix}-jump-to-latest`}
              >
                <ChevronDown size={22} color={Colors.black} />
              </TouchableOpacity>
            </Animated.View>
          </View>
        )}

        <View style={styles.quickRepliesContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={[styles.quickRepliesContent, { paddingHorizontal: isXs ? 12 : 16 }]}
            keyboardShouldPersistTaps="handled"
            testID={`${testIdPrefix}-quick-replies`}
          >
            {quickReplies.map((reply, index) => (
              <TouchableOpacity
                key={`${reply}-${index}`}
                style={[styles.quickReplyButton, { paddingHorizontal: isXs ? 10 : 14, paddingVertical: isXs ? 6 : 8 }]}
                onPress={() => handleQuickReply(reply)}
                testID={`${testIdPrefix}-quick-reply-${index}`}
              >
                <Text style={[styles.quickReplyText, { fontSize: isXs ? 11 : 13 }]}>{reply}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {isCard ? (
          <View style={[styles.inputContainer, { paddingHorizontal: isXs ? 12 : 16, paddingBottom: composerBottomPadding }]}>
            {renderAttachmentPreview()}
            <View style={styles.inputWrapper}>
              <TouchableOpacity
                style={[styles.attachButton, { width: isXs ? 44 : 50, height: isXs ? 44 : 50 }]}
                onPress={handleAttachPress}
                disabled={isAiTyping}
                accessibilityRole="button"
                accessibilityLabel="Attach a file"
                testID={`${testIdPrefix}-attach`}
              >
                <Paperclip size={isXs ? 18 : 20} color={isAiTyping ? Colors.textTertiary : Colors.textSecondary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, { fontSize: isXs ? 14 : 16, minHeight: isXs ? 44 : 50, paddingHorizontal: isXs ? 14 : 18 }]}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('typeMessage')}
                placeholderTextColor={Colors.inputPlaceholder}
                multiline
                maxLength={500}
                testID={`${testIdPrefix}-input`}
              />
              <TouchableOpacity
                style={[styles.sendButton, { width: isXs ? 44 : 50, height: isXs ? 44 : 50 }, !canSendMessage && styles.sendButtonDisabled]}
                onPress={() => {
                  void handleSend();
                }}
                disabled={!canSendMessage}
                testID={`${testIdPrefix}-send`}
              >
                <Send size={isXs ? 18 : 20} color={canSendMessage ? Colors.black : Colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <SafeAreaView edges={['bottom']} style={[styles.inputContainer, { paddingHorizontal: isXs ? 12 : 16, paddingBottom: composerBottomPadding }]}>
            {renderAttachmentPreview()}
            <View style={styles.inputWrapper}>
              <TouchableOpacity
                style={[styles.attachButton, { width: isXs ? 44 : 50, height: isXs ? 44 : 50 }]}
                onPress={handleAttachPress}
                disabled={isAiTyping}
                accessibilityRole="button"
                accessibilityLabel="Attach a file"
                testID={`${testIdPrefix}-attach`}
              >
                <Paperclip size={isXs ? 18 : 20} color={isAiTyping ? Colors.textTertiary : Colors.textSecondary} />
              </TouchableOpacity>
              <TextInput
                style={[styles.input, { fontSize: isXs ? 14 : 16, minHeight: isXs ? 44 : 50, paddingHorizontal: isXs ? 14 : 18 }]}
                value={inputText}
                onChangeText={setInputText}
                placeholder={t('typeMessage')}
                placeholderTextColor={Colors.inputPlaceholder}
                multiline
                maxLength={500}
                testID={`${testIdPrefix}-input`}
              />
              <TouchableOpacity
                style={[styles.sendButton, { width: isXs ? 44 : 50, height: isXs ? 44 : 50 }, !canSendMessage && styles.sendButtonDisabled]}
                onPress={() => {
                  void handleSend();
                }}
                disabled={!canSendMessage}
                testID={`${testIdPrefix}-send`}
              >
                <Send size={isXs ? 18 : 20} color={canSendMessage ? Colors.black : Colors.textTertiary} />
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        )}
      </KeyboardAvoidingView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  containerCard: {
    backgroundColor: '#090909',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#1F1F1F',
    overflow: 'hidden' as const},
  keyboardContainer: {
    flex: 1},
  connectionStatusContainer: {
    paddingHorizontal: 16,
    paddingVertical: 8},
  connectionStatusContainerCard: {
    paddingTop: 14},
  connectionStatusInner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5},
  statusDotConnecting: {
    backgroundColor: Colors.warning},
  statusDotWaiting: {
    backgroundColor: Colors.info},
  statusDotConnected: {
    backgroundColor: Colors.success},
  connectionTextContainer: {
    flex: 1},
  connectionStatusText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600' as const},
  connectionSubText: {
    color: Colors.textTertiary,
    fontSize: 12,
    marginTop: 2},
  connectionSubTextOnline: {
    color: Colors.success,
    fontSize: 12,
    marginTop: 2},
  agentAvatarContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  aiConnectedRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6},
  aiBadgeSmall: {
    backgroundColor: Colors.primary + '20',
    borderRadius: 6,
    padding: 3},
  typingIndicator: {
    paddingHorizontal: 12,
    paddingTop: 6},
  typingText: {
    color: Colors.textTertiary,
    fontSize: 12,
    fontStyle: 'italic' as const},
  listWrapper: {
    flex: 1,
    position: 'relative' as const},
  jumpToLatestWrapper: {
    position: 'absolute' as const,
    right: 16,
    bottom: 12},
  jumpToLatestButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: Colors.black,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 6,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  messagesContainer: {
    flex: 1,
    backgroundColor: Colors.background},
  messagesContainerCard: {
    backgroundColor: '#090909'},
  messagesContent: {
    paddingVertical: 12,
    gap: 4},
  welcomeCard: {
    backgroundColor: Colors.surface,
    borderRadius: 18,
    alignItems: 'center' as const,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  welcomeCardCompact: {
    marginTop: 2},
  welcomeIconContainer: {
    borderRadius: 28,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    marginBottom: 14},
  welcomeTitle: {
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8},
  welcomeText: {
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20,
    marginBottom: 16},
  welcomeFeatures: {
    alignItems: 'center' as const,
    marginBottom: 18},
  welcomeFeature: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6},
  welcomeFeatureText: {
    color: Colors.textSecondary},
  startChatButton: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 8,
    backgroundColor: Colors.primary,
    borderRadius: 14,
    width: '100%'},
  startChatButtonDisabled: {
    opacity: 0.65},
  startChatText: {
    fontWeight: '700' as const,
    color: Colors.black},
  quickRepliesContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    paddingVertical: 8},
  quickRepliesContent: {
    gap: 8},
  quickReplyButton: {
    backgroundColor: Colors.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  quickReplyText: {
    color: Colors.text},
  inputContainer: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    backgroundColor: Colors.background,
    paddingTop: 8},
  inputWrapper: {
    flexDirection: 'row' as const,
    alignItems: 'flex-end' as const,
    gap: 8},
  attachButton: {
    borderRadius: 25,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  attachmentBar: {
    marginBottom: 8,
    maxHeight: 70},
  attachmentBarContent: {
    gap: 8,
    paddingRight: 8},
  attachmentChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingVertical: 6,
    paddingLeft: 6,
    paddingRight: 10,
    maxWidth: 220},
  attachmentThumb: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: Colors.backgroundSecondary},
  attachmentDocIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  attachmentInfo: {
    flex: 1},
  attachmentName: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600' as const},
  attachmentStatusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 2},
  attachmentStatus: {
    color: Colors.textTertiary,
    fontSize: 11},
  attachmentStatusReady: {
    color: Colors.success},
  attachmentStatusFailed: {
    color: '#FF7D7D'},
  attachmentRemove: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: Colors.backgroundSecondary},
  input: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 24,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    paddingVertical: 10,
    maxHeight: 120,
    ...(Platform.OS === 'web'
      ? ({
          // @ts-ignore: web-only CSS properties for Samsung keyboard fix
          touchAction: 'manipulation',
          userSelect: 'text',
          WebkitUserSelect: 'text',
          outlineStyle: 'none'} as any)
      : {})},
  sendButton: {
    borderRadius: 25,
    backgroundColor: Colors.primary,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  sendButtonDisabled: {
    backgroundColor: Colors.surface}});
