import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  Building2,
  Plus,
  TrendingUp,
  TrendingDown,
  Wallet,
  Percent,
  Calendar,
  X,
  CircleDollarSign,
} from 'lucide-react-native';
import Colors from '@/constants/colors';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ownerApi,
  type OwnerHolding,
} from '@/lib/ivx-owner-api';
import { formatCurrency, formatCurrencyWithDecimals } from '@/lib/formatters';
import { EmptyState } from '@/components/ProgressiveStates';

const fontWeightBold = 'bold' as const;
const fontWeightSemiBold = '600' as const;
const fontWeightMedium = '500' as const;

type StatusFilter = 'all' | 'active' | 'sold' | 'listed';

export default function OwnerHoldingsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [showAddModal, setShowAddModal] = useState(false);

  const { data: holdingsData, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['owner-holdings'],
    queryFn: () => ownerApi.getHoldings(),
  });

  const holdings: OwnerHolding[] = holdingsData?.holdings ?? [];

  const filteredHoldings = useMemo(() => {
    if (statusFilter === 'all') return holdings;
    if (statusFilter === 'listed') return holdings.filter((h) => h.is_listed_for_sale);
    return holdings.filter((h) => h.status === statusFilter);
  }, [holdings, statusFilter]);

  const totals = useMemo(() => {
    const totalValue = holdings.reduce((sum, h) => sum + (h.current_value || 0), 0);
    const totalEquity = holdings.reduce((sum, h) => sum + (h.equity || 0), 0);
    const totalMortgage = holdings.reduce((sum, h) => sum + (h.outstanding_mortgage || 0), 0);
    const totalIncome = holdings.reduce((sum, h) => sum + (h.annual_rental_income || 0), 0);
    const totalExpenses = holdings.reduce((sum, h) => sum + (h.annual_expenses || 0), 0);
    return {
      totalValue,
      totalEquity,
      totalMortgage,
      totalIncome,
      totalExpenses,
      totalCashFlow: totalIncome - totalExpenses,
    };
  }, [holdings]);

  const addMutation = useMutation({
    mutationFn: (data: Record<string, unknown>) => ownerApi.createHolding(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner-holdings'] });
      queryClient.invalidateQueries({ queryKey: ['owner-portfolio'] });
      setShowAddModal(false);
      Alert.alert('Success', 'Property holding added to your portfolio.');
    },
    onError: (err: Error) => {
      Alert.alert('Error', err.message || 'Failed to add holding. Please try again.');
    },
  });

  const handleAdd = useCallback((data: Record<string, unknown>) => {
    addMutation.mutate(data);
  }, [addMutation]);

  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Loading holdings…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>Holdings</Text>
            <Text style={styles.headerSubtitle}>{holdings.length} properties</Text>
          </View>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => setShowAddModal(true)}
          >
            <Plus size={20} color={Colors.black} />
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Summary Bar */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryItemLabel}>Value</Text>
          <Text style={styles.summaryItemValue}>{formatCurrency(totals.totalValue)}</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryItemLabel}>Equity</Text>
          <Text style={[styles.summaryItemValue, { color: Colors.success }]}>
            {formatCurrency(totals.totalEquity)}
          </Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryItemLabel}>Cash Flow</Text>
          <Text style={[
            styles.summaryItemValue,
            { color: totals.totalCashFlow >= 0 ? Colors.success : Colors.error },
          ]}>
            {formatCurrency(totals.totalCashFlow)}
          </Text>
        </View>
      </View>

      {/* Status Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {([
          { key: 'all', label: 'All' },
          { key: 'active', label: 'Active' },
          { key: 'listed', label: 'For Sale' },
          { key: 'sold', label: 'Sold' },
        ] as { key: StatusFilter; label: string }[]).map((filter) => (
          <TouchableOpacity
            key={filter.key}
            style={[
              styles.filterChip,
              statusFilter === filter.key && styles.filterChipActive,
            ]}
            onPress={() => setStatusFilter(filter.key)}
          >
            <Text style={[
              styles.filterChipText,
              statusFilter === filter.key && styles.filterChipTextActive,
            ]}>
              {filter.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Holdings List */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={() => refetch()}
            tintColor={Colors.gold}
            colors={[Colors.gold]}
          />
        }
      >
        {filteredHoldings.length === 0 ? (
          <EmptyState
            title="No properties found"
            message="Add a property holding to start tracking your real estate portfolio."
          />
        ) : (
          <View style={styles.holdingsList}>
            {filteredHoldings.map((holding: OwnerHolding) => (
              <React.Fragment key={holding.id}>
                <HoldingDetailCard holding={holding} />
              </React.Fragment>
            ))}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Add Modal */}
      <AddHoldingModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAdd}
        isSubmitting={addMutation.isPending}
      />
    </SafeAreaView>
  );
}

