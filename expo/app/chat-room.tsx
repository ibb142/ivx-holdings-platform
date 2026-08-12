import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import ErrorBoundary from '@/components/ErrorBoundary';
import Colors from '@/constants/colors';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';
import { EmptyState } from '@/components/ivx';
import { RefreshControl } from 'react-native';
import { IVX_OWNER_AI_PROFILE, IVX_OWNER_AI_ROOM_ID, IVX_OWNER_AI_ROOM_SLUG } from '@/constants/ivx-owner-ai';
import { useAuth } from '@/lib/auth-context';
import { ChatModule } from '@/src/modules/chat';
import { getChatConversationTitle, resolveChatActorId, resolveChatConversationId } from '@/src/modules/chat/services/chatRooms';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';

function normalizeOptionalParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    const nextValue = value[0]?.trim();
    return nextValue ? nextValue : undefined;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value.trim();
  }

  return undefined;
}

export default function ChatRoomRoute() {
  // Realtime: auto-invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const params = useLocalSearchParams<{ conversationId?: string | string[]; title?: string | string[] }>();
  const { user } = useAuth();

  const routeConversationId = useMemo(() => {
    return normalizeOptionalParam(params.conversationId);
  }, [params.conversationId]);

  const conversationId = useMemo(() => {
    return resolveChatConversationId(routeConversationId);
  }, [routeConversationId]);

  const title = useMemo(() => {
    return getChatConversationTitle(routeConversationId, normalizeOptionalParam(params.title) ?? IVX_OWNER_AI_PROFILE.sharedRoom.title) ?? IVX_OWNER_AI_PROFILE.sharedRoom.title;
  }, [params.title, routeConversationId]);

  const isIVXOwnerRoomRoute = useMemo(() => {
    const normalizedRouteConversationId = routeConversationId?.trim() ?? '';
    return normalizedRouteConversationId === IVX_OWNER_AI_ROOM_SLUG || conversationId === IVX_OWNER_AI_ROOM_ID;
  }, [conversationId, routeConversationId]);

  const currentUserId = useMemo(() => {
    return resolveChatActorId(user?.id, 'preview');
  }, [user?.id]);

  if (isIVXOwnerRoomRoute) {
    console.log('[ChatRoomRoute] Redirecting IVX owner room to /ivx/chat');
    return <Redirect href="/ivx/chat" />;
  }

  return (
    <ErrorBoundary fallbackTitle="Chat room unavailable">
      <View style={styles.container}>
        <Stack.Screen options={{ title }} />
        <ChatModule
          currentUserId={currentUserId}
          initialConversationId={conversationId}
          initialTitle={title}
        />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background}});
