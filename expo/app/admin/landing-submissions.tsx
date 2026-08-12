import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  ArrowLeft,
  Inbox,
  DollarSign,
  UserPlus,
  CheckCircle,
  XCircle,
  Clock,
  Mail,
  Phone} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import {
  fetchLandingSubmissions,
  updateSubmissionStatus,
  type LandingSubmission} from '@/lib/landing-submissions';
import { formatCurrencyWithDecimals } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type FilterType = 'all' | 'pending' | 'approved' | 'rejected';

export default function LandingSubmissionsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>('all');

  const submissionsQuery = useQuery({
    queryKey: ['landing-submissions'],
    queryFn: () => fetchLandingSubmissions(0, 500),
    staleTime: 10000});

  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);

  const statusMutation = useMutation({
    mutationFn: async (params: { id: string; status: string }) => {
      return updateSubmissionStatus(params.id, params.status, 'admin');
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['landing-submissions'] });
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message);
    }});

  const submissions = useMemo(() => {
    const all = submissionsQuery.data ?? [];
    if (filter === 'all') return all;
    return all.filter(s => (s.status || 'pending') === filter);
  }, [submissionsQuery.data, filter]);

  const stats = useMemo(() => {
    const all = submissionsQuery.data ?? [];
    return {
      total: all.length,
      pending: all.filter(s => (s.status || 'pending') === 'pending').length,
      investments: all.filter(s => s.type === 'investment').length,
      registrations: all.filter(s => s.type === 'registration').length,
      totalAmount: all
        .filter(s => s.type === 'investment' && s.status !== 'rejected')
        .reduce((sum, s) => sum + (s.investment_amount ?? 0), 0)};
  }, [submissionsQuery.data]);

  const handleAction = useCallback((submission: LandingSubmission, action: 'approve' | 'reject') => {
    const name = submission.full_name || submission.email || 'this submission';
    Alert.alert(
      `${action === 'approve' ? 'Approve' : 'Reject'} Submission`,
      `Are you sure you want to ${action} ${name}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: action === 'approve' ? 'Approve' : 'Reject',
          style: action === 'reject' ? 'destructive' : 'default',
          onPress: () => {
            if (submission.id) {
              statusMutation.mutate({ id: submission.id, status: action === 'approve' ? 'approved' : 'rejected' });
            }
          }},
      ]
    );
  }, [statusMutation]);

  const onRefresh = useCallback(() => {
    void submissionsQuery.refetch();
  }, [submissionsQuery]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Unknown';
    try {
      return new Date(dateString).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'});
    } catch {
      return dateString;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'approved': return Colors.positive;
      case 'rejected': return Colors.negative;
      case 'pending': return Colors.warning;
      default: return Colors.textSecondary;
    }
  };

  const FILTERS: { id: FilterType; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'pending', label: 'Pending' },
    { id: 'approved', label: 'Approved' },
    { id: 'rejected', label: 'Rejected' },
  ];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Landing Submissions</Text>
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={submissionsQuery.isFetching}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Inbox size={16} color={Colors.primary} />
            <Text style={styles.statValue}>{stats.total}</Text>
            <Text style={styles.statLabel}>Total</Text>
          </View>
          <View style={styles.statBox}>
            <Clock size={16} color={Colors.warning} />
            <Text style={styles.statValue}>{stats.pending}</Text>
            <Text style={styles.statLabel}>Pending</Text>
          </View>
          <View style={styles.statBox}>
            <DollarSign size={16} color={Colors.positive} />
            <Text style={styles.statValue}>{formatCurrencyWithDecimals(stats.totalAmount)}</Text>
            <Text style={styles.statLabel}>Pipeline</Text>
          </View>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.id}
              style={[styles.filterBtn, filter === f.id && styles.filterBtnActive]}
              onPress={() => setFilter(f.id)}
            >
              <Text style={[styles.filterText, filter === f.id && styles.filterTextActive]}>
                {f.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {submissionsQuery.isLoading ? (
          <View style={styles.loadingWrap}>
            <ShimmerIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingText}>Loading submissions...</Text>
          </View>
        ) : submissions.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Inbox size={40} color={Colors.textTertiary} />
            <Text style={styles.emptyTitle}>No Submissions</Text>
            <Text style={styles.emptySubtext}>
              {filter === 'all'
                ? 'Landing page submissions will appear here when investors submit through ivxholding.com'
                : `No ${filter} submissions found`}
            </Text>
          </View>
        ) : (
          submissions.map((sub) => {
            const status = sub.status || 'pending';
            const isInvestment = sub.type === 'investment';
            return (
              <View key={sub.id || sub.submitted_at} style={styles.card}>
                <View style={styles.cardHeader}>
                  <View style={styles.cardTypeWrap}>
                    {isInvestment ? (
                      <DollarSign size={16} color={Colors.primary} />
                    ) : (
                      <UserPlus size={16} color={Colors.info} />
                    )}
                    <Text style={styles.cardType}>
                      {isInvestment ? 'Investment' : 'Registration'}
                    </Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: getStatusColor(status) + '20' }]}>
                    <Text style={[styles.statusText, { color: getStatusColor(status) }]}>
                      {status}
                    </Text>
                  </View>
                </View>

                <Text style={styles.cardName}>{sub.full_name || 'Unknown'}</Text>

                <View style={styles.cardInfo}>
                  <Mail size={12} color={Colors.textTertiary} />
                  <Text style={styles.cardInfoText}>{sub.email || 'No email'}</Text>
                </View>

                {sub.phone ? (
                  <View style={styles.cardInfo}>
                    <Phone size={12} color={Colors.textTertiary} />
                    <Text style={styles.cardInfoText}>{sub.phone}</Text>
                  </View>
                ) : null}

                {isInvestment && (
                  <>
                    <View style={styles.investDetails}>
                      <View style={styles.investRow}>
                        <Text style={styles.investLabel}>Deal</Text>
                        <Text style={styles.investValue} numberOfLines={1}>
                          {sub.deal_name || sub.deal_id || 'Unknown'}
                        </Text>
                      </View>
                      <View style={styles.investRow}>
                        <Text style={styles.investLabel}>Amount</Text>
                        <Text style={[styles.investValue, { color: Colors.primary, fontWeight: '800' as const }]}>
                          {formatCurrencyWithDecimals(sub.investment_amount ?? 0)}
                        </Text>
                      </View>
                      <View style={styles.investRow}>
                        <Text style={styles.investLabel}>Ownership</Text>
                        <Text style={styles.investValue}>
                          {(sub.ownership_percent ?? 0).toFixed(2)}%
                        </Text>
                      </View>
                      <View style={styles.investRow}>
                        <Text style={styles.investLabel}>Expected ROI</Text>
                        <Text style={[styles.investValue, { color: Colors.positive }]}>
                          {sub.expected_roi ?? 0}%
                        </Text>
                      </View>
                    </View>
                  </>
                )}

                <Text style={styles.cardDate}>{formatDate(sub.submitted_at)}</Text>

                {status === 'pending' && (
                  <View style={styles.cardActions}>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.approveBtn]}
                      onPress={() => handleAction(sub, 'approve')}
                    >
                      <CheckCircle size={14} color={Colors.positive} />
                      <Text style={[styles.actionBtnText, { color: Colors.positive }]}>Approve</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.rejectBtn]}
                      onPress={() => handleAction(sub, 'reject')}
                    >
                      <XCircle size={14} color={Colors.negative} />
                      <Text style={[styles.actionBtnText, { color: Colors.negative }]}>Reject</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            );
          })
        )}

        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 12},
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center'},
  title: {
    fontSize: 18,
    fontWeight: '800' as const,
    color: Colors.text,
    letterSpacing: -0.3},
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 10},
  statBox: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: 14,
    padding: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
    gap: 4},
  statValue: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: Colors.text},
  statLabel: {
    fontSize: 10,
    fontWeight: '600' as const,
    color: Colors.textTertiary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  filterRow: {
    paddingHorizontal: 16,
    paddingVertical: 12},
  filterBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: Colors.surface,
    marginRight: 8,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  filterBtnActive: {
    backgroundColor: Colors.primary + '20',
    borderColor: Colors.primary + '40'},
  filterText: {
    fontSize: 13,
    fontWeight: '600' as const,
    color: Colors.textSecondary},
  filterTextActive: {
    color: Colors.primary},
  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 60,
    gap: 12},
  loadingText: {
    fontSize: 14,
    color: Colors.textTertiary},
  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 60,
    paddingHorizontal: 32,
    gap: 8},
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700' as const,
    color: Colors.text,
    marginTop: 8},
  emptySubtext: {
    fontSize: 13,
    color: Colors.textTertiary,
    textAlign: 'center' as const,
    lineHeight: 19},
  card: {
    marginHorizontal: 16,
    marginBottom: 12,
    backgroundColor: Colors.surface,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder},
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10},
  cardTypeWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6},
  cardType: {
    fontSize: 12,
    fontWeight: '700' as const,
    color: Colors.textSecondary,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.5},
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8},
  statusText: {
    fontSize: 11,
    fontWeight: '700' as const,
    textTransform: 'capitalize' as const},
  cardName: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: Colors.text,
    marginBottom: 6},
  cardInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4},
  cardInfoText: {
    fontSize: 13,
    color: Colors.textSecondary},
  investDetails: {
    marginTop: 10,
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 12,
    gap: 6},
  investRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'},
  investLabel: {
    fontSize: 12,
    color: Colors.textTertiary,
    fontWeight: '600' as const},
  investValue: {
    fontSize: 13,
    color: Colors.text,
    fontWeight: '600' as const,
    maxWidth: '60%',
    textAlign: 'right' as const},
  cardDate: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 10},
  cardActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder},
  actionBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    borderRadius: 10,
    gap: 6},
  approveBtn: {
    backgroundColor: Colors.positive + '15'},
  rejectBtn: {
    backgroundColor: Colors.negative + '15'},
  actionBtnText: {
    fontSize: 13,
    fontWeight: '700' as const}});
