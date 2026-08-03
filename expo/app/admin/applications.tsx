import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  FlatList,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
  RefreshControl,
  ListRenderItem} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Search,
  CheckCircle,
  Clock,
  XCircle,
  ArrowLeft,
  FileText,
  Briefcase,
  Building2,
  Megaphone,
  Filter} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { fetchAdminMemberRegistry } from '@/lib/member-registry';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type FilterType = 'all' | 'broker' | 'agent' | 'influencer';
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

interface ApplicationItem {
  id: string;
  type: 'broker' | 'agent' | 'influencer';
  fullName: string;
  email: string;
  phone: string;
  city: string;
  state: string;
  country: string;
  details: string;
  status: string;
  createdAt: string;
  reviewedAt?: string;
}

export default function ApplicationsScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const statsQuery = useQuery<{ totalApplications: number; pendingApplications: number; brokerApplications: number; brokerPending: number; agentApplications: number; agentPending: number; influencerApplications: number; influencerPending: number; totalMembers: number } | null>({
    queryKey: ['applications.getStats'],
    queryFn: async () => {
      console.log('[Supabase] Fetching application stats');
      const [appsResult, registryMembers] = await Promise.all([
        supabase.from('applications').select('*').limit(200),
        fetchAdminMemberRegistry().catch(() => []),
      ]);
      if (appsResult.error) { console.log('[Supabase] applications stats error:', appsResult.error.message); return null; }
      const apps = appsResult.data ?? [];
      return {
        totalApplications: apps.length,
        pendingApplications: apps.filter((a: any) => a.status === 'pending').length,
        brokerApplications: apps.filter((a: any) => a.type === 'broker').length,
        brokerPending: apps.filter((a: any) => a.type === 'broker' && a.status === 'pending').length,
        agentApplications: apps.filter((a: any) => a.type === 'agent').length,
        agentPending: apps.filter((a: any) => a.type === 'agent' && a.status === 'pending').length,
        influencerApplications: apps.filter((a: any) => a.type === 'influencer').length,
        influencerPending: apps.filter((a: any) => a.type === 'influencer' && a.status === 'pending').length,
        totalMembers: registryMembers.length};
    },
    staleTime: 30000});

  const applicationsQuery = useQuery({
    queryKey: ['applications.listAll', { page: 1, limit: 100, type: typeFilter, status: statusFilter }],
    queryFn: async () => {
      console.log('[Supabase] Fetching applications list');
      let query = supabase.from('applications').select('*').limit(100);
      if (typeFilter !== 'all') query = query.eq('type', typeFilter);
      if (statusFilter !== 'all') query = query.eq('status', statusFilter);
      const { data, error } = await query;
      if (error) { console.log('[Supabase] applications list error:', error.message); return null; }
      return { applications: data ?? [] };
    },
    staleTime: 3000});

  const reviewMutation = useMutation({
    mutationFn: async (input: { id: string; type: string; decision: string }) => {
      console.log('[Supabase] Reviewing application:', input.id, input.decision);
      const { data, error } = await supabase.from('applications').update({ status: input.decision, reviewed_at: new Date().toISOString() }).eq('id', input.id).select().single();
      if (error) return { success: false, message: error.message };
      return { success: true, ...data };
    },
    onSuccess: () => {
      void applicationsQuery.refetch();
      void statsQuery.refetch();
    }});

  const applications = useMemo(() => {
    const items = applicationsQuery.data?.applications ?? [];
    if (!searchQuery) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (a) =>
        a.fullName.toLowerCase().includes(q) ||
        a.email.toLowerCase().includes(q) ||
        a.phone.includes(q)
    );
  }, [applicationsQuery.data?.applications, searchQuery]);

  const getTypeIcon = useCallback((type: string) => {
    switch (type) {
      case 'broker':
        return <Briefcase size={16} color="#FFD700" />;
      case 'agent':
        return <Building2 size={16} color="#4A90D9" />;
      case 'influencer':
        return <Megaphone size={16} color="#FF6B6B" />;
      default:
        return <FileText size={16} color={Colors.textSecondary} />;
    }
  }, []);

  const getTypeColor = useCallback((type: string) => {
    switch (type) {
      case 'broker': return '#FFD700';
      case 'agent': return '#4A90D9';
      case 'influencer': return '#FF6B6B';
      default: return Colors.textSecondary;
    }
  }, []);

  const getStatusIcon = useCallback((status: string) => {
    switch (status) {
      case 'approved':
        return <CheckCircle size={14} color={Colors.positive} />;
      case 'pending':
        return <Clock size={14} color={Colors.warning} />;
      case 'rejected':
        return <XCircle size={14} color={Colors.negative} />;
      default:
        return <Clock size={14} color={Colors.textSecondary} />;
    }
  }, []);

  const getStatusColor = useCallback((status: string) => {
    switch (status) {
      case 'approved': return Colors.positive;
      case 'pending': return Colors.warning;
      case 'rejected': return Colors.negative;
      default: return Colors.textSecondary;
    }
  }, []);

  const formatDate = useCallback((dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'});
  }, []);

  const handleReview = useCallback((app: ApplicationItem, decision: 'approved' | 'rejected') => {
    const actionText = decision === 'approved' ? 'approve' : 'reject';
    Alert.alert(
      `${decision === 'approved' ? 'Approve' : 'Reject'} Application`,
      `Are you sure you want to ${actionText} ${app.fullName}'s ${app.type} application?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Confirm',
          style: decision === 'rejected' ? 'destructive' : 'default',
          onPress: () => {
            reviewMutation.mutate({
              id: app.id,
              type: app.type,
              decision});
          }},
      ]
    );
  }, [reviewMutation]);

  const stats = statsQuery.data;

  const keyExtractor = useCallback((item: ApplicationItem) => item.id, []);

  const renderApplication: ListRenderItem<ApplicationItem> = useCallback(({ item: app }) => (
    <View style={styles.appCard}>
      <View style={styles.appHeader}>
        <View style={[styles.typeBadge, { backgroundColor: getTypeColor(app.type) + '18' }]}>
          {getTypeIcon(app.type)}
          <Text style={[styles.typeText, { color: getTypeColor(app.type) }]}>
            {app.type.toUpperCase()}
          </Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: getStatusColor(app.status) + '18' }]}>
          {getStatusIcon(app.status)}
          <Text style={[styles.statusText, { color: getStatusColor(app.status) }]}>
            {app.status}
          </Text>
        </View>
      </View>

      <View style={styles.appBody}>
        <Text style={styles.appName}>{app.fullName}</Text>
        <Text style={styles.appEmail}>{app.email}</Text>
        {app.phone ? <Text style={styles.appPhone}>{app.phone}</Text> : null}
        {app.city || app.state ? (
          <Text style={styles.appLocation}>
            {[app.city, app.state, app.country].filter(Boolean).join(', ')}
          </Text>
        ) : null}
      </View>

      {app.details ? (
        <View style={styles.detailsBox}>
          <Text style={styles.detailsText} numberOfLines={2}>{app.details}</Text>
        </View>
      ) : null}

      <View style={styles.appFooter}>
        <Text style={styles.dateText}>Applied {formatDate(app.createdAt)}</Text>
        {app.reviewedAt ? (
          <Text style={styles.dateText}>Reviewed {formatDate(app.reviewedAt)}</Text>
        ) : null}
      </View>

      {app.status === 'pending' && (
        <View style={styles.actionRow}>
          <TouchableOpacity
            style={[styles.actionBtn, styles.approveBtn]}
            onPress={() => handleReview(app, 'approved')}
            disabled={reviewMutation.isPending}
          >
            <CheckCircle size={14} color={Colors.positive} />
            <Text style={[styles.actionBtnText, { color: Colors.positive }]}>Approve</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.rejectBtn]}
            onPress={() => handleReview(app, 'rejected')}
            disabled={reviewMutation.isPending}
          >
            <XCircle size={14} color={Colors.negative} />
            <Text style={[styles.actionBtnText, { color: Colors.negative }]}>Reject</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  ), [formatDate, getTypeColor, getTypeIcon, getStatusColor, getStatusIcon, handleReview, reviewMutation.isPending]);

  const handleRefresh = useCallback(() => {
    void applicationsQuery.refetch();
    void statsQuery.refetch();
  }, [applicationsQuery, statsQuery]);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerText}>
          <Text style={styles.title}>Applications</Text>
          <Text style={styles.subtitle}>
            {stats ? `${stats.totalApplications} total · ${stats.pendingApplications} pending` : 'Loading...'}
          </Text>
        </View>
      </View>

      {stats && (
        <View style={styles.statsRow}>
          <View style={[styles.statCard, { borderLeftColor: '#FFD700' }]}>
            <Text style={styles.statNumber}>{stats.brokerApplications}</Text>
            <Text style={styles.statLabel}>Brokers</Text>
            {stats.brokerPending > 0 && (
              <View style={styles.pendingDot}>
                <Text style={styles.pendingDotText}>{stats.brokerPending}</Text>
              </View>
            )}
          </View>
          <View style={[styles.statCard, { borderLeftColor: '#4A90D9' }]}>
            <Text style={styles.statNumber}>{stats.agentApplications}</Text>
            <Text style={styles.statLabel}>Agents</Text>
            {stats.agentPending > 0 && (
              <View style={styles.pendingDot}>
                <Text style={styles.pendingDotText}>{stats.agentPending}</Text>
              </View>
            )}
          </View>
          <View style={[styles.statCard, { borderLeftColor: '#FF6B6B' }]}>
            <Text style={styles.statNumber}>{stats.influencerApplications}</Text>
            <Text style={styles.statLabel}>Influencers</Text>
            {stats.influencerPending > 0 && (
              <View style={styles.pendingDot}>
                <Text style={styles.pendingDotText}>{stats.influencerPending}</Text>
              </View>
            )}
          </View>
          <View style={[styles.statCard, { borderLeftColor: Colors.positive }]}>
            <Text style={styles.statNumber}>{stats.totalMembers}</Text>
            <Text style={styles.statLabel}>Members</Text>
          </View>
        </View>
      )}

      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Search size={18} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search applications..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow}
        contentContainerStyle={styles.filterContent}
      >
        {([
          { key: 'all', label: 'All Types', icon: <Filter size={13} color={typeFilter === 'all' ? Colors.black : Colors.textSecondary} /> },
          { key: 'broker', label: 'Brokers', icon: <Briefcase size={13} color={typeFilter === 'broker' ? Colors.black : '#FFD700'} /> },
          { key: 'agent', label: 'Agents', icon: <Building2 size={13} color={typeFilter === 'agent' ? Colors.black : '#4A90D9'} /> },
          { key: 'influencer', label: 'Influencers', icon: <Megaphone size={13} color={typeFilter === 'influencer' ? Colors.black : '#FF6B6B'} /> },
        ] as const).map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, typeFilter === f.key && styles.filterChipActive]}
            onPress={() => setTypeFilter(f.key)}
          >
            {f.icon}
            <Text style={[styles.filterChipText, typeFilter === f.key && styles.filterChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterRow2}
        contentContainerStyle={styles.filterContent}
      >
        {([
          { key: 'all', label: 'All Status' },
          { key: 'pending', label: 'Pending' },
          { key: 'approved', label: 'Approved' },
          { key: 'rejected', label: 'Rejected' },
        ] as const).map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.statusChip, statusFilter === f.key && styles.statusChipActive]}
            onPress={() => setStatusFilter(f.key)}
          >
            <Text style={[styles.statusChipText, statusFilter === f.key && styles.statusChipTextActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {applicationsQuery.isLoading ? (
        <View style={styles.loadingContainer}>
          <ShimmerIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>Loading applications...</Text>
        </View>
      ) : applications.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconWrap}>
            <FileText size={48} color={Colors.textTertiary} />
          </View>
          <Text style={styles.emptyTitle}>
            {searchQuery ? 'No applications found' : 'No applications yet'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {searchQuery
              ? 'Try a different search term'
              : 'New broker, agent, and influencer applications will appear here'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={applications}
          keyExtractor={keyExtractor}
          renderItem={renderApplication}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={applicationsQuery.isRefetching}
              onRefresh={handleRefresh}
              tintColor={Colors.primary}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 20,
    paddingVertical: 14,
    gap: 12},
  backBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: Colors.card,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: Colors.border},
  headerText: {
    flex: 1},
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: Colors.text},
  subtitle: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginTop: 2},
  statsRow: {
    flexDirection: 'row' as const,
    paddingHorizontal: 20,
    gap: 8,
    marginBottom: 14},
  statCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    borderLeftWidth: 3,
    position: 'relative' as const},
  statNumber: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text},
  statLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 2,
    fontWeight: '600' as const},
  pendingDot: {
    position: 'absolute' as const,
    top: 6,
    right: 6,
    backgroundColor: Colors.warning,
    borderRadius: 8,
    minWidth: 16,
    height: 16,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: 4},
  pendingDotText: {
    fontSize: 9,
    fontWeight: '700' as const,
    color: Colors.black},
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 10},
  searchBox: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border},
  searchInput: {
    flex: 1,
    paddingVertical: 11,
    paddingHorizontal: 10,
    fontSize: 14,
    color: Colors.text},
  filterRow: {
    maxHeight: 40,
    marginBottom: 6},
  filterRow2: {
    maxHeight: 36,
    marginBottom: 10},
  filterContent: {
    paddingHorizontal: 20,
    gap: 8},
  filterChip: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 6},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    fontSize: 12,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  filterChipTextActive: {
    color: Colors.black},
  statusChip: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 14,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  statusChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  statusChipText: {
    fontSize: 11,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  statusChipTextActive: {
    color: Colors.black},
  list: {
    flex: 1,
    paddingHorizontal: 20},
  listContent: {
    paddingBottom: 100},
  appCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.border},
  appHeader: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    marginBottom: 12},
  typeBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 5},
  typeText: {
    fontSize: 10,
    fontWeight: '700' as const,
    letterSpacing: 0.5},
  statusBadge: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    gap: 4},
  statusText: {
    fontSize: 11,
    fontWeight: '600' as const,
    textTransform: 'capitalize' as const},
  appBody: {
    marginBottom: 10},
  appName: {
    fontSize: 16,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 3},
  appEmail: {
    fontSize: 13,
    color: Colors.textSecondary},
  appPhone: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  appLocation: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  detailsBox: {
    backgroundColor: Colors.background,
    borderRadius: 10,
    padding: 10,
    marginBottom: 10},
  detailsText: {
    fontSize: 12,
    color: Colors.textSecondary,
    lineHeight: 17},
  appFooter: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  dateText: {
    fontSize: 11,
    color: Colors.textTertiary},
  actionRow: {
    flexDirection: 'row' as const,
    gap: 10,
    marginTop: 12},
  actionBtn: {
    flex: 1,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6},
  approveBtn: {
    backgroundColor: Colors.positive + '15'},
  rejectBtn: {
    backgroundColor: Colors.negative + '15'},
  actionBtnText: {
    fontSize: 13,
    fontWeight: '600' as const},
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
    paddingHorizontal: 40},
  emptyIconWrap: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: Colors.card,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: Colors.border},
  emptyTitle: {
    fontSize: 18,
    fontWeight: '600' as const,
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center' as const},
  emptySubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    textAlign: 'center' as const,
    lineHeight: 20}});
