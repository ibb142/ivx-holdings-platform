import React, { useState, useMemo, useCallback } from 'react';
import {View,
  Text,
  StyleSheet,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  useWindowDimensions,
  RefreshControl} from "react-native";
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Search,
  ArrowUpRight,
  ArrowDownRight,
  DollarSign,
  Building2,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery } from '@tanstack/react-query';
import { useRealtimeTable } from '@/hooks/useRealtimeChannel';
import { supabase } from '@/lib/supabase';
import { AdminTransaction } from '@/types';
import { formatCurrencyWithDecimals } from '@/lib/formatters';
import { ShimmerIndicator } from '@/components/ShimmerIndicator';

type FilterType = 'all' | 'deposit' | 'withdrawal' | 'buy' | 'sell' | 'dividend';
type StatusFilter = 'all' | 'completed' | 'pending' | 'failed';

export default function TransactionsScreen() {
  // Realtime: invalidate on DB changes
  useRealtimeTable('notifications', [['notifications']]);
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isSmall = width < 375;
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [refreshing, setRefreshing] = useState(false);
  const [displayCount, setDisplayCount] = useState(20);

  const txQuery = useQuery({
    queryKey: ['admin-transactions'],
    queryFn: async () => {
      console.log('[Admin Transactions] Fetching from Supabase...');
      const [txResult, landingResult] = await Promise.all([
        supabase
          .from('transactions')
          .select('*', { count: 'exact' })
          .order('created_at', { ascending: false })
          .limit(200),
        supabase
          .from('landing_investments')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(200),
      ]);

      const txData = txResult.error ? [] : (txResult.data ?? []);
      if (txResult.error) {
        console.log('[Admin Transactions] transactions table error:', txResult.error.message);
      } else {
        console.log('[Admin Transactions] Fetched', txData.length, 'from transactions table');
      }

      const landingData = landingResult.error ? [] : (landingResult.data ?? []);
      if (landingResult.error) {
        const msg = (landingResult.error.message || '').toLowerCase();
        if (!msg.includes('does not exist') && !msg.includes('schema cache')) {
          console.log('[Admin Transactions] landing_investments error:', landingResult.error.message);
        }
      } else {
        console.log('[Admin Transactions] Fetched', landingData.length, 'from landing_investments');
      }

      const landingTxIds = new Set<string>();
      const landingAsTx = (landingData as Record<string, unknown>[]).map((row) => {
        const intentId = typeof row.intent_id === 'string' ? row.intent_id : '';
        const rowId = typeof row.id === 'string' ? row.id : '';
        const id = intentId || rowId || `li_${Math.random().toString(36).substring(2, 8)}`;
        landingTxIds.add(id);
        const dealTitle = typeof row.deal_title === 'string' ? row.deal_title : '';
        const investType = typeof row.investment_type === 'string' ? row.investment_type : 'JV Direct';
        const investorEmail = typeof row.investor_email === 'string' ? row.investor_email : '';
        const investorId = typeof row.investor_id === 'string' ? row.investor_id : '';
        const createdAt = typeof row.created_at === 'string' ? row.created_at : new Date().toISOString();
        return {
          id,
          type: 'buy',
          amount: Number(row.amount) || 0,
          status: row.status === 'confirmed' ? 'completed' : row.status === 'cancelled' ? 'failed' : 'pending',
          user_id: investorId,
          user_name: dealTitle || 'Landing Investment',
          user_email: investorEmail,
          description: `${investType} — ${dealTitle || 'Deal'} (Landing)`,
          property_name: dealTitle,
          created_at: createdAt,
          source: 'landing'};
      });

      const normalizeStatus = (raw: unknown) => {
        const s = String(raw || '').toLowerCase();
        if (s === 'completed' || s === 'confirmed' || s === 'success' || s === 'succeeded') return 'completed';
        if (s === 'failed' || s === 'cancelled' || s === 'rejected') return 'failed';
        return 'pending';
      };

      const appTx = txData.map((row: Record<string, unknown>) => ({
        ...row,
        source: 'app',
        status: normalizeStatus(row.status)}));

      const combined = [
        ...appTx,
        ...landingAsTx.filter((lt) => !appTx.some((t: Record<string, unknown>) => String(t.id) === lt.id)),
      ];

      console.log('[Admin Transactions] Combined:', combined.length, 'total (', txData.length, 'app +', landingAsTx.length, 'landing)');
      return { transactions: combined, count: combined.length };
    },
    staleTime: 1000 * 30,
    retry: 1});

  const allTransactions: AdminTransaction[] = useMemo(() => {
    if (!txQuery.data?.transactions) return [];
    return txQuery.data.transactions.map((row: any) => ({
      id: row?.id || `tx_${Math.random().toString(36).substring(2, 8)}`,
      type: (row?.type || 'buy') as AdminTransaction['type'],
      amount: Number(row?.amount) || 0,
      status: (row?.status || 'completed') as AdminTransaction['status'],
      userId: row?.user_id || '',
      userName: row?.user_name || row?.property_name || 'User',
      userEmail: row?.user_email || '',
      description: row?.description || '',
      propertyName: row?.property_name || '',
      createdAt: row?.created_at || new Date().toISOString()}));
  }, [txQuery.data]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void txQuery.refetch().finally(() => setRefreshing(false));
  }, [txQuery]);

  const filteredTransactions = useMemo(() => {
    const source: AdminTransaction[] = allTransactions;
    let result = source;

    if (typeFilter !== 'all') {
      result = result.filter((tx) => tx.type === typeFilter);
    }

    if (statusFilter !== 'all') {
      result = result.filter((tx) => tx.status === statusFilter);
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(
        (tx) =>
          tx.userName.toLowerCase().includes(query) ||
          tx.userEmail.toLowerCase().includes(query) ||
          tx.description.toLowerCase().includes(query) ||
          (tx.propertyName && tx.propertyName.toLowerCase().includes(query))
      );
    }

    return result.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }, [typeFilter, statusFilter, searchQuery, allTransactions]);

  const formatCurrency = (amount: number) => formatCurrencyWithDecimals(Math.abs(amount));

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'});
  };

  const getTypeIcon = (type: AdminTransaction['type']) => {
    switch (type) {
      case 'deposit':
        return <ArrowDownRight size={18} color={Colors.positive} />;
      case 'withdrawal':
        return <ArrowUpRight size={18} color={Colors.negative} />;
      case 'buy':
        return <Building2 size={18} color={Colors.primary} />;
      case 'sell':
        return <Building2 size={18} color={Colors.accent} />;
      case 'dividend':
        return <DollarSign size={18} color={Colors.positive} />;
      default:
        return <DollarSign size={18} color={Colors.textSecondary} />;
    }
  };

  const getTypeColor = (type: AdminTransaction['type']) => {
    switch (type) {
      case 'deposit':
      case 'dividend':
        return Colors.positive;
      case 'withdrawal':
        return Colors.negative;
      case 'buy':
        return Colors.primary;
      case 'sell':
        return Colors.accent;
      default:
        return Colors.textSecondary;
    }
  };

  const getStatusStyle = (status: AdminTransaction['status']) => {
    switch (status) {
      case 'completed':
        return { bg: Colors.positive + '20', color: Colors.positive };
      case 'pending':
        return { bg: Colors.warning + '20', color: Colors.warning };
      case 'failed':
        return { bg: Colors.negative + '20', color: Colors.negative };
    }
  };

  const totalVolume = filteredTransactions.reduce(
    (sum, tx) => sum + Math.abs(tx.amount),
    0
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.headerTop}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <ArrowLeft size={22} color={Colors.text} />
          </TouchableOpacity>
          <Text style={[styles.title, isSmall && styles.titleSmall]}>Transactions</Text>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Total Volume</Text>
            <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>{formatCurrency(totalVolume)}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Count</Text>
            <Text style={styles.statValue}>{filteredTransactions.length}</Text>
          </View>
          <View style={styles.statBox}>
            <Text style={styles.statLabel}>Source</Text>
            <Text style={[styles.statValue, { color: Colors.positive, fontSize: 11 }]}>LIVE + LANDING</Text>
          </View>
        </View>
      </View>

      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Search size={20} color={Colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search by user, property..."
            placeholderTextColor={Colors.textTertiary}
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {[
          { key: 'all', label: 'All Types' },
          { key: 'deposit', label: 'Deposits' },
          { key: 'withdrawal', label: 'Withdrawals' },
          { key: 'buy', label: 'Buys' },
          { key: 'sell', label: 'Sells' },
          { key: 'dividend', label: 'Dividends' },
        ].map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, typeFilter === f.key && styles.filterChipActive]}
            onPress={() => setTypeFilter(f.key as FilterType)}
          >
            <Text
              style={[
                styles.filterChipText,
                typeFilter === f.key && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {[
          { key: 'all', label: 'All Status' },
          { key: 'completed', label: 'Completed' },
          { key: 'pending', label: 'Pending' },
          { key: 'failed', label: 'Failed' },
        ].map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[
              styles.filterChip,
              statusFilter === f.key && styles.filterChipActive,
            ]}
            onPress={() => setStatusFilter(f.key as StatusFilter)}
          >
            <Text
              style={[
                styles.filterChipText,
                statusFilter === f.key && styles.filterChipTextActive,
              ]}
            >
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <View style={styles.resultsHeader}>
        <Text style={styles.resultsCount}>
          {filteredTransactions.length} transactions
        </Text>
        <Text style={styles.resultsVolume}>
          Volume: {formatCurrency(totalVolume)}
        </Text>
      </View>

      <FlatList
        style={styles.list}
        data={filteredTransactions.slice(0, displayCount)}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.primary} />
        }
        onEndReached={() => {
          if (displayCount < filteredTransactions.length) {
            setDisplayCount(prev => Math.min(prev + 20, filteredTransactions.length));
          }
        }}
        onEndReachedThreshold={0.5}
        ListEmptyComponent={
          txQuery.isLoading ? (
            <View style={{ alignItems: 'center' as const, paddingVertical: 40 }}>
              <ShimmerIndicator size="large" color={Colors.primary} />
              <Text style={{ color: Colors.textSecondary, marginTop: 12, fontSize: 13 }}>Loading transactions...</Text>
            </View>
          ) : (
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Text style={{ color: Colors.textSecondary, fontSize: 14 }}>No transactions found</Text>
            </View>
          )
        }
        ListFooterComponent={
          displayCount < filteredTransactions.length ? (
            <View style={{ paddingVertical: 16, alignItems: 'center' }}>
              <ShimmerIndicator size="small" color={Colors.primary} />
              <Text style={{ color: Colors.textSecondary, marginTop: 8, fontSize: 13 }}>Loading more…</Text>
            </View>
          ) : null
        }
        renderItem={({ item: tx }) => {
          const statusStyle = getStatusStyle(tx.status);
          return (
            <View key={tx.id} style={styles.txCard}>
              <View style={styles.txHeader}>
                <View
                  style={[
                    styles.typeIcon,
                    { backgroundColor: getTypeColor(tx.type) + '15' },
                  ]}
                >
                  {getTypeIcon(tx.type)}
                </View>
                <View style={styles.txInfo}>
                  <View style={styles.txTopRow}>
                    <Text style={styles.txType}>{tx.type.toUpperCase()}</Text>
                    <View
                      style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}
                    >
                      <Text style={[styles.statusText, { color: statusStyle.color }]}>
                        {tx.status}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.txUser}>{tx.userName}</Text>
                  <Text style={styles.txEmail}>{tx.userEmail}</Text>
                </View>
                <View style={styles.txAmount}>
                  <Text
                    style={[
                      styles.amount,
                      tx.amount > 0 ? styles.amountPositive : styles.amountNegative,
                    ]}
                  >
                    {tx.amount > 0 ? '+' : '-'}
                    {formatCurrency(tx.amount)}
                  </Text>
                </View>
              </View>

              <View style={styles.txDetails}>
                <Text style={styles.txDescription}>{tx.description}</Text>
                {tx.propertyName && (
                  <View style={styles.propertyRow}>
                    <Building2 size={12} color={Colors.textTertiary} />
                    <Text style={styles.propertyName}>{tx.propertyName}</Text>
                  </View>
                )}
                <Text style={styles.txDate}>{formatDate(tx.createdAt)}</Text>
              </View>
            </View>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background},
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12},
  headerTop: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 12},
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center' as const, alignItems: 'center' as const, borderWidth: 1, borderColor: Colors.border },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    flex: 1},
  titleSmall: {
    fontSize: 22},
  statsRow: {
    flexDirection: 'row' as const,
    gap: 10},
  statBox: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border},
  statLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginBottom: 4},
  statValue: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text},
  searchContainer: {
    paddingHorizontal: 20,
    marginBottom: 12},
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: Colors.border},
  searchInput: {
    flex: 1,
    paddingVertical: 12,
    paddingHorizontal: 10,
    fontSize: 15,
    color: Colors.text},
  filterContainer: {
    maxHeight: 44,
    marginBottom: 8},
  filterContent: {
    paddingHorizontal: 20,
    gap: 8},
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border},
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary},
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: Colors.textSecondary},
  filterChipTextActive: {
    color: '#fff'},
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12},
  resultsCount: {
    fontSize: 13,
    color: Colors.textSecondary,
    fontWeight: '500'},
  resultsVolume: {
    fontSize: 13,
    color: Colors.primary,
    fontWeight: '600'},
  list: {
    flex: 1,
    paddingHorizontal: 20},
  txCard: {
    backgroundColor: Colors.card,
    borderRadius: 14,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.border},
  txHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start'},
  typeIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12},
  txInfo: {
    flex: 1},
  txTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4},
  txType: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textSecondary,
    letterSpacing: 0.5},
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6},
  statusText: {
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'capitalize'},
  txUser: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.text},
  txEmail: {
    fontSize: 12,
    color: Colors.textTertiary,
    marginTop: 2},
  txAmount: {
    alignItems: 'flex-end'},
  amount: {
    fontSize: 16,
    fontWeight: '700'},
  amountPositive: {
    color: Colors.positive},
  amountNegative: {
    color: Colors.negative},
  txDetails: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.border},
  txDescription: {
    fontSize: 13,
    color: Colors.textSecondary},
  propertyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6},
  propertyName: {
    fontSize: 12,
    color: Colors.textTertiary},
  txDate: {
    fontSize: 11,
    color: Colors.textTertiary,
    marginTop: 8},
  bottomPadding: {
    height: 100}});
