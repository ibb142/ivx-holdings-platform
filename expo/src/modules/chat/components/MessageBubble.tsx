import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertCircle, Check, CheckCheck, Copy, Download, Eye, FileText, MessageCircle, Pin, PinOff, PlayCircle, RefreshCw, Reply, Smile, X } from 'lucide-react-native';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import Colors from '@/constants/colors';
import { openAttachment, shouldRenderInlineImage, shouldRenderTapToOpenAttachment } from '../services/ivxChat';
import { containsBlockedUserFacingChatText, redactUserFacingChatSecrets, sanitizeUserFacingChatText } from '../services/visibleTextSanitizer';
import { ReactionPicker, REACTION_EMOJIS } from './ReactionPicker';
import { ControlledImage } from '@/src/modules/media-lifecycle/components/ControlledImage';
import { ControlledVideo } from '@/src/modules/media-lifecycle/components/ControlledVideo';
import type { ChatMessage } from '../types/chat';
import type { MessageReactionSummary } from '../services/messageReactions';

type MessageBubbleProps = {
  message: ChatMessage;
  isMine: boolean;
  searchQuery?: string;
  onRetry?: (message: ChatMessage) => void;
  onDismiss?: (messageId: string) => void;
  onTogglePin?: (message: ChatMessage) => void;
  onReply?: (message: ChatMessage) => void;
  onOpenReplyContext?: (messageId: string) => void;
  isPinned?: boolean;
  reactions?: MessageReactionSummary[];
  onToggleReaction?: (messageId: string, emoji: string) => void;
  isStreaming?: boolean;
};

function useBlinkingCursor(): Animated.Value {
  const opacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.2, duration: 420, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 420, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => {
      animation.stop();
    };
  }, [opacity]);
  return opacity;
}

type HighlightSegment = {
  text: string;
  matched: boolean;
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getHighlightedSegments(text: string, query: string): HighlightSegment[] {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [{ text, matched: false }];
  }

  const segments: HighlightSegment[] = [];
  const matcher = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'ig');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ text: text.slice(lastIndex, match.index), matched: false });
    }

    segments.push({ text: match[0] ?? '', matched: true });
    lastIndex = match.index + (match[0]?.length ?? 0);
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), matched: false });
  }

  return segments.length > 0 ? segments : [{ text, matched: false }];
}

function formatMessageTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return 'Now';
  }

  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getAttachmentLabel(message: ChatMessage): string {
  if (message.fileName?.trim()) {
    return message.fileName.trim();
  }

  if (message.fileType === 'pdf') {
    return 'Open PDF attachment';
  }

  if (message.fileType === 'video') {
    return 'Open video attachment';
  }

  return 'Open file attachment';
}

