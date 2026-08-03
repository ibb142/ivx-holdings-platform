import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  Alert,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  RotateCcw,
  Eye,
  Clock,
  ImageIcon,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
  Shield,
  Landmark,
  Filter} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { getPublicationLog, restoreFromPublicationLog } from '@/lib/jv-storage';
import type { PublicationLogEntry } from '@/lib/jv-storage';
import { invalidateAllJVQueries } from '@/lib/jv-realtime';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: 'publish' | 'unpublish' | 'restore' }> = {
  PUBLISH: { label: 'Published', color: '#00C48C', icon: 'publish' },
  UNPUBLISH: { label: 'Unpublished', color: '#FF6B6B', icon: 'unpublish' },
  AUTO_RESTORE: { label: 'Auto-Restored', color: '#4A90D9', icon: 'restore' }};

function formatTimestamp(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHrs = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHrs < 24) return `${diffHrs}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return ts;
  }
}

function ActionIcon({ action }: { action: string }) {
  const config = ACTION_CONFIG[action] || ACTION_CONFIG.PUBLISH;
  if (config.icon === 'publish') return <CheckCircle2 size={16} color={config.color} />;
  if (config.icon === 'unpublish') return <XCircle size={16} color={config.color} />;
  return <RotateCcw size={16} color={config.color} />;
}

export default function PublicationLogScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [filterAction, setFilterAction] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const logQuery = useQuery({
    queryKey: ['publication-log'],
    queryFn: () => getPublicationLog({ limit: 200 }),
    staleTime: 5000});

  const restoreMutation = useMutation({
    mutationFn: (entryId: string) => restoreFromPublicationLog(entryId, { adminOverride: true }),
    onSuccess: (result, _entryId) => {
      if (result.success) {
        Alert.alert('Restored', 'Deal has been restored from this publication snapshot. It is now published and active.');
        invalidateAllJVQueries(queryClient);
        void logQuery.refetch();
      } else {
        Alert.alert('Restore Failed', result.error || 'Unknown error');
      }
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    }});

  const entries = useMemo(() => {
    const raw = logQuery.data || [];
    if (filterAction) return raw.filter(e => e.action === filterAction);
    return raw;
  }, [logQuery.data, filterAction]);

  const stats = useMemo(() => {
    const all = logQuery.data || [];
    return {
      total: all.length,
      publishes: all.filter(e => e.action === 'PUBLISH').length,
      unpublishes: all.filter(e => e.action === 'UNPUBLISH').length,
      restores: all.filter(e => e.restored).length};
  }, [logQuery.data]);

  const handleRestore = useCallback((entry: PublicationLogEntry) => {
    Alert.alert(
      'Restore Deal',
      `Restore "${entry.dealTitle}" from this snapshot?\n\nThis will:\n• Set status to Active\n• Set published to true\n• Restore ${entry.photoCount} photos\n\nThe deal will appear on the home screen immediately.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore Now',
          style: 'default',
          onPress: () => restoreMutation.mutate(entry.id)},
      ]
    );
  }, [restoreMutation]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await logQuery.refetch();
    setRefreshing(false);
  }, [logQuery]);

  const toggleExpand = useCallback((id: string) => {
    setExpandedId(prev => prev === id ? null : id);
  }, []);

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="pub-log-back">
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>Publication Log</Text>
            <Text style={styles.headerSubtitle}>Full history of every publish action</Text>
          </View>
          <View style={styles.headerRight}>
            <Shield size={18} color={Colors.primary} />
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statCard}>
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#00C48C' }]}>{stats.publishes}</Text>
            <Text style={styles.statLabel}>Published</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#FF6B6B' }]}>{stats.unpublishes}</Text>
            <Text style={styles.statLabel}>Unpublished</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={[styles.statValue, { color: '#4A90D9' }]}>{stats.restores}</Text>
            <Text style={styles.statLabel}>Restored</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          <Filter size={14} color={Colors.textSecondary} />
          <TouchableOpacity
            style={[styles.filterChip, !filterAction && styles.filterChipActive]}
            onPress={() => setFilterAction(null)}
          >
            <Text style={[styles.filterChipText, !filterAction && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, filterAction === 'PUBLISH' && styles.filterChipActive]}
            onPress={() => setFilterAction(filterAction === 'PUBLISH' ? null : 'PUBLISH')}
          >
            <Text style={[styles.filterChipText, filterAction === 'PUBLISH' && styles.filterChipTextActive]}>Published</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.filterChip, filterAction === 'UNPUBLISH' && styles.filterChipActive]}
            onPress={() => setFilterAction(filterAction === 'UNPUBLISH' ? null : 'UNPUBLISH')}
          >
            <Text style={[styles.filterChipText, filterAction === 'UNPUBLISH' && styles.filterChipTextActive]}>Unpublished</Text>
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          {logQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={styles.loadingText}>Loading publication history...</Text>
            </View>
          ) : entries.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Landmark size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Publication History</Text>
              <Text style={styles.emptySubtitle}>
                {filterAction
                  ? 'No entries match this filter. Try "All".'
                  : 'When you publish or unpublish JV deals, every action will be logged here with a full snapshot for easy restoration.'}
              </Text>
            </View>
          ) : (
            entries.map((entry) => {
              const config = ACTION_CONFIG[entry.action] || ACTION_CONFIG.PUBLISH;
              const isExpanded = expandedId === entry.id;
              const photos = entry.photos || [];

              return (
                <View key={entry.id} style={styles.logCard}>
                  <TouchableOpacity style={styles.logCardHeader} onPress={() => toggleExpand(entry.id)} activeOpacity={0.7}>
                    <View style={styles.logCardLeft}>
                      <View style={[styles.actionBadge, { backgroundColor: config.color + '18' }]}>
                        <ActionIcon action={entry.action} />
                      </View>
                      <View style={styles.logCardInfo}>
                        <Text style={styles.logCardTitle} numberOfLines={1}>{entry.dealTitle}</Text>
                        <View style={styles.logCardMeta}>
                          <View style={[styles.actionPill, { backgroundColor: config.color + '15' }]}>
                            <Text style={[styles.actionPillText, { color: config.color }]}>{config.label}</Text>
                          </View>
                          <View style={styles.timeBadge}>
                            <Clock size={10} color={Colors.textTertiary} />
                            <Text style={styles.timeText}>{formatTimestamp(entry.timestamp)}</Text>
                          </View>
                        </View>
                        <View style={styles.logCardDetails}>
                          <View style={styles.photoCountBadge}>
                            <ImageIcon size={10} color={Colors.textSecondary} />
                            <Text style={styles.photoCountText}>{entry.photoCount} photos</Text>
                          </View>
                          {entry.projectName ? (
                            <Text style={styles.projectNameText} numberOfLines={1}>{entry.projectName}</Text>
                          ) : null}
                        </View>
                      </View>
                    </View>
                    <View style={styles.logCardRight}>
                      {entry.restored ? (
                        <View style={styles.restoredBadge}>
                          <CheckCircle2 size={10} color="#4A90D9" />
                          <Text style={styles.restoredText}>Restored</Text>
                        </View>
                      ) : null}
                      {isExpanded ? (
                        <ChevronUp size={18} color={Colors.textTertiary} />
                      ) : (
                        <ChevronDown size={18} color={Colors.textTertiary} />
                      )}
                    </View>
                  </TouchableOpacity>

                  {isExpanded ? (
                    <View style={styles.expandedSection}>
                      <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Deal ID</Text>
                        <Text style={styles.expandedValue} numberOfLines={1}>{entry.dealId}</Text>
                      </View>
                      <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Project</Text>
                        <Text style={styles.expandedValue}>{entry.projectName || '—'}</Text>
                      </View>
                      <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Status at time</Text>
                        <Text style={styles.expandedValue}>{entry.status || '—'}</Text>
                      </View>
                      <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Performed by</Text>
                        <Text style={styles.expandedValue}>{entry.performedBy} ({entry.performedByRole})</Text>
                      </View>
                      <View style={styles.expandedRow}>
                        <Text style={styles.expandedLabel}>Exact time</Text>
                        <Text style={styles.expandedValue}>{new Date(entry.timestamp).toLocaleString()}</Text>
                      </View>
                      {entry.restoredAt ? (
                        <View style={styles.expandedRow}>
                          <Text style={styles.expandedLabel}>Restored at</Text>
                          <Text style={[styles.expandedValue, { color: '#4A90D9' }]}>{new Date(entry.restoredAt).toLocaleString()}</Text>
                        </View>
                      ) : null}

                      {photos.length > 0 ? (
                        <View style={styles.photosSection}>
                          <Text style={styles.photosSectionTitle}>Snapshot Photos ({photos.length})</Text>
                          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.photosScroll}>
                            {photos.slice(0, 8).map((photo, i) => (
                              <Image key={`snap-${i}`} source={{ uri: photo }} style={styles.photoThumb} resizeMode="cover" />
                            ))}
                          </ScrollView>
                        </View>
                      ) : null}

                      <View style={styles.expandedActions}>
                        <TouchableOpacity
                          style={[styles.restoreBtn, restoreMutation.isPending && styles.restoreBtnDisabled]}
                          onPress={() => handleRestore(entry)}
                          disabled={restoreMutation.isPending}
                          activeOpacity={0.8}
                          testID={`restore-${entry.id}`}
                        >
                          {restoreMutation.isPending ? (
                            <ShimmerIndicator size="small" color="#000" />
                          ) : (
                            <RotateCcw size={16} color="#000" />
                          )}
                          <Text style={styles.restoreBtnText}>
                            {restoreMutation.isPending ? 'Restoring...' : 'Restore This Snapshot'}
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.viewBtn}
                          onPress={() => router.push({ pathname: '/jv-invest', params: { jvId: entry.dealId } } as any)}
                          activeOpacity={0.8}
                        >
                          <Eye size={16} color={Colors.primary} />
                          <Text style={styles.viewBtnText}>View Deal</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}

          <View style={{ height: 120 }} />
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
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder},
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  headerCenter: {
    flex: 1,
    marginLeft: 12},
  headerTitle: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text},
  headerSubtitle: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 1},
  headerRight: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8},
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statValue: {
    fontSize: 20,
    fontWeight: '800' as const,
    color: Colors.text},
  statLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    marginTop: 2},
  filterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingBottom: 12,
    gap: 8},
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  filterChipActive: {
    backgroundColor: Colors.primary + '18',
    borderColor: Colors.primary + '40'},
  filterChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  filterChipTextActive: {
    color: Colors.primary},
  scrollView: {
    flex: 1,
    paddingHorizontal: 16},
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 60},
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
    marginTop: 12},
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32},
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 16},
  emptySubtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 20},
  logCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    overflow: 'hidden'},
  logCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14},
  logCardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1},
  actionBadge: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center'},
  logCardInfo: {
    flex: 1},
  logCardTitle: {
    fontSize: 14,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 4},
  logCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4},
  actionPill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8},
  actionPillText: {
    fontSize: 10,
    fontWeight: '700' as const},
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3},
  timeText: {
    fontSize: 10,
    color: Colors.textTertiary,
    fontWeight: '500' as const},
  logCardDetails: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  photoCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3},
  photoCountText: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: '500' as const},
  projectNameText: {
    fontSize: 10,
    color: Colors.textTertiary,
    maxWidth: 150},
  logCardRight: {
    alignItems: 'flex-end',
    gap: 4},
  restoredBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#4A90D915',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6},
  restoredText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: '#4A90D9'},
  expandedSection: {
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    padding: 14},
  expandedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6},
  expandedLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  expandedValue: {
    fontSize: 12,
    color: Colors.text,
    fontWeight: '500' as const,
    maxWidth: '60%' as any,
    textAlign: 'right' as const},
  photosSection: {
    marginTop: 12},
  photosSectionTitle: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 8},
  photosScroll: {
    marginBottom: 12},
  photoThumb: {
    width: 72,
    height: 72,
    borderRadius: 10,
    marginRight: 8,
    backgroundColor: Colors.backgroundSecondary},
  expandedActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 8},
  restoreBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 12},
  restoreBtnDisabled: {
    opacity: 0.6},
  restoreBtnText: {
    fontSize: 13,
    fontWeight: '700' as const,
    color: '#000'},
  viewBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: Colors.primary + '40',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 16},
  viewBtnText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.primary}});
