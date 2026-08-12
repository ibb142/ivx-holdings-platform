import React, { useState, useCallback, useRef, useEffect } from 'react';
import {View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Animated,
  RefreshControl} from "react-native";
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  MessageSquare,
  CheckCircle,
  XCircle,
  Clock,
  Phone,
  ChevronDown,
  ChevronUp,
  Filter,
  Send} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface SMSMessage {
  id: string;
  type: string;
  status: string;
  message: string;
  recipient_phone?: string;
  subject?: string;
  error?: string;
  sent_at?: string;
  created_at: string;
  delivered_at?: string;
}

const TYPE_COLORS: Record<string, string> = {
  hourly: Colors.accent,
  emergency: Colors.error,
  manual: Colors.primary,
  daily_summary: Colors.success,
  smart_update: '#00C9A7'};

const TYPE_LABELS: Record<string, string> = {
  hourly: 'Hourly',
  emergency: 'Emergency',
  manual: 'Manual',
  daily_summary: 'Daily',
  smart_update: 'AI Smart'};

const STATUS_CONFIG: Record<string, { color: string; label: string }> = {
  sent: { color: Colors.success, label: 'Sent' },
  delivered: { color: Colors.success, label: 'Delivered' },
  failed: { color: Colors.error, label: 'Failed' },
  simulated: { color: Colors.warning, label: 'Simulated' },
  pending: { color: Colors.accent, label: 'Pending' }};

type FilterType = 'all' | 'hourly' | 'emergency' | 'manual' | 'daily_summary' | 'smart_update';

const PAGE_SIZE = 20;