export const MessageBubble = memo(function MessageBubble({
  message,
  isMine,
  searchQuery = '',
  onRetry,
  onDismiss,
  onTogglePin,
  onReply,
  onOpenReplyContext,
  isPinned = false,
  reactions,
  onToggleReaction,
  isStreaming = false,
}: MessageBubbleProps) {
  const fadeAnim = useRef(new Animated.Value(1)).current;
  const cursorOpacity = useBlinkingCursor();
  const [pickerVisible, setPickerVisible] = useState<boolean>(false);

  useEffect(() => {
    Animated.timing(fadeAnim, { toValue: 1, duration: 150, useNativeDriver: true }).start();
    return undefined;
  }, [message.sendStatus, fadeAnim]);

  const handleOpenAttachment = useCallback(async () => {
    console.log('[MessageBubble] Opening attachment:', message.fileUrl ?? null);

    try {
      await openAttachment(message.fileUrl);
    } catch (error) {
      console.log('[MessageBubble] Attachment open error:', (error as Error)?.message ?? 'Unknown error');
      Alert.alert('Attachment unavailable', 'This attachment could not be opened right now.');
    }
  }, [message.fileUrl]);

  const handleRetry = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onRetry?.(message);
  }, [message, onRetry]);

  const handleDismiss = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onDismiss?.(message.id);
  }, [message.id, onDismiss]);

  const handleTogglePin = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onTogglePin?.(message);
  }, [message, onTogglePin]);

  const handleReply = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onReply?.(message);
  }, [message, onReply]);

  const handleOpenReplyContext = useCallback(() => {
    const replyMessageId = message.replyTo?.messageId;
    if (!replyMessageId) {
      return;
    }
    void Haptics.selectionAsync();
    onOpenReplyContext?.(replyMessageId);
  }, [message.replyTo?.messageId, onOpenReplyContext]);

  const displayText = isMine ? redactUserFacingChatSecrets(message.text) : sanitizeUserFacingChatText(message.text);
  const toolUsedLabel = !isMine && typeof message.toolUsed === 'string' && message.toolUsed.trim().length > 0 ? message.toolUsed.trim() : null;
  const highlightedSegments = getHighlightedSegments(displayText, searchQuery);
  const handleCopy = useCallback(async () => {
    const textToCopy = displayText?.trim();
    if (!textToCopy) {
      return;
    }

    try {
      await Clipboard.setStringAsync(textToCopy);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      console.log('[MessageBubble] Message text copied:', message.id);
    } catch (error) {
      console.log('[MessageBubble] Copy failed:', error instanceof Error ? error.message : 'unknown');
      Alert.alert('Copy failed', 'Message text could not be copied right now.');
    }
  }, [displayText, message.id]);

  const handleLongPress = useCallback(() => {
    if (!onToggleReaction) {
      return;
    }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPickerVisible(true);
  }, [onToggleReaction]);

  const handlePickEmoji = useCallback((emoji: string) => {
    setPickerVisible(false);
    if (!onToggleReaction) {
      return;
    }
    void Haptics.selectionAsync();
    onToggleReaction(message.id, emoji);
  }, [message.id, onToggleReaction]);

  const handleToggleExistingReaction = useCallback((emoji: string) => {
    if (!onToggleReaction) {
      return;
    }
    void Haptics.selectionAsync();
    onToggleReaction(message.id, emoji);
  }, [message.id, onToggleReaction]);

  const hasVisibleAttachment = Boolean(message.fileUrl);
  // P0 FIX: always render the streaming assistant bubble even when text is empty,
  // so the user sees a live blinking cursor while the response is generated.
  const isStreamingEmptyBubble = Boolean(isStreaming) && !isMine && !displayText && !hasVisibleAttachment;
  if ((!isMine && containsBlockedUserFacingChatText(message.text)) || (!displayText && !hasVisibleAttachment && !isStreamingEmptyBubble)) {
    return null;
  }

  const isFailed = message.sendStatus === 'failed';
  const isUploading = (message.text ?? '').trim().startsWith('Uploading ') || (message.text ?? '').trim().startsWith('Preparing ');
  const isSending = message.sendStatus === 'sending' || Boolean(message.optimistic);
  const otherReaders = Array.isArray(message.readBy)
    ? message.readBy.filter((id) => typeof id === 'string' && id.trim().length > 0 && id !== message.senderId)
    : [];
  const hasReadReceipts = isMine && !message.optimistic && otherReaders.length >= 1;
  const readByCount = otherReaders.length;
  const statusLabel = isFailed
    ? 'Not sent'
    : isUploading
      ? 'Uploading'
      : isSending
        ? 'Sending'
        : hasReadReceipts
          ? readByCount > 1 ? `Seen by ${readByCount}` : 'Seen'
          : isMine
            ? 'Sent'
            : 'Delivered';

  const bubbleStyles = isMine
    ? [styles.bubble, styles.myBubble, isFailed ? styles.failedBubble : null]
    : [styles.bubble, styles.otherBubble];
  const textColorStyle = isMine ? styles.myText : styles.otherText;
  const metaColorStyle = isMine ? styles.myMeta : styles.otherMeta;
  const attachmentCardStyle = isMine ? styles.myAttachmentCard : styles.otherAttachmentCard;

  return (
    <Animated.View
      style={[
        styles.row,
        isMine ? styles.myRow : styles.otherRow,
        { opacity: fadeAnim },
      ]}
      testID={`chat-message-${message.id}`}
    >
      <Pressable
        onLongPress={handleLongPress}
        delayLongPress={280}
        style={bubbleStyles}
        testID={`chat-message-bubble-${message.id}`}
      >
        {!isMine && message.senderLabel ? <Text style={styles.senderLabel}>{message.senderLabel}</Text> : null}
        {message.replyTo ? (
          <Pressable
            style={[styles.replyContextCard, isMine ? styles.myReplyContextCard : styles.otherReplyContextCard]}
            onPress={handleOpenReplyContext}
            accessibilityRole="button"
            accessibilityLabel="Jump to original message"
            testID={`chat-message-reply-context-${message.id}`}
          >
            <MessageCircle size={13} color={isMine ? 'rgba(0,0,0,0.62)' : Colors.primary} />
            <View style={styles.replyContextCopy}>
              <Text style={[styles.replyContextSender, metaColorStyle]} numberOfLines={1}>{message.replyTo.senderLabel}</Text>
              <Text style={[styles.replyContextText, textColorStyle]} numberOfLines={2}>{message.replyTo.previewText}</Text>
            </View>
          </Pressable>
        ) : null}
        {toolUsedLabel ? (
          <View style={styles.toolUsedBadge} testID={`chat-message-tool-used-${message.id}`}>
            <Text style={styles.toolUsedText}>{`Tool used: ${toolUsedLabel}`}</Text>
          </View>
        ) : null}

        {displayText || isStreaming ? (
          <Text style={[styles.messageText, textColorStyle]}>
            {highlightedSegments.length > 0
              ? highlightedSegments
                  .filter((segment) => typeof segment.text === 'string' && segment.text.length > 0)
                  .map((segment, index) => (
                    <Text
                      key={`${message.id}-highlight-${index}`}
                      style={segment.matched ? styles.highlightedText : null}
                    >
                      {String(segment.text)}
                    </Text>
                  ))
              : <Text>{String(displayText)}</Text>}
            {isStreaming && !isMine ? (
              <Animated.Text style={[styles.cursor, { opacity: cursorOpacity }]}>▋</Animated.Text>
            ) : null}
          </Text>
        ) : null}

        {shouldRenderInlineImage(message) && message.fileUrl ? (
          <View style={styles.imageAttachment} testID={`chat-message-image-wrap-${message.id}`}>
            <ControlledImage
              mediaId={`chat:image:${message.id}`}
              scope="chat"
              module="ivx-chat"
              sourceUrl={message.fileUrl}
              thumbnailUrl={message.thumbnailUrl ?? message.fileUrl}
              fullResolutionUrl={message.fileUrl}
              messageId={message.id}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              testID={`chat-message-image-${message.id}`}
            />
          </View>
        ) : null}

        {message.fileType === 'video' && message.fileUrl ? (
          <View style={styles.videoAttachment} testID={`chat-message-video-wrap-${message.id}`}>
            <ControlledVideo
              mediaId={`chat:video:${message.id}`}
              scope="chat"
              module="ivx-chat"
              uri={message.fileUrl}
              posterUri={message.thumbnailUrl ?? message.fileUrl}
              messageId={message.id}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
              isLooping={false}
              isMuted={true}
              testID={`chat-message-video-${message.id}`}
            />
          </View>
        ) : null}

        {shouldRenderTapToOpenAttachment(message) ? (
          <Pressable
            style={[styles.fileCard, attachmentCardStyle]}
            onPress={() => {
              void handleOpenAttachment();
            }}
            testID={`chat-message-file-${message.id}`}
          >
            {message.fileType === 'video'
              ? <PlayCircle size={18} color={isMine ? Colors.black : Colors.primary} />
              : <FileText size={18} color={isMine ? Colors.black : Colors.primary} />}
            <View style={styles.attachmentTextStack}>
              <Text style={[styles.attachmentLabel, textColorStyle]} numberOfLines={2}>
                {getAttachmentLabel(message)}
              </Text>
              <Text style={[styles.attachmentMeta, metaColorStyle]} numberOfLines={1}>
                {`${message.fileMime ?? message.fileType ?? 'file'}${typeof message.fileSize === 'number' ? ` • ${Math.max(1, Math.round(message.fileSize / 1024))} KB` : ''}`}
              </Text>
            </View>
            <View style={styles.downloadAction}>
              <Download size={14} color={isMine ? 'rgba(0,0,0,0.65)' : Colors.primary} />
              <Text style={[styles.downloadActionText, metaColorStyle]}>{isMine ? 'Open' : 'Download'}</Text>
            </View>
          </Pressable>
        ) : null}

        <View style={styles.metaRow}>
          {/* "Local only" badge removed per owner mandate — a successfully
              sent message must not be permanently marked as local-only.
              Only genuine failures show a status label. */}
          {isFailed ? (
            <View style={styles.failedIndicator}>
              <AlertCircle size={12} color="#FF4D4D" />
              <Text style={styles.failedText}>{statusLabel}</Text>
            </View>
          ) : (
            <>
              {hasReadReceipts ? (
                <CheckCheck size={12} color="#D4A017" />
              ) : isMine && !isSending ? (
                <Check size={12} color={isMine ? 'rgba(0,0,0,0.5)' : Colors.textTertiary} />
              ) : null}
              <Text style={[styles.metaText, metaColorStyle]}>{formatMessageTime(message.createdAt)}</Text>
              <Text style={[styles.statusLabel, hasReadReceipts ? styles.readLabel : metaColorStyle]}>{statusLabel}</Text>
            </>
          )}
        </View>

        {hasReadReceipts ? (
          <View style={styles.readReceiptRow} testID={`chat-message-read-receipts-${message.id}`}>
            <Eye size={11} color="#B8860B" />
            <Text style={styles.readReceiptText}>
              {readByCount > 1 ? `Seen by ${readByCount} people` : 'Seen'}
            </Text>
          </View>
        ) : null}

        {reactions && reactions.length > 0 ? (
          <View style={styles.reactionRow} testID={`chat-message-reactions-${message.id}`}>
            {reactions.map((reaction) => (
              <Pressable
                key={reaction.emoji}
                onPress={() => handleToggleExistingReaction(reaction.emoji)}
                style={({ pressed }) => [
                  styles.reactionChip,
                  reaction.reactedByMe ? styles.reactionChipActive : null,
                  pressed ? styles.pressed : null,
                ]}
                testID={`chat-message-reaction-${message.id}-${reaction.emoji}`}
              >
                <Text style={styles.reactionEmoji}>{reaction.emoji}</Text>
                <Text
                  style={[
                    styles.reactionCount,
                    reaction.reactedByMe ? styles.reactionCountActive : null,
                  ]}
                >
                  {reaction.count}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.messageActionsRow}>
          {displayText ? (
            <Pressable
              style={({ pressed }) => [styles.copyAction, pressed ? styles.pressed : null]}
              onPress={handleCopy}
              testID={`chat-message-copy-${message.id}`}
            >
              <Copy size={12} color={isMine ? 'rgba(0,0,0,0.55)' : '#B4BDC9'} />
              <Text style={[styles.copyActionText, metaColorStyle]}>Copy</Text>
            </Pressable>
          ) : null}
          {onReply ? (
            <Pressable
              style={({ pressed }) => [styles.copyAction, pressed ? styles.pressed : null]}
              onPress={handleReply}
              testID={`chat-message-reply-${message.id}`}
            >
              <Reply size={12} color={isMine ? 'rgba(0,0,0,0.55)' : '#B4BDC9'} />
              <Text style={[styles.copyActionText, metaColorStyle]}>Reply</Text>
            </Pressable>
          ) : null}
          {onTogglePin ? (
            <Pressable
              style={({ pressed }) => [styles.copyAction, isPinned ? styles.pinnedAction : null, pressed ? styles.pressed : null]}
              onPress={handleTogglePin}
              testID={`chat-message-pin-${message.id}`}
            >
              {isPinned ? <PinOff size={12} color={isMine ? 'rgba(0,0,0,0.6)' : '#F6C85F'} /> : <Pin size={12} color={isMine ? 'rgba(0,0,0,0.55)' : '#B4BDC9'} />}
              <Text style={[styles.copyActionText, metaColorStyle]}>{isPinned ? 'Unpin' : 'Pin'}</Text>
            </Pressable>
          ) : null}
          {onToggleReaction ? (
            <Pressable
              style={({ pressed }) => [styles.copyAction, pressed ? styles.pressed : null]}
              onPress={() => setPickerVisible(true)}
              testID={`chat-message-react-${message.id}`}
            >
              <Smile size={12} color={isMine ? 'rgba(0,0,0,0.55)' : '#B4BDC9'} />
              <Text style={[styles.copyActionText, metaColorStyle]}>React</Text>
            </Pressable>
          ) : null}
        </View>

        {isFailed ? (
          <View style={styles.failedActions}>
            <Pressable
              style={({ pressed }) => [styles.retryAction, pressed ? styles.pressed : null]}
              onPress={handleRetry}
              testID={`chat-message-retry-${message.id}`}
            >
              <RefreshCw size={13} color="#FF4D4D" />
              <Text style={styles.retryActionText}>Retry</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.dismissAction, pressed ? styles.pressed : null]}
              onPress={handleDismiss}
              testID={`chat-message-dismiss-${message.id}`}
            >
              <X size={13} color="rgba(0,0,0,0.4)" />
              <Text style={styles.dismissActionText}>Remove</Text>
            </Pressable>
          </View>
        ) : null}
      </Pressable>
      <ReactionPicker
        visible={pickerVisible}
        emojis={REACTION_EMOJIS}
        activeEmojis={(reactions ?? []).filter((r) => r.reactedByMe).map((r) => r.emoji)}
        onSelect={handlePickEmoji}
        onClose={() => setPickerVisible(false)}
        testID={`chat-message-reaction-picker-${message.id}`}
      />
    </Animated.View>
  );
});

