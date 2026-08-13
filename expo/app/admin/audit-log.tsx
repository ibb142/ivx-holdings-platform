import React, { useState, useMemo, useCallback, useEffect } from 'react';
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
  Search,
  Shield,
  Clock,
  Trash2,
  ArchiveRestore,
  Eye,
  EyeOff,
  ShoppingCart,
  Edit3,
  UserCheck,
  Database,
  ChevronDown,
  ChevronUp} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { getAuditTrail, getAuditStats } from '@/lib/audit-trail';
import { formatAuditTimestamp, loadTimezoneProfile, getOffsetString, type IanaTimezone } from '@/lib/time-service';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

const ACTION_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  CREATE: { label: 'Created', color: '#00C48C', icon: 'plus' },
  UPDATE: { label: 'Updated', color: '#4A90D9', icon: 'edit' },
  DELETE: { label: 'Deleted', color: '#FF4D4D', icon: 'trash' },
  SOFT_DELETE: { label: 'Soft Deleted', color: '#FF6B6B', icon: 'trash' },
  TRASH: { label: 'Trashed', color: '#FF8C00', icon: 'trash' },
  RESTORE: { label: 'Restored', color: '#00C48C', icon: 'restore' },
  RESTORE_FROM_TRASH: { label: 'Restored', color: '#00C48C', icon: 'restore' },
  PERMANENT_DELETE: { label: 'Perm. Deleted', color: '#FF0000', icon: 'trash' },
  ARCHIVE: { label: 'Archived', color: '#A855F7', icon: 'archive' },
  PUBLISH: { label: 'Published', color: '#00C48C', icon: 'eye' },
  UNPUBLISH: { label: 'Unpublished', color: '#9A9A9A', icon: 'eye-off' },
  PURCHASE: { label: 'Purchase', color: '#FFD700', icon: 'cart' },
  SELL: { label: 'Sale', color: '#FF4D4D', icon: 'cart' },
  TRANSFER: { label: 'Transfer', color: '#4A90D9', icon: 'transfer' },
  DEPOSIT: { label: 'Deposit', color: '#00C48C', icon: 'deposit' },
  WITHDRAWAL: { label: 'Withdrawal', color: '#FF6B6B', icon: 'withdrawal' },
  LOGIN: { label: 'Login', color: '#4A90D9', icon: 'user' },
  LOGOUT: { label: 'Logout', color: '#9A9A9A', icon: 'user' },
  ROLE_CHANGE: { label: 'Role Change', color: '#A855F7', icon: 'shield' },
  BACKUP_CREATED: { label: 'Backup', color: '#00C48C', icon: 'database' },
  BACKUP_RESTORED: { label: 'Backup Restored', color: '#FFD700', icon: 'database' },
  SYSTEM_EVENT: { label: 'System', color: '#9A9A9A', icon: 'system' },
  PHOTO_UPDATE: { label: 'Photos Updated', color: '#4A90D9', icon: 'image' },
  REFUND: { label: 'Refund', color: '#FF8C00', icon: 'refund' }};

const ENTITY_LABELS: Record<string, string> = {
  jv_deal: 'JV Deal',
  transaction: 'Transaction',
  holding: 'Holding',
  property: 'Property',
  contract: 'Contract',
  wallet: 'Wallet',
  profile: 'Profile',
  notification: 'Notification',
  application: 'Application',
  auth: 'Auth',
  system: 'System'};

function getActionIcon(action: string) {
  switch (action) {
    case 'CREATE':
    case 'RESTORE':
    case 'RESTORE_FROM_TRASH':
    case 'BACKUP_RESTORED':
      return <ArchiveRestore size={14} color="#00C48C" />;
    case 'DELETE':
    case 'SOFT_DELETE':
    case 'TRASH':
    case 'PERMANENT_DELETE':
      return <Trash2 size={14} color="#FF4D4D" />;
    case 'PUBLISH':
      return <Eye size={14} color="#00C48C" />;
    case 'UNPUBLISH':
      return <EyeOff size={14} color="#9A9A9A" />;
    case 'PURCHASE':
    case 'SELL':
      return <ShoppingCart size={14} color="#FFD700" />;
    case 'UPDATE':
    case 'PHOTO_UPDATE':
      return <Edit3 size={14} color="#4A90D9" />;
    case 'LOGIN':
    case 'LOGOUT':
    case 'ROLE_CHANGE':
      return <UserCheck size={14} color="#A855F7" />;
    case 'BACKUP_CREATED':
      return <Database size={14} color="#00C48C" />;
    default:
      return <Shield size={14} color={Colors.textTertiary} />;
  }
}

