import React, { useState, useCallback, useMemo } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  TextInput} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Shield,
  Eye,
  Search,
  Clock,
  User,
  Activity,
  ChevronDown,
  ChevronUp,
  FileText,
  Users,
  Settings,
  Database,
  AlertTriangle,
  Filter,
  X} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const ACTION_ICONS: Record<string, { icon: typeof Eye; color: string }> = {
  view: { icon: Eye, color: Colors.accent },
  edit: { icon: Settings, color: Colors.warning },
  create: { icon: FileText, color: Colors.positive },
  delete: { icon: AlertTriangle, color: Colors.negative },
  export: { icon: Database, color: '#9B59B6' },
  approve: { icon: Shield, color: Colors.positive },
  reject: { icon: X, color: Colors.negative },
  default: { icon: Activity, color: Colors.textSecondary }};

function getActionMeta(action: string) {
  const lower = action.toLowerCase();
  if (lower.includes('view') || lower.includes('read') || lower.includes('get') || lower.includes('fetch')) return ACTION_ICONS.view;
  if (lower.includes('edit') || lower.includes('update') || lower.includes('change')) return ACTION_ICONS.edit;
  if (lower.includes('create') || lower.includes('add') || lower.includes('invite')) return ACTION_ICONS.create;
  if (lower.includes('delete') || lower.includes('remove')) return ACTION_ICONS.delete;
  if (lower.includes('export') || lower.includes('download')) return ACTION_ICONS.export;
  if (lower.includes('approve')) return ACTION_ICONS.approve;
  if (lower.includes('reject') || lower.includes('deny')) return ACTION_ICONS.reject;
  return ACTION_ICONS.default;
}

function formatTimestamp(ts: string) {
  const d = new Date(ts);
  const now = Date.now();
  const diff = now - d.getTime();

  if (diff < 60000) return 'Just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  if (diff < 172800000) return 'Yesterday';

  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'});
}

function parseSection(details: string): string {
  const match = details.match(/Section:\s*([^|]+)/);
  return match ? match[1].trim() : 'General';
}

function parseStaffAction(details: string): string {
  const match = details.match(/Action:\s*([^|]+)/);
  return match ? match[1].trim() : details.substring(0, 60);
}