const styles = StyleSheet.create({
  row: {
    width: '100%',
    marginVertical: 4,
  },
  myRow: {
    alignItems: 'flex-end',
  },
  otherRow: {
    alignItems: 'flex-start',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 11,
    gap: 7,
  },
  myBubble: {
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 8,
  },
  otherBubble: {
    backgroundColor: Colors.card,
    borderBottomLeftRadius: 8,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  failedBubble: {
    backgroundColor: '#FFE4E6',
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  senderLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 0.2,
  },
  replyContextCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderLeftWidth: 3,
  },
  myReplyContextCard: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderLeftColor: 'rgba(0,0,0,0.34)',
  },
  otherReplyContextCard: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderLeftColor: Colors.primary,
  },
  replyContextCopy: {
    flex: 1,
    gap: 2,
  },
  replyContextSender: {
    fontSize: 10,
    fontWeight: '900' as const,
  },
  replyContextText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600' as const,
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500' as const,
  },
  cursor: {
    fontSize: 15,
    lineHeight: 21,
    fontWeight: '500' as const,
    color: Colors.primary,
  },
  toolUsedBadge: {
    alignSelf: 'flex-start',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: 'rgba(59,130,246,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.22)',
  },
  toolUsedText: {
    color: '#60A5FA',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '900' as const,
  },
  messageActionsRow: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 8,
  },
  pinnedAction: {
    backgroundColor: 'rgba(246,200,95,0.16)',
  },
  myText: {
    color: Colors.black,
  },
  otherText: {
    color: Colors.text,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 1,
  },
  metaText: {
    fontSize: 10,
    fontWeight: '600' as const,
  },
  statusLabel: {
    fontSize: 10,
    fontWeight: '700' as const,
  },
  myMeta: {
    color: 'rgba(0,0,0,0.55)',
  },
  otherMeta: {
    color: Colors.textTertiary,
  },
  readLabel: {
    color: '#B8860B',
  },
  localOnlyBadge: {
    fontSize: 10,
    fontWeight: '800' as const,
  },
  failedIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  failedText: {
    color: '#FF4D4D',
    fontSize: 10,
    fontWeight: '800' as const,
  },
  copyAction: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 4,
    paddingTop: 2,
  },
  highlightedText: {
    color: Colors.black,
    backgroundColor: '#F8D66D',
    borderRadius: 4,
    fontWeight: '900' as const,
  },
  copyActionText: {
    fontSize: 10,
    fontWeight: '800' as const,
  },
  failedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  retryAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(239,68,68,0.10)',
  },
  retryActionText: {
    color: '#FF4D4D',
    fontSize: 11,
    fontWeight: '900' as const,
  },
  dismissAction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  dismissActionText: {
    color: 'rgba(0,0,0,0.5)',
    fontSize: 11,
    fontWeight: '900' as const,
  },
  pressed: {
    opacity: 0.7,
    transform: [{ scale: 0.98 }],
  },
  readReceiptRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-end',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: 'rgba(212,160,23,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(212,160,23,0.32)',
  },
  readReceiptText: {
    color: '#D4A017',
    fontSize: 10,
    fontWeight: '900' as const,
    letterSpacing: 0.3,
  },
  reactionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  reactionChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: Colors.border,
  },
  reactionChipActive: {
    backgroundColor: 'rgba(255,215,0,0.16)',
    borderColor: 'rgba(255,215,0,0.45)',
  },
  reactionEmoji: {
    fontSize: 13,
    lineHeight: 16,
  },
  reactionCount: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '800' as const,
  },
  reactionCountActive: {
    color: Colors.primary,
  },
  imageAttachment: {
    width: 220,
    height: 150,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
  videoAttachment: {
    width: 220,
    height: 150,
    borderRadius: 16,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  fileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 16,
    paddingHorizontal: 11,
    paddingVertical: 10,
    borderWidth: 1,
  },
  myAttachmentCard: {
    backgroundColor: 'rgba(0,0,0,0.08)',
    borderColor: 'rgba(0,0,0,0.10)',
  },
  otherAttachmentCard: {
    backgroundColor: 'rgba(255,255,255,0.03)',
    borderColor: Colors.border,
  },
  attachmentTextStack: {
    flex: 1,
    minWidth: 0,
  },
  attachmentLabel: {
    fontSize: 13,
    lineHeight: 17,
    fontWeight: '800' as const,
  },
  attachmentMeta: {
    marginTop: 2,
    fontSize: 10,
    fontWeight: '700' as const,
  },
  downloadAction: {
    alignItems: 'center',
    gap: 2,
  },
  downloadActionText: {
    fontSize: 9,
    fontWeight: '900' as const,
  },
});