// ---- Sub-components ----

function HoldingDetailCard({ holding }: { holding: OwnerHolding }) {
  const equity = holding.equity ?? 0;
  const cashFlow = holding.annual_net_cash_flow ?? 0;
  const capRate = holding.cap_rate ?? 0;
  const cashOnCash = holding.cash_on_cash_return ?? 0;
  const isPositive = cashFlow >= 0;
  const acquisitionPrice = holding.acquisition_price ?? 0;
  const currentValue = holding.current_value ?? 0;
  const appreciation = currentValue - acquisitionPrice;
  const appreciationPct = acquisitionPrice > 0 ? (appreciation / acquisitionPrice) * 100 : 0;

  return (
    <View style={styles.holdingCard}>
      {/* Title Row */}
      <View style={styles.holdingCardHeader}>
        <View style={styles.holdingCardTitle}>
          <Building2 size={16} color={Colors.gold} />
          <Text style={styles.holdingCardName} numberOfLines={1}>
            {holding.property_title}
          </Text>
        </View>
        <View style={[
          styles.statusPill,
          { backgroundColor: holding.status === 'active' ? `${Colors.success}15` : `${Colors.textSecondary}15` },
        ]}>
          <Text style={[
            styles.statusPillText,
            { color: holding.status === 'active' ? Colors.success : Colors.textSecondary },
          ]}>
            {holding.status}
          </Text>
        </View>
      </View>

      {/* Value & Equity */}
      <View style={styles.holdingCardStats}>
        <View style={styles.holdingCardStat}>
          <Text style={styles.holdingCardStatLabel}>Current Value</Text>
          <Text style={styles.holdingCardStatValue}>{formatCurrency(currentValue)}</Text>
          {appreciation !== 0 && (
            <View style={styles.holdingCardStatTrend}>
              {appreciation > 0 ? (
                <TrendingUp size={10} color={Colors.success} />
              ) : (
                <TrendingDown size={10} color={Colors.error} />
              )}
              <Text style={[
                styles.holdingCardStatTrendText,
                { color: appreciation > 0 ? Colors.success : Colors.error },
              ]}>
                {appreciationPct > 0 ? '+' : ''}{appreciationPct.toFixed(1)}%
              </Text>
            </View>
          )}
        </View>
        <View style={styles.holdingCardStat}>
          <Text style={styles.holdingCardStatLabel}>Equity</Text>
          <Text style={[styles.holdingCardStatValue, { color: Colors.success }]}>
            {formatCurrency(equity)}
          </Text>
          <Text style={styles.holdingCardStatSubtext}>
            Mortgage: {formatCurrency(holding.outstanding_mortgage ?? 0)}
          </Text>
        </View>
      </View>

      {/* Financial Metrics */}
      <View style={styles.metricsRow}>
        <View style={styles.metricItem}>
          <Percent size={12} color={Colors.textSecondary} />
          <Text style={styles.metricLabel}>Cap Rate</Text>
          <Text style={styles.metricValue}>{capRate.toFixed(2)}%</Text>
        </View>
        <View style={styles.metricItem}>
          <CircleDollarSign size={12} color={Colors.textSecondary} />
          <Text style={styles.metricLabel}>CoC Return</Text>
          <Text style={styles.metricValue}>{cashOnCash.toFixed(2)}%</Text>
        </View>
        <View style={styles.metricItem}>
          {isPositive ? (
            <TrendingUp size={12} color={Colors.success} />
          ) : (
            <TrendingDown size={12} color={Colors.error} />
          )}
          <Text style={styles.metricLabel}>Annual CF</Text>
          <Text style={[
            styles.metricValue,
            { color: isPositive ? Colors.success : Colors.error },
          ]}>
            {formatCurrency(Math.abs(cashFlow))}
          </Text>
        </View>
      </View>

      {/* Footer */}
      <View style={styles.holdingCardFooter}>
        <View style={styles.holdingCardFooterItem}>
          <Calendar size={11} color={Colors.textSecondary} />
          <Text style={styles.holdingCardFooterText}>
            Acquired {new Date(holding.acquisition_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </Text>
        </View>
        <Text style={styles.holdingCardFooterPrice}>
          {formatCurrency(acquisitionPrice)}
        </Text>
      </View>
    </View>
  );
}

function AddHoldingModal({
  visible,
  onClose,
  onSubmit,
  isSubmitting,
}: {
  visible: boolean;
  onClose: () => void;
  onSubmit: (data: Record<string, unknown>) => void;
  isSubmitting: boolean;
}) {
  const [propertyTitle, setPropertyTitle] = useState('');
  const [acquisitionDate, setAcquisitionDate] = useState('');
  const [acquisitionPrice, setAcquisitionPrice] = useState('');
  const [currentValue, setCurrentValue] = useState('');
  const [outstandingMortgage, setOutstandingMortgage] = useState('');
  const [annualRentalIncome, setAnnualRentalIncome] = useState('');
  const [annualExpenses, setAnnualExpenses] = useState('');
  const [notes, setNotes] = useState('');

  const handleSubmit = () => {
    if (!propertyTitle || !acquisitionDate || !acquisitionPrice) {
      Alert.alert('Required', 'Property title, acquisition date, and acquisition price are required.');
      return;
    }
    onSubmit({
      property_title: propertyTitle,
      acquisition_date: acquisitionDate,
      acquisition_price: parseFloat(acquisitionPrice) || 0,
      current_value: parseFloat(currentValue) || parseFloat(acquisitionPrice) || 0,
      outstanding_mortgage: parseFloat(outstandingMortgage) || 0,
      annual_rental_income: parseFloat(annualRentalIncome) || 0,
      annual_expenses: parseFloat(annualExpenses) || 0,
      notes: notes || null,
    });
    // Reset fields
    setPropertyTitle('');
    setAcquisitionDate('');
    setAcquisitionPrice('');
    setCurrentValue('');
    setOutstandingMortgage('');
    setAnnualRentalIncome('');
    setAnnualExpenses('');
    setNotes('');
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Add Property Holding</Text>
            <TouchableOpacity onPress={onClose}>
              <X size={20} color={Colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalScrollContent}>
            <ModalInput
              label="Property Title *"
              value={propertyTitle}
              onChange={setPropertyTitle}
              placeholder="e.g. Brickell Condo Unit 1205"
            />
            <ModalInput
              label="Acquisition Date *"
              value={acquisitionDate}
              onChange={setAcquisitionDate}
              placeholder="YYYY-MM-DD"
            />
            <ModalInput
              label="Acquisition Price *"
              value={acquisitionPrice}
              onChange={setAcquisitionPrice}
              placeholder="500000"
              keyboardType="numeric"
            />
            <ModalInput
              label="Current Value"
              value={currentValue}
              onChange={setCurrentValue}
              placeholder="550000"
              keyboardType="numeric"
            />
            <ModalInput
              label="Outstanding Mortgage"
              value={outstandingMortgage}
              onChange={setOutstandingMortgage}
              placeholder="300000"
              keyboardType="numeric"
            />
            <ModalInput
              label="Annual Rental Income"
              value={annualRentalIncome}
              onChange={setAnnualRentalIncome}
              placeholder="42000"
              keyboardType="numeric"
            />
            <ModalInput
              label="Annual Expenses"
              value={annualExpenses}
              onChange={setAnnualExpenses}
              placeholder="12000"
              keyboardType="numeric"
            />
            <ModalInput
              label="Notes"
              value={notes}
              onChange={setNotes}
              placeholder="Optional notes…"
              multiline
            />
            <TouchableOpacity
              style={[styles.modalSubmit, isSubmitting && styles.modalSubmitDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              <Text style={styles.modalSubmitText}>
                {isSubmitting ? 'Adding…' : 'Add to Portfolio'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function ModalInput({
  label,
  value,
  onChange,
  placeholder,
  keyboardType,
  multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  keyboardType?: 'default' | 'numeric';
  multiline?: boolean;
}) {
  return (
    <View style={styles.modalInputContainer}>
      <Text style={styles.modalInputLabel}>{label}</Text>
      <TextInput
        style={[styles.modalInput, multiline && styles.modalInputMultiline]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={Colors.inputPlaceholder}
        keyboardType={keyboardType || 'default'}
        multiline={multiline}
        numberOfLines={multiline ? 3 : 1}
      />
    </View>
  );
}

// ---- Styles ----

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: Colors.textSecondary,
    fontSize: 14,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 28,
    fontWeight: fontWeightBold,
    color: Colors.text,
    letterSpacing: -0.5,
  },
  headerSubtitle: {
    fontSize: 14,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.gold,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
  },
  addButtonText: {
    fontSize: 13,
    fontWeight: fontWeightBold,
    color: Colors.black,
  },
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginHorizontal: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryItemLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
    marginBottom: 4,
  },
  summaryItemValue: {
    fontSize: 16,
    fontWeight: fontWeightBold,
    color: Colors.text,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: Colors.surfaceBorder,
    marginVertical: 2,
  },
  filterRow: {
    paddingHorizontal: 16,
    paddingBottom: 8,
    gap: 8,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: Colors.surfaceElevated,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  filterChipActive: {
    backgroundColor: Colors.gold,
    borderColor: Colors.gold,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: fontWeightMedium,
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: Colors.black,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingBottom: 24,
  },
  holdingsList: {
    gap: 12,
  },
  holdingCard: {
    backgroundColor: Colors.surfaceElevated,
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceBorder,
  },
  holdingCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  holdingCardTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    marginRight: 8,
  },
  holdingCardName: {
    fontSize: 15,
    fontWeight: fontWeightSemiBold,
    color: Colors.text,
    flex: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  statusPillText: {
    fontSize: 10,
    fontWeight: fontWeightSemiBold,
    textTransform: 'capitalize',
  },
  holdingCardStats: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 14,
  },
  holdingCardStat: {
    flex: 1,
  },
  holdingCardStatLabel: {
    fontSize: 11,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
    marginBottom: 4,
  },
  holdingCardStatValue: {
    fontSize: 18,
    fontWeight: fontWeightBold,
    color: Colors.text,
  },
  holdingCardStatSubtext: {
    fontSize: 10,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  holdingCardStatTrend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginTop: 4,
  },
  holdingCardStatTrendText: {
    fontSize: 11,
    fontWeight: fontWeightSemiBold,
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceBorder,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
    marginBottom: 12,
  },
  metricItem: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metricLabel: {
    fontSize: 10,
    color: Colors.textSecondary,
    fontWeight: fontWeightMedium,
  },
  metricValue: {
    fontSize: 12,
    fontWeight: fontWeightBold,
    color: Colors.text,
    marginLeft: 'auto',
  },
  holdingCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  holdingCardFooterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  holdingCardFooterText: {
    fontSize: 11,
    color: Colors.textSecondary,
  },
  holdingCardFooterPrice: {
    fontSize: 12,
    fontWeight: fontWeightSemiBold,
    color: Colors.textSecondary,
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: Colors.overlay,
  },
  modalContent: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceBorder,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: fontWeightBold,
    color: Colors.text,
  },
  modalScroll: {
    maxHeight: 500,
  },
  modalScrollContent: {
    padding: 20,
    gap: 14,
  },
  modalInputContainer: {
    gap: 6,
  },
  modalInputLabel: {
    fontSize: 12,
    fontWeight: fontWeightMedium,
    color: Colors.textSecondary,
  },
  modalInput: {
    backgroundColor: Colors.inputBackground,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    color: Colors.text,
    borderWidth: 1,
    borderColor: Colors.inputBorder,
  },
  modalInputMultiline: {
    minHeight: 60,
    textAlignVertical: 'top',
  },
  modalSubmit: {
    backgroundColor: Colors.gold,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  modalSubmitDisabled: {
    opacity: 0.6,
  },
  modalSubmitText: {
    fontSize: 15,
    fontWeight: fontWeightBold,
    color: Colors.black,
  },
});
