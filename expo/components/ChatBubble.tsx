/**
 * =============================================================================
 * CHAT BUBBLE COMPONENT - components/ChatBubble.tsx
 * =============================================================================
 * 
 * Displays a single chat message in a conversation-style bubble format.
 * Used in support chat and messaging interfaces.
 * 
 * FEATURES:
 * ---------
 * - Different styling for user vs support messages
 * - Support agent avatar display
 * - Message delivery status indicators (sent, delivered, read)
 * - Timestamp display
 * - Rounded bubble corners with chat-style tail
 * 
 * MESSAGE TYPES:
 * --------------
 * - User messages: Gold/primary color, aligned right
 * - Support messages: Dark surface color, aligned left with avatar
 * 
 * STATUS ICONS:
 * -------------
 * - sent: Single check mark (gray)
 * - delivered: Double check mark (gray)
 * - read: Double check mark (gold/primary)
 * 
 * PROPS:
 * ------
 * - message: ChatMessage - The message data from @/types
 *   - id, senderId, senderName, senderAvatar
 *   - message (text content)
 *   - timestamp, isSupport, status
 * 
 * PERFORMANCE:
 * ------------
 * - Uses React.memo() to prevent unnecessary re-renders
 * - useMemo() for formatted time and status icon
 * 
 * USAGE:
 * ------
 * import ChatBubble from '@/components/ChatBubble';
 * 
 * <ChatBubble message={chatMessage} />
 * =============================================================================
 */

import React, { memo, useMemo, useState, useEffect } from 'react';
import { View, Text, StyleSheet, Image } from 'react-native';
import { Check, CheckCheck, Database, FileText, Zap } from 'lucide-react-native';
import { ChatMessage } from '@/types';
import Colors from '@/constants/colors';
import { formatChatTimestamp, loadTimezoneProfile } from '@/lib/time-service';

interface ChatBubbleProps {
  message: ChatMessage;
}

const ChatBubble = memo(function ChatBubble({ message }: ChatBubbleProps) {
  const isUser = !message.isSupport;

  const [timezone, setTimezone] = useState<string>('UTC');
  const [hourPref, setHourPref] = useState<'12h' | '24h'>('12h');

  useEffect(() => {
    let mounted = true;
    loadTimezoneProfile().then((profile) => {
      if (mounted && profile) {
        setTimezone(profile.timezone);
        setHourPref(profile.hour_preference);
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const formattedTime = useMemo(() => {
    return formatChatTimestamp(message.timestamp, timezone, hourPref);
  }, [message.timestamp, timezone, hourPref]);

  const isLiveIntelligence = useMemo(() => {
    return message.meta?.route === '/public/chat';
  }, [message.meta?.route]);

  const proofLabel = useMemo(() => {
    if (isUser || !message.meta) {
      return null;
    }

    const { route, source, model, commitShort, backendTimestamp } = message.meta;
    if (!route && !source) {
      return null;
    }

    // Developer-proof line for live-backend answers:
    // /public/chat · openai/gpt-4o-mini · commit adfd39af · live backend · 2026-05-30 11:40
    if (isLiveIntelligence) {
      const parts: string[] = ['/public/chat'];
      if (model) {
        parts.push(model);
      }
      if (commitShort && commitShort !== 'unknown') {
        parts.push(`commit ${commitShort}`);
      }
      parts.push('live backend');
      if (backendTimestamp) {
        const date = new Date(backendTimestamp);
        if (!Number.isNaN(date.getTime())) {
          const pad = (value: number): string => String(value).padStart(2, '0');
          const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
          parts.push(stamp);
        }
      }
      return parts.join(' · ');
    }

    const fallbackParts: string[] = [];
    if (route) {
      fallbackParts.push(route);
    }
    if (source) {
      fallbackParts.push(source);
    }
    return fallbackParts.join(' · ');
  }, [isUser, message.meta, isLiveIntelligence]);

  const statusIcon = useMemo(() => {
    switch (message.status) {
      case 'sent':
        return <Check size={12} color={Colors.textTertiary} />;
      case 'delivered':
        return <CheckCheck size={12} color={Colors.textTertiary} />;
      case 'read':
        return <CheckCheck size={12} color={Colors.primary} />;
      default:
        return null;
    }
  }, [message.status]);

  return (
    <View style={[styles.container, isUser && styles.containerUser]}>
      {!isUser && message.senderAvatar && (
        <Image source={{ uri: message.senderAvatar }} style={styles.avatar} />
      )}
      
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleSupport]}>
        {!isUser && (
          <Text style={styles.senderName}>{message.senderName}</Text>
        )}
        {message.attachments && message.attachments.length > 0 ? (
          <View style={styles.attachments}>
            {message.attachments.map((attachment) => (
              attachment.kind === 'image' && (attachment.url || attachment.localUri) ? (
                <Image
                  key={attachment.id}
                  source={{ uri: attachment.url ?? attachment.localUri }}
                  style={styles.attachmentImage}
                />
              ) : (
                <View key={attachment.id} style={styles.attachmentFile}>
                  <FileText size={14} color={isUser ? Colors.black : Colors.primary} />
                  <Text style={[styles.attachmentFileName, isUser && styles.attachmentFileNameUser]} numberOfLines={1}>
                    {attachment.name}
                  </Text>
                </View>
              )
            ))}
          </View>
        ) : null}
        {message.message.trim().length > 0 ? (
          <Text style={[styles.messageText, isUser && styles.messageTextUser]}>
            {message.message}
          </Text>
        ) : null}
        {proofLabel ? (
          <View style={styles.proofRow}>
            {isLiveIntelligence ? (
              <Zap size={10} color={Colors.success} />
            ) : (
              <Database size={10} color={Colors.textTertiary} />
            )}
            <Text style={[styles.proofText, isLiveIntelligence && styles.proofTextLive]} numberOfLines={1}>
              {proofLabel}
            </Text>
          </View>
        ) : null}
        <View style={styles.meta}>
          <Text style={[styles.timestamp, isUser && styles.timestampUser]}>
            {formattedTime}
          </Text>
          {isUser && statusIcon}
        </View>
      </View>
    </View>
  );
});

export default ChatBubble;

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    marginBottom: 12,
    paddingHorizontal: 16},
  containerUser: {
    justifyContent: 'flex-end'},
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginRight: 8},
  bubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16},
  bubbleSupport: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 4,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  bubbleUser: {
    backgroundColor: Colors.primary,
    borderTopRightRadius: 4},
  senderName: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary,
    marginBottom: 4},
  messageText: {
    fontSize: 15,
    color: Colors.text,
    lineHeight: 20},
  messageTextUser: {
    color: Colors.black},
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
    marginTop: 4},
  timestamp: {
    fontSize: 11,
    color: Colors.textTertiary},
  timestampUser: {
    color: 'rgba(0, 0, 0, 0.5)'},
  proofRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.surfaceBorder},
  proofText: {
    flex: 1,
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    letterSpacing: 0.2},
  proofTextLive: {
    color: Colors.success},
  attachments: {
    gap: 6,
    marginBottom: 8},
  attachmentImage: {
    width: 180,
    height: 180,
    borderRadius: 10,
    backgroundColor: Colors.backgroundSecondary},
  attachmentFile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.12)'},
  attachmentFileName: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.text},
  attachmentFileNameUser: {
    color: Colors.black}});