export default function SMSHistoryScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const [filter, setFilter] = useState<FilterType>('all');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const fadeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: 1,
      duration: 400,
      useNativeDriver: true}).start();
  }, [fadeAnim]);

  const messagesQuery = useQuery<{ items: SMSMessage[]; total: number; totalPages: number }>({
    queryKey: ['smsHistory', filter, page],
    queryFn: async () => {
      console.log('[SMSHistory] Fetching messages, filter:', filter, 'page:', page);
      let query = supabase
        .from('sms_messages')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

      if (filter !== 'all') {
        query = query.eq('type', filter);
      }

      const from = (page - 1) * PAGE_SIZE;
      query = query.range(from, from + PAGE_SIZE - 1);

      const { data, error, count } = await query;
      if (error) {
        console.log('[SMSHistory] Query error:', error.message);
        throw new Error(error.message);
      }

      const total = count ?? 0;
      return {
        items: (data ?? []) as SMSMessage[],
        total,
        totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE))};
    },
    staleTime: 5000,
    retry: 2});

  const onRefresh = useCallback(() => {
    void messagesQuery.refetch();
  }, [messagesQuery]);

  const handleFilterChange = useCallback((newFilter: FilterType) => {
    setFilter(newFilter);
    setPage(1);
  }, []);

  const formatTime = useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
      return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }, []);

  const renderMessage = useCallback(({ item }: { item: SMSMessage }) => {
    const isExpanded = expandedId === item.id;
    const typeColor = TYPE_COLORS[item.type] || Colors.textSecondary;
    const statusCfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
    const StatusIcon = item.status === 'sent' || item.status === 'delivered' ? CheckCircle :
      item.status === 'failed' ? XCircle : Clock;

    return (
      <TouchableOpacity
        style={styles.messageCard}
        onPress={() => setExpandedId(isExpanded ? null : item.id)}
        activeOpacity={0.7}
      >
        <View style={styles.messageHeader}>
          <View style={styles.messageHeaderLeft}>
            <View style={[styles.typeBadge, { backgroundColor: typeColor + '18', borderColor: typeColor + '40' }]}>
              <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                {TYPE_LABELS[item.type] || item.type}
              </Text>
            </View>
            <View style={styles.statusBadge}>
              <StatusIcon size={12} color={statusCfg.color} />
              <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
            </View>
          </View>
          <View style={styles.messageHeaderRight}>
            <Text style={styles.timeText}>{formatTime(item.sent_at || item.created_at)}</Text>
            {isExpanded ? (
              <ChevronUp size={14} color={Colors.textTertiary} />
            ) : (
              <ChevronDown size={14} color={Colors.textTertiary} />
            )}
          </View>
        </View>

        <Text style={styles.messagePreview} numberOfLines={isExpanded ? undefined : 2}>
          {item.message || item.subject || 'No message content'}
        </Text>

        {isExpanded && (
          <View style={styles.expandedDetails}>
            {item.recipient_phone && (
              <View style={styles.detailRow}>
                <Phone size={12} color={Colors.textTertiary} />
                <Text style={styles.detailText}>To: {item.recipient_phone}</Text>
              </View>
            )}
            {item.subject && (
              <View style={styles.detailRow}>
                <MessageSquare size={12} color={Colors.textTertiary} />
                <Text style={styles.detailText}>Subject: {item.subject}</Text>
              </View>
            )}
            {item.delivered_at && (
              <View style={styles.detailRow}>
                <CheckCircle size={12} color={Colors.success} />
                <Text style={styles.detailText}>Delivered: {formatTime(item.delivered_at)}</Text>
              </View>
            )}
            {item.error && (
              <View style={styles.detailRow}>
                <XCircle size={12} color={Colors.error} />
                <Text style={[styles.detailText, { color: Colors.error }]}>Error: {item.error}</Text>
              </View>
            )}
            <Text style={styles.messageIdText}>ID: {item.id}</Text>
          </View>
        )}
      </TouchableOpacity>
    );
  }, [expandedId, formatTime]);

  const filters: FilterType[] = ['all', 'hourly', 'emergency', 'manual', 'daily_summary', 'smart_update'];

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="history-back">
            <ArrowLeft size={22} color={Colors.text} strokeWidth={1.8} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Clock size={18} color={Colors.primary} />
            <Text style={styles.headerTitle}>SMS History</Text>
          </View>
          <View style={styles.headerBadge}>
            <Text style={styles.headerBadgeText}>{messagesQuery.data?.total ?? 0}</Text>
          </View>
        </View>

        <View style={styles.filterContainer}>
          <Filter size={14} color={Colors.textTertiary} />
          <FlatList
        onEndReachedThreshold={5}
        onEndReached={() => { /* IVX: pagination hook point */ }}
            horizontal
            data={filters}
            keyExtractor={(item) => item}
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterList}
            renderItem={({ item: f }) => (
              <TouchableOpacity
                style={[styles.filterChip, filter === f && styles.filterChipActive]}
                onPress={() => handleFilterChange(f)}
              >
                <Text style={[styles.filterText, filter === f && styles.filterTextActive]}>
                  {f === 'all' ? 'All' : TYPE_LABELS[f] || f}
                </Text>
              </TouchableOpacity>
            )}
          />
        </View>

        <Animated.View style={[styles.content, { opacity: fadeAnim }]}>
          {messagesQuery.isLoading && !messagesQuery.data ? (
            <View style={styles.loadingContainer}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Loading messages...</Text>
            </View>
          ) : messagesQuery.data?.items.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Send size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Messages Yet</Text>
              <Text style={styles.emptySubtext}>
                SMS messages will appear here once sent via the Command Center or Send Test SMS.
              </Text>
            </View>
          ) : (
            <FlatList
              data={messagesQuery.data?.items ?? []}
              keyExtractor={(item) => item.id}
              renderItem={renderMessage}
              contentContainerStyle={styles.listContent}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={messagesQuery.isRefetching}
                  onRefresh={onRefresh}
                  tintColor={Colors.primary}
                />
              }
              ListFooterComponent={
                messagesQuery.data && messagesQuery.data.totalPages > 1 ? (
                  <View style={styles.pagination}>
                    <TouchableOpacity
                      style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
                      onPress={() => setPage(Math.max(1, page - 1))}
                      disabled={page <= 1}
                    >
                      <Text style={[styles.pageBtnText, page <= 1 && styles.pageBtnTextDisabled]}>Previous</Text>
                    </TouchableOpacity>
                    <Text style={styles.pageInfo}>
                      {page} / {messagesQuery.data.totalPages}
                    </Text>
                    <TouchableOpacity
                      style={[styles.pageBtn, page >= messagesQuery.data.totalPages && styles.pageBtnDisabled]}
                      onPress={() => setPage(Math.min(messagesQuery.data?.totalPages ?? 1, page + 1))}
                      disabled={page >= messagesQuery.data.totalPages}
                    >
                      <Text style={[styles.pageBtnText, page >= messagesQuery.data.totalPages && styles.pageBtnTextDisabled]}>Next</Text>
                    </TouchableOpacity>
                  </View>
                ) : null
              }
            />
          )}
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  safeArea: {
    flex: 1},
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'space-between' as const,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  headerCenter: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  headerTitle: {
    fontSize: 17,
    fontWeight: '600' as const,
    color: Colors.text,
    letterSpacing: 0.3},
  headerBadge: {
    backgroundColor: Colors.primary + '20',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    minWidth: 40,
    alignItems: 'center' as const},
  headerBadgeText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: Colors.primary},
  filterContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingLeft: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8},
  filterList: {
    gap: 6,
    paddingRight: 16},
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  filterChipActive: {
    backgroundColor: Colors.primary + '18',
    borderColor: Colors.primary + '60'},
  filterText: {
    fontSize: 12,
    fontWeight: '500' as const,
    color: Colors.textSecondary},
  filterTextActive: {
    color: Colors.primary,
    fontWeight: '600' as const},
  content: {
    flex: 1},
  listContent: {
    padding: 16,
    gap: 10,
    paddingBottom: 40},
  messageCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  messageHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 8},
  messageHeaderLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  typeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1},
  typeBadgeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.5,
    textTransform: 'uppercase' as const},
  statusBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4},
  statusText: {
    fontSize: 11,
    fontWeight: '600' as const},
  messageHeaderRight: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 6},
  timeText: {
    fontSize: 11,
    color: Colors.textTertiary},
  messagePreview: {
    fontSize: 13,
    color: Colors.textSecondary,
    lineHeight: 19},
  expandedDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: 8},
  detailRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  detailText: {
    fontSize: 12,
    color: Colors.textSecondary,
    flex: 1},
  messageIdText: {
    fontSize: 10,
    color: Colors.textTertiary,
    marginTop: 4,
    fontFamily: 'monospace' as const},
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 12},
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary},
  emptyContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 40,
    gap: 12},
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  emptySubtext: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    lineHeight: 20},
  pagination: {
    flexDirection: 'row' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 16,
    paddingVertical: 20},
  pageBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  pageBtnDisabled: {
    opacity: 0.4},
  pageBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.text},
  pageBtnTextDisabled: {
    color: Colors.textTertiary},
  pageInfo: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500' as const}});