export default function AuditLogScreen() {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [entityFilter, setEntityFilter] = useState<string>('all');
  const [expandedEntry, setExpandedEntry] = useState<string | null>(null);
  const [userTimezone, setUserTimezone] = useState<IanaTimezone>('UTC');
  const [userHourPref, setUserHourPref] = useState<'12h' | '24h'>('12h');
  const [device, setDevice] = useState('');

  useEffect(() => {
    let mounted = true;
    loadTimezoneProfile().then((profile) => {
      if (mounted && profile) {
        setUserTimezone(profile.timezone);
        setUserHourPref(profile.hour_preference);
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const auditQuery = useQuery({
    queryKey: ['audit-trail'],
    queryFn: async () => {
      console.log('[AuditLog] Fetching audit trail...');
      const entries = await getAuditTrail({ limit: 500 });
      const stats = await getAuditStats();
      console.log('[AuditLog] Fetched', entries.length, 'entries');
      return { entries, stats };
    },
    staleTime: 1000 * 10});

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void auditQuery.refetch().finally(() => setRefreshing(false));
  }, [auditQuery]);

  const filteredEntries = useMemo(() => {
    let entries = auditQuery.data?.entries ?? [];
    if (entityFilter !== 'all') {
      entries = entries.filter(e => e.entityType === entityFilter);
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      entries = entries.filter(e =>
        (e.entityTitle || '').toLowerCase().includes(q) ||
        (e.entityId || '').toLowerCase().includes(q) ||
        (e.action || '').toLowerCase().includes(q) ||
        (e.userId || '').toLowerCase().includes(q)
      );
    }
    return entries;
  }, [auditQuery.data, entityFilter, searchQuery]);

  const stats = auditQuery.data?.stats;

  const formatDate = (dateStr: string) => {
    try {
      const entry = formatAuditTimestamp(dateStr, userTimezone, device);
      return entry.local_time;
    } catch {
      return dateStr;
    }
  };

  const formatUtcOnly = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
    } catch {
      return dateStr;
    }
  };

  const getEntryOffset = (dateStr: string) => {
    try {
      const entry = formatAuditTimestamp(dateStr, userTimezone);
      return entry.offset;
    } catch {
      return '+00:00';
    }
  };

  const ENTITY_FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'jv_deal', label: 'JV Deals' },
    { id: 'transaction', label: 'Transactions' },
    { id: 'holding', label: 'Holdings' },
    { id: 'property', label: 'Properties' },
    { id: 'wallet', label: 'Wallets' },
    { id: 'system', label: 'System' },
  ];

  return (
    <View style={styles.container}>
      <SafeAreaView edges={['top']} style={styles.safeArea}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="audit-log-back">
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Shield size={18} color={Colors.primary} />
            <Text style={styles.headerTitle}>Audit Trail</Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.headerCount}>{filteredEntries.length}</Text>
          </View>
        </View>

        {stats && (
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.totalEntries}</Text>
              <Text style={styles.statLabel}>Total</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: '#00C48C' }]}>{stats.todayEntries}</Text>
              <Text style={styles.statLabel}>Today</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: '#FF4D4D' }]}>{stats.deleteActions}</Text>
              <Text style={styles.statLabel}>Deletes</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={[styles.statValue, { color: '#4A90D9' }]}>{stats.restoreActions}</Text>
              <Text style={styles.statLabel}>Restores</Text>
            </View>
          </View>
        )}

        <View style={styles.searchWrap}>
          <Search size={16} color={Colors.textTertiary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by title, ID, action..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
            testID="audit-search"
          />
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filtersRow}>
          {ENTITY_FILTERS.map(opt => (
            <TouchableOpacity
              key={opt.id}
              style={[styles.filterChip, entityFilter === opt.id && styles.filterChipActive]}
              onPress={() => setEntityFilter(opt.id)}
            >
              <Text style={[styles.filterChipText, entityFilter === opt.id && styles.filterChipTextActive]}>
                {opt.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
          }
        >
          {auditQuery.isLoading ? (
            <View style={styles.centerWrap}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={styles.centerText}>Loading audit trail...</Text>
            </View>
          ) : filteredEntries.length === 0 ? (
            <View style={styles.centerWrap}>
              <Shield size={48} color={Colors.textTertiary} />
              <Text style={styles.emptyTitle}>No Audit Entries</Text>
              <Text style={styles.emptySubtitle}>
                {searchQuery ? 'No entries match your search' : 'Actions will be logged here as they occur'}
              </Text>
            </View>
          ) : (
            filteredEntries.map(entry => {
              const config = ACTION_CONFIG[entry.action] || ACTION_CONFIG.SYSTEM_EVENT;
              const isExpanded = expandedEntry === entry.id;
              return (
                <TouchableOpacity
                  key={entry.id}
                  style={[styles.entryCard, { borderLeftColor: config.color + '60' }]}
                  onPress={() => setExpandedEntry(isExpanded ? null : entry.id)}
                  activeOpacity={0.7}
                  testID={`audit-entry-${entry.id}`}
                >
                  <View style={styles.entryHeader}>
                    <View style={[styles.entryIcon, { backgroundColor: config.color + '18' }]}>
                      {getActionIcon(entry.action)}
                    </View>
                    <View style={styles.entryInfo}>
                      <View style={styles.entryTopRow}>
                        <View style={[styles.actionBadge, { backgroundColor: config.color + '20' }]}>
                          <Text style={[styles.actionBadgeText, { color: config.color }]}>{config.label}</Text>
                        </View>
                        <View style={[styles.entityBadge]}>
                          <Text style={styles.entityBadgeText}>{ENTITY_LABELS[entry.entityType] || entry.entityType}</Text>
                        </View>
                      </View>
                      <Text style={styles.entryTitle} numberOfLines={1}>
                        {entry.entityTitle || entry.entityId}
                      </Text>
                      <View style={styles.entryMeta}>
                        <Clock size={10} color={Colors.textTertiary} />
                        <Text style={styles.entryDate}>{formatDate(entry.timestamp)}</Text>
                        <Text style={styles.entryUser}>by {entry.userRole || 'unknown'}</Text>
                      </View>
                    </View>
                    {isExpanded ? (
                      <ChevronUp size={16} color={Colors.textTertiary} />
                    ) : (
                      <ChevronDown size={16} color={Colors.textTertiary} />
                    )}
                  </View>

                  {isExpanded && (
                    <View style={styles.entryDetails}>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Entity ID</Text>
                        <Text style={styles.detailValue} numberOfLines={1}>{entry.entityId}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>User ID</Text>
                        <Text style={styles.detailValue} numberOfLines={1}>{entry.userId || 'N/A'}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Source</Text>
                        <Text style={styles.detailValue}>{entry.source}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>UTC Timestamp</Text>
                        <Text style={styles.detailValue}>{formatUtcOnly(entry.timestamp)}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Local Time</Text>
                        <Text style={styles.detailValue}>{formatDate(entry.timestamp)}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Time Zone</Text>
                        <Text style={styles.detailValue}>{userTimezone}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Offset</Text>
                        <Text style={styles.detailValue}>{getEntryOffset(entry.timestamp)}</Text>
                      </View>
                      <View style={styles.detailRow}>
                        <Text style={styles.detailLabel}>Device</Text>
                        <Text style={styles.detailValue}>{device || 'unknown'}</Text>
                      </View>
                      {entry.details && (
                        <View style={styles.detailRow}>
                          <Text style={styles.detailLabel}>Details</Text>
                          <Text style={styles.detailValue} numberOfLines={5}>
                            {JSON.stringify(entry.details, null, 2)}
                          </Text>
                        </View>
                      )}
                      {entry.snapshotBefore && (
                        <View style={styles.snapshotBox}>
                          <Text style={styles.snapshotLabel}>Snapshot Before Delete</Text>
                          <Text style={styles.snapshotText} numberOfLines={8}>
                            {JSON.stringify(entry.snapshotBefore, null, 2).substring(0, 500)}
                          </Text>
                        </View>
                      )}
                    </View>
                  )}
                </TouchableOpacity>
              );
            })
          )}

          <View style={{ height: 100 }} />
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
    justifyContent: 'space-between',
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8},
  headerTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700' as const},
  headerRight: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: Colors.primary + '15',
    alignItems: 'center',
    justifyContent: 'center'},
  headerCount: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '800' as const},
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 14,
    gap: 8},
  statCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 12,
    padding: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  statValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '800' as const},
  statLabel: {
    color: Colors.textTertiary,
    fontSize: 9,
    fontWeight: '600' as const,
    marginTop: 2,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 14,
    paddingHorizontal: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  searchInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    paddingVertical: 12},
  filtersRow: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 8},
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  filterChipActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary},
  filterChipText: {
    color: Colors.textSecondary,
    fontSize: 12,
    fontWeight: '600' as const},
  filterChipTextActive: {
    color: Colors.primary},
  scrollView: {
    flex: 1},
  centerWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    gap: 12},
  centerText: {
    color: Colors.textSecondary,
    fontSize: 14},
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700' as const,
    marginTop: 8},
  emptySubtitle: {
    color: Colors.textSecondary,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 40},
  entryCard: {
    backgroundColor: Colors.surface,
    borderRadius: 14,
    marginHorizontal: 16,
    marginBottom: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    borderLeftWidth: 3},
  entryHeader: {
    flexDirection: 'row',
    alignItems: 'center'},
  entryIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10},
  entryInfo: {
    flex: 1},
  entryTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 3},
  actionBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6},
  actionBadgeText: {
    fontSize: 9,
    fontWeight: '700' as const},
  entityBadge: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: Colors.backgroundSecondary},
  entityBadgeText: {
    fontSize: 9,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  entryTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600' as const},
  entryMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3},
  entryDate: {
    color: Colors.textTertiary,
    fontSize: 10},
  entryUser: {
    color: Colors.textTertiary,
    fontSize: 10,
    marginLeft: 4},
  entryDetails: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  detailRow: {
    flexDirection: 'row',
    marginBottom: 6},
  detailLabel: {
    color: Colors.textTertiary,
    fontSize: 11,
    fontWeight: '600' as const,
    width: 100},
  detailValue: {
    color: Colors.text,
    fontSize: 11,
    flex: 1},
  snapshotBox: {
    backgroundColor: Colors.backgroundSecondary,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#FF4D4D30'},
  snapshotLabel: {
    color: '#FF4D4D',
    fontSize: 10,
    fontWeight: '700' as const,
    marginBottom: 6,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  snapshotText: {
    color: Colors.textSecondary,
    fontSize: 10,
    fontFamily: 'monospace' as const,
    lineHeight: 15}});
