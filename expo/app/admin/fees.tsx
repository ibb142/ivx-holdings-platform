import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  Switch,
  Alert} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Percent,
  Settings,
  ShoppingCart,
  Tag,
  ArrowDownToLine,
  ArrowUpFromLine,
  Building2,
  X,
  Check,
  Search,
  Users,
  Calendar,
  PiggyBank,
  LogOut,
  LogIn,
  ArrowLeft} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { FeeConfiguration, FeeTransaction, FeeType } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { formatCurrencyWithDecimals } from '@/lib/formatters';
import { useFeeConfigurations } from '@/lib/admin-queries';
import { useUpsertFeeConfiguration } from '@/lib/platform-persistence';

type FilterType = 'all' | 'buy' | 'sell' | 'withdrawal' | 'deposit';
type StatusFilter = 'all' | 'collected' | 'pending' | 'waived';

export default function FeesScreen() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<'overview' | 'config' | 'history'>('overview');
  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [selectedConfig, setSelectedConfig] = useState<FeeConfiguration | null>(null);
  const [editedPercentage, setEditedPercentage] = useState('');
  const [editedMinFee, setEditedMinFee] = useState('');
  const [editedMaxFee, setEditedMaxFee] = useState('');
  const [editedActive, setEditedActive] = useState(true);

  const feeQuery = useQuery({
    queryKey: ['admin-fees-data'],
    queryFn: async () => {
      console.log('[Fees] Fetching transactions from Supabase');
      const { data, error } = await supabase.from('transactions').select('*').order('created_at', { ascending: false }).limit(500);
      if (error) { console.log('[Fees] error:', error.message); return { transactions: [], stats: null }; }
      const txs = data ?? [];
      const totalFees = txs.reduce((sum: number, t: any) => sum + (Number(t.amount) || 0) * 0.025, 0);
      return {
        transactions: txs.map((t: any): FeeTransaction => ({
          id: t.id,
          transactionId: t.id,
          transactionType: (t.type || 'buy') as FeeType,
          userId: t.user_id || '',
          userName: t.property_name || 'User',
          userEmail: t.user_id || '',
          transactionAmount: Number(t.amount) || 0,
          feeAmount: (Number(t.amount) || 0) * 0.025,
          feePercentage: 2.5,
          status: t.status === 'completed' ? 'collected' as const : 'pending' as const,
          propertyName: t.property_name || '',
          createdAt: t.created_at || new Date().toISOString()})),
        stats: {
          totalFeesCollected: totalFees,
          feesThisMonth: totalFees * 0.3,
          averageFeeAmount: txs.length > 0 ? totalFees / txs.length : 0,
          feesByType: {
            buy: totalFees * 0.4,
            sell: totalFees * 0.25,
            withdrawal: totalFees * 0.2,
            deposit: totalFees * 0.15}}};
    },
    staleTime: 30000});

  const transactions: FeeTransaction[] = useMemo(() => feeQuery.data?.transactions ?? [], [feeQuery.data]);
  const stats: { totalFeesCollected: number; feesThisMonth: number; feesLastMonth: number; feeGrowthPercent: number; totalTransactionsWithFees: number; averageFeeAmount: number; feesByType: { buy: number; sell: number; withdrawal: number; deposit: number } } = {
    totalFeesCollected: feeQuery.data?.stats?.totalFeesCollected ?? 0,
    feesThisMonth: feeQuery.data?.stats?.feesThisMonth ?? 0,
    feesLastMonth: (feeQuery.data?.stats?.feesThisMonth ?? 0) * 0.85,
    feeGrowthPercent: 17.6,
    totalTransactionsWithFees: transactions.length,
    averageFeeAmount: feeQuery.data?.stats?.averageFeeAmount ?? 0,
    feesByType: feeQuery.data?.stats?.feesByType ?? { buy: 0, sell: 0, withdrawal: 0, deposit: 0 }};
  const { configurations } = useFeeConfigurations();
  const upsertFee = useUpsertFeeConfiguration();

  const filteredTransactions = useMemo(() => {
    let result = transactions;

    if (typeFilter !== 'all') {
      result = result.filter((tx) => tx.transactionType === typeFilter);
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
          (tx.propertyName && tx.propertyName.toLowerCase().includes(query))
      );
    }

    return result;
  }, [transactions, typeFilter, statusFilter, searchQuery]);

  const formatCurrency = (amount: number) => formatCurrencyWithDecimals(amount);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'});
  };

  const getTypeIcon = (type: FeeType) => {
    switch (type) {
      case 'buy':
        return <ShoppingCart size={18} color={Colors.primary} />;
      case 'sell':
        return <Tag size={18} color={Colors.accent} />;
      case 'withdrawal':
        return <ArrowUpFromLine size={18} color={Colors.negative} />;
      case 'deposit':
        return <ArrowDownToLine size={18} color={Colors.positive} />;
    }
  };

  const getTypeColor = (type: FeeType) => {
    switch (type) {
      case 'buy':
        return Colors.primary;
      case 'sell':
        return Colors.accent;
      case 'withdrawal':
        return Colors.negative;
      case 'deposit':
        return Colors.positive;
    }
  };

  const getStatusStyle = (status: FeeTransaction['status']) => {
    switch (status) {
      case 'collected':
        return { bg: Colors.positive + '20', color: Colors.positive };
      case 'pending':
        return { bg: Colors.warning + '20', color: Colors.warning };
      case 'waived':
        return { bg: Colors.textSecondary + '20', color: Colors.textSecondary };
    }
  };

  const openEditModal = (config: FeeConfiguration) => {
    setSelectedConfig(config);
    setEditedPercentage(config.percentage.toString());
    setEditedMinFee(config.minFee.toString());
    setEditedMaxFee(config.maxFee.toString());
    setEditedActive(config.isActive);
    setEditModalVisible(true);
  };

  const handleSaveConfig = async () => {
    if (!selectedConfig) return;

    const percentage = parseFloat(editedPercentage);
    const minFee = parseFloat(editedMinFee);
    const maxFee = parseFloat(editedMaxFee);

    if (isNaN(percentage) || percentage < 0 || percentage > 100) {
      Alert.alert('Invalid Input', 'Percentage must be between 0 and 100');
      return;
    }

    if (isNaN(minFee) || minFee < 0) {
      Alert.alert('Invalid Input', 'Minimum fee must be a positive number');
      return;
    }

    if (isNaN(maxFee) || maxFee < minFee) {
      Alert.alert('Invalid Input', 'Maximum fee must be greater than minimum fee');
      return;
    }

    try {
      await upsertFee.mutateAsync({
        id: selectedConfig.id,
        type: selectedConfig.type,
        name: selectedConfig.name,
        percentage,
        minFee,
        maxFee,
        isActive: editedActive});
      setEditModalVisible(false);
      Alert.alert('Success', 'Fee configuration saved to database');
    } catch (e: any) {
      const msg = e?.message ?? 'Unknown error';
      console.log('[Fees] upsert error:', msg);
      Alert.alert('Save Failed', msg);
    }
  };

  const renderOverview = () => (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heroCard}>
        <View style={styles.heroIcon}>
          <DollarSign size={32} color="#fff" />
        </View>
        <Text style={styles.heroLabel}>Total Revenue from Fees</Text>
        <Text style={styles.heroValue}>{formatCurrency(stats.totalFeesCollected)}</Text>
        <View style={styles.heroGrowth}>
          {stats.feeGrowthPercent >= 0 ? (
            <TrendingUp size={16} color={Colors.positive} />
          ) : (
            <TrendingDown size={16} color={Colors.negative} />
          )}
          <Text
            style={[
              styles.heroGrowthText,
              { color: stats.feeGrowthPercent >= 0 ? Colors.positive : Colors.negative },
            ]}
          >
            {stats.feeGrowthPercent >= 0 ? '+' : ''}
            {stats.feeGrowthPercent.toFixed(1)}% vs last month
          </Text>
        </View>
      </View>

      <View style={styles.statsGrid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>This Month</Text>
          <Text style={styles.statValue}>{formatCurrency(stats.feesThisMonth)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Last Month</Text>
          <Text style={styles.statValue}>{formatCurrency(stats.feesLastMonth)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Avg Fee</Text>
          <Text style={styles.statValue}>{formatCurrency(stats.averageFeeAmount)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Total Txns</Text>
          <Text style={styles.statValue}>{stats.totalTransactionsWithFees}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Platform Fee Structure</Text>
      <View style={styles.feeStructureCard}>
        <View style={styles.feeStructureRow}>
          <View style={styles.feeStructureLeft}>
            <View style={[styles.feeStructureIcon, { backgroundColor: Colors.primary + '15' }]}>
              <LogIn size={18} color={Colors.primary} />
            </View>
            <View>
              <Text style={styles.feeStructureName}>Entry Fee (Day 1)</Text>
              <Text style={styles.feeStructureDesc}>Charged on investment</Text>
            </View>
          </View>
          <Text style={styles.feeStructurePercent}>2.5%</Text>
        </View>
        <View style={styles.feeStructureDivider} />
        <View style={styles.feeStructureRow}>
          <View style={styles.feeStructureLeft}>
            <View style={[styles.feeStructureIcon, { backgroundColor: Colors.accent + '15' }]}>
              <Calendar size={18} color={Colors.accent} />
            </View>
            <View>
              <Text style={styles.feeStructureName}>Annual Management Fee</Text>
              <Text style={styles.feeStructureDesc}>Paid monthly</Text>
            </View>
          </View>
          <Text style={styles.feeStructurePercent}>1.0%/yr</Text>
        </View>
        <View style={styles.feeStructureDivider} />
        <View style={styles.feeStructureRow}>
          <View style={styles.feeStructureLeft}>
            <View style={[styles.feeStructureIcon, { backgroundColor: Colors.negative + '15' }]}>
              <LogOut size={18} color={Colors.negative} />
            </View>
            <View>
              <Text style={styles.feeStructureName}>Exit Fee</Text>
              <Text style={styles.feeStructureDesc}>Charged on sell</Text>
            </View>
          </View>
          <Text style={styles.feeStructurePercent}>2.5%</Text>
        </View>
        <View style={styles.feeStructureDivider} />
        <View style={styles.feeStructureRow}>
          <View style={styles.feeStructureLeft}>
            <View style={[styles.feeStructureIcon, { backgroundColor: Colors.warning + '15' }]}>
              <Users size={18} color={Colors.warning} />
            </View>
            <View>
              <Text style={styles.feeStructureName}>Influencer Commission</Text>
              <Text style={styles.feeStructureDesc}>One-time on referral investment</Text>
            </View>
          </View>
          <Text style={styles.feeStructurePercent}>5.0%</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Investor Returns</Text>
      <View style={styles.returnsCard}>
        <View style={styles.returnsIcon}>
          <PiggyBank size={28} color={Colors.positive} />
        </View>
        <Text style={styles.returnsValue}>12%</Text>
        <Text style={styles.returnsLabel}>Annual Return (12 month hold)</Text>
        <Text style={styles.returnsNote}>Clean returns on IVXHOLDINGS-owned properties</Text>
      </View>

      <Text style={styles.sectionTitle}>Revenue by Transaction Type</Text>
      <View style={styles.breakdownCard}>
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownLeft}>
            <View style={[styles.breakdownIcon, { backgroundColor: Colors.primary + '15' }]}>
              <ShoppingCart size={18} color={Colors.primary} />
            </View>
            <Text style={styles.breakdownLabel}>Buy Transactions</Text>
          </View>
          <Text style={styles.breakdownValue}>{formatCurrency(stats.feesByType.buy)}</Text>
        </View>
        <View style={styles.breakdownDivider} />
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownLeft}>
            <View style={[styles.breakdownIcon, { backgroundColor: Colors.accent + '15' }]}>
              <Tag size={18} color={Colors.accent} />
            </View>
            <Text style={styles.breakdownLabel}>Sell Transactions</Text>
          </View>
          <Text style={styles.breakdownValue}>{formatCurrency(stats.feesByType.sell)}</Text>
        </View>
        <View style={styles.breakdownDivider} />
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownLeft}>
            <View style={[styles.breakdownIcon, { backgroundColor: Colors.negative + '15' }]}>
              <ArrowUpFromLine size={18} color={Colors.negative} />
            </View>
            <Text style={styles.breakdownLabel}>Withdrawals</Text>
          </View>
          <Text style={styles.breakdownValue}>{formatCurrency(stats.feesByType.withdrawal)}</Text>
        </View>
        <View style={styles.breakdownDivider} />
        <View style={styles.breakdownRow}>
          <View style={styles.breakdownLeft}>
            <View style={[styles.breakdownIcon, { backgroundColor: Colors.positive + '15' }]}>
              <ArrowDownToLine size={18} color={Colors.positive} />
            </View>
            <Text style={styles.breakdownLabel}>Deposits</Text>
          </View>
          <Text style={styles.breakdownValue}>{formatCurrency(stats.feesByType.deposit)}</Text>
        </View>
      </View>

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderConfig = () => (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
      <Text style={styles.sectionTitle}>Fee Configuration</Text>
      <Text style={styles.sectionSubtitle}>
        Configure transaction fees for IVX HOLDINGS profit margin
      </Text>

      {configurations.map((config) => (
        <TouchableOpacity
          key={config.id}
          style={styles.configCard}
          onPress={() => openEditModal(config)}
          activeOpacity={0.7}
        >
          <View style={styles.configHeader}>
            <View style={styles.configLeft}>
              <View style={[styles.configIcon, { backgroundColor: getTypeColor(config.type) + '15' }]}>
                {getTypeIcon(config.type)}
              </View>
              <View>
                <Text style={styles.configName}>{config.name}</Text>
                <Text style={styles.configType}>{config.type.toUpperCase()}</Text>
              </View>
            </View>
            <View
              style={[
                styles.statusBadge,
                { backgroundColor: config.isActive ? Colors.positive + '20' : Colors.textSecondary + '20' },
              ]}
            >
              <Text
                style={[
                  styles.statusText,
                  { color: config.isActive ? Colors.positive : Colors.textSecondary },
                ]}
              >
                {config.isActive ? 'Active' : 'Inactive'}
              </Text>
            </View>
          </View>

          <View style={styles.configDetails}>
            <View style={styles.configDetail}>
              <Text style={styles.configDetailLabel}>Fee Rate</Text>
              <Text style={styles.configDetailValue}>{config.percentage}%</Text>
            </View>
            <View style={styles.configDetail}>
              <Text style={styles.configDetailLabel}>Min Fee</Text>
              <Text style={styles.configDetailValue}>{formatCurrency(config.minFee)}</Text>
            </View>
            <View style={styles.configDetail}>
              <Text style={styles.configDetailLabel}>Max Fee</Text>
              <Text style={styles.configDetailValue}>{formatCurrency(config.maxFee)}</Text>
            </View>
          </View>

          <View style={styles.configFooter}>
            <Settings size={14} color={Colors.textTertiary} />
            <Text style={styles.configFooterText}>Tap to edit</Text>
          </View>
        </TouchableOpacity>
      ))}

      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  const renderHistory = () => (
    <ScrollView style={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filterContainer}
        contentContainerStyle={styles.filterContent}
      >
        {[
          { key: 'all', label: 'All Types' },
          { key: 'buy', label: 'Buy' },
          { key: 'sell', label: 'Sell' },
          { key: 'withdrawal', label: 'Withdrawal' },
          { key: 'deposit', label: 'Deposit' },
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
          { key: 'collected', label: 'Collected' },
          { key: 'pending', label: 'Pending' },
          { key: 'waived', label: 'Waived' },
        ].map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, statusFilter === f.key && styles.filterChipActive]}
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
        <Text style={styles.resultsCount}>{filteredTransactions.length} fee records</Text>
        <Text style={styles.resultsVolume}>
          Total:{' '}
          {formatCurrency(
            filteredTransactions.reduce((sum, tx) => sum + tx.feeAmount, 0)
          )}
        </Text>
      </View>

      {filteredTransactions.map((tx) => {
        const statusStyle = getStatusStyle(tx.status);
        return (
          <View key={tx.id} style={styles.txCard}>
            <View style={styles.txHeader}>
              <View
                style={[
                  styles.typeIcon,
                  { backgroundColor: getTypeColor(tx.transactionType) + '15' },
                ]}
              >
                {getTypeIcon(tx.transactionType)}
              </View>
              <View style={styles.txInfo}>
                <View style={styles.txTopRow}>
                  <Text style={styles.txType}>{tx.transactionType.toUpperCase()} FEE</Text>
                  <View style={[styles.statusBadge, { backgroundColor: statusStyle.bg }]}>
                    <Text style={[styles.statusText, { color: statusStyle.color }]}>
                      {tx.status}
                    </Text>
                  </View>
                </View>
                <Text style={styles.txUser}>{tx.userName}</Text>
                <Text style={styles.txEmail}>{tx.userEmail}</Text>
              </View>
              <View style={styles.txAmount}>
                <Text style={styles.feeAmount}>+{formatCurrency(tx.feeAmount)}</Text>
                <Text style={styles.feePercent}>{tx.feePercentage}%</Text>
              </View>
            </View>

            <View style={styles.txDetails}>
              <View style={styles.txDetailRow}>
                <Text style={styles.txDetailLabel}>Transaction Amount</Text>
                <Text style={styles.txDetailValue}>{formatCurrency(tx.transactionAmount)}</Text>
              </View>
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
      })}
      <View style={styles.bottomPadding} />
    </ScrollView>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <ArrowLeft size={22} color={Colors.text} />
        </TouchableOpacity>
        <View>
          <Text style={styles.title}>IVXHOLDINGS Fee Revenue</Text>
          <Text style={styles.subtitle}>Transaction fees & profit margin</Text>
        </View>
      </View>

      <View style={styles.tabContainer}>
        {[
          { key: 'overview', label: 'Overview' },
          { key: 'config', label: 'Configuration' },
          { key: 'history', label: 'History' },
        ].map((tab) => (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            onPress={() => setActiveTab(tab.key as typeof activeTab)}
          >
            <Text style={[styles.tabText, activeTab === tab.key && styles.tabTextActive]}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'overview' && renderOverview()}
      {activeTab === 'config' && renderConfig()}
      {activeTab === 'history' && renderHistory()}

      <Modal
        visible={editModalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setEditModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Edit Fee Configuration</Text>
              <TouchableOpacity onPress={() => setEditModalVisible(false)}>
                <X size={24} color={Colors.text} />
              </TouchableOpacity>
            </View>

            {selectedConfig && (
              <>
                <View style={styles.modalConfigInfo}>
                  <View
                    style={[
                      styles.configIcon,
                      { backgroundColor: getTypeColor(selectedConfig.type) + '15' },
                    ]}
                  >
                    {getTypeIcon(selectedConfig.type)}
                  </View>
                  <Text style={styles.modalConfigName}>{selectedConfig.name}</Text>
                </View>

                <View style={styles.inputGroup}>
                  <Text style={styles.inputLabel}>Fee Percentage (%)</Text>
                  <View style={styles.inputContainer}>
                    <Percent size={18} color={Colors.textSecondary} />
                    <TextInput
                      style={styles.input}
                      value={editedPercentage}
                      onChangeText={setEditedPercentage}
                      keyboardType="decimal-pad"
                      placeholder="0.0"
                      placeholderTextColor={Colors.textTertiary}
                    />
                  </View>
                </View>

                <View style={styles.inputRow}>
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Min Fee ($)</Text>
                    <View style={styles.inputContainer}>
                      <DollarSign size={18} color={Colors.textSecondary} />
                      <TextInput
                        style={styles.input}
                        value={editedMinFee}
                        onChangeText={setEditedMinFee}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={Colors.textTertiary}
                      />
                    </View>
                  </View>
                  <View style={{ width: 12 }} />
                  <View style={[styles.inputGroup, { flex: 1 }]}>
                    <Text style={styles.inputLabel}>Max Fee ($)</Text>
                    <View style={styles.inputContainer}>
                      <DollarSign size={18} color={Colors.textSecondary} />
                      <TextInput
                        style={styles.input}
                        value={editedMaxFee}
                        onChangeText={setEditedMaxFee}
                        keyboardType="decimal-pad"
                        placeholder="0.00"
                        placeholderTextColor={Colors.textTertiary}
                      />
                    </View>
                  </View>
                </View>

                <View style={styles.switchRow}>
                  <Text style={styles.switchLabel}>Fee Active</Text>
                  <Switch
                    value={editedActive}
                    onValueChange={setEditedActive}
                    trackColor={{ false: Colors.border, true: Colors.primary + '80' }}
                    thumbColor={editedActive ? Colors.primary : Colors.textTertiary}
                  />
                </View>

                <TouchableOpacity style={styles.saveButton} onPress={handleSaveConfig} disabled={upsertFee.isPending}>
                  <Check size={20} color="#fff" />
                  <Text style={styles.saveButtonText}>{upsertFee.isPending ? 'Saving…' : 'Save Changes'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, gap: 10 },
  backBtn: { width: 38, height: 38, borderRadius: 10, backgroundColor: Colors.card, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: Colors.border },
  title: { color: Colors.text, fontSize: 18, fontWeight: '800' as const, flexShrink: 1 },
  subtitle: { color: Colors.textSecondary, fontSize: 13, marginTop: 4 },
  tabContainer: { flexDirection: 'row', backgroundColor: Colors.surface, borderRadius: 12, padding: 4, marginBottom: 16, marginHorizontal: 16 },
  tab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  tabActive: { backgroundColor: Colors.primary },
  tabText: { color: Colors.textSecondary, fontWeight: '600' as const, fontSize: 13 },
  tabTextActive: { color: Colors.black },
  content: { flex: 1, paddingHorizontal: 20 },
  heroCard: { backgroundColor: Colors.surface, borderRadius: 20, padding: 20, marginBottom: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  heroIcon: { width: 56, height: 56, borderRadius: 18, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  heroLabel: { color: Colors.textTertiary, fontSize: 13 },
  heroValue: { color: Colors.text, fontSize: 24, fontWeight: '800' as const },
  heroGrowth: { gap: 4 },
  heroGrowthText: { color: Colors.textSecondary, fontSize: 13 },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  statCard: { flex: 1, backgroundColor: Colors.surface, borderRadius: 14, padding: 14, alignItems: 'center', gap: 4, borderWidth: 1, borderColor: Colors.surfaceBorder },
  statLabel: { color: Colors.textTertiary, fontSize: 11 },
  statValue: { color: Colors.text, fontSize: 18, fontWeight: '800' as const },
  sectionTitle: { color: Colors.text, fontSize: 16, fontWeight: '700' as const, marginBottom: 12 },
  sectionSubtitle: { color: Colors.textTertiary, fontSize: 13, marginTop: 4 },
  breakdownCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  breakdownRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  breakdownLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  breakdownIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  breakdownLabel: { color: Colors.textSecondary, fontSize: 13 },
  breakdownValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  breakdownDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  configCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  configHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  configLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  configIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  configName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  configType: { color: Colors.textSecondary, fontSize: 11, fontWeight: '600' as const },
  configDetails: { flexDirection: 'row', gap: 16, marginTop: 4 },
  configDetail: { gap: 2 },
  configDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  configDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  configFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  configFooterText: { color: Colors.textSecondary, fontSize: 13 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  searchBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, paddingHorizontal: 12, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder, gap: 8 },
  searchInput: { flex: 1, color: Colors.text, fontSize: 15, paddingVertical: 12 },
  filterContainer: { marginBottom: 12 },
  filterContent: { flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 2 },
  filterChip: { backgroundColor: Colors.surface, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: Colors.surfaceBorder, height: 36, justifyContent: 'center' },
  filterChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterChipText: { color: Colors.textSecondary, fontSize: 13, fontWeight: '600' as const },
  filterChipTextActive: { color: Colors.black },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  resultsCount: { color: Colors.textSecondary, fontSize: 13, flex: 1 },
  resultsVolume: { color: Colors.text, fontSize: 13, fontWeight: '600' as const },
  list: { gap: 10 },
  txCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  txHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
  typeIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  txInfo: { flex: 1 },
  txTopRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  txType: { color: Colors.text, fontSize: 13, fontWeight: '700' as const },
  statusBadge: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  statusText: { color: Colors.textSecondary, fontSize: 13 },
  txUser: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  txEmail: { color: Colors.textSecondary, fontSize: 13 },
  txAmount: { alignItems: 'flex-end', gap: 2 },
  feeAmount: { color: Colors.positive, fontSize: 15, fontWeight: '700' as const },
  feePercent: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  txDetails: { gap: 4 },
  txDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  txDetailLabel: { color: Colors.textSecondary, fontSize: 13 },
  txDetailValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  propertyRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  propertyName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  txDate: { color: Colors.textTertiary, fontSize: 12 },
  bottomPadding: { height: 120 },
  feeStructureCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  feeStructureRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  feeStructureLeft: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  feeStructureIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  feeStructureName: { color: Colors.text, fontSize: 15, fontWeight: '700' as const },
  feeStructureDesc: { color: Colors.textSecondary, fontSize: 13, lineHeight: 18 },
  feeStructurePercent: { color: Colors.primary, fontSize: 14, fontWeight: '700' as const },
  feeStructureDivider: { width: 1, height: 24, backgroundColor: Colors.surfaceBorder },
  returnsCard: { backgroundColor: Colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  returnsIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: Colors.primary + '15', alignItems: 'center', justifyContent: 'center' },
  returnsValue: { color: Colors.text, fontSize: 14, fontWeight: '600' as const },
  returnsLabel: { color: Colors.textSecondary, fontSize: 13 },
  returnsNote: { color: Colors.textTertiary, fontSize: 12 },
  modalOverlay: { flex: 1, backgroundColor: Colors.overlay, justifyContent: 'center', padding: 20 },
  modalContent: { backgroundColor: Colors.surface, borderRadius: 20, padding: 24, maxHeight: '80%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  modalTitle: { color: Colors.text, fontSize: 20, fontWeight: '800' as const },
  modalConfigInfo: { backgroundColor: Colors.backgroundSecondary, borderRadius: 10, padding: 12, marginBottom: 16 },
  modalConfigName: { color: Colors.text, fontSize: 15, fontWeight: '600' as const },
  inputGroup: { gap: 6, marginBottom: 12 },
  inputLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, marginBottom: 6 },
  inputContainer: { flexDirection: 'row', alignItems: 'center', backgroundColor: Colors.surface, borderRadius: 12, borderWidth: 1, borderColor: Colors.surfaceBorder },
  input: { backgroundColor: Colors.surface, borderRadius: 12, padding: 14, color: Colors.text, fontSize: 16, borderWidth: 1, borderColor: Colors.surfaceBorder },
  inputRow: { flexDirection: 'row', gap: 12 },
  switchRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12 },
  switchLabel: { color: Colors.text, fontSize: 14, fontWeight: '600' as const, flex: 1 },
  saveButton: { backgroundColor: Colors.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  saveButtonText: { color: Colors.black, fontWeight: '700' as const, fontSize: 15 }});
