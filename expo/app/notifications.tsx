import React, { useState, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl} from "react-native";
import { Bell, TrendingUp, Shield, AlertCircle, CheckCircle, ChevronRight } from 'lucide-react-native';
import Colors from '@/constants/colors';

import { useNotifications as useNotificationHook } from '@/lib/data-hooks';
import { supabase } from '@/lib/supabase';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { EmptyState, ListFooter } from '@/components/ProgressiveStates';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const PAGE_SIZE = 20;

export default function NotificationsScreen() {
  const { notifications, refetch, isLoading, isError } = useNotificationHook();
  const [refreshing, setRefreshing] = useState(false);
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);
  const queryClient = useQueryClient();

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('id', notificationId);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }});

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { error } = await supabase
        .from('notifications')
        .update({ read: true })
        .eq('user_id', user.id)
        .eq('read', false);
      if (error) throw error;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }});

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setDisplayCount(PAGE_SIZE);
    void refetch().finally(() => setRefreshing(false));
  }, [refetch]);

  const markAsRead = (id: string) => {
    markAsReadMutation.mutate(id);
  };

  const markAllAsRead = () => {
    markAllAsReadMutation.mutate();
  };

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'dividend':
        return <TrendingUp size={20} color={Colors.success} />;
      case 'order':
        return <CheckCircle size={20} color={Colors.primary} />;
      case 'kyc':
        return <Shield size={20} color={Colors.success} />;
      case 'system':
        return <Bell size={20} color={Colors.info} />;
      default:
        return <AlertCircle size={20} color={Colors.textTertiary} />;
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffHours < 1) {
      return 'Just now';
    } else if (diffHours < 24) {
      return `${diffHours}h ago`;
    } else if (diffDays < 7) {
      return `${diffDays}d ago`;
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }
  };

  const unreadCount = notifications.filter(n => !n.read).length;
  const displayedNotifications = notifications.slice(0, displayCount);
  const hasMore = displayCount < notifications.length;

  const loadMore = useCallback(() => {
    if (hasMore) {
      setDisplayCount(prev => Math.min(prev + PAGE_SIZE, notifications.length));
    }
  }, [hasMore, notifications.length]);

  const renderItem = ({ item: notification }: { item: typeof notifications[0] }) => (
    <TouchableOpacity
      style={[
        styles.notificationItem,
        !notification.read && styles.notificationItemUnread,
      ]}
      onPress={() => markAsRead(notification.id)}
    >
      <View style={styles.notificationIcon}>
        {getNotificationIcon(notification.type)}
      </View>
      <View style={styles.notificationContent}>
        <View style={styles.notificationHeader}>
          <Text style={styles.notificationTitle}>{notification.title}</Text>
          {!notification.read && <View style={styles.unreadDot} />}
        </View>
        <Text style={styles.notificationMessage} numberOfLines={2}>
          {notification.message}
        </Text>
        <Text style={styles.notificationTime}>
          {formatDate(notification.createdAt)}
        </Text>
      </View>
      <ChevronRight size={18} color={Colors.textTertiary} />
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.unreadCount}>{unreadCount} unread</Text>
        </View>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllAsRead}>
            <Text style={styles.markAllText}>Mark all as read</Text>
          </TouchableOpacity>
        )}
      </View>

      <FlatList
        data={displayedNotifications}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
        onEndReached={loadMore}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          isLoading ? (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={{ color: Colors.textSecondary, marginTop: 12, fontSize: 13 }}>Loading notifications…</Text>
            </View>
          ) : (
            <EmptyState
              title="No notifications yet"
              message="You'll receive updates about your investments here"
              icon={<Bell size={48} color={Colors.textTertiary} />}
            />
          )
        }
        ListFooterComponent={<ListFooter isFetchingMore={false} hasMore={hasMore} />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center'},
  unreadCount: {
    fontSize: 14,
    color: Colors.textSecondary},
  markAllText: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600' as const},
  listContent: {
    flexGrow: 1},
  notificationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  notificationItemUnread: {
    backgroundColor: Colors.surface},
  notificationIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.backgroundTertiary,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12},
  notificationContent: {
    flex: 1},
  notificationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4},
  notificationTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary},
  notificationMessage: {
    fontSize: 14,
    color: Colors.textSecondary,
    lineHeight: 20,
    marginBottom: 4},
  notificationTime: {
    fontSize: 12,
    color: Colors.textTertiary}});
