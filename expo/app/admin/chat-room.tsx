import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft, Radio } from 'lucide-react-native';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { IVX_OWNER_AI_PROFILE, IVX_OWNER_AI_ROOM_ID, IVX_OWNER_AI_ROOM_SLUG } from '@/constants/ivx-owner-ai';
import { useAuth } from '@/lib/auth-context';
import { ChatScreen } from '@/src/modules/chat';
import {
  buildRuntimeSignalsFromProbe,
  probeAIBackendHealth,
} from '@/src/modules/chat/services/aiReplyService';
import {
  getChatConversationDisplayId,
  getChatConversationTitle,
  resolveChatActorId,
  resolveChatConversationId,
} from '@/src/modules/chat/services/chatRooms';
import { resolveRoomCapabilityState } from '@/src/modules/chat/services/roomCapabilityResolver';
import { getCurrentChatRoomStatus, subscribeToChatRoomStatus } from '@/src/modules/chat/services/supabaseChatProvider';
import type { ChatRoomRuntimeSignals, ChatRoomStatus } from '@/src/modules/chat/types/chat';

const ADMIN_MESSAGE_ROOM_SLUG = 'admin-message-room';
const ADMIN_MESSAGE_ROOM_TITLE = 'Message Room';

function normalizeParam(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) {
    return value[0] ?? fallback;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return fallback;
}

export default function AdminChatRoomScreen() {
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const params = useLocalSearchParams<{ conversationId?: string | string[]; title?: string | string[] }>();
  const { user } = useAuth();

  const routeConversationId = useMemo(() => {
    return normalizeParam(params.conversationId, ADMIN_MESSAGE_ROOM_SLUG);
  }, [params.conversationId]);

  const conversationId = useMemo(() => {
    return resolveChatConversationId(routeConversationId);
  }, [routeConversationId]);

  const displayConversationId = useMemo(() => {
    return getChatConversationDisplayId(routeConversationId);
  }, [routeConversationId]);

  const title = useMemo(() => {
    return getChatConversationTitle(
      routeConversationId,
      normalizeParam(params.title, ADMIN_MESSAGE_ROOM_TITLE),
    ) ?? ADMIN_MESSAGE_ROOM_TITLE;
  }, [params.title, routeConversationId]);

  const isExplicitIVXOwnerRoomRoute = useMemo(() => {
    const hasExplicitConversationId = typeof params.conversationId === 'string'
      ? params.conversationId.trim().length > 0
      : Array.isArray(params.conversationId) && (params.conversationId[0]?.trim().length ?? 0) > 0;

    return hasExplicitConversationId
      && (routeConversationId === IVX_OWNER_AI_ROOM_SLUG || conversationId === IVX_OWNER_AI_ROOM_ID);
  }, [conversationId, params.conversationId, routeConversationId]);

  const [roomStatus, setRoomStatus] = useState<ChatRoomStatus | null>(() => getCurrentChatRoomStatus());
  const [runtimeSignals, setRuntimeSignals] = useState<ChatRoomRuntimeSignals>({
    aiBackendHealth: 'inactive',
    knowledgeBackendHealth: 'inactive',
    ownerCommandAvailability: 'inactive',
    codeAwareServiceAvailability: 'inactive',
    aiResponseState: 'inactive',
  });
  const probeRanRef = useRef(false);

  const runAIProbe = useCallback(async () => {
    try {
      console.log('[AdminChatRoom] Running AI backend probe...');
      const health = await probeAIBackendHealth();
      const signals = buildRuntimeSignalsFromProbe(health);
      setRuntimeSignals(signals);
      console.log('[AdminChatRoom] AI probe result:', health, signals);
    } catch (probeError) {
      console.log('[AdminChatRoom] AI probe error:', (probeError as Error)?.message);
    }
  }, []);

  useEffect(() => {
    if (!probeRanRef.current) {
      probeRanRef.current = true;
      void runAIProbe();
    }
  }, [runAIProbe]);

  const capabilityResolution = useMemo(() => {
    return resolveRoomCapabilityState(roomStatus, runtimeSignals);
  }, [roomStatus, runtimeSignals]);

  const currentUserId = useMemo(() => {
    return resolveChatActorId(user?.id, 'admin');
  }, [user?.id]);

  useEffect(() => {
    const unsubscribe = subscribeToChatRoomStatus((nextStatus) => {
      setRoomStatus(nextStatus);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    console.log('[AdminChatRoom] Opening room route:', {
      routeConversationId,
      conversationId,
      displayConversationId,
      title,
      roomStatus,
      currentUserId,
    });
  }, [conversationId, currentUserId, displayConversationId, roomStatus, routeConversationId, title]);

  if (isExplicitIVXOwnerRoomRoute) {
    console.log('[AdminChatRoom] Redirecting explicit IVX owner room to /ivx/chat');
    return <Redirect href="/ivx/chat" />;
  }

  return (
    <ErrorBoundary fallbackTitle="Chat room unavailable">
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container} testID="admin-chat-room-screen">
        <SafeAreaView edges={['top']} style={styles.safeArea}>
          <View style={styles.header}>
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
              testID="admin-chat-room-back"
            >
              <ArrowLeft size={20} color={Colors.text} />
            </TouchableOpacity>

            <View style={styles.headerCopy}>
              <View style={styles.badge}>
                <Radio size={12} color={Colors.primary} />
                <Text style={styles.badgeText}>{capabilityResolution.badgeText}</Text>
              </View>
              <Text style={styles.title}>{title}</Text>
              <Text style={styles.subtitle}>{capabilityResolution.subtitle}</Text>
              <Text style={styles.summary}>{capabilityResolution.summary}</Text>
            </View>
          </View>
        </SafeAreaView>

        <ChatScreen
          conversationId={conversationId}
          currentUserId={currentUserId}
          roomMeta={{
            badgeText: capabilityResolution.badgeText,
            title,
            subtitle: capabilityResolution.subtitle,
            emptyTitle: 'No messages yet',
            emptyText: 'Use Message Room for shared admin communication and support.',
            runtimeSignals,
          }}
        />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  safeArea: {
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: Colors.backgroundSecondary,
  },
  badgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700' as const,
  },
  title: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '800' as const,
  },
  subtitle: {
    color: Colors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  summary: {
    color: Colors.textTertiary,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: '600' as const,
  },
});