export default function StaffActivityScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [filterStaffId, setFilterStaffId] = useState<string | undefined>(undefined);

  const queryClient = useQueryClient();

  const summaryQuery = useQuery<{ staff: any[]; totalActionsToday: number; totalActionsWeek: number; totalStaff: number; sectionBreakdown: Record<string, number> } | null>({
    queryKey: ['staffActivity.getStaffSummary'],
    queryFn: async () => {
      console.log('[Supabase] Fetching staff summary');
      const { data, error } = await supabase.from('staff_activity').select('*').limit(50);
      if (error) { console.log('[Supabase] staff_activity error:', error.message); return null; }
      return {
        staff: data ?? [],
        totalActionsToday: 0,
        totalActionsWeek: 0,
        totalStaff: data?.length ?? 0,
        sectionBreakdown: {}};
    },
    staleTime: 30000});

  const logsQuery = useQuery<{ logs: any[]; total: number; totalPages: number; page: number } | null>({
    queryKey: ['staffActivity.getActivityLog', { page, limit: 50, staffId: filterStaffId, action: searchQuery || undefined }],
    queryFn: async () => {
      console.log('[Supabase] Fetching activity log');
      const { data, error } = await supabase.from('staff_activity_log').select('*').limit(50);
      if (error) { console.log('[Supabase] staff_activity_log error:', error.message); return null; }
      return {
        logs: data ?? [],
        total: data?.length ?? 0,
        totalPages: 1,
        page: 1};
    },
    staleTime: 3000});

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: ['staffActivity.getStaffSummary'] }),
      queryClient.invalidateQueries({ queryKey: ['staffActivity.getActivityLog'] }),
    ]).finally(() => setRefreshing(false));
  }, [queryClient]);

  const summary = summaryQuery.data;
  const logs = logsQuery.data;

  const filteredStaff = useMemo(() => {
    return summary?.staff || [];
  }, [summary]);

  const isLoading = summaryQuery.isLoading || logsQuery.isLoading;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Staff Activity Tracker</Text>
          <Text style={styles.subtitle}>Monitor all staff actions in real-time</Text>
        </View>
        <TouchableOpacity
          style={[styles.filterBtn, showFilters && styles.filterBtnActive]}
          onPress={() => setShowFilters(!showFilters)}
        >
          <Filter size={18} color={showFilters ? '#000' : Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {isLoading && !summary && (
          <View style={styles.loadingContainer}>
            <ShimmerIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading activity data...</Text>
          </View>
        )}

        {summary && (
          <>
            <View style={styles.securityBanner}>
              <Shield size={20} color={Colors.primary} />
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.bannerTitle}>CEO-Only Access</Text>
                <Text style={styles.bannerDesc}>
                  Every action by your staff is tracked and logged. Only you can see this data. All data is encrypted and stored securely.
                </Text>
              </View>
            </View>

            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <View style={[styles.statIcon, { backgroundColor: Colors.accent + '20' }]}>
                  <Activity size={18} color={Colors.accent} />
                </View>
                <Text style={styles.statValue}>{summary.totalActionsToday}</Text>
                <Text style={styles.statLabel}>Today</Text>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIcon, { backgroundColor: Colors.primary + '20' }]}>
                  <Clock size={18} color={Colors.primary} />
                </View>
                <Text style={styles.statValue}>{summary.totalActionsWeek}</Text>
                <Text style={styles.statLabel}>This Week</Text>
              </View>
              <View style={styles.statCard}>
                <View style={[styles.statIcon, { backgroundColor: Colors.positive + '20' }]}>
                  <Users size={18} color={Colors.positive} />
                </View>
                <Text style={styles.statValue}>{summary.totalStaff}</Text>
                <Text style={styles.statLabel}>Staff</Text>
              </View>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Staff Members</Text>
              {filteredStaff.map((member: any) => (
                <TouchableOpacity
                  key={member.id}
                  style={[
                    styles.staffCard,
                    filterStaffId === member.id && styles.staffCardActive,
                  ]}
                  onPress={() => {
                    if (filterStaffId === member.id) {
                      setFilterStaffId(undefined);
                    } else {
                      setFilterStaffId(member.id);
                    }
                    setPage(1);
                  }}
                >
                  <View style={styles.staffAvatar}>
                    <Text style={styles.staffAvatarText}>
                      {member.name.split(' ').map((n: string) => n[0]).join('').toUpperCase()}
                    </Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.staffNameRow}>
                      <Text style={styles.staffName}>{member.name}</Text>
                      <View style={[styles.roleBadge, { backgroundColor: member.role === 'ceo' ? Colors.primary + '20' : Colors.accent + '20' }]}>
                        <Text style={[styles.roleBadgeText, { color: member.role === 'ceo' ? Colors.primary : Colors.accent }]}>
                          {member.role.toUpperCase()}
                        </Text>
                      </View>
                    </View>
                    <Text style={styles.staffEmail}>{member.email}</Text>
                    <View style={styles.staffStatsRow}>
                      <Text style={styles.staffStat}>
                        <Text style={styles.staffStatNum}>{member.actionsLast24h}</Text> today
                      </Text>
                      <Text style={styles.staffStatDivider}>·</Text>
                      <Text style={styles.staffStat}>
                        <Text style={styles.staffStatNum}>{member.actionsLast7d}</Text> this week
                      </Text>
                      <Text style={styles.staffStatDivider}>·</Text>
                      <Text style={styles.staffStat}>
                        <Text style={styles.staffStatNum}>{member.totalActions}</Text> total
                      </Text>
                    </View>
                  </View>
                  {member.lastActivity && (
                    <View style={styles.lastSeenBadge}>
                      <Clock size={10} color={Colors.textTertiary} />
                      <Text style={styles.lastSeenText}>
                        {formatTimestamp(member.lastActivity)}
                      </Text>
                    </View>
                  )}
                </TouchableOpacity>
              ))}
              {filteredStaff.length === 0 && (
                <View style={styles.emptyState}>
                  <Users size={32} color={Colors.textTertiary} />
                  <Text style={styles.emptyText}>No staff members found</Text>
                </View>
              )}
            </View>

            {Object.keys(summary.sectionBreakdown).length > 0 && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Most Accessed Sections (7d)</Text>
                <View style={styles.sectionBreakdownCard}>
                  {Object.entries(summary.sectionBreakdown)
                    .sort((a: [string, unknown], b: [string, unknown]) => (b[1] as number) - (a[1] as number))
                    .slice(0, 8)
                    .map(([section, count]: [string, unknown], _idx: number) => {
                      const maxCount = Math.max(...Object.values(summary.sectionBreakdown).map((v: unknown) => v as number));
                      const width = maxCount > 0 ? ((count as number) / maxCount) * 100 : 0;
                      return (
                        <View key={section} style={styles.breakdownRow}>
                          <Text style={styles.breakdownLabel} numberOfLines={1}>{section}</Text>
                          <View style={styles.breakdownBarBg}>
                            <View style={[styles.breakdownBar, { width: `${width}%` }]} />
                          </View>
                          <Text style={styles.breakdownCount}>{String(count)}</Text>
                        </View>
                      );
                    })}
                </View>
              </View>
            )}
          </>
        )}

        {showFilters && (
          <View style={styles.filterBar}>
            <View style={styles.searchContainer}>
              <Search size={16} color={Colors.textTertiary} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search actions..."
                placeholderTextColor={Colors.textTertiary}
                value={searchQuery}
                onChangeText={(text) => {
                  setSearchQuery(text);
                  setPage(1);
                }}
              />
              {searchQuery.length > 0 && (
                <TouchableOpacity onPress={() => { setSearchQuery(''); setPage(1); }}>
                  <X size={16} color={Colors.textTertiary} />
                </TouchableOpacity>
              )}
            </View>
            {filterStaffId && (
              <TouchableOpacity
                style={styles.clearFilterBtn}
                onPress={() => { setFilterStaffId(undefined); setPage(1); }}
              >
                <X size={14} color={Colors.primary} />
                <Text style={styles.clearFilterText}>Clear staff filter</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Activity Log</Text>
            {logs && (
              <Text style={styles.logCount}>{logs.total} entries</Text>
            )}
          </View>

          {logsQuery.isLoading && (
            <ShimmerIndicator size="small" color={Colors.primary} style={{ marginVertical: 20 }} />
          )}

          {logs?.logs.map((log: any) => {
            const meta = getActionMeta(log.action);
            const IconComp = meta.icon;
            const isExpanded = expandedLog === log.id;
            const section = parseSection(log.details);
            const actionLabel = parseStaffAction(log.details);

            return (
              <TouchableOpacity
                key={log.id}
                style={styles.logCard}
                onPress={() => setExpandedLog(isExpanded ? null : log.id)}
                activeOpacity={0.7}
              >
                <View style={styles.logRow}>
                  <View style={[styles.logIcon, { backgroundColor: meta.color + '18' }]}>
                    <IconComp size={16} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.logTopRow}>
                      <Text style={styles.logAction} numberOfLines={1}>{actionLabel}</Text>
                      <Text style={styles.logTime}>{formatTimestamp(log.timestamp)}</Text>
                    </View>
                    <View style={styles.logMetaRow}>
                      <View style={styles.logStaffBadge}>
                        <User size={10} color={Colors.textTertiary} />
                        <Text style={styles.logStaffName}>{log.staffName}</Text>
                      </View>
                      <View style={styles.logSectionBadge}>
                        <Text style={styles.logSectionText}>{section}</Text>
                      </View>
                    </View>
                  </View>
                  {isExpanded ? (
                    <ChevronUp size={16} color={Colors.textTertiary} />
                  ) : (
                    <ChevronDown size={16} color={Colors.textTertiary} />
                  )}
                </View>

                {isExpanded && (
                  <View style={styles.logDetails}>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Staff</Text>
                      <Text style={styles.detailValue}>{log.staffName} ({log.staffEmail})</Text>
                    </View>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Role</Text>
                      <Text style={styles.detailValue}>{log.staffRole}</Text>
                    </View>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Action</Text>
                      <Text style={styles.detailValue}>{log.action}</Text>
                    </View>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Time</Text>
                      <Text style={styles.detailValue}>
                        {new Date(log.timestamp).toLocaleString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                          second: '2-digit'})}
                      </Text>
                    </View>
                    <View style={styles.detailLine}>
                      <Text style={styles.detailLabel}>Full Details</Text>
                      <Text style={styles.detailValueFull}>{log.details}</Text>
                    </View>
                  </View>
                )}
              </TouchableOpacity>
            );
          })}

          {logs && logs.logs.length === 0 && (
            <View style={styles.emptyState}>
              <Activity size={32} color={Colors.textTertiary} />
              <Text style={styles.emptyText}>No activity logs found</Text>
              <Text style={styles.emptySubtext}>Activity will appear here as staff use the app</Text>
            </View>
          )}

          {logs && logs.totalPages > 1 && (
            <View style={styles.pagination}>
              <TouchableOpacity
                style={[styles.pageBtn, page <= 1 && styles.pageBtnDisabled]}
                disabled={page <= 1}
                onPress={() => setPage(p => Math.max(1, p - 1))}
              >
                <Text style={[styles.pageBtnText, page <= 1 && styles.pageBtnTextDisabled]}>Previous</Text>
              </TouchableOpacity>
              <Text style={styles.pageInfo}>
                Page {logs.page} of {logs.totalPages}
              </Text>
              <TouchableOpacity
                style={[styles.pageBtn, page >= logs.totalPages && styles.pageBtnDisabled]}
                disabled={page >= logs.totalPages}
                onPress={() => setPage(p => p + 1)}
              >
                <Text style={[styles.pageBtnText, page >= logs.totalPages && styles.pageBtnTextDisabled]}>Next</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  subtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 2 },
  filterBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  filterBtnActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  content: { flex: 1, paddingHorizontal: 16 },
  loadingContainer: { alignItems: 'center', justifyContent: 'center', paddingVertical: 60, gap: 12 },
  loadingText: { color: Colors.textSecondary, fontSize: 14 },
  securityBanner: { flexDirection: 'row', alignItems: 'flex-start', backgroundColor: Colors.primary + '10', borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: Colors.primary + '30' },
  bannerTitle: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  bannerDesc: { color: Colors.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 3 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 6, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  statValue: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  section: { marginBottom: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  logCount: { color: Colors.textTertiary, fontSize: 12 },
  staffCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 14, padding: 14, marginBottom: 8, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 12 },
  staffCardActive: { borderColor: Colors.primary, backgroundColor: Colors.primary + '08' },
  staffAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: Colors.accent + '20', alignItems: 'center', justifyContent: 'center' },
  staffAvatarText: { color: Colors.accent, fontSize: 14, fontWeight: '700' as const },
  staffNameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  staffName: { color: Colors.text, fontSize: 14, fontWeight: '700' as const },
  staffEmail: { color: Colors.textTertiary, fontSize: 11, marginTop: 1 },
  roleBadge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  roleBadgeText: { fontSize: 9, fontWeight: '800' as const },
  staffStatsRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  staffStat: { color: Colors.textSecondary, fontSize: 11 },
  staffStatNum: { color: Colors.text, fontWeight: '700' as const },
  staffStatDivider: { color: Colors.textTertiary, fontSize: 11 },
  lastSeenBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, position: 'absolute' as const, top: 14, right: 14 },
  lastSeenText: { color: Colors.textTertiary, fontSize: 10 },
  sectionBreakdownCard: { backgroundColor: Colors.surface, borderRadius: 14, padding: 14, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 10 },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  breakdownLabel: { color: Colors.textSecondary, fontSize: 12, width: 100 },
  breakdownBarBg: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.backgroundSecondary, overflow: 'hidden' as const },
  breakdownBar: { height: 6, borderRadius: 3, backgroundColor: Colors.primary },
  breakdownCount: { color: Colors.text, fontSize: 12, fontWeight: '700' as const, width: 36, textAlign: 'right' as const },
  filterBar: { backgroundColor: Colors.surface, borderRadius: 14, padding: 12, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 10 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.backgroundSecondary, borderRadius: 10, paddingHorizontal: 12, gap: 8 },
  searchInput: { flex: 1, color: Colors.text, fontSize: 14, paddingVertical: 10 },
  clearFilterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  clearFilterText: { color: Colors.primary, fontSize: 12, fontWeight: '600' as const },
  logCard: { backgroundColor: Colors.surface, borderRadius: 12, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: Colors.surfaceBorder },
  logRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logIcon: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  logTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  logAction: { color: Colors.text, fontSize: 13, fontWeight: '600' as const, flex: 1 },
  logTime: { color: Colors.textTertiary, fontSize: 10 },
  logMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  logStaffBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  logStaffName: { color: Colors.textSecondary, fontSize: 11 },
  logSectionBadge: { backgroundColor: Colors.backgroundSecondary, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1 },
  logSectionText: { color: Colors.textTertiary, fontSize: 10 },
  logDetails: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: Colors.surfaceBorder, gap: 8 },
  detailLine: { flexDirection: 'row', gap: 10 },
  detailLabel: { color: Colors.textTertiary, fontSize: 11, width: 70, fontWeight: '600' as const },
  detailValue: { color: Colors.textSecondary, fontSize: 11, flex: 1 },
  detailValueFull: { color: Colors.textSecondary, fontSize: 11, flex: 1, lineHeight: 16 },
  emptyState: { alignItems: 'center', paddingVertical: 40, gap: 10 },
  emptyText: { color: Colors.textSecondary, fontSize: 14, fontWeight: '600' as const },
  emptySubtext: { color: Colors.textTertiary, fontSize: 12 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14 },
  pageBtn: { backgroundColor: Colors.surface, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  pageBtnDisabled: { opacity: 0.4 },
  pageBtnText: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  pageBtnTextDisabled: { color: Colors.textTertiary },
  pageInfo: { color: Colors.textSecondary, fontSize: 12 }});
