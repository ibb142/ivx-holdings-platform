import React, { useRef, useEffect, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Animated,
  RefreshControl} from "react-native";
import { useRouter, Stack } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  ArrowLeft,
  BarChart3,
  Send,
  CheckCircle,
  XCircle,
  Clock,
  TrendingUp,
  MessageSquare,
  Zap,
  AlertTriangle,
  Activity,
  History} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

interface SMSStats {
  total_sent: number;
  total_failed: number;
  total_delivered: number;
  total_simulated: number;
  status: string;
  running: boolean;
  last_report_time: string | null;
  phone: string;
  updated_at: string;
}

interface TypeBreakdown {
  type: string;
  count: number;
}

const TYPE_COLORS: Record<string, string> = {
  hourly: Colors.accent,
  emergency: Colors.error,
  manual: Colors.primary,
  daily_summary: Colors.success,
  smart_update: '#00C9A7'};

const TYPE_LABELS: Record<string, string> = {
  hourly: 'Hourly Reports',
  emergency: 'Emergency Alerts',
  manual: 'Manual Messages',
  daily_summary: 'Daily Summaries',
  smart_update: 'AI Smart Updates'};

const SMS_DASHBOARD_REFRESH_MS = 60_000;

export default function SMSDashboardScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(20)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 500, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 500, useNativeDriver: true }),
    ]).start();
  }, [fadeAnim, slideAnim]);

  const statsQuery = useQuery<SMSStats | null>({
    queryKey: ['smsDashboard.stats'],
    queryFn: async () => {
      console.log('[SMSDashboard] Fetching stats');
      const { data, error } = await supabase
        .from('sms_reports')
        .select('*')
        .eq('id', 'default')
        .single();
      if (error) {
        console.log('[SMSDashboard] Stats error:', error.message);
        return null;
      }
      return data as unknown as SMSStats;
    },
    refetchInterval: SMS_DASHBOARD_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: 30_000,
    refetchOnMount: false,
    refetchOnWindowFocus: false});

  const breakdownQuery = useQuery<TypeBreakdown[]>({
    queryKey: ['smsDashboard.breakdown'],
    queryFn: async () => {
      console.log('[SMSDashboard] Fetching type breakdown');
      const { data, error } = await supabase
        .from('sms_messages')
        .select('type');
      if (error) {
        console.log('[SMSDashboard] Breakdown error:', error.message);
        return [];
      }
      const counts: Record<string, number> = {};
      (data ?? []).forEach((row: { type: string }) => {
        counts[row.type] = (counts[row.type] || 0) + 1;
      });
      return Object.entries(counts)
        .map(([type, count]) => ({ type, count }))
        .sort((a, b) => b.count - a.count);
    },
    staleTime: 10000});

  const recentQuery = useQuery<Array<{ id: string; type: string; status: string; message: string; created_at: string; recipient_phone?: string }>>({
    queryKey: ['smsDashboard.recent'],
    queryFn: async () => {
      console.log('[SMSDashboard] Fetching recent messages');
      const { data, error } = await supabase
        .from('sms_messages')
        .select('id, type, status, message, created_at, recipient_phone')
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) {
        console.log('[SMSDashboard] Recent error:', error.message);
        return [];
      }
      return (data ?? []) as Array<{ id: string; type: string; status: string; message: string; created_at: string; recipient_phone?: string }>;
    },
    staleTime: 5000});

  const onRefresh = useCallback(() => {
    void statsQuery.refetch();
    void breakdownQuery.refetch();
    void recentQuery.refetch();
  }, [statsQuery, breakdownQuery, recentQuery]);

  const stats = statsQuery.data;
  const totalMessages = (stats?.total_sent ?? 0) + (stats?.total_failed ?? 0) + (stats?.total_simulated ?? 0);
  const successRate = totalMessages > 0 ? Math.round(((stats?.total_sent ?? 0) / totalMessages) * 100) : 0;

  const formatTime = useCallback((dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }, []);

  if (statsQuery.isLoading && !stats) {
    return (
      <View style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
          <View style={styles.loadingContainer}>
            <ShimmerIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading dashboard...</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="dashboard-back">
            <ArrowLeft size={22} color={Colors.text} strokeWidth={1.8} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <BarChart3 size={18} color={Colors.primary} />
            <Text style={styles.headerTitle}>SMS Dashboard</Text>
          </View>
          <TouchableOpacity
            style={styles.historyBtn}
            onPress={() => router.push('/sms-history' as any)}
            testID="go-to-history"
          >
            <History size={18} color={Colors.accent} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={statsQuery.isRefetching}
              onRefresh={onRefresh}
              tintColor={Colors.primary}
            />
          }
        >
          <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}>
            <View style={styles.systemStatusCard}>
              <View style={styles.systemStatusRow}>
                <View style={[
                  styles.systemDot,
                  { backgroundColor: stats?.running ? Colors.success : Colors.textTertiary },
                ]} />
                <Text style={styles.systemStatusLabel}>
                  {stats?.running ? 'System Active' : stats?.status === 'smart_active' ? 'AI Schedule Active' : 'System Inactive'}
                </Text>
              </View>
              {stats?.last_report_time && (
                <Text style={styles.lastActivityText}>
                  Last activity: {formatTime(stats.last_report_time)}
                </Text>
              )}
            </View>

            <View style={styles.statsGrid}>
              <View style={[styles.statCard, styles.statCardPrimary]}>
                <Send size={20} color={Colors.primary} />
                <Text style={styles.statNumber}>{stats?.total_sent ?? 0}</Text>
                <Text style={styles.statLabel}>Delivered</Text>
              </View>

              <View style={[styles.statCard, styles.statCardSuccess]}>
                <TrendingUp size={20} color={Colors.success} />
                <Text style={styles.statNumber}>{successRate}%</Text>
                <Text style={styles.statLabel}>Success Rate</Text>
              </View>

              <View style={[styles.statCard, styles.statCardWarning]}>
                <Clock size={20} color={Colors.warning} />
                <Text style={styles.statNumber}>{stats?.total_simulated ?? 0}</Text>
                <Text style={styles.statLabel}>Simulated</Text>
              </View>

              <View style={[styles.statCard, styles.statCardError]}>
                <XCircle size={20} color={Colors.error} />
                <Text style={styles.statNumber}>{stats?.total_failed ?? 0}</Text>
                <Text style={styles.statLabel}>Failed</Text>
              </View>
            </View>

            {stats && !(stats as any).sns_configured && (
              <View style={styles.warningBanner}>
                <AlertTriangle size={16} color="#FFB800" />
                <Text style={styles.warningText}>
                  AWS SNS not fully configured. Some messages may be simulated.
                </Text>
              </View>
            )}

            {breakdownQuery.data && breakdownQuery.data.length > 0 && (
              <View style={styles.breakdownCard}>
                <View style={styles.sectionHeader}>
                  <Activity size={16} color={Colors.accent} />
                  <Text style={styles.sectionTitle}>Message Breakdown</Text>
                </View>
                {breakdownQuery.data.map((item) => {
                  const maxCount = Math.max(...(breakdownQuery.data?.map(d => d.count) ?? [1]));
                  const barWidth = Math.max(8, (item.count / maxCount) * 100);
                  const color = TYPE_COLORS[item.type] || Colors.textSecondary;
                  return (
                    <View key={item.type} style={styles.breakdownRow}>
                      <View style={styles.breakdownLabelRow}>
                        <Text style={styles.breakdownLabel}>{TYPE_LABELS[item.type] || item.type}</Text>
                        <Text style={[styles.breakdownCount, { color }]}>{item.count}</Text>
                      </View>
                      <View style={styles.barContainer}>
                        <View style={[styles.bar, { width: `${barWidth}%`, backgroundColor: color }]} />
                      </View>
                    </View>
                  );
                })}
              </View>
            )}

            <View style={styles.recentCard}>
              <View style={styles.sectionHeader}>
                <MessageSquare size={16} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Recent Messages</Text>
                <TouchableOpacity
                  style={styles.viewAllBtn}
                  onPress={() => router.push('/sms-history' as any)}
                >
                  <Text style={styles.viewAllText}>View All</Text>
                </TouchableOpacity>
              </View>

              {recentQuery.isLoading ? (
                <ShimmerIndicator size="small" color={Colors.primary} style={{ marginTop: 16 }} />
              ) : (recentQuery.data ?? []).length === 0 ? (
                <View style={styles.emptyRecent}>
                  <Text style={styles.emptyRecentText}>No messages yet</Text>
                </View>
              ) : (
                (recentQuery.data ?? []).map((msg) => {
                  const typeColor = TYPE_COLORS[msg.type] || Colors.textSecondary;
                  const isSuccess = msg.status === 'sent' || msg.status === 'delivered';
                  return (
                    <View key={msg.id} style={styles.recentItem}>
                      <View style={styles.recentItemLeft}>
                        <View style={[styles.recentDot, { backgroundColor: typeColor }]} />
                        <View style={styles.recentInfo}>
                          <Text style={styles.recentMessage} numberOfLines={1}>
                            {msg.message || 'No content'}
                          </Text>
                          <View style={styles.recentMeta}>
                            <Text style={[styles.recentType, { color: typeColor }]}>
                              {TYPE_LABELS[msg.type] || msg.type}
                            </Text>
                            {msg.recipient_phone && (
                              <Text style={styles.recentPhone}>{msg.recipient_phone}</Text>
                            )}
                          </View>
                        </View>
                      </View>
                      <View style={styles.recentItemRight}>
                        {isSuccess ? (
                          <CheckCircle size={14} color={Colors.success} />
                        ) : msg.status === 'failed' ? (
                          <XCircle size={14} color={Colors.error} />
                        ) : (
                          <Clock size={14} color={Colors.warning} />
                        )}
                        <Text style={styles.recentTime}>{formatTime(msg.created_at)}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <View style={styles.quickActions}>
              <TouchableOpacity
                style={styles.quickActionBtn}
                onPress={() => router.push('/sms-reports' as any)}
                testID="go-to-command-center"
              >
                <Zap size={18} color={Colors.primary} />
                <Text style={styles.quickActionText}>Command Center</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionBtn}
                onPress={() => router.push('/sms-compose' as any)}
                testID="go-to-compose-sms"
              >
                <Send size={18} color={Colors.accent} />
                <Text style={styles.quickActionText}>Compose SMS</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.quickActionBtn}
                onPress={() => router.push('/sms-history' as any)}
                testID="go-to-history-bottom"
              >
                <History size={18} color={Colors.success} />
                <Text style={styles.quickActionText}>Full History</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </ScrollView>
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
  historyBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const},
  scroll: {
    flex: 1},
  scrollContent: {
    padding: 16,
    paddingBottom: 40},
  loadingContainer: {
    flex: 1,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    gap: 12},
  loadingText: {
    fontSize: 14,
    color: Colors.textSecondary},
  systemStatusCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 16},
  systemStatusRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10},
  systemDot: {
    width: 10,
    height: 10,
    borderRadius: 5},
  systemStatusLabel: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text},
  lastActivityText: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 6,
    marginLeft: 20},
  statsGrid: {
    flexDirection: 'row' as const,
    flexWrap: 'wrap' as const,
    gap: 10,
    marginBottom: 16},
  statCard: {
    flex: 1,
    minWidth: '45%' as any,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    alignItems: 'center' as const,
    gap: 8,
    borderWidth: 1},
  statCardPrimary: {
    borderColor: Colors.primary + '30'},
  statCardSuccess: {
    borderColor: Colors.success + '30'},
  statCardWarning: {
    borderColor: Colors.warning + '30'},
  statCardError: {
    borderColor: Colors.error + '30'},
  statNumber: {
    fontSize: 28,
    fontWeight: '800' as const,
    color: Colors.text},
  statLabel: {
    fontSize: 11,
    fontWeight: '500' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.8},
  warningBanner: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 10,
    backgroundColor: 'rgba(255, 184, 0, 0.08)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 184, 0, 0.2)',
    marginBottom: 16},
  warningText: {
    fontSize: 12,
    color: Colors.warning,
    flex: 1,
    lineHeight: 18},
  breakdownCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 16},
  sectionHeader: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8,
    marginBottom: 16},
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600' as const,
    color: Colors.text,
    flex: 1},
  breakdownRow: {
    marginBottom: 12},
  breakdownLabelRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 6},
  breakdownLabel: {
    fontSize: 13,
    color: Colors.textSecondary},
  breakdownCount: {
    fontSize: 14,
    fontWeight: '700' as const},
  barContainer: {
    height: 6,
    backgroundColor: Colors.backgroundTertiary,
    borderRadius: 3,
    overflow: 'hidden' as const},
  bar: {
    height: 6,
    borderRadius: 3},
  recentCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    marginBottom: 16},
  viewAllBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: Colors.primary + '15'},
  viewAllText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.primary},
  emptyRecent: {
    paddingVertical: 20,
    alignItems: 'center' as const},
  emptyRecentText: {
    fontSize: 13,
    color: Colors.textTertiary},
  recentItem: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border},
  recentItemLeft: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    flex: 1,
    gap: 10,
    marginRight: 12},
  recentDot: {
    width: 8,
    height: 8,
    borderRadius: 4},
  recentInfo: {
    flex: 1},
  recentMessage: {
    fontSize: 13,
    color: Colors.text,
    marginBottom: 3},
  recentMeta: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 8},
  recentType: {
    fontSize: 10,
    fontWeight: '600' as const,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  recentPhone: {
    fontSize: 10,
    color: Colors.textTertiary},
  recentItemRight: {
    alignItems: 'flex-end' as const,
    gap: 4},
  recentTime: {
    fontSize: 10,
    color: Colors.textTertiary},
  quickActions: {
    flexDirection: 'row' as const,
    gap: 10},
  quickActionBtn: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 14,
    alignItems: 'center' as const,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  quickActionText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary,
    textAlign: 'center' as const}});
